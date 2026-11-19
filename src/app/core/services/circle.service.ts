import { Injectable, inject } from "@angular/core";
import { HttpClient, HttpHeaders } from "@angular/common/http";
import { Observable, catchError, from, map, switchMap, throwError } from "rxjs";
import { AuthService } from "./auth.service";
import { ApiEnvelope, Geofence, CircleMemberLocation } from "../models/location.models";
import {
  CreateCircleRequest,
  JoinCircleRequest,
  MemberRelationship,
  Circle,
  CircleMember,
} from "../models/circle.models";
import { environment } from "../../../environments/environment";

/**
 * Circle API client.
 *
 * Endpoint names and request/response keys still use the backend's legacy
 * "squad" vocabulary; everything the app exposes is a circle.
 */
@Injectable({
  providedIn: "root",
})
export class CircleService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);

  getUserCircles(): Observable<Circle[]> {
    return this.request<Circle[]>("GET", "api_get_squads.php");
  }

  createCircle(data: CreateCircleRequest): Observable<Circle> {
    return this.request<Circle>("POST", "api_create_squad.php", data);
  }

  joinCircle(data: JoinCircleRequest): Observable<Circle> {
    return this.request<Circle>("POST", "api_join_squad.php", data);
  }

  leaveCircle(circleId: number): Observable<void> {
    return this.request<void>(
      "DELETE",
      `api_leave_squad.php?squad_id=${circleId}`
    );
  }

  /** Rename a circle (admin only; enforced by the API). */
  updateCircle(
    circleId: number,
    circleName: string
  ): Observable<{ id: number; squad_name: string }> {
    return this.request<{ id: number; squad_name: string }>(
      "PUT",
      "api_update_squad.php",
      { squad_id: circleId, squad_name: circleName }
    );
  }

  getCircleMembers(circleId?: number): Observable<CircleMember[]> {
    const query = circleId ? `?squad_id=${circleId}` : "";
    return this.request<CircleMember[]>(
      "GET",
      `api_get_squad_members.php${query}`
    );
  }

  getCircleLocations(circleId?: number): Observable<CircleMemberLocation[]> {
    const query = circleId ? `?squad_id=${circleId}` : "";
    return this.request<CircleMemberLocation[]>(
      "GET",
      `api_get_squad_locations.php${query}`
    );
  }

  updateMemberRole(
    circleId: number,
    userId: number,
    role: "member" | "admin"
  ): Observable<void> {
    return this.request<void>("PUT", "api_update_member_role.php", {
      squad_id: circleId,
      user_id: userId,
      role,
    });
  }

  /** Set or clear a member's family/friend label inside a circle. */
  updateMemberRelationship(
    circleId: number,
    userId: number,
    relationship: MemberRelationship | null
  ): Observable<MemberRelationship | null> {
    return this.request<MemberRelationship | null>(
      "PUT",
      "api_update_member_relationship.php",
      {
        squad_id: circleId,
        user_id: userId,
        relationship,
      }
    );
  }

  removeMember(circleId: number, userId: number): Observable<void> {
    return this.request<void>(
      "DELETE",
      `api_remove_member.php?squad_id=${circleId}&user_id=${userId}`
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

  getGeofences(circleId: number): Observable<Geofence[]> {
    return this.request<Geofence[]>(
      "GET",
      `api_get_geofences.php?squad_id=${circleId}`
    );
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
