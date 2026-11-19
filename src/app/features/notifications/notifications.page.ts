import { ChangeDetectorRef, Component, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { firstValueFrom } from "rxjs";
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonRefresher,
  IonRefresherContent,
  IonTitle,
  IonToolbar,
  ToastController,
} from "@ionic/angular";
import type { ViewWillEnter } from "@ionic/angular";
import { addIcons } from "ionicons";
import {
  chatbubbleEllipsesOutline,
  checkmarkDoneOutline,
  cloudOfflineOutline,
  informationCircleOutline,
  locationOutline,
  notificationsOffOutline,
  notificationsOutline,
  peopleOutline,
  refreshOutline,
  sparklesOutline,
  trashOutline,
} from "ionicons/icons";
import { NotificationService } from "../../core/services/notification.service";
import { AppNotification } from "../../core/models/notification.models";

/**
 * The user's in-app inbox: welcome messages, circle updates, and future
 * system notices. Email delivery is separate; everything addressable to the
 * account also appears here.
 */
@Component({
  selector: "app-notifications",
  templateUrl: "./notifications.page.html",
  styleUrls: ["./notifications.page.scss"],
  standalone: true,
  imports: [
    CommonModule,
    IonBackButton,
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonIcon,
    IonRefresher,
    IonRefresherContent,
    IonTitle,
    IonToolbar,
  ],
})
export class NotificationsPage implements ViewWillEnter {
  private readonly notificationService = inject(NotificationService);
  private readonly toastCtrl = inject(ToastController);
  private readonly cdr = inject(ChangeDetectorRef);

  notifications: AppNotification[] = [];
  unreadCount = 0;
  isLoading = true;
  loadError = false;
  loadErrorMessage = "";
  isMarkingAll = false;
  /** IDs currently waiting on a mark-read or delete request. */
  busyIds = new Set<number>();

  /** Age labels grow with time since the list was fetched. */
  private loadedAt = Date.now();

  constructor() {
    addIcons({
      chatbubbleEllipsesOutline,
      checkmarkDoneOutline,
      cloudOfflineOutline,
      informationCircleOutline,
      locationOutline,
      notificationsOffOutline,
      notificationsOutline,
      peopleOutline,
      refreshOutline,
      sparklesOutline,
      trashOutline,
    });
  }

  ionViewWillEnter(): void {
    void this.loadNotifications();
  }

  async loadNotifications(showSpinner = true): Promise<void> {
    this.isLoading = showSpinner && this.notifications.length === 0;
    this.loadError = false;
    this.loadErrorMessage = "";
    this.cdr.markForCheck();

    try {
      const page = await firstValueFrom(
        this.notificationService.getNotifications({ limit: 100 })
      );
      this.notifications = page.items;
      this.unreadCount = page.unreadCount;
      this.loadedAt = Date.now();
    } catch (error) {
      console.error("Failed to load notifications:", error);
      this.loadError = true;
      this.loadErrorMessage =
        (error as { error?: { message?: string } })?.error?.message ??
        "Check your connection and try again.";
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  async doRefresh(event: CustomEvent): Promise<void> {
    try {
      await this.loadNotifications(false);
      if (this.loadError) {
        await this.showToast("Couldn't refresh notifications");
      }
    } finally {
      (event.target as HTMLIonRefresherElement).complete();
    }
  }

  /** Tapping a card opens it: the unread state clears on the server. */
  async openNotification(item: AppNotification): Promise<void> {
    if (item.read_at || this.busyIds.has(item.id)) return;

    this.busyIds.add(item.id);
    this.cdr.markForCheck();

    try {
      const unread = await firstValueFrom(
        this.notificationService.markRead(item.id)
      );
      item.read_at = new Date().toISOString();
      this.unreadCount = unread;
    } catch (error) {
      console.error("Failed to mark notification read:", error);
      await this.showToast("Couldn't mark notification as read");
    } finally {
      this.busyIds.delete(item.id);
      this.cdr.markForCheck();
    }
  }

  async markAllRead(): Promise<void> {
    if (this.unreadCount === 0 || this.isMarkingAll) return;

    this.isMarkingAll = true;
    this.cdr.markForCheck();

    try {
      const unread = await firstValueFrom(this.notificationService.markAllRead());
      const now = new Date().toISOString();
      this.notifications = this.notifications.map((item) => ({
        ...item,
        read_at: item.read_at ?? now,
      }));
      this.unreadCount = unread;
      await this.showToast("All notifications marked as read");
    } catch (error) {
      console.error("Failed to mark all notifications read:", error);
      await this.showToast("Couldn't mark all notifications as read");
    } finally {
      this.isMarkingAll = false;
      this.cdr.markForCheck();
    }
  }

  async deleteNotification(
    item: AppNotification,
    event: Event
  ): Promise<void> {
    event.stopPropagation();
    if (this.busyIds.has(item.id)) return;

    this.busyIds.add(item.id);
    this.cdr.markForCheck();

    try {
      const unread = await firstValueFrom(
        this.notificationService.delete(item.id)
      );
      this.notifications = this.notifications.filter(
        (entry) => entry.id !== item.id
      );
      this.unreadCount = unread;
      await this.showToast("Notification deleted");
    } catch (error) {
      console.error("Failed to delete notification:", error);
      await this.showToast("Couldn't delete notification");
    } finally {
      this.busyIds.delete(item.id);
      this.cdr.markForCheck();
    }
  }

  /** Ionicons name for a notification type. */
  iconFor(type: string): string {
    switch (type) {
      case "welcome":
        return "sparkles-outline";
      case "circle":
        return "people-outline";
      case "ping":
        return "chatbubble-ellipses-outline";
      case "geofence":
        return "location-outline";
      default:
        return "information-circle-outline";
    }
  }

  /** "Just now", "12m ago", "3h ago", "2d ago". */
  relativeTime(item: AppNotification): string {
    const elapsed = Math.floor((Date.now() - this.loadedAt) / 1000);
    const seconds = Math.max(0, item.age_seconds + elapsed);

    if (seconds < 45) return "Just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `${weeks}w ago`;
    return new Date(item.created_at.replace(" ", "T")).toLocaleDateString();
  }

  isBusy(item: AppNotification): boolean {
    return this.busyIds.has(item.id);
  }

  private async showToast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2200,
      position: "bottom",
      cssClass: "custom-toast",
    });
    await toast.present();
  }
}
