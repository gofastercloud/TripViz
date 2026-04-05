import { useState, useEffect, useCallback, useRef } from "react";
import type { Photo, Trip } from "../types";
import { getPhotos, bulkAssignTrip, thumbnailUrl, getKit, type KitDevice } from "../api/client";
import PhotoLightbox from "./PhotoLightbox";

interface Props {
  trips: Trip[];
  onTripChange: () => void;
  onStatsChange: () => void;
}

const COLORS = ["#3B82F6","#EF4444","#22C55E","#F59E0B","#8B5CF6","#EC4899","#14B8A6","#F97316"];
const TRIP_PRESET_COLORS = COLORS;

export default function Gallery({ trips, onTripChange, onStatsChange }: Props) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState("date_desc");
  const [filterTripId, setFilterTripId] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedDevices, setSelectedDevices] = useState<string[]>([]); // "make:model" strings
  const [availableDevices, setAvailableDevices] = useState<KitDevice[]>([]);
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [lightboxId, setLightboxId] = useState<number | null>(null);
  const [assignMenuOpen, setAssignMenuOpen] = useState(false);
  const [newTripName, setNewTripName] = useState("");
  const [newTripColor, setNewTripColor] = useState(COLORS[0]);
  const perPage = 60;

  // Load available cameras/phones for filter
  useEffect(() => {
    getKit().then(data => {
      setAvailableDevices([...data.cameras, ...data.phones]);
    }).catch(() => {});
  }, []);

  const loadPhotos = useCallback(async (p: number, reset: boolean) => {
    setLoading(true);
    try {
      const params: Record<string, string | number | undefined> = {
        page: p, per_page: perPage, sort,
      };
      if (filterTripId === "none") params.no_trip = "true";
      else if (filterTripId !== "all") params.trip_id = filterTripId;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      if (selectedDevices.length > 0) params.camera_devices = selectedDevices.join(",");

      const res = await getPhotos(params);
      setTotal(res.total);
      setPhotos(prev => reset ? res.photos : [...prev, ...res.photos]);
    } catch {}
    setLoading(false);
  }, [sort, filterTripId, dateFrom, dateTo, selectedDevices]);

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
    loadPhotos(1, true);
  }, [loadPhotos]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    loadPhotos(next, false);
  };

  // Infinite scroll
  const loaderRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = loaderRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !loading && photos.length < total) {
        loadMore();
      }
    }, { threshold: 0.1 });
    observer.observe(el);
    return () => observer.disconnect();
  });

  const toggleSelect = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(photos.map(p => p.id)));
  const clearSelect = () => setSelectedIds(new Set());

  const handleBulkAssign = async (tripId: number | null) => {
    if (selectedIds.size === 0) return;
    await bulkAssignTrip(Array.from(selectedIds), tripId);
    setSelectedIds(new Set());
    setAssignMenuOpen(false);
    loadPhotos(1, true);
    setPage(1);
    onTripChange();
    onStatsChange();
  };

  const handleCreateTripAndAssign = async () => {
    if (!newTripName.trim() || selectedIds.size === 0) return;
    const { createTrip } = await import("../api/client");
    const trip = await createTrip(newTripName.trim(), null, newTripColor);
    await bulkAssignTrip(Array.from(selectedIds), trip.id);
    setNewTripName("");
    setNewTripColor(COLORS[0]);
    setAssignMenuOpen(false);
    setSelectedIds(new Set());
    loadPhotos(1, true);
    setPage(1);
    onTripChange();
    onStatsChange();
  };

  const toggleDevice = (key: string) => {
    setSelectedDevices(prev =>
      prev.includes(key) ? prev.filter(d => d !== key) : [...prev, key]
    );
  };

  // Group photos by month/year
  const grouped = groupByMonth(photos);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Toolbar row 1: filters */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "8px 16px",
        background: "var(--bg2)", borderBottom: "1px solid var(--border)", flexShrink: 0,
        flexWrap: "wrap",
      }}>
        <span style={{ color: "var(--text2)", fontSize: 12 }}>
          {total.toLocaleString()} photos
        </span>

        {/* Date range */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
          <label style={{ fontSize: 11, color: "var(--text2)" }}>From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            style={{ fontSize: 11, padding: "3px 6px", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}
          />
          <label style={{ fontSize: 11, color: "var(--text2)" }}>To</label>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            style={{ fontSize: 11, padding: "3px 6px", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}
          />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(""); setDateTo(""); }}
              style={{ fontSize: 11, color: "var(--text2)" }}>✕</button>
          )}
        </div>

        {/* Camera filter */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setDeviceMenuOpen(o => !o)}
            style={{
              fontSize: 11, padding: "4px 10px", borderRadius: 4,
              background: selectedDevices.length > 0 ? "rgba(59,130,246,0.15)" : "var(--bg3)",
              border: `1px solid ${selectedDevices.length > 0 ? "var(--accent)" : "var(--border)"}`,
              color: selectedDevices.length > 0 ? "var(--accent)" : "var(--text2)",
            }}
          >
            {selectedDevices.length > 0
              ? `${selectedDevices.length} camera${selectedDevices.length !== 1 ? "s" : ""}`
              : "All cameras"} ▾
          </button>
          {deviceMenuOpen && (
            <div style={{
              position: "absolute", top: "100%", right: 0, zIndex: 100, marginTop: 4,
              background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)", minWidth: 220, maxHeight: 300, overflowY: "auto",
              padding: "6px 0",
            }}>
              {selectedDevices.length > 0 && (
                <button
                  onClick={() => setSelectedDevices([])}
                  style={{ width: "100%", padding: "6px 12px", fontSize: 11, color: "var(--text2)", textAlign: "left" }}
                >Clear all</button>
              )}
              {availableDevices.map(d => {
                const key = `${d.make}:${d.model}`;
                const checked = selectedDevices.includes(key);
                return (
                  <button
                    key={key}
                    onClick={() => toggleDevice(key)}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, width: "100%",
                      padding: "6px 12px", fontSize: 12, textAlign: "left",
                      background: checked ? "rgba(59,130,246,0.08)" : "transparent",
                    }}
                    onMouseEnter={e => { if (!checked) e.currentTarget.style.background = "var(--bg3)"; }}
                    onMouseLeave={e => { if (!checked) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{
                      width: 16, height: 16, borderRadius: 3, flexShrink: 0,
                      background: checked ? "var(--accent)" : "var(--bg3)",
                      border: `1.5px solid ${checked ? "var(--accent)" : "var(--border)"}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#fff", fontSize: 10,
                    }}>{checked ? "✓" : ""}</span>
                    <span style={{ flex: 1 }}>{d.display_name}</span>
                    <span style={{ fontSize: 10, color: "var(--text2)" }}>{d.photo_count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <select value={sort} onChange={e => setSort(e.target.value)}
          style={{ fontSize: 11 }}>
          <option value="date_desc">Newest first</option>
          <option value="date_asc">Oldest first</option>
          <option value="name_asc">Name A–Z</option>
        </select>

        <select value={filterTripId} onChange={e => setFilterTripId(e.target.value)}
          style={{ fontSize: 11 }}>
          <option value="all">All photos</option>
          <option value="none">No trip</option>
          {trips.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {/* Selection bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "6px 16px",
        background: "var(--bg2)", borderBottom: "1px solid var(--border)", flexShrink: 0,
      }}>
        {selectedIds.size > 0 ? (
          <>
            <span style={{ color: "var(--accent)", fontSize: 12, fontWeight: 600 }}>
              {selectedIds.size} selected
            </span>
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setAssignMenuOpen(o => !o)}
                style={{
                  background: "var(--accent)", color: "#fff", padding: "4px 12px",
                  borderRadius: "var(--radius)", fontSize: 12, fontWeight: 600,
                }}
              >
                Assign to Trip ▾
              </button>
              {assignMenuOpen && (
                <AssignMenu
                  trips={trips}
                  newTripName={newTripName}
                  newTripColor={newTripColor}
                  onNameChange={setNewTripName}
                  onColorChange={setNewTripColor}
                  onAssign={handleBulkAssign}
                  onCreateAndAssign={handleCreateTripAndAssign}
                  onClose={() => setAssignMenuOpen(false)}
                  presetColors={TRIP_PRESET_COLORS}
                />
              )}
            </div>
            <button onClick={clearSelect} style={{ color: "var(--text2)", fontSize: 12 }}>✕ Clear</button>
            <div style={{ flex: 1 }} />
          </>
        ) : (
          <div style={{ flex: 1 }} />
        )}
        <button onClick={selectAll} style={{ color: "var(--text2)", fontSize: 11 }}>Select all</button>
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        {grouped.length === 0 && !loading && (
          <EmptyState />
        )}

        {grouped.map(group => (
          <div key={group.label} style={{ marginBottom: 24 }}>
            <div style={{
              fontSize: 13, fontWeight: 600, color: "var(--text2)",
              marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em",
            }}>
              {group.label}
              <span style={{ fontWeight: 400, marginLeft: 8 }}>({group.photos.length})</span>
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: 6,
            }}>
              {group.photos.map(photo => (
                <PhotoCard
                  key={photo.id}
                  photo={photo}
                  selected={selectedIds.has(photo.id)}
                  onSelect={toggleSelect}
                  onClick={() => setLightboxId(photo.id)}
                />
              ))}
            </div>
          </div>
        ))}

        {/* Infinite scroll trigger */}
        <div ref={loaderRef} style={{ height: 20 }} />
        {loading && (
          <div style={{ textAlign: "center", color: "var(--text2)", padding: 20 }}>
            Loading...
          </div>
        )}
        {!loading && photos.length < total && (
          <button
            onClick={loadMore}
            style={{ display: "block", margin: "0 auto", color: "var(--accent)", padding: 8 }}
          >
            Load more
          </button>
        )}
      </div>

      {lightboxId !== null && (
        <PhotoLightbox
          photoId={lightboxId}
          trips={trips}
          onClose={() => setLightboxId(null)}
          onTripChange={() => { loadPhotos(1, true); setPage(1); onTripChange(); onStatsChange(); }}
          onNext={() => {
            const ids = photos.map(p => p.id);
            const idx = ids.indexOf(lightboxId);
            if (idx < ids.length - 1) setLightboxId(ids[idx + 1]);
          }}
          onPrev={() => {
            const ids = photos.map(p => p.id);
            const idx = ids.indexOf(lightboxId);
            if (idx > 0) setLightboxId(ids[idx - 1]);
          }}
        />
      )}
    </div>
  );
}

// Detect if a camera make/model string is a phone or a dedicated camera
function isPhone(make: string | null, model: string | null): boolean {
  const s = `${make ?? ""} ${model ?? ""}`.toLowerCase();
  return /apple|iphone|samsung|pixel|oneplus|xiaomi|huawei|oppo|vivo|redmi|galaxy|realme/.test(s);
}

function PhotoCard({ photo, selected, onSelect, onClick }: {
  photo: Photo;
  selected: boolean;
  onSelect: (id: number, e: React.MouseEvent) => void;
  onClick: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const activities = photo.activities ? JSON.parse(photo.activities) as string[] : [];
  const hasCamera = !!(photo.camera_make || photo.camera_model);
  const phone = hasCamera && isPhone(photo.camera_make, photo.camera_model);

  return (
    <div
      onClick={onClick}
      style={{
        position: "relative",
        aspectRatio: "1",
        borderRadius: 6,
        overflow: "hidden",
        cursor: "pointer",
        border: selected ? "2px solid var(--accent)" : "2px solid transparent",
        background: "var(--bg3)",
      }}
    >
      {!imgError ? (
        <img
          src={thumbnailUrl(photo.id)}
          alt={photo.filename}
          onError={() => setImgError(true)}
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <div style={{
          width: "100%", height: "100%", display: "flex",
          alignItems: "center", justifyContent: "center",
          color: "var(--text2)", fontSize: 28,
        }}>🖼️</div>
      )}

      {/* Top-right badges */}
      <div style={{
        position: "absolute", top: 5, right: 5,
        display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-end",
      }}>
        {photo.latitude != null && (
          <Badge title="Geotagged" bg="rgba(34,197,94,0.85)">🛰</Badge>
        )}
        {hasCamera && (
          <Badge title={phone ? "Phone camera" : "Dedicated camera"} bg="rgba(0,0,0,0.6)">
            {phone ? "📱" : "📷"}
          </Badge>
        )}
      </div>

      {/* Bottom: trip dot + activity chips */}
      <div style={{
        position: "absolute", bottom: 4, left: 4, right: 4,
        display: "flex", alignItems: "center", gap: 4,
      }}>
        {activities.slice(0, 1).map(a => (
          <span key={a} style={{
            background: "rgba(0,0,0,0.65)", color: "#fff",
            padding: "1px 5px", borderRadius: 8, fontSize: 9,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            maxWidth: "calc(100% - 20px)",
          }}>{a}</span>
        ))}
        {photo.trip_color && (
          <div style={{
            marginLeft: "auto", width: 9, height: 9, borderRadius: "50%",
            background: photo.trip_color, border: "1px solid rgba(0,0,0,0.4)", flexShrink: 0,
          }} title={photo.trip_name ?? ""} />
        )}
      </div>

      {/* Select checkbox */}
      <div
        onClick={e => onSelect(photo.id, e)}
        style={{
          position: "absolute", top: 5, left: 5,
          width: 20, height: 20, borderRadius: 4,
          background: selected ? "var(--accent)" : "rgba(0,0,0,0.5)",
          border: "1.5px solid rgba(255,255,255,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, color: "#fff",
        }}
      >
        {selected && "✓"}
      </div>
    </div>
  );
}

function Badge({ children, title, bg }: { children: React.ReactNode; title: string; bg: string }) {
  return (
    <div title={title} style={{
      background: bg, borderRadius: 3, padding: "1px 4px",
      fontSize: 10, lineHeight: 1.4, color: "#fff",
    }}>{children}</div>
  );
}

function AssignMenu({ trips, newTripName, newTripColor, onNameChange, onColorChange, onAssign, onCreateAndAssign, onClose, presetColors }: {
  trips: Trip[];
  newTripName: string;
  newTripColor: string;
  onNameChange: (v: string) => void;
  onColorChange: (v: string) => void;
  onAssign: (id: number | null) => void;
  onCreateAndAssign: () => void;
  onClose: () => void;
  presetColors: string[];
}) {
  return (
    <div
      style={{
        position: "absolute", top: "100%", right: 0, zIndex: 100,
        background: "var(--bg2)", border: "1px solid var(--border)",
        borderRadius: "var(--radius)", padding: 12, minWidth: 220,
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)", marginTop: 4,
      }}
      onClick={e => e.stopPropagation()}
    >
      {trips.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 6, textTransform: "uppercase" }}>
            Existing trips
          </div>
          {trips.map(t => (
            <button key={t.id} onClick={() => onAssign(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "6px 8px", borderRadius: 4,
                textAlign: "left", fontSize: 13,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--bg3)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: t.color, flexShrink: 0 }} />
              {t.name}
            </button>
          ))}
          <button onClick={() => onAssign(null)}
            style={{
              display: "block", width: "100%", padding: "6px 8px",
              borderRadius: 4, textAlign: "left", fontSize: 12, color: "var(--text2)",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--bg3)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            Remove from trip
          </button>
          <div style={{ borderTop: "1px solid var(--border)", margin: "8px 0" }} />
        </>
      )}

      <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 6, textTransform: "uppercase" }}>
        New trip
      </div>
      <input
        value={newTripName}
        onChange={e => onNameChange(e.target.value)}
        placeholder="Trip name..."
        style={{ width: "100%", marginBottom: 8, fontSize: 13 }}
        onKeyDown={e => { if (e.key === "Enter") onCreateAndAssign(); }}
      />
      <div style={{ display: "flex", gap: 5, marginBottom: 8, flexWrap: "wrap" }}>
        {presetColors.map(c => (
          <button key={c} onClick={() => onColorChange(c)}
            style={{
              width: 20, height: 20, borderRadius: "50%", background: c,
              border: c === newTripColor ? "2px solid #fff" : "2px solid transparent",
            }}
          />
        ))}
      </div>
      <button
        onClick={onCreateAndAssign}
        disabled={!newTripName.trim()}
        style={{
          width: "100%", background: "var(--accent)", color: "#fff",
          padding: "7px 0", borderRadius: 4, fontSize: 13, fontWeight: 600,
          opacity: newTripName.trim() ? 1 : 0.4,
        }}
      >
        Create &amp; Assign
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: 300, color: "var(--text2)", gap: 12,
    }}>
      <div style={{ fontSize: 48 }}>🖼️</div>
      <div style={{ fontSize: 16 }}>No photos yet</div>
      <div style={{ fontSize: 13 }}>Click "Index Photos" to scan a folder</div>
    </div>
  );
}

function groupByMonth(photos: Photo[]) {
  const groups: Map<string, { label: string; photos: Photo[] }> = new Map();
  for (const photo of photos) {
    const key = photo.date_taken
      ? new Date(photo.date_taken).toLocaleString("default", { month: "long", year: "numeric" })
      : "Unknown date";
    if (!groups.has(key)) groups.set(key, { label: key, photos: [] });
    groups.get(key)!.photos.push(photo);
  }
  return Array.from(groups.values());
}
