import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { Router, RouterLink } from "@angular/router";
import { firstValueFrom } from "rxjs";
import {
  ActionSheetController,
  AlertController,
  IonAvatar,
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonFab,
  IonFabButton,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonMenuButton,
  IonSpinner,
  IonTitle,
  IonToolbar,
  LoadingController,
  ToastController,
} from "@ionic/angular";
import { addIcons } from "ionicons";
import {
  checkmarkCircleOutline,
  downloadOutline,
  layersOutline,
  locateOutline,
  logOutOutline,
  mapOutline,
  peopleOutline,
  personAddOutline,
  personCircleOutline,
  refreshOutline,
  settingsOutline,
  timeOutline,
  trashOutline,
} from "ionicons/icons";
import * as L from "leaflet";
import type { Position } from "@capacitor/geolocation";

import { AuthService, User } from "../../core/services/auth.service";
import { LocationService } from "../../core/services/location.service";
import { GeolocationService } from "../../core/services/geolocation.service";
import { SquadService } from "../../core/services/squad.service";
import { Geofence, SquadMemberLocation } from "../../core/models/location.models";

type MapStyle = "street" | "satellite" | "hybrid";

@Component({
  selector: "app-map",
  templateUrl: "./map.page.html",
  styleUrls: ["./map.page.scss"],
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonButton,
    IonIcon,
    IonMenuButton,
    IonFab,
    IonFabButton,
    IonLabel,
    IonList,
    IonItem,
    IonAvatar,
    IonBadge,
    IonSpinner,
  ],
})
export class MapPage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild("mapContainer", { static: true })
  mapContainer!: ElementRef<HTMLDivElement>;

  private readonly authService = inject(AuthService);
  private readonly locationService = inject(LocationService);
  private readonly geolocationService = inject(GeolocationService);
  private readonly squadService = inject(SquadService);
  private readonly router = inject(Router);
  private readonly alertCtrl = inject(AlertController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly toastCtrl = inject(ToastController);
  private readonly cdr = inject(ChangeDetectorRef);

  private map: L.Map | null = null;
  private userMarker: L.Marker | null = null;
  private accuracyCircle: L.Circle | null = null;
  private squadMarkers = new Map<string, L.Marker>();
  private tileLayers: Record<MapStyle, L.TileLayer> | null = null;
  private geofenceLayers: L.Circle[] = [];
  private watchId: string | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private compassTimer: ReturnType<typeof setInterval> | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private sizeTimers: ReturnType<typeof setTimeout>[] = [];
  private lastUploadAt = 0;
  private lastToastAt = 0;
  private activeToast: HTMLIonToastElement | null = null;
  private isActive = true;
  private hasCentered = false;
  private geofences: Geofence[] = [];
  private insideGeofence = new Map<string, boolean>();
  private activeSquadId: number | null = null;

  currentUser: User | null = null;
  squadMembers: SquadMemberLocation[] = [];
  isTracking = false;
  mapStyle: MapStyle = "street";
  showSquadList = false;
  isLoadingSquad = false;
  mapReady = false;
  connectionStatus: "connected" | "connecting" | "disconnected" = "connecting";

  constructor() {
    addIcons({
      checkmarkCircleOutline,
      downloadOutline,
      layersOutline,
      locateOutline,
      logOutOutline,
      mapOutline,
      peopleOutline,
      personAddOutline,
      personCircleOutline,
      refreshOutline,
      settingsOutline,
      timeOutline,
      trashOutline,
    });
  }

  async ngOnInit(): Promise<void> {
    this.currentUser = this.authService.getCurrentUser();
    await this.setupLocationTracking();
    await this.geolocationService.startMotionTracking();
    this.startCompassUpdates();
    await this.loadSquadMembers();
    this.scheduleSquadPoll();
  }

  /**
   * Leaflet measures its container once when it is created. Creating the map in
   * ngOnInit ran before the Ionic page/menu layout settled, so it cached a tiny
   * size and only painted a single tile in the top-left corner. Create it once
   * the view exists, then invalidate whenever the container actually resizes.
   */
  ngAfterViewInit(): void {
    this.initMap();
    this.observeMapSize();
  }

  /** Rotate the heading arrow as the compass changes (between GPS fixes). */
  private startCompassUpdates(): void {
    this.compassTimer = setInterval(() => {
      const heading = this.geolocationService.getHeading();
      const arrow = this.mapContainer.nativeElement.querySelector(
        ".marker-heading"
      ) as HTMLElement | null;
      if (arrow) {
        arrow.style.transform = `rotate(${heading}deg)`;
      }
    }, 500);
  }

  /** Refresh the squad on the accelerometer-driven cadence (5s moving / 30s still). */
  private scheduleSquadPoll(): void {
    if (!this.isActive) return;
    const delay = this.geolocationService.getPollInterval();
    this.pollTimer = setTimeout(async () => {
      await this.refreshSquadLocations(false);
      this.scheduleSquadPoll();
    }, delay);
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  // ---------------------------------------------------------------------------
  // Map setup
  // ---------------------------------------------------------------------------

  private initMap(): void {
    const container = this.mapContainer.nativeElement;

    this.map = L.map(container, {
      center: [14.5995, 120.9842], // Manila fallback until GPS responds
      zoom: 14,
      zoomControl: false,
      attributionControl: false, // replaced with a compact custom control below
      zoomAnimation: true,
      fadeAnimation: true,
      markerZoomAnimation: true,
    });

    this.tileLayers = {
      street: this.createStreetLayer(),
      satellite: L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, attribution: "Tiles &copy; Esri" }
      ),
      hybrid: L.tileLayer("https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", {
        maxZoom: 20,
        subdomains: ["mt0", "mt1", "mt2", "mt3"],
        attribution: "&copy; Google",
      }),
    };

    this.tileLayers[this.mapStyle].addTo(this.map);

    // Keep the zoom buttons clear of the recenter FAB (bottom-right).
    L.control.zoom({ position: "topleft" }).addTo(this.map);
    L.control.scale({ position: "bottomleft", metric: true, imperial: false }).addTo(this.map);
    L.control.attribution({ position: "bottomleft", prefix: false }).addTo(this.map);

    // Follow the app theme: Settings toggles body.dark, so watch the class.
    this.themeObserver = new MutationObserver(() => this.applyTileTheme());
    this.themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    this.applyTileTheme();

    this.mapReady = true;
  }

  /** Clean, retina-less but crisp street basemap. No API key required. */
  private createStreetLayer(): L.TileLayer {
    return L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 19,
        attribution:
          'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &middot; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors',
      }
    );
  }

  /** Invert the basemap in dark mode (tiles themselves have no dark variant). */
  private applyTileTheme(): void {
    const dark = document.body.classList.contains("dark");
    this.mapContainer.nativeElement.classList.toggle(
      "map-dark-tiles",
      dark && this.mapStyle === "street"
    );
  }

  /** Keep Leaflet's cached size in sync with the real container size. */
  private observeMapSize(): void {
    const element = this.mapContainer.nativeElement;

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.refreshMapSize());
      this.resizeObserver.observe(element);
    }

    // Ionic's route transition, toolbar settle and web-font load can all change
    // the container size a few frames after the first measurement.
    requestAnimationFrame(() => this.refreshMapSize());
    this.sizeTimers.push(
      setTimeout(() => this.refreshMapSize(), 250),
      setTimeout(() => this.refreshMapSize(), 750)
    );

    window.addEventListener("resize", this.onWindowResize);
    window.addEventListener("orientationchange", this.onWindowResize);
  }

  private readonly onWindowResize = (): void => this.refreshMapSize();

  /** Re-measure the container; Leaflet only reflows tiles on invalidateSize(). */
  private refreshMapSize(): void {
    if (!this.map || !this.mapContainer.nativeElement.isConnected) return;
    this.map.invalidateSize({ animate: false });
  }

  private async setupLocationTracking(): Promise<void> {
    try {
      const granted = await this.geolocationService.requestPermissions();
      if (!granted) {
        this.connectionStatus = "disconnected";
        this.cdr.markForCheck();
        await this.showAlert("Location permission is required to use the map.");
        return;
      }

      this.watchId = await this.geolocationService.watchPosition(
        (position) => this.onPositionUpdate(position),
        () => {
          this.connectionStatus = "disconnected";
          this.cdr.markForCheck();
        }
      );
      this.isTracking = true;
      this.connectionStatus = "connected";
      this.cdr.markForCheck();
      await this.getInitialPosition();
    } catch (error) {
      console.error("Location tracking failed:", error);
      this.connectionStatus = "disconnected";
      this.cdr.markForCheck();
    }
  }

  private async getInitialPosition(): Promise<void> {
    try {
      const position = await this.geolocationService.getCurrentPosition();
      this.onPositionUpdate(position);
    } catch (error) {
      console.debug("Initial fix unavailable:", error);
    }
  }

  private onPositionUpdate(position: Position): void {
    const { latitude, longitude, accuracy, altitude, speed, heading } = position.coords;
    const headingDeg = heading ?? this.geolocationService.getHeading();

    this.updateUserMarker(latitude, longitude, accuracy ?? 0, headingDeg);
    if (!this.hasCentered && this.map) {
      this.map.setView([latitude, longitude], 16, { animate: true });
      this.hasCentered = true;
    }
    this.cdr.markForCheck();

    // Confirm the fix with a top toast, at most once every 30s so tracking
    // does not turn into a notification stream.
    if (Date.now() - this.lastToastAt > 30000) {
      this.lastToastAt = Date.now();
      void this.showUpdateToast("Updated just now");
    }

    // Throttle uploads/history to the adaptive cadence: 5s while moving,
    // 30s while stationary. The map marker itself still updates on every fix.
    const now = Date.now();
    if (now - this.lastUploadAt < this.geolocationService.getPollInterval()) {
      return;
    }
    this.lastUploadAt = now;

    this.locationService
      .updateLocation({
        latitude,
        longitude,
        accuracy: accuracy ?? undefined,
        altitude: altitude ?? undefined,
        speed: speed ?? undefined,
        heading: headingDeg || undefined,
      })
      .subscribe({
        next: () => {
          this.connectionStatus = "connected";
          this.cdr.markForCheck();
        },
        error: () => {
          this.connectionStatus = "disconnected";
          this.cdr.markForCheck();
        },
      });

    if (this.currentUser) {
      void this.locationService.addToHistory({
        id: now,
        user_id: this.currentUser.id,
        latitude,
        longitude,
        accuracy: accuracy ?? undefined,
        altitude: altitude ?? undefined,
        speed: speed ?? undefined,
        heading: headingDeg || undefined,
        timestamp: new Date(position.timestamp).toISOString(),
      });
    }
  }

  private updateUserMarker(
    lat: number,
    lng: number,
    accuracy: number,
    heading: number
  ): void {
    if (!this.map) return;
    const latLng = L.latLng(lat, lng);

    const html = `
      <div class="marker-pulse"></div>
      <div class="marker-halo"></div>
      <div class="marker-core">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/>
        </svg>
      </div>
      <div class="marker-heading" style="transform: rotate(${heading}deg)"></div>`;

    const icon = L.divIcon({
      className: "user-marker",
      html,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
      popupAnchor: [0, -22],
    });

    if (!this.userMarker) {
      this.userMarker = L.marker(latLng, { icon, zIndexOffset: 1000 })
        .addTo(this.map)
        .bindPopup(this.selfPopup(accuracy));
    } else {
      this.userMarker.setLatLng(latLng);
      this.userMarker.setIcon(icon);
      this.userMarker.getPopup()?.setContent(this.selfPopup(accuracy));
    }


    if (accuracy > 0) {
      if (!this.accuracyCircle) {
        this.accuracyCircle = L.circle(latLng, {
          radius: accuracy,
          color: "#3880ff",
          fillColor: "#3880ff",
          fillOpacity: 0.08,
          weight: 1,
          dashArray: "5 5",
        }).addTo(this.map);
      } else {
        this.accuracyCircle.setLatLng(latLng).setRadius(accuracy);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Squad data
  // ---------------------------------------------------------------------------

  private async loadSquadMembers(): Promise<void> {
    this.isLoadingSquad = true;
    try {
      const members = await firstValueFrom(this.squadService.getSquadLocations());
      this.squadMembers = members;
      this.updateSquadMarkers();
      this.cdr.markForCheck();

      this.activeSquadId = members[0]?.squad_id ?? null;
      if (this.activeSquadId) {
        await this.loadGeofences(this.activeSquadId);
      }
    } catch (error) {
      console.error("Failed to load squad members:", error);
    } finally {
      this.isLoadingSquad = false;
      this.cdr.markForCheck();
    }
  }

  /**
   * Pull the latest squad positions. The background poll passes `false` so an
   * automatic refresh stays silent; user-initiated refreshes get a toast.
   */
  async refreshSquadLocations(notify = true): Promise<void> {
    this.isLoadingSquad = true;
    try {
      const members = await firstValueFrom(this.squadService.getSquadLocations());
      this.squadMembers = members;
      this.updateSquadMarkers();
      this.cdr.markForCheck();
      this.checkGeofenceTransitions(members);
      if (notify) {
        this.lastToastAt = Date.now();
        void this.showUpdateToast("Squad locations refreshed");
      }
    } catch (error) {
      console.error("Failed to refresh squad locations:", error);
    } finally {
      this.isLoadingSquad = false;
      this.cdr.markForCheck();
    }
  }

  private updateSquadMarkers(): void {
    if (!this.map) return;

    const present = new Set(this.squadMembers.map((m) => String(m.user_id)));
    for (const [id, marker] of this.squadMarkers) {
      if (!present.has(id)) {
        this.map.removeLayer(marker);
        this.squadMarkers.delete(id);
      }
    }

    for (const member of this.squadMembers) {
      if (member.user_id === this.currentUser?.id) continue; // skip self

      const id = String(member.user_id);
      const latLng = L.latLng(member.latitude, member.longitude);
      const popup = this.memberPopup(member);

      const existing = this.squadMarkers.get(id);
      if (existing) {
        existing.setLatLng(latLng);
        existing.setIcon(this.squadIcon(member));
        existing.getPopup()?.setContent(popup);
        continue;
      }

      const marker = L.marker(latLng, {
        icon: this.squadIcon(member),
        zIndexOffset: 500,
      })
        .addTo(this.map)
        .bindPopup(popup);
      this.squadMarkers.set(id, marker);
    }
  }

  /** Avatar-style marker: initials, role colour and a live dot. */
  private squadIcon(member: SquadMemberLocation): L.DivIcon {
    const online = this.isMemberOnline(member);
    const admin = member.role === "admin";
    return L.divIcon({
      className: `squad-marker${admin ? " is-admin" : ""}`,
      html: `
        <div class="marker-ring"></div>
        <div class="marker-core"><span>${this.initialsOf(member.username)}</span></div>
        ${online ? '<div class="marker-status"></div>' : ""}`,
      iconSize: [38, 38],
      iconAnchor: [19, 19],
      popupAnchor: [0, -20],
    });
  }

  private initialsOf(username: string | undefined): string {
    const name = (username ?? "").trim();
    if (!name) return "?";
    return this.escapeHtml(name.charAt(0).toUpperCase());
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  private selfPopup(accuracy: number): string {
    const accuracyText = accuracy > 0 ? ` &plusmn;${Math.round(accuracy)} m` : "";
    return `
      <div class="konek-popup">
        <div class="popup-avatar is-self">You</div>
        <div class="popup-body">
          <strong>${this.escapeHtml(this.currentUser?.username ?? "You")}</strong>
          <div class="popup-meta">
            <span class="popup-dot is-online"></span>
            <span>Sharing live</span>
          </div>
          <small class="popup-sub">GPS accuracy${accuracyText}</small>
        </div>
      </div>`;
  }

  private memberPopup(member: SquadMemberLocation): string {
    const online = this.isMemberOnline(member);
    const role = member.role === "admin" ? "Admin" : "Member";
    return `
      <div class="konek-popup">
        <div class="popup-avatar${member.role === "admin" ? " is-admin" : ""}">
          ${this.initialsOf(member.username)}
        </div>
        <div class="popup-body">
          <strong>${this.escapeHtml(member.username)}</strong>
          <div class="popup-meta">
            <span class="popup-role">${role}</span>
            <span class="popup-dot${online ? " is-online" : ""}"></span>
            <span>${online ? "Online" : "Offline"}</span>
          </div>
          <small class="popup-sub">Last seen ${this.getTimeAgo(new Date(member.timestamp))}</small>
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Geofences
  // ---------------------------------------------------------------------------

  private async loadGeofences(squadId: number): Promise<void> {
    try {
      this.geofences = await firstValueFrom(
        this.squadService.getGeofences(squadId)
      );
      this.renderGeofences();
      this.checkGeofenceTransitions(this.squadMembers);
    } catch (error) {
      console.debug("No geofences available:", error);
    }
  }

  private renderGeofences(): void {
    if (!this.map) return;
    this.geofenceLayers.forEach((layer) => this.map?.removeLayer(layer));
    this.geofenceLayers = this.geofences.map((fence) =>
      L.circle([fence.latitude, fence.longitude], {
        radius: fence.radius_meters,
        color: "#2dd36f",
        fillColor: "#2dd36f",
        fillOpacity: 0.05,
        weight: 1,
        dashArray: "4 6",
      })
        .addTo(this.map!)
        .bindPopup(`<b>${fence.name}</b><br>${fence.radius_meters}m radius`)
    );
  }

  private checkGeofenceTransitions(members: SquadMemberLocation[]): void {
    for (const fence of this.geofences) {
      for (const member of members) {
        const key = `${fence.id}:${member.user_id}`;
        const inside =
          this.geolocationService.calculateDistance(
            member.latitude,
            member.longitude,
            fence.latitude,
            fence.longitude
          ) <= fence.radius_meters;

        const wasInside = this.insideGeofence.get(key) ?? false;
        if (inside && !wasInside) {
          void this.vibrate();
        }
        this.insideGeofence.set(key, inside);
      }
    }
  }

  private async vibrate(): Promise<void> {
    try {
      const { Haptics, NotificationType } = await import("@capacitor/haptics");
      await Haptics.notification({ type: NotificationType.Warning });
    } catch {
      // Haptics unavailable on web.
    }
  }

  // ---------------------------------------------------------------------------
  // UI actions
  // ---------------------------------------------------------------------------

  centerOnUser(): void {
    if (this.userMarker && this.map) {
      this.map.flyTo(this.userMarker.getLatLng(), Math.max(this.map.getZoom(), 16), {
        duration: 0.6,
      });
    } else {
      void this.getInitialPosition();
    }
  }

  centerOnMember(member: SquadMemberLocation): void {
    this.map?.flyTo([member.latitude, member.longitude], 17, { duration: 0.6 });
    this.squadMarkers.get(String(member.user_id))?.openPopup();
    this.showSquadList = false;
  }

  changeMapStyle(style: MapStyle): void {
    if (!this.map || !this.tileLayers) return;
    Object.values(this.tileLayers).forEach((layer) => this.map?.removeLayer(layer));
    this.tileLayers[style].addTo(this.map);
    this.mapStyle = style;
    this.applyTileTheme();
  }

  async presentMapStyleSheet(): Promise<void> {
    const sheet = await this.actionSheetCtrl.create({
      header: "Map style",
      buttons: [
        { text: "Street", handler: () => this.changeMapStyle("street") },
        { text: "Satellite", handler: () => this.changeMapStyle("satellite") },
        { text: "Hybrid", handler: () => this.changeMapStyle("hybrid") },
        { text: "Cancel", role: "cancel" },
      ],
    });
    await sheet.present();
  }

  async presentMoreSheet(): Promise<void> {
    const sheet = await this.actionSheetCtrl.create({
      header: "Konek",
      buttons: [
        {
          text: "Settings",
          icon: "settings-outline",
          handler: () => void this.router.navigate(["/settings"]),
        },
        {
          text: "Export history",
          icon: "download-outline",
          handler: () => void this.exportLocationHistory(),
        },
        {
          text: "Clear history",
          icon: "trash-outline",
          handler: () => void this.clearLocationHistory(),
        },
        {
          text: "Sign out",
          icon: "log-out-outline",
          role: "destructive",
          handler: () => void this.logout(),
        },
        { text: "Cancel", role: "cancel" },
      ],
    });
    await sheet.present();
  }

  toggleSquadList(): void {
    this.showSquadList = !this.showSquadList;
  }

  async exportLocationHistory(): Promise<void> {
    const sheet = await this.actionSheetCtrl.create({
      header: "Export location history",
      buttons: [
        { text: "JSON", handler: () => void this.doExport("json") },
        { text: "CSV", handler: () => void this.doExport("csv") },
        { text: "Cancel", role: "cancel" },
      ],
    });
    await sheet.present();
  }

  private async doExport(format: "json" | "csv"): Promise<void> {
    const loading = await this.loadingCtrl.create({ message: "Preparing export..." });
    await loading.present();
    try {
      const data = await this.locationService.exportHistory();
      if (!data) {
        await loading.dismiss();
        await this.showAlert("No location history to export yet.");
        return;
      }

      if (format === "csv") {
        await this.geolocationService.exportTextToFile(
          this.locationService.toCsv(data.locations),
          "konek-location-history.csv",
          "text/csv"
        );
      } else {
        await this.geolocationService.exportToFile(data, "konek-location-history.json");
      }

      await loading.dismiss();
      await this.showAlert(`Location history exported as ${format.toUpperCase()}.`);
    } catch (error) {
      await loading.dismiss();
      console.error("Export failed:", error);
      await this.showAlert("Failed to export location history.");
    }
  }

  async clearLocationHistory(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: "Clear history?",
      message: "All locally stored location points will be deleted.",
      buttons: [
        { text: "Cancel", role: "cancel" },
        {
          text: "Clear",
          role: "destructive",
          handler: async () => {
            await this.locationService.clearHistory();
            await this.showAlert("Location history cleared.");
          },
        },
      ],
    });
    await alert.present();
  }

  async logout(): Promise<void> {
    const loading = await this.loadingCtrl.create({ message: "Signing out..." });
    await loading.present();
    try {
      await firstValueFrom(this.authService.logout());
    } catch (error) {
      console.debug("Server logout failed; local session cleared.", error);
    } finally {
      await loading.dismiss();
      await this.router.navigate(["/login"], { replaceUrl: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers used by the template
  // ---------------------------------------------------------------------------

  /** Transient top-of-screen confirmation, replacing the old map pill. */
  private async showUpdateToast(message: string): Promise<void> {
    try {
      if (this.activeToast) {
        await this.activeToast.dismiss();
        this.activeToast = null;
      }
      this.activeToast = await this.toastCtrl.create({
        message,
        icon: "checkmark-circle-outline",
        duration: 2200,
        position: "top",
        cssClass: "update-toast",
      });
      await this.activeToast.present();
    } catch {
      // Toasts are cosmetic: never let one break location tracking.
    }
  }

  isMemberOnline(member: SquadMemberLocation): boolean {
    return Date.now() - new Date(member.timestamp).getTime() < 120000;
  }

  getTimeAgo(date: Date | string): string {
    const d = typeof date === "string" ? new Date(date) : date;
    const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  private async showAlert(message: string): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: "Konek",
      message,
      buttons: ["OK"],
    });
    await alert.present();
  }

  private cleanup(): void {
    if (this.watchId) {
      void this.geolocationService.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.isActive = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.compassTimer) {
      clearInterval(this.compassTimer);
      this.compassTimer = null;
    }
    void this.geolocationService.stopMotionTracking();

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.themeObserver?.disconnect();
    this.themeObserver = null;
    this.sizeTimers.forEach((timer) => clearTimeout(timer));
    this.sizeTimers = [];
    window.removeEventListener("resize", this.onWindowResize);
    window.removeEventListener("orientationchange", this.onWindowResize);

    if (this.map) {
      this.squadMarkers.forEach((marker) => this.map?.removeLayer(marker));
      this.geofenceLayers.forEach((layer) => this.map?.removeLayer(layer));
      this.map.remove();
      this.map = null;
    }
    this.squadMarkers.clear();
    this.geofenceLayers = [];
    this.mapReady = false;
  }
}
