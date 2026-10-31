import { Injectable } from "@angular/core";
import { Preferences } from "@capacitor/preferences";

const ONBOARDING_KEY = "konek_onboarding_complete";

/**
 * Tracks whether the first-run "Get Started" screen has already been shown.
 * New installs see it once; after that the app opens straight into auth/map.
 */
@Injectable({
  providedIn: "root",
})
export class OnboardingService {
  private cached: boolean | null = null;

  async isComplete(): Promise<boolean> {
    if (this.cached !== null) return this.cached;
    try {
      const { value } = await Preferences.get({ key: ONBOARDING_KEY });
      this.cached = value === "true";
    } catch {
      this.cached = false;
    }
    return this.cached;
  }

  async complete(): Promise<void> {
    this.cached = true;
    try {
      await Preferences.set({ key: ONBOARDING_KEY, value: "true" });
    } catch {
      // Storage unavailable - the in-memory flag still suppresses the screen
      // for the rest of this session.
    }
  }
}
