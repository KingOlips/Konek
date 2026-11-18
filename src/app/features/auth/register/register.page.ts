import { ChangeDetectorRef, Component, inject } from "@angular/core";
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
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
  ModalController,
  NavController,
} from "@ionic/angular";
import { addIcons } from "ionicons";
import {
  alertCircleOutline,
  arrowForwardOutline,
  checkmarkOutline,
  eyeOutline,
  eyeOffOutline,
  locationOutline,
  lockClosedOutline,
  mailOutline,
  peopleOutline,
  personOutline,
  radioOutline,
  shieldCheckmarkOutline,
} from "ionicons/icons";
import { AuthService } from "../../../core/services/auth.service";
import { OnboardingService } from "../../../core/services/onboarding.service";

@Component({
  selector: "app-register",
  templateUrl: "./register.page.html",
  styleUrls: ["./register.page.scss"],
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
export class RegisterPage {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly navCtrl = inject(NavController);
  private readonly authService = inject(AuthService);
  private readonly onboarding = inject(OnboardingService);
  private readonly alertCtrl = inject(AlertController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly modalCtrl = inject(ModalController);
  private readonly cdr = inject(ChangeDetectorRef);

  registerForm: FormGroup;
  isLoading = false;
  showPassword = false;
  showConfirmPassword = false;
  submitted = false;

  constructor() {
    addIcons({
      alertCircleOutline,
      arrowForwardOutline,
      checkmarkOutline,
      eyeOutline,
      eyeOffOutline,
      locationOutline,
      lockClosedOutline,
      mailOutline,
      peopleOutline,
      personOutline,
      radioOutline,
      shieldCheckmarkOutline,
    });

    this.registerForm = this.fb.group(
      {
        username: [
          "",
          [
            Validators.required,
            Validators.minLength(3),
            Validators.pattern(/^[a-zA-Z0-9_]+$/),
          ],
        ],
        email: ["", [Validators.required, Validators.email]],
        password: ["", [Validators.required, Validators.minLength(6)]],
        confirmPassword: ["", [Validators.required]],
        terms: [false, Validators.requiredTrue],
      },
      { validators: RegisterPage.passwordsMatch }
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
    void this.navCtrl.navigateForward("/login", { animated: false });
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

  async onSubmit(): Promise<void> {
    this.submitted = true;

    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;
    const loading = await this.loadingCtrl.create({
      message: "Creating account...",
      spinner: "crescent",
    });
    await loading.present();

    try {
      const { username, email, password } = this.registerForm.value;
      const response = await firstValueFrom(
        this.authService.register({
          username,
          email,
          password,
          terms_accepted: this.registerForm.value.terms === true,
        })
      );
      await loading.dismiss();

      if (!response.success) {
        await this.showError(response.message || "Registration failed. Please try again.");
        return;
      }

      const alert = await this.alertCtrl.create({
        header: "Account Created",
        message: response.email_sent
          ? `Welcome to Konek! A welcome email is on its way to ${email}. You are now signed in.`
          : "Welcome to Konek! You are now signed in. We couldn't send the welcome email right now, but your account is ready.",
        buttons: [
          {
            text: "Continue",
            handler: async () => {
              await this.onboarding.complete();
              await this.router.navigate(["/map"], { replaceUrl: true });
            },
          },
        ],
      });
      await alert.present();
    } catch (error: any) {
      await loading.dismiss();
      console.error("Registration error:", error);
      // Status 0 / "Failed to fetch" means the request never reached the API.
      const offline =
        !error?.status || error?.status === 0 || error?.message === "Failed to fetch";
      await this.showError(
        offline
          ? "Can't reach the Konek server. Check your internet connection and try again in a moment."
          : (error?.error?.message ?? "Registration failed. Please try again.")
      );
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  private async showError(message: string): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: "Registration Error",
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

  get username() {
    return this.registerForm.get("username");
  }

  get password() {
    return this.registerForm.get("password");
  }

  get confirmPassword() {
    return this.registerForm.get("confirmPassword");
  }

  get email() {
    return this.registerForm.get("email");
  }

  get terms() {
    return this.registerForm.get("terms");
  }
}





