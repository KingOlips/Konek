import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
} from "@angular/core";
import {
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonRange,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ModalController,
  ToastController,
} from "@ionic/angular";
import type { RangeChangeEventDetail } from "@ionic/angular";
import { addIcons } from "ionicons";
import {
  addOutline,
  alertCircleOutline,
  arrowRedoOutline,
  arrowUndoOutline,
  closeOutline,
  ellipseOutline,
  imagesOutline,
  refreshOutline,
  removeOutline,
  squareOutline,
} from "ionicons/icons";
import {
  CropperPosition,
  ImageCropperComponent,
  ImageTransform,
  OutputFormat,
} from "ngx-image-cropper";

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const ALLOWED_SOURCE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_SOURCE_EXTENSIONS = /\.(jpe?g|png|webp)$/i;

/** Zoom bounds. 1 = the photo fills the crop box exactly. */
const MIN_SCALE = 1;
const MAX_SCALE = 3;
const ZOOM_STEP = 0.15;

/** How long the "drag / pinch" coach mark stays on screen. */
const HINT_DURATION_MS = 4200;

/**
 * Full photo editor shown after picking a profile picture.
 *
 * The cropper always exports a square, so the image works with the circular
 * avatars across the app; the guide toggle only changes what the editor shows
 * while cropping (circle = exactly what the app will display).
 */
@Component({
  selector: "app-picture-crop-modal",
  templateUrl: "./picture-crop.modal.html",
  styleUrls: ["./picture-crop.modal.scss"],
  standalone: true,
  imports: [
    IonContent,
    IonHeader,
    IonFooter,
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
export class PictureCropModalComponent implements OnInit, OnDestroy {
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly cdr = inject(ChangeDetectorRef);

  @Input() sourceFile!: File;
  @Input() aspectRatio = 1;
  @Input() outputFormat: OutputFormat = "jpeg";
  @Input() outputQuality = 0.9;
  @Input() maxDimension = 1024;

  /**
   * Lets the host page know when there are unsaved adjustments so it can ask
   * before the modal is closed by a backdrop tap, hardware back, or Escape.
   */
  @Input() onDirtyChange: ((dirty: boolean) => void) | null = null;

  @ViewChild(ImageCropperComponent) private cropper?: ImageCropperComponent;
  @ViewChild("replaceInput") private replaceInput?: ElementRef<HTMLInputElement>;

  /**
   * Quality for the cropper's own JPEG encode. This is on a 0–100 scale
   * (the library default is 92), NOT 0–1.
   */
  readonly cropperQuality = 92;
  readonly minScale = MIN_SCALE;
  readonly maxScale = MAX_SCALE;

  isProcessing = false;
  imageLoaded = false;
  loadError = false;
  hintVisible = false;

  /** Natural width / height of the current source file (before rotation). */
  sourceAspect = 1;
  /** False until the source dimensions are known; keeps the cropper unmounted. */
  frameReady = false;

  /** Circular guide matches how avatars are rendered everywhere else. */
  circleGuide = true;

  /**
   * Quarter turns, not degrees: ngx-image-cropper treats `canvasRotation`
   * as "1 = 90deg, 2 = 180deg". Passing degrees rotates the image to the
   * wrong angle and never transposes its dimensions.
   */
  rotation = 0;
  scale = 1;

  /**
   * Kept as a stable object and only replaced when zoom actually changes,
   * so the cropper does not re-render on every change-detection cycle.
   */
  transform: ImageTransform = { scale: 1 };

  /** Crop box of the freshly loaded photo; anything else means "moved". */
  private initialCropper: CropperPosition | null = null;
  private moved = false;
  private lastReportedDirty = false;

  private hintTimer?: ReturnType<typeof setTimeout>;
  private hintShown = false;
  private zoomFrame = 0;
  private pendingZoom: number | null = null;

  constructor() {
    addIcons({
      addOutline,
      alertCircleOutline,
      arrowRedoOutline,
      arrowUndoOutline,
      closeOutline,
      ellipseOutline,
      imagesOutline,
      refreshOutline,
      removeOutline,
      squareOutline,
    });
  }

  ngOnInit(): void {
    if (!this.sourceFile) {
      void this.showToast("No image was selected");
      void this.modalCtrl.dismiss(null, "cancel");
      return;
    }
    void this.prepareSource(this.sourceFile);
  }

  ngOnDestroy(): void {
    this.clearHintTimer();
    if (this.zoomFrame) {
      cancelAnimationFrame(this.zoomFrame);
      this.zoomFrame = 0;
    }
  }

  /** Zoom shown as a human-readable percentage. */
  get zoomPercent(): number {
    return Math.round(this.scale * 100);
  }

  /** Aspect ratio the cropping frame should have, accounting for rotation. */
  get frameAspect(): number {
    const aspect = this.sourceAspect > 0 ? this.sourceAspect : 1;
    return this.rotation % 2 === 0 ? aspect : 1 / aspect;
  }

  /** True when the user changed rotation, zoom, or the crop box. */
  get hasEdits(): boolean {
    return (
      this.rotation !== 0 ||
      Math.abs(this.scale - MIN_SCALE) > 0.001 ||
      this.moved
    );
  }

  get canReset(): boolean {
    return this.imageLoaded && !this.isProcessing && this.hasEdits;
  }

  // ---------------------------------------------------------------------------
  // Cropper lifecycle
  // ---------------------------------------------------------------------------

  onImageLoaded(): void {
    this.imageLoaded = true;
    this.loadError = false;
    this.initialCropper = null;
    this.moved = false;

    // Rotating reloads the bitmap, so only coach the user once per session.
    if (!this.hintShown) {
      this.hintShown = true;
      this.scheduleHint();
    }

    this.reportDirty();
    this.cdr.markForCheck();
  }

  onLoadFailed(): void {
    this.imageLoaded = false;
    this.loadError = true;
    this.hideHint();
    this.cdr.markForCheck();
  }

  onCropperChange(position: CropperPosition): void {
    if (!this.initialCropper) {
      this.initialCropper = { ...position };
      return;
    }
    if (this.moved || PictureCropModalComponent.sameCropper(this.initialCropper, position)) {
      return;
    }
    this.moved = true;
    this.hideHint();
    this.reportDirty();
  }

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------

  rotateLeft(): void {
    this.setRotation(this.rotation - 1);
  }

  rotateRight(): void {
    this.setRotation(this.rotation + 1);
  }

  resetCrop(): void {
    if (this.isProcessing || !this.imageLoaded) return;

    const wasRotated = this.rotation !== 0;
    this.rotation = 0;
    this.initialCropper = null;
    this.moved = false;
    this.applyZoom(MIN_SCALE);

    // When the image is rotated the cropper recalculates its box once the
    // un-rotated bitmap loads; otherwise reset the box immediately.
    if (!wasRotated) {
      this.cropper?.resetCropperPosition();
    }
    this.hideHint();
    this.reportDirty();
  }

  zoomIn(): void {
    this.stepZoom(1);
  }

  zoomOut(): void {
    this.stepZoom(-1);
  }

  /** Live zoom while the slider is dragged (throttled to one frame). */
  onZoomInput(event: CustomEvent<RangeChangeEventDetail>): void {
    const detail = event.detail?.value;
    const value = typeof detail === "number" ? detail : detail?.lower;
    if (typeof value !== "number" || !Number.isFinite(value)) return;

    this.hideHint();
    this.queueZoom(value);
  }

  setGuide(circle: boolean): void {
    if (this.circleGuide === circle) return;
    this.circleGuide = circle;
    this.cdr.markForCheck();
  }

  pickAnother(): void {
    this.replaceInput?.nativeElement.click();
  }

  onReplaceSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file) return;

    const error = PictureCropModalComponent.validateFile(file);
    if (error) {
      void this.showToast(error);
      return;
    }
    this.useFile(file);
  }

  // ---------------------------------------------------------------------------
  // Dismiss / confirm
  // ---------------------------------------------------------------------------

  async confirm(): Promise<void> {
    if (!this.imageLoaded || this.isProcessing || this.loadError) return;

    this.isProcessing = true;
    this.cdr.markForCheck();

    try {
      // Always export from the cropper at confirm time so the saved image
      // reflects exactly the crop box / rotation / zoom currently on screen.
      const cropped = await this.cropper?.crop("blob");
      if (!cropped?.blob) {
        await this.showToast("Adjust the crop, then try saving again");
        return;
      }

      const finalBlob = await this.resizeIfNeeded(cropped.blob);
      const extension = this.outputFormat === "jpeg" ? "jpg" : this.outputFormat;
      const file = new File([finalBlob], `profile-${Date.now()}.${extension}`, {
        type: finalBlob.type || `image/${this.outputFormat}`,
      });

      void this.signalSuccess();
      await this.modalCtrl.dismiss({ file }, "confirm");
    } catch (error) {
      console.error("Crop processing error:", error);
      await this.showToast("Couldn't save this photo. Please try again.");
    } finally {
      this.isProcessing = false;
      this.cdr.markForCheck();
    }
  }

  cancel(): void {
    if (this.isProcessing) return;
    void this.modalCtrl.dismiss(null, "cancel");
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private setRotation(next: number): void {
    if (this.isProcessing || !this.imageLoaded) return;

    // Keep 0..3 quarter turns so the frame aspect stays in sync.
    this.rotation = ((next % 4) + 4) % 4;
    // The box is recalculated for the new orientation; treat that as the
    // baseline so an un-touched, un-rotated photo is still "clean".
    this.initialCropper = null;
    this.moved = false;
    this.hideHint();
    this.reportDirty();
    this.cdr.markForCheck();
  }

  private stepZoom(direction: 1 | -1): void {
    if (!this.imageLoaded) return;
    this.hideHint();
    this.applyZoom(this.scale + direction * ZOOM_STEP);
  }

  private queueZoom(value: number): void {
    this.pendingZoom = value;
    if (this.zoomFrame) return;

    this.zoomFrame = requestAnimationFrame(() => {
      this.zoomFrame = 0;
      const next = this.pendingZoom;
      this.pendingZoom = null;
      if (next !== null) {
        this.applyZoom(next);
      }
    });
  }

  private applyZoom(value: number): void {
    const clamped = Math.min(Math.max(value, MIN_SCALE), MAX_SCALE);
    const next = Math.round(clamped * 100) / 100;

    if (next !== this.scale) {
      this.scale = next;
      this.transform = { scale: next };
    }
    this.reportDirty();
    this.cdr.markForCheck();
  }

  /** Swap the photo without leaving the editor. */
  private useFile(file: File): void {
    this.sourceFile = file;
    this.imageLoaded = false;
    this.loadError = false;
    this.rotation = 0;
    this.scale = 1;
    this.transform = { scale: 1 };
    this.initialCropper = null;
    this.moved = false;
    this.hideHint();
    this.reportDirty();
    void this.prepareSource(file);
    this.cdr.markForCheck();
  }

  /**
   * Read the source dimensions before mounting the cropper so the frame can be
   * sized to the photo. That keeps the photo centred with no dead bands and
   * gives the cropper a stable surface to measure against.
   */
  private async prepareSource(file: File): Promise<void> {
    this.frameReady = false;
    this.cdr.markForCheck();

    try {
      this.sourceAspect = await PictureCropModalComponent.readAspectRatio(file);
      this.frameReady = true;
    } catch {
      this.loadError = true;
    }
    this.cdr.markForCheck();
  }

  private static readAspectRatio(file: File): Promise<number> {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();

      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const { naturalWidth: width, naturalHeight: height } = image;
        resolve(width > 0 && height > 0 ? width / height : 1);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Unreadable image"));
      };

      image.src = objectUrl;
    });
  }

  private reportDirty(): void {
    const dirty = this.hasEdits;
    if (dirty === this.lastReportedDirty) return;

    this.lastReportedDirty = dirty;
    this.onDirtyChange?.(dirty);
  }

  private scheduleHint(): void {
    this.hintVisible = true;
    this.clearHintTimer();
    this.hintTimer = setTimeout(() => {
      this.hintTimer = undefined;
      this.hintVisible = false;
      this.cdr.markForCheck();
    }, HINT_DURATION_MS);
  }

  /** Any deliberate adjustment dismisses the coach mark right away. */
  private hideHint(): void {
    if (!this.hintVisible) return;
    this.hintVisible = false;
    this.clearHintTimer();
  }

  private clearHintTimer(): void {
    if (this.hintTimer) {
      clearTimeout(this.hintTimer);
      this.hintTimer = undefined;
    }
  }

  /** Downscale the cropped blob if it exceeds maxDimension. */
  private resizeIfNeeded(blob: Blob): Promise<Blob> {
    const max = this.maxDimension;
    if (!max || max <= 0) {
      return Promise.resolve(blob);
    }

    return new Promise((resolve) => {
      const objectUrl = URL.createObjectURL(blob);
      const image = new Image();

      image.onload = () => {
        URL.revokeObjectURL(objectUrl);

        const { naturalWidth: width, naturalHeight: height } = image;
        if (width <= max && height <= max) {
          resolve(blob);
          return;
        }

        let targetWidth = width;
        let targetHeight = height;
        if (width >= height) {
          targetWidth = max;
          targetHeight = Math.max(1, Math.round((height * max) / width));
        } else {
          targetHeight = max;
          targetWidth = Math.max(1, Math.round((width * max) / height));
        }

        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(blob);
          return;
        }

        // JPEG has no alpha channel; flatten onto white instead of black.
        if (this.outputFormat === "jpeg") {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, targetWidth, targetHeight);
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

        canvas.toBlob(
          (resized) => resolve(resized ?? blob),
          `image/${this.outputFormat}`,
          this.outputQuality
        );
      };

      // A failed downscale should not lose the user's crop.
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(blob);
      };

      image.src = objectUrl;
    });
  }

  private static validateFile(file: File): string | null {
    const type = (file.type || "").toLowerCase();
    const extensionOk = ALLOWED_SOURCE_EXTENSIONS.test(file.name);
    const typeOk = type === "" ? extensionOk : ALLOWED_SOURCE_TYPES.includes(type);

    if (!typeOk) {
      return "Only JPG, JPEG, PNG, or WEBP images are allowed";
    }
    if (file.size > MAX_SOURCE_BYTES) {
      return "Picture is too large. Maximum size is 5 MB";
    }
    return null;
  }

  private static sameCropper(a: CropperPosition, b: CropperPosition): boolean {
    const tolerance = 2;
    return (
      Math.abs(a.x1 - b.x1) <= tolerance &&
      Math.abs(a.y1 - b.y1) <= tolerance &&
      Math.abs(a.x2 - b.x2) <= tolerance &&
      Math.abs(a.y2 - b.y2) <= tolerance
    );
  }

  private async signalSuccess(): Promise<void> {
    try {
      const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      // Haptics are unavailable on the web; saving still succeeds.
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
