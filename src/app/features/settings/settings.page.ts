import { ChangeDetectorRef, Component, inject, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { firstValueFrom } from "rxjs";
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonIcon,
  IonSpinner,
  IonToggle,
  AlertController,
  LoadingController,
  ModalController,
  ToastController,
  ActionSheetController,
} from "@ionic/angular";
import type { ViewWillEnter } from "@ionic/angular";
import { AuthService, User } from "../../core/services/auth.service";
import { BackgroundTrackerService } from "../../core/services/background-tracker.service";
import { BiometricService } from "../../core/services/biometric.service";
import { LocationService } from "../../core/services/location.service";
import { GeolocationService } from "../../core/services/geolocation.service";
import { SquadService } from "../../core/services/squad.service";
import { Squad } from "../../core/models/squad.models";
import { addIcons } from "ionicons";
import {
  fingerPrintOutline,
  closeOutline,
  locationOutline,
  downloadOutline,
  trashOutline,
  logOutOutline,
  moonOutline,
  sunnyOutline,
  shieldOutline,
  speedometerOutline,
  informationCircleOutline,
  chevronForwardOutline,
  peopleOutline,
  addOutline,
  keyOutline,
  cloudOfflineOutline,
  refreshOutline,
} from "ionicons/icons";

@Component({
  selector: "app-settings",
  templateUrl: "./settings.page.html",
  styleUrls: ["./settings.page.scss"],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonBackButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonIcon,
    IonSpinner,
    IonToggle,
  ],
})
export class SettingsPage implements OnInit, ViewWillEnter {
  private readonly authService = inject(AuthService);
  private readonly backgroundTracker = inject(BackgroundTrackerService);
  private readonly biometricService = inject(BiometricService);
  private readonly locationService = inject(LocationService);
  private readonly geolocationService = inject(GeolocationService);
  private readonly squadService = inject(SquadService);
  private readonly router = inject(Router);
  private readonly alertCtrl = inject(AlertController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly modalCtrl = inject(ModalController);
  private readonly cdr = inject(ChangeDetectorRef);

  /** Always read from the auth service so it reflects login/logout immediately. */
  get currentUser(): User | null {
    return this.authService.getCurrentUser();
  }
  biometricAvailable = false;
  biometricEnabled = false;
  darkMode = false;
  locationTrackingEnabled = true;
  adaptiveGps = true;
  historyCount = 0;

  /** Circles shown in the management section. */
  circles: Squad[] = [];
  circlesLoading = true;
  circlesError = false;

  constructor() {
    addIcons({
      fingerPrintOutline,
      closeOutline,
      locationOutline,
      downloadOutline,
      trashOutline,
      logOutOutline,
      moonOutline,
      sunnyOutline,
      shieldOutline,
      speedometerOutline,
      informationCircleOutline,
      chevronForwardOutline,
      peopleOutline,
      addOutline,
      keyOutline,
      cloudOfflineOutline,
      refreshOutline,
    });
  }

  /** Up to two initials for the profile avatar. */
  get initials(): string {
    const name = (this.currentUser?.username ?? "").trim();
    if (!name) return "?";
    const parts = name.split(/[\s._-]+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
  }

  /** Absolute URL of the saved profile picture, if one exists. */
  get profilePictureUrl(): string | null {
    return this.authService.pictureUrl(this.currentUser?.profile_picture);
  }

  openProfile(): void {
    void this.router.navigate(["/profile"]);
  }

  /** Refresh circles whenever Settings is shown so map changes show up here. */
  ionViewWillEnter(): void {
    void this.loadCircles();
  }

  // ---------------------------------------------------------------------------
  // Circles
  // ---------------------------------------------------------------------------

  async loadCircles(): Promise<void> {
    // Keep the current list on screen during a refresh; only the first load
    // shows the spinner.
    this.circlesLoading = this.circles.length === 0;
    this.circlesError = false;
    this.cdr.markForCheck();

    try {
      const circles = await firstValueFrom(this.squadService.getUserSquads());
      this.circles = circles ?? [];
    } catch (error) {
      console.error("Failed to load circles:", error);
      this.circlesError = true;
    } finally {
      this.circlesLoading = false;
      this.cdr.markForCheck();
    }
  }

  isCircleAdmin(circle: Squad): boolean {
    return (circle.user_role ?? circle.role) === "admin";
  }

  circleInitials(name: string): string {
    const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    const first = parts[0].charAt(0);
    const second = parts.length > 1 ? parts[1].charAt(0) : "";
    return (first + second).toUpperCase();
  }

  /** Open the member/role manager for a circle. */
  async openCircle(circle: Squad): Promise<void> {
    const { CircleManageModalComponent } = await import(
      "./circle-manage/circle-manage.modal"
    );

    const modal = await this.modalCtrl.create({
      component: CircleManageModalComponent,
      componentProps: { squad: circle },
      cssClass: "circle-manage-modal",
      backdropDismiss: true,
    });

    await modal.present();
    const { data } = await modal.onWillDismiss<{
      changed?: boolean;
      left?: boolean;
    }>();

    if (data?.changed) {
      await this.loadCircles();
      if (data.left) {
        await this.showToast(`Left ${circle.squad_name}`);
      }
    }
  }

  async createCircle(): Promise<void> {
    const { CreateSquadModalComponent } = await import(
      "../map/create-squad-modal/create-squad-modal.component"
    );

    const modal = await this.modalCtrl.create({
      component: CreateSquadModalComponent,
      cssClass: "squad-form-modal",
      backdropDismiss: true,
    });
    await modal.present();

    const { data, role } = await modal.onWillDismiss<string>();
    if (role !== "confirm" || !data) return;

    const loading = await this.loadingCtrl.create({
      message: "Creating circle...",
    });
    await loading.present();

    try {
      await firstValueFrom(
        this.squadService.createSquad({ squad_name: data })
      );
      await loading.dismiss();
      await this.loadCircles();
      await this.showToast("Circle created");
    } catch (error) {
      await loading.dismiss();
      console.error("Create circle failed:", error);
      await this.showToast(this.errorMessage(error, "Failed to create circle"));
    }
  }

  async joinCircle(): Promise<void> {
    const { JoinSquadModalComponent } = await import(
      "../map/join-squad-modal/join-squad-modal.component"
    );

    const modal = await this.modalCtrl.create({
      component: JoinSquadModalComponent,
      cssClass: "squad-form-modal",
      backdropDismiss: true,
    });
    await modal.present();

    const { data, role } = await modal.onWillDismiss<string>();
    if (role !== "confirm" || !data) return;

    const loading = await this.loadingCtrl.create({
      message: "Joining circle...",
    });
    await loading.present();

    try {
      await firstValueFrom(
        this.squadService.joinSquad({ join_code: data.toUpperCase() })
      );
      await loading.dismiss();
      await this.loadCircles();
      await this.showToast("Joined circle");
    } catch (error) {
      await loading.dismiss();
      console.error("Join circle failed:", error);
      await this.showToast(this.errorMessage(error, "Failed to join circle"));
    }
  }

  /** Surface the API's own message when there is one. */
  private errorMessage(error: unknown, fallback: string): string {
    const message = (error as { error?: { message?: unknown } })?.error?.message;
    return typeof message === "string" && message ? message : fallback;
  }

  async ngOnInit(): Promise<void> {
    this.biometricAvailable = await this.biometricService.isAvailable();
    this.biometricEnabled = await this.biometricService.isEnabled();
    this.historyCount = (await this.locationService.getHistory()).length;
    
    // Load preferences
    this.loadPreferences();
    this.cdr.markForCheck();
  }

  private loadPreferences(): void {
    // Load from localStorage for web, or Preferences for native
    try {
      this.darkMode = localStorage.getItem("konek_dark_mode") === "true";
      this.locationTrackingEnabled = localStorage.getItem("konek_location_tracking") !== "false";
      this.adaptiveGps = localStorage.getItem("konek_adaptive_gps") !== "false";
      
      // Apply dark mode
      if (this.darkMode) {
        document.body.classList.add("dark");
      }
    } catch {
      // Ignore errors
    }
  }

  async toggleBiometric(): Promise<void> {
    if (!this.biometricAvailable) {
      this.showToast("Biometric authentication not available on this device");
      return;
    }

    try {
      if (this.biometricEnabled) {
        await this.biometricService.disable();
        this.biometricEnabled = false;
        this.cdr.markForCheck();
        this.showToast("Biometric login disabled");
        return;
      }

      // Verify biometric before enabling.
      const authenticated = await this.biometricService.authenticate(
        "Enable biometric login for Konek"
      );
      if (!authenticated) {
        this.showToast("Biometric authentication cancelled");
        return;
      }

      // Credentials must be stored so biometric sign-in can actually log in.
      const alert = await this.alertCtrl.create({
        header: "Confirm your password",
        message: "Enter your password once to store it securely for biometric sign-in.",
        inputs: [
          {
            name: "password",
            type: "password",
            placeholder: "Current password",
          },
        ],
        buttons: [
          { text: "Cancel", role: "cancel" },
          {
            text: "Enable",
            handler: async (data) => {
              const password = data?.password ?? "";
              if (password.length < 6) {
                this.showToast("Password must be at least 6 characters");
                return false;
              }

              const user = this.authService.getCurrentUser();
              if (!user) {
                this.showToast("You need to be signed in");
                return false;
              }

              const valid = await this.verifyPassword(user.username, password);
              if (!valid) {
                this.showToast("Incorrect password");
                return false;
              }

              await this.biometricService.storeCredentials(user.username, password);
              await this.biometricService.enable();
              this.biometricEnabled = true;
              this.cdr.markForCheck();
              this.showToast("Biometric login enabled!");
              return true;
            },
          },
        ],
      });
      await alert.present();
    } catch (error) {
      console.error("Biometric toggle error:", error);
      this.showToast("Failed to update biometric settings");
    }
  }

  private async verifyPassword(username: string, password: string): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.authService.login({ username, password })
      );
      return response.success === true;
    } catch {
      return false;
    }
  }

  async toggleDarkMode(): Promise<void> {
    this.darkMode = !this.darkMode;
    localStorage.setItem("konek_dark_mode", this.darkMode.toString());

    // `dark` drives the app's own styles, `ion-palette-dark` is what Ionic's
    // dark palette (toolbars, lists, alerts) listens for. It must go on <html>,
    // because Ionic puts its `md`/`ios` class there too.
    document.body.classList.toggle("dark", this.darkMode);
    document.documentElement.classList.toggle("ion-palette-dark", this.darkMode);
  }

  async toggleLocationTracking(): Promise<void> {
    this.locationTrackingEnabled = !this.locationTrackingEnabled;
    localStorage.setItem("konek_location_tracking", this.locationTrackingEnabled.toString());
    
    if (!this.locationTrackingEnabled) {
      // The map owns foreground tracking; stop the native background uploader.
      await this.backgroundTracker.stop();
      this.showToast("Location tracking disabled");
    } else {
      void this.backgroundTracker.start(10000);
      this.showToast("Location tracking enabled");
    }
  }

  async toggleAdaptiveGps(): Promise<void> {
    this.adaptiveGps = !this.adaptiveGps;
    localStorage.setItem("konek_adaptive_gps", this.adaptiveGps.toString());
    this.geolocationService.setAdaptivePolling(this.adaptiveGps);
  }

  async exportHistory(): Promise<void> {
    const sheet = await this.actionSheetCtrl.create({
      header: "Export location history",
      buttons: [
        { text: "JSON", handler: () => void this.doExport("json") },
        { text: "CSV", handler: () => void this.doExport("csv") },
        { text: "Cancel", role: "cancel" },
      ],
    });
    await sheet.present();
  }

  private async doExport(format: "json" | "csv"): Promise<void> {
    const loading = await this.loadingCtrl.create({ message: "Preparing export..." });
    await loading.present();

    try {
      const data = await this.locationService.exportHistory();
      if (!data) {
        await loading.dismiss();
        this.showToast("No location history to export");
        return;
      }

      if (format === "csv") {
        await this.geolocationService.exportTextToFile(
          this.locationService.toCsv(data.locations),
          "konek-location-history.csv",
          "text/csv"
        );
      } else {
        await this.geolocationService.exportToFile(data, "konek-location-history.json");
      }

      await loading.dismiss();
      this.showToast(`Location history exported as ${format.toUpperCase()}`);
    } catch (error) {
      await loading.dismiss();
      console.error("Export failed:", error);
      this.showToast("Failed to export history");
    }
  }

  async clearHistory(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: "Clear History",
      message: "This will delete all your local location history. This cannot be undone.",
      buttons: [
        { text: "Cancel", role: "cancel" },
        {
          text: "Clear",
          role: "destructive",
          handler: async () => {
            await this.locationService.clearHistory();
            this.historyCount = 0;
            this.cdr.markForCheck();
            this.showToast("Location history cleared");
          },
        },
      ],
    });
    await alert.present();
  }

  async changePassword(): Promise<void> {
    // Lazy-load so the settings bundle stays small.
    const { ChangePasswordModalComponent } = await import(
      "./change-password/change-password.modal"
    );

    const modal = await this.modalCtrl.create({
      component: ChangePasswordModalComponent,
      componentProps: {
        passwordSet: this.currentUser?.password_set ?? 1,
      },
      cssClass: "change-password-modal",
      backdropDismiss: true,
    });

    await modal.present();
    const { data, role } = await modal.onWillDismiss<{ updated?: boolean }>();

    if (role !== "confirm" || !data?.updated) return;

    this.showToast("Password updated successfully");

    // Refresh the cached profile so password_set and future prompts stay in sync.
    this.authService.getProfile().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.cdr.markForCheck();
        }
      },
      error: () => {
        // The password itself is already saved; a stale profile is harmless.
      },
    });
  }

  async logout(): Promise<void> {
    const actionSheet = await this.actionSheetCtrl.create({
      header: "Sign Out",
      buttons: [
        {
          text: "Sign Out",
          role: "destructive",
          icon: "log-out-outline",
          handler: async () => {
            const loading = await this.loadingCtrl.create({ message: "Signing out..." });
            await loading.present();

            // Stop the native uploader before the token is cleared.
            await this.backgroundTracker.stop();

            this.authService.logout().subscribe({
              next: async () => {
                await loading.dismiss();
                this.router.navigate(["/login"], { replaceUrl: true });
              },
              error: async () => {
                await loading.dismiss();
                this.router.navigate(["/login"], { replaceUrl: true });
              },
            });
          },
        },
        {
          text: "Cancel",
          role: "cancel",
          icon: "close-outline",
        },
      ],
    });
    await actionSheet.present();
  }

  async showAbout(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: "About Konek",
      message: `
        <p class="about-version">Version 1.0.0</p>
        <p>Stay connected with your circle through real-time location sharing.</p>
        <p class="about-tech">Built with Ionic, Angular, Capacitor &amp; MapLibre GL JS.</p>
      `,
      buttons: ["OK"],
      cssClass: "about-alert",
    });
    await alert.present();
  }

  private async showToast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      position: "bottom",
      cssClass: "custom-toast",
    });
    await toast.present();
  }
}