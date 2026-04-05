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
        "lens_model": photo.lens_model,
        "has_thumbnail": photo.has_thumbnail,
        "trip_id": photo.trip_id,
        "trip_color": photo.trip.color if photo.trip else None,
        "trip_name": photo.trip.name if photo.trip else None,
        "notes": photo.notes,
        "tags": photo.tags,
        "activities": photo.activities,
        "face_analyzed": photo.face_analyzed,
        "activity_analyzed": photo.activity_analyzed,
    }


@router.get("")
def list_photos(
    trip_id: Optional[int] = Query(None),
    no_trip: Optional[bool] = Query(None),
    has_gps: Optional[bool] = Query(None),
    camera_make: Optional[str] = Query(None),
    camera_model: Optional[str] = Query(None),
    camera_devices: Optional[str] = Query(None, description="Comma-separated make:model pairs"),
    lens_model: Optional[str] = Query(None),
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
    if camera_make is not None:
        q = q.filter(Photo.camera_make == camera_make)
    if camera_model is not None:
        q = q.filter(Photo.camera_model == camera_model)
    if camera_devices:
        from sqlalchemy import or_, and_
        device_filters = []
        for dev in camera_devices.split(","):
            parts = dev.strip().split(":", 1)
            if len(parts) == 2:
                make, model = parts
                device_filters.append(and_(Photo.camera_make == make, Photo.camera_model == model))
        if device_filters:
            q = q.filter(or_(*device_filters))
    if lens_model is not None:
        q = q.filter(Photo.lens_model == lens_model)
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


def _cluster_pins(pins: list[dict], radius_m: float = 200.0) -> list[dict]:
    """Cluster nearby pins within radius_m into weighted-average dots.

    Uses a simple greedy clustering: iterate pins, assign each to the nearest
    existing cluster within radius, or create a new cluster.
    Returns cluster centroids with photo_ids and count.
    """
    from math import radians, cos, sin, asin, sqrt

    def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
        dlat, dlon = lat2 - lat1, lon2 - lon1
        a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
        return 2 * 6371000 * asin(sqrt(a))

    clusters: list[dict] = []  # {lat_sum, lon_sum, count, ids, trip_id, trip_color, trip_name, latest_date}

    for pin in pins:
        best_idx = -1
        best_dist = radius_m + 1

        for i, c in enumerate(clusters):
            clat = c["lat_sum"] / c["count"]
            clon = c["lon_sum"] / c["count"]
            d = haversine_m(pin["lat"], pin["lon"], clat, clon)
            if d < best_dist:
                best_dist = d
                best_idx = i

        if best_idx >= 0 and best_dist <= radius_m:
            c = clusters[best_idx]
            c["lat_sum"] += pin["lat"]
            c["lon_sum"] += pin["lon"]
            c["count"] += 1
            c["ids"].append(pin["id"])
            if pin["date"] and (not c["latest_date"] or pin["date"] > c["latest_date"]):
                c["latest_date"] = pin["date"]
        else:
            clusters.append({
                "lat_sum": pin["lat"],
                "lon_sum": pin["lon"],
                "count": 1,
                "ids": [pin["id"]],
                "trip_id": pin["trip_id"],
                "trip_color": pin["trip_color"],
                "trip_name": pin["trip_name"],
                "latest_date": pin["date"],
            })

    return [
        {
            "id": c["ids"][0],
            "lat": c["lat_sum"] / c["count"],
            "lon": c["lon_sum"] / c["count"],
            "date": c["latest_date"],
            "trip_id": c["trip_id"],
            "trip_color": c["trip_color"],
            "trip_name": c["trip_name"],
            "count": c["count"],
            "photo_ids": c["ids"],
        }
        for c in clusters
    ]


@router.get("/map-pins")
def map_pins(
    trip_id: Optional[int] = Query(None),
    cluster_radius: float = Query(200.0, ge=0, description="Cluster radius in meters (0 = no clustering)"),
    db: Session = Depends(get_db),
):
    """Return lightweight pin data for all geotagged photos, optionally clustered."""
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
    pins = [
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

    if cluster_radius > 0 and len(pins) > 1:
        return _cluster_pins(pins, cluster_radius)

    # Add count/photo_ids for consistency
    for p in pins:
        p["count"] = 1
        p["photo_ids"] = [p["id"]]
    return pins


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


@router.get("/{photo_id}/exif")
def get_exif(photo_id: int, db: Session = Depends(get_db)):
    """Return full EXIF metadata read directly from the image file."""
    photo = db.query(Photo).filter(Photo.id == photo_id).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    if not os.path.exists(photo.file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    from PIL import Image, ExifTags
    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
    except ImportError:
        pass

    result: dict = {}
    try:
        img = Image.open(photo.file_path)
        raw_exif = img.getexif()
        if not raw_exif:
            return result

        # Root IFD tags
        for tag_id, value in raw_exif.items():
            tag_name = ExifTags.TAGS.get(tag_id, f"Tag_{tag_id}")
            result[tag_name] = _exif_val(value)

        # EXIF sub-IFD (exposure, date, lens info)
        exif_ifd = raw_exif.get_ifd(0x8769)
        for tag_id, value in exif_ifd.items():
            tag_name = ExifTags.TAGS.get(tag_id, f"Tag_{tag_id}")
            result[tag_name] = _exif_val(value)

        # GPS sub-IFD
        gps_ifd_tag = next((t for t, n in ExifTags.TAGS.items() if n == "GPSInfo"), None)
        if gps_ifd_tag and gps_ifd_tag in raw_exif:
            gps_data = raw_exif.get_ifd(gps_ifd_tag)
            gps = {}
            for tag_id, value in gps_data.items():
                tag_name = ExifTags.GPSTAGS.get(tag_id, f"GPSTag_{tag_id}")
                gps[tag_name] = _exif_val(value)
            result["GPS"] = gps

    except Exception:
        pass

    return result


def _exif_val(value: object) -> object:
    """Convert EXIF values to JSON-serializable types."""
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8", errors="replace").strip("\x00 ")
        except Exception:
            return f"<{len(value)} bytes>"
    if isinstance(value, (int, float, str, bool)):
        return value
    if isinstance(value, tuple):
        return [_exif_val(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _exif_val(v) for k, v in value.items()}
    return str(value)


@router.get("/{photo_id}/image")
def get_image(photo_id: int, db: Session = Depends(get_db)):
    photo = db.query(Photo).filter(Photo.id == photo_id).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    if not os.path.exists(photo.file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    ext = os.path.splitext(photo.file_path)[1].lower()
    if ext in (".heic", ".heif"):
        # Convert HEIC to JPEG for browser display
        from PIL import Image
        import io
        try:
            import pillow_heif
            pillow_heif.register_heif_opener()
        except ImportError:
            pass
        img = Image.open(photo.file_path)
        # Apply EXIF orientation
        from PIL import ExifTags
        try:
            exif = img.getexif()
            orientation = exif.get(
                next(t for t, n in ExifTags.TAGS.items() if n == "Orientation"), 1
            )
            rotations = {3: 180, 6: 270, 8: 90}
            if orientation in rotations:
                img = img.rotate(rotations[orientation], expand=True)
        except Exception:
            pass
        if img.mode != "RGB":
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=90)
        buf.seek(0)
        from fastapi.responses import StreamingResponse
        return StreamingResponse(buf, media_type="image/jpeg")

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


class UpdateNotes(BaseModel):
    notes: Optional[str] = None


@router.put("/{photo_id}/notes")
def update_notes(photo_id: int, data: UpdateNotes, db: Session = Depends(get_db)):
    photo = db.query(Photo).filter(Photo.id == photo_id).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    if data.notes and len(data.notes) > 250:
        raise HTTPException(status_code=400, detail="Notes must be 250 characters or fewer")
    photo.notes = data.notes
    db.commit()
    db.refresh(photo)
    return photo_to_dict(photo)


@router.get("/search/query")
def search_photos(
    q: str = Query(..., min_length=1),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """Search photos by notes, tags, location, filename, or person name."""
    from models import Face, Person
    term = f"%{q}%"

    # Find photo IDs matching person names
    person_photo_ids = (
        db.query(Face.photo_id)
        .join(Person, Face.person_id == Person.id)
        .filter(Person.name.ilike(term))
        .distinct()
        .subquery()
    )

    query = (
        db.query(Photo)
        .outerjoin(Trip, Photo.trip_id == Trip.id)
        .filter(
            (Photo.notes.ilike(term))
            | (Photo.tags.ilike(term))
            | (Photo.filename.ilike(term))
            | (Photo.camera_model.ilike(term))
            | (Trip.name.ilike(term))
            | (Photo.id.in_(person_photo_ids.select()))
        )
        .order_by(desc(Photo.date_taken))
    )

    total = query.count()
    photos = query.offset((page - 1) * per_page).limit(per_page).all()
    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page,
        "photos": [photo_to_dict(p) for p in photos],
    }


@router.get("/search/suggest")
def search_suggest(
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
):
    """Return autocomplete suggestions with counts for the search bar."""
    from models import Face, Person
    import json as _json
    term = q.lower()
    suggestions: list[dict] = []
    seen: set[str] = set()

    def _add(label: str, count: int, category: str):
        key = label.lower()
        if key not in seen:
            seen.add(key)
            suggestions.append({"label": label, "count": count, "category": category})

    # Location tags (stored as JSON arrays in photos.tags)
    tag_rows = db.query(Photo.tags).filter(Photo.tags.isnot(None)).all()
    tag_counts: dict[str, int] = {}
    for (tags_json,) in tag_rows:
        try:
            for tag in _json.loads(tags_json):
                if term in tag.lower():
                    tag_counts[tag] = tag_counts.get(tag, 0) + 1
        except Exception:
            pass
    for tag, count in sorted(tag_counts.items(), key=lambda x: -x[1])[:10]:
        _add(tag, count, "location")

    # Person names
    from sqlalchemy import func as sa_func
    person_rows = (
        db.query(Person.name, sa_func.count(Face.id).label("cnt"))
        .join(Face, Face.person_id == Person.id)
        .filter(Person.name.ilike(f"%{q}%"))
        .group_by(Person.id)
        .all()
    )
    for name, count in sorted(person_rows, key=lambda x: -x[1])[:10]:
        _add(name, count, "person")

    # Trip names
    trip_rows = (
        db.query(Trip.name, sa_func.count(Photo.id).label("cnt"))
        .join(Photo, Photo.trip_id == Trip.id)
        .filter(Trip.name.ilike(f"%{q}%"))
        .group_by(Trip.id)
        .all()
    )
    for name, count in sorted(trip_rows, key=lambda x: -x[1])[:10]:
        _add(name, count, "trip")

    # Sort by count descending, limit to 10
    suggestions.sort(key=lambda x: -x["count"])
    return suggestions[:10]


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
