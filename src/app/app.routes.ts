import { Routes } from "@angular/router";
import { authGuard, guestGuard } from "./core/guards/auth.guard";

export const routes: Routes = [
  {
    path: "login",
    loadComponent: () =>
      import("./features/auth/login/login.page").then((m) => m.LoginPage),
    canActivate: [guestGuard],
  },
  {
    path: "register",
    loadComponent: () =>
      import("./features/auth/register/register.page").then((m) => m.RegisterPage),
    canActivate: [guestGuard],
  },
  {
    path: "forgot-password",
    loadComponent: () =>
      import("./features/auth/forgot-password/forgot-password.page").then((m) => m.ForgotPasswordPage),
    canActivate: [guestGuard],
  },
  {
    path: "reset-password",
    loadComponent: () =>
      import("./features/auth/reset-password/reset-password.page").then((m) => m.ResetPasswordPage),
    canActivate: [guestGuard],
  },
  {
    path: "map",
    loadComponent: () =>
      import("./features/map/map.page").then((m) => m.MapPage),
    canActivate: [authGuard],
  },
  {
    path: "squads",
    loadComponent: () =>
      import("./features/squads/squads.page").then((m) => m.SquadsPage),
    canActivate: [authGuard],
  },
  {
    path: "settings",
    loadComponent: () =>
      import("./features/settings/settings.page").then((m) => m.SettingsPage),
    canActivate: [authGuard],
  },
  {
    path: "",
    redirectTo: "map",
    pathMatch: "full",
  },
  {
    path: "**",
    redirectTo: "map",
  },
];
