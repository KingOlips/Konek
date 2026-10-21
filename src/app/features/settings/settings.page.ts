import { ChangeDetectorRef, Component, inject, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { firstValueFrom } from "rxjs";
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonIcon,
  IonMenuButton,
  IonToggle,
  AlertController,
  LoadingController,
  ToastController,
  ActionSheetController,
} from "@ionic/angular";
import { AuthService, User } from "../../core/services/auth.service";
import { BiometricService } from "../../core/services/biometric.service";
import { LocationService } from "../../core/services/location.service";
import { GeolocationService } from "../../core/services/geolocation.service";
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
  keyOutline,
  speedometerOutline,
  informationCircleOutline,
  chevronForwardOutline,
} from "ionicons/icons";

@Component({
  selector: "app-settings",
  templateUrl: "./settings.page.html",
  styleUrls: ["./settings.page.scss"],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonIcon,
    IonMenuButton,
    IonToggle,
  ],
})
export class SettingsPage implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly biometricService = inject(BiometricService);
  private readonly locationService = inject(LocationService);
  private readonly geolocationService = inject(GeolocationService);
  private readonly router = inject(Router);
  private readonly alertCtrl = inject(AlertController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly cdr = inject(ChangeDetectorRef);

  currentUser: User | null = null;
  biometricAvailable = false;
  biometricEnabled = false;
  darkMode = false;
  locationTrackingEnabled = true;
  adaptiveGps = true;
  historyCount = 0;

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
      keyOutline,
      speedometerOutline,
      informationCircleOutline,
      chevronForwardOutline,
    });
  }

  /** Up to two initials for the profile avatar. */
  get initials(): string {
    const name = (this.currentUser?.username ?? "").trim();
    if (!name) return "?";
    const parts = name.split(/[\s._-]+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
  }

  async ngOnInit(): Promise<void> {
    this.currentUser = this.authService.getCurrentUser();
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
      // Stop tracking would be handled by map page
      this.showToast("Location tracking disabled");
    } else {
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
    const alert = await this.alertCtrl.create({
      header: "Change Password",
      inputs: [
        {
          name: "currentPassword",
          type: "password",
          placeholder: "Current password",
        },
        {
          name: "newPassword",
          type: "password",
          placeholder: "New password (min 6 chars)",
        },
        {
          name: "confirmPassword",
          type: "password",
          placeholder: "Confirm new password",
        },
      ],
      buttons: [
        { text: "Cancel", role: "cancel" },
        {
          text: "Update",
          handler: async (data) => {
            if (data.newPassword !== data.confirmPassword) {
              this.showToast("Passwords do not match");
              return false;
            }
            if ((data.newPassword ?? "").length < 6) {
              this.showToast("Password must be at least 6 characters");
              return false;
            }
            if (data.currentPassword === data.newPassword) {
              this.showToast("Choose a different password");
              return false;
            }

            try {
              const response = await firstValueFrom(
                this.authService.changePassword(data.currentPassword, data.newPassword)
              );
              if (!response.success) {
                this.showToast(response.message || "Failed to update password");
                return false;
              }
              this.showToast("Password updated successfully");
              return true;
            } catch (error: any) {
              this.showToast(
                error?.error?.message ?? "Failed to update password"
              );
              return false;
            }
          },
        },
      ],
    });
    await alert.present();
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
        <p><strong>Version:</strong> 1.0.0</p>
        <p><strong>Build:</strong> 2026.10.20</p>
        <p>Konek helps you stay connected with your squad through real-time location sharing.</p>
        <p>Built with Ionic, Angular, Capacitor, and Leaflet.</p>
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