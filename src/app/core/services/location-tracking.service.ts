import { Injectable } from "@angular/core";
import { BehaviorSubject, Observable } from "rxjs";

/** localStorage entry shared with the Settings toggle and the map page. */
const STORAGE_KEY = "konek_location_tracking";

/**
 * Master switch for sharing the signed-in user's own location.
 *
 * The Settings toggle writes this state; the map page watches it to start or
 * stop its foreground GPS watch, heartbeat and uploads. Other members'
 * positions keep polling either way. The Android background tracker is
 * started/stopped by the Settings page as well.
 */
@Injectable({
  providedIn: "root",
})
export class LocationTrackingService {
  private readonly enabledState = new BehaviorSubject<boolean>(
    this.readStoredPreference()
  );

  /** Emits the current preference immediately, then on every change. */
  readonly enabled$: Observable<boolean> = this.enabledState.asObservable();

  get enabled(): boolean {
    return this.enabledState.value;
  }

  /** Update the preference and notify every listener. */
  setEnabled(enabled: boolean): void {
    try {
      localStorage.setItem(STORAGE_KEY, enabled.toString());
    } catch {
      // Private mode / unavailable storage: keep the in-memory state.
    }

    if (this.enabledState.value !== enabled) {
      this.enabledState.next(enabled);
    }
  }

  /** Flip the preference and return the new value. */
  toggle(): boolean {
    const next = !this.enabledState.value;
    this.setEnabled(next);
    return next;
  }

  private readStoredPreference(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) !== "false";
    } catch {
      return true;
    }
  }
}
