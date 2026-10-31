import { Injectable } from "@angular/core";

interface BatteryManagerLike extends EventTarget {
  level: number;
  charging: boolean;
}

interface NavigatorWithBattery extends Navigator {
  getBattery?: () => Promise<BatteryManagerLike>;
}

/**
 * Reads the device battery through the Web Battery API, which is available
 * in Chromium (Android WebView, Chrome desktop). WebViews that do not expose
 * it (iOS WKWebView) simply report null and the UI shows "not available".
 */
@Injectable({
  providedIn: "root",
})
export class BatteryService {
  private level: number | null = null;
  private charging: boolean | null = null;
  private initPromise: Promise<void> | null = null;

  /** Subscribe to battery events once; later calls reuse the snapshot. */
  init(): Promise<void> {
    this.initPromise ??= this.setup();
    return this.initPromise;
  }

  /** Latest cached level (0-100) and charging state; null when unsupported. */
  getBatteryInfo(): { level: number | null; charging: boolean | null } {
    return { level: this.level, charging: this.charging };
  }

  private async setup(): Promise<void> {
    try {
      const nav = navigator as NavigatorWithBattery;
      if (typeof nav.getBattery !== "function") return;

      const manager = await nav.getBattery();
      const read = (): void => {
        this.level = Math.round((manager.level ?? 0) * 100);
        this.charging = !!manager.charging;
      };

      read();
      manager.addEventListener("levelchange", read);
      manager.addEventListener("chargingchange", read);
    } catch {
      // Battery info is optional; tracking must keep working without it.
    }
  }
}
