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
  checkmarkOutline,
  eyeOffOutline,
  eyeOutline,
  mailOutline,
  personOutline,
  shieldCheckmarkOutline,
} from "ionicons/icons";
import { AuthService } from "../../../core/services/auth.service";

/**
 * Mandatory first-run form for Google sign-ups. The Konek account is not
 * created until the user picks their own username and a password, so every
 * account can sign in with either Google or email + password.
 *
 * The modal cannot be dismissed by the user: it is presented with
 * `backdropDismiss: false` and `canDismiss: false`.
 */
@Component({
  selector: "app-complete-profile-modal",
  templateUrl: "./complete-profile.modal.html",
  styleUrls: ["./complete-profile.modal.scss"],
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
export class CompleteProfileModalComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly modalCtrl = inject(ModalController);
  private readonly cdr = inject(ChangeDetectorRef);

  /** Signed token from api_google_login.php (proves the verified Google user). */
  @Input() tempToken = "";
  /** Google email shown read-only so the user knows which account this is. */
  @Input() email = "";
  /** Starting point for the username field; the user may change it. */
  @Input() suggestedUsername = "";

  profileForm: FormGroup;
  isLoading = false;
  submitted = false;
  showPassword = false;
  showConfirmPassword = false;
  serverError = "";

  constructor() {
    addIcons({
      alertCircleOutline,
      arrowForwardOutline,
      checkmarkOutline,
      eyeOffOutline,
      eyeOutline,
      mailOutline,
      personOutline,
      shieldCheckmarkOutline,
    });

    this.profileForm = this.fb.group(
      {
        username: [
          "",
          [
            Validators.required,
            Validators.minLength(3),
            Validators.maxLength(50),
            Validators.pattern(/^[a-zA-Z0-9_]+$/),
          ],
        ],
        password: ["", [Validators.required, Validators.minLength(6)]],
        confirmPassword: ["", [Validators.required]],
        terms: [false, Validators.requiredTrue],
      },
      { validators: CompleteProfileModalComponent.passwordsMatch }
    );
  }

  ngOnInit(): void {
    this.profileForm.patchValue({
      username: this.sanitizeSuggested(this.suggestedUsername),
    });
  }

  /** Keep the suggestion within the username rules. */
  private sanitizeSuggested(value: string): string {
    const cleaned = (value ?? "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 50);
    return cleaned.length >= 3 ? cleaned : "";
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

  get username() {
    return this.profileForm.get("username");
  }

  get password() {
    return this.profileForm.get("password");
  }

  get confirmPassword() {
    return this.profileForm.get("confirmPassword");
  }

  get terms() {
    return this.profileForm.get("terms");
  }

  /** Open the Terms of Service / Privacy Policy sheet. */
  async openLegal(section: "terms" | "privacy"): Promise<void> {
    const { LegalModalComponent } = await import(
      "../../legal/legal.modal"
    );
    const modal = await this.modalCtrl.create({
      component: LegalModalComponent,
      componentProps: { section },
      cssClass: "legal-modal",
      backdropDismiss: true,
    });
    await modal.present();
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  async onSubmit(): Promise<void> {
    this.submitted = true;
    this.serverError = "";

    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;

    try {
      const { username, password } = this.profileForm.value;
      const response = await firstValueFrom(
        this.authService.completeGoogleProfile(
          this.tempToken,
          username,
          password,
          this.profileForm.value.terms === true
        )
      );

      if (!response.success || !response.data) {
        this.serverError =
          response.message || "Could not create your account. Please try again.";
        return;
      }

      await this.modalCtrl.dismiss({ completed: true }, "confirm");
    } catch (error: any) {
      console.error("Complete Google profile error:", error);
      const offline =
        error?.status === 0 || error?.message === "Failed to fetch";
      this.serverError = offline
        ? "Can't reach the Konek server. Check your internet connection and try again."
        : (error?.error?.message ??
          "Could not create your account. Please try again.");
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }
}
