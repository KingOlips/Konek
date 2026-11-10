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
];

/**
 * Follow-up 401s keep arriving from polling requests while the first one is
 * being handled. Handle once, then stay quiet for a few seconds.
 */
const HANDLE_COOLDOWN_MS = 5000;
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

  return next(req).pipe(
    catchError((error: unknown) => {
      const sessionExpired =
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        !CREDENTIAL_ENDPOINTS.some((endpoint) => req.url.includes(endpoint));

      if (sessionExpired) {
        void handleExpiredSession(router, toastCtrl, injector);
      }

      return throwError(() => error);
    })
  );
};

async function handleExpiredSession(
  router: Router,
  toastCtrl: ToastController,
  injector: Injector
): Promise<void> {
  const now = Date.now();
  if (now - lastHandledAt < HANDLE_COOLDOWN_MS) return;
  lastHandledAt = now;

  const authService = injector.get(AuthService);
  await authService.expireSession();

  // The native foreground service uploads with its own copy of the token;
  // stop it so it does not keep retrying a dead session in the background.
  void injector.get(BackgroundTrackerService).stop();

  if (router.url.startsWith("/login")) return;

  const toast = await toastCtrl.create({
    message: "Session expired. Please sign in again.",
    duration: 3000,
    position: "top",
    cssClass: "update-toast",
  });
  await toast.present();

  await router.navigate(["/login"]);
}
