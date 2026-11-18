import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  ViewChild,
} from "@angular/core";
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";
import { firstValueFrom } from "rxjs";
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ModalController,
  ToastController,
} from "@ionic/angular";
import { addIcons } from "ionicons";
import {
  alertCircleOutline,
  callOutline,
  cameraOutline,
  checkmarkOutline,
  mailOutline,
  personOutline,
  saveOutline,
} from "ionicons/icons";
import { AuthService, User } from "../../core/services/auth.service";

const MAX_PICTURE_BYTES = 5 * 1024 * 1024;
const ALLOWED_PICTURE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_PICTURE_EXTENSIONS = /\.(jpe?g|png|webp)$/i;

@Component({
  selector: "app-profile",
  templateUrl: "./profile.page.html",
  styleUrls: ["./profile.page.scss"],
  standalone: true,
  imports: [
    ReactiveFormsModule,
    IonBackButton,
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonIcon,
    IonInput,
    IonSpinner,
    IonTitle,
    IonToolbar,
  ],
})
export class ProfilePage implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly toastCtrl = inject(ToastController);
  private readonly modalCtrl = inject(ModalController);
  private readonly cdr = inject(ChangeDetectorRef);

  @ViewChild("pictureInput") pictureInput?: ElementRef<HTMLInputElement>;

  readonly profileForm: FormGroup;
  currentUser: User | null = null;
  submitted = false;
  isSaving = false;
  isUploadingPicture = false;

  /** Cropped file ready for upload (set after crop modal confirms). */
  pendingPicture: File | null = null;
  /** Local (object URL) preview of the pending picture. */
  previewUrl: string | null = null;

  constructor() {
    addIcons({
      alertCircleOutline,
      callOutline,
      cameraOutline,
      checkmarkOutline,
      mailOutline,
      personOutline,
      saveOutline,
    });

    this.profileForm = this.fb.group({
      username: [
        "",
        [
          Validators.required,
          Validators.minLength(3),
          Validators.maxLength(50),
          Validators.pattern(/^[a-zA-Z0-9_]+$/),
        ],
      ],
      email: ["", [Validators.email]],
      contact_number: ["", [Validators.pattern(/^\+?[0-9][0-9\s\-()]{6,19}$/)]],
    });
  }

  async ngOnInit(): Promise<void> {
    this.currentUser = this.authService.getCurrentUser();
    this.fillForm(this.currentUser);
    this.cdr.markForCheck();

    try {
      const response = await firstValueFrom(this.authService.getProfile());
      if (response.success) {
        this.currentUser = this.authService.getCurrentUser();
        if (!this.profileForm.dirty) {
          this.fillForm(this.currentUser);
        }
      }
    } catch (error) {
      console.warn("Profile refresh failed, using cached session:", error);
    } finally {
      this.cdr.markForCheck();
    }
  }

  ngOnDestroy(): void {
    this.revokePreview();
  }

  get initials(): string {
    const name = (this.currentUser?.username ?? "").trim();
    if (!name) return "?";
    const parts = name.split(/[\s._-]+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
  }

  get avatarImageUrl(): string | null {
    return this.previewUrl ?? this.authService.pictureUrl(this.currentUser?.profile_picture);
  }

  get username() {
    return this.profileForm.get("username");
  }

  get email() {
    return this.profileForm.get("email");
  }

  get contactNumber() {
    return this.profileForm.get("contact_number");
  }

  openPicturePicker(): void {
    this.pictureInput?.nativeElement.click();
  }

  onPictureSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file) return;

    const error = ProfilePage.validatePicture(file);
    if (error) {
      void this.showToast(error);
      return;
    }

    this.openCropModal(file);
  }

  private async openCropModal(file: File): Promise<void> {
    const { PictureCropModalComponent } = await import("./picture-crop.modal");
    const modal = await this.modalCtrl.create({
      component: PictureCropModalComponent,
      componentProps: {
        sourceFile: file,
        aspectRatio: 1,
        outputFormat: "jpeg",
        outputQuality: 0.9,
        maxDimension: 1024,
      },
      cssClass: "picture-crop-modal",
      backdropDismiss: false,
    });

    await modal.present();
    const { data, role } = await modal.onWillDismiss<{ file: File }>();

    if (role === "confirm" && data?.file) {
      this.revokePreview();
      this.pendingPicture = data.file;
      this.previewUrl = URL.createObjectURL(data.file);
      this.cdr.markForCheck();
    }
  }

  async savePicture(): Promise<void> {
    if (!this.pendingPicture || this.isUploadingPicture) return;

    this.isUploadingPicture = true;
    this.cdr.markForCheck();

    try {
      const response = await firstValueFrom(
        this.authService.uploadProfilePicture(this.pendingPicture)
      );
      if (!response.success) {
        await this.showToast(response.message || "Failed to upload picture");
        return;
      }
      this.clearPendingPicture();
      this.currentUser = this.authService.getCurrentUser();
      await this.showToast("Profile picture updated");
    } catch (error: any) {
      await this.showToast(error?.error?.message ?? "Failed to upload picture");
    } finally {
      this.isUploadingPicture = false;
      this.cdr.markForCheck();
    }
  }

  cancelPicture(): void {
    this.clearPendingPicture();
    this.cdr.markForCheck();
  }

  async saveProfile(): Promise<void> {
    this.submitted = true;
    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      this.cdr.markForCheck();
      return;
    }

    this.isSaving = true;
    this.cdr.markForCheck();

    const value = this.profileForm.value;
    try {
      const response = await firstValueFrom(
        this.authService.updateProfile({
          username: String(value.username ?? "").trim(),
          email: String(value.email ?? "").trim() || null,
          contact_number: String(value.contact_number ?? "").trim() || null,
        })
      );

      if (!response.success) {
        await this.showToast(response.message || "Failed to update profile");
        return;
      }

      this.currentUser = this.authService.getCurrentUser();
      this.profileForm.markAsPristine();
      this.submitted = false;
      await this.showToast("Profile updated successfully");
    } catch (error: any) {
      await this.showToast(error?.error?.message ?? "Failed to update profile");
    } finally {
      this.isSaving = false;
      this.cdr.markForCheck();
    }
  }

  private static validatePicture(file: File): string | null {
    const type = (file.type || "").toLowerCase();
    const extensionOk = ALLOWED_PICTURE_EXTENSIONS.test(file.name);
    const typeOk = type === "" ? extensionOk : ALLOWED_PICTURE_TYPES.includes(type);

    if (!typeOk) {
      return "Only JPG, JPEG, PNG, or WEBP images are allowed";
    }
    if (file.size > MAX_PICTURE_BYTES) {
      return "Picture is too large. Maximum size is 5 MB";
    }
    return null;
  }

  private fillForm(user: User | null): void {
    this.profileForm.patchValue({
      username: user?.username ?? "",
      email: user?.email ?? "",
      contact_number: user?.contact_number ?? "",
    });
  }

  private clearPendingPicture(): void {
    this.revokePreview();
    this.pendingPicture = null;
    this.previewUrl = null;
  }

  private revokePreview(): void {
    if (this.previewUrl) {
      URL.revokeObjectURL(this.previewUrl);
      this.previewUrl = null;
    }
  }

  private async showToast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2200,
      position: "bottom",
      cssClass: "custom-toast",
    });
    await toast.present();
  }
}

