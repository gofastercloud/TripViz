#!/usr/bin/env python3
"""Orchestrate a Windows TripViz installer build.

Steps:
1. Build the frontend (npm ci + npm run build).
2. Run PyInstaller against the lean or full spec.
3. Stage the PyInstaller output into tauri/src-tauri/resources/backend/.
4. Run `cargo tauri build --bundles nsis`.
5. Copy the final .exe to dist-installers/.

Designed to be run on Windows in CI, but the orchestration itself is
cross-platform for local smoke testing. On non-Windows hosts the final
`cargo tauri build` is skipped (NSIS is Windows-only), which lets devs
exercise steps 1-3 locally.
"""
from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = REPO_ROOT / "frontend"
TAURI_DIR = REPO_ROOT / "tauri" / "src-tauri"
STAGING_DIR = TAURI_DIR / "resources" / "backend"
INSTALLERS_DIR = REPO_ROOT / "dist-installers"
PYINSTALLER_OUT = REPO_ROOT / "dist" / "tripviz-backend"


def log(msg: str) -> None:
    print(f"[build_windows] {msg}", flush=True)


def run(cmd: list[str], *, cwd: Path, env: dict | None = None) -> None:
    log(f"$ {' '.join(cmd)}  (cwd={cwd})")
    result = subprocess.run(cmd, cwd=str(cwd), env=env)
    if result.returncode != 0:
        raise SystemExit(
            f"command failed ({result.returncode}): {' '.join(cmd)}"
        )


def ensure_clean_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def build_frontend() -> None:
    log("building frontend")
    npm = "npm.cmd" if os.name == "nt" else "npm"
    run([npm, "ci"], cwd=FRONTEND_DIR)
    run([npm, "run", "build"], cwd=FRONTEND_DIR)


def build_backend(variant: str) -> None:
    spec = REPO_ROOT / f"TripViz-{variant}.spec"
    if not spec.exists():
        raise SystemExit(f"spec not found: {spec}")
    log(f"building backend via PyInstaller ({spec.name})")
    run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--clean",
            "--noconfirm",
            str(spec),
        ],
        cwd=REPO_ROOT,
    )
    if not PYINSTALLER_OUT.is_dir():
        raise SystemExit(
            f"PyInstaller did not produce {PYINSTALLER_OUT}"
        )


def stage_backend_resources() -> None:
    log(f"staging backend into {STAGING_DIR}")
    # Preserve .gitkeep if present.
    keep = STAGING_DIR / ".gitkeep"
    keep_content = keep.read_bytes() if keep.exists() else None
    ensure_clean_dir(STAGING_DIR)
    if keep_content is not None:
        keep.write_bytes(keep_content)
    # Copytree (Python 3.8+) handles nested _internal/ automatically.
    for entry in PYINSTALLER_OUT.iterdir():
        dest = STAGING_DIR / entry.name
        if entry.is_dir():
            shutil.copytree(entry, dest)
        else:
            shutil.copy2(entry, dest)
            # Ensure the main binary stays executable on unix-ish hosts.
            if entry.name.startswith("tripviz-backend"):
                dest.chmod(dest.stat().st_mode | 0o111)


def build_tauri_installer() -> Path | None:
    if platform.system() != "Windows":
        log("(skipped on non-Windows) cargo tauri build --bundles nsis")
        return None
    log("running cargo tauri build --bundles nsis")
    run(
        ["cargo", "tauri", "build", "--bundles", "nsis"],
        cwd=TAURI_DIR,
    )
    nsis_dir = TAURI_DIR / "target" / "release" / "bundle" / "nsis"
    candidates = sorted(nsis_dir.glob("*-setup.exe")) + sorted(
        nsis_dir.glob("*Setup.exe")
    )
    if not candidates:
        raise SystemExit(f"no NSIS installer produced under {nsis_dir}")
    return candidates[-1]


def publish_installer(
    installer: Path | None, variant: str, arch: str
) -> None:
    if installer is None:
        return
    INSTALLERS_DIR.mkdir(parents=True, exist_ok=True)
    final = INSTALLERS_DIR / f"TripViz-{variant}-{arch}-Setup.exe"
    shutil.copy2(installer, final)
    log(f"installer -> {final}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a Windows TripViz installer")
    parser.add_argument("--variant", choices=["lean", "full"], required=True)
    parser.add_argument("--arch", choices=["x64", "arm64"], required=True)
    args = parser.parse_args()

    log(
        f"variant={args.variant} arch={args.arch} host={platform.system()} "
        f"python={sys.version.split()[0]}"
    )

    build_frontend()
    build_backend(args.variant)
    stage_backend_resources()
    installer = build_tauri_installer()
    publish_installer(installer, args.variant, args.arch)
    log("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
