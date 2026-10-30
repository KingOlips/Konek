// Development environment
// `ng build` replaces this file with environment.prod.ts during production builds.

export const environment = {
  production: false,
  // Public HTTPS URL to the local XAMPP API (works from any network).
  // Served by Tailscale Funnel — this hostname is permanent and survives
  // reboots, so it never needs to be updated again.
  apiUrl: "https://yuji.tail58cd54.ts.net/konek/backend/api",
  // Google OAuth Client ID (configure in Google Cloud Console)
  // For development, add your Web Client ID from Google Cloud Console
  googleClientId: "YOUR_GOOGLE_CLIENT_ID",
};
