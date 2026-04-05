"""Shared fixtures for TripViz tests."""
import os
import sys
import tempfile
import shutil
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

# Ensure backend modules are importable
sys.path.insert(0, str(Path(__file__).parent.parent))

from database import Base, get_db  # noqa: E402
from main import app  # noqa: E402


@pytest.fixture(scope="session")
def test_image_dir():
    """Create a temp directory with test images."""
    d = tempfile.mkdtemp(prefix="tripviz_test_images_")
    # Create a minimal valid JPEG (smallest possible)
    for i in range(5):
        _create_test_jpeg(os.path.join(d, f"test_{i}.jpg"), width=100 + i, height=80 + i)
    # Create a subdirectory with more images (tests recursive scanning)
    sub = os.path.join(d, "subdir")
    os.makedirs(sub)
    for i in range(3):
        _create_test_jpeg(os.path.join(sub, f"sub_{i}.jpg"), width=200, height=150)
    yield d
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture()
def db_session():
    """Create a fresh in-memory SQLite database for each test."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
    engine.dispose()


@pytest.fixture()
def client(db_session, tmp_path):
    """FastAPI test client with isolated database."""
    import database as db_module

    db_path = tmp_path / "test.db"
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    TestSession = sessionmaker(bind=engine)

    def _override_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override_db

    # Patch SessionLocal so background threads (indexer) also use the test DB
    original_session_local = db_module.SessionLocal
    db_module.SessionLocal = TestSession

    # Set data dir to tmp for thumbnails etc.
    os.environ["TRIPVIZ_DATA_DIR"] = str(tmp_path)
    os.makedirs(tmp_path / "thumbnails", exist_ok=True)

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()
    db_module.SessionLocal = original_session_local
    engine.dispose()


def _create_test_jpeg(path: str, width: int = 100, height: int = 80):
    """Create a minimal test JPEG with EXIF data."""
    from PIL import Image
    img = Image.new("RGB", (width, height), color=(100, 150, 200))
    img.save(path, "JPEG", quality=85)
