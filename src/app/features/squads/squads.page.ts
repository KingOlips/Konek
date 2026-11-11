import { ChangeDetectorRef, Component, inject, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterModule } from "@angular/router";
import { firstValueFrom } from "rxjs";
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonButton,
  IonIcon,
  IonBackButton,
  IonLabel,
  IonItem,
  IonItemSliding,
  IonItemOptions,
  IonItemOption,
  IonList,
  IonSpinner,
  IonRefresher,
  IonRefresherContent,
  ActionSheetController,
  AlertController,
  LoadingController,
  ToastController,
} from "@ionic/angular";
import { SquadService } from "../../core/services/squad.service";
import { Squad } from "../../core/models/squad.models";
import { AuthService } from "../../core/services/auth.service";
import { addIcons } from "ionicons";
import {
  addOutline,
  peopleOutline,
  keyOutline,
  copyOutline,
  chevronForwardOutline,
  cloudOfflineOutline,
  refreshOutline,
} from "ionicons/icons";

@Component({
  selector: "app-squads",
  templateUrl: "./squads.page.html",
  styleUrls: ["./squads.page.scss"],
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonButton,
    IonIcon,
    IonBackButton,
    IonLabel,
    IonItem,
    IonItemSliding,
    IonItemOptions,
    IonItemOption,
    IonList,
    IonSpinner,
    IonRefresher,
    IonRefresherContent,
  ],
})
export class SquadsPage implements OnInit {
  private readonly squadService = inject(SquadService);
  private readonly authService = inject(AuthService);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly alertCtrl = inject(AlertController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);
  private readonly cdr = inject(ChangeDetectorRef);

  squads: Squad[] = [];
  isLoading = false;
  loadError = false;

  constructor() {
    addIcons({
      addOutline,
      peopleOutline,
      keyOutline,
      copyOutline,
      chevronForwardOutline,
      cloudOfflineOutline,
      refreshOutline,
    });
  }

  ngOnInit(): void {
    this.loadSquads();
  }

  async loadSquads(): Promise<void> {
    this.isLoading = true;
    this.loadError = false;
    try {
      const squads = await firstValueFrom(this.squadService.getUserSquads());
      this.squads = squads ?? [];
      this.cdr.markForCheck();
    } catch (error) {
      console.error("Failed to load squads:", error);
      this.loadError = true;
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  /** Pull-to-refresh: reload quietly without swapping the list for a spinner. */
  async doRefresh(event: CustomEvent): Promise<void> {
    try {
      const squads = await firstValueFrom(this.squadService.getUserSquads());
      this.squads = squads ?? [];
      this.loadError = false;
      this.cdr.markForCheck();
    } catch (error) {
      console.error("Failed to refresh squads:", error);
      await this.showToast("Failed to refresh circles");
    } finally {
      (event.target as HTMLIonRefresherElement).complete();
    }
  }

  squadRole(squad: Squad): "admin" | "member" {
    return (squad.user_role ?? squad.role ?? "member") as "admin" | "member";
  }

  isAdmin(squad: Squad): boolean {
    return this.squadRole(squad) === "admin";
  }

  /** "Alpha Team" -> "AT", "Alpha" -> "A". */
  initials(name: string): string {
    const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    const first = parts[0].charAt(0);
    const second = parts.length > 1 ? parts[1].charAt(0) : "";
    return (first + second).toUpperCase();
  }

  /** Single entry point for both squad actions, used by the empty state and list footer. */
  async presentAddOptions(): Promise<void> {
    const sheet = await this.actionSheetCtrl.create({
      header: "Add a circle",
      buttons: [
        {
          text: "Create circle",
          icon: "add-outline",
          handler: () => void this.createSquad(),
        },
        {
          text: "Join with a code",
          icon: "key-outline",
          handler: () => void this.joinSquad(),
        },
        { text: "Cancel", role: "cancel" },
      ],
    });
    await sheet.present();
  }

  async createSquad(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: "Create Circle",
      message: "Enter a name for your new circle",
      inputs: [
        {
          name: "name",
          type: "text",
          placeholder: "Circle name",
        },
      ],
      buttons: [
        { text: "Cancel", role: "cancel" },
        {
          text: "Create",
          handler: async (data) => {
            if (data.name?.trim()) {
              await this.doCreateSquad(data.name.trim());
            }
          },
        },
      ],
    });
    await alert.present();
  }

  private async doCreateSquad(name: string): Promise<void> {
    const loading = await this.loadingCtrl.create({ message: "Creating circle..." });
    await loading.present();

    try {
      const squad = await firstValueFrom(this.squadService.createSquad({ squad_name: name }));
      await loading.dismiss();
      if (squad) {
        this.squads.unshift(squad);
        this.cdr.markForCheck();
        this.showToast("Circle created successfully!");
      }
    } catch (error) {
      await loading.dismiss();
      console.error("Create squad failed:", error);
      this.showToast("Failed to create circle");
    }
  }

  async joinSquad(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: "Join Circle",
      message: "Enter the join code from your circle admin",
      inputs: [
        {
          name: "code",
          type: "text",
          placeholder: "Join code (e.g., KONEK123)",
        },
      ],
      buttons: [
        { text: "Cancel", role: "cancel" },
        {
          text: "Join",
          handler: async (data) => {
            if (data.code?.trim()) {
              await this.doJoinSquad(data.code.trim().toUpperCase());
            }
          },
        },
      ],
    });
    await alert.present();
  }

  private async doJoinSquad(code: string): Promise<void> {
    const loading = await this.loadingCtrl.create({ message: "Joining circle..." });
    await loading.present();

    try {
      const squad = await firstValueFrom(this.squadService.joinSquad({ join_code: code }));
      await loading.dismiss();
      if (squad) {
        this.squads.unshift(squad);
        this.cdr.markForCheck();
        this.showToast("Successfully joined circle!");
      }
    } catch (error: any) {
      await loading.dismiss();
      console.error("Join squad failed:", error);
      const message = error.error?.message || "Failed to join circle";
      this.showToast(message);
    }
  }

  async leaveSquad(squad: Squad): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: "Leave Circle",
      message: `Are you sure you want to leave "${squad.squad_name}"?`,
      buttons: [
        { text: "Cancel", role: "cancel" },
        {
          text: "Leave",
          role: "destructive",
          handler: async () => await this.doLeaveSquad(squad),
        },
      ],
    });
    await alert.present();
  }

  private async doLeaveSquad(squad: Squad): Promise<void> {
    const loading = await this.loadingCtrl.create({ message: "Leaving circle..." });
    await loading.present();

    try {
      await firstValueFrom(this.squadService.leaveSquad(squad.id));
      await loading.dismiss();
      this.squads = this.squads.filter((s) => s.id !== squad.id);
      this.cdr.markForCheck();
      this.showToast("Left circle successfully");
    } catch (error) {
      await loading.dismiss();
      console.error("Leave squad failed:", error);
      // Surface the server's reason, e.g. "Cannot leave as sole admin…".
      const message =
        (error as { error?: { message?: string } })?.error?.message ??
        "Failed to leave circle";
      this.showToast(message);
    }
  }

  async viewSquad(squad: Squad): Promise<void> {
    const loading = await this.loadingCtrl.create({ message: "Loading members..." });
    await loading.present();

    try {
      const members = await firstValueFrom(this.squadService.getSquadMembers(squad.id));
      await loading.dismiss();

      const me = this.authService.getCurrentUser();
      const list = members.length
        ? members
            .map(
              (member) =>
                `${member.role === "admin" ? "★" : "•"} ${member.username}${
                  member.user_id === me?.id ? " (you)" : ""
                }`
            )
            .join("<br>")
        : "No members yet.";

      const alert = await this.alertCtrl.create({
        header: squad.squad_name,
        subHeader: `${members.length} member${members.length === 1 ? "" : "s"} · Code ${squad.join_code}`,
        message: list,
        buttons: [
          {
            text: "Copy code",
            handler: () => this.copyJoinCode(squad.join_code),
          },
          {
            text: "Leave",
            role: "destructive",
            handler: () => void this.leaveSquad(squad),
          },
          "Close",
        ],
      });
      await alert.present();
    } catch (error) {
      await loading.dismiss();
      console.error("Failed to load squad members:", error);
      this.showToast("Failed to load circle members");
    }
  }

  async copyJoinCode(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      await this.showToast("Join code copied!");
    } catch {
      await this.showToast(`Join code: ${code}`);
    }
  }

  private async showToast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      position: "bottom",
      cssClass: "custom-toast",
    });
    await toast.present();
  }
}