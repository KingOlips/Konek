import { Injectable, inject } from "@angular/core";
import { Capacitor, registerPlugin } from "@capacitor/core";

import { environment } from "../../../environments/environment";
import { AuthService } from "./auth.service";

interface KonekBackgroundTrackerPlugin {
  /** Starts the Android foreground service. */
  start(options: {
    apiUrl: string;
    token: string;
    intervalMs?: number;
  }): Promise<{ running: boolean }>;
  /** Stops the service and removes the ongoing notification. */
  stop(): Promise<{ running: boolean }>;
  /** Whether the native service is currently active. */
  isRunning(): Promise<{ running: boolean }>;
  /** Opens the system app settings page. */
  openSettings(): Promise<void>;
}

const KonekBackgroundTracker =
  registerPlugin<KonekBackgroundTrackerPlugin>("KonekBackgroundTracker");

/**
 * Android-only bridge to the native foreground location service.
 *
 * The service keeps uploading location + battery to the PHP API while the app
 * is backgrounded or swiped away, and shows the ongoing
 * "Updating your location" notification Android requires.
 *
 * All methods are safe no-ops on the web and on iOS.
 */
@Injectable({
  providedIn: "root",
})
export class BackgroundTrackerService {
  private readonly authService = inject(AuthService);
  private started = false;

  /** Foreground services are an Android concept; iOS/web are unsupported. */
  get isSupported(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  }

  /** Start (or refresh) the native service. Returns false when unsupported. */
  async start(intervalMs = 10000): Promise<boolean> {
    if (!this.isSupported) return false;

    const token = await this.authService.getAuthToken();
    if (!token) return false;

    try {
      await KonekBackgroundTracker.start({
        apiUrl: environment.apiUrl,
        token,
        intervalMs,
      });
      this.started = true;
      return true;
    } catch (error) {
      console.warn("Background tracking could not start:", error);
      return false;
    }
  }

  /** Stop the service. Safe to call repeatedly and from any platform. */
  async stop(): Promise<void> {
    if (!this.started && !this.isSupported) return;
    try {
      await KonekBackgroundTracker.stop();
    } catch (error) {
      console.warn("Background tracking could not stop:", error);
    } finally {
      this.started = false;
    }
  }

  async isRunning(): Promise<boolean> {
    if (!this.isSupported) return false;
    try {
      const { running } = await KonekBackgroundTracker.isRunning();
      return running;
    } catch {
      return false;
    }
  }

  /** Send the user to app settings so they can allow background location. */
  async openSettings(): Promise<void> {
    if (!this.isSupported) return;
    try {
      await KonekBackgroundTracker.openSettings();
    } catch (error) {
      console.debug("Could not open app settings:", error);
    }
  }
}
