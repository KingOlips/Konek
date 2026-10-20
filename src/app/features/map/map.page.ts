import {
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
  IonFabList,
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
} from "@ionic/angular";
import { addIcons } from "ionicons";
import {
  checkmarkCircleOutline,
  compassOutline,
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
  warningOutline,
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
    IonFabList,
    IonLabel,
    IonList,
    IonItem,
    IonAvatar,
    IonBadge,
    IonSpinner,
  ],
})
export class MapPage implements OnInit, OnDestroy {
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
  private lastUploadAt = 0;
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
  lastUpdate: Date | null = null;
  connectionStatus: "connected" | "connecting" | "disconnected" = "connecting";

  constructor() {
    addIcons({
      checkmarkCircleOutline,
      compassOutline,
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
      warningOutline,
    });
  }

  async ngOnInit(): Promise<void> {
    this.currentUser = this.authService.getCurrentUser();
    this.initMap();
    await this.setupLocationTracking();
    await this.geolocationService.startMotionTracking();
    this.startCompassUpdates();
    await this.loadSquadMembers();
    this.scheduleSquadPoll();
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
      await this.refreshSquadLocations();
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
      attributionControl: false,
    });

    this.tileLayers = {
      street: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      }),
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
    L.control.zoom({ position: "bottomright" }).addTo(this.map);
    L.control.scale({ position: "bottomleft", metric: true, imperial: false }).addTo(this.map);

    this.mapReady = true;
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

    this.lastUpdate = new Date(position.timestamp);
    this.updateUserMarker(latitude, longitude, accuracy ?? 0, headingDeg);
    if (!this.hasCentered) {
      this.map?.setView([latitude, longitude], 16, { animate: true });
      this.hasCentered = true;
    }
    this.cdr.markForCheck();

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
      <div class="marker-core">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="#3880ff">
          <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/>
        </svg>
      </div>
      <div class="marker-heading" style="transform: rotate(${heading}deg)"></div>`;

    const icon = L.divIcon({
      className: "user-marker",
      html,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });

    if (!this.userMarker) {
      this.userMarker = L.marker(latLng, { icon, zIndexOffset: 1000 })
        .addTo(this.map)
        .bindPopup("<b>You</b><br>Current location");
    } else {
      this.userMarker.setLatLng(latLng);
      this.userMarker.setIcon(icon);
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

  async refreshSquadLocations(): Promise<void> {
    this.isLoadingSquad = true;
    try {
      const members = await firstValueFrom(this.squadService.getSquadLocations());
      this.squadMembers = members;
      this.lastUpdate = new Date();
      this.updateSquadMarkers();
      this.cdr.markForCheck();
      this.checkGeofenceTransitions(members);
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
        existing.getPopup()?.setContent(popup);
        continue;
      }

      const icon = L.divIcon({
        className: "squad-marker",
        html: `
          <div class="marker-ring"></div>
          <div class="marker-core">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="#3880ff">
              <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-3.3 0-6 1.6-6 3.5V19h12v-1.5c0-1.9-2.7-3.5-6-3.5z"/>
            </svg>
          </div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });

      const marker = L.marker(latLng, { icon, zIndexOffset: 500 })
        .addTo(this.map)
        .bindPopup(popup);
      this.squadMarkers.set(id, marker);
    }
  }

  private memberPopup(member: SquadMemberLocation): string {
    return `
      <div class="member-popup">
        <strong>${member.username}</strong><br>
        <small>${member.role === "admin" ? "Admin" : "Member"}</small><br>
        <small>Last seen: ${this.getTimeAgo(new Date(member.timestamp))}</small>
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Geofences
  // ---------------------------------------------------------------------------

  private async loadGeofences(squadId: number): Promise<void> {
    try {
      this.geofences = (await firstValueFrom(
        this.squadService.getGeofences(squadId)
      )) as Geofence[];
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
      this.map.setView(this.userMarker.getLatLng(), 16, { animate: true });
    } else {
      void this.getInitialPosition();
    }
  }

  centerOnMember(member: SquadMemberLocation): void {
    this.map?.setView([member.latitude, member.longitude], 17, { animate: true });
    this.squadMarkers.get(String(member.user_id))?.openPopup();
    this.showSquadList = false;
  }

  changeMapStyle(style: MapStyle): void {
    if (!this.map || !this.tileLayers) return;
    Object.values(this.tileLayers).forEach((layer) => this.map?.removeLayer(layer));
    this.tileLayers[style].addTo(this.map);
    this.mapStyle = style;
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

  isStaleUpdate(): boolean {
    if (!this.lastUpdate) return true;
    return Date.now() - this.lastUpdate.getTime() > 60000;
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
