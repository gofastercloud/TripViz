import threading
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional
from database import get_db, SessionLocal
import ml as ml_engine
from models import Photo, Face, Person

router = APIRouter(prefix="/api/ml", tags=["ml"])


# ──────────────────────────────────────────────────────────
#  Capabilities
# ──────────────────────────────────────────────────────────

@router.get("/capabilities")
def capabilities():
    return ml_engine.detect_capabilities()


@router.get("/models/status")
def models_status():
    return {
        "face_models": ml_engine._check_face_models(),
        "models_dir": str(ml_engine.MODELS_DIR),
    }


@router.post("/models/download")
def download_models():
    state = ml_engine.get_batch_state()
    if state["running"]:
        raise HTTPException(status_code=409, detail="A batch job is already running")

    messages: list[str] = []

    def progress(msg: str):
        messages.append(msg)

    result = ml_engine.download_face_models(progress_cb=progress)
    return {"status": result, "messages": messages}


# ──────────────────────────────────────────────────────────
#  Single-photo analysis
# ──────────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    run_faces: bool = True
    run_activities: bool = True
    device: str = "cpu"


@router.post("/analyze/{photo_id}")
def analyze_photo(photo_id: int, req: AnalyzeRequest, db: Session = Depends(get_db)):
    caps = ml_engine.detect_capabilities()
    if req.run_faces and not caps["face_detection_ready"]:
        raise HTTPException(status_code=400, detail="Face detection not ready — check capabilities")
    if req.run_activities and not caps["activity_detection_ready"]:
        raise HTTPException(status_code=400, detail="Activity detection not ready — check capabilities")

    result = ml_engine.analyze_photo(
        photo_id, db,
        run_faces=req.run_faces,
        run_activities=req.run_activities,
        device=req.device,
    )
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])

    # Return updated face records with person info
    faces = db.query(Face).filter(Face.photo_id == photo_id).all()
    result["faces"] = [_face_dict(f) for f in faces]
    return result


# ──────────────────────────────────────────────────────────
#  Batch analysis
# ──────────────────────────────────────────────────────────

class BatchAnalyzeRequest(BaseModel):
    photo_ids: Optional[list[int]] = None  # None = all unanalyzed
    run_faces: bool = True
    run_activities: bool = True
    only_unanalyzed: bool = True
    device: str = "cpu"


@router.post("/analyze/batch")
def batch_analyze(req: BatchAnalyzeRequest, db: Session = Depends(get_db)):
    state = ml_engine.get_batch_state()
    if state["running"]:
        raise HTTPException(status_code=409, detail="A batch job is already running")

    caps = ml_engine.detect_capabilities()
    if req.run_faces and not caps["face_detection_ready"]:
        raise HTTPException(status_code=400, detail="Face detection not ready")
    if req.run_activities and not caps["activity_detection_ready"]:
        raise HTTPException(status_code=400, detail="Activity detection not ready")

    if req.photo_ids is not None:
        ids = req.photo_ids
    else:
        q = db.query(Photo.id)
        if req.only_unanalyzed:
            if req.run_faces and req.run_activities:
                q = q.filter(~Photo.face_analyzed | ~Photo.activity_analyzed)
            elif req.run_faces:
                q = q.filter(~Photo.face_analyzed)
            else:
                q = q.filter(~Photo.activity_analyzed)
        ids = [row[0] for row in q.all()]

    if not ids:
        return {"ok": True, "message": "No photos to analyze", "count": 0}

    def _run():
        ml_engine.run_batch_analysis(
            ids,
            run_faces=req.run_faces,
            run_activities=req.run_activities,
            device=req.device,
            db_factory=SessionLocal,
        )

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
    return {"ok": True, "message": f"Batch analysis started for {len(ids)} photos", "count": len(ids)}


@router.get("/analyze/batch/status")
def batch_status():
    return ml_engine.get_batch_state()


# ──────────────────────────────────────────────────────────
#  Face clustering
# ──────────────────────────────────────────────────────────

class ClusterRequest(BaseModel):
    threshold: float = 0.45


@router.post("/cluster-faces")
def cluster_faces(req: ClusterRequest, db: Session = Depends(get_db)):
    state = ml_engine.get_batch_state()
    if state["running"]:
        raise HTTPException(status_code=409, detail="A batch job is already running")
    result = ml_engine.cluster_faces(db, threshold=req.threshold)
    return result


# ──────────────────────────────────────────────────────────
#  People
# ──────────────────────────────────────────────────────────

def _face_dict(face: Face) -> dict:
    return {
        "id": face.id,
        "photo_id": face.photo_id,
        "bbox_x": face.bbox_x,
        "bbox_y": face.bbox_y,
        "bbox_w": face.bbox_w,
        "bbox_h": face.bbox_h,
        "confidence": face.confidence,
        "person_id": face.person_id,
        "person_name": face.person.name if face.person else None,
    }


@router.get("/people")
def list_people(db: Session = Depends(get_db)):
    people = db.query(Person).order_by(Person.name).all()
    result = []
    for person in people:
        face_count = len(person.faces)
        # Grab the first face for the cover thumbnail
        cover_face = person.faces[0] if person.faces else None
        result.append({
            "id": person.id,
            "name": person.name,
            "face_count": face_count,
            "cover_face": _face_dict(cover_face) if cover_face else None,
        })
    return result


@router.get("/people/{person_id}/faces")
def get_person_faces(person_id: int, db: Session = Depends(get_db)):
    person = db.query(Person).filter(Person.id == person_id).first()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    return {
        "person": {"id": person.id, "name": person.name},
        "faces": [_face_dict(f) for f in person.faces],
    }


@router.get("/people/{person_id}/photos")
def get_person_photos(
    person_id: int,
    page: int = 1,
    per_page: int = 50,
    db: Session = Depends(get_db),
):
    person = db.query(Person).filter(Person.id == person_id).first()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    # Distinct photos that have a face assigned to this person
    from sqlalchemy import distinct
    photo_ids = (
        db.query(distinct(Face.photo_id))
        .filter(Face.person_id == person_id)
        .all()
    )
    ids = [r[0] for r in photo_ids]
    total = len(ids)
    page_ids = ids[(page - 1) * per_page: page * per_page]

    photos = db.query(Photo).filter(Photo.id.in_(page_ids)).order_by(Photo.date_taken).all()

    from routers.photos import photo_to_dict
    return {
        "person": {"id": person.id, "name": person.name, "face_count": total},
        "total": total,
        "page": page,
        "per_page": per_page,
        "photos": [photo_to_dict(p) for p in photos],
    }


class RenamePerson(BaseModel):
    name: str


@router.put("/people/{person_id}")
def rename_person(person_id: int, data: RenamePerson, db: Session = Depends(get_db)):
    person = db.query(Person).filter(Person.id == person_id).first()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    person.name = data.name
    db.commit()
    return {"id": person.id, "name": person.name}


class MergeRequest(BaseModel):
    source_id: int
    target_id: int


@router.post("/people/merge")
def merge_people(data: MergeRequest, db: Session = Depends(get_db)):
    source = db.query(Person).filter(Person.id == data.source_id).first()
    target = db.query(Person).filter(Person.id == data.target_id).first()
    if not source or not target:
        raise HTTPException(status_code=404, detail="Person not found")

    db.query(Face).filter(Face.person_id == data.source_id).update({"person_id": data.target_id})
    db.delete(source)
    db.commit()
    face_count = db.query(Face).filter(Face.person_id == data.target_id).count()
    return {"id": target.id, "name": target.name, "face_count": face_count}


@router.delete("/people/{person_id}")
def delete_person(person_id: int, db: Session = Depends(get_db)):
    person = db.query(Person).filter(Person.id == person_id).first()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    db.query(Face).filter(Face.person_id == person_id).update({"person_id": None})
    db.delete(person)
    db.commit()
    return {"ok": True}


# ──────────────────────────────────────────────────────────
#  Photo faces endpoint
# ──────────────────────────────────────────────────────────

@router.get("/photos/{photo_id}/faces")
def get_photo_faces(photo_id: int, db: Session = Depends(get_db)):
    faces = db.query(Face).filter(Face.photo_id == photo_id).all()
    return [_face_dict(f) for f in faces]
