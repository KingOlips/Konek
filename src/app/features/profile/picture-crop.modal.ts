import {
  ChangeDetectorRef,
  Component,
  Input,
  OnInit,
  ViewChild,
  inject,
} from "@angular/core";
import {
  IonButton,
  IonButtons,
  IonContent,
  IonIcon,
  IonRange,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ModalController,
  ToastController,
} from "@ionic/angular";
import { addIcons } from "ionicons";
import {
  arrowBackOutline,
  checkmarkOutline,
  closeOutline,
  expandOutline,
  contractOutline,
  refreshOutline,
  squareOutline,
} from "ionicons/icons";
import {
  ImageCropperComponent,
  ImageTransform,
  LoadedImage,
  OutputFormat,
} from "ngx-image-cropper";

@Component({
  selector: "app-picture-crop-modal",
  templateUrl: "./picture-crop.modal.html",
  styleUrls: ["./picture-crop.modal.scss"],
  standalone: true,
  imports: [
    IonContent,
    IonButton,
    IonButtons,
    IonIcon,
    IonTitle,
    IonToolbar,
    IonRange,
    IonSpinner,
    ImageCropperComponent,
  ],
})
export class PictureCropModalComponent implements OnInit {
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  readonly cdr = inject(ChangeDetectorRef);

  @Input() sourceFile!: File;
  @Input() aspectRatio = 1;
  @Input() outputFormat: OutputFormat = "jpeg";
  @Input() outputQuality = 0.9;
  @Input() maxDimension = 1024;

  /**
   * Quality for the cropper's own JPEG encode. This is on a 0–100 scale
   * (the library default is 92), NOT 0–1.
   */
  readonly cropperQuality = 92;

  @ViewChild(ImageCropperComponent) private cropper?: ImageCropperComponent;

  isProcessing = false;
  imageLoaded = false;
  rotation = 0;
  scale = 1;

  /**
   * Kept as a stable object and only replaced when zoom actually changes,
   * so the cropper does not re-render on every change-detection cycle.
   */
  transform: ImageTransform = { scale: 1 };

  constructor() {
    addIcons({
      arrowBackOutline,
      checkmarkOutline,
      closeOutline,
      expandOutline,
      contractOutline,
      refreshOutline,
      squareOutline,
    });
  }

  ngOnInit(): void {
    if (!this.sourceFile) {
      this.dismissWithError("No image provided");
    }
  }

  onImageLoaded(event: LoadedImage): void {
    this.imageLoaded = true;
    this.cdr.markForCheck();
  }

  onLoadFailed(): void {
    this.dismissWithError("Failed to load image");
  }

  rotateLeft(): void {
    this.rotation = (this.rotation - 90) % 360;
    this.cdr.markForCheck();
  }

  rotateRight(): void {
    this.rotation = (this.rotation + 90) % 360;
    this.cdr.markForCheck();
  }

  resetCrop(): void {
    const wasRotated = this.rotation !== 0;
    this.rotation = 0;
    this.applyZoom(1);
    // When the image was rotated the cropper recalculates the box itself once
    // the un-rotated bitmap loads; otherwise reset the box immediately.
    if (!wasRotated) {
      this.cropper?.resetCropperPosition();
    }
    this.cdr.markForCheck();
  }

  zoomIn(): void {
    this.applyZoom(Math.min(this.scale + 0.1, 3));
  }

  zoomOut(): void {
    this.applyZoom(Math.max(this.scale - 0.1, 1));
  }

  /** Slider release: update zoom without re-rendering on every pointer move. */
  onZoomChange(event: CustomEvent): void {
    this.applyZoom(Number(event.detail?.value ?? 1));
  }

  private applyZoom(value: number): void {
    this.scale = Math.round(value * 10) / 10;
    this.transform = { scale: this.scale };
    this.cdr.markForCheck();
  }

  async confirm(): Promise<void> {
    if (!this.imageLoaded || this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    this.cdr.markForCheck();

    try {
      // Always export from the cropper at confirm time so the saved image
      // reflects exactly the crop box / rotation / zoom currently on screen.
      const cropped = await this.cropper?.crop("blob");
      if (!cropped?.blob) {
        await this.showToast("Please adjust the crop first");
        return;
      }

      const finalBlob = await this.resizeIfNeeded(cropped.blob);
      const extension = this.outputFormat === "jpeg" ? "jpg" : this.outputFormat;
      const file = new File(
        [finalBlob],
        `profile-${Date.now()}.${extension}`,
        { type: finalBlob.type || "image/jpeg" }
      );
      this.modalCtrl.dismiss({ file }, "confirm");
    } catch (error) {
      console.error("Crop processing error:", error);
      await this.showToast("Failed to process image");
    } finally {
      this.isProcessing = false;
      this.cdr.markForCheck();
    }
  }

  cancel(): void {
    this.modalCtrl.dismiss(null, "cancel");
  }

  /** Downscale the cropped blob if it exceeds maxDimension. */
  private resizeIfNeeded(blob: Blob): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(blob);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        let { width, height } = img;
        const max = this.maxDimension;

        if (width <= max && height <= max) {
          resolve(blob);
          return;
        }

        if (width > height) {
          height = Math.round((height * max) / width);
          width = max;
        } else {
          width = Math.round((width * max) / height);
          height = max;
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(blob);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (resized) => (resized ? resolve(resized) : resolve(blob)),
          "image/" + this.outputFormat,
          this.outputQuality
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Failed to load image for resize"));
      };
      img.src = objectUrl;
    });
  }

  private async showToast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      position: "bottom",
      cssClass: "custom-toast",
    });
    await toast.present();
  }

  private dismissWithError(message: string): void {
    this.showToast(message).then(() => this.modalCtrl.dismiss(null, "cancel"));
  }
}

