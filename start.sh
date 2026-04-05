#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
VENV_DIR="$BACKEND_DIR/venv"
PORT=8000

echo ""
echo " ============================================="
echo "   TripViz - Photo Viewer & Trip Manager"
echo " ============================================="
echo ""

# ---- Check Python ----
if ! command -v python3 &>/dev/null; then
    echo "[ERROR] python3 not found. Install Python 3.11+ and try again."
    exit 1
fi

# ---- Check Node ----
if ! command -v node &>/dev/null; then
    echo "[ERROR] node not found. Install Node.js 18+ from https://nodejs.org"
    exit 1
fi

# ---- Create venv ----
if [ ! -f "$VENV_DIR/bin/activate" ]; then
    echo "[Setup] Creating Python virtual environment..."
    python3 -m venv "$VENV_DIR"
fi

source "$VENV_DIR/bin/activate"

# ---- Install backend deps ----
echo "[Setup] Checking backend dependencies..."
pip install -q -r "$BACKEND_DIR/requirements.txt"

# ---- macOS: try to install pillow-heif for HEIC support ----
if [[ "$(uname)" == "Darwin" ]]; then
    if ! python3 -c "import pillow_heif" &>/dev/null 2>&1; then
        echo "[Setup] Installing pillow-heif for Apple HEIC/HEIF support..."
        pip install -q pillow-heif 2>/dev/null || echo "[Info] pillow-heif unavailable — HEIC files will be skipped."
    fi
fi

# ---- Build frontend (if needed) ----
if [ ! -f "$FRONTEND_DIR/dist/index.html" ]; then
    echo "[Setup] Installing frontend dependencies..."
    cd "$FRONTEND_DIR"
    npm install --silent
    echo "[Setup] Building frontend..."
    npm run build
    cd "$SCRIPT_DIR"
fi

# ---- Cleanup on exit ----
cleanup() {
    echo ""
    echo "[Stop] Shutting down TripViz..."
    kill "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ---- Start backend ----
echo "[Start] Starting TripViz server on http://127.0.0.1:$PORT ..."
cd "$BACKEND_DIR"
python main.py &
BACKEND_PID=$!
cd "$SCRIPT_DIR"

# ---- Wait for server ----
echo "[Wait] Waiting for server..."
for i in $(seq 1 30); do
    if curl -sf "http://127.0.0.1:$PORT/api/photos/stats/summary" >/dev/null 2>&1; then
        break
    fi
    sleep 0.5
done

# ---- Open browser ----
URL="http://127.0.0.1:$PORT"
echo "[Open] Opening $URL"
if [[ "$(uname)" == "Darwin" ]]; then
    open "$URL"
elif command -v xdg-open &>/dev/null; then
    xdg-open "$URL"
fi

echo ""
echo " TripViz is running at $URL"
echo " Press Ctrl+C to stop."
echo ""

wait "$BACKEND_PID"
