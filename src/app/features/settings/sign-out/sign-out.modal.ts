import { Component, inject } from "@angular/core";
import {
  IonButton,
  IonContent,
  IonIcon,
  ModalController,
} from "@ionic/angular";
import { addIcons } from "ionicons";
import { closeOutline, logOutOutline } from "ionicons/icons";

/**
 * Small confirmation popup shown before signing out.
 *
 * The Settings page owns the actual stop-tracker → logout API → /login flow;
 * this modal only returns the user's choice via the dismiss role.
 */
@Component({
  selector: "app-sign-out-modal",
  standalone: true,
  imports: [IonButton, IonContent, IonIcon],
  templateUrl: "./sign-out.modal.html",
  styleUrls: ["./sign-out.modal.scss"],
})
export class SignOutModalComponent {
  private readonly modalCtrl = inject(ModalController);

  constructor() {
    addIcons({ closeOutline, logOutOutline });
  }

  cancel(): void {
    void this.modalCtrl.dismiss(null, "cancel");
  }

  confirm(): void {
    void this.modalCtrl.dismiss(null, "confirm");
  }
}
