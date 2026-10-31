import { Component, inject } from "@angular/core";
import { Router } from "@angular/router";
import { IonButton, IonContent, IonIcon } from "@ionic/angular";
import { addIcons } from "ionicons";
import {
  arrowForwardOutline,
  locationOutline,
  peopleOutline,
  radioOutline,
  shieldCheckmarkOutline,
} from "ionicons/icons";
import { OnboardingService } from "../../../core/services/onboarding.service";

@Component({
  selector: "app-welcome",
  templateUrl: "./welcome.page.html",
  styleUrls: ["./welcome.page.scss"],
  standalone: true,
  imports: [IonContent, IonButton, IonIcon],
})
export class WelcomePage {
  private readonly router = inject(Router);
  private readonly onboarding = inject(OnboardingService);

  constructor() {
    addIcons({
      arrowForwardOutline,
      locationOutline,
      peopleOutline,
      radioOutline,
      shieldCheckmarkOutline,
    });
  }

  /**
   * Shown once for new installs. Uses a normal push (not replaceUrl) so the
   * browser / Android back gesture returns here from the register screen.
   */
  async getStarted(): Promise<void> {
    await this.onboarding.complete();
    await this.router.navigate(["/register"]);
  }
}
