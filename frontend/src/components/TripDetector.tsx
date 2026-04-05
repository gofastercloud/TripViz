import { useState, useEffect } from "react";
import type { DetectedTrip, Trip } from "../types";
import { detectTrips, createTrip, bulkAssignTrip } from "../api/client";

interface Props {
  trips: Trip[];
  onClose: () => void;
  onTripsCreated: () => void;
}

const PRESET_COLORS = [
  "#3B82F6","#EF4444","#22C55E","#F59E0B",
  "#8B5CF6","#EC4899","#14B8A6","#F97316",
];

export default function TripDetector({ trips, onClose, onTripsCreated }: Props) {
  const [suggestions, setSuggestions] = useState<DetectedTrip[]>([]);
  const [loading, setLoading] = useState(false);
  const [gapHours, setGapHours] = useState(6);
  const [minPhotos, setMinPhotos] = useState(3);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [names, setNames] = useState<Record<number, string>>({});
  const [colors, setColors] = useState<Record<number, string>>({});
  const [creating, setCreating] = useState(false);
  const [createdCount, setCreatedCount] = useState(0);

  const load = async (geocode = true) => {
    setLoading(true);
    setSuggestions([]);
    setDismissed(new Set());
    setAccepted(new Set());
    try {
      const res = await detectTrips(gapHours, minPhotos, geocode);
      setSuggestions(res.trips);
      // Pre-fill names and colors
      const ns: Record<number, string> = {};
      const cs: Record<number, string> = {};
      res.trips.forEach((t, i) => {
        ns[t.cluster_id] = t.suggested_name;
        cs[t.cluster_id] = PRESET_COLORS[i % PRESET_COLORS.length];
      });
      setNames(ns);
      setColors(cs);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAccepted = (id: number) => {
    setAccepted(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setDismissed(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const dismiss = (id: number) => {
    setDismissed(prev => { const n = new Set(prev); n.add(id); return n; });
    setAccepted(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const acceptAll = () => {
    const visible = suggestions.filter(s => !dismissed.has(s.cluster_id));
    setAccepted(new Set(visible.map(s => s.cluster_id)));
  };

  const handleCreate = async () => {
    const toCreate = suggestions.filter(s => accepted.has(s.cluster_id));
    if (toCreate.length === 0) return;
    setCreating(true);
    let count = 0;
    for (const s of toCreate) {
      try {
        const trip = await createTrip(
          names[s.cluster_id] || s.suggested_name,
          null,
          colors[s.cluster_id] || PRESET_COLORS[0],
        );
        await bulkAssignTrip(s.photo_ids, trip.id);
        count++;
      } catch {}
    }
    setCreatedCount(count);
    setCreating(false);
    onTripsCreated();
  };

  const visible = suggestions.filter(s => !dismissed.has(s.cluster_id));
  const pendingAccept = accepted.size;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 500,
        background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "var(--bg2)", border: "1px solid var(--border)",
        borderRadius: 12, width: 640, maxWidth: "95vw", maxHeight: "90vh",
        display: "flex", flexDirection: "column",
        boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", borderBottom: "1px solid var(--border)", flexShrink: 0,
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>🔍 Auto-Detect Trips</div>
            <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>
              Groups photos by time gaps and GPS location
            </div>
          </div>
          <button onClick={onClose} style={{ color: "var(--text2)", fontSize: 18 }}>✕</button>
        </div>

        {/* Settings */}
        <div style={{
          display: "flex", gap: 16, padding: "12px 20px",
          borderBottom: "1px solid var(--border)", flexShrink: 0, flexWrap: "wrap",
        }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <span style={{ color: "var(--text2)" }}>Gap between trips</span>
            <select value={gapHours} onChange={e => setGapHours(Number(e.target.value))}
              style={{ fontSize: 12 }}>
              {[2,4,6,8,12,24].map(h => (
                <option key={h} value={h}>{h}h</option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <span style={{ color: "var(--text2)" }}>Min photos</span>
            <select value={minPhotos} onChange={e => setMinPhotos(Number(e.target.value))}
              style={{ fontSize: 12 }}>
              {[1,2,3,5,10].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <button
            onClick={() => load(true)}
            disabled={loading}
            style={{
              marginLeft: "auto", padding: "5px 14px", borderRadius: 6,
              background: "var(--bg3)", border: "1px solid var(--border)",
              fontSize: 12, color: "var(--text2)", opacity: loading ? 0.5 : 1,
            }}
          >
            {loading ? "Scanning…" : "↺ Re-scan"}
          </button>
        </div>

        {/* Results */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px" }}>
          {loading && (
            <div style={{ color: "var(--text2)", textAlign: "center", padding: 32, fontSize: 13 }}>
              Scanning library and reverse-geocoding locations…
            </div>
          )}

          {!loading && visible.length === 0 && (
            <div style={{ color: "var(--text2)", textAlign: "center", padding: 32 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>✈️</div>
              <div>No trip candidates found</div>
              <div style={{ fontSize: 12, marginTop: 6 }}>
                Try reducing the time gap or minimum photo count
              </div>
            </div>
          )}

          {!loading && visible.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontSize: 12, color: "var(--text2)" }}>
                  {visible.length} trip{visible.length !== 1 ? "s" : ""} detected
                </span>
                <button onClick={acceptAll} style={{ fontSize: 12, color: "var(--accent)" }}>
                  Select all
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {visible.map(s => (
                  <DetectionCard
                    key={s.cluster_id}
                    suggestion={s}
                    existingTrips={trips}
                    isAccepted={accepted.has(s.cluster_id)}
                    name={names[s.cluster_id] ?? s.suggested_name}
                    color={colors[s.cluster_id] ?? PRESET_COLORS[0]}
                    onToggle={() => toggleAccepted(s.cluster_id)}
                    onDismiss={() => dismiss(s.cluster_id)}
                    onNameChange={v => setNames(prev => ({ ...prev, [s.cluster_id]: v }))}
                    onColorChange={v => setColors(prev => ({ ...prev, [s.cluster_id]: v }))}
                    presetColors={PRESET_COLORS}
                  />
                ))}
              </div>
            </>
          )}

          {createdCount > 0 && (
            <div style={{
              marginTop: 16, padding: "10px 14px", background: "rgba(34,197,94,0.1)",
              border: "1px solid #22C55E", borderRadius: 8, fontSize: 13, color: "#22C55E",
            }}>
              ✓ Created {createdCount} trip{createdCount !== 1 ? "s" : ""}
            </div>
          )}
        </div>

        {/* Footer */}
        {pendingAccept > 0 && (
          <div style={{
            padding: "12px 20px", borderTop: "1px solid var(--border)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 13, color: "var(--text2)" }}>
              {pendingAccept} trip{pendingAccept !== 1 ? "s" : ""} selected
            </span>
            <button
              onClick={handleCreate}
              disabled={creating}
              style={{
                background: "var(--accent)", color: "#fff",
                padding: "8px 20px", borderRadius: 8, fontWeight: 600, fontSize: 14,
                opacity: creating ? 0.5 : 1,
              }}
            >
              {creating ? "Creating…" : `Create ${pendingAccept} Trip${pendingAccept !== 1 ? "s" : ""}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DetectionCard({ suggestion: s, existingTrips, isAccepted, name, color,
  onToggle, onDismiss, onNameChange, onColorChange, presetColors }: {
  suggestion: DetectedTrip;
  existingTrips: Trip[];
  isAccepted: boolean;
  name: string;
  color: string;
  onToggle: () => void;
  onDismiss: () => void;
  onNameChange: (v: string) => void;
  onColorChange: (v: string) => void;
  presetColors: string[];
}) {
  const alreadyHasTrip = s.already_assigned > 0;
  const existingNames = s.existing_trip_ids
    .map(id => existingTrips.find(t => t.id === id)?.name)
    .filter(Boolean);

  const startDate = new Date(s.start_date);
  const endDate = new Date(s.end_date);
  const sameDay = startDate.toDateString() === endDate.toDateString();
  const dateStr = sameDay
    ? startDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : `${startDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${endDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;

  const gpsPct = s.photo_count > 0 ? Math.round((s.gps_count / s.photo_count) * 100) : 0;

  return (
    <div style={{
      border: `1px solid ${isAccepted ? "var(--accent)" : "var(--border)"}`,
      borderRadius: 8, overflow: "hidden",
      background: isAccepted ? "rgba(59,130,246,0.06)" : "var(--bg3)",
    }}>
      {/* Main row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px" }}>
        {/* Checkbox */}
        <button
          onClick={onToggle}
          style={{
            width: 22, height: 22, borderRadius: 5, flexShrink: 0,
            background: isAccepted ? "var(--accent)" : "var(--bg2)",
            border: `2px solid ${isAccepted ? "var(--accent)" : "var(--border)"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 12,
          }}
        >{isAccepted ? "✓" : ""}</button>

        {/* Info */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>
              {s.location_name !== "Unknown location" ? s.location_name : "Unknown location"}
            </span>
            {alreadyHasTrip && (
              <span style={{
                fontSize: 10, background: "rgba(245,158,11,0.2)",
                border: "1px solid rgba(245,158,11,0.4)", color: "#F59E0B",
                padding: "1px 6px", borderRadius: 8,
              }}>
                partial: {existingNames.join(", ")}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--text2)" }}>
            {dateStr}
            {s.duration_hours < 24
              ? ` · ${Math.round(s.duration_hours)}h`
              : ` · ${Math.round(s.duration_hours / 24)}d`}
          </div>
        </div>

        {/* Stats */}
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{s.photo_count} photos</div>
          <div style={{ fontSize: 11, color: "var(--text2)" }}>
            {gpsPct}% geotagged
          </div>
        </div>

        {/* Dismiss */}
        <button onClick={onDismiss}
          style={{ color: "var(--text2)", fontSize: 14, padding: "2px 6px", flexShrink: 0 }}
          title="Dismiss">✕</button>
      </div>

      {/* GPS breakdown bar */}
      {s.photo_count > 0 && (
        <div style={{ height: 3, background: "var(--border)", margin: "0 14px 8px" }}>
          <div style={{
            height: "100%",
            width: `${gpsPct}%`,
            background: "#22C55E",
            borderRadius: 2,
          }} title={`${s.gps_count} GPS · ${s.no_gps_count} no GPS`} />
        </div>
      )}

      {/* No-GPS note */}
      {s.no_gps_count > 0 && (
        <div style={{ padding: "0 14px 8px", fontSize: 11, color: "var(--text2)" }}>
          {s.no_gps_count} photo{s.no_gps_count !== 1 ? "s" : ""} without GPS will be grouped by time proximity
        </div>
      )}

      {/* Name + color editor (when selected) */}
      {isAccepted && (
        <div style={{
          padding: "8px 14px 12px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex", gap: 8, alignItems: "center",
        }}>
          <input
            value={name}
            onChange={e => onNameChange(e.target.value)}
            placeholder="Trip name…"
            style={{ flex: 1, fontSize: 13 }}
          />
          <div style={{ display: "flex", gap: 4 }}>
            {presetColors.map(c => (
              <button key={c} onClick={() => onColorChange(c)}
                style={{
                  width: 18, height: 18, borderRadius: "50%", background: c,
                  border: c === color ? "2px solid #fff" : "2px solid transparent",
                  flexShrink: 0,
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
