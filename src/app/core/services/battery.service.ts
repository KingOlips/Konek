import { Injectable } from "@angular/core";
import { Capacitor } from "@capacitor/core";
import { Device } from "@capacitor/device";

interface BatteryManagerLike extends EventTarget {
  level: number;
  charging: boolean;
}

interface NavigatorWithBattery extends Navigator {
  getBattery?: () => Promise<BatteryManagerLike>;
}

/**
 * Reads the device battery level.
 *
 * On native builds (the Android APK) this uses the Capacitor Device plugin,
 * which talks to Android's BatteryManager directly. The Web Battery API is
 * not exposed by Android WebView, so the browser API is only a fallback for
 * running the app in a desktop browser. A null result means the platform does
 * not report battery data at all (for example iOS without a native build).
 */
@Injectable({
  providedIn: "root",
})
export class BatteryService {
  private level: number | null = null;
  private charging: boolean | null = null;
  private initPromise: Promise<void> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  /** Read the battery once and keep it fresh; later calls reuse the result. */
  init(): Promise<void> {
    this.initPromise ??= this.setup();
    return this.initPromise;
  }

  /** Latest cached level (0-100) and charging state; null when unsupported. */
  getBatteryInfo(): { level: number | null; charging: boolean | null } {
    return { level: this.level, charging: this.charging };
  }

  private async setup(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await this.readNative();
      // @capacitor/device has no battery change events, so refresh while the
      // app is open. A minute is plenty for a battery percentage.
      this.refreshTimer = setInterval(() => void this.readNative(), 60_000);
      return;
    }

    await this.setupWeb();
  }

  private async readNative(): Promise<void> {
    try {
      const info = await Device.getBatteryInfo();
      // -1 means the platform could not determine the level.
      this.level =
        typeof info.batteryLevel === "number" && info.batteryLevel >= 0
          ? Math.round(info.batteryLevel * 100)
          : null;
      this.charging = typeof info.isCharging === "boolean" ? info.isCharging : null;
    } catch {
      // Battery info is optional; location tracking must keep working.
    }
  }

  private async setupWeb(): Promise<void> {
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
      // The Web Battery API is blocked in some browsers; ignore it.
    }
  }
}
