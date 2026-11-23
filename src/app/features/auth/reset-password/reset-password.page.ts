import { ChangeDetectorRef, Component, inject } from "@angular/core";
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
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
  lockClosedOutline,
  locationOutline,
  peopleOutline,
  shieldCheckmarkOutline,
} from "ionicons/icons";
import { AuthService } from "../../../core/services/auth.service";

@Component({
  selector: "app-reset-password",
  templateUrl: "./reset-password.page.html",
  styleUrls: ["./reset-password.page.scss"],
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
export class ResetPasswordPage {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly navCtrl = inject(NavController);
  private readonly authService = inject(AuthService);
  private readonly alertCtrl = inject(AlertController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly cdr = inject(ChangeDetectorRef);

  codeForm: FormGroup;
  resetForm: FormGroup;
  step: "verify" | "reset" = "verify";
  isLoading = false;
  isVerifying = false;
  codeSubmitted = false;
  submitted = false;
  showPassword = false;
  showConfirmPassword = false;
  token = "";
  sessionId = "";
  email = "";
  private verifiedToken = "";

  constructor() {
    addIcons({
      alertCircleOutline,
      arrowForwardOutline,
      eyeOutline,
      eyeOffOutline,
      lockClosedOutline,
      locationOutline,
      peopleOutline,
      shieldCheckmarkOutline,
    });

    this.token = this.route.snapshot.queryParamMap.get("token") || "";
    this.sessionId = this.route.snapshot.queryParamMap.get("session_id") || "";
    this.email = this.route.snapshot.queryParamMap.get("email") || "";

    this.codeForm = this.fb.group({
      code: ["", [Validators.required, Validators.pattern(/^\d{6}$/)]],
    });

    this.resetForm = this.fb.group(
      {
        password: ["", [Validators.required, Validators.minLength(6)]],
        confirmPassword: ["", [Validators.required]],
      },
      { validators: ResetPasswordPage.passwordsMatch }
    );

    if (this.token) {
      this.verifiedToken = this.token;
      this.step = "reset";
    }
  }

  private static passwordsMatch(group: FormGroup): ValidationErrors | null {
    const password = group.get("password")?.value;
    const confirm = group.get("confirmPassword");
    if (!confirm) return null;
    if (password !== confirm.value) {
      confirm.setErrors({ ...(confirm.errors ?? {}), mismatch: true });
      return { mismatch: true };
    }
    if (confirm.hasError("mismatch")) {
      const { mismatch, ...rest } = confirm.errors ?? {};
      confirm.setErrors(Object.keys(rest).length ? rest : null);
    }
    return null;
  }

  goToLogin(): void {
    void this.navCtrl.navigateRoot("/login", { animated: false, replaceUrl: true });
  }

  requestNewCode(): void {
    void this.router.navigate(["/forgot-password"], { replaceUrl: true });
  }

  /** Step 1: verify the emailed code, then show the password form. */
  async verifyCode(): Promise<void> {
    this.codeSubmitted = true;

    if (this.codeForm.invalid) {
      this.codeForm.markAllAsTouched();
      return;
    }

    if (!this.sessionId) {
      await this.showError("Invalid reset request. Please request a new code.");
      return;
    }

    this.isVerifying = true;

    try {
      const code = String(this.codeForm.value.code ?? "").trim();
      const verification = await firstValueFrom(
        this.authService.verifyPasswordCode(this.sessionId, code)
      );

      if (!verification.success || !verification.token) {
        await this.showError(
          verification.message || "Incorrect verification code"
        );
        return;
      }

      this.verifiedToken = verification.token;
      this.step = "reset";
      this.submitted = false;
      this.resetForm.reset();
    } catch (error: any) {
      console.error("Verify reset code error:", error);
      const offline =
        !error?.status || error?.status === 0 || error?.message === "Failed to fetch";
      await this.showError(
        offline
          ? "Can't reach the Konek server. Check your internet connection and try again in a moment."
          : (error?.error?.message ?? "Failed to verify the code. Please try again.")
      );
    } finally {
      this.isVerifying = false;
      this.cdr.markForCheck();
    }
  }

  /** Step 2: save the new password with the verified one-time token. */
  async onSubmit(): Promise<void> {
    if (!this.verifiedToken) {
      await this.showError("Invalid reset request. Please request a new code.");
      return;
    }

    this.submitted = true;

    if (this.resetForm.invalid) {
      this.resetForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;
    const loading = await this.loadingCtrl.create({
      message: "Resetting password...",
      spinner: "crescent",
    });
    await loading.present();

    try {
      const { password } = this.resetForm.value;
      const response = await firstValueFrom(
        this.authService.resetPassword(this.verifiedToken, password)
      );
      await loading.dismiss();

      if (!response.success) {
        await this.showError(response.message || "Failed to reset password");
        return;
      }

      const alert = await this.alertCtrl.create({
        header: "Password Reset",
        message: "Your password has been updated. You are now signed in.",
        buttons: [
          {
            text: "Continue",
            handler: () => void this.router.navigate(["/map"], { replaceUrl: true }),
          },
        ],
      });
      await alert.present();
    } catch (error: any) {
      await loading.dismiss();
      console.error("Reset password error:", error);
      const offline =
        !error?.status || error?.status === 0 || error?.message === "Failed to fetch";
      await this.showError(
        offline
          ? "Can't reach the Konek server. Check your internet connection and try again in a moment."
          : (error?.error?.message ?? "Failed to reset password. Please try again.")
      );
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  private async showError(message: string): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: "Error",
      message,
      buttons: ["OK"],
      cssClass: "error-alert",
    });
    await alert.present();
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  get code() {
    return this.codeForm.get("code");
  }

  get password() {
    return this.resetForm.get("password");
  }

  get confirmPassword() {
    return this.resetForm.get("confirmPassword");
  }
}
