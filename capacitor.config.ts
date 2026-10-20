import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.konek.app",
  appName: "Konek",
  webDir: "www",
  server: {
    // Allows calling the local XAMPP API over plain HTTP during development.
    androidScheme: "https",
    cleartext: true,
  },
};

export default config;
