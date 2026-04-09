"""Tests for tools/generate_test_photos.py."""
from __future__ import annotations

import hashlib
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import piexif
import pytest
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "tools" / "generate_test_photos.py"

# Keep in sync with TRIPS in generate_test_photos.py.
EXPECTED_TRIPS = {
    "London": {
        "lat": 51.5074,
        "lon": -0.1278,
        "start": datetime(2024, 6, 15),
        "end": datetime(2024, 6, 18, 23, 59, 59),
    },
    "Paris": {
        "lat": 48.8566,
        "lon": 2.3522,
        "start": datetime(2024, 9, 10),
        "end": datetime(2024, 9, 13, 23, 59, 59),
    },
    "Tokyo": {
        "lat": 35.6762,
        "lon": 139.6503,
        "start": datetime(2025, 3, 20),
        "end": datetime(2025, 3, 24, 23, 59, 59),
    },
}


def _run(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        check=True,
        capture_output=True,
        text=True,
    )


def _rationals_to_deg(rationals, ref: bytes) -> float:
    d = rationals[0][0] / rationals[0][1]
    m = rationals[1][0] / rationals[1][1]
    s = rationals[2][0] / rationals[2][1]
    val = d + m / 60 + s / 3600
    if ref in (b"S", b"W"):
        val = -val
    return val


def _load_exif(path: Path) -> dict:
    img = Image.open(path)
    return piexif.load(img.info["exif"])


def _nearest_trip(lat: float, lon: float) -> str:
    return min(
        EXPECTED_TRIPS,
        key=lambda name: (EXPECTED_TRIPS[name]["lat"] - lat) ** 2
        + (EXPECTED_TRIPS[name]["lon"] - lon) ** 2,
    )


@pytest.fixture
def generated_dir(tmp_path: Path) -> Path:
    out = tmp_path / "photos"
    _run(["--output", str(out), "--count", "30", "--seed", "42"])
    return out


def test_generates_requested_count(generated_dir: Path) -> None:
    files = sorted(generated_dir.glob("*.jpg"))
    assert len(files) == 30


def test_gps_decodes_near_expected_location(generated_dir: Path) -> None:
    files = sorted(generated_dir.glob("*.jpg"))
    assert files
    for f in files[:5]:
        exif = _load_exif(f)
        gps = exif["GPS"]
        lat = _rationals_to_deg(
            gps[piexif.GPSIFD.GPSLatitude], gps[piexif.GPSIFD.GPSLatitudeRef]
        )
        lon = _rationals_to_deg(
            gps[piexif.GPSIFD.GPSLongitude], gps[piexif.GPSIFD.GPSLongitudeRef]
        )
        trip = _nearest_trip(lat, lon)
        assert abs(lat - EXPECTED_TRIPS[trip]["lat"]) < 0.1
        assert abs(lon - EXPECTED_TRIPS[trip]["lon"]) < 0.1
        assert piexif.GPSIFD.GPSAltitude in gps


def test_datetime_original_in_trip_range(generated_dir: Path) -> None:
    for f in sorted(generated_dir.glob("*.jpg")):
        exif = _load_exif(f)
        dt_raw = exif["Exif"][piexif.ExifIFD.DateTimeOriginal].decode()
        dt = datetime.strptime(dt_raw, "%Y:%m:%d %H:%M:%S")
        gps = exif["GPS"]
        lat = _rationals_to_deg(
            gps[piexif.GPSIFD.GPSLatitude], gps[piexif.GPSIFD.GPSLatitudeRef]
        )
        lon = _rationals_to_deg(
            gps[piexif.GPSIFD.GPSLongitude], gps[piexif.GPSIFD.GPSLongitudeRef]
        )
        trip = _nearest_trip(lat, lon)
        assert EXPECTED_TRIPS[trip]["start"] <= dt <= EXPECTED_TRIPS[trip]["end"]


def test_make_model_present(generated_dir: Path) -> None:
    exif = _load_exif(next(generated_dir.glob("*.jpg")))
    assert exif["0th"][piexif.ImageIFD.Make]
    assert exif["0th"][piexif.ImageIFD.Model]


def test_seed_reproducible(tmp_path: Path) -> None:
    out_a = tmp_path / "a"
    out_b = tmp_path / "b"
    _run(["--output", str(out_a), "--count", "10", "--seed", "123"])
    _run(["--output", str(out_b), "--count", "10", "--seed", "123"])
    files_a = sorted(f.name for f in out_a.glob("*.jpg"))
    files_b = sorted(f.name for f in out_b.glob("*.jpg"))
    assert files_a == files_b
    # GPS values must match exactly for a given seed.
    for name in files_a:
        ea = _load_exif(out_a / name)["GPS"]
        eb = _load_exif(out_b / name)["GPS"]
        assert ea[piexif.GPSIFD.GPSLatitude] == eb[piexif.GPSIFD.GPSLatitude]
        assert ea[piexif.GPSIFD.GPSLongitude] == eb[piexif.GPSIFD.GPSLongitude]


def test_clean_flag_wipes_dir(tmp_path: Path) -> None:
    out = tmp_path / "c"
    out.mkdir()
    (out / "stale.txt").write_text("remove me")
    _run(["--output", str(out), "--count", "5", "--clean", "--yes"])
    assert not (out / "stale.txt").exists()
    assert len(list(out.glob("*.jpg"))) == 5
