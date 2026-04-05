import { useEffect, useState, useRef, useCallback } from "react";
import type { Trip, FaceBox } from "../types";
import { getPhoto, getPhotoExif, assignTrip, updateNotes, imageUrl, thumbnailUrl, getPhotoFaces, analyzePhoto, editPhotoPreview, editPhotoSave } from "../api/client";
import type { EditParams } from "../api/client";

interface Props {
  photoId: number;
  trips: Trip[];
  onClose: () => void;
  onTripChange: () => void;
  onNext: () => void;
  onPrev: () => void;
}

export default function PhotoLightbox({ photoId, trips, onClose, onTripChange, onNext, onPrev }: Props) {
  const [photo, setPhoto] = useState<Awaited<ReturnType<typeof getPhoto>> | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [activeTab, setActiveTab] = useState<"info" | "notes" | "histogram" | "ml" | "edit">("info");
  const [faces, setFaces] = useState<FaceBox[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");

  const defaultEditParams: EditParams = {
    white_balance: "none", temperature: 0,
    filter: "none", brightness: 0, contrast: 0, saturation: 0,
  };
  const [editParams, setEditParams] = useState<EditParams>(defaultEditParams);
  const [editPreviewUrl, setEditPreviewUrl] = useState<string | null>(null);
  const [editPreviewing, setEditPreviewing] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editSaveMsg, setEditSaveMsg] = useState("");
  const editDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editPreviewRevoke = useRef<string | null>(null);

  const loadPhoto = useCallback(async (id: number) => {
    setPhoto(null);
    setEditParams(defaultEditParams);
    setEditPreviewUrl(null);
    setEditSaveMsg("");
    const [p, f] = await Promise.all([
      getPhoto(id).catch(() => null),
      getPhotoFaces(id).catch(() => [] as FaceBox[]),
    ]);
    setPhoto(p);
    setFaces(f);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadPhoto(photoId); }, [photoId, loadPhoto]);

  // Refresh edit preview whenever params or tab changes
  useEffect(() => {
    if (activeTab !== "edit") return;
    if (editDebounceRef.current) clearTimeout(editDebounceRef.current);
    editDebounceRef.current = setTimeout(async () => {
      setEditPreviewing(true);
      try {
        const url = await editPhotoPreview(photoId, editParams);
        if (editPreviewRevoke.current) URL.revokeObjectURL(editPreviewRevoke.current);
        editPreviewRevoke.current = url;
        setEditPreviewUrl(url);
      } catch { /* ignore */ }
      setEditPreviewing(false);
    }, 350);
    return () => { if (editDebounceRef.current) clearTimeout(editDebounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParams, activeTab, photoId]);

  // Revoke object URL on unmount
  useEffect(() => () => {
    if (editPreviewRevoke.current) URL.revokeObjectURL(editPreviewRevoke.current);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onNext();
      if (e.key === "ArrowLeft") onPrev();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, onNext, onPrev]);

  const handleAssign = async (tripId: number | null) => {
    if (!photo) return;
    setAssigning(true);
    try {
      const updated = await assignTrip(photo.id, tripId);
      setPhoto(updated);
      onTripChange();
    } catch {}
    setAssigning(false);
  };

  const handleAnalyze = async (runFaces: boolean, runActivities: boolean) => {
    setAnalyzing(true);
    setAnalyzeError("");
    try {
      const result = await analyzePhoto(photoId, { run_faces: runFaces, run_activities: runActivities });
      setFaces(result.faces);
      // Reload photo to get updated activities
      const updated = await getPhoto(photoId);
      setPhoto(updated);
    } catch (e: unknown) {
      setAnalyzeError(e instanceof Error ? e.message : "Analysis failed");
    }
    setAnalyzing(false);
  };

  const activities = photo?.activities ? JSON.parse(photo.activities) as string[] : [];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.92)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <NavBtn direction="prev" onClick={e => { e.stopPropagation(); onPrev(); }} />

      <div onClick={e => e.stopPropagation()} style={{
        display: "flex", maxWidth: "95vw", maxHeight: "95vh",
        background: "var(--bg2)", borderRadius: 10, overflow: "hidden",
        boxShadow: "0 20px 60px rgba(0,0,0,0.8)",
      }}>
        {/* Image with face overlays */}
        <div style={{ position: "relative", background: "#000", flexShrink: 0 }}>
          <img
            src={activeTab === "edit" && editPreviewUrl ? editPreviewUrl : imageUrl(photoId)}
            alt=""
            style={{
              maxWidth: "70vw", maxHeight: "90vh",
              objectFit: "contain", display: "block",
              opacity: activeTab === "edit" && editPreviewing ? 0.6 : 1,
              transition: "opacity 0.15s",
            }}
          />
          {faces.length > 0 && photo && (
            <FaceOverlay faces={faces} photo={photo} />
          )}

          {/* Activity chips on image */}
          {activities.length > 0 && (
            <div style={{
              position: "absolute", bottom: 8, left: 8,
              display: "flex", gap: 5, flexWrap: "wrap",
            }}>
              {activities.map(a => (
                <span key={a} style={{
                  background: "rgba(0,0,0,0.65)", color: "#fff",
                  padding: "3px 8px", borderRadius: 12, fontSize: 11,
                  backdropFilter: "blur(4px)",
                }}>{a}</span>
              ))}
            </div>
          )}
        </div>

        {/* Side panel */}
        <div style={{
          width: 300, flexShrink: 0,
          background: "var(--bg2)", borderLeft: "1px solid var(--border)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          {/* Tabs + close */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0,
          }}>
            <div style={{ display: "flex", gap: 2 }}>
              {(["info", "notes", "histogram", "ml", "edit"] as const).map(t => (
                <TabBtn key={t} label={t === "ml" ? "ML" : t.charAt(0).toUpperCase() + t.slice(1)}
                  active={activeTab === t} onClick={() => setActiveTab(t)} />
              ))}
            </div>
            <button onClick={onClose} style={{ color: "var(--text2)", fontSize: 16 }}>✕</button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
            {photo ? (
              activeTab === "info" ? (
                <InfoPanel photo={photo} trips={trips} assigning={assigning} onAssign={handleAssign} onPhotoUpdate={setPhoto} />
              ) : activeTab === "notes" ? (
                <NotesTagsPanel photo={photo} onPhotoUpdate={setPhoto} />
              ) : activeTab === "histogram" ? (
                <HistogramPanel photoId={photoId} />
              ) : activeTab === "edit" ? (
                <EditPanel
                  photoId={photoId}
                  params={editParams}
                  onChange={setEditParams}
                  saving={editSaving}
                  saveMsg={editSaveMsg}
                  onSave={async (mode) => {
                    setEditSaving(true);
                    setEditSaveMsg("");
                    try {
                      const result = await editPhotoSave(photoId, { ...editParams, save_mode: mode });
                      setEditSaveMsg(`Saved: ${result.filename}`);
                    } catch (e: unknown) {
                      setEditSaveMsg(e instanceof Error ? e.message : "Save failed");
                    }
                    setEditSaving(false);
                  }}
                  onReset={() => {
                    setEditParams(defaultEditParams);
                    setEditPreviewUrl(null);
                    setEditSaveMsg("");
                  }}
                />
              ) : (
                <MLTab
                  photo={photo}
                  faces={faces}
                  activities={activities}
                  analyzing={analyzing}
                  error={analyzeError}
                  onAnalyze={handleAnalyze}
                />
              )
            ) : (
              <div style={{ color: "var(--text2)", paddingTop: 20, textAlign: "center" }}>Loading…</div>
            )}
          </div>
        </div>
      </div>

      <NavBtn direction="next" onClick={e => { e.stopPropagation(); onNext(); }} />
    </div>
  );
}

// ── Face overlay on image ────────────────────────────────────────

function FaceOverlay({ faces, photo }: { faces: FaceBox[]; photo: ReturnType<typeof getPhoto> extends Promise<infer T> ? T : never }) {
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  return (
    <div style={{
      position: "absolute", inset: 0, pointerEvents: "none",
    }}>
      {faces.map(face => (
        <div
          key={face.id}
          onMouseEnter={() => setHoveredId(face.id)}
          onMouseLeave={() => setHoveredId(null)}
          style={{
            position: "absolute",
            left: `${face.bbox_x * 100}%`,
            top: `${face.bbox_y * 100}%`,
            width: `${face.bbox_w * 100}%`,
            height: `${face.bbox_h * 100}%`,
            border: `2px solid ${hoveredId === face.id ? "#fff" : "rgba(255,255,255,0.6)"}`,
            borderRadius: 4,
            cursor: "default",
            pointerEvents: "all",
            boxSizing: "border-box",
          }}
        >
          {/* Name label below box */}
          <div style={{
            position: "absolute", top: "100%", left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.75)", color: "#fff",
            padding: "2px 6px", borderRadius: 3, fontSize: 11,
            whiteSpace: "nowrap", marginTop: 2,
            opacity: hoveredId === face.id ? 1 : 0.8,
            pointerEvents: "none",
          }}>
            {face.person_name ?? "Unknown"}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Edit panel ───────────────────────────────────────────────────

const FILTERS: { key: EditParams["filter"]; label: string; color?: string }[] = [
  { key: "none",    label: "Original" },
  { key: "vivid",   label: "Vivid",   color: "#F59E0B" },
  { key: "muted",   label: "Muted",   color: "#9CA3AF" },
  { key: "warm",    label: "Warm",    color: "#EF8C34" },
  { key: "cool",    label: "Cool",    color: "#60A5FA" },
  { key: "bw",      label: "B&W",     color: "#D1D5DB" },
  { key: "vintage", label: "Vintage", color: "#A78BFA" },
];

function EditPanel({ params, onChange, saving, saveMsg, onSave, onReset }: {
  photoId: number;
  params: EditParams;
  onChange: (p: EditParams) => void;
  saving: boolean;
  saveMsg: string;
  onSave: (mode: "export" | "version") => void;
  onReset: () => void;
}) {
  const set = (patch: Partial<EditParams>) => onChange({ ...params, ...patch });

  const isDefault =
    params.white_balance === "none" &&
    params.temperature === 0 &&
    params.filter === "none" &&
    params.brightness === 0 &&
    params.contrast === 0 &&
    params.saturation === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* Filters */}
      <div>
        <div style={{ fontSize: 10, color: "var(--text2)", textTransform: "uppercase", marginBottom: 8 }}>Filter</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5 }}>
          {FILTERS.map(({ key, label, color }) => {
            const active = params.filter === key;
            return (
              <button key={key} onClick={() => set({ filter: key })} style={{
                padding: "5px 2px", borderRadius: 5, fontSize: 10,
                fontWeight: active ? 700 : 400,
                border: `1.5px solid ${active ? (color ?? "var(--accent)") : "var(--border)"}`,
                background: active ? (color ? color + "22" : "rgba(59,130,246,0.12)") : "var(--bg3)",
                color: active ? (color ?? "var(--accent)") : "var(--text2)",
                cursor: "pointer",
              }}>{label}</button>
            );
          })}
        </div>
      </div>

      {/* White balance */}
      <div>
        <div style={{ fontSize: 10, color: "var(--text2)", textTransform: "uppercase", marginBottom: 6 }}>White Balance</div>
        <button
          onClick={() => set({ white_balance: params.white_balance === "auto" ? "none" : "auto" })}
          style={{
            width: "100%", padding: "6px 0", borderRadius: 5, fontSize: 12,
            border: `1.5px solid ${params.white_balance === "auto" ? "var(--accent)" : "var(--border)"}`,
            background: params.white_balance === "auto" ? "rgba(59,130,246,0.12)" : "var(--bg3)",
            color: params.white_balance === "auto" ? "var(--accent)" : "var(--text2)",
            cursor: "pointer",
          }}
        >
          {params.white_balance === "auto" ? "Auto WB On" : "Auto WB"}
        </button>
      </div>

      {/* Temperature */}
      <EditSlider
        label="Temperature"
        value={params.temperature}
        min={-100} max={100}
        leftLabel="Cool" rightLabel="Warm"
        onChange={v => set({ temperature: v })}
      />

      {/* Fine tuning */}
      <div>
        <div style={{ fontSize: 10, color: "var(--text2)", textTransform: "uppercase", marginBottom: 8 }}>Adjustments</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <EditSlider label="Brightness" value={params.brightness} min={-100} max={100}
            onChange={v => set({ brightness: v })} />
          <EditSlider label="Contrast"   value={params.contrast}   min={-100} max={100}
            onChange={v => set({ contrast: v })} />
          <EditSlider label="Saturation" value={params.saturation} min={-100} max={100}
            onChange={v => set({ saturation: v })} />
        </div>
      </div>

      {/* Save buttons */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 4 }}>
        {!isDefault && (
          <button onClick={onReset} style={{
            padding: "5px 0", borderRadius: 5, fontSize: 11,
            border: "1px solid var(--border)", color: "var(--text2)",
          }}>Reset</button>
        )}
        <button
          onClick={() => onSave("export")}
          disabled={saving || isDefault}
          style={{
            width: "100%", padding: "7px 0", borderRadius: 6, fontSize: 12, fontWeight: 600,
            background: isDefault ? "var(--bg3)" : "var(--accent)", color: isDefault ? "var(--text2)" : "#fff",
            opacity: saving ? 0.5 : 1, cursor: isDefault ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Export as new file"}
        </button>
        <button
          onClick={() => onSave("version")}
          disabled={saving || isDefault}
          style={{
            width: "100%", padding: "6px 0", borderRadius: 6, fontSize: 12,
            border: "1px solid var(--border)", color: isDefault ? "var(--text2)" : "var(--text)",
            opacity: saving ? 0.5 : 1, cursor: isDefault ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save version"}
        </button>
        {saveMsg && (
          <div style={{
            fontSize: 11, padding: "6px 8px", borderRadius: 4,
            background: saveMsg.startsWith("Saved") ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
            border: `1px solid ${saveMsg.startsWith("Saved") ? "#22C55E" : "var(--danger)"}`,
            color: saveMsg.startsWith("Saved") ? "#4ADE80" : "#FCA5A5",
            wordBreak: "break-all",
          }}>{saveMsg}</div>
        )}
      </div>
    </div>
  );
}

function EditSlider({ label, value, min, max, leftLabel, rightLabel, onChange }: {
  label: string; value: number; min: number; max: number;
  leftLabel?: string; rightLabel?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: "var(--text2)" }}>{label}</span>
        <span style={{ fontSize: 11, color: value !== 0 ? "var(--accent)" : "var(--text2)" }}>
          {value > 0 ? `+${value}` : value}
        </span>
      </div>
      {leftLabel && (
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
          <span style={{ fontSize: 9, color: "var(--text2)" }}>{leftLabel}</span>
          <span style={{ fontSize: 9, color: "var(--text2)" }}>{rightLabel}</span>
        </div>
      )}
      <input
        type="range" min={min} max={max} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "var(--accent)" }}
      />
    </div>
  );
}

// ── ML tab ────────────────────────────────────────────────────────

function MLTab({ photo, faces, activities, analyzing, error, onAnalyze }: {
  photo: NonNullable<Awaited<ReturnType<typeof getPhoto>>>;
  faces: FaceBox[];
  activities: string[];
  analyzing: boolean;
  error: string;
  onAnalyze: (faces: boolean, activities: boolean) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Status */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <MLStatusRow label="Face analyzed" done={photo.face_analyzed} count={faces.length > 0 ? `${faces.length} face${faces.length !== 1 ? "s" : ""} found` : undefined} />
        <MLStatusRow label="Activities analyzed" done={photo.activity_analyzed} count={activities.length > 0 ? undefined : undefined} />
      </div>

      {/* Activities */}
      {activities.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: "var(--text2)", textTransform: "uppercase", marginBottom: 6 }}>Detected activities</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {activities.map(a => (
              <span key={a} style={{
                background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.3)",
                color: "var(--accent)", padding: "3px 10px", borderRadius: 12, fontSize: 12,
              }}>{a}</span>
            ))}
          </div>
        </div>
      )}

      {/* Face list */}
      {faces.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: "var(--text2)", textTransform: "uppercase", marginBottom: 6 }}>Detected faces</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {faces.map(face => (
              <div key={face.id} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "5px 8px", background: "var(--bg3)", borderRadius: 4, fontSize: 12,
              }}>
                <FaceCrop face={face} size={32} />
                <span>{face.person_name ?? <span style={{ color: "var(--text2)" }}>Unknown</span>}</span>
                <span style={{ marginLeft: "auto", color: "var(--text2)", fontSize: 10 }}>
                  {Math.round(face.confidence * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div style={{
          background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)",
          borderRadius: 5, padding: "7px 10px", fontSize: 12, color: "#FCA5A5",
        }}>{error}</div>
      )}

      {/* Analyze buttons */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
        <button
          onClick={() => onAnalyze(true, true)}
          disabled={analyzing}
          style={{
            width: "100%", background: "var(--accent)", color: "#fff",
            padding: "7px 0", borderRadius: 6, fontSize: 12, fontWeight: 600,
            opacity: analyzing ? 0.5 : 1,
          }}
        >
          {analyzing ? "Analyzing…" : "Analyze (Faces + Activities)"}
        </button>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => onAnalyze(true, false)} disabled={analyzing}
            style={{ flex: 1, padding: "6px 0", borderRadius: 5, fontSize: 11, border: "1px solid var(--border)", color: "var(--text2)", opacity: analyzing ? 0.5 : 1 }}>
            Faces only
          </button>
          <button onClick={() => onAnalyze(false, true)} disabled={analyzing}
            style={{ flex: 1, padding: "6px 0", borderRadius: 5, fontSize: 11, border: "1px solid var(--border)", color: "var(--text2)", opacity: analyzing ? 0.5 : 1 }}>
            Activities only
          </button>
        </div>
      </div>
    </div>
  );
}

function MLStatusRow({ label, done, count }: { label: string; done: boolean; count?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: done ? "#22C55E" : "#555", flexShrink: 0,
      }} />
      <span style={{ flex: 1, color: "var(--text2)" }}>{label}</span>
      {count && <span style={{ color: "var(--text)" }}>{count}</span>}
    </div>
  );
}

function FaceCrop({ face, size }: { face: FaceBox; size: number }) {
  const pad = 0.1;
  const scale = Math.min(100 / (face.bbox_w + pad * 2), 100 / (face.bbox_h + pad * 2));
  const bgX = -((face.bbox_x - pad) * scale);
  const bgY = -((face.bbox_y - pad) * scale);
  return (
    <div style={{
      width: size, height: size, borderRadius: 4, overflow: "hidden",
      flexShrink: 0, background: "var(--bg2)",
      backgroundImage: `url(${thumbnailUrl(face.photo_id)})`,
      backgroundSize: `${scale}%`,
      backgroundPosition: `${bgX}% ${bgY}%`,
      backgroundRepeat: "no-repeat",
    }} />
  );
}

// ── Info panel ────────────────────────────────────────────────────

function InfoPanel({ photo, trips, assigning, onAssign, onPhotoUpdate }: {
  photo: NonNullable<Awaited<ReturnType<typeof getPhoto>>>;
  trips: Trip[];
  assigning: boolean;
  onAssign: (id: number | null) => void;
  onPhotoUpdate: (p: NonNullable<Awaited<ReturnType<typeof getPhoto>>>) => void;
}) {
  const [exif, setExif] = useState<Record<string, unknown> | null>(null);
  const [exifLoading, setExifLoading] = useState(true);

  useEffect(() => {
    setExifLoading(true);
    getPhotoExif(photo.id).then(setExif).catch(() => setExif(null)).finally(() => setExifLoading(false));
  }, [photo.id]);

  const activities = photo.activities ? JSON.parse(photo.activities) as string[] : [];

  // Helper to format shutter speed from decimal seconds
  const fmtShutter = (v: unknown): string => {
    if (typeof v === "number") return v >= 1 ? `${v}s` : `1/${Math.round(1 / v)}s`;
    return String(v ?? "");
  };

  const fmtFocal = (v: unknown): string => {
    if (typeof v === "number") return `${v}mm`;
    return String(v ?? "");
  };

  const fmtAperture = (v: unknown): string => {
    if (typeof v === "number") return `f/${v}`;
    return String(v ?? "");
  };

  // Extract GPS display
  const gps = exif?.GPS as Record<string, unknown> | undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, wordBreak: "break-all" }}>{photo.filename}</div>

      <InfoRow label="Date">
        {photo.date_taken ? new Date(photo.date_taken).toLocaleString() : "Unknown"}
      </InfoRow>

      {/* Camera & Lens */}
      {(photo.camera_make || photo.camera_model) && (
        <InfoRow label="Camera">
          {[photo.camera_make, photo.camera_model].filter(Boolean).join(" ")}
        </InfoRow>
      )}

      {exif?.LensModel != null && (
        <InfoRow label="Lens">{String(exif.LensModel)}</InfoRow>
      )}

      {/* Exposure section */}
      {exif && (exif.ExposureTime != null || exif.FNumber != null || exif.ISOSpeedRatings != null) && (
        <div>
          <div style={{ fontSize: 10, color: "var(--text2)", textTransform: "uppercase", marginBottom: 5 }}>Exposure</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 12px", fontSize: 12 }}>
            {exif.ExposureTime != null && <><span style={{ color: "var(--text2)" }}>Shutter</span><span>{fmtShutter(exif.ExposureTime)}</span></>}
            {exif.FNumber != null && <><span style={{ color: "var(--text2)" }}>Aperture</span><span>{fmtAperture(exif.FNumber)}</span></>}
            {exif.ISOSpeedRatings != null && <><span style={{ color: "var(--text2)" }}>ISO</span><span>{String(exif.ISOSpeedRatings)}</span></>}
            {exif.FocalLength != null && <><span style={{ color: "var(--text2)" }}>Focal length</span><span>{fmtFocal(exif.FocalLength)}</span></>}
            {exif.FocalLengthIn35mmFilm != null && <><span style={{ color: "var(--text2)" }}>35mm equiv.</span><span>{fmtFocal(exif.FocalLengthIn35mmFilm)}</span></>}
            {exif.ExposureBiasValue != null && <><span style={{ color: "var(--text2)" }}>Exp. comp.</span><span>{Number(exif.ExposureBiasValue) >= 0 ? "+" : ""}{Number(exif.ExposureBiasValue).toFixed(1)} EV</span></>}
            {exif.MeteringMode != null && <><span style={{ color: "var(--text2)" }}>Metering</span><span>{METERING_MODES[Number(exif.MeteringMode)] ?? String(exif.MeteringMode)}</span></>}
            {exif.Flash != null && <><span style={{ color: "var(--text2)" }}>Flash</span><span>{Number(exif.Flash) & 1 ? "Fired" : "No flash"}</span></>}
            {exif.WhiteBalance != null && <><span style={{ color: "var(--text2)" }}>White bal.</span><span>{Number(exif.WhiteBalance) === 0 ? "Auto" : "Manual"}</span></>}
          </div>
        </div>
      )}

      {/* Dimensions & file */}
      <div>
        <div style={{ fontSize: 10, color: "var(--text2)", textTransform: "uppercase", marginBottom: 5 }}>Image</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 12px", fontSize: 12 }}>
          {photo.width && photo.height && <><span style={{ color: "var(--text2)" }}>Resolution</span><span>{photo.width} × {photo.height}</span></>}
          {photo.width && photo.height && <><span style={{ color: "var(--text2)" }}>Megapixels</span><span>{((photo.width * photo.height) / 1e6).toFixed(1)} MP</span></>}
          <><span style={{ color: "var(--text2)" }}>File size</span><span>{formatBytes(photo.file_size)}</span></>
          {exif?.ColorSpace != null && <><span style={{ color: "var(--text2)" }}>Color space</span><span>{Number(exif.ColorSpace) === 1 ? "sRGB" : Number(exif.ColorSpace) === 0xFFFF ? "Uncalibrated" : String(exif.ColorSpace)}</span></>}
        </div>
      </div>

      {/* GPS */}
      {photo.latitude != null && photo.longitude != null && (
        <div>
          <div style={{ fontSize: 10, color: "var(--text2)", textTransform: "uppercase", marginBottom: 5 }}>Location</div>
          <div style={{ fontSize: 12, marginBottom: 4 }}>
            <a
              href={`https://www.openstreetmap.org/?mlat=${photo.latitude}&mlon=${photo.longitude}&zoom=14`}
              target="_blank" rel="noreferrer"
            >
              {photo.latitude.toFixed(5)}, {photo.longitude.toFixed(5)} ↗
            </a>
          </div>
          {gps?.GPSAltitude != null && (
            <div style={{ fontSize: 12, color: "var(--text2)" }}>
              Altitude: {Number(gps.GPSAltitude).toFixed(1)}m {gps.GPSAltitudeRef === 1 ? "below sea level" : ""}
            </div>
          )}
          {gps?.GPSSpeed != null && (
            <div style={{ fontSize: 12, color: "var(--text2)" }}>
              Speed: {Number(gps.GPSSpeed).toFixed(1)} {gps.GPSSpeedRef === "K" ? "km/h" : gps.GPSSpeedRef === "M" ? "mph" : "knots"}
            </div>
          )}
          {gps?.GPSImgDirection != null && (
            <div style={{ fontSize: 12, color: "var(--text2)" }}>
              Direction: {Number(gps.GPSImgDirection).toFixed(0)}°
            </div>
          )}
        </div>
      )}

      {activities.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: "var(--text2)", textTransform: "uppercase", marginBottom: 5 }}>Activities</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {activities.map(a => (
              <span key={a} style={{
                background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.25)",
                color: "var(--accent)", padding: "2px 8px", borderRadius: 10, fontSize: 11,
              }}>{a}</span>
            ))}
          </div>
        </div>
      )}

      {/* Trip */}
      <div>
        <div style={{ fontSize: 10, color: "var(--text2)", textTransform: "uppercase", marginBottom: 6 }}>Trip</div>
        {photo.trip_id ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: photo.trip_color ?? "#999", flexShrink: 0 }} />
            <span style={{ fontSize: 13 }}>{photo.trip_name}</span>
            <button onClick={() => onAssign(null)} disabled={assigning}
              style={{ marginLeft: "auto", color: "var(--text2)", fontSize: 11 }}>Remove</button>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 6 }}>Not in a trip</div>
        )}
        <select value={photo.trip_id ?? ""} onChange={e => onAssign(e.target.value ? Number(e.target.value) : null)}
          disabled={assigning} style={{ width: "100%", fontSize: 12 }}>
          <option value="">— assign to trip —</option>
          {trips.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {/* Raw EXIF data (collapsible) */}
      {exif && !exifLoading && <ExifRawSection exif={exif} />}
    </div>
  );
}

const METERING_MODES: Record<number, string> = {
  0: "Unknown", 1: "Average", 2: "Center-weighted", 3: "Spot",
  4: "Multi-spot", 5: "Pattern", 6: "Partial",
};

function ExifRawSection({ exif }: { exif: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const SKIP = new Set(["MakerNote", "UserComment", "ExifOffset", "GPSInfo", "PrintImageMatching", "ComponentsConfiguration", "FlashPixVersion", "ExifVersion"]);
  const entries = Object.entries(exif).filter(([k]) => !SKIP.has(k) && k !== "GPS");

  return (
    <div>
      <button onClick={() => setOpen(!open)} style={{
        fontSize: 10, color: "var(--text2)", textTransform: "uppercase",
        background: "none", border: "none", cursor: "pointer", padding: 0,
      }}>
        {open ? "▾" : "▸"} All EXIF tags ({entries.length})
      </button>
      {open && (
        <div style={{ marginTop: 6, fontSize: 11, maxHeight: 300, overflowY: "auto" }}>
          {entries.map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0", borderBottom: "1px solid var(--border)" }}>
              <span style={{ color: "var(--text2)", flexShrink: 0 }}>{k}</span>
              <span style={{ textAlign: "right", wordBreak: "break-all" }}>{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NotesTagsPanel({ photo, onPhotoUpdate }: {
  photo: NonNullable<Awaited<ReturnType<typeof getPhoto>>>;
  onPhotoUpdate: (p: NonNullable<Awaited<ReturnType<typeof getPhoto>>>) => void;
}) {
  const [notesValue, setNotesValue] = useState(photo.notes ?? "");
  const [notesSaving, setNotesSaving] = useState(false);
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setNotesValue(photo.notes ?? ""); }, [photo.id, photo.notes]);

  const saveNotes = useCallback((value: string) => {
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(async () => {
      setNotesSaving(true);
      try {
        const updated = await updateNotes(photo.id, value || null);
        onPhotoUpdate(updated);
      } catch {}
      setNotesSaving(false);
    }, 600);
  }, [photo.id, onPhotoUpdate]);

  const locationTags = photo.tags ? JSON.parse(photo.tags) as string[] : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Notes */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <div style={{ fontSize: 10, color: "var(--text2)", textTransform: "uppercase" }}>Notes</div>
          {notesSaving && <span style={{ fontSize: 10, color: "var(--text2)" }}>saving...</span>}
        </div>
        <textarea
          value={notesValue}
          onChange={e => {
            const v = e.target.value.slice(0, 250);
            setNotesValue(v);
            saveNotes(v);
          }}
          placeholder="Add a note about this photo..."
          maxLength={250}
          rows={4}
          style={{
            width: "100%", fontSize: 12, resize: "vertical",
            padding: "8px 10px", borderRadius: 6,
            background: "var(--bg3)", border: "1px solid var(--border)",
            color: "var(--text)",
          }}
        />
        <div style={{ fontSize: 10, color: "var(--text2)", textAlign: "right", marginTop: 2 }}>
          {notesValue.length}/250
        </div>
      </div>

      {/* Location tags */}
      <div>
        <div style={{ fontSize: 10, color: "var(--text2)", textTransform: "uppercase", marginBottom: 6 }}>Location Tags</div>
        {locationTags.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {locationTags.map(t => (
              <span key={t} style={{
                background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.25)",
                color: "#22C55E", padding: "3px 10px", borderRadius: 12, fontSize: 12,
              }}>{t}</span>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--text2)" }}>
            No location tags — photo may lack GPS data or hasn't been geo-tagged yet.
          </div>
        )}
      </div>

      {/* Activity tags (from ML) */}
      {photo.activities && (
        <div>
          <div style={{ fontSize: 10, color: "var(--text2)", textTransform: "uppercase", marginBottom: 6 }}>Activity Tags</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {(JSON.parse(photo.activities) as string[]).map(a => (
              <span key={a} style={{
                background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.25)",
                color: "var(--accent)", padding: "3px 10px", borderRadius: 12, fontSize: 12,
              }}>{a}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--text2)", textTransform: "uppercase", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12 }}>{children}</div>
    </div>
  );
}

// ── Histogram ────────────────────────────────────────────────────

interface ChannelData { r: Uint32Array; g: Uint32Array; b: Uint32Array; lum: Uint32Array; }

function HistogramPanel({ photoId }: { photoId: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [channelData, setChannelData] = useState<ChannelData | null>(null);
  const [activeChannels, setActiveChannels] = useState({ r: true, g: true, b: true, lum: false });
  const [loading, setLoading] = useState(true);

  const analyzeImage = useCallback((src: string) => {
    setLoading(true);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 400 / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const r = new Uint32Array(256), g = new Uint32Array(256),
            b = new Uint32Array(256), lum = new Uint32Array(256);
      for (let i = 0; i < data.length; i += 4) {
        r[data[i]]++; g[data[i + 1]]++; b[data[i + 2]]++;
        lum[Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])]++;
      }
      setChannelData({ r, g, b, lum });
      setLoading(false);
    };
    img.onerror = () => setLoading(false);
    img.src = src;
  }, []);

  useEffect(() => { analyzeImage(thumbnailUrl(photoId)); }, [photoId, analyzeImage]);

  useEffect(() => {
    if (!channelData || !canvasRef.current) return;
    drawHistogram(canvasRef.current, channelData, activeChannels);
  }, [channelData, activeChannels]);

  const toggle = (ch: keyof typeof activeChannels) =>
    setActiveChannels(prev => ({ ...prev, [ch]: !prev[ch] }));

  return (
    <div>
      {loading ? (
        <div style={{ color: "var(--text2)", textAlign: "center", paddingTop: 20 }}>Analyzing…</div>
      ) : !channelData ? (
        <div style={{ color: "var(--text2)", textAlign: "center", paddingTop: 20 }}>Could not analyze</div>
      ) : (
        <>
          <canvas ref={canvasRef} width={234} height={120}
            style={{ width: "100%", borderRadius: 6, display: "block", marginBottom: 10 }} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            {(["r","g","b","lum"] as const).map(ch => {
              const colors = { r: "#EF4444", g: "#22C55E", b: "#3B82F6", lum: "#aaa" };
              const labels = { r: "Red", g: "Green", b: "Blue", lum: "Luma" };
              return (
                <button key={ch} onClick={() => toggle(ch)} style={{
                  padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                  background: activeChannels[ch] ? colors[ch] + "33" : "var(--bg3)",
                  border: `1px solid ${activeChannels[ch] ? colors[ch] : "var(--border)"}`,
                  color: activeChannels[ch] ? colors[ch] : "var(--text2)",
                }}>{labels[ch]}</button>
              );
            })}
          </div>
          <HistogramStats data={channelData} />
        </>
      )}
    </div>
  );
}

function drawHistogram(canvas: HTMLCanvasElement, data: ChannelData, active: Record<string, boolean>) {
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#111"; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#2a2a2a"; ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) { const x = Math.round((i/4)*W); ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let i = 1; i < 3; i++) { const y = Math.round((i/3)*H); ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  let max = 1;
  const channels = [
    { key: "lum" as const, color: "rgba(180,180,180,0.7)" },
    { key: "r" as const, color: "rgba(239,68,68,0.7)" },
    { key: "g" as const, color: "rgba(34,197,94,0.7)" },
    { key: "b" as const, color: "rgba(59,130,246,0.7)" },
  ];
  for (const ch of channels) {
    if (!active[ch.key]) continue;
    const arr = data[ch.key];
    for (let i = 0; i < 256; i++) if (arr[i] > max) max = arr[i];
  }
  for (const ch of channels) {
    if (!active[ch.key]) continue;
    const arr = data[ch.key];
    ctx.fillStyle = ch.color;
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let i = 0; i < 256; i++) ctx.lineTo((i/255)*W, H - (arr[i]/max)*H);
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  }
}

function HistogramStats({ data }: { data: ChannelData }) {
  const mean = (arr: Uint32Array) => {
    let sum = 0, total = 0;
    for (let i = 0; i < 256; i++) { sum += i * arr[i]; total += arr[i]; }
    return total > 0 ? Math.round(sum / total) : 0;
  };
  const r = mean(data.r), b = mean(data.b);
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--text2)", textTransform: "uppercase", marginBottom: 6 }}>Mean values</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 8 }}>
        {[{ l: "R", c: "#EF4444", v: r },{ l: "G", c: "#22C55E", v: mean(data.g) },
          { l: "B", c: "#3B82F6", v: b },{ l: "Luma", c: "#aaa", v: mean(data.lum) }]
          .map(ch => (
            <div key={ch.l} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ color: ch.c }}>{ch.l}</span><span>{ch.v}</span>
            </div>
          ))}
      </div>
      <div style={{ fontSize: 11, color: "var(--text2)" }}>
        White balance: {r > b + 20 ? "Warm (reddish)" : b > r + 20 ? "Cool (bluish)" : "Neutral"}
      </div>
    </div>
  );
}

// ── Shared ────────────────────────────────────────────────────────

function NavBtn({ direction, onClick }: { direction: "prev" | "next"; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button onClick={onClick} style={{
      position: "absolute", [direction === "prev" ? "left" : "right"]: 16,
      top: "50%", transform: "translateY(-50%)",
      background: "rgba(255,255,255,0.1)", color: "#fff",
      width: 44, height: 44, borderRadius: "50%", fontSize: 22, zIndex: 10,
    }}>{direction === "prev" ? "‹" : "›"}</button>
  );
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: "4px 8px", borderRadius: 4, fontSize: 11, fontWeight: active ? 600 : 400,
      background: active ? "var(--bg3)" : "transparent",
      color: active ? "var(--text)" : "var(--text2)",
      border: "1px solid " + (active ? "var(--border)" : "transparent"),
    }}>{label}</button>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
