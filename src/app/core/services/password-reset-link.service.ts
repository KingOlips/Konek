import { Injectable } from "@angular/core";
import { Observable, Subject } from "rxjs";

/**
 * Small bridge between the app shell (which receives the email deep link) and
 * the forgot-password popup.
 *
 * The "Verify" button in the reset email opens Konek with a token. If the popup
 * is already open, the token is pushed through here so the live popup switches
 * to its new-password step instead of stacking a second modal. If no popup is
 * open, the shell presents one with the token as an input.
 */
@Injectable({ providedIn: "root" })
export class PasswordResetLinkService {
  // A plain Subject, not a BehaviorSubject: a token must not be replayed to a
  // popup opened later for a brand-new reset request.
  private readonly tokenSource = new Subject<string>();
  private openModals = 0;

  /** Reset tokens arriving while the popup is already on screen. */
  readonly resetToken$: Observable<string> = this.tokenSource.asObservable();

  notifyModalOpen(): void {
    this.openModals += 1;
  }

  notifyModalClosed(): void {
    this.openModals = Math.max(0, this.openModals - 1);
  }

  hasOpenModal(): boolean {
    return this.openModals > 0;
  }

  pushToken(token: string): void {
    const trimmed = (token ?? "").trim();
    if (trimmed !== "") {
      this.tokenSource.next(trimmed);
    }
  }
}
