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
import { Squad } from "../models/squad.models";

export interface User {
  id: number;
  username: string;
  email?: string | null;
  contact_number?: string | null;
  profile_picture?: string | null;
  auth_token: string;
  active_status: number;
  created_at: string;
  squads?: Squad[];
}

export interface ProfileUpdate {
  username: string;
  email: string | null;
  contact_number: string | null;
}

export interface Credentials {
  username: string;
  email?: string;
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

  forgotPassword(email: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${environment.apiUrl}/api_forgot_password.php`, { email });
  }

  resetPassword(token: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${environment.apiUrl}/api_reset_password.php`, { token, password });
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

  /** Load the signed-in user's profile from the server and cache it locally. */
  getProfile(): Observable<ApiResponse<User>> {
    return this.http
      .get<ApiResponse<User>>(`${environment.apiUrl}/api_get_profile.php`, {
        headers: this.authHeaders(),
      })
      .pipe(this.mergeProfileIntoSession());
  }

  /** Update the signed-in user's name, email, and contact number. */
  updateProfile(updates: ProfileUpdate): Observable<ApiResponse<User>> {
    return this.http
      .post<ApiResponse<User>>(`${environment.apiUrl}/api_update_profile.php`, updates, {
        headers: this.authHeaders(true),
      })
      .pipe(this.mergeProfileIntoSession());
  }

  /**
   * Upload a profile picture picked from the device. The file is sent as
   * multipart/form-data; the browser sets the boundary (no Content-Type header).
   */
  uploadProfilePicture(file: File): Observable<ApiResponse<User>> {
    const formData = new FormData();
    formData.append("profile_picture", file, file.name);

    return this.http
      .post<ApiResponse<User>>(`${environment.apiUrl}/api_upload_profile_picture.php`, formData, {
        headers: this.authHeaders(),
      })
      .pipe(this.mergeProfileIntoSession());
  }

  /**
   * Resolve a stored profile picture path (e.g. "uploads/profile_pictures/x.jpg")
   * into an absolute URL that can be used in an <img> tag.
   */
  pictureUrl(path?: string | null): string | null {
    if (!path) return null;
    if (/^https?:\/\//i.test(path)) return path;
    const base = environment.apiUrl.replace(/\/api\/?$/, "");
    return `${base}/${path.replace(/^\/+/, "")}`;
  }

  /** Persist profile fields returned by the API into the cached session. */
  private mergeProfileIntoSession() {
    return (source: Observable<ApiResponse<User>>): Observable<ApiResponse<User>> =>
      source.pipe(
        switchMap((response) => {
          if (!response.success || !response.data) {
            return from(Promise.resolve(response));
          }
          const current = this.currentUserSubject.value;
          const merged: User = { ...current, ...response.data } as User;
          return from(this.updateUserData(merged)).pipe(map(() => response));
        })
      );
  }

  private authHeaders(json = false): HttpHeaders {
    const token = this.currentUserSubject.value?.auth_token;
    return new HttpHeaders({
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    });
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
    // Drop the remembered map squad so the next account never sees the
    // previous user's squad name flash before the list loads.
    try {
      localStorage.removeItem("konek_active_squad");
    } catch {
      // localStorage may be unavailable in private mode.
    }
    await Promise.all([
      Preferences.remove({ key: TOKEN_KEY }),
      Preferences.remove({ key: USER_KEY }),
    ]);
  }

  /**
   * Discard the local session after the API rejected its token. Unlike
   * logout(), no server call is made: the token is already invalid, so the
   * only useful recovery is sending the user back to login.
   */
  async expireSession(): Promise<void> {
    await this.clearStoredSession();
    this.currentUserSubject.next(null);
    this.isAuthenticatedSubject.next(false);
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



