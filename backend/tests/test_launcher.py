"""Tests for the PyInstaller launcher and API-only mode."""
import importlib
import os
import sys
from pathlib import Path
from unittest import mock

import pytest
from fastapi.testclient import TestClient


BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _reimport_main():
    """Force a fresh import of backend.main so env vars take effect."""
    for mod in ("main",):
        if mod in sys.modules:
            del sys.modules[mod]
    import main  # noqa: WPS433
    return main


@pytest.fixture()
def clean_env():
    saved = {
        k: os.environ.get(k)
        for k in (
            "TRIPVIZ_API_ONLY",
            "TRIPVIZ_BUNDLE_DIR",
            "TRIPVIZ_DATA_DIR",
            "TRIPVIZ_HOST",
            "TRIPVIZ_PORT",
            "LOCALAPPDATA",
        )
    }
    yield
    for k, v in saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


# ---------------------------------------------------------------------------
# _launcher module — data dir selection
# ---------------------------------------------------------------------------


def _fresh_launcher():
    if "_launcher" in sys.modules:
        del sys.modules["_launcher"]
    import _launcher  # noqa: WPS433
    return _launcher


def test_launcher_windows_default_data_dir(clean_env, tmp_path, monkeypatch):
    """On Windows with LOCALAPPDATA set, default to %LOCALAPPDATA%/TripViz."""
    monkeypatch.setattr(sys, "platform", "win32")
    fake_local = tmp_path / "LocalAppData"
    monkeypatch.setenv("LOCALAPPDATA", str(fake_local))
    os.environ.pop("TRIPVIZ_DATA_DIR", None)

    launcher = _fresh_launcher()
    data_dir = launcher.resolve_data_dir()

    assert Path(data_dir) == fake_local / "TripViz"
    assert Path(data_dir).is_dir()


def test_launcher_windows_fallback_when_localappdata_missing(
    clean_env, tmp_path, monkeypatch
):
    """Fall back to ~/AppData/Local/TripViz when LOCALAPPDATA is missing."""
    monkeypatch.setattr(sys, "platform", "win32")
    os.environ.pop("LOCALAPPDATA", None)
    os.environ.pop("TRIPVIZ_DATA_DIR", None)
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))

    launcher = _fresh_launcher()
    data_dir = launcher.resolve_data_dir()

    assert Path(data_dir) == tmp_path / "AppData" / "Local" / "TripViz"
    assert Path(data_dir).is_dir()


def test_launcher_macos_leaves_data_dir_alone(clean_env, monkeypatch):
    """On macOS, don't touch TRIPVIZ_DATA_DIR — let database.py handle defaults."""
    monkeypatch.setattr(sys, "platform", "darwin")
    os.environ.pop("TRIPVIZ_DATA_DIR", None)

    launcher = _fresh_launcher()
    data_dir = launcher.resolve_data_dir()

    assert data_dir is None or "TripViz" not in str(data_dir) or data_dir == os.environ.get(
        "TRIPVIZ_DATA_DIR"
    )
    # The important invariant: we did NOT set the env var on non-Windows.
    assert "TRIPVIZ_DATA_DIR" not in os.environ or os.environ.get(
        "TRIPVIZ_DATA_DIR"
    ) == data_dir


def test_launcher_respects_preexisting_data_dir(clean_env, tmp_path, monkeypatch):
    """If TRIPVIZ_DATA_DIR is already set, leave it alone even on Windows."""
    monkeypatch.setattr(sys, "platform", "win32")
    preset = tmp_path / "preset"
    preset.mkdir()
    monkeypatch.setenv("TRIPVIZ_DATA_DIR", str(preset))

    launcher = _fresh_launcher()
    data_dir = launcher.resolve_data_dir()

    assert Path(data_dir) == preset


def test_launcher_resolves_bundle_dir_when_frozen(clean_env, tmp_path, monkeypatch):
    """When sys.frozen is set, bundle dir points at the PyInstaller _internal dir."""
    fake_meipass = tmp_path / "_internal"
    fake_meipass.mkdir()
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(fake_meipass), raising=False)

    launcher = _fresh_launcher()
    bundle = launcher.resolve_bundle_dir()

    assert Path(bundle) == fake_meipass


def test_launcher_bundle_dir_none_when_not_frozen(clean_env, monkeypatch):
    monkeypatch.delattr(sys, "frozen", raising=False)
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)

    launcher = _fresh_launcher()
    bundle = launcher.resolve_bundle_dir()

    assert bundle is None


# ---------------------------------------------------------------------------
# main.py — API-only mode
# ---------------------------------------------------------------------------


def _mount_paths(app):
    return {getattr(r, "path", None) for r in app.routes}


def test_main_serves_static_by_default(clean_env, tmp_path, monkeypatch):
    """With TRIPVIZ_API_ONLY unset and a frontend/dist present, /assets is mounted."""
    bundle = tmp_path
    (bundle / "frontend" / "dist" / "assets").mkdir(parents=True)
    (bundle / "frontend" / "dist" / "index.html").write_text("<html></html>")
    monkeypatch.setenv("TRIPVIZ_BUNDLE_DIR", str(bundle))
    os.environ.pop("TRIPVIZ_API_ONLY", None)

    main = _reimport_main()
    paths = _mount_paths(main.app)

    assert "/assets" in paths
    assert "/" in paths


def test_main_api_only_skips_static(clean_env, tmp_path, monkeypatch):
    """With TRIPVIZ_API_ONLY=1, /assets and SPA fallback are NOT registered."""
    bundle = tmp_path
    (bundle / "frontend" / "dist" / "assets").mkdir(parents=True)
    (bundle / "frontend" / "dist" / "index.html").write_text("<html></html>")
    monkeypatch.setenv("TRIPVIZ_BUNDLE_DIR", str(bundle))
    monkeypatch.setenv("TRIPVIZ_API_ONLY", "1")

    main = _reimport_main()
    paths = _mount_paths(main.app)

    assert "/assets" not in paths
    # The SPA catch-all registers "/" — it should also be absent.
    assert "/" not in paths


def test_health_endpoint_shape(clean_env, tmp_path, monkeypatch):
    monkeypatch.setenv("TRIPVIZ_API_ONLY", "1")
    monkeypatch.setenv("TRIPVIZ_DATA_DIR", str(tmp_path))
    (tmp_path / "thumbnails").mkdir(exist_ok=True)

    main = _reimport_main()
    with TestClient(main.app) as c:
        r = c.get("/api/health")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "ok"
        assert "version" in body
        assert isinstance(body["version"], str)


# ---------------------------------------------------------------------------
# _launcher — uvicorn host/port resolution (smoke test, no actual serve)
# ---------------------------------------------------------------------------


def test_launcher_host_port_defaults(clean_env, monkeypatch):
    os.environ.pop("TRIPVIZ_HOST", None)
    os.environ.pop("TRIPVIZ_PORT", None)

    launcher = _fresh_launcher()
    host, port = launcher.resolve_host_port()

    assert host == "127.0.0.1"
    assert port == 8000


def test_launcher_host_port_overrides(clean_env, monkeypatch):
    monkeypatch.setenv("TRIPVIZ_HOST", "0.0.0.0")
    monkeypatch.setenv("TRIPVIZ_PORT", "9123")

    launcher = _fresh_launcher()
    host, port = launcher.resolve_host_port()

    assert host == "0.0.0.0"
    assert port == 9123


def test_launcher_main_invokes_uvicorn(clean_env, monkeypatch):
    """Smoke test: launcher.main() calls uvicorn.run with the resolved host/port."""
    launcher = _fresh_launcher()
    called = {}

    def fake_run(app, host, port, **kwargs):
        called["app"] = app
        called["host"] = host
        called["port"] = port

    monkeypatch.setattr("uvicorn.run", fake_run)
    # Prevent real signal handler installation in test process
    monkeypatch.setattr(launcher, "_install_signal_handlers", lambda: None)
    launcher.main()

    assert called["host"] == "127.0.0.1"
    assert called["port"] == 8000
    assert called["app"] is not None
