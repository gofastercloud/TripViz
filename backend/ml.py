"""
TripViz ML Engine
-----------------
Lazy-loaded ML features: face detection/recognition, activity tagging via CLIP.
All imports are deferred so the app starts cleanly without ML dependencies.

Install ML dependencies:
    pip install mediapipe scikit-learn          # face detection + clustering
    pip install transformers torch              # activity detection (CLIP)
    pip install pillow-heif                     # HEIC support (macOS)
"""

from __future__ import annotations

import io
import json
import os
import platform
import struct
import threading
import urllib.request
from pathlib import Path
from typing import Optional

# Where mediapipe .tflite models are stored
MODELS_DIR = Path(__file__).parent / "ml_models"
MODELS_DIR.mkdir(exist_ok=True)

MEDIAPIPE_MODELS = {
    "face_detector": (
        "blaze_face_short_range.tflite",
        "https://storage.googleapis.com/mediapipe-models/face_detector/"
        "blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
    ),
    "face_embedder": (
        "face_embedder.tflite",
        "https://storage.googleapis.com/mediapipe-models/face_embedder/"
        "face_embedder/float16/1/face_embedder.tflite",
    ),
}

# Activity labels for CLIP zero-shot classification
ACTIVITY_LABELS = [
    "beach or ocean",
    "mountains or hiking",
    "skiing or snowboarding",
    "camping or outdoors",
    "restaurant or dining",
    "wedding or formal event",
    "birthday or celebration party",
    "city sightseeing or tourism",
    "safari or wildlife",
    "water sports or surfing",
    "family gathering or reunion",
    "concert or music festival",
    "sporting event or game",
    "road trip or driving",
    "museum or art gallery",
    "sunrise or sunset landscape",
    "swimming pool",
    "portrait or selfie",
    "architecture or buildings",
    "food or cooking",
]

# Batch analysis state (in-memory, single job at a time)
_batch_state: dict = {
    "running": False,
    "task": "",
    "total": 0,
    "processed": 0,
    "errors": 0,
    "current": "",
    "started_at": None,
    "finished_at": None,
}
_batch_lock = threading.Lock()


# ──────────────────────────────────────────────────────────
#  Capability detection
# ──────────────────────────────────────────────────────────

def detect_capabilities() -> dict:
    caps: dict = {
        "platform": platform.system(),
        "arch": platform.machine(),
        "ram_gb": _get_ram_gb(),
        "cpu_count": os.cpu_count() or 1,
        "has_cuda": False,
        "has_mps": False,
        "mediapipe_available": False,
        "sklearn_available": False,
        "transformers_available": False,
        "torch_available": False,
        "face_models_downloaded": _check_face_models(),
        "face_detection_ready": False,
        "activity_detection_ready": False,
        "recommended_device": "cpu",
    }

    try:
        import mediapipe  # noqa: F401
        caps["mediapipe_available"] = True
    except ImportError:
        pass

    try:
        import sklearn  # noqa: F401
        caps["sklearn_available"] = True
    except ImportError:
        pass

    try:
        import torch
        caps["torch_available"] = True
        caps["has_cuda"] = torch.cuda.is_available()
        if platform.system() == "Darwin" and hasattr(torch.backends, "mps"):
            caps["has_mps"] = torch.backends.mps.is_available()
    except ImportError:
        pass

    try:
        import transformers  # noqa: F401
        caps["transformers_available"] = True
    except ImportError:
        pass

    # Recommended device
    if caps["has_mps"]:
        caps["recommended_device"] = "mps"
    elif caps["has_cuda"]:
        caps["recommended_device"] = "cuda"

    # Gate face detection: need mediapipe + sklearn + models
    caps["face_detection_ready"] = (
        caps["mediapipe_available"]
        and caps["sklearn_available"]
        and all(caps["face_models_downloaded"].values())
    )

    # Gate activity detection: need transformers + torch + ≥4 GB RAM
    caps["activity_detection_ready"] = (
        caps["transformers_available"]
        and caps["torch_available"]
        and caps["ram_gb"] >= 4.0
    )

    return caps


def _get_ram_gb() -> float:
    try:
        import psutil
        return round(psutil.virtual_memory().total / (1024 ** 3), 1)
    except ImportError:
        pass
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    return round(int(line.split()[1]) / (1024 ** 2), 1)
    except Exception:
        pass
    return 8.0  # safe default


def _check_face_models() -> dict[str, bool]:
    return {
        key: (MODELS_DIR / fname).exists()
        for key, (fname, _) in MEDIAPIPE_MODELS.items()
    }


# ──────────────────────────────────────────────────────────
#  Model download
# ──────────────────────────────────────────────────────────

def download_face_models(progress_cb=None) -> dict[str, bool]:
    """Download missing mediapipe model files. Returns status dict."""
    status: dict[str, bool] = {}
    for key, (fname, url) in MEDIAPIPE_MODELS.items():
        dest = MODELS_DIR / fname
        if dest.exists():
            status[key] = True
            continue
        try:
            if progress_cb:
                progress_cb(f"Downloading {fname}…")
            dest_tmp = dest.with_suffix(".tmp")
            urllib.request.urlretrieve(url, dest_tmp)
            dest_tmp.rename(dest)
            status[key] = True
        except Exception as e:
            status[key] = False
            if progress_cb:
                progress_cb(f"Failed to download {fname}: {e}")
    return status


# ──────────────────────────────────────────────────────────
#  Face detection + embedding
# ──────────────────────────────────────────────────────────

def _load_image_rgb(path: str):
    """Load image as RGB numpy array, handling orientation."""
    from PIL import Image, ExifTags
    import numpy as np

    img = Image.open(path)
    try:
        exif = img.getexif()
        orient_tag = next(t for t, n in ExifTags.TAGS.items() if n == "Orientation")
        orientation = exif.get(orient_tag, 1)
        rotations = {3: 180, 6: 270, 8: 90}
        if orientation in rotations:
            img = img.rotate(rotations[orientation], expand=True)
    except Exception:
        pass
    return np.array(img.convert("RGB"))


def detect_faces(image_path: str) -> list[dict]:
    """
    Detect faces in an image and return bounding boxes + embeddings.

    Returns list of:
        { bbox_x, bbox_y, bbox_w, bbox_h, confidence, embedding (bytes|None) }
    All bbox values are normalized to [0, 1].
    """
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python.vision import FaceDetector, FaceDetectorOptions, RunningMode

    detector_path = str(MODELS_DIR / MEDIAPIPE_MODELS["face_detector"][0])
    embedder_path = MODELS_DIR / MEDIAPIPE_MODELS["face_embedder"][0]

    base_opts = BaseOptions(model_asset_path=detector_path)
    det_opts = FaceDetectorOptions(base_options=base_opts, running_mode=RunningMode.IMAGE)

    rgb = _load_image_rgb(image_path)
    h, w = rgb.shape[:2]
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

    results = []
    with FaceDetector.create_from_options(det_opts) as detector:
        detection_result = detector.detect(mp_image)
        for det in detection_result.detections:
            bb = det.bounding_box
            # Clamp and normalize
            bx = max(0.0, bb.origin_x / w)
            by = max(0.0, bb.origin_y / h)
            bw = min(1.0 - bx, bb.width / w)
            bh = min(1.0 - by, bb.height / h)
            confidence = det.categories[0].score if det.categories else 1.0

            emb_bytes = _embed_face(rgb, w, h, bx, by, bw, bh, embedder_path)
            results.append({
                "bbox_x": bx, "bbox_y": by, "bbox_w": bw, "bbox_h": bh,
                "confidence": confidence,
                "embedding": emb_bytes,
            })

    return results


def _embed_face(rgb, img_w: int, img_h: int,
                bx: float, by: float, bw: float, bh: float,
                embedder_path: Path) -> Optional[bytes]:
    """Crop and embed a face using the mediapipe FaceEmbedder model."""
    if not embedder_path.exists():
        return None

    try:
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions
        from mediapipe.tasks.python.vision import ImageEmbedder, ImageEmbedderOptions, RunningMode

        # Add 20% padding around face for better embeddings
        pad = 0.20
        x1 = max(0, int((bx - bw * pad) * img_w))
        y1 = max(0, int((by - bh * pad) * img_h))
        x2 = min(img_w, int((bx + bw * (1 + pad)) * img_w))
        y2 = min(img_h, int((by + bh * (1 + pad)) * img_h))

        crop = rgb[y1:y2, x1:x2]
        if crop.size == 0:
            return None

        mp_crop = mp.Image(image_format=mp.ImageFormat.SRGB, data=crop)

        base_opts = BaseOptions(model_asset_path=str(embedder_path))
        emb_opts = ImageEmbedderOptions(
            base_options=base_opts,
            running_mode=RunningMode.IMAGE,
            l2_normalize=True,
            quantize=False,
        )
        with ImageEmbedder.create_from_options(emb_opts) as embedder:
            result = embedder.embed(mp_crop)
            floats = result.embeddings[0].embedding
            return struct.pack(f"{len(floats)}f", *floats)
    except Exception:
        return None


def embedding_to_array(blob: bytes):
    """Deserialize embedding bytes back to a numpy float32 array."""
    import numpy as np
    n = len(blob) // 4
    return np.array(struct.unpack(f"{n}f", blob), dtype=np.float32)


# ──────────────────────────────────────────────────────────
#  Activity detection via CLIP
# ──────────────────────────────────────────────────────────

_clip_model = None
_clip_processor = None
_clip_lock = threading.Lock()


def _get_clip(device: str):
    global _clip_model, _clip_processor
    with _clip_lock:
        if _clip_model is None:
            from transformers import CLIPModel, CLIPProcessor
            _clip_model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
            _clip_processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
        _clip_model = _clip_model.to(device)
    return _clip_model, _clip_processor


def classify_activities(image_path: str, device: str = "cpu") -> list[str]:
    """
    Return up to 3 activity labels for an image using CLIP zero-shot classification.
    Downloads the model (~340 MB) on first call (cached by HuggingFace).
    """
    import torch
    from PIL import Image

    model, processor = _get_clip(device)

    image = Image.open(image_path).convert("RGB")
    texts = [f"a photo of {label}" for label in ACTIVITY_LABELS]

    inputs = processor(text=texts, images=image, return_tensors="pt", padding=True)
    inputs = {k: v.to(device) for k, v in inputs.items()}

    with torch.no_grad():
        outputs = model(**inputs)
        probs = outputs.logits_per_image.softmax(dim=1)[0].cpu().tolist()

    # Return labels with >12% probability (max 3)
    scored = sorted(zip(ACTIVITY_LABELS, probs), key=lambda x: x[1], reverse=True)
    return [label for label, prob in scored[:3] if prob > 0.12]


# ──────────────────────────────────────────────────────────
#  Face clustering (DBSCAN → People)
# ──────────────────────────────────────────────────────────

def cluster_faces(db, threshold: float = 0.45) -> dict:
    """
    Cluster all face embeddings using DBSCAN and create/update Person records.
    Returns {"people_created": N, "faces_assigned": N, "noise": N}
    """
    import numpy as np
    from sklearn.cluster import DBSCAN
    from models import Face, Person
    from datetime import datetime

    # Load all faces with embeddings
    faces = db.query(Face).filter(Face.embedding != None).all()  # noqa: E711
    if len(faces) < 2:
        return {"people_created": 0, "faces_assigned": 0, "noise": len(faces)}

    embeddings = np.stack([embedding_to_array(f.embedding) for f in faces])

    # Normalize (should already be L2-normalized from mediapipe, but just in case)
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    embeddings = embeddings / np.maximum(norms, 1e-10)

    db_scan = DBSCAN(eps=threshold, min_samples=2, metric="cosine", n_jobs=-1)
    labels = db_scan.fit_predict(embeddings)

    # Map cluster_id → Person
    cluster_to_person: dict[int, int] = {}
    faces_assigned = 0
    noise = 0

    for face, label in zip(faces, labels):
        if label == -1:
            face.person_id = None
            noise += 1
            continue

        if label not in cluster_to_person:
            person = Person(name=f"Person {label + 1}", created_at=datetime.utcnow())
            db.add(person)
            db.flush()
            cluster_to_person[label] = person.id

        face.person_id = cluster_to_person[label]
        faces_assigned += 1

    db.commit()
    return {
        "people_created": len(cluster_to_person),
        "faces_assigned": faces_assigned,
        "noise": noise,
    }


# ──────────────────────────────────────────────────────────
#  Single photo analysis
# ──────────────────────────────────────────────────────────

def analyze_photo(
    photo_id: int,
    db,
    run_faces: bool = True,
    run_activities: bool = True,
    device: str = "cpu",
) -> dict:
    from models import Photo, Face

    photo = db.query(Photo).filter(Photo.id == photo_id).first()
    if not photo or not os.path.exists(photo.file_path):
        return {"error": "Photo not found"}

    result: dict = {"photo_id": photo_id, "faces": [], "activities": []}

    if run_faces:
        # Remove old face data for this photo
        db.query(Face).filter(Face.photo_id == photo_id).delete()
        faces = detect_faces(photo.file_path)
        for f in faces:
            face = Face(
                photo_id=photo_id,
                bbox_x=f["bbox_x"], bbox_y=f["bbox_y"],
                bbox_w=f["bbox_w"], bbox_h=f["bbox_h"],
                confidence=f["confidence"],
                embedding=f["embedding"],
            )
            db.add(face)
        photo.face_analyzed = True
        result["faces"] = [
            {"bbox_x": f["bbox_x"], "bbox_y": f["bbox_y"],
             "bbox_w": f["bbox_w"], "bbox_h": f["bbox_h"],
             "confidence": f["confidence"]}
            for f in faces
        ]

    if run_activities:
        activities = classify_activities(photo.file_path, device)
        photo.activities = json.dumps(activities)
        photo.activity_analyzed = True
        result["activities"] = activities

    db.commit()
    return result


# ──────────────────────────────────────────────────────────
#  Batch analysis (background thread)
# ──────────────────────────────────────────────────────────

def get_batch_state() -> dict:
    with _batch_lock:
        return dict(_batch_state)


def run_batch_analysis(
    photo_ids: list[int],
    run_faces: bool,
    run_activities: bool,
    device: str,
    db_factory,
):
    from datetime import datetime

    with _batch_lock:
        _batch_state.update({
            "running": True,
            "task": f"{'Faces' if run_faces else ''}{'+'if run_faces and run_activities else ''}{'Activities' if run_activities else ''}",
            "total": len(photo_ids),
            "processed": 0,
            "errors": 0,
            "current": "",
            "started_at": datetime.utcnow().isoformat(),
            "finished_at": None,
        })

    db = db_factory()
    try:
        for photo_id in photo_ids:
            with _batch_lock:
                _batch_state["current"] = f"Photo #{photo_id}"
            try:
                analyze_photo(photo_id, db, run_faces=run_faces,
                              run_activities=run_activities, device=device)
            except Exception:
                with _batch_lock:
                    _batch_state["errors"] += 1
            finally:
                with _batch_lock:
                    _batch_state["processed"] += 1

        # Auto-cluster faces after analysis
        if run_faces:
            try:
                with _batch_lock:
                    _batch_state["current"] = "Clustering faces…"
                cluster_faces(db)
            except Exception:
                pass
    finally:
        db.close()
        with _batch_lock:
            _batch_state["running"] = False
            _batch_state["finished_at"] = datetime.utcnow().isoformat()
