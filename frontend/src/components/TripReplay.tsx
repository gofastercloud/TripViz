import { useState, useEffect, useRef, useCallback } from "react";
import L from "leaflet";
import type { ReplayData, ReplayFrame } from "../types";
import { getTripReplay, thumbnailUrl, imageUrl } from "../api/client";

interface Props {
  tripId: number;
  tripName: string;
  onClose: () => void;
}

const SPEEDS = [
  { label: "0.5×", fps: 0.5 },
  { label: "1×",   fps: 1 },
  { label: "2×",   fps: 2 },
  { label: "5×",   fps: 5 },
  { label: "10×",  fps: 10 },
];

export default function TripReplay({ tripId, tripName, onClose }: Props) {
  const [data, setData] = useState<ReplayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);      // index into SPEEDS
  const [windowHours, setWindowHours] = useState(2); // interpolation window

  const mapDivRef  = useRef<HTMLDivElement>(null);
  const mapRef     = useRef<L.Map | null>(null);
  const solidLineRef  = useRef<L.Polyline | null>(null);
  const dashedLineRef = useRef<L.Polyline | null>(null);
  const markerRef  = useRef<L.Marker | null>(null);
  const filmRef    = useRef<HTMLDivElement>(null);
  const animRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load replay data ───────────────────────────────────────
  const loadReplay = useCallback(async () => {
    setLoading(true);
    setPlaying(false);
    setCurrent(0);
    try {
      const d = await getTripReplay(tripId, windowHours);
      setData(d);
    } catch {}
    setLoading(false);
  }, [tripId, windowHours]);

  useEffect(() => { loadReplay(); }, [loadReplay]);

  // ── Init map ───────────────────────────────────────────────
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;
    const map = L.map(mapDivRef.current, { center: [20, 0], zoom: 2, zoomControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);

    // Solid path line (confirmed GPS)
    solidLineRef.current = L.polyline([], {
      color: "#3B82F6", weight: 3, opacity: 0.85,
    }).addTo(map);

    // Dashed line (interpolated segments)
    dashedLineRef.current = L.polyline([], {
      color: "#3B82F6", weight: 2, opacity: 0.5,
      dashArray: "6 6",
    }).addTo(map);

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // ── Update map when data or current frame changes ──────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data || data.frames.length === 0) return;

    const frames = data.frames.slice(0, current + 1);
    const locFrames = frames.filter(f => f.lat !== null);

    // Split path into solid (confirmed GPS) and dashed (interpolated) segments
    const solidPts: L.LatLngTuple[] = [];
    const dashedPts: L.LatLngTuple[] = [];

    for (const f of locFrames) {
      if (f.lat === null) continue;
      const pt: L.LatLngTuple = [f.lat, f.lon!];
      if (f.is_interpolated) { dashedPts.push(pt); }
      else { solidPts.push(pt); dashedPts.push(pt); } // solid bleeds into dashed for continuity
    }

    solidLineRef.current?.setLatLngs(solidPts);
    dashedLineRef.current?.setLatLngs(dashedPts);

    // Current frame marker
    const cur = data.frames[current];
    if (cur.lat !== null) {
      const color = cur.is_interpolated ? "#94A3B8" : (data.trip.color || "#3B82F6");
      const icon = L.divIcon({
        html: `<div style="
          width:14px;height:14px;border-radius:50%;
          background:${color};border:2px solid #fff;
          box-shadow:0 1px 6px rgba(0,0,0,0.5)">
        </div>`,
        className: "", iconSize: [14, 14], iconAnchor: [7, 7],
      });

      if (markerRef.current) {
        markerRef.current.setLatLng([cur.lat, cur.lon!]);
        markerRef.current.setIcon(icon);
      } else {
        markerRef.current = L.marker([cur.lat, cur.lon!], { icon }).addTo(map);
      }

      map.panTo([cur.lat, cur.lon!], { animate: true, duration: 0.4 });
    } else if (markerRef.current) {
      map.removeLayer(markerRef.current);
      markerRef.current = null;
    }

    // Scroll filmstrip
    if (filmRef.current) {
      const item = filmRef.current.children[current] as HTMLElement | undefined;
      item?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [current, data]);

  // Fit map to full path on initial load
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data || data.path.length === 0) return;
    const lats = data.path.map(p => p.lat);
    const lons = data.path.map(p => p.lon);
    map.fitBounds(
      [[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]],
      { padding: [40, 40], maxZoom: 12 },
    );
  }, [data]);

  // ── Playback ───────────────────────────────────────────────
  useEffect(() => {
    if (animRef.current) clearInterval(animRef.current);
    if (!playing || !data) return;

    const fps = SPEEDS[speedIdx].fps;
    const delay = Math.round(1000 / fps);

    animRef.current = setInterval(() => {
      setCurrent(c => {
        if (c >= (data.frames.length - 1)) {
          setPlaying(false);
          return c;
        }
        return c + 1;
      });
    }, delay);

    return () => { if (animRef.current) clearInterval(animRef.current); };
  }, [playing, speedIdx, data]);

  const togglePlay = () => {
    if (!data) return;
    if (current >= data.frames.length - 1) setCurrent(0);
    setPlaying(p => !p);
  };

  const curFrame: ReplayFrame | null = data?.frames[current] ?? null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 900,
      background: "var(--bg)", display: "flex", flexDirection: "column",
    }}>
      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
        background: "var(--bg2)", borderBottom: "1px solid var(--border)", flexShrink: 0,
      }}>
        <button onClick={onClose}
          style={{ color: "var(--text2)", fontSize: 18, lineHeight: 1, padding: "2px 6px" }}
          title="Close">✕</button>
        <div style={{ fontWeight: 700, fontSize: 15 }}>▶ {tripName}</div>

        {data && (
          <div style={{ fontSize: 12, color: "var(--text2)", marginLeft: 4 }}>
            {data.stats.total} photos
            {data.stats.interpolated > 0 && (
              <> · <span title="Position inferred from nearby GPS photos">
                {data.stats.interpolated} position{data.stats.interpolated !== 1 ? "s" : ""} inferred
              </span></>
            )}
            {data.stats.no_location > 0 && (
              <> · <span style={{ color: "#F59E0B" }}>
                {data.stats.no_location} unlocated
              </span></>
            )}
          </div>
        )}

        {/* Interpolation window control */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <span style={{ color: "var(--text2)" }}>Infer GPS within</span>
          <select value={windowHours} onChange={e => setWindowHours(Number(e.target.value))}
            style={{ fontSize: 12 }}>
            {[0.5, 1, 2, 4, 8].map(h => (
              <option key={h} value={h}>{h}h</option>
            ))}
          </select>
        </div>
      </div>

      {/* Map + photo preview */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <div ref={mapDivRef} style={{ width: "100%", height: "100%" }} />

        {loading && (
          <div style={{
            position: "absolute", inset: 0, display: "flex",
            alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: 14,
          }}>
            Loading replay…
          </div>
        )}

        {/* Current photo overlay */}
        {curFrame && (
          <div style={{
            position: "absolute", top: 12, right: 12,
            background: "rgba(0,0,0,0.8)", borderRadius: 8, overflow: "hidden",
            width: 200, boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
            border: "1px solid rgba(255,255,255,0.1)",
          }}>
            <img
              src={thumbnailUrl(curFrame.photo_id)}
              alt=""
              style={{ width: "100%", height: 150, objectFit: "cover", display: "block" }}
            />
            <div style={{ padding: "6px 10px" }}>
              <div style={{ fontSize: 11, color: "#ccc" }}>
                {new Date(curFrame.timestamp).toLocaleString()}
              </div>
              <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>
                {curFrame.has_gps
                  ? "📍 GPS"
                  : curFrame.is_interpolated
                    ? "⊙ Position inferred"
                    : "✕ No location"}
              </div>
              <div style={{ fontSize: 10, color: "#666", marginTop: 1 }}>{curFrame.filename}</div>
            </div>
          </div>
        )}

        {/* Legend */}
        {data && data.stats.interpolated > 0 && (
          <div style={{
            position: "absolute", bottom: 12, left: 12,
            background: "rgba(0,0,0,0.75)", borderRadius: 6, padding: "6px 10px",
            fontSize: 11, color: "#ccc", display: "flex", flexDirection: "column", gap: 4,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 24, height: 2, background: "#3B82F6", borderRadius: 1 }} />
              Confirmed GPS
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{
                width: 24, height: 2, background: "#3B82F6", opacity: 0.5,
                backgroundImage: "repeating-linear-gradient(to right,#3B82F6 0,#3B82F6 4px,transparent 4px,transparent 8px)",
              }} />
              Inferred position
            </div>
          </div>
        )}
      </div>

      {/* Playback controls */}
      {data && data.frames.length > 0 && (
        <div style={{
          background: "var(--bg2)", borderTop: "1px solid var(--border)",
          padding: "10px 16px", flexShrink: 0,
        }}>
          {/* Scrubber */}
          <input
            type="range"
            min={0}
            max={data.frames.length - 1}
            value={current}
            onChange={e => { setPlaying(false); setCurrent(Number(e.target.value)); }}
            style={{ width: "100%", marginBottom: 8, accentColor: "var(--accent)", cursor: "pointer" }}
          />

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* Skip to start */}
            <button onClick={() => { setPlaying(false); setCurrent(0); }}
              style={{ color: "var(--text2)", fontSize: 16 }} title="Jump to start">⏮</button>

            {/* Play/Pause */}
            <button
              onClick={togglePlay}
              style={{
                width: 36, height: 36, borderRadius: "50%",
                background: "var(--accent)", color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16,
              }}
            >
              {playing ? "⏸" : "▶"}
            </button>

            {/* Skip to end */}
            <button onClick={() => { setPlaying(false); setCurrent(data.frames.length - 1); }}
              style={{ color: "var(--text2)", fontSize: 16 }} title="Jump to end">⏭</button>

            {/* Speed */}
            <div style={{ display: "flex", gap: 3 }}>
              {SPEEDS.map((s, i) => (
                <button key={s.label} onClick={() => setSpeedIdx(i)}
                  style={{
                    padding: "3px 8px", borderRadius: 4, fontSize: 11,
                    background: speedIdx === i ? "var(--accent)" : "var(--bg3)",
                    color: speedIdx === i ? "#fff" : "var(--text2)",
                    border: "1px solid " + (speedIdx === i ? "var(--accent)" : "var(--border)"),
                  }}>
                  {s.label}
                </button>
              ))}
            </div>

            {/* Counter + date */}
            <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--text2)", textAlign: "right" }}>
              <span style={{ color: "var(--text)" }}>{current + 1}</span>
              {" / "}{data.frames.length}
              {curFrame && (
                <div style={{ fontSize: 11 }}>
                  {new Date(curFrame.timestamp).toLocaleDateString(undefined, {
                    weekday: "short", month: "short", day: "numeric", year: "numeric",
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Filmstrip */}
      {data && data.frames.length > 0 && (
        <div
          ref={filmRef}
          style={{
            display: "flex", gap: 3, padding: "6px 8px",
            background: "#0a0a0a", borderTop: "1px solid var(--border)",
            overflowX: "auto", flexShrink: 0, height: 72,
            scrollbarWidth: "thin",
          }}
        >
          {data.frames.map((frame, i) => (
            <FilmCell
              key={frame.photo_id}
              frame={frame}
              isCurrent={i === current}
              onClick={() => { setPlaying(false); setCurrent(i); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilmCell({ frame, isCurrent, onClick }: {
  frame: ReplayFrame;
  isCurrent: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      title={`${frame.filename}\n${new Date(frame.timestamp).toLocaleString()}`}
      style={{
        width: 58, height: 58, flexShrink: 0, borderRadius: 4,
        overflow: "hidden", cursor: "pointer", position: "relative",
        border: isCurrent ? "2px solid var(--accent)" : "2px solid transparent",
        opacity: frame.lat === null ? 0.45 : 1,
      }}
    >
      <img
        src={thumbnailUrl(frame.photo_id)}
        alt=""
        loading="lazy"
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      {/* Location indicator dot */}
      <div style={{
        position: "absolute", bottom: 2, right: 2,
        width: 6, height: 6, borderRadius: "50%",
        background: frame.has_gps
          ? "#22C55E"
          : frame.is_interpolated
            ? "#94A3B8"
            : "#555",
        border: "1px solid rgba(0,0,0,0.5)",
      }} />
    </div>
  );
}
