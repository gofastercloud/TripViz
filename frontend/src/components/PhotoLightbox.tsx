import { useEffect, useState, useRef, useCallback } from "react";
import type { Trip } from "../types";
import { getPhoto, assignTrip, imageUrl, thumbnailUrl } from "../api/client";

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
  const [activeTab, setActiveTab] = useState<"info" | "histogram">("info");

  useEffect(() => {
    setPhoto(null);
    getPhoto(photoId).then(setPhoto).catch(() => {});
  }, [photoId]);

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

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.92)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {/* Nav prev */}
      <NavBtn direction="prev" onClick={e => { e.stopPropagation(); onPrev(); }} />

      {/* Main content */}
      <div onClick={e => e.stopPropagation()} style={{
        display: "flex", maxWidth: "95vw", maxHeight: "95vh",
        background: "var(--bg2)", borderRadius: 10, overflow: "hidden",
        boxShadow: "0 20px 60px rgba(0,0,0,0.8)",
      }}>
        {/* Image */}
        <img
          src={imageUrl(photoId)}
          alt=""
          style={{
            maxWidth: "70vw", maxHeight: "90vh",
            objectFit: "contain", display: "block", background: "#000",
            minWidth: 200,
          }}
        />

        {/* Side panel */}
        <div style={{
          width: 260, flexShrink: 0,
          background: "var(--bg2)", borderLeft: "1px solid var(--border)",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}>
          {/* Close button */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0,
          }}>
            <div style={{ display: "flex", gap: 0 }}>
              <TabBtn label="Info" active={activeTab === "info"} onClick={() => setActiveTab("info")} />
              <TabBtn label="Histogram" active={activeTab === "histogram"} onClick={() => setActiveTab("histogram")} />
            </div>
            <button onClick={onClose} style={{ color: "var(--text2)", fontSize: 16 }}>✕</button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
            {photo ? (
              activeTab === "info" ? (
                <InfoPanel photo={photo} trips={trips} assigning={assigning} onAssign={handleAssign} />
              ) : (
                <HistogramPanel photoId={photoId} />
              )
            ) : (
              <div style={{ color: "var(--text2)", paddingTop: 20, textAlign: "center" }}>Loading...</div>
            )}
          </div>
        </div>
      </div>

      {/* Nav next */}
      <NavBtn direction="next" onClick={e => { e.stopPropagation(); onNext(); }} />
    </div>
  );
}

// ------ Sub-components ------

function NavBtn({ direction, onClick }: { direction: "prev" | "next"; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        position: "absolute",
        [direction === "prev" ? "left" : "right"]: 16,
        top: "50%", transform: "translateY(-50%)",
        background: "rgba(255,255,255,0.1)", color: "#fff",
        width: 44, height: 44, borderRadius: "50%", fontSize: 22, zIndex: 10,
      }}
    >
      {direction === "prev" ? "‹" : "›"}
    </button>
  );
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "4px 12px", borderRadius: 4, fontSize: 12, fontWeight: active ? 600 : 400,
        background: active ? "var(--bg3)" : "transparent",
        color: active ? "var(--text)" : "var(--text2)",
        border: "1px solid " + (active ? "var(--border)" : "transparent"),
      }}
    >
      {label}
    </button>
  );
}

function InfoPanel({ photo, trips, assigning, onAssign }: {
  photo: NonNullable<Awaited<ReturnType<typeof getPhoto>>>;
  trips: Trip[];
  assigning: boolean;
  onAssign: (id: number | null) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, wordBreak: "break-all", color: "var(--text)" }}>
        {photo.filename}
      </div>

      <InfoRow label="Date">
        {photo.date_taken ? new Date(photo.date_taken).toLocaleString() : "Unknown"}
      </InfoRow>

      {(photo.camera_make || photo.camera_model) && (
        <InfoRow label="Camera">
          {[photo.camera_make, photo.camera_model].filter(Boolean).join(" ")}
        </InfoRow>
      )}

      {photo.width && photo.height && (
        <InfoRow label="Dimensions">{photo.width} × {photo.height}</InfoRow>
      )}

      <InfoRow label="File size">{formatBytes(photo.file_size)}</InfoRow>

      {photo.latitude != null && photo.longitude != null && (
        <InfoRow label="GPS">
          <a
            href={`https://www.openstreetmap.org/?mlat=${photo.latitude}&mlon=${photo.longitude}&zoom=14`}
            target="_blank" rel="noreferrer"
            style={{ fontSize: 12 }}
          >
            {photo.latitude.toFixed(5)}, {photo.longitude.toFixed(5)} ↗
          </a>
        </InfoRow>
      )}

      {/* Trip assignment */}
      <div>
        <div style={{ fontSize: 11, color: "var(--text2)", textTransform: "uppercase", marginBottom: 6 }}>Trip</div>
        {photo.trip_id ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: photo.trip_color ?? "#999", flexShrink: 0 }} />
            <span style={{ fontSize: 13 }}>{photo.trip_name}</span>
            <button onClick={() => onAssign(null)} disabled={assigning}
              style={{ marginLeft: "auto", color: "var(--text2)", fontSize: 11 }}>
              Remove
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 6 }}>Not in a trip</div>
        )}
        <select
          value={photo.trip_id ?? ""}
          onChange={e => onAssign(e.target.value ? Number(e.target.value) : null)}
          disabled={assigning}
          style={{ width: "100%", fontSize: 12 }}
        >
          <option value="">— assign to trip —</option>
          {trips.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
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

// ------ Histogram ------

interface ChannelData {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  lum: Uint32Array;
}

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
      // Scale down for performance
      const scale = Math.min(1, 400 / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const r = new Uint32Array(256);
      const g = new Uint32Array(256);
      const b = new Uint32Array(256);
      const lum = new Uint32Array(256);

      for (let i = 0; i < data.length; i += 4) {
        r[data[i]]++;
        g[data[i + 1]]++;
        b[data[i + 2]]++;
        // Perceived luminance
        const l = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        lum[l]++;
      }

      setChannelData({ r, g, b, lum });
      setLoading(false);
    };
    img.onerror = () => setLoading(false);
    img.src = src;
  }, []);

  useEffect(() => {
    analyzeImage(thumbnailUrl(photoId));
  }, [photoId, analyzeImage]);

  useEffect(() => {
    if (!channelData || !canvasRef.current) return;
    drawHistogram(canvasRef.current, channelData, activeChannels);
  }, [channelData, activeChannels]);

  const toggleChannel = (ch: keyof typeof activeChannels) => {
    setActiveChannels(prev => ({ ...prev, [ch]: !prev[ch] }));
  };

  return (
    <div>
      {loading ? (
        <div style={{ color: "var(--text2)", textAlign: "center", paddingTop: 20 }}>Analyzing...</div>
      ) : !channelData ? (
        <div style={{ color: "var(--text2)", textAlign: "center", paddingTop: 20 }}>Could not analyze image</div>
      ) : (
        <>
          <canvas
            ref={canvasRef}
            width={228}
            height={120}
            style={{ width: "100%", borderRadius: 6, display: "block", marginBottom: 10 }}
          />

          {/* Channel toggles */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {(["r", "g", "b", "lum"] as const).map(ch => {
              const colors = { r: "#EF4444", g: "#22C55E", b: "#3B82F6", lum: "#aaa" };
              const labels = { r: "Red", g: "Green", b: "Blue", lum: "Luma" };
              return (
                <button
                  key={ch}
                  onClick={() => toggleChannel(ch)}
                  style={{
                    padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                    background: activeChannels[ch] ? colors[ch] + "33" : "var(--bg3)",
                    border: `1px solid ${activeChannels[ch] ? colors[ch] : "var(--border)"}`,
                    color: activeChannels[ch] ? colors[ch] : "var(--text2)",
                  }}
                >
                  {labels[ch]}
                </button>
              );
            })}
          </div>

          {/* Stats */}
          <HistogramStats data={channelData} />
        </>
      )}
    </div>
  );
}

function drawHistogram(
  canvas: HTMLCanvasElement,
  data: ChannelData,
  active: Record<string, boolean>
) {
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = "#2a2a2a";
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const x = Math.round((i / 4) * W);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let i = 1; i < 3; i++) {
    const y = Math.round((i / 3) * H);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Find global max
  let max = 1;
  const channels: Array<{ key: keyof ChannelData; color: string }> = [
    { key: "lum", color: "rgba(180,180,180,0.7)" },
    { key: "r", color: "rgba(239,68,68,0.7)" },
    { key: "g", color: "rgba(34,197,94,0.7)" },
    { key: "b", color: "rgba(59,130,246,0.7)" },
  ];

  for (const ch of channels) {
    if (!active[ch.key]) continue;
    const arr = data[ch.key];
    for (let i = 0; i < 256; i++) if (arr[i] > max) max = arr[i];
  }

  // Draw each channel
  for (const ch of channels) {
    if (!active[ch.key]) continue;
    const arr = data[ch.key];
    ctx.fillStyle = ch.color;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * W;
      const h = (arr[i] / max) * H;
      ctx.lineTo(x, H - h);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }
}

function HistogramStats({ data }: { data: ChannelData }) {
  const mean = (arr: Uint32Array) => {
    let sum = 0, total = 0;
    for (let i = 0; i < 256; i++) { sum += i * arr[i]; total += arr[i]; }
    return total > 0 ? Math.round(sum / total) : 0;
  };
  const channels = [
    { label: "R", color: "#EF4444", val: mean(data.r) },
    { label: "G", color: "#22C55E", val: mean(data.g) },
    { label: "B", color: "#3B82F6", val: mean(data.b) },
    { label: "Luma", color: "#aaa", val: mean(data.lum) },
  ];
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--text2)", textTransform: "uppercase", marginBottom: 6 }}>Mean values</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
        {channels.map(ch => (
          <div key={ch.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
            <span style={{ color: ch.color }}>{ch.label}</span>
            <span>{ch.val}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: "var(--text2)" }}>
        White balance hint:{" "}
        {(() => {
          const r = mean(data.r), b = mean(data.b);
          if (r > b + 20) return "Warm (reddish)";
          if (b > r + 20) return "Cool (bluish)";
          return "Neutral";
        })()}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
