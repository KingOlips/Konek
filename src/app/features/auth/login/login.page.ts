import { ChangeDetectorRef, Component, inject, OnInit } from "@angular/core";
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";
import { Router } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { HttpClient } from "@angular/common/http";
import { environment } from "../../../../environments/environment";
import {
  IonContent,
  IonInput,
  IonButton,
  IonIcon,
  IonSpinner,
  AlertController,
  LoadingController,
  ModalController,
  NavController,
} from "@ionic/angular";
import { addIcons } from "ionicons";
import {
  alertCircleOutline,
  arrowForwardOutline,
  eyeOutline,
  eyeOffOutline,
  locationOutline,
  lockClosedOutline,
  logoGoogle,
  peopleOutline,
  personOutline,
  radioOutline,
  shieldCheckmarkOutline,
} from "ionicons/icons";
import { AuthService } from "../../../core/services/auth.service";
import { BiometricService } from "../../../core/services/biometric.service";
import { OnboardingService } from "../../../core/services/onboarding.service";

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
  private readonly modalCtrl = inject(ModalController);
  private readonly authService = inject(AuthService);
  private readonly biometricService = inject(BiometricService);
  private readonly onboarding = inject(OnboardingService);
  private readonly alertCtrl = inject(AlertController);
  private readonly http = inject(HttpClient);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly cdr = inject(ChangeDetectorRef);

  loginForm!: FormGroup;
  isLoading = false;
  showPassword = false;
  submitted = false;
  private isBiometricPrompting = false;

  constructor() {
    addIcons({
      alertCircleOutline,
      arrowForwardOutline,
      eyeOutline,
      eyeOffOutline,
      locationOutline,
      lockClosedOutline,
      logoGoogle,
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
    void this.promptSavedBiometricLogin();
  }

  /**
   * Returning users who previously enabled biometrics get prompted right away.
   * New / signed-out users with no saved credentials simply see the form.
   */
  private async promptSavedBiometricLogin(): Promise<void> {
    if (this.isBiometricPrompting) return;
    this.isBiometricPrompting = true;

    try {
      if (!(await this.biometricService.isAvailable())) return;
      if (!(await this.biometricService.isEnabled())) return;

      const credentials = await this.biometricService.getCredentials();
      if (!credentials) {
        // The flag says enabled but nothing is stored: stop advertising it.
        await this.biometricService.disable();
        return;
      }

      this.isLoading = true;
      const loading = await this.loadingCtrl.create({
        message: "Signing in with biometrics...",
        spinner: "crescent",
      });
      await loading.present();

      const authenticated = await this.biometricService.authenticate("Sign in to Konek");
      if (!authenticated) {
        await loading.dismiss();
        return;
      }

      const response = await firstValueFrom(this.authService.login(credentials));
      await loading.dismiss();

      if (response.success) {
        await this.navigateToMap();
      } else {
        // The saved credentials no longer work - forget them so the app stops
        // prompting for biometrics on every visit and falls back to the form.
        await this.biometricService.disable();
        await this.showError(
          "Saved biometric sign-in is out of date. Please sign in with your password."
        );
      }
    } catch (error) {
      console.error("Biometric login error:", error);
      // Fall back to the password form; the loading overlay is dismissed below.
      try {
        await this.loadingCtrl.dismiss();
      } catch {
        // No overlay present - ignore.
      }
    } finally {
      this.isLoading = false;
      this.isBiometricPrompting = false;
      this.cdr.markForCheck();
    }
  }

  goToRegister(): void {
    // Forward push keeps a history entry (so the system back button returns
    // here) but skips Ionic's slide transition between auth screens.
    void this.navCtrl.navigateForward("/register", { animated: false });
  }

  /**
   * Opens the reset flow as a popup so the sign-in form stays behind it.
   * The component is loaded lazily to keep the login bundle small.
   */
  async goToForgotPassword(): Promise<void> {
    const { ForgotPasswordModalComponent } = await import(
      "../forgot-password/forgot-password.modal"
    );
    const modal = await this.modalCtrl.create({
      component: ForgotPasswordModalComponent,
      cssClass: "forgot-password-modal",
      backdropDismiss: true,
    });
    await modal.present();
  }

  async onGoogleLogin(): Promise<void> {
    this.isLoading = true;
    const loading = await this.loadingCtrl.create({
      message: "Signing in with Google...",
      spinner: "crescent",
    });
    await loading.present();

    try {
      // Try native Google Auth first
      let idToken: string | null = null;
      try {
        const { auth } = await import("capacitor-auth-manager");
        const result = await auth.signIn("google");
        if (result && result.user) {
          // Get the ID token from the signed-in user
          idToken = await auth.getIdToken();
        }
      } catch (nativeError) {
        console.log("Native Google Auth not available:", nativeError);
      }

      // If native failed, try web Google Identity Services
      if (!idToken) {
        // For web, we would need to implement Google Identity Services
        // For now, show an alert that Google Sign-In needs to be configured
        await loading.dismiss();
        const alert = await this.alertCtrl.create({
          header: "Google Sign-In",
          message: "Google Sign-In requires configuration in Google Cloud Console. Please use username/password for now, or set up Google OAuth credentials.",
          buttons: ["OK"],
        });
        await alert.present();
        return;
      }

      // Send ID token to backend
      const response: any = await firstValueFrom(
        this.http.post(`${environment.apiUrl}/api_google_login.php`, { id_token: idToken })
      );

      await loading.dismiss();

      if (!response.success) {
        await this.showError(response.message || "Google login failed");
        return;
      }

      // Google accounts have no password to store for biometric re-login.
      await this.navigateToMap();
    } catch (error: any) {
      await loading.dismiss();
      console.error("Google login error:", error);
      const offline =
        !error?.status || error?.status === 0 || error?.message === "Failed to fetch";
      await this.showError(
        offline
          ? "Can't reach the Konek server. Check your internet connection and try again in a moment."
          : (error?.error?.message ?? "Google login failed. Please try again.")
      );
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
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

      if (await this.shouldOfferBiometricEnrollment()) {
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

  private async shouldOfferBiometricEnrollment(): Promise<boolean> {
    return (
      (await this.biometricService.isAvailable()) &&
      !(await this.biometricService.isEnabled())
    );
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
              // Only mark biometrics as enabled once the credentials actually
              // round-trip; otherwise every launch prompts and then fails.
              await this.biometricService.storeCredentials(username, password);
              const saved = await this.biometricService.getCredentials();
              if (saved?.username === username && saved?.password === password) {
                await this.biometricService.enable();
              }
            }
            await this.navigateToMap();
          },
        },
      ],
    });
    await alert.present();
  }

  private async navigateToMap(): Promise<void> {
    // Signing in means the user is no longer brand new, so never show the
    // one-time welcome screen again.
    await this.onboarding.complete();
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







