import { ChangeDetectorRef, Component, Input, OnInit, inject } from "@angular/core";
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from "@angular/forms";
import { firstValueFrom } from "rxjs";
import {
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
  closeOutline,
  eyeOffOutline,
  eyeOutline,
  lockClosedOutline,
  shieldCheckmarkOutline,
} from "ionicons/icons";
import { AuthService } from "../../../core/services/auth.service";

/**
 * Password popup used from Settings.
 *
 * - `passwordSet = 1`: change flow (current password required).
 * - `passwordSet = 0`: set flow for accounts without a real password yet.
 */
@Component({
  selector: "app-change-password-modal",
  templateUrl: "./change-password.modal.html",
  styleUrls: ["./change-password.modal.scss"],
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
export class ChangePasswordModalComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly modalCtrl = inject(ModalController);
  private readonly cdr = inject(ChangeDetectorRef);

  /** 1 when the account already has a real password, 0 when setting one. */
  @Input() passwordSet = 1;

  passwordForm: FormGroup;
  isLoading = false;
  submitted = false;
  serverError = "";

  showCurrent = false;
  showNew = false;
  showConfirm = false;

  constructor() {
    addIcons({
      alertCircleOutline,
      arrowForwardOutline,
      closeOutline,
      eyeOffOutline,
      eyeOutline,
      lockClosedOutline,
      shieldCheckmarkOutline,
    });

    this.passwordForm = this.fb.group(
      {
        currentPassword: [""],
        newPassword: ["", [Validators.required, Validators.minLength(6)]],
        confirmPassword: ["", [Validators.required]],
      },
      { validators: ChangePasswordModalComponent.passwordsMatch }
    );
  }

  ngOnInit(): void {
    if (this.needsCurrentPassword) {
      this.passwordForm
        .get("currentPassword")
        ?.setValidators([Validators.required, Validators.minLength(6)]);
      this.passwordForm.get("currentPassword")?.updateValueAndValidity();
    }
  }

  /** Setting a password for the first time needs no current password. */
  get needsCurrentPassword(): boolean {
    return this.passwordSet !== 0;
  }

  get title(): string {
    return this.needsCurrentPassword ? "Change password" : "Set a password";
  }

  get subtitle(): string {
    return this.needsCurrentPassword
      ? "Confirm your current password, then choose a new one."
      : "Add a password so you can also sign in without Google.";
  }

  private static passwordsMatch(group: FormGroup): ValidationErrors | null {
    const password = group.get("newPassword")?.value;
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

  get currentPassword() {
    return this.passwordForm.get("currentPassword");
  }

  get newPassword() {
    return this.passwordForm.get("newPassword");
  }

  get confirmPassword() {
    return this.passwordForm.get("confirmPassword");
  }

  toggleCurrent(): void {
    this.showCurrent = !this.showCurrent;
  }

  toggleNew(): void {
    this.showNew = !this.showNew;
  }

  toggleConfirm(): void {
    this.showConfirm = !this.showConfirm;
  }

  async close(): Promise<void> {
    await this.modalCtrl.dismiss(null, "cancel");
  }

  async onSubmit(): Promise<void> {
    this.submitted = true;
    this.serverError = "";

    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }

    const { currentPassword, newPassword, confirmPassword } =
      this.passwordForm.value;

    if (newPassword === confirmPassword && currentPassword === newPassword) {
      this.serverError = "Choose a password different from your current one.";
      return;
    }

    this.isLoading = true;

    try {
      const response = await firstValueFrom(
        this.authService.changePassword(
          this.needsCurrentPassword ? currentPassword : null,
          newPassword
        )
      );

      if (!response.success) {
        this.serverError = response.message || "Failed to update password.";
        return;
      }

      await this.modalCtrl.dismiss({ updated: true }, "confirm");
    } catch (error: any) {
      console.error("Change password error:", error);
      const offline =
        error?.status === 0 || error?.message === "Failed to fetch";
      this.serverError = offline
        ? "Can't reach the Konek server. Check your internet connection and try again."
        : (error?.error?.message ?? "Failed to update password. Please try again.");
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }
}
