import { Injectable } from "@angular/core";
import { Preferences } from "@capacitor/preferences";
import { NativeBiometric } from "capacitor-native-biometric";

export interface StoredCredentials {
  username: string;
  password: string;
}

/**
 * Biometric authentication + secure credential storage.
 *
 * Uses `capacitor-native-biometric` on device. On web (where the plugin is
 * unavailable) it degrades gracefully so the app remains usable in the browser.
 */
@Injectable({
  providedIn: "root",
})
export class BiometricService {
  private readonly BIOMETRIC_ENABLED_KEY = "konek_biometric_enabled";
  private readonly CREDENTIALS_KEY = "konek_biometric_credentials";
  private readonly CREDENTIAL_SERVER = "konek.app";

  /**
   * Check if biometric authentication is available on the device.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const result = await NativeBiometric.isAvailable({ useFallback: true });
      return result.isAvailable === true;
    } catch (error) {
      console.debug("Biometric auth not available:", error);
      return false;
    }
  }

  /**
   * Human-readable name of the biometric hardware (Face ID, Touch ID, Fingerprint...).
   */
  async getBiometricType(): Promise<string | null> {
    try {
      const result = await NativeBiometric.isAvailable({ useFallback: true });
      // biometryType: 0 = none, 1 = Touch ID, 2 = Face ID, 3 = Fingerprint, 4 = Face auth, 5 = Iris
      const map: Record<number, string> = {
        1: "Touch ID",
        2: "Face ID",
        3: "Fingerprint",
        4: "Face Unlock",
        5: "Iris",
      };
      return map[result.biometryType] ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Whether the user opted in to biometric login.
   */
  async isEnabled(): Promise<boolean> {
    const { value } = await Preferences.get({ key: this.BIOMETRIC_ENABLED_KEY });
    return value === "true";
  }

  async enable(): Promise<void> {
    await Preferences.set({ key: this.BIOMETRIC_ENABLED_KEY, value: "true" });
  }

  async disable(): Promise<void> {
    await Preferences.remove({ key: this.BIOMETRIC_ENABLED_KEY });
    await this.clearCredentials();
  }

  /**
   * Persist credentials for biometric re-login.
   * On device this goes into the OS keystore via the plugin; on web it falls
   * back to Preferences (acceptable for local development only).
   */
  async storeCredentials(username: string, password: string): Promise<void> {
    try {
      await NativeBiometric.setCredentials({
        username,
        password,
        server: this.CREDENTIAL_SERVER,
      });
    } catch (error) {
      console.debug("Native credential storage unavailable, using Preferences:", error);
      const credentials: StoredCredentials = { username, password };
      await Preferences.set({
        key: this.CREDENTIALS_KEY,
        value: JSON.stringify(credentials),
      });
    }
  }

  /**
   * Read credentials saved for biometric re-login.
   */
  async getCredentials(): Promise<StoredCredentials | null> {
    try {
      const creds = await NativeBiometric.getCredentials({
        server: this.CREDENTIAL_SERVER,
      });
      if (creds?.username && creds?.password) {
        return { username: creds.username, password: creds.password };
      }
    } catch (error) {
      console.debug("Native credential read failed, trying Preferences:", error);
    }

    const { value } = await Preferences.get({ key: this.CREDENTIALS_KEY });
    if (!value) return null;
    try {
      return JSON.parse(value) as StoredCredentials;
    } catch {
      return null;
    }
  }

  async clearCredentials(): Promise<void> {
    try {
      await NativeBiometric.deleteCredentials({ server: this.CREDENTIAL_SERVER });
    } catch {
      // Nothing stored natively - ignore.
    }
    await Preferences.remove({ key: this.CREDENTIALS_KEY });
  }

  /**
   * Prompt for Face ID / fingerprint verification.
   * @returns true when the user verified successfully.
   */
  async authenticate(reason = "Authenticate to access Konek"): Promise<boolean> {
    try {
      await NativeBiometric.verifyIdentity({
        reason,
        title: "Konek",
        subtitle: "Biometric verification required",
        description: "Use your fingerprint or Face ID to unlock the app",
      });
      return true;
    } catch (error) {
      console.error("Biometric authentication failed:", error);
      return false;
    }
  }
}
