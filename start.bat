@echo off
setlocal enabledelayedexpansion
title TripViz

echo.
echo  =============================================
echo    TripViz - Photo Viewer ^& Trip Manager
echo  =============================================
echo.

:: ---- Check Python ----
where python >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Please install Python 3.11+ from https://python.org
    pause
    exit /b 1
)

:: ---- Check Node.js ----
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install Node.js 18+ from https://nodejs.org
    pause
    exit /b 1
)

set SCRIPT_DIR=%~dp0
set BACKEND_DIR=%SCRIPT_DIR%backend
set FRONTEND_DIR=%SCRIPT_DIR%frontend
set VENV_DIR=%BACKEND_DIR%\venv

:: ---- Setup Python venv ----
if not exist "%VENV_DIR%\Scripts\activate.bat" (
    echo [Setup] Creating Python virtual environment...
    python -m venv "%VENV_DIR%"
)

call "%VENV_DIR%\Scripts\activate.bat"

:: ---- Install backend deps ----
echo [Setup] Checking backend dependencies...
pip install -q -r "%BACKEND_DIR%\requirements.txt"

:: ---- Build frontend (if dist doesn't exist) ----
if not exist "%FRONTEND_DIR%\dist\index.html" (
    echo [Setup] Installing frontend dependencies...
    cd /d "%FRONTEND_DIR%"
    call npm install --silent
    echo [Setup] Building frontend...
    call npm run build
    cd /d "%SCRIPT_DIR%"
)

:: ---- Start backend ----
echo [Start] Starting TripViz server...
start "TripViz Backend" /B cmd /c "cd /d "%BACKEND_DIR%" && "%VENV_DIR%\Scripts\python.exe" main.py >> "%SCRIPT_DIR%tripviz.log" 2>&1"

:: ---- Wait for server ----
echo [Wait] Waiting for server to start...
:waitloop
timeout /t 1 /nobreak >nul
curl -s http://127.0.0.1:8000/api/photos/stats/summary >nul 2>&1
if errorlevel 1 goto waitloop

:: ---- Open browser ----
echo [Open] Opening TripViz in your browser...
start "" http://127.0.0.1:8000

echo.
echo  TripViz is running at http://127.0.0.1:8000
echo  Close this window to stop the server.
echo.

:: Keep window open until user closes it
:keepalive
timeout /t 5 /nobreak >nul
curl -s http://127.0.0.1:8000/api/photos/stats/summary >nul 2>&1
if not errorlevel 1 goto keepalive

echo Server stopped.
pause
