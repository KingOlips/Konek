import { bootstrapApplication } from "@angular/platform-browser";
import {
  RouteReuseStrategy,
  provideRouter,
  withComponentInputBinding,
  withPreloading,
  PreloadAllModules,
} from "@angular/router";
import { provideHttpClient, withInterceptors, withInterceptorsFromDi } from "@angular/common/http";
import { IonicRouteStrategy, provideIonicAngular } from "@ionic/angular";

import { routes } from "./app/app.routes";
import { AppComponent } from "./app/app.component";
import { authExpiryInterceptor } from "./app/core/interceptors/auth-expiry.interceptor";

bootstrapApplication(AppComponent, {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    // Allow Ionic overlays (alert/toast/loading) to render the developer
    // HTML used in messages like the About dialog and the squad member list.
    // Ionic runs these through its allowlist sanitizer first.
    provideIonicAngular({ innerHTMLTemplatesEnabled: true }),
    provideRouter(routes, withPreloading(PreloadAllModules), withComponentInputBinding()),
    provideHttpClient(
      withInterceptorsFromDi(),
      withInterceptors([authExpiryInterceptor])
    ),
  ],
});
