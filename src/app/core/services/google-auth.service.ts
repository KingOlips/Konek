import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { environment } from "../../../environments/environment";
import { firstValueFrom } from "rxjs";
import { AuthService } from "./auth.service";

@Injectable({
  providedIn: "root",
})
export class GoogleAuthService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);

  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;

  /**
   * Initialize Google Sign-In on web platform.
   * On native (Capacitor), the plugin handles initialization.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = (async () => {
      try {
        // Check if we are on web and Google Identity Services is available
        if (typeof window !== "undefined" && (window as any).google?.accounts?.id) {
          const clientId = environment.googleClientId;
          if (!clientId) {
            console.warn("Google Client ID not configured");
            return;
          }

          (window as any).google.accounts.id.initialize({
            client_id: clientId,
            callback: (response: any) => this.handleCredentialResponse(response),
            auto_select: false,
            cancel_on_tap_outside: true,
          });
        }
      } catch (error) {
        console.error("Google Auth initialization failed:", error);
      } finally {
        this.isInitialized = true;
      }
    })();

    return this.initializationPromise;
  }

  /**
   * Sign in with Google using Capacitor plugin (native) or Google Identity Services (web).
   */
  async signIn(): Promise<string | null> {
    await this.initialize();

    try {
      // Try native Capacitor plugin first
      const { GoogleAuth } = await import("capacitor-auth-manager");
      
      const result = await GoogleAuth.signIn();
      
      if (result && result.idToken) {
        return result.idToken;
      }
      
      // Fallback to web Google Identity Services if no native plugin
      if (typeof window !== "undefined" && (window as any).google?.accounts?.id) {
        return new Promise((resolve, reject) => {
          (window as any).google.accounts.id.prompt((notification: any) => {
            if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
              reject(new Error("Google Sign-In cancelled or not displayed"));
            }
          });
          
          // The actual callback is set in initialize()
          // We need to wait for the callback to fire
        });
      }
      
      return null;
    } catch (error) {
      console.error("Google Sign-In failed:", error);
      throw error;
    }
  }

  /**
   * Handle the credential response from Google Identity Services (web).
   */
  private handleCredentialResponse(response: any): void {
    if (response.credential) {
      // Store the credential for retrieval
      (window as any).__googleCredential = response.credential;
    }
  }

  /**
   * Get the credential from the web callback.
   */
  async getWebCredential(): Promise<string | null> {
    if (typeof window !== "undefined" && (window as any).__googleCredential) {
      const credential = (window as any).__googleCredential;
      delete (window as any).__googleCredential;
      return credential;
    }
    return null;
  }

  /**
   * Sign in with Google and authenticate with backend.
   */
  async signInAndAuthenticate(): Promise<any> {
    let idToken: string | null = null;

    try {
      // Try native plugin first
      const { GoogleAuth } = await import("capacitor-auth-manager");
      const result = await GoogleAuth.signIn();
      
      if (result && result.idToken) {
        idToken = result.idToken;
      }
    } catch (nativeError) {
      console.log("Native Google Auth not available, trying web:", nativeError);
    }

    // If native failed, try web
    if (!idToken) {
      try {
        await this.initialize();
        idToken = await this.getWebCredential();
        
        if (!idToken) {
          // Prompt the user
          if (typeof window !== "undefined" && (window as any).google?.accounts?.id) {
            await new Promise<void>((resolve, reject) => {
              (window as any).google.accounts.id.prompt((notification: any) => {
                if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
                  reject(new Error("Google Sign-In cancelled"));
                }
              });
              
              // Wait for credential
              const checkCredential = setInterval(() => {
                if ((window as any).__googleCredential) {
                  clearInterval(checkCredential);
                  resolve();
                }
              }, 100);
              
              // Timeout after 60 seconds
              setTimeout(() => {
                clearInterval(checkCredential);
                reject(new Error("Google Sign-In timeout"));
              }, 60000);
            });
            
            idToken = (window as any).__googleCredential;
            delete (window as any).__googleCredential;
          }
        }
      } catch (webError) {
        console.error("Web Google Sign-In failed:", webError);
        throw webError;
      }
    }

    if (!idToken) {
      throw new Error("No ID token received from Google");
    }

    // Send ID token to backend for authentication
    return firstValueFrom(
      this.http.post(`${environment.apiUrl}/api_google_login.php`, { id_token: idToken })
    );
  }

  constructor() {}
}
