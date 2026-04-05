"""
Trip Detection & Replay
-----------------------
/api/detect/trips        — suggest trips from time-gap clustering + reverse geocoding
/api/detect/replay/{id}  — ordered photo frames for replay, with GPS interpolation
"""
from __future__ import annotations

import json
import time
import threading
import urllib.request
from datetime import datetime
from math import radians, cos, sin, asin, sqrt
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import asc

from database import get_db
from models import Photo, Trip

router = APIRouter(prefix="/api/detect", tags=["detect"])

# ──────────────────────────────────────────────────────────
#  Geometry helpers
# ──────────────────────────────────────────────────────────

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 2 * R * asin(sqrt(a))


# ──────────────────────────────────────────────────────────
#  Reverse geocoding (Nominatim, rate-limited, cached)
# ──────────────────────────────────────────────────────────

_geo_cache: dict[tuple, str] = {}
_geo_lock = threading.Lock()


def reverse_geocode(lat: float, lon: float) -> str:
    key = (round(lat, 2), round(lon, 2))
    with _geo_lock:
        if key in _geo_cache:
            return _geo_cache[key]

    try:
        url = (
            f"https://nominatim.openstreetmap.org/reverse"
            f"?lat={lat}&lon={lon}&format=json&zoom=10"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "TripViz/1.0"})
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read())

        addr = data.get("address", {})
        # Pick the most meaningful locality level
        name_part = next(
            (addr[k] for k in ("city", "town", "village", "municipality", "county") if k in addr),
            None,
        )
        country = addr.get("country", "")
        name = ", ".join(filter(None, [name_part, country])) or data.get("display_name", "Unknown")
        time.sleep(0.6)  # Nominatim TOS: max ~1 req/s
    except Exception:
        name = "Unknown location"

    with _geo_lock:
        _geo_cache[key] = name
    return name


# ──────────────────────────────────────────────────────────
#  GPS interpolation
# ──────────────────────────────────────────────────────────

def _interpolate_position(
    idx: int,
    photos: list,
    gps_indices: list[int],
    window_secs: float,
) -> tuple[Optional[float], Optional[float], bool]:
    """
    For a non-GPS photo at `idx`, find the nearest GPS photos before/after
    and linearly interpolate if both are within `window_secs`.
    Returns (lat, lon, is_interpolated).
    """
    if not gps_indices:
        return None, None, False

    photo = photos[idx]
    t0 = photo.date_taken

    # Nearest before / after
    prev_i = next((i for i in reversed(gps_indices) if i < idx), None)
    next_i = next((i for i in gps_indices if i > idx), None)

    def _secs(a, b) -> float:
        return abs((photos[a].date_taken - photos[b].date_taken).total_seconds())

    if prev_i is not None and next_i is not None:
        dt_prev = (t0 - photos[prev_i].date_taken).total_seconds()
        dt_next = (photos[next_i].date_taken - t0).total_seconds()
        if dt_prev <= window_secs and dt_next <= window_secs:
            total = dt_prev + dt_next
            t = dt_prev / total if total > 0 else 0.5
            lat = photos[prev_i].latitude + t * (photos[next_i].latitude - photos[prev_i].latitude)
            lon = photos[prev_i].longitude + t * (photos[next_i].longitude - photos[prev_i].longitude)
            return lat, lon, True

    if prev_i is not None and _secs(prev_i, idx) <= window_secs:
        return photos[prev_i].latitude, photos[prev_i].longitude, True

    if next_i is not None and _secs(next_i, idx) <= window_secs:
        return photos[next_i].latitude, photos[next_i].longitude, True

    return None, None, False


# ──────────────────────────────────────────────────────────
#  Trip detection
# ──────────────────────────────────────────────────────────

@router.get("/trips")
def detect_trips(
    gap_hours: float = Query(6.0, ge=1.0, le=48.0, description="Hours of inactivity that splits trips"),
    min_photos: int = Query(3, ge=1),
    geocode: bool = Query(True, description="Reverse-geocode centroids (may be slow)"),
    db: Session = Depends(get_db),
):
    """
    Cluster all dated photos into trip candidates using time-gap analysis.
    Photos without GPS are included in clusters based on time proximity.
    """
    photos = (
        db.query(Photo)
        .filter(Photo.date_taken.isnot(None))
        .order_by(asc(Photo.date_taken))
        .all()
    )

    if not photos:
        return {"trips": [], "total": 0}

    # ── Time-gap clustering ──────────────────────────────
    clusters: list[list[Photo]] = []
    current: list[Photo] = [photos[0]]

    for photo in photos[1:]:
        gap = (photo.date_taken - current[-1].date_taken).total_seconds()
        if gap > gap_hours * 3600:
            clusters.append(current)
            current = [photo]
        else:
            current.append(photo)
    clusters.append(current)

    # ── Build suggestions ────────────────────────────────
    suggestions = []
    for cluster in clusters:
        if len(cluster) < min_photos:
            continue

        gps_photos = [p for p in cluster if p.latitude is not None and p.longitude is not None]
        dates = [p.date_taken for p in cluster]
        start_dt = min(dates)
        end_dt = max(dates)

        # GPS centroid
        centroid_lat = centroid_lon = None
        if gps_photos:
            centroid_lat = sum(p.latitude for p in gps_photos) / len(gps_photos)
            centroid_lon = sum(p.longitude for p in gps_photos) / len(gps_photos)

        # Reverse geocode
        location_name = "Unknown location"
        if geocode and centroid_lat is not None:
            location_name = reverse_geocode(centroid_lat, centroid_lon)

        # How many photos are already in a trip?
        already_assigned = sum(1 for p in cluster if p.trip_id is not None)
        existing_trip_ids = list({p.trip_id for p in cluster if p.trip_id})

        # Suggested name: "City Month Year"
        city = location_name.split(",")[0].strip() if location_name != "Unknown location" else ""
        suggested_name = f"{city} {start_dt.strftime('%b %Y')}".strip() or f"Trip {start_dt.strftime('%b %Y')}"

        # Duration
        duration_hours = (end_dt - start_dt).total_seconds() / 3600

        suggestions.append({
            "cluster_id": len(suggestions),
            "suggested_name": suggested_name,
            "location_name": location_name,
            "start_date": start_dt.isoformat(),
            "end_date": end_dt.isoformat(),
            "duration_hours": round(duration_hours, 1),
            "photo_count": len(cluster),
            "gps_count": len(gps_photos),
            "no_gps_count": len(cluster) - len(gps_photos),
            "centroid_lat": centroid_lat,
            "centroid_lon": centroid_lon,
            "already_assigned": already_assigned,
            "existing_trip_ids": existing_trip_ids,
            "photo_ids": [p.id for p in cluster],
        })

    return {"trips": suggestions, "total": len(suggestions)}


# ──────────────────────────────────────────────────────────
#  Trip replay data
# ──────────────────────────────────────────────────────────

@router.get("/replay/{trip_id}")
def trip_replay(
    trip_id: int,
    interpolation_window_hours: float = Query(2.0, ge=0.0),
    db: Session = Depends(get_db),
):
    """
    Return ordered photo frames for animated replay.
    Non-GPS photos near GPS shots get interpolated positions.
    """
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    photos = (
        db.query(Photo)
        .filter(Photo.trip_id == trip_id, Photo.date_taken.isnot(None))
        .order_by(asc(Photo.date_taken))
        .all()
    )

    if not photos:
        return {
            "trip": {"id": trip.id, "name": trip.name, "color": trip.color},
            "frames": [],
            "stats": {"total": 0, "gps": 0, "interpolated": 0, "no_location": 0},
        }

    window_secs = interpolation_window_hours * 3600
    gps_indices = [i for i, p in enumerate(photos) if p.latitude is not None]

    frames = []
    for i, photo in enumerate(photos):
        if photo.latitude is not None:
            lat, lon, interp = photo.latitude, photo.longitude, False
        else:
            lat, lon, interp = _interpolate_position(i, photos, gps_indices, window_secs)

        frames.append({
            "photo_id": photo.id,
            "filename": photo.filename,
            "timestamp": photo.date_taken.isoformat(),
            "lat": lat,
            "lon": lon,
            "has_gps": photo.latitude is not None,
            "is_interpolated": interp,
            "trip_color": trip.color,
        })

    stats = {
        "total": len(frames),
        "gps": sum(1 for f in frames if f["has_gps"]),
        "interpolated": sum(1 for f in frames if f["is_interpolated"]),
        "no_location": sum(1 for f in frames if f["lat"] is None),
    }

    # Build the GPS path (only confirmed + interpolated points, in order)
    path = [
        {"lat": f["lat"], "lon": f["lon"], "is_interpolated": f["is_interpolated"]}
        for f in frames if f["lat"] is not None
    ]

    return {
        "trip": {"id": trip.id, "name": trip.name, "color": trip.color},
        "frames": frames,
        "path": path,
        "stats": stats,
    }
