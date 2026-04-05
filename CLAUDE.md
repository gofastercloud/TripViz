# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

TripViz is a self-hosted photo manager with GPS-powered trip organization, optional ML features (face/activity detection via MediaPipe/CLIP), and a React frontend backed by FastAPI + SQLite.

## Commands

```bash
# Backend dev (hot reload)
cd backend && source venv/bin/activate && uvicorn main:app --reload

# Frontend dev (HMR, proxies /api to :8000)
cd frontend && npm run dev

# Build frontend
cd frontend && npm run build

# Full startup (creates venv, installs deps, builds frontend, starts server)
./start.sh
```

No test suite exists yet. No linter/formatter is configured.

## Architecture

**Two-process dev setup:** FastAPI backend on `:8000`, Vite dev server proxies `/api` requests to it. In production, backend serves the built `frontend/dist/` as static files.

**Backend (`backend/`):**
- `main.py` — FastAPI app, mounts static files, includes all routers
- `database.py` — SQLAlchemy engine + session (SQLite at `backend/tripviz.db`)
- `models.py` — ORM models: Photo, Trip, Person, Face
- `indexer.py` — Recursive directory scanner, EXIF extraction, thumbnail generation
- `ml.py` — MediaPipe face detection, CLIP activity classification
- `routers/` — 7 routers: photos, trips, indexing, ml, detect, kit, editing

**Frontend (`frontend/src/`):**
- `App.tsx` — Layout shell, React Router, sidebar navigation
- `api/client.ts` — Fetch wrapper for all `/api` calls
- `types/index.ts` — Shared TypeScript interfaces
- Components are feature-scoped: `Gallery.tsx`, `MapView.tsx`, `TripsView.tsx`, `PhotoLightbox.tsx`, `PeopleView.tsx`, etc.

**Key data flow:** IndexingPanel triggers backend scan → EXIF parsed → photos table populated → Gallery/Map/Trips views query `/api/photos` with filters.

**Database:** SQLite with 4 tables. Photo has optional trip_id FK. Face has photo_id FK (cascade delete) and optional person_id FK. Face embeddings stored as 128-dim arrays.

## Stack

- **Backend:** Python 3.11+, FastAPI, SQLAlchemy 2.x, Pillow, uvicorn
- **Frontend:** React 18, TypeScript, Vite, Leaflet (maps), React Router 6
- **ML (optional):** MediaPipe, scikit-learn, transformers, torch — declared in `requirements-ml.txt`
- **Dev proxy:** Vite config proxies `/api` → `http://127.0.0.1:8000`
