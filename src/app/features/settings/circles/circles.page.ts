import { ChangeDetectorRef, Component, inject } from "@angular/core";
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
import { SquadService } from "../../../core/services/squad.service";
import { Squad } from "../../../core/models/squad.models";
import { avatarGradient, initialsFor } from "../../../core/utils/avatar";

/**
 * Settings → Circle management.
 *
 * Keeps the settings page short: everything about circles (create, join,
 * inspect members, change roles, leave) lives on this screen.
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
  private readonly squadService = inject(SquadService);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly cdr = inject(ChangeDetectorRef);

  circles: Squad[] = [];
  isLoading = true;
  loadError = false;

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
      this.circles = (await firstValueFrom(this.squadService.getUserSquads())) ?? [];
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
      this.circles = (await firstValueFrom(this.squadService.getUserSquads())) ?? [];
      this.loadError = false;
    } catch (error) {
      console.error("Failed to refresh circles:", error);
      await this.showToast("Couldn't refresh circles");
    } finally {
      (event.target as HTMLIonRefresherElement).complete();
      this.cdr.markForCheck();
    }
  }

  isAdmin(circle: Squad): boolean {
    return (circle.user_role ?? circle.role) === "admin";
  }

  initials(name: string): string {
    return initialsFor(name);
  }

  gradient(name: string): string {
    return avatarGradient(name);
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

  async openCircle(circle: Squad): Promise<void> {
    const { CircleManageModalComponent } = await import(
      "../circle-manage/circle-manage.modal"
    );

    const modal = await this.modalCtrl.create({
      component: CircleManageModalComponent,
      componentProps: { squad: circle },
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
    const { CreateSquadModalComponent } = await import(
      "../../map/create-squad-modal/create-squad-modal.component"
    );

    const modal = await this.modalCtrl.create({
      component: CreateSquadModalComponent,
      cssClass: "squad-form-modal",
      backdropDismiss: true,
    });
    await modal.present();

    const { data, role } = await modal.onWillDismiss<string>();
    if (role !== "confirm" || !data) return;

    const loading = await this.loadingCtrl.create({ message: "Creating circle..." });
    await loading.present();

    try {
      await firstValueFrom(this.squadService.createSquad({ squad_name: data }));
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
    const { JoinSquadModalComponent } = await import(
      "../../map/join-squad-modal/join-squad-modal.component"
    );

    const modal = await this.modalCtrl.create({
      component: JoinSquadModalComponent,
      cssClass: "squad-form-modal",
      backdropDismiss: true,
    });
    await modal.present();

    const { data, role } = await modal.onWillDismiss<string>();
    if (role !== "confirm" || !data) return;

    const loading = await this.loadingCtrl.create({ message: "Joining circle..." });
    await loading.present();

    try {
      await firstValueFrom(
        this.squadService.joinSquad({ join_code: data.toUpperCase() })
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
