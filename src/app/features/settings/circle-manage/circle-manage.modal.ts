import {
  ChangeDetectorRef,
  Component,
  Input,
  OnInit,
  inject,
} from "@angular/core";
import { firstValueFrom } from "rxjs";
import {
  AlertController,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  ModalController,
  ToastController,
} from "@ionic/angular";
import { addIcons } from "ionicons";
import {
  closeOutline,
  cloudOfflineOutline,
  copyOutline,
  ellipsisHorizontal,
  logOutOutline,
  pencilOutline,
  shieldCheckmarkOutline,
} from "ionicons/icons";
import { CircleService } from "../../../core/services/circle.service";
import { AuthService } from "../../../core/services/auth.service";
import {
  MemberRelationship,
  Circle,
  CircleMember,
} from "../../../core/models/circle.models";
import { avatarGradient, initialsFor } from "../../../core/utils/avatar";
import type { MemberRelationshipOption, MemberRelationshipResult } from "./member-role.modal";

/** What the circles page learns when this sheet closes. */
export interface CircleManageResult {
  /** True when a relationship or membership changed and the list needs a refresh. */
  changed: boolean;
  /** True when the current user left the circle. */
  left?: boolean;
}

/**
 * Bottom sheet for managing one circle (opened from Settings → Circle
 * management).
 *
 * Header shows the circle identity, the body holds the invite code and the
 * member list, and the footer keeps "Leave" and "Done" reachable however long
 * the list is. Members can label their own relationship; admins can label
 * anyone.
 */
@Component({
  selector: "app-circle-manage-modal",
  templateUrl: "./circle-manage.modal.html",
  styleUrls: ["./circle-manage.modal.scss"],
  standalone: true,
  imports: [IonHeader, IonContent, IonFooter, IonIcon],
})
export class CircleManageModalComponent implements OnInit {
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly circleService = inject(CircleService);
  private readonly authService = inject(AuthService);
  private readonly cdr = inject(ChangeDetectorRef);

  /** Circle being managed; supplied by the circles page. */
  @Input() circle!: Circle;

  members: CircleMember[] = [];
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
      pencilOutline,
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
    return (this.circle?.user_role ?? this.circle?.role) === "admin";
  }

  get memberCount(): number {
    // Once the list is loaded it is the source of truth (it can be 0 for the
    // last member leaving); before that fall back to the circle summary.
    if (!this.isLoading && !this.loadError) return this.members.length;
    return this.circle?.member_count || this.members.length || 1;
  }

  get adminCount(): number {
    return this.members.filter((member) => member.role === "admin").length;
  }

  isMe(member: CircleMember): boolean {
    return member.user_id === this.authService.getCurrentUser()?.id;
  }

  /** Members can label themselves; admins can label anyone. */
  canEditRelationship(member: CircleMember): boolean {
    return this.isMe(member) || this.isAdmin;
  }

  /** Only admins remove others, and another admin must be demoted first. */
  canRemoveMember(member: CircleMember): boolean {
    if (!this.isAdmin || this.isMe(member)) return false;
    return member.role !== "admin" || this.adminCount > 1;
  }

  memberInitials(username: string): string {
    return initialsFor(username);
  }

  memberGradient(username: string): string {
    return avatarGradient(username);
  }

  /** Get avatar URL for a member: profile picture if available, otherwise gradient. */
  memberAvatarUrl(member: CircleMember): string | null {
    if (member.profile_picture) {
      return this.authService.pictureUrl(member.profile_picture);
    }
    return null;
  }

  /** Human-readable relationship label (matches the map's member sheet). */
  relationshipLabel(relationship: MemberRelationship | null | undefined): string {
    if (!relationship) return "";
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
    return labels[relationship] ?? "";
  }

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  async loadMembers(): Promise<void> {
    if (!this.circle) return;

    this.isLoading = true;
    this.loadError = false;
    this.cdr.markForCheck();

    try {
      this.members =
        (await firstValueFrom(this.circleService.getCircleMembers(this.circle.id))) ??
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

  /** Open the relationship picker for a member (self, or admin for anyone). */
  async openRolePicker(member: CircleMember): Promise<void> {
    if (!this.canEditRelationship(member) || this.busyMemberId !== null) return;

    const { MemberRoleModalComponent } = await import("./member-role.modal");

    const modal = await this.modalCtrl.create({
      component: MemberRoleModalComponent,
      componentProps: {
        memberName: member.username,
        relationshipLabel: this.relationshipLabel(member.relationship),
        initialRelationship: member.relationship ?? null,
        avatarUrl: this.memberAvatarUrl(member),
        canRemove: this.canRemoveMember(member),
      },
      cssClass: "member-role-modal",
      backdropDismiss: true,
    });

    await modal.present();
    const { data } = await modal.onWillDismiss<MemberRelationshipResult>();

    if (!data) return;
    if (data.action === "relationship" && data.relationship !== undefined) {
      await this.setRelationship(member, data.relationship);
    } else if (data.action === "remove") {
      await this.confirmRemoveMember(member);
    }
  }

  private async setRelationship(member: CircleMember, relationship: MemberRelationshipOption): Promise<void> {
    if (this.busyMemberId !== null || member.relationship === relationship) return;

    this.busyMemberId = member.user_id;
    this.cdr.markForCheck();

    try {
      await firstValueFrom(
        this.circleService.updateMemberRelationship(this.circle.id, member.user_id, relationship)
      );
      member.relationship = relationship;
      this.changed = true;
      await this.showToast(
        relationship
          ? `${member.username} is now set as ${this.relationshipLabel(relationship)}`
          : `${member.username}'s relationship label cleared`
      );
    } catch (error) {
      console.error("Failed to update member relationship:", error);
      await this.showToast(this.errorMessage(error, "Failed to update member"));
    } finally {
      this.busyMemberId = null;
      this.cdr.markForCheck();
    }
  }

  private async confirmRemoveMember(member: CircleMember): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: "Remove member?",
      message: `${member.username} will stop sharing location with "${this.circle.squad_name}" and lose access to its members.`,
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

  private async removeMember(member: CircleMember): Promise<void> {
    if (this.busyMemberId !== null) return;

    this.busyMemberId = member.user_id;
    this.cdr.markForCheck();

    try {
      await firstValueFrom(
        this.circleService.removeMember(this.circle.id, member.user_id)
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
    const code = this.circle?.join_code ?? "";
    if (!code) return;

    try {
      await navigator.clipboard.writeText(code);
      await this.showToast("Invite code copied");
    } catch {
      await this.showToast(`Invite code: ${code}`);
    }
  }

  /** Admin-only: rename the circle from the sheet header. */
  async renameCircle(): Promise<void> {
    if (!this.isAdmin || !this.circle) return;

    const alert = await this.alertCtrl.create({
      header: "Rename circle",
      inputs: [
        {
          name: "squad_name",
          type: "text",
          value: this.circle.squad_name,
          placeholder: "Circle name",
          attributes: { maxlength: 100 },
        },
      ],
      buttons: [
        { text: "Cancel", role: "cancel" },
        {
          text: "Save",
          handler: async (data) => {
            const name = String(data?.squad_name ?? "").trim();
            if (!name) {
              await this.showToast("Circle name is required");
              return false;
            }
            if (name === this.circle.squad_name) {
              return true;
            }

            try {
              const updated = await firstValueFrom(
                this.circleService.updateCircle(this.circle.id, name)
              );
              this.circle.squad_name = updated.squad_name;
              this.changed = true;
              this.cdr.markForCheck();
              await this.showToast("Circle renamed");
              return true;
            } catch (error) {
              console.error("Failed to rename circle:", error);
              await this.showToast(
                this.errorMessage(error, "Failed to rename circle")
              );
              return true;
            }
          },
        },
      ],
    });
    await alert.present();
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
      message: `You'll stop sharing location with "${this.circle.squad_name}" and won't see its members on the map.`,
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
      await firstValueFrom(this.circleService.leaveCircle(this.circle.id));
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
