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
    min_gps_pct: float = Query(25.0, ge=0, le=100, description="Minimum % of photos with GPS to qualify as a trip"),
    geocode: bool = Query(True, description="Reverse-geocode centroids (may be slow)"),
    db: Session = Depends(get_db),
):
    """
    Cluster all dated photos into trip candidates using time-gap analysis.
    Photos without GPS are included in clusters based on time proximity.
    """
    rows = (
        db.query(Photo.id, Photo.date_taken, Photo.latitude, Photo.longitude, Photo.trip_id, Photo.tags)
        .filter(Photo.date_taken.isnot(None))
        .order_by(asc(Photo.date_taken))
        .all()
    )

    if not rows:
        return {"trips": [], "total": 0}

    # ── Time-gap clustering ──────────────────────────────
    clusters: list[list] = []
    current: list = [rows[0]]

    for row in rows[1:]:
        gap = (row.date_taken - current[-1].date_taken).total_seconds()
        if gap > gap_hours * 3600:
            clusters.append(current)
            current = [row]
        else:
            current.append(row)
    clusters.append(current)

    # ── Build suggestions ────────────────────────────────
    suggestions = []
    for cluster in clusters:
        if len(cluster) < min_photos:
            continue

        gps_photos = [p for p in cluster if p.latitude is not None and p.longitude is not None]
        gps_pct = (len(gps_photos) / len(cluster)) * 100
        if gps_pct < min_gps_pct:
            continue
        dates = [p.date_taken for p in cluster]
        start_dt = min(dates)
        end_dt = max(dates)

        # GPS centroid
        centroid_lat = centroid_lon = None
        if gps_photos:
            centroid_lat = sum(p.latitude for p in gps_photos) / len(gps_photos)
            centroid_lon = sum(p.longitude for p in gps_photos) / len(gps_photos)

        # Derive location from stored photo tags (most common city/town)
        location_name = "Unknown location"
        tag_counts: dict[str, int] = {}
        for p in cluster:
            if p.tags:
                try:
                    for tag in json.loads(p.tags):
                        tag_counts[tag] = tag_counts.get(tag, 0) + 1
                except Exception:
                    pass

        if tag_counts:
            # Tags are ordered: city, county, state, country — pick the most
            # frequent tag that isn't a country (last in the list) for the city,
            # and the least frequent for the country context
            sorted_tags = sorted(tag_counts.items(), key=lambda x: -x[1])
            # Use the most common tag as the primary location
            primary = sorted_tags[0][0]
            # Find a broader context (country is usually the least specific / last tag)
            # Look for a different tag to use as context
            context = ""
            if len(sorted_tags) > 1:
                context = sorted_tags[-1][0]
            location_name = f"{primary}, {context}" if context and context != primary else primary

        # Fall back to live geocoding if no tags and geocode=true
        if location_name == "Unknown location" and geocode and centroid_lat is not None:
            location_name = reverse_geocode(centroid_lat, centroid_lon)

        # How many photos are already in a trip?
        already_assigned = sum(1 for p in cluster if p.trip_id is not None)
        existing_trip_ids = list({p.trip_id for p in cluster if p.trip_id})

        # Suggested name: "City Month Year"
        city = location_name.split(",")[0].strip() if location_name != "Unknown location" else ""
        suggested_name = f"{city} {start_dt.strftime('%b %Y')}".strip() or f"Trip {start_dt.strftime('%b %Y')}"

        # Duration
        duration_hours = (end_dt - start_dt).total_seconds() / 3600

        # Preview pins for map (up to 200 GPS points)
        preview_pins = [
            {"id": p.id, "lat": p.latitude, "lon": p.longitude}
            for p in gps_photos[:200]
        ]
        # Sample photo IDs for thumbnail preview (first 8)
        preview_photo_ids = [p.id for p in cluster[:8]]

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
            "preview_pins": preview_pins,
            "preview_photo_ids": preview_photo_ids,
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
