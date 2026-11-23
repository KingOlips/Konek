import {
  ChangeDetectorRef,
  Component,
  Input,
  OnInit,
  inject,
} from "@angular/core";
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
  mailOutline,
  shieldCheckmarkOutline,
} from "ionicons/icons";
import { AuthService } from "../../../core/services/auth.service";

/**
 * Password popup used from Settings.
 *
 * The email verification code is always shown first. A correct code unlocks
 * the password form.
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

  step: "confirm" | "verify" | "password" = "confirm";
  codeForm: FormGroup;
  passwordForm: FormGroup;
  isLoading = false;
  isSendingCode = false;
  isVerifying = false;
  codeSubmitted = false;
  submitted = false;
  codeSent = false;
  serverError = "";

  showCurrent = false;
  showNew = false;
  showConfirm = false;

  sessionId = "";
  private verifiedToken = "";

  constructor() {
    addIcons({
      alertCircleOutline,
      arrowForwardOutline,
      closeOutline,
      eyeOffOutline,
      eyeOutline,
      lockClosedOutline,
      mailOutline,
      shieldCheckmarkOutline,
    });

    this.codeForm = this.fb.group({
      code: ["", [Validators.required, Validators.pattern(/^\d{6}$/)]],
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

    // The first step asks the user to confirm the change. No code is sent
    // until they agree.
  }

  /** Setting a password for the first time needs no current password. */
  get needsCurrentPassword(): boolean {
    return this.passwordSet !== 0;
  }

  get email(): string {
    return this.authService.getCurrentUser()?.email || "your email";
  }

  get title(): string {
    if (this.step === "confirm") return "Change password?";
    if (this.step === "verify") return "Verify it's you";
    return this.needsCurrentPassword ? "Change password" : "Set a password";
  }

  get subtitle(): string {
    if (this.step === "confirm") {
      return "Confirm you want to change your password before a code is sent.";
    }
    if (this.step === "verify") {
      return `Enter the 6-digit code sent to ${this.email}.`;
    }
    return this.needsCurrentPassword
      ? "Email verified. Confirm your current password, then choose a new one."
      : "Email verified. Add a password so you can also sign in without Google.";
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

  get code() {
    return this.codeForm.get("code");
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

  /** User backed out before any code was sent. */
  async cancelChange(): Promise<void> {
    await this.modalCtrl.dismiss(null, "cancel");
  }

  /** Send a fresh code to the signed-in user's email. */
  async sendCode(): Promise<void> {
    if (this.isSendingCode) return;

    this.serverError = "";
    this.codeSubmitted = false;
    this.isSendingCode = true;
    // Move to the code step right away so the user sees progress and can
    // type the code as soon as it lands.
    this.step = "verify";
    // Clear the field only when a new code is requested, never when the
    // request finishes. The user may type the code while it is still sending.
    this.codeForm.reset();

    try {
      const response = await firstValueFrom(
        this.authService.requestPasswordChangeCode()
      );

      if (!response.success || !response.session_id) {
        this.serverError =
          response.message || "Failed to send the verification code.";
        return;
      }

      this.sessionId = response.session_id;
      this.verifiedToken = "";
      this.codeSent = true;
    } catch (error: any) {
      console.error("Password change code error:", error);
      const offline =
        !error?.status || error?.status === 0 || error?.message === "Failed to fetch";
      this.serverError = offline
        ? "Can't reach the Konek server. Check your internet connection and try again."
        : (error?.error?.message ??
          "Failed to send the verification code. Please try again.");
    } finally {
      this.isSendingCode = false;
      this.cdr.markForCheck();
    }
  }

  /** Verify the emailed code, then show the password form. */
  async verifyCode(): Promise<void> {
    this.codeSubmitted = true;
    this.serverError = "";

    if (this.codeForm.invalid) {
      this.codeForm.markAllAsTouched();
      return;
    }

    if (this.isSendingCode) {
      this.serverError =
        "The code is still being sent. Wait a moment, then tap Verify code.";
      return;
    }

    if (!this.sessionId) {
      this.serverError = "Request a new verification code.";
      return;
    }

    this.isVerifying = true;

    try {
      const code = String(this.codeForm.value.code ?? "").trim();
      const verification = await firstValueFrom(
        this.authService.verifyPasswordCode(this.sessionId, code)
      );

      if (!verification.success || !verification.token) {
        this.serverError =
          verification.message || "Incorrect verification code";
        return;
      }

      this.verifiedToken = verification.token;
      this.step = "password";
      this.submitted = false;
      this.passwordForm.reset();
    } catch (error: any) {
      console.error("Verify password change code error:", error);
      const offline =
        !error?.status || error?.status === 0 || error?.message === "Failed to fetch";
      this.serverError = offline
        ? "Can't reach the Konek server. Check your internet connection and try again."
        : (error?.error?.message ??
          "Failed to verify the code. Please try again.");
    } finally {
      this.isVerifying = false;
      this.cdr.markForCheck();
    }
  }

  /** Request a new code and return to the verification step. */
  restartVerification(): void {
    this.verifiedToken = "";
    this.step = "verify";
    this.passwordForm.reset();
    void this.sendCode();
  }

  async onSubmit(): Promise<void> {
    this.submitted = true;
    this.serverError = "";

    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }

    if (!this.verifiedToken) {
      this.serverError =
        "Verify the code sent to your email before changing your password.";
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
          newPassword,
          this.verifiedToken
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
