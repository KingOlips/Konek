import {
  HttpErrorResponse,
  HttpInterceptorFn,
} from "@angular/common/http";
import { Injector, inject } from "@angular/core";
import { Router } from "@angular/router";
import { ToastController } from "@ionic/angular";
import { catchError, throwError } from "rxjs";

import { AuthService } from "../services/auth.service";
import { BackgroundTrackerService } from "../services/background-tracker.service";

/**
 * Auth endpoints where a 401 means "wrong credentials", not "dead session".
 * Signing the user out on those would be wrong (and would wipe the form data
 * the login page is about to show an error for).
 */
const CREDENTIAL_ENDPOINTS = [
  "api_login.php",
  "api_register.php",
  "api_forgot_password.php",
  "api_reset_password.php",
  "api_logout.php",
];

/**
 * Follow-up 401s keep arriving from polling requests while the first one is
 * being handled. Handle once, then stay quiet for a few seconds.
 */
const HANDLE_COOLDOWN_MS = 5000;
let lastHandledSessionKey: string | null = null;
let lastHandledAt = 0;

/**
 * The API has a single token per user that is overwritten on every login, so
 * a 401 means the stored token is already dead and cannot be refreshed. Clear
 * the local session and send the user to the login screen instead of leaving
 * the app stuck spamming failing requests.
 */
export const authExpiryInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const toastCtrl = inject(ToastController);
  // AuthService injects HttpClient, which owns this interceptor chain:
  // resolve it lazily to avoid a circular dependency at bootstrap.
  const injector = inject(Injector);
  const requestToken = getBearerToken(req.headers.get("Authorization"));
  const requestEpoch = requestToken
    ? injector.get(AuthService).getSessionEpoch()
    : null;

  return next(req).pipe(
    catchError((error: unknown) => {
      const sessionExpired =
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        requestToken !== null &&
        requestEpoch !== null &&
        !CREDENTIAL_ENDPOINTS.some((endpoint) => req.url.includes(endpoint));

      if (sessionExpired) {
        void handleExpiredSession(
          router,
          toastCtrl,
          injector,
          requestToken,
          requestEpoch
        );
      }

      return throwError(() => error);
    })
  );
};

function getBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) return null;
  const token = authorization.slice(prefix.length).trim();
  return token || null;
}

async function handleExpiredSession(
  router: Router,
  toastCtrl: ToastController,
  injector: Injector,
  requestToken: string,
  requestEpoch: number
): Promise<void> {
  const authService = injector.get(AuthService);
  const token = authService.getCurrentUser()?.auth_token;
  const sessionEpoch = authService.getSessionEpoch();

  // Ignore a late response from an older session. A stale 401 must never
  // expire credentials that were replaced after the request was sent.
  if (
    token !== requestToken ||
    sessionEpoch !== requestEpoch ||
    authService.isLoggingOut() ||
    !authService.isAuthenticated()
  ) {
    return;
  }

  const sessionKey = `${sessionEpoch}:${token}`;
  const now = Date.now();
  if (
    sessionKey === lastHandledSessionKey &&
    now - lastHandledAt < HANDLE_COOLDOWN_MS
  ) {
    return;
  }
  lastHandledSessionKey = sessionKey;
  lastHandledAt = now;

  const expired = await authService.expireSession(token, sessionEpoch);
  if (!expired) return;
  const expiredEpoch = authService.getSessionEpoch();

  // The native foreground service uploads with its own copy of the token;
  // stop it so it does not keep retrying a dead session in the background.
  void injector.get(BackgroundTrackerService).stop();

  // Logout or a new login can begin while session cleanup is pending. Never
  // show expiry feedback for a session that is no longer active.
  if (
    authService.getSessionEpoch() !== expiredEpoch ||
    authService.isLoggingOut() ||
    authService.isAuthenticated()
  ) {
    return;
  }

  const toast = await toastCtrl.create({
    message: "Session expired. Please sign in again.",
    duration: 3000,
    position: "top",
    cssClass: "update-toast",
  });
  if (
    authService.getSessionEpoch() !== expiredEpoch ||
    authService.isLoggingOut() ||
    authService.isAuthenticated()
  ) {
    return;
  }

  await toast.present();
  if (
    authService.getSessionEpoch() !== expiredEpoch ||
    authService.isLoggingOut() ||
    authService.isAuthenticated()
  ) {
    await toast.dismiss();
    return;
  }

  await router.navigate(["/login"]);
}
