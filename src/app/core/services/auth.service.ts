import { Injectable, inject } from "@angular/core";
import { HttpClient, HttpHeaders } from "@angular/common/http";
import {
  BehaviorSubject,
  Observable,
  catchError,
  from,
  map,
  switchMap,
  tap,
  throwError,
} from "rxjs";
import { Preferences } from "@capacitor/preferences";
import { environment } from "../../../environments/environment";

export interface Squad {
  id: number;
  squad_name: string;
  join_code: string;
  role: "member" | "admin";
}

export interface User {
  id: number;
  username: string;
  auth_token: string;
  active_status: number;
  created_at: string;
  squads?: Squad[];
}

export interface Credentials {
  username: string;
  password: string;
}

export interface AuthResponse {
  success: boolean;
  message: string;
  data?: User;
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data?: T;
}

const TOKEN_KEY = "konek_auth_token";
const USER_KEY = "konek_user_data";

@Injectable({
  providedIn: "root",
})
export class AuthService {
  private readonly http = inject(HttpClient);

  private readonly currentUserSubject = new BehaviorSubject<User | null>(null);
  /** Emits the signed-in user, or null. */
  readonly currentUser$ = this.currentUserSubject.asObservable();

  private readonly isAuthenticatedSubject = new BehaviorSubject<boolean>(false);
  /** Emits auth state changes. */
  readonly isAuthenticated$ = this.isAuthenticatedSubject.asObservable();

  /** Resolves once the persisted session has been read from storage. */
  private readonly sessionReady: Promise<void>;

  constructor() {
    this.sessionReady = this.loadStoredSession();
  }

  private async loadStoredSession(): Promise<void> {
    try {
      const [{ value: token }, { value: userData }] = await Promise.all([
        Preferences.get({ key: TOKEN_KEY }),
        Preferences.get({ key: USER_KEY }),
      ]);

      if (token && userData) {
        const user = JSON.parse(userData) as User;
        user.auth_token = token;
        this.currentUserSubject.next(user);
        this.isAuthenticatedSubject.next(true);
      }
    } catch (error) {
      console.error("Failed to restore session:", error);
      await this.clearStoredSession();
    }
  }

  /** Wait until the stored session has been loaded (used by the auth guard). */
  async whenReady(): Promise<void> {
    return this.sessionReady;
  }

  register(credentials: Credentials): Observable<AuthResponse> {
    return this.authenticate("api_register.php", credentials);
  }

  login(credentials: Credentials): Observable<AuthResponse> {
    return this.authenticate("api_login.php", credentials);
  }

  private authenticate(endpoint: string, credentials: Credentials): Observable<AuthResponse> {
    const url = `${environment.apiUrl}/${endpoint}`;
    const headers = new HttpHeaders({ "Content-Type": "application/json" });

    return this.http.post<AuthResponse>(url, credentials, { headers }).pipe(
      switchMap((response) => {
        if (!response.success || !response.data) {
          return from(Promise.resolve(response));
        }
        const user = response.data;
        return from(this.persistSession(user.auth_token, user)).pipe(
          tap(() => {
            this.currentUserSubject.next(user);
            this.isAuthenticatedSubject.next(true);
            this.haptic("success");
          }),
          map(() => response)
        );
      }),
      catchError((error) => {
        console.error(`${endpoint} failed:`, error);
        return throwError(() => error);
      })
    );
  }

  changePassword(currentPassword: string, newPassword: string): Observable<ApiResponse<void>> {
    const token = this.currentUserSubject.value?.auth_token;
    const headers = new HttpHeaders({
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    });

    return this.http.post<ApiResponse<void>>(
      `${environment.apiUrl}/api_change_password.php`,
      { current_password: currentPassword, new_password: newPassword },
      { headers }
    );
  }

  logout(): Observable<ApiResponse<void>> {
    const token = this.currentUserSubject.value?.auth_token;
    const headers = new HttpHeaders({
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    });

    // Always clear the local session, even when the API call fails.
    const finish = () =>
      from(this.clearStoredSession()).pipe(
        tap(() => {
          this.currentUserSubject.next(null);
          this.isAuthenticatedSubject.next(false);
          this.haptic("warning");
        })
      );

    if (!token) {
      return finish().pipe(map(() => ({ success: true, message: "Signed out" })));
    }

    return this.http
      .post<ApiResponse<void>>(`${environment.apiUrl}/api_logout.php`, {}, { headers })
      .pipe(
        switchMap((response) => finish().pipe(map(() => response))),
        catchError((error) =>
          finish().pipe(switchMap(() => throwError(() => error)))
        )
      );
  }

  private async persistSession(token: string, user: User): Promise<void> {
    await Promise.all([
      Preferences.set({ key: TOKEN_KEY, value: token }),
      Preferences.set({ key: USER_KEY, value: JSON.stringify(user) }),
    ]);
  }

  private async clearStoredSession(): Promise<void> {
    await Promise.all([
      Preferences.remove({ key: TOKEN_KEY }),
      Preferences.remove({ key: USER_KEY }),
    ]);
  }

  async getAuthToken(): Promise<string | null> {
    const { value } = await Preferences.get({ key: TOKEN_KEY });
    return value;
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  isAuthenticated(): boolean {
    return this.isAuthenticatedSubject.value;
  }

  async updateUserData(user: User): Promise<void> {
    await Preferences.set({ key: USER_KEY, value: JSON.stringify(user) });
    this.currentUserSubject.next(user);
  }

  /** Fire-and-forget haptic feedback; silently no-ops on web. */
  private async haptic(type: "success" | "error" | "warning"): Promise<void> {
    try {
      const { Haptics, ImpactStyle, NotificationType } = await import("@capacitor/haptics");
      if (type === "success") {
        await Haptics.notification({ type: NotificationType.Success });
      } else if (type === "warning") {
        await Haptics.impact({ style: ImpactStyle.Light });
      } else {
        await Haptics.notification({ type: NotificationType.Error });
      }
    } catch {
      // Haptics unavailable (web) - ignore.
    }
  }
}
