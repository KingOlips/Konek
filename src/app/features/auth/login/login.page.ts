import { ChangeDetectorRef, Component, inject, OnInit } from "@angular/core";
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";
import { Router } from "@angular/router";
import { firstValueFrom } from "rxjs";
import {
  IonContent,
  IonInput,
  IonButton,
  IonIcon,
  IonSpinner,
  AlertController,
  LoadingController,
  NavController,
} from "@ionic/angular";
import { addIcons } from "ionicons";
import {
  alertCircleOutline,
  arrowForwardOutline,
  eyeOutline,
  eyeOffOutline,
  fingerPrintOutline,
  locationOutline,
  lockClosedOutline,
  peopleOutline,
  personOutline,
  radioOutline,
  shieldCheckmarkOutline,
} from "ionicons/icons";
import { AuthService } from "../../../core/services/auth.service";
import { BiometricService } from "../../../core/services/biometric.service";

@Component({
  selector: "app-login",
  templateUrl: "./login.page.html",
  styleUrls: ["./login.page.scss"],
  standalone: true,
  imports: [
    ReactiveFormsModule,
    IonContent,
    IonInput,
    IonButton,
    IonIcon,
    IonSpinner,
  ],
})
export class LoginPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly navCtrl = inject(NavController);
  private readonly authService = inject(AuthService);
  private readonly biometricService = inject(BiometricService);
  private readonly alertCtrl = inject(AlertController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly cdr = inject(ChangeDetectorRef);

  loginForm!: FormGroup;
  isLoading = false;
  showPassword = false;
  biometricAvailable = false;
  submitted = false;

  constructor() {
    addIcons({
      alertCircleOutline,
      arrowForwardOutline,
      eyeOutline,
      eyeOffOutline,
      fingerPrintOutline,
      locationOutline,
      lockClosedOutline,
      peopleOutline,
      personOutline,
      radioOutline,
      shieldCheckmarkOutline,
    });
  }

  ngOnInit(): void {
    this.loginForm = this.fb.group({
      username: ["", [Validators.required, Validators.minLength(3)]],
      password: ["", [Validators.required, Validators.minLength(6)]],
    });
    void this.checkBiometricAvailability();
  }

  private async checkBiometricAvailability(): Promise<void> {
    this.biometricAvailable = await this.biometricService.isAvailable();
    this.cdr.markForCheck();
  }

  goToRegister(): void {
    void this.navCtrl.navigateRoot("/register", { animated: false, replaceUrl: true });
  }

  async onSubmit(): Promise<void> {
    this.submitted = true;

    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    const { username, password } = this.loginForm.value;
    this.isLoading = true;
    const loading = await this.loadingCtrl.create({
      message: "Signing in...",
      spinner: "crescent",
    });
    await loading.present();

    try {
      const response = await firstValueFrom(this.authService.login({ username, password }));
      await loading.dismiss();

      if (!response.success) {
        await this.showError(response.message || "Login failed. Please try again.");
        return;
      }

      if (this.biometricAvailable && !(await this.biometricService.isEnabled())) {
        await this.offerBiometricEnrollment(username, password);
      } else {
        await this.navigateToMap();
      }
    } catch (error: any) {
      await loading.dismiss();
      console.error("Login error:", error);
      // Status 0 / "Failed to fetch" means the request never reached the API.
      const offline =
        !error?.status || error?.status === 0 || error?.message === "Failed to fetch";
      const message = offline
        ? "Can't reach the Konek server. Check your internet connection and try again in a moment."
        : (error?.error?.message ?? "Login failed. Please try again.");
      await this.showError(message);
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  private async offerBiometricEnrollment(username: string, password: string): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: "Enable Biometric Login?",
      message: "Use Face ID / fingerprint for faster access next time?",
      buttons: [
        {
          text: "Not Now",
          role: "cancel",
          handler: () => void this.navigateToMap(),
        },
        {
          text: "Enable",
          handler: async () => {
            const verified = await this.biometricService.authenticate(
              "Enable biometric login for Konek"
            );
            if (verified) {
              await this.biometricService.storeCredentials(username, password);
              await this.biometricService.enable();
            }
            await this.navigateToMap();
          },
        },
      ],
    });
    await alert.present();
  }

  async onBiometricLogin(): Promise<void> {
    if (!this.biometricAvailable) return;

    this.isLoading = true;
    const loading = await this.loadingCtrl.create({
      message: "Authenticating...",
      spinner: "crescent",
    });
    await loading.present();

    try {
      const authenticated = await this.biometricService.authenticate("Sign in to Konek");
      if (!authenticated) {
        await loading.dismiss();
        return;
      }

      const credentials = await this.biometricService.getCredentials();
      if (!credentials) {
        await loading.dismiss();
        await this.showError("No saved credentials found. Please sign in with your password.");
        return;
      }

      const response = await firstValueFrom(this.authService.login(credentials));
      await loading.dismiss();

      if (response.success) {
        await this.navigateToMap();
      } else {
        await this.showError("Biometric login failed. Please use your password.");
      }
    } catch (error) {
      await loading.dismiss();
      console.error("Biometric login error:", error);
      await this.showError("Biometric login failed. Please use your password.");
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  private async navigateToMap(): Promise<void> {
    await this.router.navigate(["/map"], { replaceUrl: true });
  }

  private async showError(message: string): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: "Login Error",
      message,
      buttons: ["OK"],
      cssClass: "error-alert",
    });
    await alert.present();
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  get username() {
    return this.loginForm.get("username");
  }

  get password() {
    return this.loginForm.get("password");
  }
}
