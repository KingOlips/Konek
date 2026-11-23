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
 * The service keeps uploading location to the PHP API while the app
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
  /** Serializes native start/stop calls so an old start cannot revive after logout. */
  private operationQueue: Promise<void> = Promise.resolve();

  /** Foreground services are an Android concept; iOS/web are unsupported. */
  get isSupported(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  }

  /** Start (or refresh) the native service. Returns false when unsupported. */
  async start(intervalMs = 10000): Promise<boolean> {
    return this.enqueue(async () => {
      if (!this.isSupported) return false;

      const currentUser = this.authService.getCurrentUser();
      const token =
        currentUser?.auth_token ?? (await this.authService.getAuthToken());
      if (!token) return false;
      const sessionEpoch = this.authService.getSessionEpoch();

      try {
        await KonekBackgroundTracker.start({
          apiUrl: environment.apiUrl,
          token,
          intervalMs,
        });

        const activeToken =
          this.authService.getCurrentUser()?.auth_token ?? null;
        if (
          sessionEpoch !== this.authService.getSessionEpoch() ||
          activeToken !== token
        ) {
          // Logout or a newer login happened while the native call was
          // pending. Stop this old-token uploader before another start runs.
          try {
            await KonekBackgroundTracker.stop();
          } catch {
            // The queued stop call will make another best-effort attempt.
          }
          return false;
        }

        this.started = true;
        return true;
      } catch (error) {
        console.warn("Background tracking could not start:", error);
        return false;
      }
    });
  }

  /** Stop the service. Safe to call repeatedly and from any platform. */
  async stop(): Promise<void> {
    await this.enqueue(async () => {
      if (!this.started && !this.isSupported) return;
      try {
        await KonekBackgroundTracker.stop();
      } catch (error) {
        console.warn("Background tracking could not stop:", error);
      } finally {
        this.started = false;
      }
    });
  }

  async isRunning(): Promise<boolean> {
    if (!this.isSupported) return false;
    return this.enqueue(async () => {
      try {
        const { running } = await KonekBackgroundTracker.isRunning();
        return running;
      } catch {
        return false;
      }
    });
  }

  /** Queue native operations so start and stop keep their call order. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
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
