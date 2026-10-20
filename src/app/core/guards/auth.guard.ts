import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { AuthService } from "../services/auth.service";

/**
 * Protects routes that require a signed-in user.
 * Waits for the persisted session to load, then redirects to /login.
 */
export const authGuard: CanActivateFn = async (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  await authService.whenReady();

  if (authService.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree(["/login"], {
    queryParams: { returnUrl: state.url },
  });
};

/**
 * Keeps signed-in users away from /login and /register.
 */
export const guestGuard: CanActivateFn = async () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  await authService.whenReady();

  if (!authService.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree(["/map"]);
};
