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
  NavController,
} from "@ionic/angular";
import { addIcons } from "ionicons";
import {
  alertCircleOutline,
  arrowForwardOutline,
  eyeOutline,
  eyeOffOutline,
  locationOutline,
  lockClosedOutline,
  peopleOutline,
  personOutline,
  radioOutline,
  shieldCheckmarkOutline,
} from "ionicons/icons";
import { AuthService } from "../../../core/services/auth.service";

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
  private readonly alertCtrl = inject(AlertController);
  private readonly loadingCtrl = inject(LoadingController);
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
      eyeOutline,
      eyeOffOutline,
      locationOutline,
      lockClosedOutline,
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
        password: ["", [Validators.required, Validators.minLength(6)]],
        confirmPassword: ["", [Validators.required]],
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
    void this.navCtrl.navigateRoot("/login", { animated: false, replaceUrl: true });
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
      const { username, password } = this.registerForm.value;
      const response = await firstValueFrom(this.authService.register({ username, password }));
      await loading.dismiss();

      if (!response.success) {
        await this.showError(response.message || "Registration failed. Please try again.");
        return;
      }

      const alert = await this.alertCtrl.create({
        header: "Account Created",
        message: "Welcome to Konek! You are now signed in.",
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
      console.error("Registration error:", error);
      await this.showError(
        error?.error?.message ?? "Unable to reach the server. Check that XAMPP is running."
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
}
