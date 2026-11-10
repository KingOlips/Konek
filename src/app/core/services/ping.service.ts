import { Injectable, inject } from "@angular/core";
import { HttpClient, HttpHeaders } from "@angular/common/http";
import { Observable, from, map, switchMap } from "rxjs";
import { AuthService } from "./auth.service";
import { ApiEnvelope } from "../models/location.models";
import {
  IncomingPing,
  SendPingRequest,
} from "../models/ping.models";
import { environment } from "../../../environments/environment";

/**
 * Squad pings. Sending never notifies the sender's device; the recipient picks
 * the ping up with `getPendingPings()` while the map is open.
 */
@Injectable({
  providedIn: "root",
})
export class PingService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);

  sendPing(request: SendPingRequest): Observable<IncomingPing> {
    return this.request<IncomingPing>("POST", "api_send_ping.php", request);
  }

  /** Unread pings addressed to the signed-in user, oldest first. */
  getPendingPings(): Observable<IncomingPing[]> {
    return this.request<IncomingPing[]>("GET", "api_get_pings.php");
  }

  markPingsRead(pingIds: number[]): Observable<{ marked: number }> {
    return this.request<{ marked: number }>("POST", "api_mark_ping_read.php", {
      ping_ids: pingIds,
    });
  }

  /** Small helper that attaches the bearer token and unwraps the API envelope. */
  private request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Observable<T> {
    return from(this.authHeaders()).pipe(
      switchMap((headers) => {
        const url = `${environment.apiUrl}/${path}`;
        return method === "GET"
          ? this.http.get<ApiEnvelope<T>>(url, { headers })
          : this.http.post<ApiEnvelope<T>>(url, body ?? {}, { headers });
      }),
      map((response) => response.data)
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
