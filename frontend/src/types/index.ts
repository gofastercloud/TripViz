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
  has_thumbnail: boolean;
  trip_id: number | null;
  trip_color: string | null;
  trip_name: string | null;
}

export interface MapPin {
  id: number;
  lat: number;
  lon: number;
  date: string | null;
  trip_id: number | null;
  trip_color: string | null;
  trip_name: string | null;
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
