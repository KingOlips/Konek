// Development environment
// `ng build` replaces this file with environment.prod.ts during production builds.

export const environment = {
  production: false,
  // Public HTTPS tunnel to the local XAMPP API (works from any network).
  // Quick tunnels get a new hostname every restart, so update this line and
  // rebuild when the tunnel is recreated.
  apiUrl: "https://aerospace-truck-gen-paragraph.trycloudflare.com/konek/backend/api",
};
