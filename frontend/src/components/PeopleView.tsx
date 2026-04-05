import { useState, useEffect, useCallback } from "react";
import type { Person, Photo, FaceBox } from "../types";
import { getPeople, renamePerson, deletePerson, mergePeople, getPersonPhotos, thumbnailUrl } from "../api/client";
import PhotoLightbox from "./PhotoLightbox";
import type { Trip } from "../types";

interface Props {
  trips: Trip[];
  onTripsChange: () => void;
}

// Renders a face crop from a thumbnail as a circular avatar
function FaceAvatar({ face, size = 64 }: { face: FaceBox; size?: number }) {
  const thumbSize = size * 3; // enlarge the face crop
  // Compute CSS to crop the thumbnail to just the face region
  const scaleX = 100 / face.bbox_w;
  const scaleY = 100 / face.bbox_h;
  const scale = Math.min(scaleX, scaleY);
  const bgW = scale;
  const bgH = scale;
  const bgX = -(face.bbox_x * scale);
  const bgY = -(face.bbox_y * scale);

  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", overflow: "hidden",
      flexShrink: 0, background: "var(--bg3)", border: "2px solid var(--border)",
    }}>
      <div style={{
        width: size, height: size,
        backgroundImage: `url(${thumbnailUrl(face.photo_id)})`,
        backgroundSize: `${bgW}% ${bgH}%`,
        backgroundPosition: `${bgX}% ${bgY}%`,
        backgroundRepeat: "no-repeat",
      }} />
    </div>
  );
}

export default function PeopleView({ trips, onTripsChange }: Props) {
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Person | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoTotal, setPhotoTotal] = useState(0);
  const [photoPage, setPhotoPage] = useState(1);
  const [lightboxId, setLightboxId] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<Person | null>(null);
  const [loadingPhotos, setLoadingPhotos] = useState(false);

  const loadPeople = useCallback(async () => {
    try { setPeople(await getPeople()); } catch {}
  }, []);

  useEffect(() => { loadPeople(); }, [loadPeople]);

  const loadPersonPhotos = useCallback(async (person: Person, page: number, reset: boolean) => {
    setLoadingPhotos(true);
    try {
      const res = await getPersonPhotos(person.id, page, 60);
      setPhotoTotal(res.total);
      setPhotos(prev => reset ? res.photos : [...prev, ...res.photos]);
    } catch {}
    setLoadingPhotos(false);
  }, []);

  useEffect(() => {
    if (selected) {
      setPhotoPage(1);
      loadPersonPhotos(selected, 1, true);
    } else {
      setPhotos([]);
    }
  }, [selected, loadPersonPhotos]);

  const handleRename = async (person: Person) => {
    if (!renameValue.trim()) return;
    await renamePerson(person.id, renameValue.trim());
    setRenamingId(null);
    loadPeople();
  };

  const handleDelete = async (person: Person) => {
    if (!confirm(`Remove "${person.name}" from People? Face detections are kept but unassigned.`)) return;
    await deletePerson(person.id);
    if (selected?.id === person.id) setSelected(null);
    loadPeople();
  };

  const handleMerge = async (source: Person) => {
    if (!mergeTarget || mergeTarget.id === source.id) return;
    await mergePeople(source.id, mergeTarget.id);
    setMergeMode(false);
    setMergeTarget(null);
    if (selected?.id === source.id) setSelected(mergeTarget);
    loadPeople();
  };

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* People grid sidebar */}
      <div style={{
        width: 280, flexShrink: 0,
        background: "var(--bg2)", borderRight: "1px solid var(--border)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", borderBottom: "1px solid var(--border)",
        }}>
          <div style={{ fontWeight: 600 }}>People</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => { setMergeMode(m => !m); setMergeTarget(null); }}
              style={{
                fontSize: 11, padding: "3px 8px", borderRadius: 4,
                background: mergeMode ? "var(--accent)" : "var(--bg3)",
                border: "1px solid var(--border)",
                color: mergeMode ? "#fff" : "var(--text2)",
              }}
            >
              {mergeMode ? "Cancel merge" : "Merge"}
            </button>
          </div>
        </div>

        {mergeMode && (
          <div style={{ padding: "8px 16px", background: "rgba(59,130,246,0.08)", borderBottom: "1px solid var(--border)", fontSize: 12, color: "var(--text2)" }}>
            {mergeTarget
              ? `Merging into "${mergeTarget.name}" — click another person to merge them in`
              : "Click a person to set as merge target"}
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
          {people.length === 0 ? (
            <div style={{ padding: "24px 16px", color: "var(--text2)", textAlign: "center", fontSize: 13 }}>
              No people detected yet.<br />
              Use ML Features → Analyze to detect faces.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {people.map(person => (
                <PersonRow
                  key={person.id}
                  person={person}
                  isSelected={selected?.id === person.id}
                  isRenamingId={renamingId}
                  renameValue={renameValue}
                  mergeMode={mergeMode}
                  mergeTarget={mergeTarget}
                  onSelect={() => {
                    if (mergeMode) {
                      if (!mergeTarget) {
                        setMergeTarget(person);
                      } else {
                        handleMerge(person);
                      }
                    } else {
                      setSelected(p => p?.id === person.id ? null : person);
                    }
                  }}
                  onStartRename={() => { setRenamingId(person.id); setRenameValue(person.name); }}
                  onRename={() => handleRename(person)}
                  onCancelRename={() => setRenamingId(null)}
                  onRenameChange={setRenameValue}
                  onDelete={() => handleDelete(person)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Person photo detail */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {selected ? (
          <>
            {/* Header */}
            <div style={{
              padding: "14px 20px", background: "var(--bg2)",
              borderBottom: "1px solid var(--border)", flexShrink: 0,
              display: "flex", alignItems: "center", gap: 14,
            }}>
              {selected.cover_face && <FaceAvatar face={selected.cover_face} size={48} />}
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{selected.name}</div>
                <div style={{ color: "var(--text2)", fontSize: 13 }}>
                  {photoTotal} photo{photoTotal !== 1 ? "s" : ""}
                </div>
              </div>
            </div>

            {/* Photos grid */}
            <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
              {photos.length === 0 && !loadingPhotos ? (
                <div style={{ color: "var(--text2)", textAlign: "center", paddingTop: 40 }}>
                  No photos found for this person.
                </div>
              ) : (
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                  gap: 6,
                }}>
                  {photos.map(photo => (
                    <div
                      key={photo.id}
                      onClick={() => setLightboxId(photo.id)}
                      style={{
                        aspectRatio: "1", borderRadius: 6, overflow: "hidden",
                        cursor: "pointer", background: "var(--bg3)",
                      }}
                    >
                      <img src={thumbnailUrl(photo.id)} alt={photo.filename}
                        loading="lazy"
                        style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    </div>
                  ))}
                </div>
              )}
              {!loadingPhotos && photos.length < photoTotal && (
                <button
                  onClick={() => { const next = photoPage + 1; setPhotoPage(next); loadPersonPhotos(selected, next, false); }}
                  style={{ display: "block", margin: "16px auto", color: "var(--accent)", padding: 8 }}
                >
                  Load more
                </button>
              )}
              {loadingPhotos && <div style={{ textAlign: "center", color: "var(--text2)", padding: 20 }}>Loading…</div>}
            </div>
          </>
        ) : (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", height: "100%", color: "var(--text2)", gap: 14,
          }}>
            {people.length > 0 ? (
              <>
                <div style={{ fontSize: 40 }}>👤</div>
                <div style={{ fontSize: 15 }}>Select a person to see their photos</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 40 }}>🤖</div>
                <div style={{ fontSize: 15 }}>No faces detected yet</div>
                <div style={{ fontSize: 13 }}>Open ML Features and run face analysis</div>
              </>
            )}
          </div>
        )}
      </div>

      {lightboxId !== null && (
        <PhotoLightbox
          photoId={lightboxId}
          trips={trips}
          onClose={() => setLightboxId(null)}
          onTripChange={onTripsChange}
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

function PersonRow({ person, isSelected, isRenamingId, renameValue, mergeMode, mergeTarget,
  onSelect, onStartRename, onRename, onCancelRename, onRenameChange, onDelete }: {
  person: Person; isSelected: boolean; isRenamingId: number | null;
  renameValue: string; mergeMode: boolean; mergeTarget: Person | null;
  onSelect: () => void; onStartRename: () => void; onRename: () => void;
  onCancelRename: () => void; onRenameChange: (v: string) => void; onDelete: () => void;
}) {
  const isRenaming = isRenamingId === person.id;
  const isMergeTarget = mergeTarget?.id === person.id;

  return (
    <div
      onClick={onSelect}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
        borderRadius: 6, cursor: "pointer",
        background: isSelected ? "var(--bg3)" : isMergeTarget ? "rgba(59,130,246,0.15)" : "transparent",
        border: isMergeTarget ? "1px solid var(--accent)" : "1px solid transparent",
      }}
      onMouseEnter={e => { if (!isSelected && !isMergeTarget) e.currentTarget.style.background = "var(--bg3)"; }}
      onMouseLeave={e => { if (!isSelected && !isMergeTarget) e.currentTarget.style.background = "transparent"; }}
    >
      {person.cover_face
        ? <FaceAvatar face={person.cover_face} size={44} />
        : (
          <div style={{
            width: 44, height: 44, borderRadius: "50%",
            background: "var(--bg3)", display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 20, flexShrink: 0,
          }}>👤</div>
        )}

      <div style={{ flex: 1, overflow: "hidden" }}>
        {isRenaming ? (
          <input
            value={renameValue}
            onChange={e => onRenameChange(e.target.value)}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === "Enter") onRename();
              if (e.key === "Escape") onCancelRename();
            }}
            autoFocus
            style={{ width: "100%", fontSize: 13 }}
          />
        ) : (
          <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {person.name}
          </div>
        )}
        <div style={{ fontSize: 11, color: "var(--text2)" }}>
          {person.face_count} appearance{person.face_count !== 1 ? "s" : ""}
        </div>
      </div>

      {!mergeMode && (
        <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
          {isRenaming ? (
            <>
              <button onClick={e => { e.stopPropagation(); onRename(); }}
                style={{ fontSize: 11, padding: "2px 6px", borderRadius: 3, background: "var(--accent)", color: "#fff" }}>
                ✓
              </button>
              <button onClick={e => { e.stopPropagation(); onCancelRename(); }}
                style={{ fontSize: 11, padding: "2px 6px", borderRadius: 3, color: "var(--text2)" }}>
                ✕
              </button>
            </>
          ) : (
            <>
              <button onClick={e => { e.stopPropagation(); onStartRename(); }}
                style={{ color: "var(--text2)", fontSize: 12, padding: "2px 5px", borderRadius: 3 }}
                title="Rename">✎</button>
              <button onClick={e => { e.stopPropagation(); onDelete(); }}
                style={{ color: "var(--danger)", fontSize: 12, padding: "2px 5px", borderRadius: 3 }}
                title="Remove">✕</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
