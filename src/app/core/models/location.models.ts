/**
 * Shared location/squad models for the Konek app.
 */

export interface ApiEnvelope<T> {
  success: boolean;
  message?: string;
  data: T;
}

export interface LocationUpdate {
  latitude: number;
  longitude: number;
  accuracy?: number;
  altitude?: number;
  speed?: number;
  heading?: number;
}

export interface LocationHistoryEntry extends LocationUpdate {
  id: number;
  user_id: number;
  timestamp: string;
}

export interface SquadMemberLocation {
  user_id: number;
  username: string;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  altitude?: number | null;
  speed?: number | null;
  heading?: number | null;
  timestamp: string;
  role: "member" | "admin";
  squad_id: number;
  squad_name: string;
}

export interface Geofence {
  id: number;
  squad_id: number;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  created_by: number;
  created_at: string;
}

export interface LocationExportData {
  user_id: number;
  username: string;
  export_date: string;
  locations: LocationHistoryEntry[];
  total_points: number;
  date_range: {
    start: string;
    end: string;
  };
}
