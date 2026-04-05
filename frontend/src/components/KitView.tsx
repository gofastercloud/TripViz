import { useState, useEffect } from "react";
import { getKit, getPhotos, thumbnailUrl, type KitDevice } from "../api/client";
import type { Photo } from "../types";
import PhotoLightbox from "./PhotoLightbox";
import type { Trip } from "../types";

interface Props {
  trips: Trip[];
  onTripsChange: () => void;
}

export default function KitView({ trips, onTripsChange }: Props) {
  const [cameras, setCameras] = useState<KitDevice[]>([]);
  const [phones, setPhones] = useState<KitDevice[]>([]);
  const [noCameraCount, setNoCameraCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<KitDevice | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoTotal, setPhotoTotal] = useState(0);
  const [photoPage, setPhotoPage] = useState(1);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [lightboxId, setLightboxId] = useState<number | null>(null);

  useEffect(() => {
    getKit().then(data => {
      setCameras(data.cameras);
      setPhones(data.phones);
      setNoCameraCount(data.no_camera_info);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const loadPhotosForDevice = async (device: KitDevice, page: number, reset: boolean) => {
    setLoadingPhotos(true);
    try {
      // Build a search by camera_make+model — use the combined name as a proxy filter.
      // We fetch all photos and filter by make/model client-side since the API doesn't
      // expose a camera filter directly. For large libraries we pass the make as a hint.
      const params: Record<string, string | number> = {
        page, per_page: 60, sort: "date_desc",
      };
      // We can't filter by camera in the current API, so fetch all and filter locally
      // TODO: add camera_make/camera_model filter to the photos API
      const res = await getPhotos(params);
      const filtered = res.photos.filter(p =>
        (p.camera_make ?? "") === (device.make ?? "") &&
        (p.camera_model ?? "") === (device.model ?? "")
      );
      setPhotoTotal(device.photo_count);
      setPhotos(prev => reset ? filtered : [...prev, ...filtered]);
    } catch {}
    setLoadingPhotos(false);
  };

  const selectDevice = (device: KitDevice) => {
    setSelected(device);
    setPhotoPage(1);
    loadPhotosForDevice(device, 1, true);
  };

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
              {totalDevices} device{totalDevices !== 1 ? "s" : ""} detected from EXIF
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <div style={{ padding: 24, color: "var(--text2)", textAlign: "center" }}>Loading…</div>
          ) : totalDevices === 0 ? (
            <div style={{ padding: 24, color: "var(--text2)", textAlign: "center", fontSize: 13 }}>
              No camera information found.<br />
              Index some photos to populate your kit list.
            </div>
          ) : (
            <>
              {cameras.length > 0 && (
                <DeviceSection title="Cameras 📷" devices={cameras} selected={selected} onSelect={selectDevice} />
              )}
              {phones.length > 0 && (
                <DeviceSection title="Phones 📱" devices={phones} selected={selected} onSelect={selectDevice} />
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
            {/* Header */}
            <div style={{
              padding: "14px 20px", background: "var(--bg2)",
              borderBottom: "1px solid var(--border)", flexShrink: 0,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 20 }}>{selected.type === "phone" ? "📱" : "📷"}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{selected.display_name}</div>
                  <div style={{ color: "var(--text2)", fontSize: 13 }}>
                    {selected.photo_count.toLocaleString()} photo{selected.photo_count !== 1 ? "s" : ""} · {selected.type}
                  </div>
                </div>
              </div>
            </div>

            {/* Photos grid */}
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
            <div style={{ fontSize: 15 }}>Select a device to browse its photos</div>
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

function DeviceSection({ title, devices, selected, onSelect }: {
  title: string;
  devices: KitDevice[];
  selected: KitDevice | null;
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
        const isSelected = selected?.display_name === d.display_name && selected?.type === d.type;
        return (
          <button
            key={`${d.make}|${d.model}`}
            onClick={() => onSelect(d)}
            style={{
              display: "flex", alignItems: "center", width: "100%",
              padding: "10px 16px", gap: 10, textAlign: "left",
              background: isSelected ? "var(--bg3)" : "transparent",
              borderLeft: isSelected ? "2px solid var(--accent)" : "2px solid transparent",
              borderBottom: "1px solid var(--border)",
            }}
            onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "var(--bg3)"; }}
            onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
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
            {/* Simple bar proportional to photo count */}
            <div style={{
              width: 40, height: 4, borderRadius: 2, background: "var(--border)",
              flexShrink: 0, overflow: "hidden",
            }}>
              <div style={{
                height: "100%",
                background: isSelected ? "var(--accent)" : "var(--text2)",
                width: `${Math.min(100, (d.photo_count / (devices[0]?.photo_count || 1)) * 100)}%`,
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
