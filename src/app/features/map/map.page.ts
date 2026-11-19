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
import { Subscription, firstValueFrom } from "rxjs";
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
import type { ViewWillEnter } from "@ionic/angular";
import { addIcons } from "ionicons";
import {
  addCircleOutline,
  addOutline,
  alertCircleOutline,
  arrowBackOutline,
  checkmarkCircleOutline,
  chevronDownOutline,
  closeOutline,
  ellipsisHorizontalOutline,
  happyOutline,
  layersOutline,
  locateOutline,
  logOutOutline,
  manOutline,
  navigateOutline,
  notificationsOutline,
  pencilOutline,
  peopleOutline,
  personAddOutline,
  personCircleOutline,
  personOutline,
  refreshOutline,
  settingsOutline,
  shieldCheckmarkOutline,
  timeOutline,
  womanOutline,
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
import { LocationService } from "../../core/services/location.service";
import { GeolocationService } from "../../core/services/geolocation.service";
import { LocationTrackingService } from "../../core/services/location-tracking.service";
import { PingService } from "../../core/services/ping.service";
import { CircleService } from "../../core/services/circle.service";
import { NotificationService } from "../../core/services/notification.service";
import { Geofence, CircleMemberLocation } from "../../core/models/location.models";
import { IncomingPing, PingType } from "../../core/models/ping.models";
import { MemberRelationship, Circle } from "../../core/models/circle.models";
import {
  CircleMenuPopoverComponent,
  CircleMenuResult,
} from "./circle-menu-popover/circle-menu-popover.component";

/**
 * Inline SVGs for the marker movement badges. Keeping them inline avoids
 * relying on Ionic's icon registry for DOM that MapLibre owns.
 */
const MOVEMENT_CAR_ICON = `<svg class="marker-movement-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M5 16v-3l1.7-4.1A2 2 0 0 1 8.6 8h6.8a2 2 0 0 1 1.9 1.3L19 13v3" />
  <path d="M5 13h14" />
  <circle cx="7.5" cy="16.5" r="1.5" />
  <circle cx="16.5" cy="16.5" r="1.5" />
</svg>`;

const MOVEMENT_WALK_ICON = `<svg class="marker-movement-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="13" cy="4" r="1.6" />
  <path d="m11.4 8.6-2.6 3.6 2.2 2.1L9.4 20" />
  <path d="m13.4 8.6 2 3.1 2.7 1.4" />
  <path d="m11.9 14.2 2.4 2.1.9 3.7" />
</svg>`;

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

/**
 * Esri serves this exact 2521-byte JPEG wherever World Imagery has no tile at
 * the requested zoom. It is a grey "Map data not yet available" card, so the
 * map turns it into a transparent tile and lets the sharper fallback show
 * through.
 */
const ESRI_PLACEHOLDER_BYTES = 2521;
const ESRI_PLACEHOLDER_FNV1A = 0x92d9118f;

/** 1x1 fully transparent PNG, returned in place of Esri placeholder tiles. */
const TRANSPARENT_TILE_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII="
  ),
  (char) => char.charCodeAt(0)
);

let esriProtocolRegistered = false;

/** True for Esri's byte-identical "Map data not yet available" tile. */
function isEsriPlaceholderTile(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength !== ESRI_PLACEHOLDER_BYTES) return false;

  const bytes = new Uint8Array(buffer);
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) === ESRI_PLACEHOLDER_FNV1A;
}

/**
 * Route Esri World Imagery through a custom protocol so missing high-zoom
 * tiles can be swapped for transparency. Only the placeholder bytes are
 * filtered; real imagery is returned untouched.
 */
function registerEsriTileProtocol(): void {
  if (esriProtocolRegistered) return;
  esriProtocolRegistered = true;

  try {
    maplibregl.addProtocol("esri", async (requestParameters, abortController) => {
      const response = await fetch(
        requestParameters.url.replace(/^esri:\/\//, "https://"),
        { signal: abortController.signal }
      );

      if (!response.ok) {
        throw new Error(`Esri tile request failed (${response.status})`);
      }

      const data = await response.arrayBuffer();
      if (isEsriPlaceholderTile(data)) {
        // A fresh buffer per tile: MapLibre may transfer (detach) the result.
        return { data: new Uint8Array(TRANSPARENT_TILE_PNG).buffer };
      }

      return { data };
    });
  } catch (error) {
    // Hot reload can re-run this module; a duplicate registration is harmless.
    console.warn("Esri tile protocol was already registered:", error);
  }
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
    IonSpinner
  ],
})
export class MapPage
  implements OnInit, AfterViewInit, OnDestroy, ViewWillEnter
{
  @ViewChild("mapContainer", { static: true })
  mapContainer!: ElementRef<HTMLDivElement>;

  @ViewChild("circlePanel")
  circlePanel?: ElementRef<HTMLDivElement>;

  @ViewChild("memberPanel")
  memberPanel?: ElementRef<HTMLDivElement>;

  // `<ion-fab>` is an Ionic component, so the ref defaults to the component
  // instance; read the ElementRef explicitly.
  @ViewChild("mapFabs", { read: ElementRef })
  mapFabs?: ElementRef<HTMLElement>;

  private readonly authService = inject(AuthService);
  private readonly backgroundTracker = inject(BackgroundTrackerService);
  private readonly locationService = inject(LocationService);
  private readonly geolocationService = inject(GeolocationService);
  private readonly locationTrackingService = inject(LocationTrackingService);
  private readonly pingService = inject(PingService);
  private readonly circleService = inject(CircleService);
  private readonly notificationService = inject(NotificationService);
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
  private circleMarkers = new Map<string, Marker>();
  private circleMarkerEls = new Map<string, HTMLDivElement>();
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
  private mapLoadTimer: ReturnType<typeof setTimeout> | null = null;
  /** Deferred map creation while the page layout settles (0x0 guard). */
  private mapInitTimer: ReturnType<typeof setTimeout> | null = null;
  private watchId: string | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pingPollTimer: ReturnType<typeof setInterval> | null = null;
  /** True while a ping request is in flight, so ticks never stack up. */
  private pingPollInFlight = false;
  /** Unread inbox count shown on the toolbar bell. */
  unreadNotifications = 0;
  private notificationPollTimer: ReturnType<typeof setInterval> | null = null;
  private notificationPollInFlight = false;
  /** Shared in-flight member-location refresh, so pulls never stack. */
  private circleRefreshPromise: Promise<boolean> | null = null;
  /** Ping ids already shown this session, so a slow mark-read never re-toasts. */
  private readonly shownPingIds = new Set<number>();
  /** Wheel-scroll animation state for the desktop ping row. */
  private pingScrollTarget: number | null = null;
  private pingScrollFrame: number | null = null;
  private compassTimer: ReturnType<typeof setInterval> | null = null;
  /** Continuous beam rotation in unwrapped degrees (tracks past 0°/360°). */
  private headingDeg = 0;
  private resizeObserver: ResizeObserver | null = null;
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
  /** Master switch mirrored from Settings; false pauses all own-location sharing. */
  private trackingEnabled = true;
  private trackingSubscription: Subscription | null = null;
  private authSubscription: Subscription | null = null;
  private lastUserId: number | null = null;
  private trackingStarting = false;
  private hasCentered = false;
  private geofences: Geofence[] = [];
  private insideGeofence = new Map<string, boolean>();
  private activeCircleId: number | null = null;
  /** Last known name of the active circle, kept for the instant chip label. */
  private activeCircleNameCache: string | null = null;
  /** True once the circle list has been fetched at least once. */
  private circlesLoaded = false;
  /** In-flight circle list fetch shared by every caller. */
  private circlesLoadPromise: Promise<void> | null = null;
  private selectedMember: CircleMemberLocation | null = null;
  /** Relationship label for the currently selected member (used by the edit popover). */
  selectedMemberRelationship: MemberRelationship | null = null;

  /** localStorage entry remembering which circle the user was viewing. */
  private static readonly ACTIVE_CIRCLE_KEY = "konek_active_squad";

  /** Last map viewport, so the map reopens where the user left it. */
  private static readonly LAST_VIEW_KEY = "konek_last_map_center";
  /** Ignore a stored viewport older than this (milliseconds). */
  private static readonly LAST_VIEW_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  private static readonly DEFAULT_LAT = 14.5995;
  private static readonly DEFAULT_LNG = 120.9842;
  private static readonly DEFAULT_ZOOM = 14;
  private static readonly MAX_ZOOM = 20;
  /** Focus zoom for a circle member: neighbourhood scale, not rooftop scale. */
  private static readonly MEMBER_FOCUS_ZOOM = 14;
  /** Esri World Imagery has native tiles through z19 in most cities. */
  private static readonly SATELLITE_MAX_ZOOM = 19;
  /** z17 imagery is available almost everywhere; used below missing z18/z19 tiles. */
  private static readonly SATELLITE_FALLBACK_MAX_ZOOM = 17;
  /** z18 is the sharpest common fallback; z19 gaps use it before dropping to z17. */
  private static readonly SATELLITE_FALLBACK_18_MAX_ZOOM = 18;
  /** Stay below z17 imagery until the detail layer is about to need fallback. */
  private static readonly SATELLITE_FALLBACK_MIN_ZOOM = 17.4;
  /** The z18 fallback only becomes useful once the detail layer requests z19. */
  private static readonly SATELLITE_FALLBACK_18_MIN_ZOOM = 18.4;
  /** A slight tilt makes the vector buildings feel 3D without hurting labels. */
  private static readonly DEFAULT_PITCH = 42;
  private static readonly STYLE_LIGHT =
    "https://tiles.openfreemap.org/styles/liberty";
  private static readonly SATELLITE_TILES =
    "esri://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

  /** True when the initial viewport came from localStorage, not the fallback. */
  private restoredMapView = false;

  /** Mobile bottom-sheet snap state. Ignored on desktop. */
  circleSheetSnap: "peek" | "half" | "full" = "peek";
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
  private previousCircleListOpen = false;
  private previousCircleSnap: SheetSnap = "peek";

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
  ];

  /** Emoji shown when a ping is sent — instant feedback for the sender. */
  private readonly PING_EMOJI: Record<PingType, string> = {
    whats_up: "👋",
    on_my_way: "🏃‍♂️",
    where_you_at: "📍",
    meet_here: "📌",
    almost_there: "⏳",
    leaving_now: "🚗",
    need_help: "🆘",
    coffee: "☕",
  };

  /** Always read from the auth service so it reflects login/logout immediately. */
  get currentUser(): User | null {
    return this.authService.getCurrentUser();
  }
  circleMembers: CircleMemberLocation[] = [];
  circles: Circle[] = [];
  isTracking = false;
  mapStyle: MapStyle = "street";
  showCircleList = false;
  /** True while the create/join circle modal is on screen. */
  isCircleFormModalOpen = false;
  /** True when the mobile circle sheet is at (or near) its full snap. */
  toolbarHidden = false;
  isLoadingCircle = false;
  mapReady = false;
  /** True once the first circle/member fetch has finished (gates the splash). */
  initialLoadDone = false;
  connectionStatus: "connected" | "connecting" | "disconnected" = "connecting";
  /** GPS accuracy (metres) of the user's latest fix, for the self sheet. */
  lastAccuracy: number | null = null;
  /** ISO timestamp of the user's latest fix, for the self sheet. */
  lastFixAt: string | null = null;
  detailSheetOpen = false;
  selectedIsSelf = false;
  isRefreshingDetail = false;
  /** True while a ping is being sent, so a double tap cannot send twice. */
  isSendingPing = false;
  /** True while the toolbar chip is expanded under its dropdown. */
  circleChipOpen = false;

  constructor() {
    addIcons({
      addCircleOutline,
      alertCircleOutline,
      arrowBackOutline,
      checkmarkCircleOutline,
      chevronDownOutline,
      closeOutline,
      ellipsisHorizontalOutline,
      happyOutline,
      layersOutline,
      locateOutline,
      logOutOutline,
      manOutline,
      navigateOutline,
      notificationsOutline,
      peopleOutline,
      personAddOutline,
      personCircleOutline,
      personOutline,
      refreshOutline,
      settingsOutline,
      shieldCheckmarkOutline,
      timeOutline,
      womanOutline,
    });
  }

  async ngOnInit(): Promise<void> {
    // Restore the last viewed circle before the first render so the toolbar
    // chip shows its name immediately instead of a placeholder.
    this.restoreActiveCircle();

    // The Settings toggle is the master switch: only watch/upload while it is
    // on. Keep listening so toggling it off stops sharing without a reload.
    this.trackingEnabled = this.locationTrackingService.enabled;
    await this.applyTrackingPreference(this.trackingEnabled);
    this.trackingSubscription = this.locationTrackingService.enabled$.subscribe(
      (enabled) => {
        if (enabled === this.trackingEnabled) return;
        void this.applyTrackingPreference(enabled);
      }
    );

    // Watch for user changes (login/logout/switch) and reset map state.
    this.authSubscription = this.authService.currentUser$.subscribe((user) => {
      if (this.lastUserId !== null && this.lastUserId !== user?.id) {
        // Different user logged in — wipe all map data for the old account.
        this.resetMapState();
      }
      this.lastUserId = user?.id ?? null;
    });

    await this.geolocationService.startMotionTracking();
    this.startCompassUpdates();
    await this.loadCircleMembers();
    this.initialLoadDone = true;
    this.cdr.markForCheck();
    this.scheduleCirclePoll();
    this.startPingPolling();
    this.startNotificationPolling();
  }

  /** Refresh badges and positions when returning from another screen. */
  ionViewWillEnter(): void {
    void this.refreshUnreadNotifications();
    void this.refreshCircleLocations(false);
    // Recover if the initial permission prompt was dismissed; toggling the
    // master switch off must not restart the watch.
    if (this.trackingEnabled && !this.watchId) {
      void this.setupLocationTracking();
    }
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
    this.updateCircleMarkers();
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
   * The angle is unwrapped so passing north (359° -> 1°) continues forward
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

  /** Refresh the circle on the accelerometer-driven cadence (5s moving / 30s still). */
  private scheduleCirclePoll(): void {
    if (!this.isActive) return;
    const delay = this.geolocationService.getPollInterval();
    this.pollTimer = setTimeout(async () => {
      await this.refreshCircleLocations(false);
      this.scheduleCirclePoll();
    }, delay);
  }

  /**
   * Poll for pings addressed to this user. Foreground delivery only: the timer
   * pauses while the page is hidden, and the next visible tick catches up on
   * anything that arrived meanwhile.
   */
  private startPingPolling(): void {
    if (this.pingPollTimer) return;
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    void this.pollIncomingPings();
    this.pingPollTimer = setInterval(() => {
      void this.pollIncomingPings();
    }, 6000);
  }

  /** A ping that arrived while the app was backgrounded should buzz at once. */
  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === "visible") {
      void this.pollIncomingPings();
      void this.refreshUnreadNotifications();
      // Coming back to the app after a while should show fresh positions, not
      // whatever the last poll left on the map.
      void this.refreshCircleLocations(false);
    }
  };

  private async pollIncomingPings(): Promise<void> {
    // A slow request must not overlap the next six-second tick.
    if (
      !this.isActive ||
      this.pingPollInFlight ||
      document.visibilityState === "hidden"
    ) {
      return;
    }

    this.pingPollInFlight = true;
    try {
      const pings = await firstValueFrom(this.pingService.getPendingPings());
      // The user may have left the map while the request was in flight.
      if (!this.isActive || !pings.length) return;

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

      const emergency = recent.find((ping) => ping.ping_type === "need_help");
      await this.vibrateForPing(emergency?.ping_type ?? recent[0].ping_type);
      await this.showUpdateToast(
        this.summarizePings(recent),
        this.pingIcon(emergency ?? recent[0]),
        emergency ? { cssClass: "ping-alert-toast", duration: 4000 } : undefined
      );
    } catch (error) {
      console.error("Failed to poll pings:", error);
    } finally {
      this.pingPollInFlight = false;
    }
  }

  private startNotificationPolling(): void {
    if (this.notificationPollTimer) return;
    void this.refreshUnreadNotifications();
    this.notificationPollTimer = setInterval(() => {
      void this.refreshUnreadNotifications();
    }, 30000);
  }

  /** Pull the inbox badge total without fetching the whole list. */
  private async refreshUnreadNotifications(): Promise<void> {
    if (
      !this.isActive ||
      this.notificationPollInFlight ||
      document.visibilityState === "hidden"
    ) {
      return;
    }

    this.notificationPollInFlight = true;
    try {
      const count = await firstValueFrom(
        this.notificationService.getUnreadCount()
      );
      if (!this.isActive) return;
      this.unreadNotifications = count;
      this.cdr.markForCheck();
    } catch (error) {
      // A missing notifications migration should not spam the console every
      // 30 seconds; log once per failure and keep the last known badge.
      console.error("Failed to refresh notification count:", error);
    } finally {
      this.notificationPollInFlight = false;
    }
  }

  /** One-line summary that names senders and calls out emergencies first. */
  private summarizePings(pings: IncomingPing[]): string {
    const emergency = pings.find((ping) => ping.ping_type === "need_help");
    if (emergency) {
      const extra = pings.length - 1;
      return extra > 0
        ? `${emergency.from_username} needs help — ${extra} more ping${
            extra === 1 ? "" : "s"
          }`
        : `${emergency.from_username} needs help!`;
    }

    if (pings.length === 1) return this.describePing(pings[0]);

    const names = [...new Set(pings.map((ping) => ping.from_username))];
    const senders =
      names.length === 1
        ? names[0]
        : names.length === 2
          ? `${names[0]} and ${names[1]}`
          : `${names[0]}, ${names[1]} and ${names.length - 2} more`;
    return `${pings.length} new pings from ${senders}`;
  }

  /** Recipient-facing description of a ping: sender plus label. */
  private describePing(ping: IncomingPing): string {
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

    // The bundler does not emit MapLibre's worker next to the app chunks, so
    // point MapLibre at the copy shipped from the assets folder (see
    // angular.json) before the first map is created.
    maplibregl.setWorkerUrl("assets/maplibre/maplibre-gl-worker.mjs");
    // Must exist before the first style requests an Esri tile.
    registerEsriTileProtocol();

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
        maxZoom: MapPage.MAX_ZOOM,
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

    // Zoom/compass buttons work on touch too, so phones keep them.
    this.syncZoomControl();
    this.addAttributionControl();
  }

  private styleUrl(): string {
    return MapPage.STYLE_LIGHT;
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
    if (!this.map || this.zoomControl) return;

    const control = new maplibregl.NavigationControl({
      showCompass: true,
      showZoom: false,
      visualizePitch: false,
    });
    this.zoomControl = control;
    this.map.addControl(control, "top-left");
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
        zoom > MapPage.MAX_ZOOM
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
   * Add the satellite/3D/overlay layers on top of the OpenFreeMap style.
   * Called after every style load.
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
   * 3D buildings give the tilted street map its depth. The building
   * footprints come from z14 vector tiles: overzoomed on top of imagery they
   * turn into huge slabs, so `applyMapStyle` fades them out as satellite
   * imagery takes over.
   */
  private installBuilding3d(): void {
    const map = this.map;
    if (!map || map.getLayer("building-3d")) {
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

    // Fallbacks sit underneath the detail layer, sharpest first. A missing
    // z19 tile lets the z18 layer show through; where z18 is also missing, the
    // z17 layer keeps real imagery visible instead of a grey card. Order in
    // the style is z17, z18, z19 (top).
    const fallbacks = [
      {
        id: "satellite-fallback",
        maxzoom: MapPage.SATELLITE_FALLBACK_MAX_ZOOM,
        minzoom: MapPage.SATELLITE_FALLBACK_MIN_ZOOM,
      },
      {
        id: "satellite-fallback-18",
        maxzoom: MapPage.SATELLITE_FALLBACK_18_MAX_ZOOM,
        minzoom: MapPage.SATELLITE_FALLBACK_18_MIN_ZOOM,
      },
    ];

    for (const fallback of fallbacks) {
      if (!map.getSource(fallback.id)) {
        map.addSource(fallback.id, {
          type: "raster",
          tiles: [MapPage.SATELLITE_TILES],
          tileSize: 256,
          maxzoom: fallback.maxzoom,
        });
      }

      if (!map.getLayer(fallback.id)) {
        map.addLayer(
          {
            id: fallback.id,
            type: "raster",
            source: fallback.id,
            minzoom: fallback.minzoom,
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

    if (!map.getSource("satellite")) {
      map.addSource("satellite", {
        type: "raster",
        tiles: [MapPage.SATELLITE_TILES],
        tileSize: 256,
        maxzoom: MapPage.SATELLITE_MAX_ZOOM,
        attribution:
          'Imagery &copy; <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics',
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
      "sky-color": "#9ec9ff",
      "sky-horizon-blend": 0.5,
      "horizon-color": "#e9f2ff",
      "horizon-fog-blend": 0.6,
      "fog-color": "#d7e6f7",
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

    const satelliteOpacity: number | ZoomInterpolation =
      this.mapStyle === "street"
        ? ["interpolate", ["linear"], ["zoom"], 14.5, 0, 17.5, 1]
        : 1;
    map.setPaintProperty("satellite", "raster-opacity", satelliteOpacity);
    for (const id of ["satellite-fallback", "satellite-fallback-18"]) {
      if (map.getLayer(id)) {
        map.setPaintProperty(id, "raster-opacity", satelliteOpacity);
      }
    }

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

  /** React to the Settings master switch without a page reload. */
  private async applyTrackingPreference(enabled: boolean): Promise<void> {
    this.trackingEnabled = enabled;
    if (enabled) {
      await this.setupLocationTracking();
    } else {
      await this.stopLocationTracking();
    }
    this.cdr.markForCheck();
  }

  private async setupLocationTracking(): Promise<void> {
    // Already running, already starting, or the master switch is off.
    if (!this.trackingEnabled || this.watchId || this.trackingStarting) return;

    this.trackingStarting = true;
    try {
      const granted = await this.geolocationService.requestPermissions();
      if (!this.trackingEnabled) return;
      if (!granted) {
        this.connectionStatus = "disconnected";
        this.cdr.markForCheck();
        await this.showAlert("Location permission is required to use the map.");
        return;
      }

      const watchId = await this.geolocationService.watchPosition(
        (position) => this.onPositionUpdate(position),
        () => {
          this.connectionStatus = "disconnected";
          this.cdr.markForCheck();
        }
      );
      // The toggle may have been switched off while the prompt/watch started.
      if (!this.trackingEnabled) {
        await this.geolocationService.clearWatch(watchId);
        return;
      }

      this.watchId = watchId;
      this.isTracking = true;
      this.connectionStatus = "connected";
      this.cdr.markForCheck();
      this.startLocationHeartbeat();

      // Keep uploading after the app is backgrounded or swiped away.
      // Android-only; no-op on web/iOS.
      void this.backgroundTracker.start(10000);

      await this.getInitialPosition();
    } catch (error) {
      console.error("Location tracking failed:", error);
      this.connectionStatus = "disconnected";
      this.cdr.markForCheck();
    } finally {
      this.trackingStarting = false;
    }
  }

  /** Stop watching and uploading this device's location immediately. */
  private async stopLocationTracking(): Promise<void> {
    const watchId = this.watchId;
    this.watchId = null;
    if (watchId) {
      await this.geolocationService.clearWatch(watchId);
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    // If the switch flipped back on while clearWatch was resolving, leave the
    // new watch/heartbeat startup to applyTrackingPreference.
    if (!this.trackingEnabled) {
      this.isTracking = false;
      await this.backgroundTracker.stop();
    }
    this.cdr.markForCheck();
  }

  private async getInitialPosition(): Promise<boolean> {
    try {
      const position = await this.geolocationService.getCurrentPosition();
      this.onPositionUpdate(position);
      return true;
    } catch (error) {
      console.debug("Initial fix unavailable:", error);
      return false;
    }
  }

  private onPositionUpdate(position: Position): void {
    // A queued callback can land just after the master switch was turned off.
    if (!this.trackingEnabled) return;

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
    if (!this.trackingEnabled) return;
    const fix = this.lastKnownFix;
    if (!fix || this.locationUploadInFlight) return;

    this.locationUploadInFlight = true;
    const now = Date.now();
    this.locationService
      .updateLocation({
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracy: fix.accuracy,
        altitude: fix.altitude,
        // A heartbeat re-sends an older fix, so its speed no longer describes
        // what the member is doing now. Omitting it clears a stale "Driving"
        // badge until the next real GPS fix arrives.
        speed: addHistory ? fix.speed : undefined,
        heading: fix.heading,
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

    const user = this.authService.getCurrentUser() ?? this.currentUser;
    const photoUrl = this.authService.pictureUrl(user?.profile_picture);
    const initials = this.initialsOf(user?.username);

    if (!this.userMarker) {
      const el = document.createElement("div");
      el.className = "user-marker";
      el.style.zIndex = "1000";
      el.innerHTML = `
        <div class="marker-pulse"></div>
        <div class="marker-halo"></div>
        <div class="marker-core">${
          photoUrl
            ? `<img class="marker-photo" src="${this.escapeHtml(photoUrl)}" alt="" />`
            : `<span>${initials}</span>`
        }</div>
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
      // Keep the avatar in sync without rebuilding the node on every GPS fix.
      const core = this.userMarkerEl?.querySelector(".marker-core");
      const existingImg = core?.querySelector<HTMLImageElement>("img.marker-photo");
      if (core) {
        if (photoUrl) {
          if (existingImg) {
            if (existingImg.getAttribute("src") !== photoUrl) {
              existingImg.src = photoUrl;
            }
          } else {
            core.innerHTML = `<img class="marker-photo" src="${this.escapeHtml(photoUrl)}" alt="" />`;
          }
        } else if (existingImg) {
          core.innerHTML = `<span>${initials}</span>`;
        } else {
          const label = core.querySelector("span");
          if (label && label.textContent !== initials) {
            label.textContent = initials;
          }
        }
      }
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
  // Circle data
  // ---------------------------------------------------------------------------

  /**
   * Fetch the user's circles and keep the active selection valid. When the
   * active circle no longer exists (left from the Circles page), fall back to
   * the first one so the map always points at a real circle.
   */
  private async loadCircles(): Promise<void> {
    if (this.circlesLoadPromise) {
      return this.circlesLoadPromise;
    }
    this.circlesLoadPromise = this.fetchCircles().finally(() => {
      this.circlesLoadPromise = null;
    });
    return this.circlesLoadPromise;
  }

  /** Fetch circles and keep the active selection valid. */
  private async fetchCircles(): Promise<void> {
    try {
      const circles = await firstValueFrom(this.circleService.getUserCircles());
      this.circles = circles ?? [];
      if (!this.circles.some((circle) => circle.id === this.activeCircleId)) {
        this.activeCircleId = this.circles[0]?.id ?? null;
      }
      const active = this.circles.find((circle) => circle.id === this.activeCircleId);
      this.activeCircleNameCache = active?.squad_name ?? null;
      this.circlesLoaded = true;
      if (active) {
        this.persistActiveCircle();
      } else {
        this.clearStoredCircle();
      }
      this.cdr.markForCheck();
    } catch (error) {
      console.error("Failed to load circles:", error);
    }
  }

  /** Reinstate the circle chosen in a previous session (survives a refresh). */
  private restoreActiveCircle(): void {
    try {
      const raw = localStorage.getItem(MapPage.ACTIVE_CIRCLE_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as { id?: unknown; name?: unknown };
      if (typeof stored.id === "number" && typeof stored.name === "string") {
        this.activeCircleId = stored.id;
        this.activeCircleNameCache = stored.name;
      }
    } catch {
      // Corrupt or unavailable storage: fall back to the first circle.
    }
  }

  /** Remember the active circle so a refresh opens on the same one. */
  private persistActiveCircle(name?: string): void {
    const id = this.activeCircleId;
    if (id === null) return;
    const resolved =
      name ??
      this.circles.find((circle) => circle.id === id)?.squad_name ??
      this.activeCircleNameCache;
    if (!resolved) return;
    this.activeCircleNameCache = resolved;
    try {
      localStorage.setItem(
        MapPage.ACTIVE_CIRCLE_KEY,
        JSON.stringify({ id, name: resolved })
      );
    } catch {
      // localStorage may be unavailable in private mode.
    }
  }

  /** Distance (metres) from current user to a given member. */
  private memberDistance(member: CircleMemberLocation): number | null {
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
  memberDistanceLabel(member: CircleMemberLocation): string {
    const d = this.memberDistance(member);
    if (d === null) return "—";
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

  /** Absolute URL for a member's profile picture, or null when they have none. */
  memberPictureUrl(member: CircleMemberLocation): string | null {
    return this.authService.pictureUrl(member.profile_picture);
  }

  /** Avatar background: the member's photo when set, otherwise their gradient. */
  memberAvatarBackground(member: CircleMemberLocation): string {
    const url = this.memberPictureUrl(member);
    return url
      ? `url("${url}") center / cover no-repeat`
      : this.avatarGradient(member.username);
  }

  /** Initials are only shown when there is no profile picture. */
  memberAvatarLabel(member: CircleMemberLocation): string {
    return this.memberPictureUrl(member) ? "" : this.memberInitials(member.username);
  }

  /** Members sharing right now (seen within the last three minutes). */
  get onlineMembers(): CircleMemberLocation[] {
    return this.circleMembers.filter((m) => this.isMemberOnline(m));
  }

  /** Members not sharing, most recently seen first. */
  get offlineMembers(): CircleMemberLocation[] {
    return this.circleMembers
      .filter((m) => !this.isMemberOnline(m))
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
  }

  /** One-line status under a member's name. */
  memberSubLabel(member: CircleMemberLocation): string {
    const online = this.isMemberOnline(member);
    if (member.user_id === this.currentUser?.id) {
      if (!this.trackingEnabled) return "Not sharing";
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
    return this.circleMembers.filter((m) => this.isMemberOnline(m)).length;
  }

  private clearStoredCircle(): void {
    try {
      localStorage.removeItem(MapPage.ACTIVE_CIRCLE_KEY);
    } catch {
      // localStorage may be unavailable in private mode.
    }
  }

  /**
   * Load the member locations for the active circle. `refreshCircles` is false
   * when the caller already fetched the circle list (switching or opening the
   * dropdown), so a switch costs a single locations request.
   */
  private async loadCircleMembers(refreshCircles = true): Promise<void> {
    this.isLoadingCircle = true;
    try {
      if (refreshCircles) {
        await this.loadCircles();
      }
      const members = await firstValueFrom(
        this.circleService.getCircleLocations(this.activeCircleId ?? undefined)
      );
      this.circleMembers = members;
      this.updateCircleMarkers();
      this.cdr.markForCheck();

      if (this.activeCircleId) {
        await this.loadGeofences(this.activeCircleId);
      }
    } catch (error) {
      console.error("Failed to load circle members:", error);
    } finally {
      this.isLoadingCircle = false;
      this.cdr.markForCheck();
    }
  }

  /**
   * Pull the latest circle positions. The background poll passes `false` so an
   * automatic refresh stays silent; user-initiated refreshes get a toast.
   */
  async refreshCircleLocations(notify = true): Promise<boolean> {
    // A pull-to-refresh, a foreground retry and a poll can collide. Reuse the
    // request already in flight so every caller gets the same real outcome.
    if (this.circleRefreshPromise) {
      return this.circleRefreshPromise;
    }

    const request = this.performCircleRefresh(notify).finally(() => {
      this.circleRefreshPromise = null;
    });
    this.circleRefreshPromise = request;
    return request;
  }

  private async performCircleRefresh(notify: boolean): Promise<boolean> {
    if (notify) {
      this.isLoadingCircle = true;
      this.cdr.markForCheck();
    }

    try {
      const members = await firstValueFrom(
        this.circleService.getCircleLocations(this.activeCircleId ?? undefined)
      );
      this.circleMembers = members;
      this.updateCircleMarkers();
      this.cdr.markForCheck();
      this.checkGeofenceTransitions(members);
      if (notify) {
        void this.showUpdateToast("Circle locations refreshed");
      }
      return true;
    } catch (error) {
      console.error("Failed to refresh circle locations:", error);
      if (notify) {
        void this.showUpdateToast(
          "Couldn't refresh circle locations",
          "alert-circle-outline"
        );
      }
      return false;
    } finally {
      this.isLoadingCircle = false;
      this.cdr.markForCheck();
    }
  }

  private updateCircleMarkers(): void {
    if (!this.map) return;

    const present = new Set(this.circleMembers.map((m) => String(m.user_id)));
    for (const [id, marker] of this.circleMarkers) {
      if (!present.has(id)) {
        marker.remove();
        this.circleMarkers.delete(id);
        this.circleMarkerEls.delete(id);
      }
    }

    for (const member of this.circleMembers) {
      if (member.user_id === this.currentUser?.id) continue; // skip self

      const id = String(member.user_id);
      const existing = this.circleMarkers.get(id);
      if (existing) {
        existing.setLngLat([member.longitude, member.latitude]);
        const el = this.circleMarkerEls.get(id);
        if (el) this.paintCircleMarker(el, member);
        continue;
      }

      const el = document.createElement("div");
      el.style.zIndex = "500";
      this.paintCircleMarker(el, member);
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        this.openMemberDetail(member.user_id);
      });

      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([member.longitude, member.latitude])
        .addTo(this.map);
      this.circleMarkers.set(id, marker);
      this.circleMarkerEls.set(id, el);
    }
  }

  /** Avatar-style marker: photo (or initials), role colour and a live dot. */
  private paintCircleMarker(el: HTMLDivElement, member: CircleMemberLocation): void {
    const online = this.isMemberOnline(member);
    const admin = member.role === "admin";
    const photo = this.memberPictureUrl(member);
    const movement = this.memberMovement(member);
    // Preserve MapLibre's own classes (maplibregl-marker, anchor class) while
    // refreshing the role/online state on every location poll.
    el.classList.add("circle-marker");
    el.classList.toggle("is-admin", admin);
    el.innerHTML = `
      <div class="marker-ring"></div>
      <div class="marker-core">${
        photo
          ? `<img class="marker-photo" src="${this.escapeHtml(photo)}" alt="" />`
          : `<span>${this.initialsOf(member.username)}</span>`
      }</div>
      ${online ? '<div class="marker-status"></div>' : ""}
      ${
        movement
          ? `<div class="marker-movement is-${movement.state}" aria-hidden="true">
               ${movement.icon}
               <span class="marker-movement-label">${movement.label}</span>
               <span class="marker-movement-speed">${movement.speedKmh} km/h</span>
             </div>`
          : ""
      }`;
  }

  /**
   * Movement badge shown beside a marker. Only online members who are actually
   * moving get one, so a parked or offline friend stays visually quiet.
   */
  private memberMovement(
    member: CircleMemberLocation
  ):
    | { state: "driving" | "moving"; label: string; speedKmh: number; icon: string }
    | null {
    if (!this.isMemberOnline(member)) return null;

    const speed = member.speed;
    if (typeof speed !== "number" || !Number.isFinite(speed)) return null;

    const speedKmh = Math.max(1, Math.round(speed * 3.6));
    if (speed > 5) {
      return { state: "driving", label: "Driving", speedKmh, icon: MOVEMENT_CAR_ICON };
    }
    if (speed > 0.5) {
      return { state: "moving", label: "Moving", speedKmh, icon: MOVEMENT_WALK_ICON };
    }
    return null;
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

  private async loadGeofences(circleId: number): Promise<void> {
    try {
      this.geofences = await firstValueFrom(
        this.circleService.getGeofences(circleId)
      );
      this.renderGeofences();
      this.checkGeofenceTransitions(this.circleMembers);
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

  private checkGeofenceTransitions(members: CircleMemberLocation[]): void {
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
        zoom: Math.max(this.map.getZoom(), MapPage.MEMBER_FOCUS_ZOOM),
        duration: 600,
      });
    } else {
      void this.getInitialPosition();
    }
  }

  centerOnMember(member: CircleMemberLocation): void {
    this.map?.flyTo({
      center: [member.longitude, member.latitude],
      zoom: MapPage.MEMBER_FOCUS_ZOOM,
      duration: 600,
    });
    this.closeCirclePanel();
  }

  // ---------------------------------------------------------------------------
  // Member detail sheet (tap on a marker or circle member)
  // ---------------------------------------------------------------------------

  /**
   * Remember what the circle list was doing so the back button can restore it:
   * the sidebar on desktop, the current snap point on mobile.
   */
  private rememberCirclePanelState(): void {
    this.previousCircleListOpen = this.isMobileLayout()
      ? this.circleSheetSnap !== "peek"
      : this.showCircleList;
    this.previousCircleSnap = this.circleSheetSnap;
  }

  openMemberDetail(userId: number): void {
    const member = this.circleMembers.find((m) => m.user_id === userId);
    if (!member) return;
    // Tapping your own row opens the self sheet: no ping chips, no directions.
    if (member.user_id === this.currentUser?.id) {
      this.openSelfDetail();
      this.centerOnUser();
      return;
    }
    this.rememberCirclePanelState();
    this.selectedMember = member;
    this.selectedMemberRelationship = member.relationship ?? null;
    this.selectedIsSelf = false;
    this.detailSheetOpen = true;
    this.memberSheetSnap = "half";
    this.closeCirclePanel();
    // MapLibre click handlers run outside Angular's change detection
    // (zoneless app), so schedule a render for the sheet state change.
    this.cdr.markForCheck();
    requestAnimationFrame(() => this.applyMemberSheetSnap());
    // Bring the map to the tapped person while the sheet slides up.
    this.centerOnMember(member);
  }

  openSelfDetail(): void {
    this.rememberCirclePanelState();
    this.selectedMember = null;
    this.selectedIsSelf = true;
    this.detailSheetOpen = true;
    this.memberSheetSnap = "half";
    this.closeCirclePanel();
    this.cdr.markForCheck();
    requestAnimationFrame(() => this.applyMemberSheetSnap());
  }

  closeDetailSheet(): void {
    this.detailSheetOpen = false;
    this.selectedMember = null;
    this.selectedMemberRelationship = null;
    this.selectedIsSelf = false;
    this.memberSheetSnap = "peek";
    this.memberPanel?.nativeElement.style.removeProperty("transform");

    // Back returns to the circle list if it was open when the friend was tapped.
    if (this.previousCircleListOpen) {
      if (this.isMobileLayout()) {
        this.setSheetSnap(this.previousCircleSnap);
      } else {
        this.showCircleList = true;
      }
    }
    this.previousCircleListOpen = false;
    // Bring the circle sheet back out of hiding (mobile) and re-sync the FABs.
    this.applySheetSnap();
    this.cdr.markForCheck();
  }

  /** Human-readable label for a relationship value. */
  relationshipLabel(rel: MemberRelationship | null): string {
    if (!rel) return "None";
    const labels: Record<MemberRelationship, string> = {
      dad: "Dad",
      mom: "Mom",
      son: "Son",
      daughter: "Daughter",
      child: "Child",
      grandparent: "Grandparent",
      partner: "Partner / Spouse",
      friend: "Friend",
      other: "Other",
    };
    return labels[rel] ?? rel;
  }

  /** Ionicons name for a relationship value. */
  relationshipIcon(rel: MemberRelationship): string {
    const icons: Record<MemberRelationship, string> = {
      dad: "male-outline",
      mom: "female-outline",
      son: "man-outline",
      daughter: "woman-outline",
      child: "happy-outline",
      grandparent: "people-outline",
      partner: "heart-outline",
      friend: "person-add-outline",
      other: "ellipsis-horizontal-outline",
    };
    return icons[rel] ?? "person-outline";
  }

  /** Refresh the selected friend's position (or the user's own fix). */
  async refreshDetail(): Promise<void> {
    if (this.isRefreshingDetail) return;
    this.isRefreshingDetail = true;
    this.cdr.markForCheck();

    try {
      const refreshed = this.selectedIsSelf
        ? await this.getInitialPosition()
        : await this.refreshCircleLocations(false);

      void this.showUpdateToast(
        refreshed ? "Location refreshed" : "Couldn't refresh location",
        refreshed ? undefined : "alert-circle-outline"
      );
    } catch (error) {
      console.error("Failed to refresh location:", error);
      void this.showUpdateToast(
        "Couldn't refresh location",
        "alert-circle-outline"
      );
    } finally {
      this.isRefreshingDetail = false;
      this.cdr.markForCheck();
    }
  }

  onPing(type: PingType, event?: MouseEvent): void {
    void this.pingMember(type);
    this.showPingSentEmoji(type, event);
  }

  /**
   * Pop an emoji from the tapped ping chip so the sender instantly sees that
   * the ping was sent — the receiver's phone answers with a vibration.
   */
  private showPingSentEmoji(type: PingType, event?: MouseEvent): void {
    if (!event) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const emoji = this.PING_EMOJI[type] ?? "📍";
    const el = document.createElement("span");
    el.textContent = emoji;
    el.className = "ping-sent-emoji";
    el.setAttribute("aria-hidden", "true");
    el.style.left = `${event.clientX}px`;
    el.style.top = `${event.clientY}px`;
    document.body.appendChild(el);
    window.setTimeout(() => el.remove(), 1200);
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
   * Send a quick ping to the selected circle mate. The recipient's app picks it
   * up on its next poll and vibrates there; the sender gets no success feedback
   * so only the person being pinged is alerted. Errors are still surfaced.
   */
  async pingMember(type: PingType): Promise<void> {
    const member = this.liveSelectedMember;
    if (!member || this.isSendingPing) return;

    this.isSendingPing = true;
    this.cdr.markForCheck();
    try {
      await firstValueFrom(
        this.pingService.sendPing({
          target_user_id: member.user_id,
          ping_type: type,
        })
      );
    } catch (error) {
      console.error("Failed to send ping:", error);
      void this.showUpdateToast("Couldn't send ping", "alert-circle-outline");
    } finally {
      this.isSendingPing = false;
      this.cdr.markForCheck();
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

  /** The selected member kept in sync with the latest circle poll. */
  get liveSelectedMember(): CircleMemberLocation | null {
    const selected = this.selectedMember;
    if (!selected) return null;
    return (
      this.circleMembers.find((m) => m.user_id === selected.user_id) ?? selected
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

  /** Absolute URL of the avatar photo for the open detail sheet. */
  get detailPictureUrl(): string | null {
    if (this.selectedIsSelf) {
      return this.authService.pictureUrl(this.currentUser?.profile_picture);
    }
    return this.authService.pictureUrl(this.liveSelectedMember?.profile_picture);
  }

  /** Hero avatar photo; null keeps the CSS role colours + initials fallback. */
  get detailAvatarBackground(): string | null {
    const url = this.detailPictureUrl;
    return url ? `url("${url}") center / cover no-repeat` : null;
  }

  /** Initials are only shown when there is no profile picture. */
  get detailAvatarLabel(): string {
    return this.detailPictureUrl ? "" : this.detailInitials;
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
      ? `±${Math.round(this.lastAccuracy)} m`
      : "—";
  }

  get detailDistanceLabel(): string {
    const meters = this.selectedDistanceMeters;
    if (meters === null || meters === undefined) return "—";
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
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

  toggleCircleList(): void {
    // The two sheets are mutually exclusive: the friend detail owns the edge.
    if (this.detailSheetOpen) return;
    if (this.isMobileLayout()) {
      this.setSheetSnap(this.circleSheetSnap === "peek" ? "half" : "peek");
      return;
    }
    this.showCircleList = !this.showCircleList;
  }

  // ---------------------------------------------------------------------------
  // Mobile circle bottom sheet
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
    const panel = this.circlePanel?.nativeElement;
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
    const panel = this.circlePanel?.nativeElement;
    if (!panel) return 82;
    const value = parseFloat(
      getComputedStyle(panel).getPropertyValue("--circle-peek-height")
    );
    return Number.isFinite(value) ? value : 82;
  }

  private applySheetSnap(): void {
    const panel = this.circlePanel?.nativeElement;
    if (!panel) return;

    if (!this.isMobileLayout()) {
      // Desktop uses the right-hand sidebar transition, not a transform.
      panel.style.transform = "";
      this.setToolbarHidden(false);
      this.syncFabPosition(0);
      return;
    }

    // The circle sheet yields the bottom edge while the friend detail is open.
    if (this.detailSheetOpen) {
      panel.style.transform = "translateY(100%)";
      this.setToolbarHidden(false);
      this.syncFabPosition(0);
      return;
    }

    const offset = this.sheetOffsetFor(this.circleSheetSnap);
    panel.style.transform = `translateY(${offset}px)`;
    // The sheet owns the whole screen at full height: let the toolbar slide
    // away so the circle list gets an unobstructed view.
    this.setToolbarHidden(this.circleSheetSnap === "full");
    this.syncFabPosition(offset);
  }

  /** Toggle the floating toolbar while the circle sheet is dragged. */
  private setToolbarHidden(hidden: boolean): void {
    if (this.toolbarHidden === hidden) return;
    this.toolbarHidden = hidden;
    this.cdr.markForCheck();
  }

  /**
   * Keep the map action stack glued 14px above the circle sheet's top edge so
   * it rides along while the sheet is dragged and stays there after a snap.
   * The stack never climbs past the floating toolbar.
   */
  private syncFabPosition(panelOffset: number): void {
    const fabs = this.mapFabs?.nativeElement;
    const panel = this.circlePanel?.nativeElement;
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

    const panel = this.circlePanel?.nativeElement;
    if (!panel) return;

    if (this.isSheetDragging) {
      this.endSheetDrag();
    }

    this.sheetDragStartY = event.clientY;
    this.sheetDragStartOffset = this.sheetOffsetFor(this.circleSheetSnap);
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
    const panel = this.circlePanel?.nativeElement;
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
    this.circlePanel?.nativeElement.classList.remove("dragging");
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
    this.setSheetSnap(this.circleSheetSnap === "peek" ? "half" : "peek");
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
    this.circleSheetSnap = snap;
    this.applySheetSnap();
    this.cdr.markForCheck();
  }

  closeCirclePanel(): void {
    if (this.isMobileLayout()) {
      this.setSheetSnap("peek");
    } else {
      this.showCircleList = false;
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

  // ---------------------------------------------------------------------------
  // Circle chip dropdown (create / join)
  // ---------------------------------------------------------------------------

  /**
   * The toolbar circle chip opens a dropdown anchored to the pill itself, so it
   * appears directly under the chip instead of sliding up from the bottom.
   * The chip expands first, then the dropdown is sized to the expanded chip so
   * the two read as one connected card.
   */
  async presentCircleOptions(event: Event): Promise<void> {
    if (this.circleChipOpen) return;

    const anchor = event.currentTarget as HTMLElement;
    this.circleChipOpen = true;
    // Render the expanded chip before presenting so Ionic measures its final
    // width (not the collapsed pill's) when it sizes the popover.
    this.cdr.detectChanges();

    // First open before the circle list has arrived: wait for it so the menu
    // is never empty. Every later open presents instantly from cache and
    // refreshes quietly in the background (a network round-trip here made the
    // menu feel laggy).
    if (!this.circlesLoaded) {
      const previousActiveId = this.activeCircleId;
      await this.loadCircles();
      if (previousActiveId !== this.activeCircleId) {
        await this.loadCircleMembers(false);
      }
    } else {
      void this.refreshCirclesInBackground();
    }

    const popover = await this.popoverCtrl.create({
      component: CircleMenuPopoverComponent,
      componentProps: {
        circleName: this.activeCircleName,
        circles: this.circles,
        activeCircleId: this.activeCircleId,
      },
      // Anchor to the button itself: event.target can be the inner label span.
      event: { target: anchor } as unknown as Event,
      side: "bottom",
      alignment: "center",
      arrow: false,
      showBackdrop: true,
      cssClass: "circle-menu-popover",
      // Ionic sets the popover width from the anchor's exact (sub-pixel) rect,
      // so the dropdown lines up with the expanded chip on both edges.
      size: "cover",
    });
    // The backdrop hole is a CSS variable read via ::part(backdrop) so it is
    // already in effect on the backdrop's very first frame (no dim flash).
    popover.style.setProperty(
      "--circle-chip-hole",
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
        "--circle-chip-hole",
        this.buildBackdropHolePath(anchor)
      );
    };
    window.addEventListener("resize", followChip);
    window.addEventListener("orientationchange", followChip);

    // Act after the popover closes so the next alert opens on a clean backdrop.
    const { data } = await popover.onWillDismiss<CircleMenuResult>();
    popover.removeEventListener("click", dismissOnChipTap);
    window.removeEventListener("resize", followChip);
    window.removeEventListener("orientationchange", followChip);
    this.circleChipOpen = false;
    this.cdr.markForCheck();

    if (!data) return;

    if (data.action === "create") {
      void this.createCircle();
    } else if (data.action === "join") {
      void this.joinCircle();
    } else if (data.action === "switch") {
      void this.switchCircle(data.circleId);
    }
  }

  /**
   * Quietly refetch the circle list after the dropdown is already on screen so
   * circles created/left elsewhere show up next time without delaying this open.
   */
  private async refreshCirclesInBackground(): Promise<void> {
    const previousActiveId = this.activeCircleId;
    await this.loadCircles();
    if (previousActiveId !== this.activeCircleId) {
      await this.loadCircleMembers(false);
    }
  }

  /** Swap the map over to another circle and reload its members and geofences. */
  private async switchCircle(circleId: number): Promise<void> {
    if (circleId === this.activeCircleId) return;
    this.activeCircleId = circleId;
    this.persistActiveCircle(
      this.circles.find((circle) => circle.id === circleId)?.squad_name
    );
    this.cdr.markForCheck();
    await this.loadCircleMembers(false);
  }

  /**
   * Leave the circle open in the circle panel. Confirmation and the reload happen
   * here so the panel's footer button stays a plain click handler.
   */
  async leaveActiveCircle(): Promise<void> {
    const circleId = this.activeCircleId;
    if (circleId === null) return;

    const name =
      this.circles.find((circle) => circle.id === circleId)?.squad_name ??
      this.activeCircleName;
    const alert = await this.alertCtrl.create({
      header: "Leave Circle",
      message: `Are you sure you want to leave "${name}"?`,
      buttons: [
        { text: "Cancel", role: "cancel" },
        {
          text: "Leave",
          role: "destructive",
          handler: () => {
            void this.doLeaveCircle(circleId);
          },
        },
      ],
    });
    await alert.present();
  }

  /**
   * Leave a circle, then move the map on: the circle list is refetched so the
   * active circle falls back to the next one (or to none at all).
   */
  private async doLeaveCircle(circleId: number): Promise<void> {
    const loading = await this.loadingCtrl.create({ message: "Leaving circle..." });
    await loading.present();

    try {
      await firstValueFrom(this.circleService.leaveCircle(circleId));
      await loading.dismiss();
      void this.showUpdateToast("Left circle");
      await this.loadCircles();
      if (this.activeCircleId === null) {
        // Left the last circle: drop its geofence circles from the map.
        this.geofences = [];
        this.renderGeofences();
      }
      await this.loadCircleMembers(false);
      this.cdr.markForCheck();
    } catch (error) {
      await loading.dismiss();
      console.error("Leave circle failed:", error);
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

  private async createCircle(): Promise<void> {
    this.isCircleFormModalOpen = true;
    this.cdr.markForCheck();
    try {
      const { CreateCircleModalComponent } = await import(
        "./create-circle-modal/create-circle-modal.component"
      );
      const modal = await this.modalCtrl.create({
        component: CreateCircleModalComponent,
        cssClass: "circle-form-modal",
        backdropDismiss: true,
      });
      await modal.present();

      const { data, role } = await modal.onWillDismiss<string>();
      if (role === "confirm" && data) {
        await this.doCreateCircle(data);
      }
    } finally {
      this.isCircleFormModalOpen = false;
      this.cdr.markForCheck();
    }
  }

  private async doCreateCircle(name: string): Promise<void> {
    const loading = await this.loadingCtrl.create({ message: "Creating circle..." });
    await loading.present();
    try {
      const circle = await firstValueFrom(
        this.circleService.createCircle({ squad_name: name })
      );
      await loading.dismiss();
      void this.showUpdateToast("Circle created");
      // Show the new circle straight away instead of staying on the old one.
      if (circle?.id) {
        this.activeCircleId = circle.id;
        this.persistActiveCircle(circle.squad_name);
      }
      await this.loadCircleMembers();
    } catch (error) {
      await loading.dismiss();
      console.error("Create circle failed:", error);
      void this.showUpdateToast("Failed to create circle");
    }
  }

  private async joinCircle(): Promise<void> {
    this.isCircleFormModalOpen = true;
    this.cdr.markForCheck();
    try {
      const { JoinCircleModalComponent } = await import(
        "./join-circle-modal/join-circle-modal.component"
      );
      const modal = await this.modalCtrl.create({
        component: JoinCircleModalComponent,
        cssClass: "circle-form-modal",
        backdropDismiss: true,
      });
      await modal.present();

      const { data, role } = await modal.onWillDismiss<string>();
      if (role === "confirm" && data) {
        await this.doJoinCircle(data);
      }
    } finally {
      this.isCircleFormModalOpen = false;
      this.cdr.markForCheck();
    }
  }

  private async doJoinCircle(code: string): Promise<void> {
    const loading = await this.loadingCtrl.create({ message: "Joining circle..." });
    await loading.present();
    try {
      const circle = await firstValueFrom(
        this.circleService.joinCircle({ join_code: code })
      );
      await loading.dismiss();
      void this.showUpdateToast("Joined circle");
      // Show the newly joined circle straight away.
      if (circle?.id) {
        this.activeCircleId = circle.id;
        this.persistActiveCircle(circle.squad_name);
      }
      await this.loadCircleMembers();
    } catch (error) {
      await loading.dismiss();
      console.error("Join circle failed:", error);
      const message =
        (error as { error?: { message?: string } })?.error?.message ??
        "Failed to join circle";
      void this.showUpdateToast(message);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers used by the template
  // ---------------------------------------------------------------------------

  /** Group name shown in the toolbar: the active circle, or a neutral fallback. */
  get activeCircleName(): string {
    const active = this.circles.find((circle) => circle.id === this.activeCircleId);
    if (active) return active.squad_name;
    if (this.activeCircleNameCache) return this.activeCircleNameCache;
    return this.circlesLoaded ? "Konek Map" : "Loading…";
  }

  /** Whether the panel's leave action applies: a circle must be selected. */
  get hasActiveCircle(): boolean {
    return this.activeCircleId !== null;
  }

  /** Transient top-of-screen confirmation, replacing the old map pill. */
  private async showUpdateToast(
    message: string,
    icon = "checkmark-circle-outline",
    options: { cssClass?: string; duration?: number } = {}
  ): Promise<void> {
    try {
      if (this.activeToast) {
        await this.activeToast.dismiss();
        this.activeToast = null;
      }
      this.activeToast = await this.toastCtrl.create({
        message,
        icon,
        duration: options.duration ?? 2200,
        position: "top",
        cssClass: options.cssClass
          ? `update-toast ${options.cssClass}`
          : "update-toast",
      });
      await this.activeToast.present();
    } catch {
      // Toasts are cosmetic: never let one break location tracking.
    }
  }

  isMemberOnline(member: CircleMemberLocation): boolean {
    // Self reflects the local master switch immediately; others only go
    // offline once their last server location is older than three minutes.
    if (member.user_id === this.currentUser?.id) {
      return this.trackingEnabled && this.isTracking;
    }
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

  /** Wipe all per-account map state (called when a different user logs in). */
  private resetMapState(): void {
    // Stop tracking for the old user.
    if (this.watchId) {
      void this.geolocationService.clearWatch(this.watchId);
      this.watchId = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    void this.backgroundTracker.stop();

    // Clear all cached circle/member/geofence data.
    this.circleMembers = [];
    this.circles = [];
    this.circleMarkers.forEach((marker) => marker.remove());
    this.circleMarkers.clear();
    this.circleMarkerEls.clear();
    this.geofences = [];
    this.insideGeofence.clear();
    this.activeCircleId = null;
    this.activeCircleNameCache = null;
    this.circlesLoaded = false;
    this.circlesLoadPromise = null;
    this.clearStoredCircle();

    // Close any open sheets/detail.
    this.closeDetailSheet();
    this.closeCirclePanel();

    // Reset connection status.
    this.connectionStatus = "connecting";
    this.isTracking = false;
    this.lastKnownFix = null;
    this.lastAccuracy = null;
    this.lastFixAt = null;

    // Restart for the new user (ngOnInit already ran, so just re-fetch).
    void this.loadCircleMembers();
  }

  private cleanup(): void {
    this.trackingSubscription?.unsubscribe();
    this.trackingSubscription = null;
    this.authSubscription?.unsubscribe();
    this.authSubscription = null;
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
    if (this.notificationPollTimer) {
      clearInterval(this.notificationPollTimer);
      this.notificationPollTimer = null;
    }
    if (this.pingScrollFrame !== null) {
      cancelAnimationFrame(this.pingScrollFrame);
      this.pingScrollFrame = null;
    }
    this.pingScrollTarget = null;
    this.pingPollInFlight = false;
    this.notificationPollInFlight = false;
    this.circleRefreshPromise = null;
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
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
      this.circleMarkers.forEach((marker) => marker.remove());
      this.userMarker?.remove();
      this.geofencePopup?.remove();
      this.map.remove();
      this.map = null;
    }
    this.zoomControl = null;
    this.attributionControl = null;
    this.circleMarkers.clear();
    this.circleMarkerEls.clear();
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
