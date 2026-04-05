import type { Photo, PhotosResponse, Trip, MapPin, Stats, IndexStatus } from "../types";

const BASE = "/api";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Request failed");
  }
  return res.json();
}

// Photos
export const getPhotos = (params: Record<string, string | number | boolean | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  }
  return request<PhotosResponse>(`/photos?${p}`);
};

export const getPhoto = (id: number) => request<Photo>(`/photos/${id}`);

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

export const bulkAssignTrip = (photoIds: number[], tripId: number | null) =>
  request<{ updated: number }>(`/photos/bulk-assign-trip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photo_ids: photoIds, trip_id: tripId }),
  });

export const getStats = () => request<Stats>(`/photos/stats/summary`);

// Trips
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

// Indexing
export const startIndexing = (directory: string, forceReindex = false) =>
  request<{ ok: boolean; message: string }>(`/index/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ directory, force_reindex: forceReindex }),
  });

export const getIndexStatus = () => request<IndexStatus>(`/index/status`);

// Thumbnail / image URLs (not fetch-based, used as <img src=...>)
export const thumbnailUrl = (id: number) => `${BASE}/photos/${id}/thumbnail`;
export const imageUrl = (id: number) => `${BASE}/photos/${id}/image`;
