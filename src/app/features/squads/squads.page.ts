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
  IonMenuButton,
  IonFab,
  IonFabButton,
  IonFabList,
  IonLabel,
  IonItem,
  IonAvatar,
  IonBadge,
  IonList,
  IonInput,
  IonAlert,
  IonSpinner,
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
  createOutline,
  trashOutline,
  exitOutline,
  shieldOutline,
  personOutline,
  chevronForwardOutline,
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
    IonMenuButton,
    IonFab,
    IonFabButton,
    IonFabList,
    IonLabel,
    IonItem,
    IonAvatar,
    IonBadge,
    IonList,
    IonInput,
    IonSpinner,
  ],
})
export class SquadsPage implements OnInit {
  private readonly squadService = inject(SquadService);
  private readonly authService = inject(AuthService);
  private readonly alertCtrl = inject(AlertController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);
  private readonly cdr = inject(ChangeDetectorRef);

  squads: Squad[] = [];
  isLoading = false;
  showCreateSquad = false;
  showJoinSquad = false;
  newSquadName = "";
  joinCode = "";

  constructor() {
    addIcons({
      addOutline,
      peopleOutline,
      keyOutline,
      createOutline,
      trashOutline,
      exitOutline,
      shieldOutline,
      personOutline,
      chevronForwardOutline,
    });
  }

  ngOnInit(): void {
    this.loadSquads();
  }

  async loadSquads(): Promise<void> {
    this.isLoading = true;
    try {
      const squads = await firstValueFrom(this.squadService.getUserSquads());
      this.squads = squads ?? [];
      this.cdr.markForCheck();
    } catch (error) {
      console.error("Failed to load squads:", error);
      this.showToast("Failed to load squads");
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  async createSquad(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: "Create Squad",
      message: "Enter a name for your new squad",
      inputs: [
        {
          name: "name",
          type: "text",
          placeholder: "Squad name",
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
    const loading = await this.loadingCtrl.create({ message: "Creating squad..." });
    await loading.present();

    try {
      const squad = await firstValueFrom(this.squadService.createSquad({ squad_name: name }));
      await loading.dismiss();
      if (squad) {
        this.squads.unshift(squad);
        this.cdr.markForCheck();
        this.showToast("Squad created successfully!");
      }
    } catch (error) {
      await loading.dismiss();
      console.error("Create squad failed:", error);
      this.showToast("Failed to create squad");
    }
  }

  async joinSquad(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: "Join Squad",
      message: "Enter the join code from your squad admin",
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
    const loading = await this.loadingCtrl.create({ message: "Joining squad..." });
    await loading.present();

    try {
      const squad = await firstValueFrom(this.squadService.joinSquad({ join_code: code }));
      await loading.dismiss();
      if (squad) {
        this.squads.unshift(squad);
        this.cdr.markForCheck();
        this.showToast("Successfully joined squad!");
      }
    } catch (error: any) {
      await loading.dismiss();
      console.error("Join squad failed:", error);
      const message = error.error?.message || "Failed to join squad";
      this.showToast(message);
    }
  }

  async leaveSquad(squad: Squad): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: "Leave Squad",
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
    const loading = await this.loadingCtrl.create({ message: "Leaving squad..." });
    await loading.present();

    try {
      await firstValueFrom(this.squadService.leaveSquad(squad.id));
      await loading.dismiss();
      this.squads = this.squads.filter((s) => s.id !== squad.id);
      this.cdr.markForCheck();
      this.showToast("Left squad successfully");
    } catch (error) {
      await loading.dismiss();
      console.error("Leave squad failed:", error);
      this.showToast("Failed to leave squad");
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
      this.showToast("Failed to load squad members");
    }
  }

  copyJoinCode(code: string): void {
    try {
      void navigator.clipboard.writeText(code);
      this.showToast("Join code copied to clipboard!");
    } catch {
      this.showToast(`Join code: ${code}`);
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