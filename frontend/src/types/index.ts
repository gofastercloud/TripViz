export interface Photo {
  id: number;
  filename: string;
  date_taken: string | null;
  latitude: number | null;
  longitude: number | null;
  width: number | null;
  height: number | null;
  file_size: number;
  camera_make: string | null;
  camera_model: string | null;
  lens_model: string | null;
  has_thumbnail: boolean;
  trip_id: number | null;
  trip_color: string | null;
  trip_name: string | null;
  notes: string | null;
  tags: string | null;          // JSON-encoded string[] of location tags
  // ML
  activities: string | null;   // JSON-encoded string[] e.g. '["beach","hiking"]'
  face_analyzed: boolean;
  activity_analyzed: boolean;
}

export interface MapPin {
  id: number;
  lat: number;
  lon: number;
  date: string | null;
  trip_id: number | null;
  trip_color: string | null;
  trip_name: string | null;
  count: number;
  photo_ids: number[];
}

export interface Trip {
  id: number;
  name: string;
  description: string | null;
  color: string;
  created_at: string | null;
  photo_count: number;
}

export interface PhotosResponse {
  total: number;
  page: number;
  per_page: number;
  pages: number;
  photos: Photo[];
}

export interface Stats {
  total_photos: number;
  geotagged: number;
  with_trip: number;
  no_trip: number;
}

export interface IndexStatus {
  running: boolean;
  total: number;
  processed: number;
  skipped: number;
  errors: number;
  current_file: string;
  directory: string;
  started_at: string | null;
  finished_at: string | null;
}

// ── ML types ────────────────────────────────────────────────

export interface MLCapabilities {
  platform: string;
  arch: string;
  ram_gb: number;
  cpu_count: number;
  has_cuda: boolean;
  has_mps: boolean;
  mediapipe_available: boolean;
  sklearn_available: boolean;
  transformers_available: boolean;
  torch_available: boolean;
  face_models_downloaded: Record<string, boolean>;
  face_detection_ready: boolean;
  activity_detection_ready: boolean;
  recommended_device: string;
}

export interface FaceBox {
  id: number;
  photo_id: number;
  bbox_x: number;
  bbox_y: number;
  bbox_w: number;
  bbox_h: number;
  confidence: number;
  person_id: number | null;
  person_name: string | null;
}

export interface Person {
  id: number;
  name: string;
  face_count: number;
  cover_face: FaceBox | null;
}

// ── Trip detection / replay ──────────────────────────────────────

export interface DetectedTrip {
  cluster_id: number;
  suggested_name: string;
  location_name: string;
  start_date: string;
  end_date: string;
  duration_hours: number;
  photo_count: number;
  gps_count: number;
  no_gps_count: number;
  centroid_lat: number | null;
  centroid_lon: number | null;
  already_assigned: number;
  existing_trip_ids: number[];
  photo_ids: number[];
  preview_pins: { id: number; lat: number; lon: number }[];
  preview_photo_ids: number[];
}

export interface ReplayFrame {
  photo_id: number;
  filename: string;
  timestamp: string;
  lat: number | null;
  lon: number | null;
  has_gps: boolean;
  is_interpolated: boolean;
  trip_color: string;
}

export interface ReplayData {
  trip: { id: number; name: string; color: string };
  frames: ReplayFrame[];
  path: { lat: number; lon: number; is_interpolated: boolean }[];
  stats: { total: number; gps: number; interpolated: number; no_location: number };
}

export interface BatchAnalysisStatus {
  running: boolean;
  task: string;
  total: number;
  processed: number;
  errors: number;
  current: string;
  started_at: string | null;
  finished_at: string | null;
}
