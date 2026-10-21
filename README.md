# Konek - Real-time Location Sharing App

An Android mobile application for real-time location sharing with squad members, built with Ionic Framework, Angular, Capacitor, and a PHP/MySQL backend.

## Features

- 🔐 **Authentication** - Secure login/register with bearer tokens
- 👥 **Squads** - Create/join squads with invite codes
- 📍 **Real-time Location** - Live location sharing on Leaflet.js map
- 🧭 **Compass & Heading** - Direction awareness on map
- 📱 **Biometric Auth** - Face ID / Fingerprint login
- 📊 **Location History** - Export as JSON/CSV
- 🔔 **Haptic Feedback** - Tactile responses for actions
- 🌙 **Dark Mode** - System-aware theme switching
- ⚡ **Adaptive GPS** - Battery-optimized location tracking

## Tech Stack

### Frontend
- **Ionic Framework 9** with **Angular 22** (Standalone Components only)
- **Capacitor 8** for native device access
- **Android** target (iOS not included yet)
- **Leaflet 1.9** + Esri World Street Map tiles for interactive maps (inverted in dark mode)
- **RxJS** for reactive state management

### Backend
- **PHP 8+** with **PDO** prepared statements
- **MySQL 8+ / MariaDB 10.4+** database
- **XAMPP** for local development

### Capacitor Plugins
- `@capacitor/preferences` - Token/user storage
- `@capacitor/geolocation` - GPS tracking
- `@capacitor/motion` - Accelerometer-driven adaptive polling
- `@capacitor/filesystem` - CSV/JSON export
- `@capacitor/haptics` - Vibration and haptic feedback
- `capacitor-native-biometric` - Face ID / fingerprint unlock
- `@capacitor/app`, `@capacitor/keyboard`, `@capacitor/status-bar` - Native UX

## Prerequisites

- Node.js 18+
- npm 9+
- XAMPP (Apache + MySQL)
- Android Studio (Android SDK + emulator or physical device)
- Ionic CLI: `npm install -g @ionic/cli`

## Quick Start

### 1. Database Setup

```bash
# Start XAMPP (Apache + MySQL)
# Import the database schema
mysql -u root < database/schema.sql
```

### 2. Backend Setup

Copy the backend into XAMPP's document root so it is reachable at
`http://localhost/konek/backend/api`:

```powershell
# Windows PowerShell
New-Item -ItemType Directory -Path C:\xampp\htdocs\konek -Force
Copy-Item -Path backend -Destination C:\xampp\htdocs\konek\ -Recurse -Force
```

### 3. Frontend Setup

```bash
# Install dependencies (Capacitor plugins are already declared)
npm install

# Start development server (http://localhost:8100)
npm start
# or
ionic serve
```

The API base URL lives in `src/environments/environment.ts`:

```ts
export const environment = {
  production: false,
  apiUrl: "http://localhost/konek/backend/api",
};
```

For a physical Android device, `localhost` points at the phone. Change
`apiUrl` to your computer's LAN IP (for example
`http://192.168.1.10/konek/backend/api`), make sure Apache accepts connections
on the LAN, and keep both devices on the same network.

### 4. Android Build

The `android/` project is already generated. iOS is not included yet; this
version targets Android only.

```bash
# Build the web app and copy it into the Android project
npm run build
npx cap sync android

# Open in Android Studio
npx cap open android
```

#### Device and emulator networking

- **Android emulator** - `localhost` points at the emulator itself. Use
  `http://10.0.2.2/konek/backend/api` in `src/environments/environment.ts`.
- **Physical device** - use your computer's LAN IP (e.g.
  `http://192.168.1.10/konek/backend/api`) and allow Apache through the firewall.

## Project Structure

```
Konek/
├── backend/
│   ├── api/
│   │   ├── api_login.php
│   │   ├── api_logout.php
│   │   ├── api_change_password.php
│   │   ├── api_register.php
│   │   ├── api_update_location.php
│   │   ├── api_get_squad_locations.php
│   │   ├── api_get_squads.php
│   │   ├── api_create_squad.php
│   │   ├── api_join_squad.php
│   │   ├── api_get_squad_members.php
│   │   ├── api_leave_squad.php
│   │   ├── api_update_member_role.php
│   │   ├── api_remove_member.php
│   │   ├── api_create_geofence.php
│   │   ├── api_get_geofences.php
│   │   └── api_delete_geofence.php
│   └── config/
│       ├── database.php
│       └── cors.php
├── database/
│   └── schema.sql
├── android/                  # Native Android project
├── src/
│   ├── app/
│   │   ├── core/
│   │   │   ├── services/
│   │   │   │   ├── auth.service.ts
│   │   │   │   ├── biometric.service.ts
│   │   │   │   ├── location.service.ts
│   │   │   │   ├── geolocation.service.ts
│   │   │   │   └── squad.service.ts
│   │   │   ├── guards/
│   │   │   │   └── auth.guard.ts
│   │   │   └── models/
│   │   │       └── location.models.ts
│   │   ├── features/
│   │   │   ├── auth/
│   │   │   │   ├── login/
│   │   │   │   └── register/
│   │   │   ├── map/
│   │   │   ├── squads/
│   │   │   └── settings/
│   │   ├── app.component.ts
│   │   ├── app.component.html
│   │   ├── app.component.scss
│   │   └── app.routes.ts
│   └── ...
├── capacitor.config.ts
├── ionic.config.json
└── package.json
```

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api_register.php` | Register new user |
| POST | `/api_login.php` | Login user |
| POST | `/api_logout.php` | Logout user |
| POST | `/api_change_password.php` | Change password (authenticated) |

### Location
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api_update_location.php` | Update user location |
| GET | `/api_get_squad_locations.php` | Get squad member locations |

### Squads
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api_get_squads.php` | Get user's squads |
| POST | `/api_create_squad.php` | Create new squad |
| POST | `/api_join_squad.php` | Join squad with code |
| GET | `/api_get_squad_members.php` | Get squad members |
| DELETE | `/api_leave_squad.php` | Leave squad |
| PUT | `/api_update_member_role.php` | Update member role |
| DELETE | `/api_remove_member.php` | Remove member |

### Geofences
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api_create_geofence.php` | Create geofence |
| GET | `/api_get_geofences.php` | Get squad geofences |
| DELETE | `/api_delete_geofence.php` | Delete geofence |

## API Configuration

Database credentials and the API base URL are configured in source:

- `backend/config/database.php` — XAMPP defaults (`root`, empty password, `konek_db`)
- `src/environments/environment.ts` — API base URL for development
- `src/environments/environment.prod.ts` — API base URL for production builds

CORS is handled by `backend/config/cors.php`. It allows `localhost` on any port,
`127.0.0.1`, private LAN ranges, and the Capacitor/ionic WebView origins, and it
answers `OPTIONS` preflight requests.

## Implementation Notes

- Angular 22 runs **zoneless**, so async updates call
  `ChangeDetectorRef.markForCheck()` after state changes; add this to any new
  async handler or the UI will not refresh.
- The accelerometer drives the upload/poll cadence: **5 s while moving** and
  **30 s while stationary** (map marker still updates on every GPS fix).
- Compass heading comes from `DeviceOrientationEvent`.
- Leaflet marker/popup styles live in `src/global.scss` because Leaflet creates
  that DOM outside Angular's component style encapsulation.

## Verified Setup

The following was tested end-to-end against XAMPP (Apache + MariaDB):

- Database import (5 tables: `users`, `squads`, `squad_members`, `locations`, `geofences`)
- Register → login → authenticated logout
- Change password (wrong current password rejected, new password works, old rejected)
- Create squad, join squad by code, fetch squads/members
- Update location and retrieve latest location per squad member
- Create/list geofences
- CORS preflight (`OPTIONS`) responded with the correct allow headers
- `npm run build` and `npx cap sync android` complete successfully
- Headless Edge smoke test: login page renders, authenticated session loads
  `/map` with "Live" status, live GPS fix uploaded to MySQL, two squad markers
  shown, and `/squads` + `/settings` render without console errors

## Security Notes

- Passwords hashed with Argon2id (`PASSWORD_ARGON2ID`)
- Opaque, cryptographically random API tokens (`random_bytes`)
- Prepared statements prevent SQL injection
- Bearer tokens invalidated on logout
- Biometric credentials stored in Android Keystore-backed secure storage
- CORS restricted to local development origins by default
- Native dev builds allow cleartext HTTP (`usesCleartextTraffic` on Android)
  so the XAMPP API works; use HTTPS and remove that allowance for production

## License

MIT License - feel free to use for personal or commercial projects.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request