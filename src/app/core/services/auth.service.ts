import { Injectable, inject } from "@angular/core";
import { HttpClient, HttpHeaders } from "@angular/common/http";
import {
  BehaviorSubject,
  Observable,
  ReplaySubject,
  catchError,
  defer,
  finalize,
  from,
  map,
  of,
  share,
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
   * Password reset request identifier. The screen uses it while checking the
   * emailed verification code.
   */
  session_id?: string;
  /** Password reset verification method requested by the backend. */
  verification_method?: "code" | "link";
  /** Number of digits in the emailed verification code. */
  code_length?: number;
}

/** Result of polling a cross-device password reset session. */
export interface ResetSessionStatus {
  success: boolean;
  status: "pending" | "verified" | "expired";
  token?: string;
  message?: string;
}

/** Result of checking an emailed password verification code. */
export interface ResetCodeVerification {
  success: boolean;
  valid: boolean;
  message: string;
  token?: string;
  attempts_remaining?: number;
}

/** Result of requesting a password-change verification code. */
export interface PasswordCodeResponse {
  success: boolean;
  message: string;
  session_id?: string;
  verification_method?: "code";
  code_length?: number;
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data?: T;
}

interface SessionSnapshot {
  token: string | null;
  epoch: number;
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

  /** Emits while the current session is being explicitly logged out. */
  private readonly loggingOutSubject = new BehaviorSubject<boolean>(false);
  readonly loggingOut$ = this.loggingOutSubject.asObservable();

  /** Explicit logout operation that currently owns the logging-out state. */
  private loggingOutOperationId: number | null = null;
  /** Shared logout request for the current session. */
  private logoutRequest$: Observable<ApiResponse<void>> | null = null;
  private logoutRequestOperationId: number | null = null;
  private logoutRequestEpoch: number | null = null;
  private logoutRequestToken: string | null = null;
  private logoutOperationId = 0;
  /** Changes whenever persisted session identity changes. */
  private sessionEpoch = 0;
  /** Latest session-producing request wins over older responses. */
  private sessionRequestId = 0;
  /** Serializes session reads and writes so stale state cannot overwrite newer state. */
  private storageMutation: Promise<void> = Promise.resolve();

  /** Resolves once the persisted session has been read from storage. */
  private sessionReady: Promise<void>;

  constructor() {
    this.sessionReady = this.loadStoredSession();
  }

  private async loadStoredSession(): Promise<void> {
    try {
      await this.enqueueStorageRead(async () => {
        const [{ value: token }, { value: userData }] = await Promise.all([
          Preferences.get({ key: TOKEN_KEY }),
          Preferences.get({ key: USER_KEY }),
        ]);

        if (!token || !userData) return;

        const user = JSON.parse(userData) as User;
        user.auth_token = token;
        if (this.currentUserSubject.value?.auth_token !== token) {
          this.sessionEpoch++;
          this.currentUserSubject.next(user);
          this.isAuthenticatedSubject.next(true);
        }
      });
    } catch (error) {
      console.error("Failed to restore session:", error);
      const expectedToken =
        this.currentUserSubject.value?.auth_token ?? null;
      const expectedEpoch = this.sessionEpoch;
      await this.clearStoredSession(expectedToken, expectedEpoch, true);
    }
  }

  /** Wait until the stored session has been loaded (used by the auth guard). */
  async whenReady(): Promise<void> {
    return this.sessionReady;
  }
  /** Reload session from storage; call after external session changes. */
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

  /** Verify a six-digit code emailed for a password reset or change. */
  verifyPasswordCode(
    sessionId: string,
    code: string
  ): Observable<ResetCodeVerification> {
    return this.http.post<ResetCodeVerification>(
      `${environment.apiUrl}/api_verify_reset_code.php`,
      { session_id: sessionId, code }
    );
  }

  /** Send a password-change verification code to the signed-in user's email. */
  requestPasswordChangeCode(): Observable<PasswordCodeResponse> {
    return this.http.post<PasswordCodeResponse>(
      `${environment.apiUrl}/api_request_password_change_code.php`,
      {},
      { headers: this.authHeaders(true) }
    );
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
      defer(() => {
        const requestId = ++this.sessionRequestId;
        return source.pipe(
          switchMap((response) => {
            if (!response.success || !response.data) {
              return from(Promise.resolve(response));
            }
            const user = response.data;
            return from(
              this.persistSession(user.auth_token, user, requestId)
            ).pipe(
              tap((persisted) => {
                if (persisted) {
                  void this.haptic("success");
                }
              }),
              map(() => response)
            );
          }),
          catchError((error) => {
            console.error(`${label} failed:`, error);
            return throwError(() => error);
          })
        );
      });
  }

  changePassword(
    currentPassword: string | null,
    newPassword: string,
    verificationToken: string
  ): Observable<ApiResponse<void>> {
    const token = this.currentUserSubject.value?.auth_token;
    const headers = new HttpHeaders({
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    });

    return this.http.post<ApiResponse<void>>(
      `${environment.apiUrl}/api_change_password.php`,
      {
        current_password: currentPassword ?? "",
        new_password: newPassword,
        verification_token: verificationToken,
      },
      { headers }
    );
  }

  /** Load the signed-in user's profile from the server and cache it locally. */
  getProfile(): Observable<ApiResponse<User>> {
    return defer(() => {
      const session = this.captureSession();
      return this.http
        .get<ApiResponse<User>>(`${environment.apiUrl}/api_get_profile.php`, {
          headers: this.authHeaders(false, session.token),
        })
        .pipe(this.mergeProfileIntoSession(session));
    });
  }

  /** Update the signed-in user's name, email, and contact number. */
  updateProfile(updates: ProfileUpdate): Observable<ApiResponse<User>> {
    return defer(() => {
      const session = this.captureSession();
      return this.http
        .post<ApiResponse<User>>(`${environment.apiUrl}/api_update_profile.php`, updates, {
          headers: this.authHeaders(true, session.token),
        })
        .pipe(this.mergeProfileIntoSession(session));
    });
  }

  /**
   * Upload a profile picture picked from the device. The file is sent as
   * multipart/form-data; the browser sets the boundary (no Content-Type header).
   */
  uploadProfilePicture(file: File): Observable<ApiResponse<User>> {
    const formData = new FormData();
    formData.append("profile_picture", file, file.name);

    return defer(() => {
      const session = this.captureSession();
      return this.http
        .post<ApiResponse<User>>(`${environment.apiUrl}/api_upload_profile_picture.php`, formData, {
          headers: this.authHeaders(false, session.token),
        })
        .pipe(this.mergeProfileIntoSession(session));
    });
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
  private mergeProfileIntoSession(session: SessionSnapshot) {
    return (source: Observable<ApiResponse<User>>): Observable<ApiResponse<User>> =>
      source.pipe(
        switchMap((response) => {
          if (!response.success || !response.data) {
            return from(Promise.resolve(response));
          }
          const current = this.currentUserSubject.value;
          if (
            !current ||
            current.auth_token !== session.token ||
            this.sessionEpoch !== session.epoch
          ) {
            return from(Promise.resolve(response));
          }
          const merged: User = {
            ...current,
            ...response.data,
            auth_token: session.token ?? current.auth_token,
          } as User;
          return from(
            this.updateUserData(merged, session.token, session.epoch)
          ).pipe(map(() => response));
        })
      );
  }

  /** Capture the session identity that owns an account-bound request. */
  private captureSession(): SessionSnapshot {
    return {
      token: this.currentUserSubject.value?.auth_token ?? null,
      epoch: this.sessionEpoch,
    };
  }

  private authHeaders(
    json = false,
    token: string | null | undefined = this.currentUserSubject.value?.auth_token
  ): HttpHeaders {
    return new HttpHeaders({
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    });
  }

  logout(): Observable<ApiResponse<void>> {
    const currentToken = this.currentUserSubject.value?.auth_token ?? null;
    const currentEpoch = this.sessionEpoch;
    if (this.logoutRequest$) {
      const sameSession =
        this.logoutRequestEpoch === currentEpoch &&
        this.logoutRequestToken === currentToken;
      const sessionAlreadyCleared =
        currentToken === null && this.isLoggingOut();
      if (sameSession || sessionAlreadyCleared) {
        return this.logoutRequest$;
      }
    }

    const operationId = ++this.logoutOperationId;
    const expectedEpoch = currentEpoch;
    const token = currentToken;
    const headers = new HttpHeaders({
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    });

    const request$ = defer(() => {
      const activeToken =
        this.currentUserSubject.value?.auth_token ?? null;
      if (
        this.sessionEpoch !== expectedEpoch ||
        activeToken !== token
      ) {
        return of<ApiResponse<void>>({ success: true, message: "Signed out" });
      }

      this.loggingOutOperationId = operationId;
      this.sessionRequestId++;
      this.setLoggingOut(true);

      const request = token
        ? this.http.post<ApiResponse<void>>(
            `${environment.apiUrl}/api_logout.php`,
            {},
            { headers }
          )
        : of<ApiResponse<void>>({ success: true, message: "Signed out" });

      // Clear local state before waiting for the server. Polling stops at once,
      // and a failed logout still leaves the device signed out.
      return from(
        this.clearStoredSession(token, expectedEpoch, true)
      ).pipe(
        catchError(() => of(false)),
        switchMap((cleared) =>
          cleared
            ? request
            : of<ApiResponse<void>>({ success: true, message: "Signed out" })
        )
      );
    }).pipe(
      finalize(() => {
        if (this.logoutRequestOperationId === operationId) {
          this.logoutRequest$ = null;
          this.logoutRequestOperationId = null;
          this.logoutRequestEpoch = null;
          this.logoutRequestToken = null;
        }
        if (this.loggingOutOperationId === operationId) {
          this.loggingOutOperationId = null;
          this.setLoggingOut(false);
        }
      })
    );

    const logoutSubject = new ReplaySubject<ApiResponse<void>>(1);
    this.logoutRequest$ = request$.pipe(
      share({
        connector: () => logoutSubject,
        resetOnError: false,
        resetOnComplete: false,
        resetOnRefCountZero: false,
      })
    );
    this.logoutRequestOperationId = operationId;
    this.logoutRequestEpoch = expectedEpoch;
    this.logoutRequestToken = token;
    return this.logoutRequest$;
  }

  /** Serialize session storage operations so old state cannot replace new state. */
  private enqueueStorageTask<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.storageMutation.then(operation, operation);
    this.storageMutation = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  /** Queue a write behind every earlier session read and write. */
  private enqueueStorageMutation<T>(operation: () => Promise<T>): Promise<T> {
    return this.enqueueStorageTask(operation);
  }

  /** Queue a read behind every earlier session write. */
  private enqueueStorageRead<T>(operation: () => Promise<T>): Promise<T> {
    return this.enqueueStorageTask(operation);
  }

  /** Persist and publish only the latest session-producing response. */
  private async persistSession(
    token: string,
    user: User,
    requestId: number
  ): Promise<boolean> {
    const sessionUser: User = { ...user, auth_token: token };
    return this.enqueueStorageMutation(async () => {
      if (requestId !== this.sessionRequestId) return false;

      await Promise.all([
        Preferences.set({ key: TOKEN_KEY, value: token }),
        Preferences.set({ key: USER_KEY, value: JSON.stringify(sessionUser) }),
      ]);

      if (requestId !== this.sessionRequestId) {
        const activeToken =
          this.currentUserSubject.value?.auth_token ?? null;
        if (activeToken !== token || this.isLoggingOut()) {
          try {
            const { value: storedToken } = await Preferences.get({
              key: TOKEN_KEY,
            });
            if ((storedToken ?? null) === token) {
              await Promise.all([
                Preferences.remove({ key: TOKEN_KEY }),
                Preferences.remove({ key: USER_KEY }),
              ]);
            }
          } catch {
            // A newer session or logout owns storage now.
          }
        }
        return false;
      }

      this.cancelLoggingOut();
      this.sessionEpoch++;
      this.currentUserSubject.next(sessionUser);
      this.isAuthenticatedSubject.next(true);
      this.sessionReady = Promise.resolve();
      return true;
    });
  }

  /**
   * Clear session storage only when it still belongs to the expected session.
   * A late logout must never remove credentials written by a newer login.
   */
  private clearStoredSession(
    expectedToken?: string | null,
    expectedEpoch?: number,
    clearMemory = false
  ): Promise<boolean> {
    return this.enqueueStorageMutation(async () => {
      if (
        expectedEpoch !== undefined &&
        this.sessionEpoch !== expectedEpoch
      ) {
        return false;
      }

      const currentToken = this.currentUserSubject.value?.auth_token ?? null;
      if (expectedToken !== undefined && currentToken !== expectedToken) {
        return false;
      }

      let storedToken: string | null = null;
      try {
        const stored = await Preferences.get({ key: TOKEN_KEY });
        storedToken = stored.value ?? null;
      } catch {
        // Continue clearing memory even when storage cannot be read.
      }
      const storedSessionMatches =
        expectedToken === undefined ||
        expectedToken === null ||
        storedToken === expectedToken;

      // Keep newer stored credentials when they do not belong to this
      // session, but still clear the matching in-memory session.
      if (storedSessionMatches) {
        try {
          await Promise.all([
            Preferences.remove({ key: TOKEN_KEY }),
            Preferences.remove({ key: USER_KEY }),
          ]);
        } catch {
          // Local memory must still be cleared if storage removal fails.
        }
      }

      if (!clearMemory) return true;

      // Drop the remembered map circle so the next account never sees the
      // previous user's circle name flash before the list loads.
      try {
        localStorage.removeItem("konek_active_squad");
      } catch {
        // localStorage may be unavailable in private mode.
      }

      this.sessionEpoch++;
      this.currentUserSubject.next(null);
      this.isAuthenticatedSubject.next(false);
      this.sessionReady = Promise.resolve();
      return true;
    });
  }

  /** Publish explicit-logout state for the operation that owns it. */
  private setLoggingOut(loggingOut: boolean): void {
    if (this.loggingOutSubject.value !== loggingOut) {
      this.loggingOutSubject.next(loggingOut);
    }
  }

  /** A newer authenticated session supersedes any older logout operation. */
  private cancelLoggingOut(): void {
    this.loggingOutOperationId = null;
    this.setLoggingOut(false);
  }

  /**
   * Discard the local session after the API rejected its token. Unlike
   * logout(), no server call is made: the token is already invalid, so the
   * only useful recovery is sending the user back to login.
   */
  async expireSession(
    expectedToken = this.currentUserSubject.value?.auth_token ?? null,
    expectedEpoch = this.sessionEpoch
  ): Promise<boolean> {
    // Reject an expiry for a session that was already replaced. Only the
    // session that was active when expiry was detected may invalidate pending
    // session-producing requests.
    const currentToken = this.currentUserSubject.value?.auth_token ?? null;
    if (
      currentToken !== expectedToken ||
      this.sessionEpoch !== expectedEpoch
    ) {
      return false;
    }

    // Invalidate login or password-reset responses that started before this
    // expiry. A newer login started afterwards receives a newer request id
    // and can still establish its session.
    this.sessionRequestId++;

    const cleared = await this.clearStoredSession(
      expectedToken,
      expectedEpoch,
      true
    );
    if (!cleared) return false;

    return true;
  }

  async getAuthToken(): Promise<string | null> {
    const { value } = await this.enqueueStorageRead(() =>
      Preferences.get({ key: TOKEN_KEY })
    );
    return value ?? null;
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  isAuthenticated(): boolean {
    return this.isAuthenticatedSubject.value;
  }

  /** True while an explicit logout is running. */
  isLoggingOut(): boolean {
    return this.loggingOutSubject.value;
  }

  /** Identifies the current authenticated session for stale-response checks. */
  getSessionEpoch(): number {
    return this.sessionEpoch;
  }

  async updateUserData(
    user: User,
    expectedToken = this.currentUserSubject.value?.auth_token ?? null,
    expectedEpoch = this.sessionEpoch
  ): Promise<boolean> {
    const sessionUser: User = {
      ...user,
      auth_token: expectedToken ?? user.auth_token,
    };
    return this.enqueueStorageMutation(async () => {
      const currentToken =
        this.currentUserSubject.value?.auth_token ?? null;
      if (
        currentToken !== expectedToken ||
        this.sessionEpoch !== expectedEpoch
      ) {
        return false;
      }

      await Preferences.set({
        key: USER_KEY,
        value: JSON.stringify(sessionUser),
      });
      if (
        this.currentUserSubject.value?.auth_token !== expectedToken ||
        this.sessionEpoch !== expectedEpoch
      ) {
        return false;
      }
      this.currentUserSubject.next(sessionUser);
      return true;
    });
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



