"""PyInstaller entry point for the TripViz backend.

Responsibilities:
- When frozen, point TRIPVIZ_BUNDLE_DIR at the PyInstaller _MEIPASS dir so
  main.py can locate the bundled frontend/dist.
- On Windows, default TRIPVIZ_DATA_DIR to %LOCALAPPDATA%/TripViz if unset.
- Configure file logging when frozen, stderr otherwise.
- Run the FastAPI app via uvicorn, honouring TRIPVIZ_HOST / TRIPVIZ_PORT.
- Handle SIGINT/SIGTERM cleanly for Tauri sidecar lifecycle.
"""
from __future__ import annotations

import logging
import os
import signal
import sys
from pathlib import Path
from typing import Optional, Tuple


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def resolve_bundle_dir() -> Optional[str]:
    """Return the PyInstaller bundle root (_MEIPASS) if frozen, else None."""
    if not is_frozen():
        return None
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return str(meipass)
    # Fallback: directory containing the executable
    return str(Path(sys.executable).resolve().parent)


def resolve_data_dir() -> Optional[str]:
    """Determine the persistent data dir and ensure it exists.

    - If TRIPVIZ_DATA_DIR is already set, return it untouched.
    - On Windows, default to %LOCALAPPDATA%/TripViz (or ~/AppData/Local/TripViz).
    - On other platforms, return None and let database.py apply its own default.
    """
    preset = os.environ.get("TRIPVIZ_DATA_DIR")
    if preset:
        Path(preset).mkdir(parents=True, exist_ok=True)
        return preset

    if sys.platform != "win32":
        return None

    local = os.environ.get("LOCALAPPDATA")
    if local:
        base = Path(local)
    else:
        base = Path.home() / "AppData" / "Local"

    data_dir = base / "TripViz"
    data_dir.mkdir(parents=True, exist_ok=True)
    return str(data_dir)


def resolve_host_port() -> Tuple[str, int]:
    host = os.environ.get("TRIPVIZ_HOST", "127.0.0.1")
    try:
        port = int(os.environ.get("TRIPVIZ_PORT", "8000"))
    except ValueError:
        port = 8000
    return host, port


def configure_logging(data_dir: Optional[str]) -> None:
    handlers: list[logging.Handler] = []
    if is_frozen() and data_dir:
        log_path = Path(data_dir) / "tripviz.log"
        try:
            handlers.append(logging.FileHandler(log_path, encoding="utf-8"))
        except OSError:
            handlers.append(logging.StreamHandler(sys.stderr))
    else:
        handlers.append(logging.StreamHandler(sys.stderr))

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=handlers,
        force=True,
    )


def _install_signal_handlers() -> None:
    def _graceful(signum, _frame):
        logging.getLogger("tripviz.launcher").info("Received signal %s, exiting", signum)
        # uvicorn installs its own handlers once running; this is a safety net
        # for signals arriving before uvicorn takes over.
        raise SystemExit(0)

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, _graceful)
        except (ValueError, OSError):
            # Not in main thread or unsupported on platform — skip.
            pass


def _prepare_environment() -> Tuple[Optional[str], Optional[str]]:
    bundle_dir = resolve_bundle_dir()
    if bundle_dir and not os.environ.get("TRIPVIZ_BUNDLE_DIR"):
        os.environ["TRIPVIZ_BUNDLE_DIR"] = bundle_dir

    data_dir = resolve_data_dir()
    if data_dir and not os.environ.get("TRIPVIZ_DATA_DIR"):
        os.environ["TRIPVIZ_DATA_DIR"] = data_dir

    # Make sure the bundled backend/ source is importable when frozen.
    if bundle_dir:
        backend_path = str(Path(bundle_dir) / "backend")
        if backend_path not in sys.path:
            sys.path.insert(0, backend_path)

    return bundle_dir, data_dir


def main() -> None:
    bundle_dir, data_dir = _prepare_environment()
    configure_logging(data_dir)
    _install_signal_handlers()

    log = logging.getLogger("tripviz.launcher")
    log.info("Starting TripViz backend (frozen=%s)", is_frozen())
    log.info("Bundle dir: %s", bundle_dir)
    log.info("Data dir: %s", data_dir or os.environ.get("TRIPVIZ_DATA_DIR") or "<default>")

    # Import after environment is prepared so main.py reads the right env vars.
    import uvicorn
    from main import app

    host, port = resolve_host_port()
    log.info("Listening on %s:%s", host, port)

    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
