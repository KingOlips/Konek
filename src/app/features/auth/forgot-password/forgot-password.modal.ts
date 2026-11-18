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
 * The same popup handles both halves of the flow:
 *   1. request  - enter the email and send the verification message
 *   2. reset    - after the "Verify" link in the email opens the app, the
 *                 popup switches to the new-password form (no navigation)
 *
 * `token` is supplied by AppComponent when the app is opened from the email.
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

  /** Reset token from the email verification link. */
  @Input()
  set token(value: string) {
    this._token = (value ?? "").trim();
    if (this._token !== "") {
      this.step = "reset";
      this.serverError = "";
    }
    this.cdr.markForCheck();
  }
  get token(): string {
    return this._token;
  }

  step: "request" | "reset" = "request";
  forgotForm: FormGroup;
  resetForm: FormGroup;
  isLoading = false;
  isResetting = false;
  submitted = false;
  resetSubmitted = false;
  sent = false;
  email = "";
  serverError = "";
  showPassword = false;
  showConfirmPassword = false;
  /** Session watched while waiting for the email link to be verified. */
  sessionId = "";
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

  /** Called by AppComponent when a verification link arrives while open. */
  applyResetToken(token: string): void {
    this.stopPolling();
    this.token = token;
    this.step = "reset";
    this.resetSubmitted = false;
    this.resetForm.reset();
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

  get passwordCtrl() {
    return this.resetForm.get("password");
  }

  get confirmPasswordCtrl() {
    return this.resetForm.get("confirmPassword");
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

  /** Step 1: send the verification email. */
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
        this.serverError = response.message || "Failed to send reset link";
        return;
      }

      this.sent = true;

      // Watch this request so the popup can switch by itself when the link is
      // opened in the mailbox — including on a phone while this screen stays on
      // the desktop.
      this.sessionId = response.session_id ?? "";
      if (this.sessionId) {
        this.startPolling();
      }
    } catch (error: any) {
      console.error("Forgot password error:", error);
      const offline =
        !error?.status || error?.status === 0 || error?.message === "Failed to fetch";
      this.serverError = offline
        ? "Can't reach the Konek server. Check your internet connection and try again in a moment."
        : (error?.error?.message ?? "Failed to send reset link. Please try again.");
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  /**
   * Poll the pending reset session while the "check your inbox" screen is
   * visible. The email may be opened on another device; when its Verify link
   * is tapped, `status` becomes `verified` and the popup switches in place.
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
    this.pollFailures = 0;
    this.sent = false;
    this.email = "";
    this.serverError = "";
    this.cdr.markForCheck();
  }

  /** Step 2: the email was verified, so save the new password. */
  async submitReset(): Promise<void> {
    this.resetSubmitted = true;
    this.serverError = "";

    if (this.resetForm.invalid) {
      this.resetForm.markAllAsTouched();
      return;
    }

    if (!this.token) {
      this.serverError =
        "This verification link is invalid. Request a new email below.";
      return;
    }

    this.isResetting = true;

    try {
      const { password } = this.resetForm.value;
      const response = await firstValueFrom(
        this.authService.resetPassword(this.token, password)
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

  /** Expired link or wrong account: go back to the email form. */
  backToRequest(): void {
    this.stopPolling();
    this.sessionId = "";
    this._token = "";
    this.step = "request";
    this.sent = false;
    this.serverError = "";
    this.resetSubmitted = false;
    this.resetForm.reset();
    this.cdr.markForCheck();
  }
}
