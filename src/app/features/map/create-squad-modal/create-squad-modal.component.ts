import { AfterViewInit, Component, ViewChild, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { IonButton, IonIcon, IonInput, ModalController } from "@ionic/angular";
import { addIcons } from "ionicons";
import {
  alertCircleOutline,
  closeOutline,
  peopleOutline,
  personAddOutline,
} from "ionicons/icons";

/**
 * Custom bottom-sheet modal for creating a squad. Collects and validates the
 * name locally, then dismisses with the trimmed value so MapPage can run the
 * API call against the normal loading/toast flow.
 */
@Component({
  selector: "app-create-squad-modal",
  standalone: true,
  imports: [FormsModule, IonButton, IonIcon, IonInput],
  templateUrl: "./create-squad-modal.component.html",
  styleUrls: ["../squad-form-modal.shared.scss"],
})
export class CreateSquadModalComponent implements AfterViewInit {
  private readonly modalCtrl = inject(ModalController);

  @ViewChild("nameInput") private nameInput?: IonInput;

  /** Raw field value (bound with ngModel). */
  name = "";
  /** Set once the user tries to submit, so empty-field errors stay quiet first. */
  submitted = false;

  constructor() {
    addIcons({
      alertCircleOutline,
      closeOutline,
      peopleOutline,
      personAddOutline,
    });
  }

  ngAfterViewInit(): void {
    // Wait for the sheet's entrance animation so focusing doesn't jump the
    // layout mid-slide.
    setTimeout(() => void this.nameInput?.setFocus(), 320);
  }

  get trimmedName(): string {
    return this.name.trim();
  }

  get isValid(): boolean {
    return this.trimmedName.length >= 2 && this.trimmedName.length <= 40;
  }

  get showEmptyError(): boolean {
    return this.submitted && this.trimmedName.length === 0;
  }

  get showMinError(): boolean {
    return this.trimmedName.length > 0 && this.trimmedName.length < 2;
  }

  get showError(): boolean {
    return this.showEmptyError || this.showMinError;
  }

  get errorMessage(): string {
    return this.showEmptyError
      ? "Enter a squad name"
      : "Use at least 2 characters";
  }

  close(): void {
    void this.modalCtrl.dismiss(null, "cancel");
  }

  submit(): void {
    this.submitted = true;
    if (!this.isValid) return;
    void this.modalCtrl.dismiss(this.trimmedName, "confirm");
  }
}
