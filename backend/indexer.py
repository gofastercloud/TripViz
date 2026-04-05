import json
import os
import sqlite3
import threading
import time
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Optional

from PIL import Image, ExifTags, UnidentifiedImageError
from sqlalchemy.orm import Session

SUPPORTED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".webp",
    ".heic", ".heif",
    ".cr2", ".cr3", ".nef", ".arw", ".orf", ".rw2", ".dng",
}

_data_dir = os.environ.get("TRIPVIZ_DATA_DIR", os.path.dirname(__file__))
THUMBNAIL_DIR = os.path.join(_data_dir, "thumbnails")
THUMBNAIL_SIZE = (400, 400)

# Global indexing state
_index_state: dict = {
    "running": False,
    "total": 0,
    "processed": 0,
    "skipped": 0,
    "errors": 0,
    "current_file": "",
    "directory": "",
    "started_at": None,
    "finished_at": None,
}
_index_lock = threading.Lock()


def get_index_state() -> dict:
    with _index_lock:
        return dict(_index_state)


def _gps_to_decimal(coord, ref: str) -> Optional[float]:
    """Convert EXIF GPS rational tuple to decimal degrees."""
    try:
        d = float(coord[0])
        m = float(coord[1])
        s = float(coord[2])
        decimal = d + (m / 60.0) + (s / 3600.0)
        if ref in ("S", "W"):
            decimal = -decimal
        return decimal
    except Exception:
        return None


def extract_exif(file_path: str) -> dict:
    """Extract EXIF metadata from an image file."""
    result = {
        "date_taken": None,
        "latitude": None,
        "longitude": None,
        "width": None,
        "height": None,
        "camera_make": None,
        "camera_model": None,
        "lens_model": None,
        "orientation": 1,
    }

    try:
        img = Image.open(file_path)
        result["width"], result["height"] = img.size

        raw_exif = img.getexif()
        if not raw_exif:
            return result

        # Build tag name → value map (root IFD)
        tag_map = {}
        for tag_id, value in raw_exif.items():
            tag_name = ExifTags.TAGS.get(tag_id, str(tag_id))
            tag_map[tag_name] = value

        # Also pull in EXIF sub-IFD (where DateTimeOriginal usually lives)
        exif_ifd = raw_exif.get_ifd(0x8769)
        for tag_id, value in exif_ifd.items():
            tag_name = ExifTags.TAGS.get(tag_id, str(tag_id))
            if tag_name not in tag_map:
                tag_map[tag_name] = value

        # Date taken
        for date_field in ("DateTimeOriginal", "DateTimeDigitized", "DateTime"):
            if date_field in tag_map:
                try:
                    result["date_taken"] = datetime.strptime(
                        str(tag_map[date_field]), "%Y:%m:%d %H:%M:%S"
                    )
                    break
                except ValueError:
                    pass

        # Camera info
        result["camera_make"] = str(tag_map["Make"]).strip() if "Make" in tag_map else None
        result["camera_model"] = str(tag_map["Model"]).strip() if "Model" in tag_map else None
        result["lens_model"] = str(tag_map["LensModel"]).strip() if "LensModel" in tag_map else None
        result["orientation"] = int(tag_map.get("Orientation", 1))

        # GPS info
        gps_ifd_tag = next(
            (t for t, n in ExifTags.TAGS.items() if n == "GPSInfo"), None
        )
        if gps_ifd_tag and gps_ifd_tag in raw_exif:
            gps_data = raw_exif.get_ifd(gps_ifd_tag)
            gps_map = {ExifTags.GPSTAGS.get(k, k): v for k, v in gps_data.items()}

            if "GPSLatitude" in gps_map and "GPSLatitudeRef" in gps_map:
                result["latitude"] = _gps_to_decimal(
                    gps_map["GPSLatitude"], gps_map["GPSLatitudeRef"]
                )
            if "GPSLongitude" in gps_map and "GPSLongitudeRef" in gps_map:
                result["longitude"] = _gps_to_decimal(
                    gps_map["GPSLongitude"], gps_map["GPSLongitudeRef"]
                )

    except (UnidentifiedImageError, Exception):
        pass

    return result


def generate_thumbnail(photo_id: int, file_path: str) -> bool:
    """Generate a thumbnail for a photo. Returns True on success."""
    os.makedirs(THUMBNAIL_DIR, exist_ok=True)
    thumb_path = os.path.join(THUMBNAIL_DIR, f"{photo_id}.jpg")

    try:
        img = Image.open(file_path)

        # Apply EXIF orientation
        try:
            exif = img.getexif()
            orientation = exif.get(next(t for t, n in ExifTags.TAGS.items() if n == "Orientation"), 1)
            rotations = {3: 180, 6: 270, 8: 90}
            if orientation in rotations:
                img = img.rotate(rotations[orientation], expand=True)
        except Exception:
            pass

        img.thumbnail(THUMBNAIL_SIZE, Image.LANCZOS)

        # Convert to RGB for JPEG saving
        if img.mode in ("RGBA", "P", "LA"):
            background = Image.new("RGB", img.size, (255, 255, 255))
            if img.mode == "P":
                img = img.convert("RGBA")
            background.paste(img, mask=img.split()[-1] if img.mode in ("RGBA", "LA") else None)
            img = background
        elif img.mode != "RGB":
            img = img.convert("RGB")

        img.save(thumb_path, "JPEG", quality=85, optimize=True)
        return True
    except Exception:
        return False


_APPLE_PHOTOS_EPOCH = 978307200  # 2001-01-01 00:00:00 UTC


def _get_apple_photos_db(directory: str) -> Optional[str]:
    """If directory is inside an Apple Photos library, return path to Photos.sqlite."""
    parts = Path(directory).parts
    for i, part in enumerate(parts):
        if part.endswith(".photoslibrary"):
            lib_path = os.path.join(*parts[:i + 1]) if parts[0] != "/" else os.path.join("/", *parts[1:i + 1])
            db_path = os.path.join(lib_path, "database", "Photos.sqlite")
            if os.path.isfile(db_path):
                return db_path
    return None


def _load_apple_photos_dates(db_path: str) -> dict[str, datetime]:
    """Load filename → date_created mapping from Apple Photos database."""
    result = {}
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        cursor = conn.execute(
            "SELECT ZDIRECTORY || '/' || ZFILENAME, ZDATECREATED FROM ZASSET "
            "WHERE ZDATECREATED IS NOT NULL AND ZFILENAME IS NOT NULL"
        )
        for rel_path, timestamp in cursor:
            result[rel_path] = datetime.fromtimestamp(timestamp + _APPLE_PHOTOS_EPOCH)
        conn.close()
    except Exception:
        pass
    return result


# ── Geo-tagging (reverse geocode during import) ────────────────────

_geo_tag_cache: dict[tuple[float, float], list[str]] = {}
_geo_tag_lock = threading.Lock()
_NOMINATIM_HEADERS = {"User-Agent": "TripViz/1.0 (photo indexer)"}


def _nominatim_get(url: str) -> dict:
    req = urllib.request.Request(url, headers=_NOMINATIM_HEADERS)
    with urllib.request.urlopen(req, timeout=8) as resp:
        return json.loads(resp.read())


def geo_tag_location(lat: float, lon: float) -> list[str]:
    """Return location tags for a GPS coordinate: nearby cities + landmarks."""
    # Round to 2 decimal places (~1km) for cache efficiency
    cache_key = (round(lat, 2), round(lon, 2))
    with _geo_tag_lock:
        if cache_key in _geo_tag_cache:
            return _geo_tag_cache[cache_key]

    tags: list[str] = []
    try:
        # 1) Reverse geocode for address hierarchy
        data = _nominatim_get(
            f"https://nominatim.openstreetmap.org/reverse"
            f"?lat={lat}&lon={lon}&format=json&zoom=10&addressdetails=1"
        )
        addr = data.get("address", {})
        for key in ("village", "town", "city", "municipality", "county",
                     "state", "country"):
            val = addr.get(key)
            if val and val not in tags:
                tags.append(val)

        time.sleep(0.5)

        # 2) Nearby landmarks and notable places
        nearby = _nominatim_get(
            f"https://nominatim.openstreetmap.org/search"
            f"?q=landmark+OR+attraction+OR+park+OR+monument"
            f"&format=json&limit=5&bounded=1"
            f"&viewbox={lon-0.05},{lat+0.05},{lon+0.05},{lat-0.05}"
        )
        for place in nearby:
            name = place.get("display_name", "").split(",")[0].strip()
            if name and name not in tags and len(name) < 80:
                tags.append(name)

        time.sleep(0.5)
    except Exception:
        pass

    # Cap at reasonable number
    tags = tags[:10]

    with _geo_tag_lock:
        _geo_tag_cache[cache_key] = tags
    return tags


def count_images(directory: str) -> int:
    count = 0
    for root, _, files in os.walk(directory):
        for f in files:
            if Path(f).suffix.lower() in SUPPORTED_EXTENSIONS:
                count += 1
    return count


def run_indexing(directory: str, db: Session, force_reindex: bool = False):
    """Main indexing function — runs in a background thread."""
    from models import Photo

    with _index_lock:
        _index_state.update({
            "running": True,
            "total": 0,
            "processed": 0,
            "skipped": 0,
            "errors": 0,
            "current_file": "",
            "directory": directory,
            "started_at": datetime.utcnow().isoformat(),
            "finished_at": None,
        })

    try:
        total = count_images(directory)
        with _index_lock:
            _index_state["total"] = total

        # Pre-load Apple Photos dates if indexing inside a .photoslibrary
        apple_db = _get_apple_photos_db(directory)
        apple_dates = _load_apple_photos_dates(apple_db) if apple_db else {}
        originals_dir = os.path.join(os.path.dirname(os.path.dirname(apple_db)), "originals") if apple_db else None

        # Phase 1: Index all photos (EXIF + thumbnails, no geocoding)
        for root, _, files in os.walk(directory):
            for filename in files:
                if Path(filename).suffix.lower() not in SUPPORTED_EXTENSIONS:
                    continue

                file_path = os.path.join(root, filename)

                with _index_lock:
                    _index_state["current_file"] = file_path

                try:
                    # Check if already indexed
                    existing = db.query(Photo).filter(Photo.file_path == file_path).first()
                    if existing and not force_reindex:
                        with _index_lock:
                            _index_state["skipped"] += 1
                            _index_state["processed"] += 1
                        continue

                    file_size = os.path.getsize(file_path)
                    exif = extract_exif(file_path)

                    # Fall back to Apple Photos date, then file mtime
                    if not exif["date_taken"] and originals_dir:
                        rel = os.path.relpath(file_path, originals_dir)
                        exif["date_taken"] = apple_dates.get(rel)
                    if not exif["date_taken"]:
                        mtime = os.path.getmtime(file_path)
                        exif["date_taken"] = datetime.fromtimestamp(mtime)

                    if existing:
                        for key, val in exif.items():
                            setattr(existing, key, val)
                        existing.file_size = file_size
                        existing.filename = filename
                        photo = existing
                    else:
                        photo = Photo(
                            file_path=file_path,
                            filename=filename,
                            file_size=file_size,
                            **exif,
                        )
                        db.add(photo)
                        db.flush()

                    # Generate thumbnail
                    if not existing or force_reindex or not existing.has_thumbnail:
                        success = generate_thumbnail(photo.id, file_path)
                        photo.has_thumbnail = success

                    db.commit()

                    with _index_lock:
                        _index_state["processed"] += 1

                except Exception:
                    db.rollback()
                    with _index_lock:
                        _index_state["errors"] += 1
                        _index_state["processed"] += 1

        # Phase 2: Batch geo-tag all geotagged photos without tags
        with _index_lock:
            _index_state["current_file"] = "Geo-tagging locations..."

        untagged = (
            db.query(Photo.id, Photo.latitude, Photo.longitude)
            .filter(
                Photo.latitude.isnot(None),
                Photo.longitude.isnot(None),
                Photo.tags.is_(None),
            )
            .all()
        )

        # Group by rounded coordinates to minimise API calls
        coord_groups: dict[tuple[float, float], list[int]] = {}
        for photo_id, lat, lon in untagged:
            key = (round(lat, 2), round(lon, 2))
            coord_groups.setdefault(key, []).append(photo_id)

        for (lat, lon), photo_ids in coord_groups.items():
            try:
                tags_list = geo_tag_location(lat, lon)
                if tags_list:
                    tags_json = json.dumps(tags_list)
                    db.query(Photo).filter(Photo.id.in_(photo_ids)).update(
                        {"tags": tags_json}, synchronize_session=False
                    )
                    db.commit()
            except Exception:
                db.rollback()

    finally:
        with _index_lock:
            _index_state["running"] = False
            _index_state["finished_at"] = datetime.utcnow().isoformat()
        db.close()
