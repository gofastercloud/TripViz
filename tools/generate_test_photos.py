#!/usr/bin/env python3
"""Generate synthetic photos with realistic EXIF (GPS + timestamps) for TripViz testing.

Produces visually distinct JPEGs grouped into hardcoded "trips" so the indexer,
Gallery, Map, and Trips views all have meaningful data on a fresh VM.
"""
from __future__ import annotations

import argparse
import random
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta
from fractions import Fraction
from pathlib import Path

import piexif
from PIL import Image, ImageDraw, ImageFont


@dataclass(frozen=True)
class Trip:
    name: str
    lat: float
    lon: float
    altitude_m: float
    start: datetime
    end: datetime
    weight: int  # rough share of total photos


TRIPS: list[Trip] = [
    Trip("London", 51.5074, -0.1278, 25.0,
         datetime(2024, 6, 15), datetime(2024, 6, 18), weight=15),
    Trip("Paris", 48.8566, 2.3522, 35.0,
         datetime(2024, 9, 10), datetime(2024, 9, 13), weight=20),
    Trip("Tokyo", 35.6762, 139.6503, 40.0,
         datetime(2025, 3, 20), datetime(2025, 3, 24), weight=15),
]

JITTER_DEG = 0.02
IMG_SIZE = (800, 600)
CAMERA_MAKE = "TripViz"
CAMERA_MODEL = "TestCam"


def _deg_to_dms_rational(deg: float) -> tuple[tuple[int, int], tuple[int, int], tuple[int, int]]:
    """Convert decimal degrees to EXIF-style ((d,1),(m,1),(s/100,100)) rationals."""
    deg = abs(deg)
    d = int(deg)
    m_float = (deg - d) * 60
    m = int(m_float)
    s = round((m_float - m) * 60 * 100)  # hundredths of a second for precision
    return ((d, 1), (m, 1), (s, 100))


def _altitude_rational(alt_m: float) -> tuple[int, int]:
    frac = Fraction(alt_m).limit_denominator(1000)
    return (frac.numerator, frac.denominator)


def _build_exif(lat: float, lon: float, alt_m: float, taken: datetime) -> bytes:
    date_str = taken.strftime("%Y:%m:%d %H:%M:%S").encode()
    zeroth = {
        piexif.ImageIFD.Make: CAMERA_MAKE.encode(),
        piexif.ImageIFD.Model: CAMERA_MODEL.encode(),
        piexif.ImageIFD.DateTime: date_str,
        piexif.ImageIFD.Software: b"generate_test_photos.py",
    }
    exif_ifd = {
        piexif.ExifIFD.DateTimeOriginal: date_str,
        piexif.ExifIFD.DateTimeDigitized: date_str,
    }
    gps_ifd = {
        piexif.GPSIFD.GPSVersionID: (2, 0, 0, 0),
        piexif.GPSIFD.GPSLatitudeRef: b"N" if lat >= 0 else b"S",
        piexif.GPSIFD.GPSLatitude: _deg_to_dms_rational(lat),
        piexif.GPSIFD.GPSLongitudeRef: b"E" if lon >= 0 else b"W",
        piexif.GPSIFD.GPSLongitude: _deg_to_dms_rational(lon),
        piexif.GPSIFD.GPSAltitudeRef: 0,
        piexif.GPSIFD.GPSAltitude: _altitude_rational(alt_m),
    }
    return piexif.dump({"0th": zeroth, "Exif": exif_ifd, "GPS": gps_ifd, "1st": {}, "thumbnail": None})


def _random_color(rng: random.Random) -> tuple[int, int, int]:
    return (rng.randint(30, 220), rng.randint(30, 220), rng.randint(30, 220))


def _draw_label(img: Image.Image, lines: list[str]) -> None:
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("Arial.ttf", 36)
    except OSError:
        font = ImageFont.load_default()
    y = 40
    for line in lines:
        draw.text((40, y), line, fill=(255, 255, 255), font=font,
                  stroke_width=2, stroke_fill=(0, 0, 0))
        y += 48


def _plan_photos(total: int) -> list[tuple[Trip, int, int]]:
    """Return [(trip, index_within_trip, photos_in_trip), ...] for `total` photos."""
    total_weight = sum(t.weight for t in TRIPS)
    assigned: list[int] = [max(1, round(total * t.weight / total_weight)) for t in TRIPS]
    # Fix rounding drift.
    while sum(assigned) < total:
        assigned[assigned.index(min(assigned))] += 1
    while sum(assigned) > total:
        assigned[assigned.index(max(assigned))] -= 1
    plan: list[tuple[Trip, int, int]] = []
    for trip, n in zip(TRIPS, assigned):
        for i in range(n):
            plan.append((trip, i, n))
    return plan


def _timestamp_for(trip: Trip, idx: int, count: int, rng: random.Random) -> datetime:
    """Spread `count` photos across trip days, daytime hours, chronologically."""
    span_days = max(1, (trip.end - trip.start).days + 1)
    # Distribute across days, then randomise within 08:00-20:00 for each photo.
    day_offset = (idx * span_days) // max(1, count)
    day = trip.start + timedelta(days=day_offset)
    # Chronological within the day: fraction * 12h window starting at 08:00.
    per_day = max(1, count // span_days)
    slot = idx % per_day
    minutes_into_day = int(8 * 60 + (slot + rng.random()) * (12 * 60 / per_day))
    return day.replace(hour=0, minute=0, second=0) + timedelta(minutes=minutes_into_day)


def generate(output: Path, count: int, seed: int) -> int:
    rng = random.Random(seed)
    output.mkdir(parents=True, exist_ok=True)
    plan = _plan_photos(count)
    # Sort chronologically per-trip so timestamps are monotonic.
    trip_times: dict[str, list[datetime]] = {}
    for trip, idx, n in plan:
        trip_times.setdefault(trip.name, []).append(_timestamp_for(trip, idx, n, rng))
    for times in trip_times.values():
        times.sort()
    trip_cursor: dict[str, int] = {t.name: 0 for t in TRIPS}

    written = 0
    for global_idx, (trip, idx, n) in enumerate(plan, start=1):
        taken = trip_times[trip.name][trip_cursor[trip.name]]
        trip_cursor[trip.name] += 1
        lat = trip.lat + rng.uniform(-JITTER_DEG, JITTER_DEG)
        lon = trip.lon + rng.uniform(-JITTER_DEG, JITTER_DEG)
        alt = trip.altitude_m + rng.uniform(-5, 15)

        img = Image.new("RGB", IMG_SIZE, _random_color(rng))
        _draw_label(img, [
            trip.name,
            taken.strftime("%Y-%m-%d %H:%M"),
            f"Photo {idx + 1} / {n}",
        ])

        exif_bytes = _build_exif(lat, lon, alt, taken)
        filename = f"{taken.strftime('%Y%m%d_%H%M%S')}_{trip.name.lower()}_{global_idx:03d}.jpg"
        img.save(output / filename, "JPEG", quality=85, exif=exif_bytes)
        written += 1
    return written


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Generate synthetic EXIF-tagged photos for TripViz.")
    p.add_argument("--output", required=True, type=Path, help="Target directory")
    p.add_argument("--count", type=int, default=50, help="Total photos to generate (default: 50)")
    p.add_argument("--seed", type=int, default=20240615, help="RNG seed for reproducible output")
    p.add_argument("--clean", action="store_true", help="Wipe --output before generating")
    p.add_argument("--yes", action="store_true", help="Skip --clean confirmation prompt")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    if args.clean and args.output.exists():
        if not args.yes:
            resp = input(f"Wipe {args.output}? [y/N] ").strip().lower()
            if resp != "y":
                print("Aborted.", file=sys.stderr)
                return 1
        shutil.rmtree(args.output)
    n = generate(args.output, args.count, args.seed)
    print(f"Generated {n} photos across {len(TRIPS)} trips at {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
