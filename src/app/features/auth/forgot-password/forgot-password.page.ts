import { ChangeDetectorRef, Component, inject } from "@angular/core";
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
  mailOutline,
  locationOutline,
} from "ionicons/icons";
import { AuthService } from "../../../core/services/auth.service";

@Component({
  selector: "app-forgot-password",
  templateUrl: "./forgot-password.page.html",
  styleUrls: ["./forgot-password.page.scss"],
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
export class ForgotPasswordPage {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly navCtrl = inject(NavController);
  private readonly authService = inject(AuthService);
  private readonly alertCtrl = inject(AlertController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly cdr = inject(ChangeDetectorRef);

  forgotForm: FormGroup;
  isLoading = false;
  submitted = false;
  email = "";

  constructor() {
    addIcons({
      alertCircleOutline,
      arrowForwardOutline,
      mailOutline,
      locationOutline,
    });

    this.forgotForm = this.fb.group({
      email: ["", [Validators.required, Validators.email]],
    });
  }

  goToLogin(): void {
    void this.navCtrl.navigateRoot("/login", { animated: false, replaceUrl: true });
  }

  async onSubmit(): Promise<void> {
    this.submitted = true;

    if (this.forgotForm.invalid) {
      this.forgotForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;
    this.email = this.forgotForm.value.email;
    const loading = await this.loadingCtrl.create({
      message: "Sending reset link...",
      spinner: "crescent",
    });
    await loading.present();

    try {
      const response = await firstValueFrom(
        this.authService.forgotPassword(this.email)
      );
      await loading.dismiss();

      if (!response.success) {
        await this.showError(response.message || "Failed to send reset link");
        return;
      }

      // Show success state with email
      this.cdr.markForCheck();
    } catch (error: any) {
      await loading.dismiss();
      console.error("Forgot password error:", error);
      const offline =
        !error?.status || error?.status === 0 || error?.message === "Failed to fetch";
      await this.showError(
        offline
          ? "Can't reach the Konek server. Check your internet connection and try again in a moment."
          : (error?.error?.message ?? "Failed to send reset link. Please try again.")
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

  get emailCtrl() {
    return this.forgotForm.get("email");
  }
}
