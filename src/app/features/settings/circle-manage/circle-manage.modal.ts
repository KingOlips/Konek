import {
  ChangeDetectorRef,
  Component,
  Input,
  OnInit,
  inject,
} from "@angular/core";
import { firstValueFrom } from "rxjs";
import {
  ActionSheetController,
  AlertController,
  IonContent,
  IonIcon,
  IonSpinner,
  ModalController,
  ToastController,
} from "@ionic/angular";
import type { ActionSheetButton } from "@ionic/angular";
import { addIcons } from "ionicons";
import {
  closeOutline,
  cloudOfflineOutline,
  copyOutline,
  ellipsisHorizontal,
  logOutOutline,
  shieldCheckmarkOutline,
} from "ionicons/icons";
import { SquadService } from "../../../core/services/squad.service";
import { AuthService } from "../../../core/services/auth.service";
import {
  MemberRelationship,
  Squad,
  SquadMember,
} from "../../../core/models/squad.models";

/** What the settings page learns when this sheet closes. */
export interface CircleManageResult {
  /** True when membership or roles changed and the list needs a refresh. */
  changed: boolean;
  /** True when the current user left the circle. */
  left?: boolean;
}

/**
 * Management sheet for one circle (opened from Settings → Circles).
 *
 * Shows the join code, the member list, and — for admins — the actions the
 * backend supports: promote/demote members and remove them. Leaving the
 * circle lives here too, with the same sole-admin guard the API enforces.
 */
@Component({
  selector: "app-circle-manage-modal",
  templateUrl: "./circle-manage.modal.html",
  styleUrls: ["./circle-manage.modal.scss"],
  standalone: true,
  imports: [IonContent, IonIcon, IonSpinner],
})
export class CircleManageModalComponent implements OnInit {
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly toastCtrl = inject(ToastController);
  private readonly squadService = inject(SquadService);
  private readonly authService = inject(AuthService);
  private readonly cdr = inject(ChangeDetectorRef);

  /** Circle being managed; supplied by the settings page. */
  @Input() squad!: Squad;

  members: SquadMember[] = [];
  isLoading = true;
  loadError = false;
  isLeaving = false;

  /** Member row currently waiting on the API (disables its actions). */
  busyMemberId: number | null = null;

  private changed = false;

  constructor() {
    addIcons({
      closeOutline,
      cloudOfflineOutline,
      copyOutline,
      ellipsisHorizontal,
      logOutOutline,
      shieldCheckmarkOutline,
    });
  }

  ngOnInit(): void {
    void this.loadMembers();
  }

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  get isAdmin(): boolean {
    return (this.squad?.user_role ?? this.squad?.role) === "admin";
  }

  get memberCount(): number {
    // Once the list is loaded it is the source of truth (it can be 0 for the
    // last member leaving); before that fall back to the circle summary.
    if (!this.isLoading && !this.loadError) return this.members.length;
    return this.squad?.member_count || this.members.length || 1;
  }

  get adminCount(): number {
    return this.members.filter((member) => member.role === "admin").length;
  }

  get initials(): string {
    return CircleManageModalComponent.initialsFor(this.squad?.squad_name ?? "");
  }

  isMe(member: SquadMember): boolean {
    return member.user_id === this.authService.getCurrentUser()?.id;
  }

  /** Admins can manage everyone except themselves. */
  canManage(member: SquadMember): boolean {
    if (!this.isAdmin || this.isMe(member)) return false;
    // Another admin must be demoted before they can be removed, so only offer
    // the menu while more than one admin exists.
    return member.role !== "admin" || this.adminCount > 1;
  }

  memberInitials(username: string): string {
    return CircleManageModalComponent.initialsFor(username);
  }

  /** Human-readable relationship label (matches the map's member sheet). */
  relationshipLabel(relationship: MemberRelationship | null): string {
    if (!relationship) return "";
    const labels: Record<MemberRelationship, string> = {
      dad: "Dad",
      mom: "Mom",
      son: "Son",
      daughter: "Daughter",
      child: "Child",
      grandparent: "Grandparent",
      partner: "Partner",
      friend: "Friend",
      other: "Other",
    };
    return labels[relationship] ?? "";
  }

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  async loadMembers(): Promise<void> {
    if (!this.squad) return;

    this.isLoading = true;
    this.loadError = false;
    this.cdr.markForCheck();

    try {
      this.members =
        (await firstValueFrom(this.squadService.getSquadMembers(this.squad.id))) ??
        [];
    } catch (error) {
      console.error("Failed to load circle members:", error);
      this.loadError = true;
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  // ---------------------------------------------------------------------------
  // Member actions
  // ---------------------------------------------------------------------------

  async openMemberActions(member: SquadMember): Promise<void> {
    if (!this.canManage(member) || this.busyMemberId !== null) return;

    const buttons: ActionSheetButton[] = [];
    if (member.role === "admin") {
      buttons.push({
        text: "Make member",
        handler: () => void this.setRole(member, "member"),
      });
    } else {
      buttons.push({
        text: "Make admin",
        handler: () => void this.setRole(member, "admin"),
      });
      buttons.push({
        text: "Remove from circle",
        role: "destructive",
        handler: () => void this.confirmRemoveMember(member),
      });
    }
    buttons.push({ text: "Cancel", role: "cancel" });

    const sheet = await this.actionSheetCtrl.create({
      header: member.username,
      buttons,
    });
    await sheet.present();
  }

  private async setRole(
    member: SquadMember,
    role: "admin" | "member"
  ): Promise<void> {
    if (this.busyMemberId !== null) return;

    this.busyMemberId = member.user_id;
    this.cdr.markForCheck();

    try {
      await firstValueFrom(
        this.squadService.updateMemberRole(this.squad.id, member.user_id, role)
      );
      member.role = role;
      this.changed = true;
      await this.showToast(
        role === "admin"
          ? `${member.username} is now an admin`
          : `${member.username} is now a member`
      );
    } catch (error) {
      console.error("Failed to update member role:", error);
      await this.showToast(this.errorMessage(error, "Failed to update member"));
    } finally {
      this.busyMemberId = null;
      this.cdr.markForCheck();
    }
  }

  private async confirmRemoveMember(member: SquadMember): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: "Remove member?",
      message: `${member.username} will stop sharing location with "${this.squad.squad_name}" and lose access to its members.`,
      buttons: [
        { text: "Cancel", role: "cancel" },
        {
          text: "Remove",
          role: "destructive",
          handler: () => void this.removeMember(member),
        },
      ],
    });
    await alert.present();
  }

  private async removeMember(member: SquadMember): Promise<void> {
    if (this.busyMemberId !== null) return;

    this.busyMemberId = member.user_id;
    this.cdr.markForCheck();

    try {
      await firstValueFrom(
        this.squadService.removeMember(this.squad.id, member.user_id)
      );
      this.members = this.members.filter((m) => m.user_id !== member.user_id);
      this.changed = true;
      await this.showToast(`${member.username} removed from the circle`);
    } catch (error) {
      console.error("Failed to remove member:", error);
      await this.showToast(this.errorMessage(error, "Failed to remove member"));
    } finally {
      this.busyMemberId = null;
      this.cdr.markForCheck();
    }
  }

  // ---------------------------------------------------------------------------
  // Circle actions
  // ---------------------------------------------------------------------------

  async copyCode(): Promise<void> {
    const code = this.squad?.join_code ?? "";
    if (!code) return;

    try {
      await navigator.clipboard.writeText(code);
      await this.showToast("Join code copied");
    } catch {
      await this.showToast(`Join code: ${code}`);
    }
  }

  async leaveCircle(): Promise<void> {
    if (this.isLeaving || this.busyMemberId !== null) return;

    // Match the API's rule up front instead of failing after the confirmation.
    // Only trust this while the member list is loaded.
    if (
      this.isAdmin &&
      !this.isLoading &&
      !this.loadError &&
      this.adminCount <= 1 &&
      this.memberCount > 1
    ) {
      const blocked = await this.alertCtrl.create({
        header: "Promote another admin first",
        message:
          "You're the only admin of this circle. Make another member an admin before you leave.",
        buttons: ["OK"],
      });
      await blocked.present();
      return;
    }

    const alert = await this.alertCtrl.create({
      header: "Leave circle?",
      message: `You'll stop sharing location with "${this.squad.squad_name}" and won't see its members on the map.`,
      buttons: [
        { text: "Cancel", role: "cancel" },
        {
          text: "Leave",
          role: "destructive",
          handler: () => void this.doLeave(),
        },
      ],
    });
    await alert.present();
  }

  private async doLeave(): Promise<void> {
    this.isLeaving = true;
    this.cdr.markForCheck();

    try {
      await firstValueFrom(this.squadService.leaveSquad(this.squad.id));
      await this.modalCtrl.dismiss(
        { changed: true, left: true } satisfies CircleManageResult,
        "confirm"
      );
    } catch (error) {
      console.error("Failed to leave circle:", error);
      this.isLeaving = false;
      this.cdr.markForCheck();
      await this.showToast(this.errorMessage(error, "Failed to leave circle"));
    }
  }

  close(): void {
    if (this.isLeaving) return;
    void this.modalCtrl.dismiss(
      { changed: this.changed } satisfies CircleManageResult,
      "cancel"
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private static initialsFor(name: string): string {
    const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    const first = parts[0].charAt(0);
    const second = parts.length > 1 ? parts[1].charAt(0) : "";
    return (first + second).toUpperCase();
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
