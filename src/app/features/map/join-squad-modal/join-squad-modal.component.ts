import { AfterViewInit, Component, ViewChild, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { IonButton, IonIcon, IonInput, ModalController } from "@ionic/angular";
import { addIcons } from "ionicons";
import {
  alertCircleOutline,
  closeOutline,
  keyOutline,
  logInOutline,
} from "ionicons/icons";

/**
 * Custom bottom-sheet modal for joining an existing squad. The field is
 * auto-capitalized and grouped into four-character blocks while the dismissed
 * value stays a clean alphanumeric join code for the API.
 */
@Component({
  selector: "app-join-squad-modal",
  standalone: true,
  imports: [FormsModule, IonButton, IonIcon, IonInput],
  templateUrl: "./join-squad-modal.component.html",
  styleUrls: ["../squad-form-modal.shared.scss"],
})
export class JoinSquadModalComponent implements AfterViewInit {
  private readonly modalCtrl = inject(ModalController);

  @ViewChild("codeInput") private codeInput?: IonInput;

  /** Display value including the automatic grouping dashes. */
  code = "";
  /** Set once the user tries to submit, so empty-field errors stay quiet first. */
  submitted = false;

  constructor() {
    addIcons({
      alertCircleOutline,
      closeOutline,
      keyOutline,
      logInOutline,
    });
  }

  ngAfterViewInit(): void {
    setTimeout(() => void this.codeInput?.setFocus(), 320);
  }

  get rawCode(): string {
    return this.code.replace(/[^A-Z0-9]/g, "");
  }

  get isValid(): boolean {
    return this.rawCode.length >= 4 && this.rawCode.length <= 24;
  }

  get showEmptyError(): boolean {
    return this.submitted && this.rawCode.length === 0;
  }

  get showMinError(): boolean {
    return this.rawCode.length > 0 && this.rawCode.length < 4;
  }

  get showError(): boolean {
    return this.showEmptyError || this.showMinError;
  }

  get errorMessage(): string {
    return this.showEmptyError
      ? "Enter your join code"
      : "Join codes have at least 4 characters";
  }

  /** Uppercase, strip separators, then add a dash every four characters. */
  onCodeInput(event: Event): void {
    const input = event.target as HTMLIonInputElement;
    const formatted = this.formatCode(String(input.value ?? ""));
    if (formatted !== input.value) {
      input.value = formatted;
    }
    this.code = formatted;
  }

  close(): void {
    void this.modalCtrl.dismiss(null, "cancel");
  }

  submit(): void {
    this.submitted = true;
    if (!this.isValid) return;
    // The API expects the raw code; the dashes are display-only.
    void this.modalCtrl.dismiss(this.rawCode, "confirm");
  }

  private formatCode(value: string): string {
    const clean = value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 24);
    return clean.replace(/(.{4})(?=.)/g, "$1-");
  }
}
