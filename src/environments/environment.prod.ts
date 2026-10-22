export const environment = {
  production: true,
  // Android builds are made with the production configuration, so this URL must
  // be reachable from the phone. A quick Cloudflare tunnel gets a new hostname
  // on every restart: update this line (and environment.ts) when it changes.
  apiUrl: "https://tiny-discretion-deck-walnut.trycloudflare.com/konek/backend/api",
  // Google OAuth Client ID (configure in Google Cloud Console)
  // For production, add your Web Client ID from Google Cloud Console
  googleClientId: "YOUR_GOOGLE_CLIENT_ID",
};
