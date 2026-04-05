"""
Kit List: aggregate camera/phone/lens gear used across the photo library.
Derived entirely from EXIF data already in the database.
"""
import re
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from models import Photo

router = APIRouter(prefix="/api/kit", tags=["kit"])

# Phone model keywords — checked against the EXIF model string
_PHONE_KEYWORDS = {
    "iphone", "ipad", "galaxy", "pixel", "oneplus", "redmi", "poco",
    "mi ", "note ", "mate ", "nova ", "find ", "reno ", "realme",
    "moto ", "nothing phone", "sm-", "lg-", "htc",
}

# Known camera model prefixes / keywords
_CAMERA_KEYWORDS = {
    "eos", "dslr", "alpha", "ilce-", "dsc-", "slta-", "nex-",
    "zv-", "fx", "gfx", "x-t", "x-s", "x-h", "x-e", "x-pro",
    "lumix", "e-m", "e-p", "om-", "pen-", "d7", "d8", "d5", "d3",
    "z ", "z5", "z6", "z7", "z8", "z9", "zf",
    "a7", "a9", "a1", "a6", "rx1", "rx10", "rx100",
    "gr ", "gr3", "griii", "fp", "hero", "mavic", "osmo",
    "k-", "kp", "645",
}

# Manufacturers that only make cameras (never phones)
_CAMERA_ONLY_MAKES = {
    "canon", "nikon", "fujifilm", "olympus", "panasonic",
    "leica", "hasselblad", "pentax", "ricoh", "sigma", "phase one",
    "gopro", "dji", "insta360", "blackmagic",
}

# Manufacturers that only make phones
_PHONE_ONLY_MAKES = {
    "apple", "samsung", "google", "oneplus", "xiaomi", "huawei",
    "oppo", "vivo", "realme", "motorola", "nothing", "lg", "htc",
}


def _classify(make: str | None, model: str | None) -> str:
    """Classify a device as 'phone' or 'camera'."""
    make_lower = (make or "").lower().strip()
    model_lower = (model or "").lower().strip()
    combined = f"{make_lower} {model_lower}"

    # Check model keywords first — most reliable signal
    for kw in _CAMERA_KEYWORDS:
        if kw in model_lower:
            return "camera"
    for kw in _PHONE_KEYWORDS:
        if kw in combined:
            return "phone"

    # Then check manufacturer
    if make_lower in _CAMERA_ONLY_MAKES:
        return "camera"
    if make_lower in _PHONE_ONLY_MAKES:
        return "phone"

    # Sony is ambiguous — check model patterns
    if make_lower == "sony":
        # Sony cameras have model prefixes like ILCE-, DSC-, NEX-, ZV-, SLT-
        if any(model_lower.startswith(p) for p in ("ilce", "dsc", "nex", "slt", "zv-")):
            return "camera"
        # Sony phones: Xperia
        if "xperia" in model_lower:
            return "phone"
        return "camera"  # default Sony to camera

    return "camera"  # unknown make with EXIF = likely a camera


def _search_url(make: str | None, model: str | None) -> str:
    """Generate a DPReview/Google search URL for a device."""
    query = _display_name(make, model)
    return f"https://www.google.com/search?q={query.replace(' ', '+')}+camera+specs"


@router.get("")
def get_kit(db: Session = Depends(get_db)):
    """Return a breakdown of cameras, phones, and lenses in the library."""

    # Aggregate bodies by (make, model)
    body_rows = (
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

    for make, model, count in body_rows:
        device_type = _classify(make, model)
        entry = {
            "make": make,
            "model": model,
            "display_name": _display_name(make, model),
            "photo_count": count,
            "type": device_type,
            "search_url": _search_url(make, model),
        }
        if device_type == "phone":
            phones.append(entry)
        else:
            cameras.append(entry)

    # Aggregate lenses — collapse phone lenses to "Front Camera" / "Back Camera"
    lens_rows = (
        db.query(
            Photo.lens_model,
            func.count(Photo.id).label("photo_count"),
        )
        .filter(Photo.lens_model != None, Photo.lens_model != "")  # noqa: E711
        .group_by(Photo.lens_model)
        .order_by(func.count(Photo.id).desc())
        .all()
    )

    # Group phone lenses by device + front/back, infer brands for dedicated lenses
    collapsed: dict[str, dict] = {}
    for lens, count in lens_rows:
        display, search_url, raw = _collapse_phone_lens(lens)

        # For non-phone lenses, prepend inferred brand
        if display == lens:
            brand = _infer_lens_brand(lens)
            if brand and not lens.lower().startswith(brand.lower()):
                display = f"{brand} {lens}"

        if display in collapsed:
            collapsed[display]["photo_count"] += count
            collapsed[display]["raw_models"].append(raw)
        else:
            collapsed[display] = {
                "photo_count": count,
                "raw_models": [raw],
                "search_url": search_url,
            }

    lenses = sorted(
        [
            {
                "lens_model": v["raw_models"][0] if len(v["raw_models"]) == 1 else name,
                "display_name": name,
                "photo_count": v["photo_count"],
                "search_url": v["search_url"],
            }
            for name, v in collapsed.items()
        ],
        key=lambda x: -x["photo_count"],
    )

    # No-camera photos
    no_camera_count = (
        db.query(func.count(Photo.id))
        .filter(Photo.camera_make == None, Photo.camera_model == None)  # noqa: E711
        .scalar()
    )

    return {
        "cameras": cameras,
        "phones": phones,
        "lenses": lenses,
        "no_camera_info": no_camera_count,
        "total_devices": len(cameras) + len(phones),
    }


_PHONE_LENS_RE = re.compile(
    r"^(iPhone[\w\s()]+?|iPad[\w\s()]+?|Galaxy[\w\s]+?|Pixel[\w\s]+?)\s+"
    r"(front|back)\s+.*?(\d+\.?\d*mm\s+f/\d+\.?\d*)",
    re.IGNORECASE,
)


# Lens model prefix → manufacturer mapping
_LENS_BRAND_PATTERNS: list[tuple[str, str]] = [
    # Canon
    (r"^RF\d", "Canon"),
    (r"^EF\d", "Canon"),
    (r"^EF-[SM]", "Canon"),
    (r"^TS-E", "Canon"),
    (r"^MP-E", "Canon"),
    # Nikon
    (r"^NIKKOR\b", "Nikon"),
    (r"^AF-S\b", "Nikon"),
    (r"^AF-P\b", "Nikon"),
    (r"^AF Nikkor", "Nikon"),
    (r"^Z \d", "Nikon"),
    # Sony
    (r"^FE \d", "Sony"),
    (r"^E \d", "Sony"),
    (r"^SEL\d", "Sony"),
    (r"^DT \d", "Sony"),
    # Fujifilm
    (r"^XF\d", "Fujifilm"),
    (r"^XC\d", "Fujifilm"),
    (r"^GF\d", "Fujifilm"),
    # Sigma
    (r"\| Contemporary", "Sigma"),
    (r"\| Art", "Sigma"),
    (r"\| Sports", "Sigma"),
    # Tamron
    (r"^Di ", "Tamron"),
    (r"^Di[I ]+", "Tamron"),
    (r"\(Tamron\)", "Tamron"),
    # Panasonic / Lumix
    (r"^LUMIX\b", "Panasonic"),
    (r"^DG ", "Panasonic"),
    (r"^H-", "Panasonic"),
    # Olympus / OM System
    (r"^M\.Zuiko", "Olympus"),
    (r"^ZUIKO", "Olympus"),
    # Samyang / Rokinon
    (r"^Samyang\b", "Samyang"),
    (r"^Rokinon\b", "Rokinon"),
    # Tokina
    (r"^atx-", "Tokina"),
    (r"^AT-X", "Tokina"),
    # Voigtlander
    (r"^Nokton\b", "Voigtlander"),
    (r"^APO-LANTHAR", "Voigtlander"),
    # Leica
    (r"^Summilux\b", "Leica"),
    (r"^Summicron\b", "Leica"),
    (r"^Elmarit\b", "Leica"),
    (r"^Vario-Elmar", "Leica"),
    # Laowa
    (r"^Laowa\b", "Laowa"),
    # Viltrox
    (r"^Viltrox\b", "Viltrox"),
    # TTArtisan
    (r"^TTArtisan\b", "TTArtisan"),
    (r"^7Artisans\b", "7Artisans"),
]


def _infer_lens_brand(lens_model: str) -> str | None:
    """Infer the lens manufacturer from the model string."""
    for pattern, brand in _LENS_BRAND_PATTERNS:
        if re.search(pattern, lens_model, re.IGNORECASE):
            return brand
    return None


def _collapse_phone_lens(lens: str) -> tuple[str, str, str]:
    """Collapse phone lens names like 'iPhone 15 Pro back triple camera 6.765mm f/1.78'
    into 'iPhone 15 Pro — Back Camera'. Returns (display_name, search_url, raw_model)."""
    m = _PHONE_LENS_RE.match(lens)
    if m:
        device = m.group(1).strip()
        side = m.group(2).capitalize()
        display = f"{device} — {side} Camera"
        search_url = f"https://www.google.com/search?q={device.replace(' ', '+')}+camera+specs"
        return display, search_url, lens
    # Not a phone lens — keep as-is
    return lens, f"https://lens-db.com/system/all/?q={lens.replace(' ', '+')}", lens


def _display_name(make: str | None, model: str | None) -> str:
    """Build a clean display name, avoiding redundant repetition of make in model."""
    if not make and not model:
        return "Unknown"
    if not make:
        return model or "Unknown"
    if not model:
        return make
    if model.lower().startswith(make.lower()):
        return model
    return f"{make} {model}"
