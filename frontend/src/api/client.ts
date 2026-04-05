import type {
  Photo, PhotosResponse, Trip, MapPin, Stats, IndexStatus,
  MLCapabilities, FaceBox, Person, BatchAnalysisStatus,
} from "../types";

const BASE = "/api";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const detail = err.detail;
    const msg = typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((d: { msg?: string }) => d.msg ?? JSON.stringify(d)).join("; ") : "Request failed";
    throw new Error(msg);
  }
  return res.json();
}

// ── Photos ──────────────────────────────────────────────────
export const getPhotos = (params: Record<string, string | number | boolean | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  }
  return request<PhotosResponse>(`/photos?${p}`);
};

export const getPhoto = (id: number) => request<Photo>(`/photos/${id}`);

export const getPhotoExif = (id: number) => request<Record<string, unknown>>(`/photos/${id}/exif`);

export const getMapPins = (tripId?: number) => {
  const p = tripId != null ? `?trip_id=${tripId}` : "";
  return request<MapPin[]>(`/photos/map-pins${p}`);
};

export const assignTrip = (photoId: number, tripId: number | null) =>
  request<Photo>(`/photos/${photoId}/trip`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trip_id: tripId }),
  });

export const updateNotes = (photoId: number, notes: string | null) =>
  request<Photo>(`/photos/${photoId}/notes`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  });

export const searchPhotos = (q: string, page = 1, perPage = 50) =>
  request<PhotosResponse>(`/photos/search/query?q=${encodeURIComponent(q)}&page=${page}&per_page=${perPage}`);

export interface SearchSuggestion {
  label: string;
  count: number;
  category: "location" | "person" | "trip";
}

export const searchSuggest = (q: string) =>
  request<SearchSuggestion[]>(`/photos/search/suggest?q=${encodeURIComponent(q)}`);

export const bulkAssignTrip = (photoIds: number[], tripId: number | null) =>
  request<{ updated: number }>(`/photos/bulk-assign-trip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photo_ids: photoIds, trip_id: tripId }),
  });

export const getStats = () => request<Stats>(`/photos/stats/summary`);

// ── Trips ────────────────────────────────────────────────────
export const getTrips = () => request<Trip[]>(`/trips`);

export const createTrip = (name: string, description: string | null, color: string) =>
  request<Trip>(`/trips`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description, color }),
  });

export const updateTrip = (id: number, data: Partial<Trip>) =>
  request<Trip>(`/trips/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

export const deleteTrip = (id: number) =>
  request<{ ok: boolean }>(`/trips/${id}`, { method: "DELETE" });

// ── Indexing ─────────────────────────────────────────────────
export const startIndexing = (directory: string, forceReindex = false) =>
  request<{ ok: boolean; message: string }>(`/index/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ directory, force_reindex: forceReindex }),
  });

export const getIndexStatus = () => request<IndexStatus>(`/index/status`);

// ── ML – Capabilities & Models ───────────────────────────────
export const getMLCapabilities = () => request<MLCapabilities>(`/ml/capabilities`);

export const downloadMLModels = () =>
  request<{ status: Record<string, boolean>; messages: string[] }>(`/ml/models/download`, {
    method: "POST",
  });

// ── ML – Analysis ─────────────────────────────────────────────
export const analyzePhoto = (
  photoId: number,
  opts: { run_faces?: boolean; run_activities?: boolean; device?: string },
) =>
  request<{ photo_id: number; faces: FaceBox[]; activities: string[] }>(
    `/ml/analyze/${photoId}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_faces: true, run_activities: true, device: "cpu", ...opts }),
    },
  );

export const startBatchAnalysis = (opts: {
  photo_ids?: number[];
  run_faces?: boolean;
  run_activities?: boolean;
  only_unanalyzed?: boolean;
  device?: string;
}) =>
  request<{ ok: boolean; message: string; count: number }>(`/ml/analyze/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ run_faces: true, run_activities: true, only_unanalyzed: true, device: "cpu", ...opts }),
  });

export const getBatchAnalysisStatus = () =>
  request<BatchAnalysisStatus>(`/ml/analyze/batch/status`);

export const clusterFaces = (threshold = 0.45) =>
  request<{ people_created: number; faces_assigned: number; noise: number }>(`/ml/cluster-faces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ threshold }),
  });

// ── ML – People ───────────────────────────────────────────────
export const getPeople = () => request<Person[]>(`/ml/people`);

export const renamePerson = (id: number, name: string) =>
  request<{ id: number; name: string }>(`/ml/people/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

export const mergePeople = (source_id: number, target_id: number) =>
  request<{ id: number; name: string; face_count: number }>(`/ml/people/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_id, target_id }),
  });

export const deletePerson = (id: number) =>
  request<{ ok: boolean }>(`/ml/people/${id}`, { method: "DELETE" });

export const getPersonPhotos = (id: number, page = 1, perPage = 50) =>
  request<{ person: { id: number; name: string; face_count: number }; total: number; page: number; per_page: number; photos: Photo[] }>(
    `/ml/people/${id}/photos?page=${page}&per_page=${perPage}`,
  );

export const getPhotoFaces = (photoId: number) =>
  request<FaceBox[]>(`/ml/photos/${photoId}/faces`);

// ── Trip Detection & Replay ───────────────────────────────────────
import type { DetectedTrip, ReplayData } from "../types";

export const detectTrips = (gapHours = 6, minPhotos = 3, geocode = false, minGpsPct = 25) =>
  request<{ trips: DetectedTrip[]; total: number }>(
    `/detect/trips?gap_hours=${gapHours}&min_photos=${minPhotos}&min_gps_pct=${minGpsPct}&geocode=${geocode}`,
  );

export const getTripReplay = (tripId: number, interpolationWindowHours = 2) =>
  request<ReplayData>(
    `/detect/replay/${tripId}?interpolation_window_hours=${interpolationWindowHours}`,
  );

// ── Kit List ─────────────────────────────────────────────────────
export interface KitDevice {
  make: string | null;
  model: string | null;
  display_name: string;
  photo_count: number;
  type: "camera" | "phone";
  search_url: string;
}

export interface KitLens {
  lens_model: string;
  display_name: string;
  photo_count: number;
  search_url: string;
}

export interface KitData {
  cameras: KitDevice[];
  phones: KitDevice[];
  lenses: KitLens[];
  no_camera_info: number;
  total_devices: number;
}

export const getKit = () => request<KitData>("/kit");

// ── Editing ───────────────────────────────────────────────────
export interface EditParams {
  white_balance: "auto" | "none";
  temperature: number;
  filter: "none" | "vivid" | "muted" | "warm" | "cool" | "bw" | "vintage";
  brightness: number;
  contrast: number;
  saturation: number;
}

export const editPhotoPreview = async (photoId: number, params: EditParams): Promise<string> => {
  const res = await fetch(`${BASE}/photos/${photoId}/edit/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Preview failed");
  const blob = await res.blob();
  return URL.createObjectURL(blob);
};

export const editPhotoSave = (
  photoId: number,
  params: EditParams & { save_mode: "export" | "version" },
) =>
  request<{ saved_to: string; filename: string }>(`/photos/${photoId}/edit/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

// ── URLs ──────────────────────────────────────────────────────
export const thumbnailUrl = (id: number) => `${BASE}/photos/${id}/thumbnail`;
export const imageUrl = (id: number) => `${BASE}/photos/${id}/image`;
