import { Injectable, inject } from "@angular/core";
import { Capacitor } from "@capacitor/core";
import { firstValueFrom } from "rxjs";
import { auth, AuthProvider } from "capacitor-auth-manager";
import { environment } from "../../../environments/environment";
import { AuthResponse, AuthService } from "./auth.service";

/**
 * Google Sign-In for Konek.
 *
 * - Android: capacitor-auth-manager uses Credential Manager with the Web OAuth
 *   client ID as the server client ID.
 * - Web: Google One Tap is unreliable (Google suppresses it after a dismissal,
 *   and there is no way to force it back), so the web build renders Google's
 *   official "Continue with Google" button instead.
 *
 * Both paths produce an ID token that the Konek backend verifies.
 */
@Injectable({
  providedIn: "root",
})
export class GoogleAuthService {
  private readonly authService = inject(AuthService);

  private configured = false;
  private gisLoadPromise: Promise<void> | null = null;

  /** True when running inside the Android/iOS app shell. */
  isNativePlatform(): boolean {
    return Capacitor.isNativePlatform();
  }

  /** Open the Google account chooser on a device and return the ID token. */
  async signIn(): Promise<string> {
    const result = await this.signInNative();
    const idToken = result?.credential?.idToken;

    if (!idToken) {
      throw new Error(
        "Google did not return an ID token. Check the OAuth client configuration and SHA-1 fingerprint."
      );
    }

    return idToken;
  }

  /** Sign in on a device, then exchange the ID token for a Konek session. */
  async signInAndAuthenticate(): Promise<AuthResponse> {
    const idToken = await this.signIn();
    return firstValueFrom(this.authService.signInWithGoogle(idToken));
  }

  /**
   * Web only: render Google's official sign-in button inside `parent`.
   * The callback receives the ID token when the user completes sign-in.
   */
  async renderWebButton(
    parent: HTMLElement,
    onCredential: (idToken: string) => void
  ): Promise<void> {
    const clientId = this.clientId();
    await this.loadGis();

    const google = (window as unknown as { google?: any }).google;
    if (!google?.accounts?.id) {
      throw new Error("Google Identity Services did not load.");
    }

    google.accounts.id.initialize({
      client_id: clientId,
      callback: (response: { credential?: string }) => {
        if (response?.credential) {
          onCredential(response.credential);
        }
      },
      auto_select: false,
      cancel_on_tap_outside: true,
    });

    parent.innerHTML = "";
    google.accounts.id.renderButton(parent, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "rectangular",
      logo_alignment: "left",
      width: 320,
    });
  }

  private clientId(): string {
    const clientId = environment.googleClientId;
    if (!clientId || clientId.startsWith("YOUR_")) {
      throw new Error(
        "Google Sign-In is not configured. Set googleClientId in the environment file."
      );
    }
    return clientId;
  }

  private configure(): void {
    if (this.configured) return;

    const clientId = this.clientId();
    auth.configure({
      providers: {
        [AuthProvider.GOOGLE]: {
          // The Web client ID is the audience Google puts in the ID token.
          clientId,
          // Android Credential Manager will not return an ID token without it.
          serverClientId: clientId,
          // Always show the account chooser instead of silently reusing an
          // account; users may want to switch between Google accounts.
          filterByAuthorizedAccounts: false,
          autoSelectEnabled: false,
        },
      },
      // Konek keeps its own session; do not persist a second auth state.
      persistence: "memory",
    });

    this.configured = true;
  }

  private async signInNative() {
    this.configure();
    return this.signInWithRetry();
  }

  /**
   * Credential Manager occasionally reports "no credentials" right after a
   * cancelled sheet even though the account exists. A single short-delay retry
   * re-opens the chooser instead of failing the whole sign-in.
   */
  private async signInWithRetry() {
    try {
      return await auth.signIn(AuthProvider.GOOGLE);
    } catch (error: any) {
      const message = String(error?.message ?? "");
      const noCredential =
        /no google account|no credentials|no credential available/i.test(message);

      console.error("Google Sign-In attempt failed:", {
        code: error?.code,
        message,
        details: error?.details,
      });

      if (!noCredential) throw error;

      await new Promise((resolve) => setTimeout(resolve, 400));
      return auth.signIn(AuthProvider.GOOGLE);
    }
  }

  /** Inject Google Identity Services once. */
  private loadGis(): Promise<void> {
    if (typeof document === "undefined") {
      return Promise.reject(new Error("Google Sign-In requires a browser."));
    }

    const existing = (window as unknown as { google?: any }).google;
    if (existing?.accounts?.id) return Promise.resolve();
    if (this.gisLoadPromise) return this.gisLoadPromise;

    this.gisLoadPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => {
        this.gisLoadPromise = null;
        reject(new Error("Could not load Google Sign-In. Check your connection."));
      };
      document.head.appendChild(script);
    });

    return this.gisLoadPromise;
  }
}
