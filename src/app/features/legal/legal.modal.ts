import { AfterViewInit, Component, Input, ViewChild, inject } from "@angular/core";
import { IonButton, IonContent, IonIcon, ModalController } from "@ionic/angular";
import { addIcons } from "ionicons";
import { closeOutline, shieldCheckmarkOutline } from "ionicons/icons";

/**
 * Terms of Service and Privacy Policy shown during sign-up.
 *
 * The same sheet is used for both links; `section` decides which heading is
 * scrolled into view so tapping "Privacy Policy" lands on the privacy part.
 */
@Component({
  selector: "app-legal-modal",
  templateUrl: "./legal.modal.html",
  styleUrls: ["./legal.modal.scss"],
  standalone: true,
  imports: [IonContent, IonButton, IonIcon],
})
export class LegalModalComponent implements AfterViewInit {
  private readonly modalCtrl = inject(ModalController);

  @Input() section: "terms" | "privacy" = "terms";

  @ViewChild(IonContent) private content?: IonContent;

  constructor() {
    addIcons({ closeOutline, shieldCheckmarkOutline });
  }

  ngAfterViewInit(): void {
    // Wait for the modal to finish presenting before scrolling.
    setTimeout(() => void this.scrollToSection(), 120);
  }

  async close(): Promise<void> {
    await this.modalCtrl.dismiss(null, "cancel");
  }

  private async scrollToSection(): Promise<void> {
    const id = this.section === "privacy" ? "privacy-policy" : "terms-of-service";
    const target = document.getElementById(id);
    if (!target || !this.content) return;

    try {
      await this.content.scrollToPoint(0, Math.max(0, target.offsetTop - 16), 0);
    } catch {
      // Scroll position is a convenience only.
    }
  }
}
