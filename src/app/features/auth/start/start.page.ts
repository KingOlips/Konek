import { Component, OnInit, inject } from "@angular/core";
import { Router } from "@angular/router";
import { IonContent } from "@ionic/angular";
import { AuthService } from "../../../core/services/auth.service";
import { OnboardingService } from "../../../core/services/onboarding.service";

/**
 * Entry route ("/"): resolves where the app should open.
 *  - signed-in users  -> /map
 *  - returning users  -> /login
 *  - brand-new install -> /welcome (one-time "Get Started" screen)
 */
@Component({
  selector: "app-start",
  standalone: true,
  imports: [IonContent],
  template: `<ion-content class="start-content"></ion-content>`,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }

      .start-content {
        --background: #08162f;
      }
    `,
  ],
})
export class StartPage implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly onboarding = inject(OnboardingService);
  private readonly router = inject(Router);

  async ngOnInit(): Promise<void> {
    await this.authService.whenReady();

    if (this.authService.isAuthenticated()) {
      await this.router.navigateByUrl("/map", { replaceUrl: true });
      return;
    }

    if (await this.onboarding.isComplete()) {
      await this.router.navigateByUrl("/login", { replaceUrl: true });
      return;
    }

    await this.router.navigateByUrl("/welcome", { replaceUrl: true });
  }
}
