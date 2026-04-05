# TripViz

A local photo viewer that indexes your hard drive, extracts EXIF data, lets you tag photos into trips, and visualizes them on an interactive map.

## Features

- **Fast indexing** — scans directories recursively, extracts GPS coordinates, date taken, and camera info from EXIF
- **Gallery view** — thumbnail grid grouped by month, with date sorting and trip filtering
- **Map view** — interactive OpenStreetMap with clustered markers for all geotagged photos
- **Coverage polygons** — convex hull overlay per trip shows how much of a region you covered
- **Trip tagging** — multi-select photos in the gallery and assign them to named, color-coded trips
- **Photo lightbox** — full-size view with EXIF info, GPS link, and color histogram (RGB + luminance)
- **Apple Photos integration** — on macOS, point the indexer at your Photos Library originals folder

## Requirements

- **Python 3.11+** — [python.org](https://www.python.org/downloads/)
- **Node.js 18+** — [nodejs.org](https://nodejs.org/)

## Quick Start

### Windows
Double-click `start.bat` — it will set everything up and open your browser automatically.

### macOS / Linux
```bash
./start.sh
```

Both scripts will:
1. Create a Python virtual environment and install dependencies
2. Build the React frontend (first run only)
3. Start the FastAPI backend on `http://127.0.0.1:8000`
4. Open your browser automatically

## Indexing Photos

1. Click **"+ Index Photos"** in the sidebar
2. Enter a directory path, or choose a quick-path:
   - `C:\Users\YourName\Pictures` (Windows)
   - `~/Pictures` (macOS/Linux)
   - `~/Pictures/Photos Library.photoslibrary/originals` (Apple Photos on macOS)
3. Click **Start Indexing** — you can browse existing photos while it runs

### Apple Photos on macOS

The Photos app stores originals at:
```
~/Pictures/Photos Library.photoslibrary/originals/
```
Indexing this folder gives you access to all your iPhone photos (including GPS data and EXIF) without needing to export them first.

> **Note:** On macOS 12+, you may need to grant Terminal / your shell Full Disk Access in  
> System Settings → Privacy & Security → Full Disk Access.

## Using TripViz

### Gallery
- Photos are grouped by month and sorted by date
- Click any photo to open the lightbox (arrow keys to navigate)
- Check the box on a photo to select it, then **"Assign to Trip"** to tag it
- Filter by trip using the dropdown in the toolbar

### Map
- All geotagged photos appear as colored markers (color = trip color)
- Markers cluster automatically — click to expand or zoom in
- Click a marker to see a thumbnail popup
- Toggle **"Show coverage polygons"** to see a convex hull for each trip

### Trips
- Create trips from the Gallery (assign photos) or from the Trips page
- Each trip shows its photos in chronological order with date range
- Edit or delete trips at any time (photos are unassigned, not deleted)

### Lightbox
- **Info tab** — filename, date, camera, dimensions, GPS link, trip assignment
- **Histogram tab** — RGB and luminance distribution, mean channel values, white balance hint

## Data Storage

- Database: `backend/tripviz.db` (SQLite)
- Thumbnails: `backend/thumbnails/` (JPEG, 400×400 max)
- Original photos are never moved or modified

## Development

```bash
# Backend (hot reload)
cd backend
source venv/bin/activate   # or venv\Scripts\activate on Windows
uvicorn main:app --reload

# Frontend (dev server with HMR)
cd frontend
npm run dev
```

The Vite dev server proxies `/api` requests to the backend on port 8000.
