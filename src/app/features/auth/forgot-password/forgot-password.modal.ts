import {
  ChangeDetectorRef,
  Component,
  Input,
  OnDestroy,
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
import { firstValueFrom, Subscription, filter } from "rxjs";
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
  checkmarkCircleOutline,
  closeOutline,
  eyeOffOutline,
  eyeOutline,
  lockClosedOutline,
  mailOutline,
  shieldCheckmarkOutline,
} from "ionicons/icons";
import { AuthService } from "../../../core/services/auth.service";
import { PasswordResetLinkService } from "../../../core/services/password-reset-link.service";

/**
 * Forgot-password popup. Presented from the login screen instead of routing to
 * a separate page, so the user never leaves the sign-in form.
 *
 * The popup has three steps:
 *   1. request - enter the email and send the six-digit verification code
 *   2. verify  - enter only the code; a correct code unlocks the password form
 *   3. reset   - choose and confirm the new password
 *
 * `token` remains supported for reset links sent before verification codes.
 * When the popup is already open, AppComponent calls `applyResetToken()` so the
 * live popup switches instead of stacking a second one.
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
export class ForgotPasswordModalComponent implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly resetLink = inject(PasswordResetLinkService);
  private readonly modalCtrl = inject(ModalController);
  private readonly cdr = inject(ChangeDetectorRef);
  private resetTokenSub?: Subscription;

  private _token = "";

  /** Reset token from a legacy email verification link. */
  @Input()
  set token(value: string) {
    this._token = (value ?? "").trim();
    if (this._token !== "") {
      this.stopPolling();
      this.sessionId = "";
      this.verifiedToken = this._token;
      this.step = "reset";
      this.codeVerified = true;
      this.codeSubmitted = false;
      this.resetSubmitted = false;
      this.codeForm.reset();
      this.resetForm.reset();
      this.serverError = "";
    }
    this.cdr.markForCheck();
  }
  get token(): string {
    return this._token;
  }

  step: "request" | "verify" | "reset" = "request";
  forgotForm: FormGroup;
  codeForm: FormGroup;
  resetForm: FormGroup;
  isLoading = false;
  isVerifying = false;
  isResetting = false;
  submitted = false;
  codeSubmitted = false;
  resetSubmitted = false;
  sent = false;
  codeVerified = false;
  email = "";
  serverError = "";
  showPassword = false;
  showConfirmPassword = false;
  /** Session created for the emailed verification code. */
  sessionId = "";
  private verifiedToken = "";
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollFailures = 0;
  private destroyed = false;

  constructor() {
    addIcons({
      alertCircleOutline,
      arrowForwardOutline,
      checkmarkCircleOutline,
      closeOutline,
      eyeOffOutline,
      eyeOutline,
      lockClosedOutline,
      mailOutline,
      shieldCheckmarkOutline,
    });

    this.forgotForm = this.fb.group({
      email: ["", [Validators.required, Validators.email]],
    });

    this.codeForm = this.fb.group({
      code: ["", [Validators.required, Validators.pattern(/^\d{6}$/)]],
    });

    this.resetForm = this.fb.group(
      {
        password: ["", [Validators.required, Validators.minLength(6)]],
        confirmPassword: ["", [Validators.required]],
      },
      { validators: ForgotPasswordModalComponent.passwordsMatch }
    );
  }

  ngOnInit(): void {
    this.resetLink.notifyModalOpen();
    // A verification link can arrive while this popup is already open (the
    // user tapped "Verify" in the email and Android brought Konek forward).
    this.resetTokenSub = this.resetLink.resetToken$
      .pipe(filter((token) => token !== ""))
      .subscribe((token) => this.applyResetToken(token));
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopPolling();
    this.resetTokenSub?.unsubscribe();
    this.resetLink.notifyModalClosed();
  }

  /** Called by AppComponent when a legacy verification link arrives while open. */
  applyResetToken(token: string): void {
    this.token = token;
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

  get emailCtrl() {
    return this.forgotForm.get("email");
  }

  get codeCtrl() {
    return this.codeForm.get("code");
  }

  get passwordCtrl() {
    return this.resetForm.get("password");
  }

  get confirmPasswordCtrl() {
    return this.resetForm.get("confirmPassword");
  }

  get heading(): string {
    if (this.step === "verify") return "Enter verification code";
    if (this.step === "reset") return "Set a new password";
    return this.sent ? "Check your inbox" : "Forgot your password?";
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  async close(): Promise<void> {
    this.stopPolling();
    await this.modalCtrl.dismiss(null, "cancel");
  }

  /** Step 1: send the verification code. */
  async onSubmit(): Promise<void> {
    this.submitted = true;
    this.serverError = "";

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
        this.serverError = response.message || "Failed to send reset code";
        return;
      }

      this.sessionId = response.session_id ?? "";
      this.verifiedToken = "";
      this.codeVerified = false;
      this.codeSubmitted = false;
      this.resetSubmitted = false;
      this.codeForm.reset();
      this.resetForm.reset();

      if (response.verification_method === "code") {
        if (!this.sessionId) {
          this.serverError =
            "The reset code request did not complete. Please try again.";
          return;
        }
        this.sent = true;
        this.step = "verify";
      } else if (this.sessionId) {
        // Legacy servers send a link. Keep polling so a link opened on another
        // device can still complete this request.
        this.sent = true;
        this.startPolling();
      } else {
        this.serverError =
          "The reset request did not complete. Please try again.";
      }
    } catch (error: any) {
      console.error("Forgot password error:", error);
      const offline =
        !error?.status || error?.status === 0 || error?.message === "Failed to fetch";
      this.serverError = offline
        ? "Can't reach the Konek server. Check your internet connection and try again in a moment."
        : (error?.error?.message ?? "Failed to send reset code. Please try again.");
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  /** Step 2: verify the emailed code, then unlock the password form. */
  async verifyCode(): Promise<void> {
    this.codeSubmitted = true;
    this.serverError = "";

    if (this.codeForm.invalid) {
      this.codeForm.markAllAsTouched();
      return;
    }

    if (!this.sessionId) {
      this.serverError = "This reset request is invalid. Request a new code.";
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
      this.codeVerified = true;
      this.step = "reset";
      this.resetSubmitted = false;
      this.resetForm.reset();
    } catch (error: any) {
      console.error("Verify reset code error:", error);
      const offline =
        !error?.status || error?.status === 0 || error?.message === "Failed to fetch";
      this.serverError = offline
        ? "Can't reach the Konek server. Check your internet connection and try again in a moment."
        : (error?.error?.message ?? "Failed to verify the code. Please try again.");
    } finally {
      this.isVerifying = false;
      this.cdr.markForCheck();
    }
  }

  /**
   * Poll legacy reset sessions while the "check your inbox" screen is visible.
   * When a legacy Verify link is tapped, `status` becomes `verified` and the
   * popup switches in place.
   */
  private startPolling(): void {
    this.stopPolling();
    this.pollFailures = 0;

    const tick = async (): Promise<void> => {
      if (this.destroyed || !this.sessionId || this.step !== "request") {
        return;
      }

      try {
        const status = await firstValueFrom(
          this.authService.resetSessionStatus(this.sessionId)
        );

        if (this.destroyed || this.step !== "request") {
          return;
        }

        if (status.status === "verified" && status.token) {
          this.stopPolling();
          this.applyResetToken(status.token);
          this.cdr.markForCheck();
          return;
        }

        if (status.status === "expired") {
          this.stopPolling();
          this.serverError =
            status.message ||
            "This reset request expired. Send a new verification email.";
          this.cdr.markForCheck();
          return;
        }

        this.pollFailures = 0;
        if (this.serverError.startsWith("Can't reach the Konek server")) {
          this.serverError = "";
          this.cdr.markForCheck();
        }
      } catch {
        this.pollFailures += 1;
        if (this.pollFailures === 5) {
          this.serverError =
            "Can't reach the Konek server. Still waiting for verification…";
          this.cdr.markForCheck();
        }
      }

      if (!this.destroyed) {
        this.pollTimer = setTimeout(() => void tick(), 2000);
      }
    };

    // A short delay lets the "check your inbox" state render first.
    this.pollTimer = setTimeout(() => void tick(), 800);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Go back to the email form and stop watching the previous request. */
  sendToDifferentEmail(): void {
    this.stopPolling();
    this.sessionId = "";
    this.verifiedToken = "";
    this.codeVerified = false;
    this.codeSubmitted = false;
    this.pollFailures = 0;
    this.sent = false;
    this.step = "request";
    this.email = "";
    this.serverError = "";
    this.resetSubmitted = false;
    this.codeForm.reset();
    this.resetForm.reset();
    this.cdr.markForCheck();
  }

  /** Step 3: save the new password with the verified one-time token. */
  async submitReset(): Promise<void> {
    this.resetSubmitted = true;
    this.serverError = "";

    if (this.resetForm.invalid) {
      this.resetForm.markAllAsTouched();
      return;
    }

    const resetToken = this.verifiedToken || this.token;
    if (!resetToken) {
      this.serverError =
        "This verification request is invalid. Request a new code.";
      return;
    }

    this.isResetting = true;

    try {
      const { password } = this.resetForm.value;
      const response = await firstValueFrom(
        this.authService.resetPassword(resetToken, password)
      );

      if (!response.success) {
        this.serverError = response.message || "Failed to reset password";
        return;
      }

      await this.modalCtrl.dismiss({ reset: true }, "confirm");
    } catch (error: any) {
      console.error("Reset password error:", error);
      const offline =
        !error?.status || error?.status === 0 || error?.message === "Failed to fetch";
      this.serverError = offline
        ? "Can't reach the Konek server. Check your internet connection and try again in a moment."
        : (error?.error?.message ?? "Failed to reset password. Please try again.");
    } finally {
      this.isResetting = false;
      this.cdr.markForCheck();
    }
  }

  /** Expired code or wrong account: go back to the email form. */
  backToRequest(): void {
    this.stopPolling();
    this.sessionId = "";
    this.verifiedToken = "";
    this.codeVerified = false;
    this.codeSubmitted = false;
    this._token = "";
    this.step = "request";
    this.sent = false;
    this.serverError = "";
    this.resetSubmitted = false;
    this.codeForm.reset();
    this.resetForm.reset();
    this.cdr.markForCheck();
  }
}
