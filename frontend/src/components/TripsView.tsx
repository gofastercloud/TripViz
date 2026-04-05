import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { Trip, Photo } from "../types";
import { getTrips, createTrip, updateTrip, deleteTrip, getPhotos, thumbnailUrl } from "../api/client";
import PhotoLightbox from "./PhotoLightbox";

interface Props {
  trips: Trip[];
  onTripsChange: () => void;
}

const PRESET_COLORS = ["#3B82F6","#EF4444","#22C55E","#F59E0B","#8B5CF6","#EC4899","#14B8A6","#F97316","#06B6D4","#84CC16"];

export default function TripsView({ trips, onTripsChange }: Props) {
  const { tripId } = useParams<{ tripId?: string }>();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editColor, setEditColor] = useState("");
  const [selectedTripPhotos, setSelectedTripPhotos] = useState<Photo[]>([]);
  const [lightboxId, setLightboxId] = useState<number | null>(null);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [photoTotal, setPhotoTotal] = useState(0);
  const [photoPage, setPhotoPage] = useState(1);

  const selectedTrip = tripId ? trips.find(t => t.id === Number(tripId)) : null;

  const loadTripPhotos = useCallback(async (id: number, page: number, reset: boolean) => {
    setLoadingPhotos(true);
    try {
      const res = await getPhotos({ trip_id: id, page, per_page: 60, sort: "date_asc" });
      setPhotoTotal(res.total);
      setSelectedTripPhotos(prev => reset ? res.photos : [...prev, ...res.photos]);
    } catch {}
    setLoadingPhotos(false);
  }, []);

  useEffect(() => {
    if (selectedTrip) {
      setPhotoPage(1);
      loadTripPhotos(selectedTrip.id, 1, true);
    } else {
      setSelectedTripPhotos([]);
    }
  }, [selectedTrip, loadTripPhotos]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createTrip(newName.trim(), newDesc.trim() || null, newColor);
    setNewName(""); setNewDesc(""); setNewColor(PRESET_COLORS[0]);
    setCreating(false);
    onTripsChange();
  };

  const startEdit = (trip: Trip) => {
    setEditingId(trip.id);
    setEditName(trip.name);
    setEditDesc(trip.description ?? "");
    setEditColor(trip.color);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    await updateTrip(editingId, { name: editName, description: editDesc || null, color: editColor });
    setEditingId(null);
    onTripsChange();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this trip? Photos will be unassigned but not deleted.")) return;
    await deleteTrip(id);
    if (tripId === String(id)) navigate("/trips");
    onTripsChange();
  };

  // Date range for a trip
  const getTripDateRange = (photos: Photo[]) => {
    const dates = photos.map(p => p.date_taken).filter(Boolean).map(d => new Date(d!).getTime());
    if (dates.length === 0) return null;
    const min = new Date(Math.min(...dates));
    const max = new Date(Math.max(...dates));
    if (min.toDateString() === max.toDateString()) return min.toLocaleDateString();
    return `${min.toLocaleDateString()} – ${max.toLocaleDateString()}`;
  };

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Trip list */}
      <div style={{
        width: 280, flexShrink: 0,
        background: "var(--bg2)", borderRight: "1px solid var(--border)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", borderBottom: "1px solid var(--border)",
        }}>
          <div style={{ fontWeight: 600 }}>Trips</div>
          <button
            onClick={() => setCreating(c => !c)}
            style={{
              background: "var(--accent)", color: "#fff",
              padding: "4px 10px", borderRadius: 4, fontSize: 12, fontWeight: 600,
            }}
          >+ New</button>
        </div>

        {/* New trip form */}
        {creating && (
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg3)" }}>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Trip name"
              style={{ width: "100%", marginBottom: 8 }}
              autoFocus
              onKeyDown={e => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setCreating(false); }}
            />
            <textarea
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              style={{ width: "100%", marginBottom: 8, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 5, marginBottom: 8, flexWrap: "wrap" }}>
              {PRESET_COLORS.map(c => (
                <button key={c} onClick={() => setNewColor(c)}
                  style={{
                    width: 22, height: 22, borderRadius: "50%", background: c,
                    border: c === newColor ? "2px solid #fff" : "2px solid transparent",
                  }}
                />
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleCreate} disabled={!newName.trim()}
                style={{
                  flex: 1, background: "var(--accent)", color: "#fff",
                  padding: "6px 0", borderRadius: 4, fontSize: 12, fontWeight: 600,
                  opacity: newName.trim() ? 1 : 0.4,
                }}>
                Create
              </button>
              <button onClick={() => setCreating(false)}
                style={{ padding: "6px 12px", borderRadius: 4, fontSize: 12, color: "var(--text2)" }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Trip list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {trips.length === 0 ? (
            <div style={{ padding: 24, color: "var(--text2)", textAlign: "center", fontSize: 13 }}>
              No trips yet.<br />Select photos in the Gallery<br />and assign them to a trip.
            </div>
          ) : (
            trips.map(trip => (
              <TripListItem
                key={trip.id}
                trip={trip}
                isSelected={selectedTrip?.id === trip.id}
                isEditing={editingId === trip.id}
                editName={editName}
                editDesc={editDesc}
                editColor={editColor}
                onSelect={() => navigate(`/trips/${trip.id}`)}
                onEdit={() => startEdit(trip)}
                onDelete={() => handleDelete(trip.id)}
                onSave={handleSaveEdit}
                onCancel={() => setEditingId(null)}
                onEditName={setEditName}
                onEditDesc={setEditDesc}
                onEditColor={setEditColor}
                presetColors={PRESET_COLORS}
              />
            ))
          )}
        </div>
      </div>

      {/* Trip detail */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {selectedTrip ? (
          <>
            {/* Header */}
            <div style={{
              padding: "14px 20px", background: "var(--bg2)",
              borderBottom: "1px solid var(--border)", flexShrink: 0,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{
                  width: 14, height: 14, borderRadius: "50%",
                  background: selectedTrip.color, flexShrink: 0, display: "inline-block",
                }} />
                <span style={{ fontWeight: 700, fontSize: 16 }}>{selectedTrip.name}</span>
                <span style={{ color: "var(--text2)", fontSize: 13 }}>
                  {photoTotal} photo{photoTotal !== 1 ? "s" : ""}
                </span>
              </div>
              {selectedTrip.description && (
                <div style={{ color: "var(--text2)", fontSize: 13, marginTop: 4 }}>
                  {selectedTrip.description}
                </div>
              )}
              {selectedTripPhotos.length > 0 && (
                <div style={{ color: "var(--text2)", fontSize: 12, marginTop: 4 }}>
                  {getTripDateRange(selectedTripPhotos)}
                </div>
              )}
            </div>

            {/* Photos grid */}
            <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
              {selectedTripPhotos.length === 0 && !loadingPhotos ? (
                <div style={{ color: "var(--text2)", textAlign: "center", paddingTop: 40, fontSize: 13 }}>
                  No photos in this trip yet.<br />
                  Select photos in the Gallery and assign them here.
                </div>
              ) : (
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                  gap: 6,
                }}>
                  {selectedTripPhotos.map(photo => (
                    <div
                      key={photo.id}
                      onClick={() => setLightboxId(photo.id)}
                      style={{
                        aspectRatio: "1", borderRadius: 6, overflow: "hidden",
                        cursor: "pointer", background: "var(--bg3)",
                      }}
                    >
                      <img
                        src={thumbnailUrl(photo.id)}
                        alt={photo.filename}
                        loading="lazy"
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    </div>
                  ))}
                </div>
              )}

              {!loadingPhotos && selectedTripPhotos.length < photoTotal && (
                <button
                  onClick={() => { const next = photoPage + 1; setPhotoPage(next); loadTripPhotos(selectedTrip.id, next, false); }}
                  style={{ display: "block", margin: "16px auto", color: "var(--accent)", padding: 8 }}
                >
                  Load more
                </button>
              )}
              {loadingPhotos && (
                <div style={{ textAlign: "center", color: "var(--text2)", padding: 20 }}>Loading...</div>
              )}
            </div>
          </>
        ) : (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", height: "100%", color: "var(--text2)", gap: 12,
          }}>
            <div style={{ fontSize: 48 }}>✈️</div>
            <div style={{ fontSize: 16 }}>Select a trip to view its photos</div>
            <div style={{ fontSize: 13 }}>
              {trips.length === 0
                ? 'Create a trip and assign photos from the Gallery'
                : 'Click a trip on the left'}
            </div>
          </div>
        )}
      </div>

      {lightboxId !== null && (
        <PhotoLightbox
          photoId={lightboxId}
          trips={trips}
          onClose={() => setLightboxId(null)}
          onTripChange={() => { if (selectedTrip) loadTripPhotos(selectedTrip.id, 1, true); onTripsChange(); }}
          onNext={() => {
            const ids = selectedTripPhotos.map(p => p.id);
            const idx = ids.indexOf(lightboxId);
            if (idx < ids.length - 1) setLightboxId(ids[idx + 1]);
          }}
          onPrev={() => {
            const ids = selectedTripPhotos.map(p => p.id);
            const idx = ids.indexOf(lightboxId);
            if (idx > 0) setLightboxId(ids[idx - 1]);
          }}
        />
      )}
    </div>
  );
}

function TripListItem({ trip, isSelected, isEditing, editName, editDesc, editColor,
  onSelect, onEdit, onDelete, onSave, onCancel, onEditName, onEditDesc, onEditColor, presetColors }: {
  trip: Trip; isSelected: boolean; isEditing: boolean;
  editName: string; editDesc: string; editColor: string;
  onSelect: () => void; onEdit: () => void; onDelete: () => void;
  onSave: () => void; onCancel: () => void;
  onEditName: (v: string) => void; onEditDesc: (v: string) => void; onEditColor: (v: string) => void;
  presetColors: string[];
}) {
  if (isEditing) {
    return (
      <div style={{ padding: "10px 16px", background: "var(--bg3)", borderBottom: "1px solid var(--border)" }}>
        <input value={editName} onChange={e => onEditName(e.target.value)}
          style={{ width: "100%", marginBottom: 6 }} autoFocus
          onKeyDown={e => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }}
        />
        <textarea value={editDesc} onChange={e => onEditDesc(e.target.value)}
          rows={2} style={{ width: "100%", marginBottom: 6, resize: "vertical" }}
          placeholder="Description" />
        <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
          {presetColors.map(c => (
            <button key={c} onClick={() => onEditColor(c)}
              style={{
                width: 20, height: 20, borderRadius: "50%", background: c,
                border: c === editColor ? "2px solid #fff" : "2px solid transparent",
              }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={onSave}
            style={{ flex: 1, background: "var(--accent)", color: "#fff", padding: "5px 0", borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
            Save
          </button>
          <button onClick={onCancel}
            style={{ padding: "5px 10px", borderRadius: 4, fontSize: 12, color: "var(--text2)" }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onSelect}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 16px", cursor: "pointer",
        background: isSelected ? "var(--bg3)" : "transparent",
        borderLeft: isSelected ? "2px solid var(--accent)" : "2px solid transparent",
        borderBottom: "1px solid var(--border)",
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "var(--bg3)"; }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ width: 12, height: 12, borderRadius: "50%", background: trip.color, flexShrink: 0 }} />
      <div style={{ flex: 1, overflow: "hidden" }}>
        <div style={{ fontWeight: 500, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {trip.name}
        </div>
        {trip.description && (
          <div style={{ fontSize: 11, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {trip.description}
          </div>
        )}
        <div style={{ fontSize: 11, color: "var(--text2)" }}>{trip.photo_count} photos</div>
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <button onClick={e => { e.stopPropagation(); onEdit(); }}
          style={{ color: "var(--text2)", fontSize: 12, padding: "2px 6px", borderRadius: 3 }}
          title="Edit">✎</button>
        <button onClick={e => { e.stopPropagation(); onDelete(); }}
          style={{ color: "var(--danger)", fontSize: 12, padding: "2px 6px", borderRadius: 3 }}
          title="Delete">✕</button>
      </div>
    </div>
  );
}
