import os
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import desc, asc
from typing import Optional
from database import get_db
from models import Photo, Trip
from indexer import THUMBNAIL_DIR

router = APIRouter(prefix="/api/photos", tags=["photos"])


class AssignTrip(BaseModel):
    trip_id: Optional[int] = None


class BulkAssignTrip(BaseModel):
    photo_ids: list[int]
    trip_id: Optional[int] = None


def photo_to_dict(photo: Photo) -> dict:
    return {
        "id": photo.id,
        "filename": photo.filename,
        "date_taken": photo.date_taken.isoformat() if photo.date_taken else None,
        "latitude": photo.latitude,
        "longitude": photo.longitude,
        "width": photo.width,
        "height": photo.height,
        "file_size": photo.file_size,
        "camera_make": photo.camera_make,
        "camera_model": photo.camera_model,
        "has_thumbnail": photo.has_thumbnail,
        "trip_id": photo.trip_id,
        "trip_color": photo.trip.color if photo.trip else None,
        "trip_name": photo.trip.name if photo.trip else None,
    }


@router.get("")
def list_photos(
    trip_id: Optional[int] = Query(None),
    no_trip: Optional[bool] = Query(None),
    has_gps: Optional[bool] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    sort: str = Query("date_desc"),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    q = db.query(Photo).outerjoin(Trip, Photo.trip_id == Trip.id)

    if trip_id is not None:
        q = q.filter(Photo.trip_id == trip_id)
    if no_trip:
        q = q.filter(Photo.trip_id == None)  # noqa: E711
    if has_gps is True:
        q = q.filter(Photo.latitude != None, Photo.longitude != None)  # noqa: E711
    if has_gps is False:
        q = q.filter((Photo.latitude == None) | (Photo.longitude == None))  # noqa: E711
    if date_from:
        from datetime import datetime
        q = q.filter(Photo.date_taken >= datetime.fromisoformat(date_from))
    if date_to:
        from datetime import datetime
        q = q.filter(Photo.date_taken <= datetime.fromisoformat(date_to))

    if sort == "date_desc":
        q = q.order_by(desc(Photo.date_taken))
    elif sort == "date_asc":
        q = q.order_by(asc(Photo.date_taken))
    elif sort == "name_asc":
        q = q.order_by(asc(Photo.filename))

    total = q.count()
    photos = q.offset((page - 1) * per_page).limit(per_page).all()

    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page,
        "photos": [photo_to_dict(p) for p in photos],
    }


@router.get("/map-pins")
def map_pins(
    trip_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """Return lightweight pin data for all geotagged photos."""
    q = db.query(
        Photo.id,
        Photo.latitude,
        Photo.longitude,
        Photo.date_taken,
        Photo.trip_id,
        Trip.color,
        Trip.name,
    ).outerjoin(Trip, Photo.trip_id == Trip.id).filter(
        Photo.latitude != None,  # noqa: E711
        Photo.longitude != None,  # noqa: E711
    )

    if trip_id is not None:
        q = q.filter(Photo.trip_id == trip_id)

    rows = q.all()
    return [
        {
            "id": r.id,
            "lat": r.latitude,
            "lon": r.longitude,
            "date": r.date_taken.isoformat() if r.date_taken else None,
            "trip_id": r.trip_id,
            "trip_color": r.color,
            "trip_name": r.name,
        }
        for r in rows
    ]


@router.get("/{photo_id}")
def get_photo(photo_id: int, db: Session = Depends(get_db)):
    photo = db.query(Photo).filter(Photo.id == photo_id).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    return photo_to_dict(photo)


@router.get("/{photo_id}/thumbnail")
def get_thumbnail(photo_id: int, db: Session = Depends(get_db)):
    photo = db.query(Photo).filter(Photo.id == photo_id).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    thumb_path = os.path.join(THUMBNAIL_DIR, f"{photo_id}.jpg")
    if os.path.exists(thumb_path):
        return FileResponse(thumb_path, media_type="image/jpeg")

    # Try to generate on demand
    from indexer import generate_thumbnail
    success = generate_thumbnail(photo_id, photo.file_path)
    if success:
        photo.has_thumbnail = True
        db.commit()
        return FileResponse(thumb_path, media_type="image/jpeg")

    raise HTTPException(status_code=404, detail="Thumbnail not available")


@router.get("/{photo_id}/image")
def get_image(photo_id: int, db: Session = Depends(get_db)):
    photo = db.query(Photo).filter(Photo.id == photo_id).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    if not os.path.exists(photo.file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(photo.file_path)


@router.put("/{photo_id}/trip")
def assign_trip(photo_id: int, data: AssignTrip, db: Session = Depends(get_db)):
    photo = db.query(Photo).filter(Photo.id == photo_id).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    if data.trip_id is not None:
        trip = db.query(Trip).filter(Trip.id == data.trip_id).first()
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
    photo.trip_id = data.trip_id
    db.commit()
    db.refresh(photo)
    return photo_to_dict(photo)


@router.post("/bulk-assign-trip")
def bulk_assign_trip(data: BulkAssignTrip, db: Session = Depends(get_db)):
    if data.trip_id is not None:
        trip = db.query(Trip).filter(Trip.id == data.trip_id).first()
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

    updated = (
        db.query(Photo)
        .filter(Photo.id.in_(data.photo_ids))
        .update({"trip_id": data.trip_id}, synchronize_session=False)
    )
    db.commit()
    return {"updated": updated}


@router.get("/stats/summary")
def stats(db: Session = Depends(get_db)):
    total = db.query(Photo).count()
    geotagged = db.query(Photo).filter(
        Photo.latitude != None, Photo.longitude != None  # noqa: E711
    ).count()
    with_trip = db.query(Photo).filter(Photo.trip_id != None).count()  # noqa: E711
    return {
        "total_photos": total,
        "geotagged": geotagged,
        "with_trip": with_trip,
        "no_trip": total - with_trip,
    }
