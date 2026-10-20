import { ChangeDetectorRef, Component, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { Router, RouterLink } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { App } from "@capacitor/app";
import {
  IonApp,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonMenu,
  IonRouterOutlet,
  IonTitle,
  IonToolbar,
  IonAvatar,
  MenuController,
} from "@ionic/angular";
import { addIcons } from "ionicons";
import {
  logInOutline,
  logOutOutline,
  mapOutline,
  peopleOutline,
  personAddOutline,
  personCircleOutline,
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
    IonApp,
    IonRouterOutlet,
    IonMenu,
    IonContent,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonList,
    IonItem,
    IonIcon,
    IonLabel,
    IonAvatar,
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
      personCircleOutline,
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

  /** Apply the persisted (or system) dark-mode preference at startup. */
  private applyThemePreference(): void {
    try {
      const stored = localStorage.getItem("konek_dark_mode");
      const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
      if (stored === "true" || (stored === null && prefersDark)) {
        document.body.classList.add("dark");
      }
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
      this.authService.logout().subscribe({
        error: (error) => console.debug("Logout API failed:", error),
      });
    } catch {
      // Local session is cleared inside the service regardless.
    }
  }
}
