"""
Build script for TripViz standalone executable.

Usage:
    uv run python build_exe.py

Produces: dist/TripViz/ (directory bundle) or dist/TripViz.exe (single file)

Requirements:
    pip install pyinstaller
"""
import os
import subprocess
import sys
import shutil
from pathlib import Path

ROOT = Path(__file__).parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
DIST_DIR = FRONTEND / "dist"

def main():
    # 1. Ensure frontend is built
    if not (DIST_DIR / "index.html").exists():
        print("[Build] Frontend not built — building now...")
        subprocess.run(["npm", "run", "build"], cwd=str(FRONTEND), check=True)
    else:
        print("[Build] Frontend dist/ found")

    # 2. Install PyInstaller if needed
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        print("[Build] Installing PyInstaller...")
        subprocess.run([sys.executable, "-m", "pip", "install", "pyinstaller"], check=True)

    # 3. Create the launcher script that PyInstaller will bundle
    launcher = BACKEND / "_launcher.py"
    launcher.write_text('''\
"""TripViz standalone launcher — entry point for PyInstaller."""
import os
import sys
import webbrowser
import threading
import time

def get_data_dir():
    """Get platform-appropriate writable data directory."""
    if sys.platform == "win32":
        base = os.environ.get("APPDATA", os.path.expanduser("~"))
        return os.path.join(base, "TripViz")
    elif sys.platform == "darwin":
        return os.path.join(os.path.expanduser("~"), "Library", "Application Support", "TripViz")
    else:
        return os.path.join(os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share")), "tripviz")

def get_bundle_dir():
    """Get the directory where bundled files live."""
    if getattr(sys, "frozen", False):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))

def main():
    data_dir = get_data_dir()
    bundle_dir = get_bundle_dir()
    os.makedirs(data_dir, exist_ok=True)

    # Set environment for the app to find its data
    os.environ["TRIPVIZ_DATA_DIR"] = data_dir
    os.environ["TRIPVIZ_BUNDLE_DIR"] = bundle_dir

    # Change to backend dir so relative imports work
    backend_dir = os.path.join(bundle_dir, "backend")
    if os.path.isdir(backend_dir):
        os.chdir(backend_dir)
        if backend_dir not in sys.path:
            sys.path.insert(0, backend_dir)
    else:
        # Running from source
        os.chdir(os.path.dirname(os.path.abspath(__file__)))
        if os.getcwd() not in sys.path:
            sys.path.insert(0, os.getcwd())

    port = 8000
    url = f"http://127.0.0.1:{port}"

    print()
    print("  =============================================")
    print("   TripViz - Photo Viewer & Trip Manager")
    print("  =============================================")
    print()
    print(f"  Data directory: {data_dir}")
    print(f"  Starting server on {url} ...")
    print()

    # Open browser after a short delay
    def open_browser():
        time.sleep(2)
        webbrowser.open(url)

    threading.Thread(target=open_browser, daemon=True).start()

    # Register HEIC support
    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
    except ImportError:
        pass

    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=port, log_level="info")

if __name__ == "__main__":
    main()
''')

    # 4. Build the PyInstaller spec
    print("[Build] Running PyInstaller...")

    # Collect add-data args
    sep = ";" if sys.platform == "win32" else ":"

    add_data = [
        # Frontend dist
        f"{DIST_DIR}{sep}frontend/dist",
    ]

    # ML models if they exist
    ml_models = BACKEND / "ml_models"
    if ml_models.exists() and any(ml_models.iterdir()):
        add_data.append(f"{ml_models}{sep}backend/ml_models")

    # Backend Python files
    backend_files = list(BACKEND.glob("*.py")) + list((BACKEND / "routers").glob("*.py"))

    # Build hidden imports for all backend modules
    hidden_imports = [
        # Uvicorn internals
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        # FastAPI / Starlette
        "fastapi.middleware",
        "fastapi.middleware.cors",
        "fastapi.staticfiles",
        "fastapi.responses",
        "starlette.middleware",
        "starlette.middleware.cors",
        "starlette.staticfiles",
        "starlette.responses",
        "multipart",
        "multipart.multipart",
        # SQLAlchemy dialects
        "sqlalchemy.dialects.sqlite",
        # Backend modules
        "database",
        "models",
        "indexer",
        "ml",
        "routers",
        "routers.photos",
        "routers.trips",
        "routers.indexing",
        "routers.ml",
        "routers.kit",
        "routers.detect",
        "routers.editing",
        # PIL/Pillow
        "PIL",
        "PIL.Image",
        "PIL.ExifTags",
    ]

    # Exclude heavy ML deps to keep bundle small (~60MB vs ~650MB)
    excludes = [
        "torch", "torchvision", "torchaudio",
        "transformers", "tokenizers", "safetensors", "huggingface_hub",
        "mediapipe", "scikit-learn", "sklearn", "scipy",
        "matplotlib", "pandas", "numpy.testing",
        "IPython", "jupyter", "notebook",
        "tkinter", "test", "unittest",
    ]

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--name", "TripViz",
        "--noconfirm",
        "--clean",
        # Use directory mode for faster startup and easier debugging
        "--onedir",
        # Console mode so user can see logs
        "--console",
    ]

    for ex in excludes:
        cmd.extend(["--exclude-module", ex])

    for ad in add_data:
        cmd.extend(["--add-data", ad])

    # Add all backend .py files as data
    for f in backend_files:
        rel = f.relative_to(ROOT)
        dest = str(rel.parent)
        cmd.extend(["--add-data", f"{f}{sep}{dest}"])

    for hi in hidden_imports:
        cmd.extend(["--hidden-import", hi])

    cmd.append(str(launcher))

    print(f"[Build] Command: {' '.join(cmd[:6])}...")
    result = subprocess.run(cmd, cwd=str(ROOT))

    # Cleanup launcher
    launcher.unlink(missing_ok=True)

    if result.returncode == 0:
        print()
        print("  =============================================")
        print("   Build complete!")
        print(f"   Output: {ROOT / 'dist' / 'TripViz'}")
        print("  =============================================")
    else:
        print("[Build] PyInstaller failed!")
        sys.exit(1)


if __name__ == "__main__":
    main()
