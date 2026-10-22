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

  resetForm: FormGroup;
  isLoading = false;
  submitted = false;
  showPassword = false;
  showConfirmPassword = false;
  token = "";

  constructor() {
    addIcons({
      alertCircleOutline,
      arrowForwardOutline,
      eyeOutline,
      eyeOffOutline,
      lockClosedOutline,
      locationOutline,
    });

    this.token = this.route.snapshot.queryParamMap.get("token") || "";

    this.resetForm = this.fb.group(
      {
        password: ["", [Validators.required, Validators.minLength(6)]],
        confirmPassword: ["", [Validators.required]],
      },
      { validators: ResetPasswordPage.passwordsMatch }
    );
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

  async onSubmit(): Promise<void> {
    if (!this.token) {
      await this.showError("Invalid reset link. Please request a new one.");
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
        this.authService.resetPassword(this.token, password)
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

  get password() {
    return this.resetForm.get("password");
  }

  get confirmPassword() {
    return this.resetForm.get("confirmPassword");
  }
}
