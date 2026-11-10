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
import { RouterLink } from "@angular/router";
import { firstValueFrom } from "rxjs";
import {
  ActionSheetController,
  AlertController,
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonFab,
  IonFabButton,
  IonHeader,
  IonIcon,
  IonSpinner,
  IonTitle,
  IonToolbar,
  LoadingController,
  ModalController,
  PopoverController,
  ToastController,
} from "@ionic/angular";
import { addIcons } from "ionicons";
import {
  arrowBackOutline,
  batteryChargingOutline,
  batteryDeadOutline,
  batteryFullOutline,
  batteryHalfOutline,
  chatbubblesOutline,
  checkmarkCircleOutline,
  chevronDownOutline,
  closeOutline,
  copyOutline,
  layersOutline,
  locateOutline,
  logOutOutline,
  navigateOutline,
  peopleOutline,
  personAddOutline,
  personCircleOutline,
  personOutline,
  refreshOutline,
  settingsOutline,
  shareSocialOutline,
  shieldCheckmarkOutline,
  timeOutline,
} from "ionicons/icons";
import * as L from "leaflet";
import type { Position } from "@capacitor/geolocation";

import { AuthService, User } from "../../core/services/auth.service";
import { BackgroundTrackerService } from "../../core/services/background-tracker.service";
import { BatteryService } from "../../core/services/battery.service";
import { LocationService } from "../../core/services/location.service";
import { GeolocationService } from "../../core/services/geolocation.service";
import { SquadService } from "../../core/services/squad.service";
import { Geofence, SquadMemberLocation } from "../../core/models/location.models";
import { Squad } from "../../core/models/squad.models";
import {
  SquadMenuPopoverComponent,
  SquadMenuResult,
} from "./squad-menu-popover/squad-menu-popover.component";

type MapStyle = "street" | "satellite" | "hybrid";
type SheetSnap = "peek" | "half" | "full";

/** Last map viewport persisted to localStorage. */
interface StoredMapView {
  lat: number;
  lng: number;
  zoom: number;
  timestamp: number;
}
type PingType =
  | "whats_up"
  | "on_my_way"
  | "where_you_at"
  | "meet_here"
  | "almost_there"
  | "leaving_now"
  | "need_help"
  | "coffee"
  | "custom";

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
    IonFab,
    IonFabButton,
    IonBadge,
    IonSpinner,
  ],
})
export class MapPage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild("mapContainer", { static: true })
  mapContainer!: ElementRef<HTMLDivElement>;

  @ViewChild("squadPanel")
  squadPanel?: ElementRef<HTMLDivElement>;

  @ViewChild("memberPanel")
  memberPanel?: ElementRef<HTMLDivElement>;

  // `<ion-fab>` is an Ionic component, so the ref defaults to the component
  // instance; read the ElementRef explicitly.
  @ViewChild("mapFabs", { read: ElementRef })
  mapFabs?: ElementRef<HTMLElement>;

  private readonly authService = inject(AuthService);
  private readonly backgroundTracker = inject(BackgroundTrackerService);
  private readonly batteryService = inject(BatteryService);
  private readonly locationService = inject(LocationService);
  private readonly geolocationService = inject(GeolocationService);
  private readonly squadService = inject(SquadService);
  private readonly alertCtrl = inject(AlertController);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly modalCtrl = inject(ModalController);
  private readonly popoverCtrl = inject(PopoverController);
  private readonly toastCtrl = inject(ToastController);
  private readonly cdr = inject(ChangeDetectorRef);

  private map: L.Map | null = null;
  private userMarker: L.Marker | null = null;
  private accuracyCircle: L.Circle | null = null;
  private squadMarkers = new Map<string, L.Marker>();
  private tileLayers: Record<MapStyle, L.TileLayer> | null = null;
  private streetFallback: L.TileLayer | null = null;
  private readonly tileErrorCounts: Record<MapStyle, number> = {
    street: 0,
    satellite: 0,
    hybrid: 0,
  };
  private geofenceLayers: L.Circle[] = [];
  private watchId: string | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private compassTimer: ReturnType<typeof setInterval> | null = null;
  /** Continuous beam rotation in unwrapped degrees (tracks past 0Â°/360Â°). */
  private headingDeg = 0;
  private resizeObserver: ResizeObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private sizeTimers: ReturnType<typeof setTimeout>[] = [];
  private lastUploadAt = 0;
  private activeToast: HTMLIonToastElement | null = null;
  private isActive = true;
  private hasCentered = false;
  private geofences: Geofence[] = [];
  private insideGeofence = new Map<string, boolean>();
  private activeSquadId: number | null = null;
  /** Last known name of the active squad, kept for the instant chip label. */
  private activeSquadNameCache: string | null = null;
  /** True once the squad list has been fetched at least once. */
  private squadsLoaded = false;
  /** In-flight squad list fetch shared by every caller. */
  private squadsLoadPromise: Promise<void> | null = null;
  private selectedMember: SquadMemberLocation | null = null;

  /** localStorage entry remembering which squad the user was viewing. */
  private static readonly ACTIVE_SQUAD_KEY = "konek_active_squad";

  /** Last map viewport, so the map reopens where the user left it. */
  private static readonly LAST_VIEW_KEY = "konek_last_map_center";
  /** Ignore a stored viewport older than this (milliseconds). */
  private static readonly LAST_VIEW_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  private static readonly DEFAULT_LAT = 14.5995;
  private static readonly DEFAULT_LNG = 120.9842;
  private static readonly DEFAULT_ZOOM = 14;

  /** True when the initial viewport came from localStorage, not the fallback. */
  private restoredMapView = false;

  /** Mobile bottom-sheet snap state. Ignored on desktop. */
  squadSheetSnap: "peek" | "half" | "full" = "peek";
  isSheetDragging = false;
  /** True while a drag has pulled the sheet above the half point (near/full). */
  sheetNearFull = false;
  private sheetDragStartY = 0;
  private sheetDragStartOffset = 0;
  private sheetCurrentOffset = 0;
  private sheetDragMoved = false;

  /** Friend detail bottom sheet (shown for any selected marker). */
  memberSheetSnap: SheetSnap = "half";
  isMemberSheetDragging = false;
  private memberDragStartY = 0;
  private memberDragStartOffset = 0;
  private memberCurrentOffset = 0;
  private memberDragMoved = false;
  private previousSquadListOpen = false;
  private previousSquadSnap: SheetSnap = "peek";

  readonly pingOptions: ReadonlyArray<{
    type: PingType;
    label: string;
    danger?: boolean;
  }> = [
    { type: "whats_up", label: "What's up?" },
    { type: "on_my_way", label: "On my way" },
    { type: "where_you_at", label: "Where you at?" },
    { type: "meet_here", label: "Meet here" },
    { type: "almost_there", label: "Almost there" },
    { type: "leaving_now", label: "Leaving now" },
    { type: "need_help", label: "Need help", danger: true },
    { type: "coffee", label: "Coffee?" },
    { type: "custom", label: "Customâ€¦" },
  ];

  currentUser: User | null = null;
  squadMembers: SquadMemberLocation[] = [];
  squads: Squad[] = [];
  isTracking = false;
  mapStyle: MapStyle = "street";
  showSquadList = false;
  /** True while the create/join squad modal is on screen. */
  isSquadFormModalOpen = false;
  /** True when the mobile squad sheet is at (or near) its full snap. */
  toolbarHidden = false;
  isLoadingSquad = false;
  mapReady = false;
  connectionStatus: "connected" | "connecting" | "disconnected" = "connecting";
  /** GPS accuracy (metres) of the user's latest fix, for the self sheet. */
  lastAccuracy: number | null = null;
  /** ISO timestamp of the user's latest fix, for the self sheet. */
  lastFixAt: string | null = null;
  detailSheetOpen = false;
  selectedIsSelf = false;
  isRefreshingDetail = false;
  /** True while the toolbar chip is expanded under its dropdown. */
  squadChipOpen = false;

  constructor() {
    addIcons({
      arrowBackOutline,
      batteryChargingOutline,
      batteryDeadOutline,
      batteryFullOutline,
      batteryHalfOutline,
      chatbubblesOutline,
      checkmarkCircleOutline,
      chevronDownOutline,
      closeOutline,
      copyOutline,
      layersOutline,
      locateOutline,
      logOutOutline,
      navigateOutline,
      peopleOutline,
      personAddOutline,
      personCircleOutline,
      personOutline,
      refreshOutline,
      settingsOutline,
      shareSocialOutline,
      shieldCheckmarkOutline,
      timeOutline,
    });
  }

  async ngOnInit(): Promise<void> {
    this.currentUser = this.authService.getCurrentUser();
    // Restore the last viewed squad before the first render so the toolbar
    // chip shows its name immediately instead of a placeholder.
    this.restoreActiveSquad();
    // Wait for the first battery read so the first uploaded fix includes it.
    await this.batteryService.init();
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
    this.applySheetSnap();
    this.applyMemberSheetSnap();
  }

  /**
   * Sweep the flashlight beam as the compass changes (between GPS fixes).
   * The angle is unwrapped so passing north (359Â° -> 1Â°) continues forward
   * instead of spinning almost a full turn backwards.
   */
  private startCompassUpdates(): void {
    this.compassTimer = setInterval(() => {
      const heading = this.geolocationService.getHeading();
      const arrow = this.mapContainer.nativeElement.querySelector(
        ".marker-heading"
      ) as HTMLElement | null;
      if (!arrow) return;

      const delta = (((heading - (this.headingDeg % 360)) % 360) + 540) % 360 - 180;
      this.headingDeg += delta;
      arrow.style.transform = `rotate(${this.headingDeg}deg)`;
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
    const storedView = this.readStoredMapView();
    this.restoredMapView = storedView !== null;
    const initialCenter: L.LatLngExpression = storedView
      ? [storedView.lat, storedView.lng]
      : [MapPage.DEFAULT_LAT, MapPage.DEFAULT_LNG];

    this.map = L.map(container, {
      center: initialCenter,
      zoom: storedView?.zoom ?? MapPage.DEFAULT_ZOOM,
      zoomControl: false,
      attributionControl: false, // replaced with a compact custom control below
      zoomAnimation: true,
      fadeAnimation: true,
      markerZoomAnimation: true,
      // Keep the viewport on the map instead of letting the world tiles repeat.
      maxBounds: L.latLngBounds([-85, -180], [85, 180]),
      maxBoundsViscosity: 1.0,
    });

    // Remember every pan/zoom so the next visit starts here instead of Manila.
    this.map.on("moveend", this.onMapMoveEnd);

    this.tileLayers = {
      street: this.createStreetLayer(),
      satellite: this.createSatelliteLayer(),
      hybrid: this.createHybridLayer(),
    };

    this.tileLayers[this.mapStyle].addTo(this.map);

    // Zoom buttons are desktop-only; phones zoom by pinch and double-tap.
    // The scale bar and attribution are not shown on either layout.
    if (!this.isMobileLayout()) {
      L.control.zoom({ position: "topleft" }).addTo(this.map);
    }

    // Follow the app theme: Settings toggles body.dark, so watch the class.
    this.themeObserver = new MutationObserver(() => this.applyTileTheme());
    this.themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    this.applyTileTheme();

    this.mapReady = true;
  }

  private readonly onMapMoveEnd = (): void => this.persistMapView();

  /** Save the current viewport for the next visit. */
  private persistMapView(): void {
    if (!this.map) return;
    const center = this.map.getCenter();
    this.persistMapViewAt(center.lat, center.lng, this.map.getZoom());
  }

  private persistMapViewAt(lat: number, lng: number, zoom: number): void {
    const view: StoredMapView = { lat, lng, zoom, timestamp: Date.now() };
    try {
      localStorage.setItem(MapPage.LAST_VIEW_KEY, JSON.stringify(view));
    } catch {
      // localStorage may be unavailable in private mode.
    }
  }

  /** Read a recent viewport; invalid or stale data falls back to Manila. */
  private readStoredMapView(): StoredMapView | null {
    try {
      const raw = localStorage.getItem(MapPage.LAST_VIEW_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<StoredMapView> | null;
      if (!parsed) return null;

      const { lat, lng, zoom, timestamp } = parsed;
      if (
        typeof lat !== "number" ||
        typeof lng !== "number" ||
        typeof zoom !== "number" ||
        typeof timestamp !== "number" ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        !Number.isFinite(zoom) ||
        !Number.isFinite(timestamp) ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180 ||
        zoom < 1 ||
        zoom > 20
      ) {
        return null;
      }

      if (Date.now() - timestamp > MapPage.LAST_VIEW_MAX_AGE_MS) return null;
      return { lat, lng, zoom, timestamp };
    } catch {
      return null;
    }
  }

  /** Clean, crisp street basemap. No API key required. */
  private createStreetLayer(): L.TileLayer {
    const layer = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 19,
        // Esri has no street detail past ~z17 in many regions: it answers with
        // tiles reading "Map data not yet available". Capping the native zoom
        // makes Leaflet upscale the last real tile instead of requesting those.
        maxNativeZoom: 17,
        // Never draw the world twice when the viewport is wider than a world.
        noWrap: true,
        attribution:
          'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &middot; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors',
      }
    );
    this.watchTileErrors(layer, "street");
    return layer;
  }

  private createSatelliteLayer(): L.TileLayer {
    const layer = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 19,
        // Imagery coverage is uneven; z18 is the safe ceiling worldwide.
        maxNativeZoom: 18,
        noWrap: true,
        attribution: "Tiles &copy; Esri",
      }
    );
    this.watchTileErrors(layer, "satellite");
    return layer;
  }

  private createHybridLayer(): L.TileLayer {
    const layer = L.tileLayer("https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", {
      maxZoom: 20,
      subdomains: ["mt0", "mt1", "mt2", "mt3"],
      noWrap: true,
      attribution: "&copy; Google",
    });
    this.watchTileErrors(layer, "hybrid");
    return layer;
  }

  /**
   * When a tile provider keeps failing (offline CDN, blocked host, missing
   * coverage), fall back to OpenStreetMap so panning never leaves a blank
   * "map data not yet available" grid behind.
   */
  private watchTileErrors(layer: L.TileLayer, style: MapStyle): void {
    layer.on("tileerror", () => {
      if (!this.map || this.mapStyle !== style) return;
      if (style !== "street" || this.streetFallback) return;

      this.tileErrorCounts.street += 1;
      if (this.tileErrorCounts.street < 4) return;

      this.switchToOsmFallback();
    });
  }

  private switchToOsmFallback(): void {
    if (!this.map || !this.tileLayers || this.streetFallback) return;

    this.map.removeLayer(this.tileLayers.street);
    const fallback = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      noWrap: true,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    });
    this.streetFallback = fallback;
    this.tileLayers.street = fallback;
    fallback.addTo(this.map);
    this.applyTileTheme();
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
    this.syncMapMinZoom();
    if (!this.isSheetDragging) {
      this.applySheetSnap();
    }
    if (this.detailSheetOpen && !this.isMemberSheetDragging) {
      this.applyMemberSheetSnap();
    }
  }

  /**
   * Keep the world at least as large as the map viewport. Without this the
   * lowest zooms leave empty gray space beside the single un-wrapped world.
   * Zoom 0 is 256px wide and every level doubles it, so the smallest zoom
   * that still covers the viewport is ceil(log2(longestSide / 256)).
   */
  private syncMapMinZoom(): void {
    if (!this.map) return;
    const size = this.map.getSize();
    const longestSide = Math.max(size.x, size.y);
    if (!longestSide) return;

    const minZoom = Math.max(0, Math.ceil(Math.log2(longestSide / 256)));
    if (this.map.getMinZoom() !== minZoom) {
      this.map.setMinZoom(minZoom);
    }
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

      // Keep uploading location + battery after the app is backgrounded or
      // swiped away. Android-only; no-op on web/iOS. Respect the Settings
      // toggle when the user has turned tracking off.
      if (this.backgroundTrackingEnabled()) {
        void this.backgroundTracker.start(10000);
      }

      await this.getInitialPosition();
    } catch (error) {
      console.error("Location tracking failed:", error);
      this.connectionStatus = "disconnected";
      this.cdr.markForCheck();
    }
  }

  /** Settings toggle: "Location tracking" defaults to enabled. */
  private backgroundTrackingEnabled(): boolean {
    try {
      return localStorage.getItem("konek_location_tracking") !== "false";
    } catch {
      return true;
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
    this.lastAccuracy = accuracy ?? null;
    this.lastFixAt = new Date(position.timestamp).toISOString();

    this.updateUserMarker(latitude, longitude, accuracy ?? 0, headingDeg);
    if (!this.hasCentered && this.map) {
      // Preserve the user's restored zoom; otherwise use street level so the
      // first fix is immediately useful.
      const zoom = this.restoredMapView ? Math.max(this.map.getZoom(), 14) : 16;
      this.map.setView([latitude, longitude], zoom, { animate: true });
      this.hasCentered = true;
      this.restoredMapView = false;
      // `moveend` fires after the animation; write now too so closing the app
      // mid-animation still reopens at the right place.
      this.persistMapViewAt(latitude, longitude, zoom);
    }
    this.cdr.markForCheck();

    // Throttle uploads/history to the adaptive cadence: 5s while moving,
    // 30s while stationary. The map marker itself still updates on every fix.
    const now = Date.now();
    if (now - this.lastUploadAt < this.geolocationService.getPollInterval()) {
      return;
    }
    this.lastUploadAt = now;

    const battery = this.batteryService.getBatteryInfo();
    this.locationService
      .updateLocation({
        latitude,
        longitude,
        accuracy: accuracy ?? undefined,
        altitude: altitude ?? undefined,
        speed: speed ?? undefined,
        heading: headingDeg || undefined,
        battery_level: battery.level ?? undefined,
        is_charging: battery.charging ?? undefined,
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
    });

    if (!this.userMarker) {
      this.userMarker = L.marker(latLng, { icon, zIndexOffset: 1000 })
        .addTo(this.map)
        .on("click", () => {
          this.openSelfDetail();
          this.centerOnUser();
        });
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

  /**
   * Fetch the user's squads and keep the active selection valid. When the
   * active squad no longer exists (left from the Squads page), fall back to
   * the first one so the map always points at a real squad.
   */
  private async loadSquads(): Promise<void> {
    if (this.squadsLoadPromise) {
      return this.squadsLoadPromise;
    }
    this.squadsLoadPromise = this.fetchSquads().finally(() => {
      this.squadsLoadPromise = null;
    });
    return this.squadsLoadPromise;
  }

  /** Fetch squads and keep the active selection valid. */
  private async fetchSquads(): Promise<void> {
    try {
      const squads = await firstValueFrom(this.squadService.getUserSquads());
      this.squads = squads ?? [];
      if (!this.squads.some((squad) => squad.id === this.activeSquadId)) {
        this.activeSquadId = this.squads[0]?.id ?? null;
      }
      const active = this.squads.find((squad) => squad.id === this.activeSquadId);
      this.activeSquadNameCache = active?.squad_name ?? null;
      this.squadsLoaded = true;
      if (active) {
        this.persistActiveSquad();
      } else {
        this.clearStoredSquad();
      }
      this.cdr.markForCheck();
    } catch (error) {
      console.error("Failed to load squads:", error);
    }
  }

  /** Reinstate the squad chosen in a previous session (survives a refresh). */
  private restoreActiveSquad(): void {
    try {
      const raw = localStorage.getItem(MapPage.ACTIVE_SQUAD_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as { id?: unknown; name?: unknown };
      if (typeof stored.id === "number" && typeof stored.name === "string") {
        this.activeSquadId = stored.id;
        this.activeSquadNameCache = stored.name;
      }
    } catch {
      // Corrupt or unavailable storage: fall back to the first squad.
    }
  }

  /** Remember the active squad so a refresh opens on the same one. */
  private persistActiveSquad(name?: string): void {
    const id = this.activeSquadId;
    if (id === null) return;
    const resolved =
      name ??
      this.squads.find((squad) => squad.id === id)?.squad_name ??
      this.activeSquadNameCache;
    if (!resolved) return;
    this.activeSquadNameCache = resolved;
    try {
      localStorage.setItem(
        MapPage.ACTIVE_SQUAD_KEY,
        JSON.stringify({ id, name: resolved })
      );
    } catch {
      // localStorage may be unavailable in private mode.
    }
  }

  /** Distance (metres) from current user to a given member. */
  private memberDistance(member: SquadMemberLocation): number | null {
    const me = this.userMarker?.getLatLng();
    if (!me) return null;
    return this.geolocationService.calculateDistance(
      me.lat,
      me.lng,
      member.latitude,
      member.longitude
    );
  }

  /** Formatted distance label for a member. */
  memberDistanceLabel(member: SquadMemberLocation): string {
    const d = this.memberDistance(member);
    if (d === null) return "â€”";
    if (d < 1000) return `${Math.round(d)} m`;
    return `${(d / 1000).toFixed(1)} km`;
  }

  /** Initials for avatar (same logic as map markers). */
  memberInitials(username: string): string {
    const parts = (username ?? "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    const first = parts[0].charAt(0);
    const second = parts.length > 1 ? parts[1].charAt(0) : "";
    return (first + second).toUpperCase();
  }

  /** Soft gradient per username so every avatar feels personal, not random. */
  avatarGradient(username: string): string {
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ["#6366f1", "#8b5cf6"], // indigo -> violet
      ["#3b82f6", "#06b6d4"], // blue -> cyan
      ["#10b981", "#34d399"], // emerald
      ["#f59e0b", "#fbbf24"], // amber
      ["#f43f5e", "#fb7185"], // rose
      ["#8b5cf6", "#d946ef"], // violet -> fuchsia
      ["#14b8a6", "#2dd4bf"], // teal
      ["#0ea5e9", "#38bdf8"], // sky
    ];
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    const [from, to] = pairs[Math.abs(hash) % pairs.length];
    return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;
  }

  /** Members sharing right now (seen within the last two minutes). */
  get onlineMembers(): SquadMemberLocation[] {
    return this.squadMembers.filter((m) => this.isMemberOnline(m));
  }

  /** Members not sharing, most recently seen first. */
  get offlineMembers(): SquadMemberLocation[] {
    return this.squadMembers
      .filter((m) => !this.isMemberOnline(m))
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
  }

  /** One-line status under a member's name. */
  memberSubLabel(member: SquadMemberLocation): string {
    const online = this.isMemberOnline(member);
    if (member.user_id === this.currentUser?.id) {
      return online
        ? "Sharing live"
        : `Last seen ${this.getTimeAgo(member.timestamp)}`;
    }
    if (!online) return `Last seen ${this.getTimeAgo(member.timestamp)}`;
    const distance = this.memberDistance(member);
    if (distance === null) return "Online";
    if (distance < 30) return "Right here";
    return `${this.memberDistanceLabel(member)} away`;
  }

  /** Convenience: online members count. */
  get onlineCount(): number {
    return this.squadMembers.filter((m) => this.isMemberOnline(m)).length;
  }

  private clearStoredSquad(): void {
    try {
      localStorage.removeItem(MapPage.ACTIVE_SQUAD_KEY);
    } catch {
      // localStorage may be unavailable in private mode.
    }
  }

  /**
   * Load the member locations for the active squad. `refreshSquads` is false
   * when the caller already fetched the squad list (switching or opening the
   * dropdown), so a switch costs a single locations request.
   */
  private async loadSquadMembers(refreshSquads = true): Promise<void> {
    this.isLoadingSquad = true;
    try {
      if (refreshSquads) {
        await this.loadSquads();
      }
      const members = await firstValueFrom(
        this.squadService.getSquadLocations(this.activeSquadId ?? undefined)
      );
      this.squadMembers = members;
      this.updateSquadMarkers();
      this.cdr.markForCheck();

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
      const members = await firstValueFrom(
        this.squadService.getSquadLocations(this.activeSquadId ?? undefined)
      );
      this.squadMembers = members;
      this.updateSquadMarkers();
      this.cdr.markForCheck();
      this.checkGeofenceTransitions(members);
      if (notify) {
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

      const existing = this.squadMarkers.get(id);
      if (existing) {
        existing.setLatLng(latLng);
        existing.setIcon(this.squadIcon(member));
        continue;
      }

      const marker = L.marker(latLng, {
        icon: this.squadIcon(member),
        zIndexOffset: 500,
      })
        .addTo(this.map)
        .on("click", () => this.openMemberDetail(member.user_id));
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
    this.closeSquadPanel();
  }

  // ---------------------------------------------------------------------------
  // Member detail sheet (tap on a marker or squad member)
  // ---------------------------------------------------------------------------

  /**
   * Remember what the squad list was doing so the back button can restore it:
   * the sidebar on desktop, the current snap point on mobile.
   */
  private rememberSquadPanelState(): void {
    this.previousSquadListOpen = this.isMobileLayout()
      ? this.squadSheetSnap !== "peek"
      : this.showSquadList;
    this.previousSquadSnap = this.squadSheetSnap;
  }

  openMemberDetail(userId: number): void {
    const member = this.squadMembers.find((m) => m.user_id === userId);
    if (!member) return;
    // Tapping your own row opens the self sheet: no ping chips, no directions.
    if (member.user_id === this.currentUser?.id) {
      this.openSelfDetail();
      return;
    }
    this.rememberSquadPanelState();
    this.selectedMember = member;
    this.selectedIsSelf = false;
    this.detailSheetOpen = true;
    this.memberSheetSnap = "half";
    this.closeSquadPanel();
    // Leaflet click handlers run outside Angular's change detection
    // (zoneless app), so schedule a render for the sheet state change.
    this.cdr.markForCheck();
    requestAnimationFrame(() => this.applyMemberSheetSnap());
    // Bring the map to the tapped person while the sheet slides up.
    this.centerOnMember(member);
  }

  openSelfDetail(): void {
    this.rememberSquadPanelState();
    this.selectedMember = null;
    this.selectedIsSelf = true;
    this.detailSheetOpen = true;
    this.memberSheetSnap = "half";
    this.closeSquadPanel();
    this.cdr.markForCheck();
    requestAnimationFrame(() => this.applyMemberSheetSnap());
  }

  closeDetailSheet(): void {
    this.detailSheetOpen = false;
    this.selectedMember = null;
    this.selectedIsSelf = false;
    this.memberSheetSnap = "peek";
    this.memberPanel?.nativeElement.style.removeProperty("transform");

    // Back returns to the squad list if it was open when the friend was tapped.
    if (this.previousSquadListOpen) {
      if (this.isMobileLayout()) {
        this.setSheetSnap(this.previousSquadSnap);
      } else {
        this.showSquadList = true;
      }
    }
    this.previousSquadListOpen = false;
    // Bring the squad sheet back out of hiding (mobile) and re-sync the FABs.
    this.applySheetSnap();
    this.cdr.markForCheck();
  }

  /** Refresh the selected friend's position (or the user's own fix). */
  async refreshDetail(): Promise<void> {
    if (this.isRefreshingDetail) return;
    this.isRefreshingDetail = true;
    this.cdr.markForCheck();
    try {
      if (this.selectedIsSelf) {
        await this.getInitialPosition();
      } else {
        await this.refreshSquadLocations(false);
      }
      void this.showUpdateToast("Location refreshed");
    } finally {
      this.isRefreshingDetail = false;
      this.cdr.markForCheck();
    }
  }

  onPing(type: PingType): void {
    if (type === "custom") {
      void this.openCustomPing();
      return;
    }
    this.pingMember(type);
  }

  /**
   * Send a quick ping. The recipient's app turns this into a vibration; this
   * side only sends the signal, so nothing happens on the sender's device.
   */
  pingMember(type: PingType, customText?: string): void {
    const member = this.liveSelectedMember;
    if (!member) return;
    // TODO: call the push/ping endpoint once it exists.
    console.log("Ping", type, customText ?? "", "to", member.user_id);
    void this.showUpdateToast(`Ping sent to ${member.username}`);
  }

  async openCustomPing(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: "Custom ping",
      inputs: [
        {
          name: "text",
          type: "text",
          placeholder: "Message",
          attributes: { maxlength: 120 },
        },
      ],
      buttons: [
        { text: "Cancel", role: "cancel" },
        {
          text: "Send",
          handler: (data) => {
            const text = String(data.text ?? "").trim();
            if (!text) return false;
            this.pingMember("custom", text);
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  /** The selected member kept in sync with the latest squad poll. */
  get liveSelectedMember(): SquadMemberLocation | null {
    const selected = this.selectedMember;
    if (!selected) return null;
    return (
      this.squadMembers.find((m) => m.user_id === selected.user_id) ?? selected
    );
  }

  /** Distance in metres between the user and the selected member. */
  get selectedDistanceMeters(): number | null {
    const member = this.liveSelectedMember;
    const origin = this.userMarker?.getLatLng();
    if (!member || !origin) return null;
    return this.geolocationService.calculateDistance(
      origin.lat,
      origin.lng,
      member.latitude,
      member.longitude
    );
  }

  // ---------------------------------------------------------------------------
  // Member sheet display helpers
  // ---------------------------------------------------------------------------

  get detailTitle(): string {
    if (this.selectedIsSelf) return this.currentUser?.username || "Your location";
    return this.liveSelectedMember?.username ?? "Squad member";
  }

  get detailInitials(): string {
    if (this.selectedIsSelf) return "You";
    const name = (this.liveSelectedMember?.username ?? "").trim();
    if (!name) return "?";
    const parts = name.split(/[\s._-]+/).filter(Boolean);
    return (parts.length > 1
      ? parts[0][0] + parts[1][0]
      : name.slice(0, 2)
    ).toUpperCase();
  }

  get detailRoleLabel(): string {
    return this.liveSelectedMember?.role === "admin" ? "Admin" : "Member";
  }

  get detailIsAdmin(): boolean {
    return this.liveSelectedMember?.role === "admin";
  }

  get detailStatusLabel(): string {
    if (this.selectedIsSelf) {
      return this.isTracking ? "Sharing live" : "Not sharing";
    }
    return this.detailStatusOnline ? "Online" : "Offline";
  }

  get detailStatusOnline(): boolean {
    if (this.selectedIsSelf) return this.isTracking;
    const member = this.liveSelectedMember;
    return member ? this.isMemberOnline(member) : false;
  }

  get detailLastUpdateLabel(): string {
    const stamp = this.selectedIsSelf
      ? this.lastFixAt
      : this.liveSelectedMember?.timestamp ?? null;
    if (!stamp) return "Waiting for a fix";
    return this.getTimeAgo(stamp);
  }

  get detailAccuracyLabel(): string {
    return this.lastAccuracy && this.lastAccuracy > 0
      ? `Â±${Math.round(this.lastAccuracy)} m`
      : "â€”";
  }

  get detailDistanceLabel(): string {
    const meters = this.selectedDistanceMeters;
    if (meters === null || meters === undefined) return "â€”";
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  }

  get detailHasBattery(): boolean {
    const level = this.liveSelectedMember?.battery_level;
    return level !== null && level !== undefined;
  }

  get detailBatteryLabel(): string {
    if (!this.detailHasBattery) return "Not available";
    const member = this.liveSelectedMember;
    return member?.is_charging
      ? `${member.battery_level}% Â· charging`
      : `${member?.battery_level}%`;
  }

  get detailBatteryIcon(): string {
    if (this.liveSelectedMember?.is_charging) return "battery-charging-outline";
    const level = this.liveSelectedMember?.battery_level ?? null;
    if (level === null) return "battery-dead-outline";
    if (level >= 80) return "battery-full-outline";
    if (level >= 30) return "battery-half-outline";
    return "battery-dead-outline";
  }

  centerOnSelection(): void {
    if (this.selectedIsSelf) {
      this.centerOnUser();
    } else {
      const member = this.liveSelectedMember;
      if (member) this.centerOnMember(member);
    }
    // Keep the detail available but drop it to its peek height so the map shows.
    this.setMemberSheetSnap("peek");
  }

  openDirections(): void {
    const member = this.liveSelectedMember;
    if (!member) return;
    const destination = `${member.latitude},${member.longitude}`;
    window.open(
      `https://www.google.com/maps/dir/?api=1&destination=${destination}`,
      "_blank",
      "noopener"
    );
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

  toggleSquadList(): void {
    // The two sheets are mutually exclusive: the friend detail owns the edge.
    if (this.detailSheetOpen) return;
    if (this.isMobileLayout()) {
      this.setSheetSnap(this.squadSheetSnap === "peek" ? "half" : "peek");
      return;
    }
    this.showSquadList = !this.showSquadList;
  }

  // ---------------------------------------------------------------------------
  // Mobile squad bottom sheet
  // ---------------------------------------------------------------------------

  private isMobileLayout(): boolean {
    return window.matchMedia("(max-width: 767px)").matches;
  }

  /**
   * Distance (px) the sheet must be pushed down for a snap point. `peek` leaves
   * just the grabber and header visible; `half` shows half of the map content
   * area; `full` pins the sheet to the top of the content area.
   */
  private sheetOffsetFor(snap: "peek" | "half" | "full"): number {
    const panel = this.squadPanel?.nativeElement;
    if (!panel) return 0;
    if (snap === "full") return 0;

    const height = panel.getBoundingClientRect().height;
    const containerHeight =
      panel.parentElement?.clientHeight ?? window.innerHeight;
    const visible =
      snap === "half" ? containerHeight * 0.5 : this.sheetPeekHeight();
    return Math.max(0, height - visible);
  }

  /** Peek height comes from CSS so the FAB/Leaflet offsets stay in sync. */
  private sheetPeekHeight(): number {
    const panel = this.squadPanel?.nativeElement;
    if (!panel) return 82;
    const value = parseFloat(
      getComputedStyle(panel).getPropertyValue("--squad-peek-height")
    );
    return Number.isFinite(value) ? value : 82;
  }

  private applySheetSnap(): void {
    const panel = this.squadPanel?.nativeElement;
    if (!panel) return;

    if (!this.isMobileLayout()) {
      // Desktop uses the right-hand sidebar transition, not a transform.
      panel.style.transform = "";
      this.setToolbarHidden(false);
      this.syncFabPosition(0);
      return;
    }

    // The squad sheet yields the bottom edge while the friend detail is open.
    if (this.detailSheetOpen) {
      panel.style.transform = "translateY(100%)";
      this.setToolbarHidden(false);
      this.syncFabPosition(0);
      return;
    }

    const offset = this.sheetOffsetFor(this.squadSheetSnap);
    panel.style.transform = `translateY(${offset}px)`;
    // The sheet owns the whole screen at full height: let the toolbar slide
    // away so the squad list gets an unobstructed view.
    this.setToolbarHidden(this.squadSheetSnap === "full");
    this.syncFabPosition(offset);
  }

  /** Toggle the floating toolbar while the squad sheet is dragged. */
  private setToolbarHidden(hidden: boolean): void {
    if (this.toolbarHidden === hidden) return;
    this.toolbarHidden = hidden;
    this.cdr.markForCheck();
  }

  /**
   * Keep the map action stack glued 14px above the squad sheet's top edge so
   * it rides along while the sheet is dragged and stays there after a snap.
   * The stack never climbs past the floating toolbar.
   */
  private syncFabPosition(panelOffset: number): void {
    const fabs = this.mapFabs?.nativeElement;
    const panel = this.squadPanel?.nativeElement;
    if (!fabs || !panel) return;

    if (!this.isMobileLayout()) {
      fabs.style.removeProperty("transform");
      return;
    }

    const panelHeight = panel.getBoundingClientRect().height;
    const visible = Math.max(0, panelHeight - panelOffset);
    const travel = Math.max(0, visible - this.sheetPeekHeight());

    // Cap the climb so the stack stays clear of the floating toolbar.
    const containerHeight =
      panel.parentElement?.clientHeight ?? window.innerHeight;
    const baseBottom = parseFloat(getComputedStyle(fabs).bottom) || 0;
    const stackHeight = fabs.getBoundingClientRect().height;
    const topInset =
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--ion-safe-area-top"
        )
      ) || 0;
    const maxBottom = containerHeight - topInset - 68 - stackHeight;
    const capped = Math.min(travel, Math.max(0, maxBottom - baseBottom));

    fabs.style.transform = capped > 0.5 ? `translateY(${-capped}px)` : "";
  }

  onSheetDragStart(event: PointerEvent): void {
    if (!this.isMobileLayout() || event.button > 0) return;
    if (this.detailSheetOpen) return;

    const target = event.target as HTMLElement;
    if (target.closest("ion-button, ion-item, a")) return;

    const panel = this.squadPanel?.nativeElement;
    if (!panel) return;

    if (this.isSheetDragging) {
      this.endSheetDrag();
    }

    this.sheetDragStartY = event.clientY;
    this.sheetDragStartOffset = this.sheetOffsetFor(this.squadSheetSnap);
    this.sheetCurrentOffset = this.sheetDragStartOffset;
    this.sheetDragMoved = false;
    this.isSheetDragging = true;
    panel.classList.add("dragging");
    // The action stack follows the sheet frame-by-frame, so no easing.
    this.mapFabs?.nativeElement.classList.add("dragging");

    window.addEventListener("pointermove", this.onSheetPointerMove, {
      passive: false,
    });
    window.addEventListener("pointerup", this.onSheetPointerEnd);
    window.addEventListener("pointercancel", this.onSheetPointerEnd);
  }

  private readonly onSheetPointerMove = (event: PointerEvent): void => {
    if (!this.isSheetDragging) return;
    const panel = this.squadPanel?.nativeElement;
    if (!panel) return;

    const delta = event.clientY - this.sheetDragStartY;
    if (Math.abs(delta) > 4) {
      this.sheetDragMoved = true;
    }

    const min = this.sheetOffsetFor("full");
    const max = this.sheetOffsetFor("peek");
    this.sheetCurrentOffset = Math.min(
      max,
      Math.max(min, this.sheetDragStartOffset + delta)
    );
    panel.style.transform = `translateY(${this.sheetCurrentOffset}px)`;
    // Any real drag dismisses the toolbar so the sheet can travel freely; it
    // returns after the sheet settles (unless it landed at full height).
    if (this.sheetDragMoved) {
      this.setToolbarHidden(true);
      event.preventDefault();
    }
    const halfOffset = this.sheetOffsetFor("half");
    const nearFull = this.sheetCurrentOffset < halfOffset;
    if (nearFull !== this.sheetNearFull) {
      this.sheetNearFull = nearFull;
      this.cdr.markForCheck();
    }
    this.syncFabPosition(this.sheetCurrentOffset);
  };

  private readonly onSheetPointerEnd = (): void => {
    if (!this.isSheetDragging) return;
    this.endSheetDrag();

    const snaps: Array<"peek" | "half" | "full"> = ["full", "half", "peek"];
    const nearest = snaps.reduce((best, snap) =>
      Math.abs(this.sheetOffsetFor(snap) - this.sheetCurrentOffset) <
      Math.abs(this.sheetOffsetFor(best) - this.sheetCurrentOffset)
        ? snap
        : best
    );

    this.setSheetSnap(nearest);
  };

  private endSheetDrag(): void {
    this.isSheetDragging = false;
    this.sheetNearFull = false;
    this.squadPanel?.nativeElement.classList.remove("dragging");
    this.mapFabs?.nativeElement.classList.remove("dragging");
    window.removeEventListener("pointermove", this.onSheetPointerMove);
    window.removeEventListener("pointerup", this.onSheetPointerEnd);
    window.removeEventListener("pointercancel", this.onSheetPointerEnd);
  }

  /**
   * Tap the grabber to toggle the sheet between peek and half: one tap opens
   * the panel, the next closes it. A drag never counts as a tap.
   */
  onSheetGrabberClick(): void {
    if (!this.isMobileLayout() || this.detailSheetOpen) return;
    if (this.sheetDragMoved) {
      // The click that follows a drag should not also change the snap.
      this.sheetDragMoved = false;
      return;
    }
    this.setSheetSnap(this.squadSheetSnap === "peek" ? "half" : "peek");
  }

  /** Tapping the sheet header (outside its buttons) expands it like the grabber. */
  onSheetHeaderClick(event: MouseEvent): void {
    if (this.detailSheetOpen) return;
    if (
      (event.target as HTMLElement).closest("ion-button, ion-item, a, button")
    ) {
      return;
    }
    this.onSheetGrabberClick();
  }

  private setSheetSnap(snap: "peek" | "half" | "full"): void {
    this.squadSheetSnap = snap;
    this.applySheetSnap();
    this.cdr.markForCheck();
  }

  closeSquadPanel(): void {
    if (this.isMobileLayout()) {
      this.setSheetSnap("peek");
    } else {
      this.showSquadList = false;
      this.cdr.markForCheck();
    }
  }

  // ---------------------------------------------------------------------------
  // Member detail bottom sheet
  // ---------------------------------------------------------------------------

  /** Offset (px) from the sheet's open position for a snap point. */
  private memberSheetOffsetFor(snap: SheetSnap): number {
    const panel = this.memberPanel?.nativeElement;
    if (!panel) return 0;
    if (snap === "full") return 0;

    const height = panel.getBoundingClientRect().height;
    const containerHeight =
      panel.parentElement?.clientHeight ?? window.innerHeight;
    const visible =
      snap === "half" ? containerHeight * 0.5 : this.memberPeekHeight();
    return Math.max(0, height - visible);
  }

  private memberPeekHeight(): number {
    const panel = this.memberPanel?.nativeElement;
    if (!panel) return 82;
    const value = parseFloat(
      getComputedStyle(panel).getPropertyValue("--member-peek-height")
    );
    return Number.isFinite(value) ? value : 82;
  }

  private applyMemberSheetSnap(): void {
    if (!this.detailSheetOpen) return;
    const panel = this.memberPanel?.nativeElement;
    if (!panel) return;
    panel.style.transform = `translateY(${this.memberSheetOffsetFor(
      this.memberSheetSnap
    )}px)`;
  }

  onMemberSheetDragStart(event: PointerEvent): void {
    if (!this.detailSheetOpen || event.button > 0) return;

    const panel = this.memberPanel?.nativeElement;
    if (!panel) return;

    if (this.isMemberSheetDragging) {
      this.endMemberSheetDrag();
    }

    this.memberDragStartY = event.clientY;
    this.memberDragStartOffset = this.memberSheetOffsetFor(this.memberSheetSnap);
    this.memberCurrentOffset = this.memberDragStartOffset;
    this.memberDragMoved = false;
    this.isMemberSheetDragging = true;
    panel.classList.add("dragging");

    window.addEventListener("pointermove", this.onMemberSheetPointerMove, {
      passive: false,
    });
    window.addEventListener("pointerup", this.onMemberSheetPointerEnd);
    window.addEventListener("pointercancel", this.onMemberSheetPointerEnd);
  }

  private readonly onMemberSheetPointerMove = (event: PointerEvent): void => {
    if (!this.isMemberSheetDragging) return;
    const panel = this.memberPanel?.nativeElement;
    if (!panel) return;

    const delta = event.clientY - this.memberDragStartY;
    if (Math.abs(delta) > 4) {
      this.memberDragMoved = true;
    }

    const min = this.memberSheetOffsetFor("full");
    const max = this.memberSheetOffsetFor("peek");
    this.memberCurrentOffset = Math.min(
      max,
      Math.max(min, this.memberDragStartOffset + delta)
    );
    panel.style.transform = `translateY(${this.memberCurrentOffset}px)`;

    if (this.memberDragMoved) {
      event.preventDefault();
    }
  };

  private readonly onMemberSheetPointerEnd = (): void => {
    if (!this.isMemberSheetDragging) return;
    this.endMemberSheetDrag();

    const snaps: SheetSnap[] = ["full", "half", "peek"];
    const nearest = snaps.reduce((best, snap) =>
      Math.abs(this.memberSheetOffsetFor(snap) - this.memberCurrentOffset) <
      Math.abs(this.memberSheetOffsetFor(best) - this.memberCurrentOffset)
        ? snap
        : best
    );

    this.setMemberSheetSnap(nearest);
  };

  private endMemberSheetDrag(): void {
    this.isMemberSheetDragging = false;
    this.memberPanel?.nativeElement.classList.remove("dragging");
    window.removeEventListener("pointermove", this.onMemberSheetPointerMove);
    window.removeEventListener("pointerup", this.onMemberSheetPointerEnd);
    window.removeEventListener("pointercancel", this.onMemberSheetPointerEnd);
  }

  /** Tap the member grabber to cycle peek -> half -> full -> peek. */
  onMemberGrabberClick(): void {
    if (this.memberDragMoved) {
      this.memberDragMoved = false;
      return;
    }
    const order: SheetSnap[] = ["peek", "half", "full"];
    const next =
      order[(order.indexOf(this.memberSheetSnap) + 1) % order.length];
    this.setMemberSheetSnap(next);
  }

  private setMemberSheetSnap(snap: SheetSnap): void {
    this.memberSheetSnap = snap;
    this.applyMemberSheetSnap();
    this.cdr.markForCheck();
  }

  async openMessages(): Promise<void> {
    const toast = await this.toastCtrl.create({
      message: "Messaging is coming soon",
      duration: 1800,
      position: "top",
      cssClass: "update-toast",
    });
    await toast.present();
  }

  // ---------------------------------------------------------------------------
  // Squad chip dropdown (create / join)
  // ---------------------------------------------------------------------------

  /**
   * The toolbar squad chip opens a dropdown anchored to the pill itself, so it
   * appears directly under the chip instead of sliding up from the bottom.
   * The chip expands first, then the dropdown is sized to the expanded chip so
   * the two read as one connected card.
   */
  async presentSquadOptions(event: Event): Promise<void> {
    if (this.squadChipOpen) return;

    const anchor = event.currentTarget as HTMLElement;
    this.squadChipOpen = true;
    // Render the expanded chip before presenting so Ionic measures its final
    // width (not the collapsed pill's) when it sizes the popover.
    this.cdr.detectChanges();

    // First open before the squad list has arrived: wait for it so the menu
    // is never empty. Every later open presents instantly from cache and
    // refreshes quietly in the background (a network round-trip here made the
    // menu feel laggy).
    if (!this.squadsLoaded) {
      const previousActiveId = this.activeSquadId;
      await this.loadSquads();
      if (previousActiveId !== this.activeSquadId) {
        await this.loadSquadMembers(false);
      }
    } else {
      void this.refreshSquadsInBackground();
    }

    const popover = await this.popoverCtrl.create({
      component: SquadMenuPopoverComponent,
      componentProps: {
        squadName: this.activeSquadName,
        squads: this.squads,
        activeSquadId: this.activeSquadId,
      },
      // Anchor to the button itself: event.target can be the inner label span.
      event: { target: anchor } as unknown as Event,
      side: "bottom",
      alignment: "center",
      arrow: false,
      showBackdrop: true,
      cssClass: "squad-menu-popover",
      // Ionic sets the popover width from the anchor's exact (sub-pixel) rect,
      // so the dropdown lines up with the expanded chip on both edges.
      size: "cover",
    });
    // The backdrop hole is a CSS variable read via ::part(backdrop) so it is
    // already in effect on the backdrop's very first frame (no dim flash).
    popover.style.setProperty(
      "--squad-chip-hole",
      this.buildBackdropHolePath(anchor)
    );
    await popover.present();

    // The hole exposes the chip, but the popover host is still above it. Treat
    // taps on the exposed chip as backdrop taps so the menu still closes.
    const dismissOnChipTap = (tap: Event): void => {
      if (tap.target === popover) {
        void popover.dismiss();
      }
    };
    popover.addEventListener("click", dismissOnChipTap);

    // Ionic measures the anchor only once, when the popover presents. If the
    // viewport changes while the menu is open (rotation, mobile/desktop
    // breakpoint), re-anchor it so it stays flush under the chip and the
    // backdrop hole stays aligned.
    const followChip = (): void => {
      const rect = anchor.getBoundingClientRect();
      popover.style.setProperty("--width", `${rect.width}px`);
      const content =
        popover.shadowRoot?.querySelector<HTMLElement>(".popover-content");
      if (content) {
        content.style.top = `calc(${rect.bottom}px + var(--offset-y, 0px))`;
        content.style.left = `calc(${rect.left}px + var(--offset-x, 0px))`;
      }
      popover.style.setProperty(
        "--squad-chip-hole",
        this.buildBackdropHolePath(anchor)
      );
    };
    window.addEventListener("resize", followChip);
    window.addEventListener("orientationchange", followChip);

    // Act after the popover closes so the next alert opens on a clean backdrop.
    const { data } = await popover.onWillDismiss<SquadMenuResult>();
    popover.removeEventListener("click", dismissOnChipTap);
    window.removeEventListener("resize", followChip);
    window.removeEventListener("orientationchange", followChip);
    this.squadChipOpen = false;
    this.cdr.markForCheck();

    if (!data) return;

    if (data.action === "create") {
      void this.createSquad();
    } else if (data.action === "join") {
      void this.joinSquad();
    } else if (data.action === "switch") {
      void this.switchSquad(data.squadId);
    }
  }

  /**
   * Quietly refetch the squad list after the dropdown is already on screen so
   * squads created/left elsewhere show up next time without delaying this open.
   */
  private async refreshSquadsInBackground(): Promise<void> {
    const previousActiveId = this.activeSquadId;
    await this.loadSquads();
    if (previousActiveId !== this.activeSquadId) {
      await this.loadSquadMembers(false);
    }
  }

  /** Invite code of the squad currently shown on the map. */
  get activeSquadJoinCode(): string | null {
    return (
      this.squads.find((squad) => squad.id === this.activeSquadId)?.join_code ??
      null
    );
  }

  /** Copy the active squad's invite code so it can be pasted into a chat. */
  async copySquadCode(): Promise<void> {
    const code = this.activeSquadJoinCode;
    if (!code) return;

    try {
      await navigator.clipboard.writeText(code);
      await this.showUpdateToast("Join code copied!");
    } catch {
      // Clipboard access can be denied in a WebView: still surface the code.
      await this.showUpdateToast(`Join code: ${code}`);
    }
  }

  /** Share the active squad's invite code via the platform share sheet. */
  async shareSquadCode(): Promise<void> {
    const squad = this.squads.find((entry) => entry.id === this.activeSquadId);
    if (!squad) return;

    const text = `Join "${squad.squad_name}" on Konek with the code ${squad.join_code}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: "Join my Konek squad", text });
        return;
      } catch (error) {
        // Closing the share sheet is not an error; anything else falls back
        // to copying the code.
        if ((error as DOMException)?.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(squad.join_code);
      await this.showUpdateToast("Join code copied!");
    } catch {
      await this.showUpdateToast(`Join code: ${squad.join_code}`);
    }
  }

  /** Swap the map over to another squad and reload its members and geofences. */
  private async switchSquad(squadId: number): Promise<void> {
    if (squadId === this.activeSquadId) return;
    this.activeSquadId = squadId;
    this.persistActiveSquad(
      this.squads.find((squad) => squad.id === squadId)?.squad_name
    );
    this.cdr.markForCheck();
    await this.loadSquadMembers(false);
  }

  /**
   * Leave the squad open in the squad panel. Confirmation and the reload happen
   * here so the panel's footer button stays a plain click handler.
   */
  async leaveActiveSquad(): Promise<void> {
    const squadId = this.activeSquadId;
    if (squadId === null) return;

    const name =
      this.squads.find((squad) => squad.id === squadId)?.squad_name ??
      this.activeSquadName;
    const alert = await this.alertCtrl.create({
      header: "Leave Squad",
      message: `Are you sure you want to leave "${name}"?`,
      buttons: [
        { text: "Cancel", role: "cancel" },
        {
          text: "Leave",
          role: "destructive",
          handler: () => {
            void this.doLeaveSquad(squadId);
          },
        },
      ],
    });
    await alert.present();
  }

  /**
   * Leave a squad, then move the map on: the squad list is refetched so the
   * active squad falls back to the next one (or to none at all).
   */
  private async doLeaveSquad(squadId: number): Promise<void> {
    const loading = await this.loadingCtrl.create({ message: "Leaving squad..." });
    await loading.present();

    try {
      await firstValueFrom(this.squadService.leaveSquad(squadId));
      await loading.dismiss();
      void this.showUpdateToast("Left squad");
      await this.loadSquads();
      if (this.activeSquadId === null) {
        // Left the last squad: drop its geofence circles from the map.
        this.geofences = [];
        this.renderGeofences();
      }
      await this.loadSquadMembers(false);
      this.cdr.markForCheck();
    } catch (error) {
      await loading.dismiss();
      console.error("Leave squad failed:", error);
      // Surface the server's reason, e.g. the sole-admin rule.
      const message =
        (error as { error?: { message?: string } })?.error?.message ??
        "Failed to leave squad";
      void this.showUpdateToast(message);
    }
  }

  /**
   * Ionic's backdrop dims the whole page, including the chip, which makes the
   * chip look like it belongs to the dimmed background rather than the menu.
   * Build a clip path that leaves a chip-shaped hole in the backdrop so the
   * expanded chip stays crisp while everything else is still dimmed. The path
   * is set on the popover host before presenting, so the hole is already in
   * effect during the backdrop's fade-in (no dim flash).
   */
  private buildBackdropHolePath(anchor: HTMLElement): string {
    const rect = anchor.getBoundingClientRect();
    // A pixel of breathing room keeps the chip's antialiased edge clean.
    const pad = 1;
    const radius = 16 + pad;
    const left = rect.left - pad;
    const top = rect.top - pad;
    const right = rect.right + pad;
    const bottom = rect.bottom + pad;

    // The backdrop covers the viewport, so viewport coordinates are also the
    // backdrop's local coordinates. Outer rect + chip shape, even-odd = hole.
    const outer = `M0 0H${window.innerWidth}V${window.innerHeight}H0Z`;
    const hole =
      `M${left} ${top + radius}` +
      `Q${left} ${top} ${left + radius} ${top}` +
      `H${right - radius}` +
      `Q${right} ${top} ${right} ${top + radius}` +
      `V${bottom}H${left}Z`;

    return `path(evenodd, "${outer} ${hole}")`;
  }

  private async createSquad(): Promise<void> {
    this.isSquadFormModalOpen = true;
    this.cdr.markForCheck();
    try {
      const { CreateSquadModalComponent } = await import(
        "./create-squad-modal/create-squad-modal.component"
      );
      const modal = await this.modalCtrl.create({
        component: CreateSquadModalComponent,
        cssClass: "squad-form-modal",
        backdropDismiss: true,
      });
      await modal.present();

      const { data, role } = await modal.onWillDismiss<string>();
      if (role === "confirm" && data) {
        await this.doCreateSquad(data);
      }
    } finally {
      this.isSquadFormModalOpen = false;
      this.cdr.markForCheck();
    }
  }

  private async doCreateSquad(name: string): Promise<void> {
    const loading = await this.loadingCtrl.create({ message: "Creating squad..." });
    await loading.present();
    try {
      const squad = await firstValueFrom(
        this.squadService.createSquad({ squad_name: name })
      );
      await loading.dismiss();
      void this.showUpdateToast("Squad created");
      // Show the new squad straight away instead of staying on the old one.
      if (squad?.id) {
        this.activeSquadId = squad.id;
        this.persistActiveSquad(squad.squad_name);
      }
      await this.loadSquadMembers();
    } catch (error) {
      await loading.dismiss();
      console.error("Create squad failed:", error);
      void this.showUpdateToast("Failed to create squad");
    }
  }

  private async joinSquad(): Promise<void> {
    this.isSquadFormModalOpen = true;
    this.cdr.markForCheck();
    try {
      const { JoinSquadModalComponent } = await import(
        "./join-squad-modal/join-squad-modal.component"
      );
      const modal = await this.modalCtrl.create({
        component: JoinSquadModalComponent,
        cssClass: "squad-form-modal",
        backdropDismiss: true,
      });
      await modal.present();

      const { data, role } = await modal.onWillDismiss<string>();
      if (role === "confirm" && data) {
        await this.doJoinSquad(data);
      }
    } finally {
      this.isSquadFormModalOpen = false;
      this.cdr.markForCheck();
    }
  }

  private async doJoinSquad(code: string): Promise<void> {
    const loading = await this.loadingCtrl.create({ message: "Joining squad..." });
    await loading.present();
    try {
      const squad = await firstValueFrom(
        this.squadService.joinSquad({ join_code: code })
      );
      await loading.dismiss();
      void this.showUpdateToast("Joined squad");
      // Show the newly joined squad straight away.
      if (squad?.id) {
        this.activeSquadId = squad.id;
        this.persistActiveSquad(squad.squad_name);
      }
      await this.loadSquadMembers();
    } catch (error) {
      await loading.dismiss();
      console.error("Join squad failed:", error);
      const message =
        (error as { error?: { message?: string } })?.error?.message ??
        "Failed to join squad";
      void this.showUpdateToast(message);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers used by the template
  // ---------------------------------------------------------------------------

  /** Group name shown in the toolbar: the active squad, or a neutral fallback. */
  get activeSquadName(): string {
    const active = this.squads.find((squad) => squad.id === this.activeSquadId);
    if (active) return active.squad_name;
    if (this.activeSquadNameCache) return this.activeSquadNameCache;
    return this.squadsLoaded ? "Konek Map" : "Loadingâ€¦";
  }

  /** Whether the panel's leave action applies: a squad must be selected. */
  get hasActiveSquad(): boolean {
    return this.activeSquadId !== null;
  }

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
    this.endSheetDrag();
    this.endMemberSheetDrag();
    window.removeEventListener("resize", this.onWindowResize);
    window.removeEventListener("orientationchange", this.onWindowResize);

    if (this.map) {
      this.map.off("moveend", this.onMapMoveEnd);
      this.squadMarkers.forEach((marker) => this.map?.removeLayer(marker));
      this.geofenceLayers.forEach((layer) => this.map?.removeLayer(layer));
      this.map.remove();
      this.map = null;
    }
    this.squadMarkers.clear();
    this.geofenceLayers = [];
    this.streetFallback = null;
    this.mapReady = false;
  }
}
