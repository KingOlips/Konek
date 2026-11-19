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
import { Circle } from "../models/circle.models";

export interface User {
  id: number;
  username: string;
  email?: string | null;
  contact_number?: string | null;
  profile_picture?: string | null;
  auth_token: string;
  active_status: number;
  /** 1 when a real password is set; 0 for Google accounts still completing signup. */
  password_set?: number;
  created_at: string;
  /** Login payload uses the backend's legacy `squads` key. */
  squads?: Circle[];
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
  /** Required at registration; the server rejects accounts without consent. */
  terms_accepted?: boolean;
}

export interface AuthResponse {
  success: boolean;
  message: string;
  data?: User;
  /** Present on registration: whether the welcome email was accepted by SMTP. */
  email_sent?: boolean;
  /**
   * Present when a brand-new Google account must finish signing up by picking
   * a username and password before the Konek account is created.
   */
  action_required?: "complete_profile";
  temp_token?: string;
  suggested_username?: string;
  email?: string;
  /**
   * Cross-device password reset: identifies the pending request this screen is
   * watching. The screen switches to the password form once the email link is
   * verified on any device.
   */
  session_id?: string;
}

/** Result of polling a cross-device password reset session. */
export interface ResetSessionStatus {
  success: boolean;
  status: "pending" | "verified" | "expired";
  token?: string;
  message?: string;
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
  private sessionReady: Promise<void>;

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
    /** Reload session from storage; call after login/logout so whenReady() waits for fresh data. */
  async reloadSession(): Promise<void> {
    this.sessionReady = this.loadStoredSession();
    await this.sessionReady;
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

  /**
   * Check whether the reset email has been verified. The device that requested
   * the reset polls this, so verification can happen on any other device (for
   * example the phone that receives the email).
   */
  resetSessionStatus(sessionId: string): Observable<ResetSessionStatus> {
    return this.http.get<ResetSessionStatus>(
      `${environment.apiUrl}/api_reset_session.php`,
      { params: { session_id: sessionId } }
    );
  }

  /**
   * Mark a reset token verified from the native app when an App Link opens
   * Konek directly, skipping the HTTPS landing page. This lets a desktop that
   * started the reset receive the verified event too.
   */
  verifyResetToken(token: string): Observable<ApiResponse<void>> {
    return this.http.get<ApiResponse<void>>(
      `${environment.apiUrl}/api_verify_reset.php`,
      { params: { token } }
    );
  }

  /**
   * Exchange a verified Google ID token for a Konek session. The backend
   * validates the token, links or creates the account, and returns the same
   * payload as a password login. Brand-new Google users get
   * `action_required: "complete_profile"` instead of a session.
   */
  signInWithGoogle(idToken: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${environment.apiUrl}/api_google_login.php`, {
        id_token: idToken,
      })
      .pipe(this.withSession("Google login"));
  }

  /** Create the Konek account for a verified Google signup. */
  completeGoogleProfile(
    tempToken: string,
    username: string,
    password: string,
    termsAccepted: boolean
  ): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(
        `${environment.apiUrl}/api_complete_google_profile.php`,
        {
          temp_token: tempToken,
          username,
          password,
          terms_accepted: termsAccepted,
        }
      )
      .pipe(this.withSession("Google signup"));
  }

  resetPassword(token: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${environment.apiUrl}/api_reset_password.php`, { token, password })
      .pipe(this.withSession("Reset password"));
  }

  private authenticate(endpoint: string, credentials: Credentials): Observable<AuthResponse> {
    const url = `${environment.apiUrl}/${endpoint}`;
    const headers = new HttpHeaders({ "Content-Type": "application/json" });

    return this.http
      .post<AuthResponse>(url, credentials, { headers })
      .pipe(this.withSession(endpoint));
  }

  /**
   * Persist the session returned by registration/login/password-reset so the
   * app is signed in as soon as the response arrives.
   */
  private withSession(label: string) {
    return (source: Observable<AuthResponse>): Observable<AuthResponse> =>
      source.pipe(
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
            tap(() => { this.sessionReady = this.loadStoredSession(); }),
            map(() => response)
          );
        }),
        catchError((error) => {
          console.error(`${label} failed:`, error);
          return throwError(() => error);
        })
      );
  }

  changePassword(
    currentPassword: string | null,
    newPassword: string
  ): Observable<ApiResponse<void>> {
    const token = this.currentUserSubject.value?.auth_token;
    const headers = new HttpHeaders({
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    });

    return this.http.post<ApiResponse<void>>(
      `${environment.apiUrl}/api_change_password.php`,
      { current_password: currentPassword ?? "", new_password: newPassword },
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
    // Drop the remembered map circle so the next account never sees the
    // previous user's circle name flash before the list loads.
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



