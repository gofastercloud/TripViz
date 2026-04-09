# -*- mode: python ; coding: utf-8 -*-
# TripViz lean PyInstaller spec.
# Excludes torch / transformers / mediapipe for a small cross-platform build.
# Used for: macOS dev builds and the ARM64 Windows installer.
#
# Output: dist/tripviz-backend/tripviz-backend[.exe]
import os

ROOT = os.path.abspath(os.path.dirname(SPEC))
BACKEND = os.path.join(ROOT, 'backend')
FRONTEND_DIST = os.path.join(ROOT, 'frontend', 'dist')
ML_MODELS = os.path.join(BACKEND, 'ml_models')

datas = []
if os.path.isdir(FRONTEND_DIST):
    datas.append((FRONTEND_DIST, 'frontend/dist'))
if os.path.isdir(ML_MODELS):
    datas.append((ML_MODELS, 'backend/ml_models'))

# Bundle backend source files so they can be imported by name at runtime.
for fname in ('models.py', 'database.py', '_launcher.py', 'ml.py',
              'indexer.py', 'main.py'):
    fpath = os.path.join(BACKEND, fname)
    if os.path.isfile(fpath):
        datas.append((fpath, 'backend'))

routers_dir = os.path.join(BACKEND, 'routers')
if os.path.isdir(routers_dir):
    for fname in os.listdir(routers_dir):
        if fname.endswith('.py'):
            datas.append((os.path.join(routers_dir, fname), 'backend/routers'))

hiddenimports = [
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'fastapi.middleware',
    'fastapi.middleware.cors',
    'fastapi.staticfiles',
    'fastapi.responses',
    'starlette.middleware',
    'starlette.middleware.cors',
    'starlette.staticfiles',
    'starlette.responses',
    'multipart',
    'multipart.multipart',
    'sqlalchemy.dialects.sqlite',
    'database',
    'models',
    'indexer',
    'ml',
    'routers',
    'routers.photos',
    'routers.trips',
    'routers.indexing',
    'routers.ml',
    'routers.kit',
    'routers.detect',
    'routers.editing',
    'PIL',
    'PIL.Image',
    'PIL.ExifTags',
]

excludes = [
    'torch', 'torchvision', 'torchaudio',
    'transformers', 'tokenizers', 'safetensors', 'huggingface_hub',
    'mediapipe',
    'scikit-learn', 'sklearn', 'scipy',
    'matplotlib', 'pandas',
    'numpy.testing',
    'IPython', 'jupyter', 'notebook',
    'tkinter', 'test', 'unittest',
]

a = Analysis(
    [os.path.join(BACKEND, '_launcher.py')],
    pathex=[BACKEND],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='tripviz-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='tripviz-backend',
)
