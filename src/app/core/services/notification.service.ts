import { Injectable, inject } from "@angular/core";
import { HttpClient, HttpHeaders } from "@angular/common/http";
import { Observable, from, map, switchMap } from "rxjs";
import { AuthService } from "./auth.service";
import { environment } from "../../../environments/environment";
import {
  AppNotification,
  NotificationPage,
} from "../models/notification.models";

/** Response shape for the list endpoint, which also returns the unread total. */
interface NotificationsEnvelope {
  success: boolean;
  message?: string;
  data: AppNotification[];
  unread_count?: number;
}

/** Response shape for mark-read/delete, which return the fresh unread total. */
interface NotificationMutationEnvelope {
  success: boolean;
  message?: string;
  unread_count?: number;
}

/** The signed-in user's in-app notification inbox. */
@Injectable({
  providedIn: "root",
})
export class NotificationService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);

  /** Newest notifications first, plus the current unread count. */
  getNotifications(
    options: { limit?: number; unreadOnly?: boolean } = {}
  ): Observable<NotificationPage> {
    const limit = options.limit ?? 50;
    const query = [`limit=${limit}`];
    if (options.unreadOnly) query.push("unread_only=1");

    return from(this.authHeaders()).pipe(
      switchMap((headers) =>
        this.http.get<NotificationsEnvelope>(
          `${environment.apiUrl}/api_get_notifications.php?${query.join("&")}`,
          { headers }
        )
      ),
      map((response) => ({
        items: response.data ?? [],
        unreadCount: response.unread_count ?? 0,
      }))
    );
  }

  /** Badge-friendly helper: only the unread total, not the full inbox. */
  getUnreadCount(): Observable<number> {
    return this.getNotifications({ limit: 1 }).pipe(
      map((page) => page.unreadCount)
    );
  }

  markRead(id: number): Observable<number> {
    return from(this.authHeaders()).pipe(
      switchMap((headers) =>
        this.http.put<NotificationMutationEnvelope>(
          `${environment.apiUrl}/api_mark_notification_read.php`,
          { id },
          { headers }
        )
      ),
      map((response) => response.unread_count ?? 0)
    );
  }

  markAllRead(): Observable<number> {
    return from(this.authHeaders()).pipe(
      switchMap((headers) =>
        this.http.put<NotificationMutationEnvelope>(
          `${environment.apiUrl}/api_mark_all_notifications_read.php`,
          {},
          { headers }
        )
      ),
      map((response) => response.unread_count ?? 0)
    );
  }

  delete(id: number): Observable<number> {
    return from(this.authHeaders()).pipe(
      switchMap((headers) =>
        this.http.delete<NotificationMutationEnvelope>(
          `${environment.apiUrl}/api_delete_notification.php?id=${id}`,
          { headers }
        )
      ),
      map((response) => response.unread_count ?? 0)
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
