import { ChangeDetectorRef, Component, inject } from "@angular/core";
import { Router } from "@angular/router";
import { firstValueFrom } from "rxjs";
import {
  ActionSheetController,
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
  LoadingController,
  ModalController,
  ToastController,
} from "@ionic/angular";
import type { ViewWillEnter } from "@ionic/angular";
import { addIcons } from "ionicons";
import {
  addOutline,
  chevronForwardOutline,
  cloudOfflineOutline,
  keyOutline,
  peopleOutline,
  refreshOutline,
  shieldCheckmarkOutline,
} from "ionicons/icons";
import { CircleService } from "../../../core/services/circle.service";
import { Circle } from "../../../core/models/circle.models";

/**
 * Settings → Circle management.
 *
 * Keeps the settings page short: everything about circles (create, join,
 * inspect members, label relationships, leave) lives on this screen.
 */
@Component({
  selector: "app-circle-management",
  templateUrl: "./circles.page.html",
  styleUrls: ["./circles.page.scss"],
  standalone: true,
  imports: [
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
export class CircleManagementPage implements ViewWillEnter {
  private readonly circleService = inject(CircleService);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly router = inject(Router);

  circles: Circle[] = [];
  isLoading = true;
  loadError = false;

  /** `/circles` is reached from the map; the settings route backs to Settings. */
  get backHref(): string {
    return this.router.url.startsWith("/settings/circles")
      ? "/settings"
      : "/map";
  }

  constructor() {
    addIcons({
      addOutline,
      chevronForwardOutline,
      cloudOfflineOutline,
      keyOutline,
      peopleOutline,
      refreshOutline,
      shieldCheckmarkOutline,
    });
  }

  ionViewWillEnter(): void {
    void this.loadCircles();
  }

  async loadCircles(): Promise<void> {
    this.isLoading = this.circles.length === 0;
    this.loadError = false;
    this.cdr.markForCheck();

    try {
      this.circles = (await firstValueFrom(this.circleService.getUserCircles())) ?? [];
    } catch (error) {
      console.error("Failed to load circles:", error);
      this.loadError = true;
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  async doRefresh(event: CustomEvent): Promise<void> {
    try {
      this.circles = (await firstValueFrom(this.circleService.getUserCircles())) ?? [];
      this.loadError = false;
    } catch (error) {
      console.error("Failed to refresh circles:", error);
      await this.showToast("Couldn't refresh circles");
    } finally {
      (event.target as HTMLIonRefresherElement).complete();
      this.cdr.markForCheck();
    }
  }

  isAdmin(circle: Circle): boolean {
    return (circle.user_role ?? circle.role) === "admin";
  }

  /** Create or join, from the header button and the empty state. */
  async presentAddOptions(): Promise<void> {
    const sheet = await this.actionSheetCtrl.create({
      header: "Add a circle",
      buttons: [
        {
          text: "Create a circle",
          icon: "add-outline",
          handler: () => void this.createCircle(),
        },
        {
          text: "Join with a code",
          icon: "key-outline",
          handler: () => void this.joinCircle(),
        },
        { text: "Cancel", role: "cancel" },
      ],
    });
    await sheet.present();
  }

  async openCircle(circle: Circle): Promise<void> {
    const { CircleManageModalComponent } = await import(
      "../circle-manage/circle-manage.modal"
    );

    const modal = await this.modalCtrl.create({
      component: CircleManageModalComponent,
      componentProps: { circle: circle },
      cssClass: "circle-manage-modal",
      backdropDismiss: true,
    });

    await modal.present();
    const { data } = await modal.onWillDismiss<{ changed?: boolean; left?: boolean }>();

    if (data?.changed) {
      await this.loadCircles();
      if (data.left) {
        await this.showToast(`Left ${circle.squad_name}`);
      }
    }
  }

  async createCircle(): Promise<void> {
    const { CreateCircleModalComponent } = await import(
      "../../map/create-circle-modal/create-circle-modal.component"
    );

    const modal = await this.modalCtrl.create({
      component: CreateCircleModalComponent,
      cssClass: "circle-form-modal",
      backdropDismiss: true,
    });
    await modal.present();

    const { data, role } = await modal.onWillDismiss<string>();
    if (role !== "confirm" || !data) return;

    const loading = await this.loadingCtrl.create({ message: "Creating circle..." });
    await loading.present();

    try {
      await firstValueFrom(this.circleService.createCircle({ squad_name: data }));
      await loading.dismiss();
      await this.loadCircles();
      await this.showToast("Circle created");
    } catch (error) {
      await loading.dismiss();
      console.error("Create circle failed:", error);
      await this.showToast(this.errorMessage(error, "Failed to create circle"));
    }
  }

  async joinCircle(): Promise<void> {
    const { JoinCircleModalComponent } = await import(
      "../../map/join-circle-modal/join-circle-modal.component"
    );

    const modal = await this.modalCtrl.create({
      component: JoinCircleModalComponent,
      cssClass: "circle-form-modal",
      backdropDismiss: true,
    });
    await modal.present();

    const { data, role } = await modal.onWillDismiss<string>();
    if (role !== "confirm" || !data) return;

    const loading = await this.loadingCtrl.create({ message: "Joining circle..." });
    await loading.present();

    try {
      await firstValueFrom(
        this.circleService.joinCircle({ join_code: data.toUpperCase() })
      );
      await loading.dismiss();
      await this.loadCircles();
      await this.showToast("Joined circle");
    } catch (error) {
      await loading.dismiss();
      console.error("Join circle failed:", error);
      await this.showToast(this.errorMessage(error, "Failed to join circle"));
    }
  }

  private errorMessage(error: unknown, fallback: string): string {
    const message = (error as { error?: { message?: unknown } })?.error?.message;
    return typeof message === "string" && message ? message : fallback;
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
