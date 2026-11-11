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
  alertCircleOutline,
  arrowBackOutline,
  batteryChargingOutline,
  batteryDeadOutline,
  batteryFullOutline,
  batteryHalfOutline,
  chatbubbleEllipsesOutline,
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
import * as maplibregl from "maplibre-gl";
import type {
  AttributionControl,
  GeoJSONSource,
  Map as MapLibreMap,
  MapMouseEvent,
  Marker,
  NavigationControl,
  Popup,
} from "maplibre-gl";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import { Capacitor } from "@capacitor/core";
import type { Position } from "@capacitor/geolocation";

import { AuthService, User } from "../../core/services/auth.service";
import { BackgroundTrackerService } from "../../core/services/background-tracker.service";
import { BatteryService } from "../../core/services/battery.service";
import { LocationService } from "../../core/services/location.service";
import { GeolocationService } from "../../core/services/geolocation.service";
import { PingService } from "../../core/services/ping.service";
import { SquadService } from "../../core/services/squad.service";
import { Geofence, SquadMemberLocation } from "../../core/models/location.models";
import { IncomingPing, PingType } from "../../core/models/ping.models";
import { Squad } from "../../core/models/squad.models";
import {
  SquadMenuPopoverComponent,
  SquadMenuResult,
} from "./squad-menu-popover/squad-menu-popover.component";

type MapStyle = "street" | "satellite" | "hybrid";
type SheetSnap = "peek" | "half" | "full";

/** Zoom-driven interpolation expression matching the MapLibre style spec. */
type ZoomInterpolation = [
  "interpolate",
  ["linear"],
  ["zoom"],
  number,
  number,
  number,
  number,
];

/** Last map viewport persisted to localStorage. */
interface StoredMapView {
  lat: number;
  lng: number;
  zoom: number;
  timestamp: number;
}

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
  private readonly pingService = inject(PingService);
  private readonly squadService = inject(SquadService);
  private readonly alertCtrl = inject(AlertController);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly modalCtrl = inject(ModalController);
  private readonly popoverCtrl = inject(PopoverController);
  private readonly toastCtrl = inject(ToastController);
  private readonly cdr = inject(ChangeDetectorRef);

  private map: MapLibreMap | null = null;
  private userMarker: Marker | null = null;
  private userMarkerEl: HTMLDivElement | null = null;
  private squadMarkers = new Map<string, Marker>();
  private squadMarkerEls = new Map<string, HTMLDivElement>();
  private geofencePopup: Popup | null = null;
  /** GeoJSON data kept outside the style so it survives theme reloads. */
  private accuracyData: Feature<Polygon> | null = null;
  private geofenceData: FeatureCollection<Polygon> = {
    type: "FeatureCollection",
    features: [],
  };
  /** MapLibre owns the basemap; true once its style finished loading. */
  private styleLoaded = false;
  /** Symbol layers from the active style, toggled for satellite-only mode. */
  private labelLayerIds: string[] = [];
  private currentTheme: "light" | "dark" = "light";
  private mapLoadTimer: ReturnType<typeof setTimeout> | null = null;
  /** Deferred map creation while the page layout settles (0x0 guard). */
  private mapInitTimer: ReturnType<typeof setTimeout> | null = null;
  private watchId: string | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pingPollTimer: ReturnType<typeof setInterval> | null = null;
  /** Ping ids already shown this session, so a slow mark-read never re-toasts. */
  private readonly shownPingIds = new Set<number>();
  /** Wheel-scroll animation state for the desktop ping row. */
  private pingScrollTarget: number | null = null;
  private pingScrollFrame: number | null = null;
  private compassTimer: ReturnType<typeof setInterval> | null = null;
  /** Continuous beam rotation in unwrapped degrees (tracks past 0Â°/360Â°). */
  private headingDeg = 0;
  private resizeObserver: ResizeObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private zoomControl: NavigationControl | null = null;
  private attributionControl: AttributionControl | null = null;
  private sizeTimers: ReturnType<typeof setTimeout>[] = [];
  private lastUploadAt = 0;
  private lastSuccessfulUploadAt = 0;
  private locationUploadInFlight = false;
  /** Latest fix, reused by the foreground heartbeat when GPS goes quiet. */
  private lastKnownFix: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    altitude?: number;
    speed?: number;
    heading?: number;
    timestamp: number;
  } | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
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
  /** A slight tilt makes the vector buildings feel 3D without hurting labels. */
  private static readonly DEFAULT_PITCH = 42;
  private static readonly STYLE_LIGHT =
    "https://tiles.openfreemap.org/styles/liberty";
  private static readonly STYLE_DARK =
    "https://tiles.openfreemap.org/styles/dark";
  private static readonly SATELLITE_TILES =
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

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
  /** True once the first squad/member fetch has finished (gates the splash). */
  initialLoadDone = false;
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
      alertCircleOutline,
      arrowBackOutline,
      batteryChargingOutline,
      batteryDeadOutline,
      batteryFullOutline,
      batteryHalfOutline,
      chatbubbleEllipsesOutline,
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
    this.initialLoadDone = true;
    this.cdr.markForCheck();
    this.scheduleSquadPoll();
    this.startPingPolling();
  }

  /**
   * Create the map once the view exists. Running earlier (ngOnInit) measured a
   * layout that had not settled yet; resizing afterwards keeps it accurate.
   */
  ngAfterViewInit(): void {
    this.startMapInit();
    this.observeMapSize();
    this.applySheetSnap();
    this.applyMemberSheetSnap();
  }

  /**
   * MapLibre 6 throws when it measures a 0x0 container, and Ionic briefly
   * mounts a page before its layout settles. Poll until the container has a
   * real size, then create the map and paint any data that already arrived.
   * A bounded number of attempts keeps a hidden page from waiting forever.
   */
  private startMapInit(attempt = 0): void {
    const element = this.mapContainer.nativeElement;
    const laidOut = element.clientWidth > 0 && element.clientHeight > 0;
    if (!laidOut && element.isConnected && attempt < 100) {
      this.mapInitTimer = setTimeout(() => this.startMapInit(attempt + 1), 50);
      return;
    }

    this.mapInitTimer = null;
    this.initMap();
    // Data may finish loading before the map exists (both run from ngOnInit);
    // paint whatever already arrived so the first frame is complete.
    this.updateSquadMarkers();
    if (this.lastKnownFix) {
      this.updateUserMarker(
        this.lastKnownFix.latitude,
        this.lastKnownFix.longitude,
        this.lastKnownFix.accuracy ?? 0,
        this.lastKnownFix.heading ?? this.geolocationService.getHeading()
      );
    }
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

  /**
   * Poll for pings addressed to this user. Foreground delivery only: the timer
   * pauses while the page is hidden, and the next visible tick catches up on
   * anything that arrived meanwhile.
   */
  private startPingPolling(): void {
    if (this.pingPollTimer) return;
    void this.pollIncomingPings();
    this.pingPollTimer = setInterval(() => {
      void this.pollIncomingPings();
    }, 6000);
  }

  private async pollIncomingPings(): Promise<void> {
    if (!this.isActive || document.visibilityState === "hidden") return;

    try {
      const pings = await firstValueFrom(this.pingService.getPendingPings());
      if (!pings.length) return;

      // Mark every fetched ping read, including stale ones we choose not to
      // surface, so a backlog cannot buzz again on every later poll.
      firstValueFrom(
        this.pingService.markPingsRead(pings.map((ping) => ping.id))
      ).catch((error) => {
        console.error("Failed to mark pings read:", error);
      });

      const fresh = pings.filter((ping) => !this.shownPingIds.has(ping.id));
      for (const ping of fresh) {
        this.shownPingIds.add(ping.id);
      }

      // Pings older than two minutes are treated as missed: the map was not
      // open when they arrived, and buzzing for them now would be confusing.
      const recent = fresh.filter((ping) => ping.age_seconds <= 120);
      if (!recent.length) return;

      if (recent.length === 1) {
        const ping = recent[0];
        await this.vibrateForPing(ping.ping_type);
        await this.showUpdateToast(this.describePing(ping), this.pingIcon(ping));
        return;
      }

      const emergency = recent.find((ping) => ping.ping_type === "need_help");
      await this.vibrateForPing(emergency?.ping_type ?? recent[0].ping_type);
      await this.showUpdateToast(
        `You have ${recent.length} new pings`,
        "chatbubbles-outline"
      );
    } catch (error) {
      console.error("Failed to poll pings:", error);
    }
  }

  /** Recipient-facing description of a ping: sender plus label or message. */
  private describePing(ping: IncomingPing): string {
    if (ping.ping_type === "custom" && ping.message) {
      return `${ping.from_username}: ${ping.message}`;
    }
    const label =
      this.pingOptions.find((option) => option.type === ping.ping_type)?.label ??
      "Ping";
    return `${ping.from_username} pinged you: ${label}`;
  }

  private pingIcon(ping: IncomingPing): string {
    return ping.ping_type === "need_help"
      ? "alert-circle-outline"
      : "chatbubble-ellipses-outline";
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
    const center: [number, number] = storedView
      ? [storedView.lng, storedView.lat]
      : [MapPage.DEFAULT_LNG, MapPage.DEFAULT_LAT];
    this.currentTheme = document.body.classList.contains("dark") ? "dark" : "light";

    // The bundler does not emit MapLibre's worker next to the app chunks, so
    // point MapLibre at the copy shipped from the assets folder (see
    // angular.json) before the first map is created.
    maplibregl.setWorkerUrl("assets/maplibre/maplibre-gl-worker.mjs");

    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
        container,
        style: this.styleUrl(),
        center,
        zoom: storedView?.zoom ?? MapPage.DEFAULT_ZOOM,
        pitch: MapPage.DEFAULT_PITCH,
        bearing: 0,
        maxPitch: 65,
        minZoom: 1,
        maxZoom: 20,
        // No maxBounds: MapLibre already clamps the Mercator latitude, and
        // renderWorldCopies:false stops duplicate worlds. (MapLibre 6.17
        // throws inside setZoom when maxBounds is set.)
        renderWorldCopies: false,
        attributionControl: false,
        fadeDuration: 200,
        // 3D buildings are the main depth cue; keep the canvas cheap on phones.
        canvasContextAttributes: { antialias: false },
      });
    } catch (error) {
      // Older WebViews without WebGL2 cannot start MapLibre. Never leave the
      // splash spinning forever on those devices.
      console.error("Failed to create map:", error);
      this.mapReady = true;
      this.cdr.markForCheck();
      void this.showAlert("This device is unable to display the map.");
      return;
    }
    this.map = map;

    // Remember every pan/zoom so the next visit starts here instead of Manila.
    map.on("moveend", this.onMapMoveEnd);
    map.on("style.load", this.onStyleLoad);
    map.on("load", this.onMapLoad);
    map.on("click", this.onMapClick);
    map.on("error", this.onMapError);

    // A slow or unreachable style must never leave the splash up forever.
    this.mapLoadTimer = setTimeout(() => {
      this.mapReady = true;
      this.cdr.markForCheck();
    }, 12000);

    // Zoom/compass buttons are desktop-only; phones use pinch gestures.
    this.syncZoomControl();
    this.addAttributionControl();

    // Follow the app theme: Settings toggles body.dark, so watch the class.
    this.themeObserver = new MutationObserver(() => this.applyMapTheme());
    this.themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  private styleUrl(): string {
    return this.currentTheme === "dark" ? MapPage.STYLE_DARK : MapPage.STYLE_LIGHT;
  }

  private readonly onStyleLoad = (): void => {
    if (!this.map) return;
    this.styleLoaded = true;
    this.labelLayerIds = (this.map.getStyle().layers ?? [])
      .filter((layer) => layer.type === "symbol")
      .map((layer) => layer.id);
    this.installCustomLayers();
    this.applyMapStyle();
    // The splash waits for the `load` event (first complete render), so the
    // user never sees a blank canvas behind the spinner.
  };

  private readonly onMapLoad = (): void => this.markMapReady();

  private markMapReady(): void {
    if (this.mapReady) return;
    this.mapReady = true;
    if (this.mapLoadTimer) {
      clearTimeout(this.mapLoadTimer);
      this.mapLoadTimer = null;
    }
    this.cdr.markForCheck();
  }

  private readonly onMapError = (event: unknown): void => {
    console.error("Map error:", event);
  };

  /**
   * Keep the MapLibre navigation control in sync with the layout. It is
   * desktop-only, so resizing across the 768px breakpoint must add or remove
   * the control instead of leaving a stale copy behind.
   */
  private syncZoomControl(): void {
    if (!this.map) return;

    const shouldShow = !this.isMobileLayout();
    if (shouldShow && !this.zoomControl) {
      const control = new maplibregl.NavigationControl({
        showCompass: true,
        showZoom: true,
        visualizePitch: true,
      });
      this.zoomControl = control;
      this.map.addControl(control, "top-left");
    } else if (!shouldShow && this.zoomControl) {
      this.map.removeControl(this.zoomControl);
      this.zoomControl = null;
    }
  }

  private addAttributionControl(): void {
    if (!this.map) return;
    const control = new maplibregl.AttributionControl({
      compact: true,
      customAttribution:
        '&copy; <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &middot; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    });
    this.attributionControl = control;
    this.map.addControl(control, "bottom-left");
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

  /**
   * Add the satellite/3D/overlay layers on top of whichever OpenFreeMap style
   * is active. Called after every style load, including dark-mode swaps.
   */
  private installCustomLayers(): void {
    if (!this.map || !this.styleLoaded) return;

    this.installBuilding3d();
    this.ensureSatelliteLayer();
    this.ensureAccuracyLayers();
    this.ensureGeofenceLayers();
    this.applySky();
  }

  /** Insert new layers below the first label so text always stays readable. */
  private firstSymbolLayerId(): string | undefined {
    return this.map
      ?.getStyle()
      .layers?.find((layer) => layer.type === "symbol")?.id;
  }

  /**
   * 3D buildings give the tilted street map its depth. They only exist in the
   * light style: over the dark basemap, imagery and extruded slabs all darken
   * into unreadable shapes, so dark mode keeps a flat (but tilted) map.
   */
  private installBuilding3d(): void {
    const map = this.map;
    if (!map || this.currentTheme === "dark" || map.getLayer("building-3d")) {
      return;
    }

    map.addLayer(
      {
        id: "building-3d",
        type: "fill-extrusion",
        source: "openmaptiles",
        "source-layer": "building",
        minzoom: 14,
        filter: ["!", ["has", "hide_3d"]],
        paint: {
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-height": ["coalesce", ["get", "render_height"], 0],
          "fill-extrusion-color": "#d9d2c6",
          "fill-extrusion-opacity": 0.72,
        },
      },
      this.firstSymbolLayerId()
    );
  }

  private ensureSatelliteLayer(): void {
    const map = this.map;
    if (!map) return;

    if (!map.getSource("satellite")) {
      map.addSource("satellite", {
        type: "raster",
        tiles: [MapPage.SATELLITE_TILES],
        tileSize: 256,
        maxzoom: 19,
        attribution: "Imagery &copy; Esri",
      });
    }

    if (!map.getLayer("satellite")) {
      map.addLayer(
        {
          id: "satellite",
          type: "raster",
          source: "satellite",
          paint: {
            "raster-opacity": 0,
            "raster-fade-duration": 250,
            "raster-resampling": "linear",
          },
        },
        this.firstSymbolLayerId()
      );
    }
  }

  private ensureAccuracyLayers(): void {
    const map = this.map;
    if (!map) return;
    const empty: FeatureCollection<Polygon> = {
      type: "FeatureCollection",
      features: [],
    };

    if (!map.getSource("accuracy")) {
      map.addSource("accuracy", {
        type: "geojson",
        data: this.accuracyData ?? empty,
      });
    }

    if (!map.getLayer("accuracy-fill")) {
      map.addLayer(
        {
          id: "accuracy-fill",
          type: "fill",
          source: "accuracy",
          paint: { "fill-color": "#3880ff", "fill-opacity": 0.08 },
        },
        this.firstSymbolLayerId()
      );
    }

    if (!map.getLayer("accuracy-line")) {
      map.addLayer(
        {
          id: "accuracy-line",
          type: "line",
          source: "accuracy",
          paint: {
            "line-color": "#3880ff",
            "line-opacity": 0.45,
            "line-width": 1,
            "line-dasharray": [2, 2],
          },
        },
        this.firstSymbolLayerId()
      );
    }
  }

  private ensureGeofenceLayers(): void {
    const map = this.map;
    if (!map) return;

    if (!map.getSource("geofences")) {
      map.addSource("geofences", {
        type: "geojson",
        data: this.geofenceData,
      });
    }

    if (!map.getLayer("geofence-fill")) {
      map.addLayer(
        {
          id: "geofence-fill",
          type: "fill",
          source: "geofences",
          paint: { "fill-color": "#2dd36f", "fill-opacity": 0.05 },
        },
        this.firstSymbolLayerId()
      );
    }

    if (!map.getLayer("geofence-line")) {
      map.addLayer(
        {
          id: "geofence-line",
          type: "line",
          source: "geofences",
          paint: {
            "line-color": "#2dd36f",
            "line-width": 1.2,
            "line-dasharray": [4, 6],
          },
        },
        this.firstSymbolLayerId()
      );
    }
  }

  /**
   * Sky/fog gradient for the tilted horizon. MapLibre 6 stores the sky on the
   * style itself rather than as a layer, so it follows style/theme swaps.
   */
  private applySky(): void {
    const map = this.map;
    if (!map) return;

    map.setSky({
      "sky-color": this.currentTheme === "dark" ? "#0b1020" : "#9ec9ff",
      "sky-horizon-blend": 0.5,
      "horizon-color": this.currentTheme === "dark" ? "#1b2438" : "#e9f2ff",
      "horizon-fog-blend": 0.6,
      "fog-color": this.currentTheme === "dark" ? "#0f1526" : "#d7e6f7",
      "fog-ground-blend": 0.8,
      "atmosphere-blend": 0.55,
    });
  }

  /**
   * Street mode slowly cross-fades into satellite as the user zooms in.
   * Satellite/Hybrid modes keep imagery on; satellite-only hides labels.
   */
  private applyMapStyle(): void {
    const map = this.map;
    if (!map || !this.styleLoaded || !map.getLayer("satellite")) return;

    const opacity: number | ZoomInterpolation =
      this.mapStyle === "street"
        ? ["interpolate", ["linear"], ["zoom"], 14.5, 0, 17.5, 1]
        : 1;
    map.setPaintProperty("satellite", "raster-opacity", opacity);

    // The building footprints come from z14 vector tiles: overzoomed on top of
    // imagery they turn into huge slabs, so they hand the map over to the
    // satellite imagery before it becomes the dominant basemap.
    const buildingOpacity: number | ZoomInterpolation =
      this.mapStyle === "street"
        ? ["interpolate", ["linear"], ["zoom"], 15, 0.75, 16.2, 0]
        : 0;
    if (map.getLayer("building-3d")) {
      map.setPaintProperty("building-3d", "fill-extrusion-opacity", buildingOpacity);
    }

    const hideLabels = this.mapStyle === "satellite";
    for (const id of this.labelLayerIds) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", hideLabels ? "none" : "visible");
      }
    }
  }

  /** Swap between the light and dark OpenFreeMap styles. */
  private applyMapTheme(): void {
    const theme = document.body.classList.contains("dark") ? "dark" : "light";
    if (theme === this.currentTheme || !this.map) return;

    this.currentTheme = theme;
    this.styleLoaded = false;
    // Full style swap keeps the camera and DOM markers; custom layers are
    // reinstalled from `onStyleLoad`, then the satellite mode is reapplied.
    this.map.setStyle(this.styleUrl(), { diff: false });
  }

  private readonly onMapClick = (event: MapMouseEvent): void => {
    const map = this.map;
    if (!map || !map.getLayer("geofence-fill")) return;

    const feature = map.queryRenderedFeatures(event.point, {
      layers: ["geofence-fill"],
    })[0];
    if (!feature) return;

    const name = String(feature.properties?.["name"] ?? "Geofence");
    const radius = Number(feature.properties?.["radius_meters"] ?? 0);
    this.geofencePopup?.remove();
    this.geofencePopup = new maplibregl.Popup({ closeButton: true, offset: 12 })
      .setLngLat(event.lngLat)
      .setHTML(`<b>${this.escapeHtml(name)}</b><br>${radius}m radius`)
      .addTo(map);
  };

  /** Keep MapLibre's canvas in sync with the real container size. */
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

  private readonly onWindowResize = (): void => {
    this.refreshMapSize();
    this.syncZoomControl();
  };

  /** Re-measure the canvas after layout changes. */
  private refreshMapSize(): void {
    const element = this.mapContainer.nativeElement;
    if (!this.map || !element.isConnected) return;
    // A page mid-transition can collapse to 0x0; resizing then breaks
    // MapLibre's matrices, so wait for real dimensions.
    if (element.clientWidth === 0 || element.clientHeight === 0) return;
    this.map.resize();
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
   * lowest zooms leave empty space beside the single un-wrapped world.
   * MapLibre's world is 512px at zoom 0 and doubles each level, so the smallest
   * zoom that still covers the viewport is ceil(log2(longestSide / 512)).
   */
  private syncMapMinZoom(): void {
    if (!this.map) return;
    const container = this.map.getContainer();
    const longestSide = Math.max(container.clientWidth, container.clientHeight);
    if (!longestSide) return;

    const minZoom = Math.max(0, Math.ceil(Math.log2(longestSide / 512)));
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
      this.startLocationHeartbeat();

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

    // Keep the freshest fix so the heartbeat can re-send it when the device
    // is stationary and the GPS is not emitting new positions.
    this.lastKnownFix = {
      latitude,
      longitude,
      accuracy: accuracy ?? undefined,
      altitude: altitude ?? undefined,
      speed: speed ?? undefined,
      heading: headingDeg || undefined,
      timestamp: position.timestamp,
    };

    this.updateUserMarker(latitude, longitude, accuracy ?? 0, headingDeg);
    if (!this.hasCentered && this.map) {
      // Preserve the user's restored zoom; otherwise use street level so the
      // first fix is immediately useful.
      const zoom = this.restoredMapView ? Math.max(this.map.getZoom(), 14) : 16;
      this.map.easeTo({
        center: [longitude, latitude],
        zoom,
        duration: 800,
      });
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
    this.uploadLocation(true);
  }

  /**
   * Re-send the last known fix while the app stays open. Phones stop emitting
   * `watchPosition` fixes when they are still, which used to let the server
   * timestamp age past the online window even though the app was running.
   */
  private startLocationHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      if (!this.isActive || !this.isTracking || !this.lastKnownFix) return;
      if (this.locationUploadInFlight) return;
      // A fresh upload already covers this window.
      if (Date.now() - this.lastSuccessfulUploadAt < 60000) return;
      this.uploadLocation(false);
    }, 30000);
  }

  /** Send the latest fix to the API; history is only written for real fixes. */
  private uploadLocation(addHistory: boolean): void {
    const fix = this.lastKnownFix;
    if (!fix || this.locationUploadInFlight) return;

    this.locationUploadInFlight = true;
    const now = Date.now();
    const battery = this.batteryService.getBatteryInfo();
    this.locationService
      .updateLocation({
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracy: fix.accuracy,
        altitude: fix.altitude,
        speed: fix.speed,
        heading: fix.heading,
        battery_level: battery.level ?? undefined,
        is_charging: battery.charging ?? undefined,
      })
      .subscribe({
        next: () => {
          this.lastSuccessfulUploadAt = Date.now();
          this.locationUploadInFlight = false;
          this.connectionStatus = "connected";
          this.cdr.markForCheck();
        },
        error: () => {
          this.locationUploadInFlight = false;
          this.connectionStatus = "disconnected";
          this.cdr.markForCheck();
        },
      });

    if (addHistory && this.currentUser) {
      void this.locationService.addToHistory({
        id: now,
        user_id: this.currentUser.id,
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracy: fix.accuracy,
        altitude: fix.altitude,
        speed: fix.speed,
        heading: fix.heading,
        timestamp: new Date(fix.timestamp).toISOString(),
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

    if (!this.userMarker) {
      const el = document.createElement("div");
      el.className = "user-marker";
      el.style.zIndex = "1000";
      el.innerHTML = `
        <div class="marker-pulse"></div>
        <div class="marker-halo"></div>
        <div class="marker-core">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/>
          </svg>
        </div>
        <div class="marker-heading"></div>`;
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        this.openSelfDetail();
        this.centerOnUser();
      });
      this.userMarkerEl = el;
      this.userMarker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([lng, lat])
        .addTo(this.map);
    } else {
      this.userMarker.setLngLat([lng, lat]);
    }

    const arrow = this.userMarkerEl?.querySelector(
      ".marker-heading"
    ) as HTMLElement | null;
    if (arrow) {
      arrow.style.transform = `rotate(${heading}deg)`;
    }

    this.updateAccuracyCircle(lat, lng, accuracy);
  }

  private updateAccuracyCircle(
    lat: number,
    lng: number,
    accuracy: number
  ): void {
    this.accuracyData = accuracy > 0 ? this.circleFeature(lat, lng, accuracy, {}) : null;
    const source = this.map?.getSource("accuracy") as GeoJSONSource | undefined;
    source?.setData(
      this.accuracyData ?? { type: "FeatureCollection", features: [] }
    );
  }

  /**
   * Build a GeoJSON polygon approximating a circle in metres. MapLibre has no
   * metre-radius circle primitive, so accuracy rings and geofences are polygons.
   */
  private circleFeature(
    lat: number,
    lng: number,
    radiusMeters: number,
    properties: Record<string, string | number>
  ): Feature<Polygon> {
    const steps = 96;
    const earthRadius = 6371008.8;
    const angular = radiusMeters / earthRadius;
    const latRad = (lat * Math.PI) / 180;
    const lngRad = (lng * Math.PI) / 180;
    const ring: [number, number][] = [];

    for (let i = 0; i <= steps; i += 1) {
      const bearing = ((i % steps) * 2 * Math.PI) / steps;
      const lat2 = Math.asin(
        Math.sin(latRad) * Math.cos(angular) +
          Math.cos(latRad) * Math.sin(angular) * Math.cos(bearing)
      );
      const lng2 =
        lngRad +
        Math.atan2(
          Math.sin(bearing) * Math.sin(angular) * Math.cos(latRad),
          Math.cos(angular) - Math.sin(latRad) * Math.sin(lat2)
        );
      ring.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
    }

    return {
      type: "Feature",
      properties,
      geometry: { type: "Polygon", coordinates: [ring] },
    };
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
    const me = this.userMarker?.getLngLat();
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

  /** Members sharing right now (seen within the last three minutes). */
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
        void this.showUpdateToast("Circle locations refreshed");
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
        marker.remove();
        this.squadMarkers.delete(id);
        this.squadMarkerEls.delete(id);
      }
    }

    for (const member of this.squadMembers) {
      if (member.user_id === this.currentUser?.id) continue; // skip self

      const id = String(member.user_id);
      const existing = this.squadMarkers.get(id);
      if (existing) {
        existing.setLngLat([member.longitude, member.latitude]);
        const el = this.squadMarkerEls.get(id);
        if (el) this.paintSquadMarker(el, member);
        continue;
      }

      const el = document.createElement("div");
      el.style.zIndex = "500";
      this.paintSquadMarker(el, member);
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        this.openMemberDetail(member.user_id);
      });

      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([member.longitude, member.latitude])
        .addTo(this.map);
      this.squadMarkers.set(id, marker);
      this.squadMarkerEls.set(id, el);
    }
  }

  /** Avatar-style marker: initials, role colour and a live dot. */
  private paintSquadMarker(el: HTMLDivElement, member: SquadMemberLocation): void {
    const online = this.isMemberOnline(member);
    const admin = member.role === "admin";
    // Preserve MapLibre's own classes (maplibregl-marker, anchor class) while
    // refreshing the role/online state on every location poll.
    el.classList.add("squad-marker");
    el.classList.toggle("is-admin", admin);
    el.innerHTML = `
      <div class="marker-ring"></div>
      <div class="marker-core"><span>${this.initialsOf(member.username)}</span></div>
      ${online ? '<div class="marker-status"></div>' : ""}`;
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
    this.geofenceData = {
      type: "FeatureCollection",
      features: this.geofences.map((fence) =>
        this.circleFeature(fence.latitude, fence.longitude, fence.radius_meters, {
          id: fence.id,
          name: fence.name,
          radius_meters: fence.radius_meters,
        })
      ),
    };

    const source = this.map?.getSource("geofences") as GeoJSONSource | undefined;
    source?.setData(this.geofenceData);
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
      this.map.flyTo({
        center: this.userMarker.getLngLat(),
        zoom: Math.max(this.map.getZoom(), 16),
        duration: 600,
      });
    } else {
      void this.getInitialPosition();
    }
  }

  centerOnMember(member: SquadMemberLocation): void {
    this.map?.flyTo({
      center: [member.longitude, member.latitude],
      zoom: 17,
      duration: 600,
    });
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
    // MapLibre click handlers run outside Angular's change detection
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
    void this.pingMember(type);
  }

  /**
   * Desktop: translate a vertical mouse wheel into smooth horizontal chip
   * scrolling. Wheel deltas accumulate into a target, and a rAF loop eases the
   * row toward it so small wheel clicks glide instead of jumping.
   */
  onPingScrollerWheel(event: WheelEvent): void {
    if (event.deltaX !== 0 || event.deltaY === 0) return;
    const scroller = event.currentTarget as HTMLElement | null;
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;

    const max = scroller.scrollWidth - scroller.clientWidth;
    const base = this.pingScrollTarget ?? scroller.scrollLeft;
    // At either end, let the wheel scroll the sheet instead of trapping it.
    if ((base <= 0 && event.deltaY < 0) || (base >= max && event.deltaY > 0)) {
      return;
    }
    event.preventDefault();

    this.pingScrollTarget = Math.max(0, Math.min(max, base + event.deltaY));

    if (this.pingScrollFrame !== null) return;

    const step = () => {
      const target = this.pingScrollTarget ?? scroller.scrollLeft;
      const delta = target - scroller.scrollLeft;
      if (Math.abs(delta) < 0.5) {
        scroller.scrollLeft = target;
        this.pingScrollTarget = null;
        this.pingScrollFrame = null;
        return;
      }
      scroller.scrollLeft += delta * 0.22;
      this.pingScrollFrame = requestAnimationFrame(step);
    };
    this.pingScrollFrame = requestAnimationFrame(step);
  }

  /**
   * Send a quick ping to the selected squad mate. The recipient's app picks it
   * up on its next poll and vibrates there; the sender gets no success feedback
   * so only the person being pinged is alerted. Errors are still surfaced.
   */
  async pingMember(type: PingType, customText?: string): Promise<void> {
    const member = this.liveSelectedMember;
    if (!member) return;

    try {
      await firstValueFrom(
        this.pingService.sendPing({
          target_user_id: member.user_id,
          ping_type: type,
          ...(customText ? { message: customText } : {}),
        })
      );
    } catch (error) {
      console.error("Failed to send ping:", error);
      void this.showUpdateToast("Couldn't send ping", "alert-circle-outline");
    }
  }

  /**
   * Recipient-side alert. Emergency pings use a heavier double burst so they
   * feel distinct from a casual ping.
   */
  private async vibrateForPing(type: PingType): Promise<void> {
    const emergency = type === "need_help";
    const pattern = emergency ? [200, 100, 200] : [80];

    if (!Capacitor.isNativePlatform()) {
      navigator.vibrate?.(pattern);
      return;
    }

    try {
      const { Haptics, ImpactStyle, NotificationType } = await import(
        "@capacitor/haptics"
      );
      if (emergency) {
        await Haptics.notification({ type: NotificationType.Warning });
        await Haptics.impact({ style: ImpactStyle.Heavy });
      } else {
        await Haptics.notification({ type: NotificationType.Success });
      }
    } catch {
      navigator.vibrate?.(pattern);
    }
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
            void this.pingMember("custom", text);
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
    const origin = this.userMarker?.getLngLat();
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
    return this.liveSelectedMember?.username ?? "Circle member";
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
    this.mapStyle = style;
    this.applyMapStyle();
  }

  async presentMapStyleSheet(): Promise<void> {
    const sheet = await this.actionSheetCtrl.create({
      header: "Map style",
      buttons: [
        {
          text: "Street (3D, auto hybrid)",
          handler: () => this.changeMapStyle("street"),
        },
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

  /** Peek height comes from CSS so the FAB/MapLibre offsets stay in sync. */
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
        await navigator.share({ title: "Join my Konek circle", text });
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
      header: "Leave Circle",
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
    const loading = await this.loadingCtrl.create({ message: "Leaving circle..." });
    await loading.present();

    try {
      await firstValueFrom(this.squadService.leaveSquad(squadId));
      await loading.dismiss();
      void this.showUpdateToast("Left circle");
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
        "Failed to leave circle";
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
    const loading = await this.loadingCtrl.create({ message: "Creating circle..." });
    await loading.present();
    try {
      const squad = await firstValueFrom(
        this.squadService.createSquad({ squad_name: name })
      );
      await loading.dismiss();
      void this.showUpdateToast("Circle created");
      // Show the new squad straight away instead of staying on the old one.
      if (squad?.id) {
        this.activeSquadId = squad.id;
        this.persistActiveSquad(squad.squad_name);
      }
      await this.loadSquadMembers();
    } catch (error) {
      await loading.dismiss();
      console.error("Create squad failed:", error);
      void this.showUpdateToast("Failed to create circle");
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
    const loading = await this.loadingCtrl.create({ message: "Joining circle..." });
    await loading.present();
    try {
      const squad = await firstValueFrom(
        this.squadService.joinSquad({ join_code: code })
      );
      await loading.dismiss();
      void this.showUpdateToast("Joined circle");
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
        "Failed to join circle";
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
  private async showUpdateToast(
    message: string,
    icon = "checkmark-circle-outline"
  ): Promise<void> {
    try {
      if (this.activeToast) {
        await this.activeToast.dismiss();
        this.activeToast = null;
      }
      this.activeToast = await this.toastCtrl.create({
        message,
        icon,
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
    return Date.now() - new Date(member.timestamp).getTime() < 180000;
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
    if (this.pingPollTimer) {
      clearInterval(this.pingPollTimer);
      this.pingPollTimer = null;
    }
    if (this.pingScrollFrame !== null) {
      cancelAnimationFrame(this.pingScrollFrame);
      this.pingScrollFrame = null;
    }
    this.pingScrollTarget = null;
    this.shownPingIds.clear();
    if (this.compassTimer) {
      clearInterval(this.compassTimer);
      this.compassTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    void this.geolocationService.stopMotionTracking();

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.themeObserver?.disconnect();
    this.themeObserver = null;
    this.sizeTimers.forEach((timer) => clearTimeout(timer));
    this.sizeTimers = [];
    if (this.mapLoadTimer) {
      clearTimeout(this.mapLoadTimer);
      this.mapLoadTimer = null;
    }
    if (this.mapInitTimer) {
      clearTimeout(this.mapInitTimer);
      this.mapInitTimer = null;
    }
    this.endSheetDrag();
    this.endMemberSheetDrag();
    window.removeEventListener("resize", this.onWindowResize);
    window.removeEventListener("orientationchange", this.onWindowResize);

    if (this.map) {
      this.map.off("moveend", this.onMapMoveEnd);
      this.map.off("style.load", this.onStyleLoad);
      this.map.off("load", this.onMapLoad);
      this.map.off("click", this.onMapClick);
      this.map.off("error", this.onMapError);
      this.squadMarkers.forEach((marker) => marker.remove());
      this.userMarker?.remove();
      this.geofencePopup?.remove();
      this.map.remove();
      this.map = null;
    }
    this.zoomControl = null;
    this.attributionControl = null;
    this.squadMarkers.clear();
    this.squadMarkerEls.clear();
    this.userMarker = null;
    this.userMarkerEl = null;
    this.geofencePopup = null;
    this.accuracyData = null;
    this.geofenceData = { type: "FeatureCollection", features: [] };
    this.labelLayerIds = [];
    this.styleLoaded = false;
    this.mapReady = false;
  }
}
