import { Component, EventEmitter, Input, Output } from "@angular/core";
import { CommonModule } from "@angular/common";
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonModal,
  IonTitle,
  IonToolbar,
} from "@ionic/angular";
import { addIcons } from "ionicons";
import {
  batteryChargingOutline,
  batteryDeadOutline,
  batteryFullOutline,
  batteryHalfOutline,
  closeOutline,
  locateOutline,
  navigateOutline,
  timeOutline,
} from "ionicons/icons";
import { SquadMemberLocation } from "../../../core/models/location.models";

/**
 * Draggable bottom sheet shown when a map marker is tapped. It renders the
 * tapped member's live details (battery and distance for squad members, GPS
 * accuracy for yourself) and exposes actions back to the map page.
 */
@Component({
  selector: "app-member-detail-sheet",
  standalone: true,
  imports: [
    CommonModule,
    IonModal,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonIcon,
  ],
  templateUrl: "./member-detail-sheet.component.html",
  styleUrls: ["./member-detail-sheet.component.scss"],
})
export class MemberDetailSheetComponent {
  @Input() isOpen = false;
  /** True when the sheet describes the signed-in user's own marker. */
  @Input() isSelf = false;
  @Input() member: SquadMemberLocation | null = null;
  @Input() selfUsername = "";
  @Input() isOnline = false;
  @Input() isTracking = false;
  /** GPS accuracy in metres of the user's own last fix. */
  @Input() accuracy: number | null = null;
  /** ISO timestamp of the user's own last fix. */
  @Input() updatedAt: string | null = null;
  /** Distance in metres between the user and the selected member. */
  @Input() distanceMeters: number | null = null;

  @Output() sheetClosed = new EventEmitter<void>();
  @Output() centerRequested = new EventEmitter<void>();

  constructor() {
    addIcons({
      batteryChargingOutline,
      batteryDeadOutline,
      batteryFullOutline,
      batteryHalfOutline,
      closeOutline,
      locateOutline,
      navigateOutline,
      timeOutline,
    });
  }

  get displayName(): string {
    if (this.isSelf) return this.selfUsername || "You";
    return this.member?.username ?? "Squad member";
  }

  /** Up to two initials for the avatar bubble. */
  get initials(): string {
    const name = (this.member?.username ?? "").trim();
    if (!name) return "?";
    const parts = name.split(/[\s._-]+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
  }

  get roleLabel(): string {
    return this.member?.role === "admin" ? "Admin" : "Member";
  }

  get statusLabel(): string {
    if (this.isSelf) return this.isTracking ? "Sharing live" : "Not sharing";
    return this.isOnline ? "Online" : "Offline";
  }

  get statusOnline(): boolean {
    return this.isSelf ? this.isTracking : this.isOnline;
  }

  get lastUpdateLabel(): string {
    const stamp = this.isSelf ? this.updatedAt : (this.member?.timestamp ?? null);
    if (!stamp) return "Waiting for a fix";
    return this.timeAgo(new Date(stamp));
  }

  get accuracyLabel(): string {
    return this.accuracy && this.accuracy > 0 ? `±${Math.round(this.accuracy)} m` : "—";
  }

  get distanceLabel(): string {
    const meters = this.distanceMeters;
    if (meters === null || meters === undefined) return "—";
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  }

  get hasBattery(): boolean {
    const level = this.member?.battery_level;
    return level !== null && level !== undefined;
  }

  get batteryLabel(): string {
    if (!this.hasBattery) return "Not available";
    const level = this.member?.battery_level;
    return this.member?.is_charging ? `${level}% · charging` : `${level}%`;
  }

  get batteryIcon(): string {
    if (this.member?.is_charging) return "battery-charging-outline";
    const level = this.member?.battery_level ?? null;
    if (level === null) return "battery-dead-outline";
    if (level >= 80) return "battery-full-outline";
    if (level >= 30) return "battery-half-outline";
    return "battery-dead-outline";
  }

  /** Open turn-by-turn directions to the member in the system maps app. */
  openDirections(): void {
    if (!this.member) return;
    const destination = `${this.member.latitude},${this.member.longitude}`;
    window.open(
      `https://www.google.com/maps/dir/?api=1&destination=${destination}`,
      "_blank",
      "noopener"
    );
  }

  private timeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }
}
