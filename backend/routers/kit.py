"""
Kit List: aggregate camera/phone/lens gear used across the photo library.
Derived entirely from EXIF data already in the database.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from models import Photo

router = APIRouter(prefix="/api/kit", tags=["kit"])

# Known phone manufacturers (lowercase match)
PHONE_MAKES = {
    "apple", "samsung", "google", "oneplus", "xiaomi", "huawei",
    "oppo", "vivo", "realme", "motorola", "sony", "nothing",
}
# Known camera manufacturers
CAMERA_MAKES = {
    "canon", "nikon", "sony", "fujifilm", "olympus", "panasonic",
    "leica", "hasselblad", "pentax", "ricoh", "sigma", "phase one",
    "gopro", "dji", "insta360",
}


def _classify(make: str | None, model: str | None) -> str:
    """Classify a device as 'phone', 'camera', or 'unknown'."""
    combined = f"{(make or '')} {(model or '')}".lower()
    make_lower = (make or "").lower().strip()
    if make_lower in PHONE_MAKES or any(p in combined for p in ("iphone", "galaxy", "pixel")):
        return "phone"
    if make_lower in CAMERA_MAKES or any(c in combined for c in ("eos", "nikon", "alpha", "lumix")):
        return "camera"
    # Fallback: if model contains phone indicators
    if any(x in combined for x in ("phone", "mobile", "sm-", "iphone", "pixel")):
        return "phone"
    return "camera"  # default to camera if make is present


@router.get("")
def get_kit(db: Session = Depends(get_db)):
    """
    Return a breakdown of cameras, phones, and unique lenses in the library.
    """
    # Aggregate by (make, model) with photo counts
    rows = (
        db.query(
            Photo.camera_make,
            Photo.camera_model,
            func.count(Photo.id).label("photo_count"),
        )
        .filter((Photo.camera_make != None) | (Photo.camera_model != None))  # noqa: E711
        .group_by(Photo.camera_make, Photo.camera_model)
        .order_by(func.count(Photo.id).desc())
        .all()
    )

    cameras = []
    phones = []

    for make, model, count in rows:
        device_type = _classify(make, model)
        entry = {
            "make": make,
            "model": model,
            "display_name": _display_name(make, model),
            "photo_count": count,
            "type": device_type,
        }
        if device_type == "phone":
            phones.append(entry)
        else:
            cameras.append(entry)

    # No-camera photos
    no_camera_count = (
        db.query(func.count(Photo.id))
        .filter(Photo.camera_make == None, Photo.camera_model == None)  # noqa: E711
        .scalar()
    )

    return {
        "cameras": cameras,
        "phones": phones,
        "no_camera_info": no_camera_count,
        "total_devices": len(cameras) + len(phones),
    }


def _display_name(make: str | None, model: str | None) -> str:
    """Build a clean display name, avoiding redundant repetition of make in model."""
    if not make and not model:
        return "Unknown"
    if not make:
        return model or "Unknown"
    if not model:
        return make
    # Avoid "Apple Apple iPhone 15" etc.
    if model.lower().startswith(make.lower()):
        return model
    return f"{make} {model}"
