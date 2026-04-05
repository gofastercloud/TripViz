import os
import io
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Literal
from PIL import Image, ImageEnhance, ImageStat, ImageOps

from database import get_db
from models import Photo

router = APIRouter(prefix="/api/photos", tags=["editing"])

EDITED_DIR = os.path.join(os.path.dirname(__file__), "..", "edited_versions")

ORIENTATION_TAG = 274  # EXIF Orientation tag


class EditParams(BaseModel):
    white_balance: Literal["auto", "none"] = "none"
    temperature: int = 0        # -100 (cool) to +100 (warm)
    filter: Literal["none", "vivid", "muted", "warm", "cool", "bw", "vintage"] = "none"
    brightness: int = 0         # -100 to +100
    contrast: int = 0           # -100 to +100
    saturation: int = 0         # -100 to +100


class SaveParams(EditParams):
    save_mode: Literal["export", "version"] = "export"


def _fix_orientation(img: Image.Image) -> Image.Image:
    try:
        exif = img.getexif()
        orientation = exif.get(ORIENTATION_TAG)
        if orientation == 3:
            img = img.rotate(180, expand=True)
        elif orientation == 6:
            img = img.rotate(270, expand=True)
        elif orientation == 8:
            img = img.rotate(90, expand=True)
    except Exception:
        pass
    return img


def _make_lut(factor: float, offset: int = 0) -> list[int]:
    return [min(255, max(0, int(i * factor + offset))) for i in range(256)]


def apply_edits(img: Image.Image, params: EditParams) -> Image.Image:
    if img.mode != "RGB":
        img = img.convert("RGB")

    # 1. Auto white balance (gray world assumption)
    if params.white_balance == "auto":
        stat = ImageStat.Stat(img)
        r_mean, g_mean, b_mean = stat.mean[0], stat.mean[1], stat.mean[2]
        gray = (r_mean + g_mean + b_mean) / 3
        r_f = gray / r_mean if r_mean > 0 else 1.0
        g_f = gray / g_mean if g_mean > 0 else 1.0
        b_f = gray / b_mean if b_mean > 0 else 1.0
        r, g, b = img.split()
        img = Image.merge("RGB", (
            r.point(_make_lut(r_f)),
            g.point(_make_lut(g_f)),
            b.point(_make_lut(b_f)),
        ))

    # 2. Temperature (independent of filter — stacks on top)
    if params.temperature != 0:
        t = params.temperature / 100.0  # -1 to +1
        r, g, b = img.split()
        if t > 0:   # warmer: boost R, reduce B
            r = r.point(_make_lut(1.0 + 0.25 * t))
            b = b.point(_make_lut(1.0 - 0.20 * t))
        else:       # cooler: boost B, reduce R
            r = r.point(_make_lut(1.0 + 0.25 * t))   # t is negative → shrinks R
            b = b.point(_make_lut(1.0 - 0.20 * t))   # t is negative → boosts B
        img = Image.merge("RGB", (r, g, b))

    # 3. Preset filters
    f = params.filter
    if f == "vivid":
        img = ImageEnhance.Color(img).enhance(1.5)
        img = ImageEnhance.Contrast(img).enhance(1.15)
    elif f == "muted":
        img = ImageEnhance.Color(img).enhance(0.5)
        img = ImageEnhance.Contrast(img).enhance(0.88)
        img = ImageEnhance.Brightness(img).enhance(1.06)
    elif f == "warm":
        r, g, b = img.split()
        img = Image.merge("RGB", (
            r.point(_make_lut(1.10, 8)),
            g,
            b.point(_make_lut(0.88)),
        ))
        img = ImageEnhance.Color(img).enhance(1.1)
    elif f == "cool":
        r, g, b = img.split()
        img = Image.merge("RGB", (
            r.point(_make_lut(0.88)),
            g,
            b.point(_make_lut(1.10, 8)),
        ))
        img = ImageEnhance.Color(img).enhance(1.05)
    elif f == "bw":
        img = ImageOps.grayscale(img).convert("RGB")
        img = ImageEnhance.Contrast(img).enhance(1.1)
    elif f == "vintage":
        img = ImageOps.grayscale(img).convert("RGB")
        r, g, b = img.split()
        img = Image.merge("RGB", (
            r.point(_make_lut(1.08)),
            g.point(_make_lut(0.94)),
            b.point(_make_lut(0.78)),
        ))
        img = ImageEnhance.Contrast(img).enhance(0.82)
        img = ImageEnhance.Brightness(img).enhance(1.06)

    # 4. Manual fine-tune adjustments
    if params.brightness != 0:
        factor = 1.0 + params.brightness / 100.0 * (2.0 if params.brightness > 0 else 1.0)
        img = ImageEnhance.Brightness(img).enhance(max(0.0, factor))

    if params.contrast != 0:
        factor = 1.0 + params.contrast / 100.0 * (2.0 if params.contrast > 0 else 1.0)
        img = ImageEnhance.Contrast(img).enhance(max(0.0, factor))

    if params.saturation != 0:
        factor = 1.0 + params.saturation / 100.0 * (2.0 if params.saturation > 0 else 1.0)
        img = ImageEnhance.Color(img).enhance(max(0.0, factor))

    return img


def _load_photo_image(file_path: str, max_size: int | None = None) -> Image.Image:
    img = Image.open(file_path)
    img = _fix_orientation(img)
    if max_size:
        w, h = img.size
        if max(w, h) > max_size:
            scale = max_size / max(w, h)
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    return img


@router.post("/{photo_id}/edit/preview")
def edit_preview(photo_id: int, params: EditParams, db: Session = Depends(get_db)):
    photo = db.query(Photo).filter(Photo.id == photo_id).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    if not os.path.exists(photo.file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    img = _load_photo_image(photo.file_path, max_size=1200)
    img = apply_edits(img, params)

    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85, optimize=True)
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/jpeg")


@router.post("/{photo_id}/edit/save")
def edit_save(photo_id: int, params: SaveParams, db: Session = Depends(get_db)):
    photo = db.query(Photo).filter(Photo.id == photo_id).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    if not os.path.exists(photo.file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    img = _load_photo_image(photo.file_path)
    img = apply_edits(img, params)

    base = os.path.splitext(photo.filename)[0]

    if params.save_mode == "export":
        orig_dir = os.path.dirname(photo.file_path)
        out_path = os.path.join(orig_dir, f"{base}_edited.jpg")
        n = 1
        while os.path.exists(out_path):
            out_path = os.path.join(orig_dir, f"{base}_edited_{n}.jpg")
            n += 1
    else:
        os.makedirs(EDITED_DIR, exist_ok=True)
        out_path = os.path.join(EDITED_DIR, f"{photo_id}_v1.jpg")
        n = 1
        while os.path.exists(out_path):
            n += 1
            out_path = os.path.join(EDITED_DIR, f"{photo_id}_v{n}.jpg")

    img.save(out_path, "JPEG", quality=92, optimize=True)
    return {"saved_to": out_path, "filename": os.path.basename(out_path)}
