import { Injectable, inject } from "@angular/core";
import { HttpClient, HttpHeaders } from "@angular/common/http";
import { Observable, catchError, from, map, switchMap, throwError } from "rxjs";
import { AuthService } from "./auth.service";
import { ApiEnvelope, Geofence, SquadMemberLocation } from "../models/location.models";
import {
  CreateSquadRequest,
  JoinSquadRequest,
  Squad,
  SquadMember,
} from "../models/squad.models";
import { environment } from "../../../environments/environment";

@Injectable({
  providedIn: "root",
})
export class SquadService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);

  getUserSquads(): Observable<Squad[]> {
    return this.request<Squad[]>("GET", "api_get_squads.php");
  }

  createSquad(data: CreateSquadRequest): Observable<Squad> {
    return this.request<Squad>("POST", "api_create_squad.php", data);
  }

  joinSquad(data: JoinSquadRequest): Observable<Squad> {
    return this.request<Squad>("POST", "api_join_squad.php", data);
  }

  leaveSquad(squadId: number): Observable<void> {
    return this.request<void>("DELETE", `api_leave_squad.php?squad_id=${squadId}`);
  }

  getSquadMembers(squadId?: number): Observable<SquadMember[]> {
    const query = squadId ? `?squad_id=${squadId}` : "";
    return this.request<SquadMember[]>("GET", `api_get_squad_members.php${query}`);
  }

  getSquadLocations(squadId?: number): Observable<SquadMemberLocation[]> {
    const query = squadId ? `?squad_id=${squadId}` : "";
    return this.request<SquadMemberLocation[]>(
      "GET",
      `api_get_squad_locations.php${query}`
    );
  }

  updateMemberRole(
    squadId: number,
    userId: number,
    role: "member" | "admin"
  ): Observable<void> {
    return this.request<void>("PUT", "api_update_member_role.php", {
      squad_id: squadId,
      user_id: userId,
      role,
    });
  }

  removeMember(squadId: number, userId: number): Observable<void> {
    return this.request<void>(
      "DELETE",
      `api_remove_member.php?squad_id=${squadId}&user_id=${userId}`
    );
  }

  createGeofence(data: {
    squad_id: number;
    name: string;
    latitude: number;
    longitude: number;
    radius_meters: number;
  }): Observable<Geofence> {
    return this.request<Geofence>("POST", "api_create_geofence.php", data);
  }

  getGeofences(squadId: number): Observable<Geofence[]> {
    return this.request<Geofence[]>("GET", `api_get_geofences.php?squad_id=${squadId}`);
  }

  deleteGeofence(geofenceId: number): Observable<void> {
    return this.request<void>("DELETE", `api_delete_geofence.php?id=${geofenceId}`);
  }

  /** Small helper that attaches the bearer token and unwraps the API envelope. */
  private request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown
  ): Observable<T> {
    return from(this.authHeaders()).pipe(
      switchMap((headers) => {
        const url = `${environment.apiUrl}/${path}`;
        switch (method) {
          case "GET":
            return this.http.get<ApiEnvelope<T>>(url, { headers });
          case "POST":
            return this.http.post<ApiEnvelope<T>>(url, body ?? {}, { headers });
          case "PUT":
            return this.http.put<ApiEnvelope<T>>(url, body ?? {}, { headers });
          case "DELETE":
            return this.http.delete<ApiEnvelope<T>>(url, { headers });
        }
      }),
      map((response) => response.data),
      catchError((error) => throwError(() => error))
    );
  }

  private async authHeaders(): Promise<HttpHeaders> {
    const token = await this.authService.getAuthToken();
    return new HttpHeaders({
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    });
  }
}
