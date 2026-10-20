import { Injectable, inject } from "@angular/core";
import { HttpClient, HttpHeaders } from "@angular/common/http";
import { Observable, catchError, from, map, switchMap, throwError } from "rxjs";
import { Preferences } from "@capacitor/preferences";
import { AuthService } from "./auth.service";
import {
  ApiEnvelope,
  LocationExportData,
  LocationHistoryEntry,
  LocationUpdate,
  SquadMemberLocation,
} from "../models/location.models";
import { environment } from "../../../environments/environment";

@Injectable({
  providedIn: "root",
})
export class LocationService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly HISTORY_KEY = "konek_location_history";
  private readonly MAX_HISTORY_ENTRIES = 10000;

  /** Push the current fix to the backend. */
  updateLocation(location: LocationUpdate): Observable<ApiEnvelope<null>> {
    return from(this.authHeaders()).pipe(
      switchMap((headers) =>
        this.http.post<ApiEnvelope<null>>(
          `${environment.apiUrl}/api_update_location.php`,
          location,
          { headers }
        )
      ),
      catchError((error) => throwError(() => error))
    );
  }

  /** Latest fix for every member of the squad. */
  getSquadLocations(squadId?: number): Observable<SquadMemberLocation[]> {
    return from(this.authHeaders()).pipe(
      switchMap((headers) => {
        const query = squadId ? `?squad_id=${squadId}` : "";
        return this.http.get<ApiEnvelope<SquadMemberLocation[]>>(
          `${environment.apiUrl}/api_get_squad_locations.php${query}`,
          { headers }
        );
      }),
      map((response) => response.data ?? []),
      catchError((error) => throwError(() => error))
    );
  }

  async getHistory(): Promise<LocationHistoryEntry[]> {
    const { value } = await Preferences.get({ key: this.HISTORY_KEY });
    if (!value) return [];
    try {
      return JSON.parse(value) as LocationHistoryEntry[];
    } catch {
      return [];
    }
  }

  async addToHistory(entry: LocationHistoryEntry): Promise<void> {
    const history = await this.getHistory();
    history.unshift(entry);
    if (history.length > this.MAX_HISTORY_ENTRIES) {
      history.length = this.MAX_HISTORY_ENTRIES;
    }
    await Preferences.set({ key: this.HISTORY_KEY, value: JSON.stringify(history) });
  }

  async clearHistory(): Promise<void> {
    await Preferences.remove({ key: this.HISTORY_KEY });
  }

  async exportHistory(): Promise<LocationExportData | null> {
    const user = this.authService.getCurrentUser();
    if (!user) return null;

    const history = await this.getHistory();
    if (history.length === 0) return null;

    return {
      user_id: user.id,
      username: user.username,
      export_date: new Date().toISOString(),
      locations: history,
      total_points: history.length,
      date_range: {
        start: history[history.length - 1]?.timestamp ?? new Date().toISOString(),
        end: history[0]?.timestamp ?? new Date().toISOString(),
      },
    };
  }

  /** Serialise a location history payload as CSV. */
  toCsv(locations: LocationHistoryEntry[]): string {
    const headers = [
      "id",
      "user_id",
      "latitude",
      "longitude",
      "accuracy",
      "altitude",
      "speed",
      "heading",
      "timestamp",
    ];
    const rows = locations.map((loc) =>
      headers.map((header) => (loc as unknown as Record<string, unknown>)[header] ?? "").join(",")
    );
    return [headers.join(","), ...rows].join("\n");
  }

  private async authHeaders(): Promise<HttpHeaders> {
    const token = await this.authService.getAuthToken();
    return new HttpHeaders({
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    });
  }
}
