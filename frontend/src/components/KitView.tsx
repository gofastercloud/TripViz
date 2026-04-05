import { useState, useEffect } from "react";
import { getKit, getPhotos, thumbnailUrl, type KitDevice, type KitLens } from "../api/client";
import type { Photo } from "../types";
import PhotoLightbox from "./PhotoLightbox";
import type { Trip } from "../types";

interface Props {
  trips: Trip[];
  onTripsChange: () => void;
}

type SelectedItem =
  | { kind: "device"; device: KitDevice }
  | { kind: "lens"; lens: KitLens };

export default function KitView({ trips, onTripsChange }: Props) {
  const [cameras, setCameras] = useState<KitDevice[]>([]);
  const [phones, setPhones] = useState<KitDevice[]>([]);
  const [lenses, setLenses] = useState<KitLens[]>([]);
  const [noCameraCount, setNoCameraCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SelectedItem | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoTotal, setPhotoTotal] = useState(0);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [lightboxId, setLightboxId] = useState<number | null>(null);

  useEffect(() => {
    getKit().then(data => {
      setCameras(data.cameras);
      setPhones(data.phones);
      setLenses(data.lenses);
      setNoCameraCount(data.no_camera_info);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const loadPhotos = async (item: SelectedItem, page: number, reset: boolean) => {
    setLoadingPhotos(true);
    try {
      const params: Record<string, string | number> = {
        page, per_page: 60, sort: "date_desc",
      };
      if (item.kind === "device") {
        if (item.device.make) params.camera_make = item.device.make;
        if (item.device.model) params.camera_model = item.device.model;
      } else {
        params.lens_model = item.lens.lens_model;
      }
      const res = await getPhotos(params);
      setPhotoTotal(res.total);
      setPhotos(prev => reset ? res.photos : [...prev, ...res.photos]);
    } catch {}
    setLoadingPhotos(false);
  };

  const selectItem = (item: SelectedItem) => {
    setSelected(item);
    loadPhotos(item, 1, true);
  };

  const selectedName = selected
    ? selected.kind === "device" ? selected.device.display_name : selected.lens.display_name
    : "";
  const selectedCount = selected
    ? selected.kind === "device" ? selected.device.photo_count : selected.lens.photo_count
    : 0;
  const selectedUrl = selected
    ? selected.kind === "device" ? selected.device.search_url : selected.lens.search_url
    : "";
  const selectedIcon = selected
    ? selected.kind === "lens" ? "🔎" : selected.kind === "device" && selected.device.type === "phone" ? "📱" : "📷"
    : "";

  const totalDevices = cameras.length + phones.length;

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Kit list */}
      <div style={{
        width: 300, flexShrink: 0,
        background: "var(--bg2)", borderRight: "1px solid var(--border)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontWeight: 600 }}>Kit List</div>
          {!loading && (
            <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>
              {totalDevices} device{totalDevices !== 1 ? "s" : ""} · {lenses.length} lens{lenses.length !== 1 ? "es" : ""}
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <div style={{ padding: 24, color: "var(--text2)", textAlign: "center" }}>Loading…</div>
          ) : totalDevices === 0 && lenses.length === 0 ? (
            <div style={{ padding: 24, color: "var(--text2)", textAlign: "center", fontSize: 13 }}>
              No camera information found.<br />
              Index some photos to populate your kit list.
            </div>
          ) : (
            <>
              {cameras.length > 0 && (
                <DeviceSection
                  title="Cameras 📷"
                  devices={cameras}
                  isSelected={d => selected?.kind === "device" && selected.device.display_name === d.display_name}
                  onSelect={d => selectItem({ kind: "device", device: d })}
                />
              )}
              {lenses.length > 0 && (
                <LensSection
                  lenses={lenses}
                  isSelected={l => selected?.kind === "lens" && selected.lens.lens_model === l.lens_model}
                  onSelect={l => selectItem({ kind: "lens", lens: l })}
                />
              )}
              {phones.length > 0 && (
                <DeviceSection
                  title="Phones 📱"
                  devices={phones}
                  isSelected={d => selected?.kind === "device" && selected.device.display_name === d.display_name && selected.device.type === d.type}
                  onSelect={d => selectItem({ kind: "device", device: d })}
                />
              )}
              {noCameraCount > 0 && (
                <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text2)", borderTop: "1px solid var(--border)" }}>
                  {noCameraCount.toLocaleString()} photo{noCameraCount !== 1 ? "s" : ""} with no camera data
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Device photos */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {selected ? (
          <>
            <div style={{
              padding: "14px 20px", background: "var(--bg2)",
              borderBottom: "1px solid var(--border)", flexShrink: 0,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 20 }}>{selectedIcon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{selectedName}</div>
                  <div style={{ color: "var(--text2)", fontSize: 13 }}>
                    {selectedCount.toLocaleString()} photo{selectedCount !== 1 ? "s" : ""}
                  </div>
                </div>
                <a
                  href={selectedUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    fontSize: 12, color: "var(--accent)",
                    padding: "5px 12px", borderRadius: 6,
                    border: "1px solid var(--border)",
                  }}
                >
                  Specs ↗
                </a>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
              {photos.length === 0 && !loadingPhotos ? (
                <div style={{ color: "var(--text2)", textAlign: "center", paddingTop: 40 }}>
                  No photos loaded yet
                </div>
              ) : (
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                  gap: 6,
                }}>
                  {photos.map(photo => (
                    <PhotoThumb key={photo.id} photo={photo} onClick={() => setLightboxId(photo.id)} />
                  ))}
                </div>
              )}
              {loadingPhotos && <div style={{ textAlign: "center", color: "var(--text2)", padding: 20 }}>Loading…</div>}
            </div>
          </>
        ) : (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", height: "100%", color: "var(--text2)", gap: 12,
          }}>
            <div style={{ fontSize: 40 }}>📷</div>
            <div style={{ fontSize: 15 }}>Select a device or lens to browse its photos</div>
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

function DeviceSection({ title, devices, isSelected, onSelect }: {
  title: string;
  devices: KitDevice[];
  isSelected: (d: KitDevice) => boolean;
  onSelect: (d: KitDevice) => void;
}) {
  return (
    <div>
      <div style={{
        padding: "8px 16px 4px", fontSize: 11, color: "var(--text2)",
        textTransform: "uppercase", letterSpacing: "0.06em",
        borderBottom: "1px solid var(--border)",
      }}>
        {title}
      </div>
      {devices.map(d => {
        const active = isSelected(d);
        return (
          <button
            key={`${d.make}|${d.model}`}
            onClick={() => onSelect(d)}
            style={{
              display: "flex", alignItems: "center", width: "100%",
              padding: "10px 16px", gap: 10, textAlign: "left",
              background: active ? "var(--bg3)" : "transparent",
              borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
              borderBottom: "1px solid var(--border)",
            }}
            onMouseEnter={e => { if (!active) e.currentTarget.style.background = "var(--bg3)"; }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
          >
            <div style={{ flex: 1, overflow: "hidden" }}>
              <div style={{
                fontSize: 13, fontWeight: 500,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {d.display_name}
              </div>
              <div style={{ fontSize: 11, color: "var(--text2)" }}>
                {d.photo_count.toLocaleString()} photos
              </div>
            </div>
            <div style={{
              width: 40, height: 4, borderRadius: 2, background: "var(--border)",
              flexShrink: 0, overflow: "hidden",
            }}>
              <div style={{
                height: "100%",
                background: active ? "var(--accent)" : "var(--text2)",
                width: `${Math.min(100, (d.photo_count / (devices[0]?.photo_count || 1)) * 100)}%`,
              }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function LensSection({ lenses, isSelected, onSelect }: {
  lenses: KitLens[];
  isSelected: (l: KitLens) => boolean;
  onSelect: (l: KitLens) => void;
}) {
  return (
    <div>
      <div style={{
        padding: "8px 16px 4px", fontSize: 11, color: "var(--text2)",
        textTransform: "uppercase", letterSpacing: "0.06em",
        borderBottom: "1px solid var(--border)",
      }}>
        Lenses 🔎
      </div>
      {lenses.map(l => {
        const active = isSelected(l);
        return (
          <button
            key={l.lens_model}
            onClick={() => onSelect(l)}
            style={{
              display: "flex", alignItems: "center", width: "100%",
              padding: "10px 16px", gap: 10, textAlign: "left",
              background: active ? "var(--bg3)" : "transparent",
              borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
              borderBottom: "1px solid var(--border)",
            }}
            onMouseEnter={e => { if (!active) e.currentTarget.style.background = "var(--bg3)"; }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
          >
            <div style={{ flex: 1, overflow: "hidden" }}>
              <div style={{
                fontSize: 13, fontWeight: 500,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {l.display_name}
              </div>
              <div style={{ fontSize: 11, color: "var(--text2)" }}>
                {l.photo_count.toLocaleString()} photos
              </div>
            </div>
            <div style={{
              width: 40, height: 4, borderRadius: 2, background: "var(--border)",
              flexShrink: 0, overflow: "hidden",
            }}>
              <div style={{
                height: "100%",
                background: active ? "var(--accent)" : "var(--text2)",
                width: `${Math.min(100, (l.photo_count / (lenses[0]?.photo_count || 1)) * 100)}%`,
              }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function PhotoThumb({ photo, onClick }: { photo: Photo; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{
      aspectRatio: "1", borderRadius: 6, overflow: "hidden",
      cursor: "pointer", background: "var(--bg3)",
    }}>
      <img src={thumbnailUrl(photo.id)} alt={photo.filename} loading="lazy"
        style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </div>
  );
}
