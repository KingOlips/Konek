import { ChangeDetectorRef, Component, inject } from "@angular/core";
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";
import { firstValueFrom } from "rxjs";
import {
  AlertController,
  IonButton,
  IonContent,
  IonIcon,
  IonInput,
  IonSpinner,
  ModalController,
} from "@ionic/angular";
import { addIcons } from "ionicons";
import {
  alertCircleOutline,
  arrowForwardOutline,
  checkmarkCircleOutline,
  closeOutline,
  mailOutline,
} from "ionicons/icons";
import { AuthService } from "../../../core/services/auth.service";

/**
 * Forgot-password popup. Presented from the login screen instead of routing to
 * a separate page, so the user never leaves the sign-in form.
 */
@Component({
  selector: "app-forgot-password-modal",
  templateUrl: "./forgot-password.modal.html",
  styleUrls: ["./forgot-password.modal.scss"],
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
export class ForgotPasswordModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly alertCtrl = inject(AlertController);
  private readonly modalCtrl = inject(ModalController);
  private readonly cdr = inject(ChangeDetectorRef);

  forgotForm: FormGroup;
  isLoading = false;
  submitted = false;
  sent = false;
  email = "";

  constructor() {
    addIcons({
      alertCircleOutline,
      arrowForwardOutline,
      checkmarkCircleOutline,
      closeOutline,
      mailOutline,
    });

    this.forgotForm = this.fb.group({
      email: ["", [Validators.required, Validators.email]],
    });
  }

  get emailCtrl() {
    return this.forgotForm.get("email");
  }

  async close(): Promise<void> {
    await this.modalCtrl.dismiss(null, "cancel");
  }

  async onSubmit(): Promise<void> {
    this.submitted = true;

    if (this.forgotForm.invalid) {
      this.forgotForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;
    this.email = this.forgotForm.value.email;

    try {
      const response = await firstValueFrom(
        this.authService.forgotPassword(this.email)
      );

      if (!response.success) {
        await this.showError(response.message || "Failed to send reset link");
        return;
      }

      this.sent = true;
    } catch (error: any) {
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
}
