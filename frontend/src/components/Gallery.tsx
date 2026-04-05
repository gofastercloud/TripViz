import { useState, useEffect, useCallback, useRef } from "react";
import type { Photo, Trip } from "../types";
import { getPhotos, bulkAssignTrip, thumbnailUrl } from "../api/client";
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
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [lightboxId, setLightboxId] = useState<number | null>(null);
  const [assignMenuOpen, setAssignMenuOpen] = useState(false);
  const [newTripName, setNewTripName] = useState("");
  const [newTripColor, setNewTripColor] = useState(COLORS[0]);
  const perPage = 60;

  const loadPhotos = useCallback(async (p: number, reset: boolean) => {
    setLoading(true);
    try {
      const params: Record<string, string | number | undefined> = {
        page: p, per_page: perPage, sort,
      };
      if (filterTripId === "none") params.no_trip = "true";
      else if (filterTripId !== "all") params.trip_id = filterTripId;

      const res = await getPhotos(params);
      setTotal(res.total);
      setPhotos(prev => reset ? res.photos : [...prev, ...res.photos]);
    } catch {}
    setLoading(false);
  }, [sort, filterTripId]);

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

  // Group photos by month/year
  const grouped = groupByMonth(photos);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
        background: "var(--bg2)", borderBottom: "1px solid var(--border)", flexShrink: 0,
      }}>
        <span style={{ color: "var(--text2)", fontSize: 12 }}>
          {total.toLocaleString()} photos
        </span>

        <select value={sort} onChange={e => setSort(e.target.value)}
          style={{ marginLeft: "auto", fontSize: 12 }}>
          <option value="date_desc">Newest first</option>
          <option value="date_asc">Oldest first</option>
          <option value="name_asc">Name A–Z</option>
        </select>

        <select value={filterTripId} onChange={e => setFilterTripId(e.target.value)}
          style={{ fontSize: 12 }}>
          <option value="all">All photos</option>
          <option value="none">No trip</option>
          {trips.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>

        {selectedIds.size > 0 ? (
          <>
            <span style={{ color: "var(--accent)", fontSize: 12, fontWeight: 600 }}>
              {selectedIds.size} selected
            </span>
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setAssignMenuOpen(o => !o)}
                style={{
                  background: "var(--accent)", color: "#fff", padding: "5px 12px",
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
          </>
        ) : (
          <button onClick={selectAll} style={{ color: "var(--text2)", fontSize: 12 }}>Select all</button>
        )}
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

function PhotoCard({ photo, selected, onSelect, onClick }: {
  photo: Photo;
  selected: boolean;
  onSelect: (id: number, e: React.MouseEvent) => void;
  onClick: () => void;
}) {
  const [imgError, setImgError] = useState(false);

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

      {/* Trip color dot */}
      {photo.trip_color && (
        <div style={{
          position: "absolute", bottom: 5, right: 5,
          width: 10, height: 10, borderRadius: "50%",
          background: photo.trip_color,
          border: "1px solid rgba(0,0,0,0.4)",
        }} title={photo.trip_name ?? ""} />
      )}

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

      {/* GPS indicator */}
      {photo.latitude && (
        <div style={{
          position: "absolute", top: 5, right: 5,
          fontSize: 10, background: "rgba(0,0,0,0.5)",
          borderRadius: 3, padding: "1px 4px", color: "#fff",
        }}>📍</div>
      )}
    </div>
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
