import { ChangeDetectorRef, Component, inject } from "@angular/core";
import { Router } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { App } from "@capacitor/app";
import { IonApp, IonRouterOutlet } from "@ionic/angular";
import { AuthService } from "./core/services/auth.service";
import { BackgroundTrackerService } from "./core/services/background-tracker.service";
import { BiometricService } from "./core/services/biometric.service";

@Component({
  selector: "app-root",
  templateUrl: "app.component.html",
  styleUrls: ["app.component.scss"],
  standalone: true,
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent {
  private readonly authService = inject(AuthService);
  private readonly backgroundTracker = inject(BackgroundTrackerService);
  private readonly biometricService = inject(BiometricService);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);

  isAuthenticated = false;
  private pausedAt = 0;

  constructor() {
    this.authService.currentUser$.subscribe((user) => {
      this.isAuthenticated = !!user;
      this.cdr.markForCheck();
    });

    void this.setupBiometricLock();
    this.applyThemePreference();
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
          // Never keep uploading in the background after a failed unlock.
          await this.backgroundTracker.stop();
          try {
            await firstValueFrom(this.authService.logout());
          } catch {
            // Session is cleared locally even if the API is unreachable.
          }
          await this.router.navigate(["/login"], { replaceUrl: true });
        }
      });
    } catch (error) {
      console.debug("App state listener unavailable:", error);
    }
  }
}
