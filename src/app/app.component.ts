import { ChangeDetectorRef, Component, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { Router, RouterLink, RouterLinkActive } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { App } from "@capacitor/app";
import {
  IonApp,
  IonContent,
  IonIcon,
  IonMenu,
  IonRouterOutlet,
  MenuController,
} from "@ionic/angular";
import { addIcons } from "ionicons";
import {
  logInOutline,
  logOutOutline,
  mapOutline,
  peopleOutline,
  personAddOutline,
  settingsOutline,
} from "ionicons/icons";
import { AuthService, User } from "./core/services/auth.service";
import { BiometricService } from "./core/services/biometric.service";

@Component({
  selector: "app-root",
  templateUrl: "app.component.html",
  styleUrls: ["app.component.scss"],
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    RouterLinkActive,
    IonApp,
    IonRouterOutlet,
    IonMenu,
    IonContent,
    IonIcon,
  ],
})
export class AppComponent {
  private readonly authService = inject(AuthService);
  private readonly biometricService = inject(BiometricService);
  private readonly menuController = inject(MenuController);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);

  currentUser: User | null = null;
  isAuthenticated = false;
  private pausedAt = 0;

  constructor() {
    addIcons({
      logInOutline,
      logOutOutline,
      mapOutline,
      peopleOutline,
      personAddOutline,
      settingsOutline,
    });

    this.authService.currentUser$.subscribe((user) => {
      this.currentUser = user;
      this.isAuthenticated = !!user;
      this.cdr.markForCheck();
    });

    void this.setupBiometricLock();
    this.applyThemePreference();
  }

  /** Up to two initials for the drawer avatar. */
  get initials(): string {
    const name = (this.currentUser?.username ?? "").trim();
    if (!name) return "?";
    const parts = name.split(/[\s._-]+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
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

  async closeMenu(): Promise<void> {
    await this.menuController.close("main-menu");
  }

  async signOut(): Promise<void> {
    await this.closeMenu();
    try {
      await firstValueFrom(this.authService.logout());
    } catch (error) {
      // Local session is cleared inside the service regardless.
      console.debug("Logout API failed:", error);
    }
    await this.router.navigate(["/login"], { replaceUrl: true });
  }
}
