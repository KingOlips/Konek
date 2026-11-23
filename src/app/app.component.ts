import { ChangeDetectorRef, Component, OnInit, inject } from "@angular/core";
import { NavigationEnd, Router } from "@angular/router";
import { filter, firstValueFrom, take } from "rxjs";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { IonApp, IonRouterOutlet, ModalController, Platform } from "@ionic/angular";
import { AuthService } from "./core/services/auth.service";
import { BackgroundTrackerService } from "./core/services/background-tracker.service";
import { BiometricService } from "./core/services/biometric.service";
import { PasswordResetLinkService } from "./core/services/password-reset-link.service";

@Component({
  selector: "app-root",
  templateUrl: "app.component.html",
  styleUrls: ["app.component.scss"],
  standalone: true,
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly backgroundTracker = inject(BackgroundTrackerService);
  private readonly biometricService = inject(BiometricService);
  private readonly resetLink = inject(PasswordResetLinkService);
  private readonly modalCtrl = inject(ModalController);
  private readonly platform = inject(Platform);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);

  isAuthenticated = false;
  private pausedAt = 0;
  private resetModalOpening = false;

  constructor() {
    this.authService.currentUser$.subscribe((user) => {
      this.isAuthenticated = !!user;
      this.cdr.markForCheck();
    });

    void this.setupBiometricLock();
    this.applyThemePreference();
  }

  ngOnInit(): void {
    void this.setupDeepLinks();
  }

  /**
   * The "Verify" button in the password reset email opens Konek with a reset
   * token. Handle both cases:
   *  - the app was already running (appUrlOpen), and
   *  - the link cold-started the app (getLaunchUrl + initial navigation).
   *
   * The reset UI is the forgot-password popup, not a route: if it is already
   * open the token makes it switch to the new-password step, otherwise the
   * popup is presented with the token.
   */
  private async setupDeepLinks(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;

    try {
      await this.platform.ready();
    } catch {
      // Platform readiness is best-effort; the listeners below still work.
    }

    try {
      const launch = await App.getLaunchUrl();
      if (launch?.url) {
        const token = this.resetTokenFromUrl(launch.url);
        if (token) {
          // On a cold start the root view must exist before a modal can be
          // presented over it. Wait until the start page has redirected.
          await this.waitForInitialNavigation();
          await this.handleResetToken(token);
        }
      }
    } catch {
      // Launch URL is not available on every platform.
    }

    try {
      await App.addListener("appUrlOpen", ({ url }) => {
        const token = this.resetTokenFromUrl(url);
        if (token) void this.handleResetToken(token);
      });
    } catch (error) {
      console.debug("App URL listener unavailable:", error);
    }
  }

  /**
   * Present the reset popup, or hand the token to the popup that is already
   * open so it changes to the "Set a new password" step in place.
   */
  private async handleResetToken(token: string): Promise<void> {
    // Mark the pending request verified even when Android's App Link opened
    // the app directly instead of the HTTPS landing page. This is what lets a
    // desktop that started the reset switch to its password form.
    try {
      await firstValueFrom(this.authService.verifyResetToken(token));
    } catch {
      // The landing page may already have verified it; continue either way.
    }

    if (this.resetLink.hasOpenModal()) {
      this.resetLink.pushToken(token);
      return;
    }

    if (this.resetModalOpening) return;
    this.resetModalOpening = true;

    try {
      const { ForgotPasswordModalComponent } = await import(
        "./features/auth/forgot-password/forgot-password.modal"
      );
      const modal = await this.modalCtrl.create({
        component: ForgotPasswordModalComponent,
        componentProps: { token },
        cssClass: "forgot-password-modal",
        backdropDismiss: true,
      });
      await modal.present();

      // `resetPassword()` signs the user in, so a completed reset goes straight
      // to the map; cancelling leaves them on the page behind the popup.
      const { data, role } = await modal.onWillDismiss();
      if (role === "confirm" && data?.reset) {
        await this.router.navigate(["/map"], { replaceUrl: true });
      }
    } finally {
      this.resetModalOpening = false;
    }
  }

  /** Resolve once the router leaves the start route, or after a short wait. */
  private waitForInitialNavigation(): Promise<void> {
    if (this.router.url !== "/" && this.router.url !== "") {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const sub = this.router.events
        .pipe(
          filter((event): event is NavigationEnd => event instanceof NavigationEnd),
          filter(
            (event) =>
              event.urlAfterRedirects !== "/" && event.urlAfterRedirects !== ""
          ),
          take(1)
        )
        .subscribe(() => {
          clearTimeout(timer);
          resolve();
        });
      timer = setTimeout(() => {
        sub.unsubscribe();
        resolve();
      }, 1500);
    });
  }

  private resetTokenFromUrl(rawUrl: string): string {
    try {
      const url = new URL(rawUrl);
      // Direct deep link (konek://) or the HTTPS App Link used by the email.
      // `reset-password` stays accepted for already-sent emails.
      const isCustomScheme =
        url.protocol === "konek:" &&
        (url.host === "verify-reset" || url.host === "reset-password");
      const isAppLink =
        url.protocol === "https:" &&
        url.pathname === "/konek/backend/api/reset_verify.php";
      if (!isCustomScheme && !isAppLink) {
        return "";
      }
      return url.searchParams.get("token") ?? "";
    } catch {
      return "";
    }
  }

  /** Apply the persisted dark-mode preference at startup. */
  private applyThemePreference(): void {
    try {
      const stored = localStorage.getItem("konek_dark_mode");
      // Only go dark when the user explicitly turned the switch on. Dark mode
      // used to follow the system setting, which made the app open dark while
      // the Settings switch still showed "off".
      const dark = stored === "true";
      // `dark` drives the app's own styles; `ion-palette-dark` switches Ionic's
      // palette (it must sit on <html>, where Ionic sets the `md`/`ios` class).
      document.body.classList.toggle("dark", dark);
      document.documentElement.classList.toggle("ion-palette-dark", dark);
    } catch {
      // localStorage may be unavailable in private mode.
    }
  }

  /**
   * Re-lock the app with Face ID / fingerprint when it returns from the
   * background. Short app switches (< 30s) do not trigger a prompt.
   */
  private async setupBiometricLock(): Promise<void> {
    try {
      await App.addListener("appStateChange", async ({ isActive }) => {
        if (!isActive) {
          this.pausedAt = Date.now();
          return;
        }

        if (!this.isAuthenticated) return;
        if (this.pausedAt && Date.now() - this.pausedAt < 30000) return;
        // A biometric sign-in moments ago already proved who the user is; don't
        // prompt a second time when the native dialog hands control back.
        if (this.biometricService.hasVerifiedRecently()) return;
        if (!(await this.biometricService.isEnabled())) return;

        const unlocked = await this.biometricService.authenticate("Unlock Konek");
        if (!unlocked) {
          // Start logout before stopping the uploader so polling responses
          // cannot be mistaken for an expired session during shutdown.
          const logoutPromise = firstValueFrom(this.authService.logout()).catch(
            () => undefined
          );
          await Promise.all([
            logoutPromise,
            this.backgroundTracker.stop(),
          ]);
          if (!this.authService.isAuthenticated()) {
            await this.router.navigate(["/login"], { replaceUrl: true });
          }
        }
      });
    } catch (error) {
      console.debug("App state listener unavailable:", error);
    }
  }
}
