import { Injectable } from "@angular/core";
import { Geolocation, PositionOptions, GeolocationPosition } from "@capacitor/geolocation";
import { Motion } from "@capacitor/motion";
import type { PluginListenerHandle } from "@capacitor/core";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";

/**
 * Wraps Capacitor Geolocation + Motion sensors.
 *
 * - `watchPosition` streams GPS fixes.
 * - Accelerometer data drives "adaptive polling": when the user is stationary
 *   we let the server-update cadence drop, saving battery.
 * - Orientation data supplies a compass heading for the map marker.
 */
@Injectable({
  providedIn: "root",
})
export class GeolocationService {
  private watchId: string | null = null;
  private motionListeners: PluginListenerHandle[] = [];
  private orientationListening = false;
  private lastKnownPosition: GeolocationPosition | null = null;
  private lastHeading = 0;
  private isMoving = false;
  private movementThreshold = 0.6; // m/s^2 deviation from gravity
  private pollInterval = 10000; // ms
  private adaptivePolling = true;

  /** Cached heading so the map can render immediately after a compass event. */
  getHeading(): number {
    return this.lastHeading;
  }

  async requestPermissions(): Promise<boolean> {
    // Browsers trigger their own permission prompt on the first position
    // request; Capacitor's requestPermissions() is native-only.
    if (!Capacitor.isNativePlatform()) {
      return true;
    }

    try {
      const permissions = await Geolocation.requestPermissions();
      return permissions.location === "granted";
    } catch (error) {
      console.error("Permission request failed:", error);
      return false;
    }
  }

  async getCurrentPosition(options?: PositionOptions): Promise<GeolocationPosition> {
    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
      ...options,
    });
    this.lastKnownPosition = position;
    return position;
  }

  async watchPosition(
    onSuccess: (position: GeolocationPosition) => void,
    onError: (error: unknown) => void,
    options?: PositionOptions
  ): Promise<string> {
    this.watchId = await Geolocation.watchPosition(
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5000,
        ...options,
      },
      (position, err) => {
        if (err) {
          onError(err);
        } else if (position) {
          this.detectMovement(position);
          this.lastKnownPosition = position;
          onSuccess(position);
        }
      }
    );
    return this.watchId;
  }

  async clearWatch(watchId: string): Promise<void> {
    await Geolocation.clearWatch({ id: watchId });
    this.watchId = null;
  }

  /**
   * Subscribe to accelerometer + compass. Safe to call repeatedly; previous
   * listeners are removed first.
   */
  async startMotionTracking(): Promise<void> {
    await this.stopMotionTracking();
    try {
      const accel = await Motion.addListener("accel", (event) => {
        const gravity = event.accelerationIncludingGravity;
        if (!gravity) return;
        const { x, y, z } = gravity;
        // Remove the ~9.8m/s^2 gravity component to isolate user movement.
        const magnitude = Math.abs(Math.sqrt(x * x + y * y + z * z) - 9.81);
        this.isMoving = magnitude > this.movementThreshold;
        if (this.adaptivePolling) {
          this.pollInterval = this.isMoving ? 5000 : 30000;
        }
      });

      this.motionListeners.push(accel);
    } catch (error) {
      console.debug("Motion sensors unavailable (expected on web):", error);
    }

    // Compass heading always comes from the web DeviceOrientation API, which
    // also works inside the Capacitor WebView.
    this.startWebOrientationFallback();
  }

  private startWebOrientationFallback(): void {
    if (this.orientationListening) return;
    if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return;
    window.addEventListener("deviceorientation", this.orientationHandler);
    this.orientationListening = true;
  }

  private readonly orientationHandler = (event: DeviceOrientationEvent): void => {
    const heading = event as DeviceOrientationEvent & { webkitCompassHeading?: number };
    if (heading.webkitCompassHeading !== undefined) {
      this.lastHeading = heading.webkitCompassHeading;
    } else if (event.alpha !== null) {
      this.lastHeading = (360 - event.alpha) % 360;
    }
  };

  async stopMotionTracking(): Promise<void> {
    for (const listener of this.motionListeners) {
      await listener.remove();
    }
    this.motionListeners = [];

    if (this.orientationListening) {
      window.removeEventListener("deviceorientation", this.orientationHandler);
      this.orientationListening = false;
    }
  }

  /** Rough movement detection from successive GPS fixes. */
  private detectMovement(position: GeolocationPosition): void {
    if (!this.lastKnownPosition) return;
    const prev = this.lastKnownPosition.coords;
    const curr = position.coords;
    const distance = this.calculateDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
    const elapsed = Math.max((position.timestamp - this.lastKnownPosition.timestamp) / 1000, 1);
    this.isMoving = distance / elapsed > 0.5;
    if (this.adaptivePolling) {
      this.pollInterval = this.isMoving ? 5000 : 30000;
    }
  }

  /** Haversine distance in metres. */
  calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private toRad(deg: number): number {
    return (deg * Math.PI) / 180;
  }

  getPollInterval(): number {
    return this.pollInterval;
  }

  setAdaptivePolling(enabled: boolean): void {
    this.adaptivePolling = enabled;
  }

  /** Write an export payload to the device Documents folder. */
  async exportToFile(data: unknown, filename: string): Promise<void> {
    const jsonString = JSON.stringify(data, null, 2);
    const base = filename.replace(/\.json$/i, "");
    await this.exportTextToFile(jsonString, `${base}.json`, "application/json");
  }

  /**
   * Write text (CSV/JSON) to the device Documents folder.
   * Falls back to the cache directory, and to a browser download on the web.
   */
  async exportTextToFile(
    data: string,
    filename: string,
    mimeType = "text/plain"
  ): Promise<void> {
    const path = `${filename.replace(/\.[^.]+$/, "")}-${Date.now()}${
      filename.match(/\.[^.]+$/)?.[0] ?? ""
    }`;

    if (!Capacitor.isNativePlatform()) {
      const blob = new Blob([data], { type: `${mimeType};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = path;
      anchor.click();
      URL.revokeObjectURL(url);
      return;
    }

    try {
      await Filesystem.writeFile({
        path,
        data,
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
      });
    } catch (error) {
      console.debug("Documents write failed, falling back to cache:", error);
      await Filesystem.writeFile({
        path,
        data,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });
    }
  }
}
