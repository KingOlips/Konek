export const environment = {
  production: true,
  // Android builds are made with the production configuration, so this URL must
  // be reachable from the phone. Served by Tailscale Funnel — permanent hostname
  // that survives reboots, so it never needs to be updated again.
  apiUrl: "https://yuji.tail58cd54.ts.net/konek/backend/api",
  // Google OAuth Client ID (configure in Google Cloud Console)
  // For production, add your Web Client ID from Google Cloud Console
  googleClientId: "YOUR_GOOGLE_CLIENT_ID",
};
