import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import type { MapPin, Trip } from "../types";
import { getMapPins, thumbnailUrl } from "../api/client";
import PhotoLightbox from "./PhotoLightbox";

interface Props {
  trips: Trip[];
}

// Convex hull (Graham scan)
function convexHull(points: [number, number][]): [number, number][] {
  if (points.length < 3) return points;
  const sorted = [...points].sort((a, b) => a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: [number, number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

// Create a circle SVG icon for a marker
function createColoredIcon(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">
    <circle cx="10" cy="10" r="8" fill="${color}" stroke="white" stroke-width="2"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -12],
  });
}

type TileStyle = "road" | "satellite" | "topo";

const TILE_LAYERS: Record<TileStyle, { url: string; attribution: string; maxZoom: number }> = {
  road: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>',
    maxZoom: 19,
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: '&copy; Esri, Maxar, Earthstar Geographics',
    maxZoom: 18,
  },
  topo: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
    maxZoom: 17,
  },
};

export default function MapView({ trips }: Props) {
  const mapRef = useRef<L.Map | null>(null);
  const mapDivRef = useRef<HTMLDivElement>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const hullLayersRef = useRef<L.Polygon[]>([]);
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  const [pins, setPins] = useState<MapPin[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<string>("all");
  const [showHulls, setShowHulls] = useState(true);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({ total: 0, geotagged: 0 });
  const [tileStyle, setTileStyle] = useState<TileStyle>("road");
  const [lightboxId, setLightboxId] = useState<number | null>(null);
  const pinIdsRef = useRef<number[]>([]);

  // Init map
  useEffect(() => {
    if (mapRef.current || !mapDivRef.current) return;

    const map = L.map(mapDivRef.current, {
      center: [20, 0],
      zoom: 2,
      zoomControl: true,
    });

    const layer = L.tileLayer(TILE_LAYERS.road.url, {
      attribution: TILE_LAYERS.road.attribution,
      maxZoom: TILE_LAYERS.road.maxZoom,
    }).addTo(map);
    tileLayerRef.current = layer;

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Global click handler for popup "View" buttons
  const lightboxIdSetRef = useRef(setLightboxId);
  lightboxIdSetRef.current = setLightboxId;
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest("[data-photo-id]") as HTMLElement | null;
      if (btn) lightboxIdSetRef.current(Number(btn.dataset.photoId));
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  // Switch tile layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileLayerRef.current) map.removeLayer(tileLayerRef.current);
    const cfg = TILE_LAYERS[tileStyle];
    const layer = L.tileLayer(cfg.url, { attribution: cfg.attribution, maxZoom: cfg.maxZoom }).addTo(map);
    tileLayerRef.current = layer;
  }, [tileStyle]);

  const loadPins = useCallback(async () => {
    if (!mapRef.current) return;
    setLoading(true);
    try {
      const tripIdParam = selectedTrip !== "all" ? Number(selectedTrip) : undefined;
      const data = await getMapPins(tripIdParam);
      setPins(data);
      setStats({ total: data.length, geotagged: data.length });
      renderPins(data);
    } catch {}
    setLoading(false);
  }, [selectedTrip]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadPins();
  }, [loadPins]);

  useEffect(() => {
    if (mapRef.current) renderHulls(pins, trips, showHulls);
  }, [pins, trips, showHulls]); // eslint-disable-line react-hooks/exhaustive-deps

  function renderPins(data: MapPin[]) {
    const map = mapRef.current;
    if (!map) return;

    // Remove old cluster
    if (clusterRef.current) {
      map.removeLayer(clusterRef.current);
    }

    const cluster = L.markerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction: (c) => {
        const count = c.getChildCount();
        return L.divIcon({
          html: `<div style="background:rgba(59,130,246,0.85);color:#fff;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3)">${count}</div>`,
          className: "",
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        });
      },
    });

    pinIdsRef.current = data.flatMap(p => p.photo_ids);

    for (const pin of data) {
      const color = pin.trip_color ?? "#3B82F6";
      const icon = createColoredIcon(color);
      const marker = L.marker([pin.lat, pin.lon], { icon });

      const dateStr = pin.date ? new Date(pin.date).toLocaleDateString() : "Unknown date";
      const tripStr = pin.trip_name ? `<div style="color:#aaa;font-size:11px">${pin.trip_name}</div>` : "";
      const countStr = pin.count > 1 ? `<div style="font-size:11px;color:#aaa;margin-bottom:4px">${pin.count} photos</div>` : "";

      marker.bindPopup(`
        <div style="text-align:center;min-width:160px;cursor:pointer" data-photo-id="${pin.photo_ids[0]}">
          <img src="${thumbnailUrl(pin.photo_ids[0])}"
            style="width:150px;height:100px;object-fit:cover;border-radius:4px;display:block;margin:0 auto 6px"
            onerror="this.style.display='none'"
          />
          ${countStr}
          <div style="font-size:12px;color:#ccc">${dateStr}</div>
          ${tripStr}
          <div style="margin-top:4px;font-size:11px;color:#3B82F6">View photo →</div>
        </div>
      `, { maxWidth: 200 });

      cluster.addLayer(marker);
    }

    cluster.addTo(map);
    clusterRef.current = cluster;

    // Fit bounds if we have data
    if (data.length > 0) {
      const lats = data.map(p => p.lat);
      const lons = data.map(p => p.lon);
      const bounds = L.latLngBounds(
        [Math.min(...lats), Math.min(...lons)],
        [Math.max(...lats), Math.max(...lons)]
      );
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
    }
  }

  function renderHulls(data: MapPin[], tripList: Trip[], visible: boolean) {
    const map = mapRef.current;
    if (!map) return;

    // Remove old hulls
    for (const layer of hullLayersRef.current) map.removeLayer(layer);
    hullLayersRef.current = [];

    if (!visible || data.length === 0) return;

    // Group pins by trip
    const byTrip = new Map<number, MapPin[]>();
    for (const pin of data) {
      if (pin.trip_id == null) continue;
      if (!byTrip.has(pin.trip_id)) byTrip.set(pin.trip_id, []);
      byTrip.get(pin.trip_id)!.push(pin);
    }

    for (const [tripId, tripPins] of byTrip) {
      if (tripPins.length < 3) continue;

      const trip = tripList.find(t => t.id === tripId);
      const color = trip?.color ?? "#3B82F6";
      const points: [number, number][] = tripPins.map(p => [p.lon, p.lat]);
      const hull = convexHull(points);
      if (hull.length < 3) continue;

      const latlngs = hull.map(([lon, lat]) => [lat, lon] as L.LatLngTuple);
      const polygon = L.polygon(latlngs, {
        color,
        fillColor: color,
        fillOpacity: 0.25,
        weight: 2,
        opacity: 0.5,
        dashArray: "6 4",
      });
      polygon.addTo(map);
      polygon.bindTooltip(trip?.name ?? `Trip ${tripId}`, { sticky: true });
      hullLayersRef.current.push(polygon);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
        background: "var(--bg2)", borderBottom: "1px solid var(--border)", flexShrink: 0,
      }}>
        <span style={{ color: "var(--text2)", fontSize: 12 }}>
          {loading ? "Loading..." : `${stats.geotagged.toLocaleString()} geotagged photos`}
        </span>

        <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
          {(["road", "satellite", "topo"] as TileStyle[]).map(t => (
            <button
              key={t}
              onClick={() => setTileStyle(t)}
              style={{
                padding: "4px 10px", borderRadius: 4, fontSize: 11, fontWeight: 500,
                background: tileStyle === t ? "var(--accent)" : "var(--bg3)",
                color: tileStyle === t ? "#fff" : "var(--text2)",
                border: `1px solid ${tileStyle === t ? "var(--accent)" : "var(--border)"}`,
              }}
            >
              {t === "topo" ? "Topo" : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <select value={selectedTrip} onChange={e => setSelectedTrip(e.target.value)}
          style={{ fontSize: 12 }}>
          <option value="all">All trips</option>
          {trips.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", color: "var(--text2)" }}>
          <input
            type="checkbox"
            checked={showHulls}
            onChange={e => setShowHulls(e.target.checked)}
            style={{ accentColor: "var(--accent)", cursor: "pointer" }}
          />
          Show coverage polygons
        </label>
      </div>

      {/* Map */}
      <div ref={mapDivRef} style={{ flex: 1 }} />

      {/* Trip legend */}
      {trips.length > 0 && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 8, padding: "8px 16px",
          background: "var(--bg2)", borderTop: "1px solid var(--border)",
        }}>
          {trips.map(t => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: t.color, flexShrink: 0, display: "inline-block" }} />
              {t.name}
              <span style={{ color: "var(--text2)" }}>({t.photo_count})</span>
            </div>
          ))}
        </div>
      )}

      {/* Photo lightbox */}
      {lightboxId !== null && (
        <PhotoLightbox
          photoId={lightboxId}
          trips={trips}
          onClose={() => setLightboxId(null)}
          onTripChange={() => loadPins()}
          onNext={() => {
            const ids = pinIdsRef.current;
            const idx = ids.indexOf(lightboxId);
            if (idx >= 0 && idx < ids.length - 1) setLightboxId(ids[idx + 1]);
          }}
          onPrev={() => {
            const ids = pinIdsRef.current;
            const idx = ids.indexOf(lightboxId);
            if (idx > 0) setLightboxId(ids[idx - 1]);
          }}
        />
      )}
    </div>
  );
}
