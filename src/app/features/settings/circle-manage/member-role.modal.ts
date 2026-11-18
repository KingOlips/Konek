import { Component, Input, OnInit, inject } from "@angular/core";
import { IonIcon, ModalController } from "@ionic/angular";
import { addIcons } from "ionicons";
import {
  checkmarkOutline,
  closeOutline,
  personOutline,
  personRemoveOutline,
  shieldCheckmarkOutline,
} from "ionicons/icons";
import { avatarGradient, initialsFor } from "../../../core/utils/avatar";

export type CircleRole = "admin" | "member";

/** What the circle manager does with the picker's answer. */
export interface MemberRoleResult {
  action: "role" | "remove";
  role?: CircleRole;
}

/**
 * Small bottom sheet that lets an admin pick a member's role (or remove the
 * member). Presented from the circle management sheet.
 */
@Component({
  selector: "app-member-role-modal",
  templateUrl: "./member-role.modal.html",
  styleUrls: ["./member-role.modal.scss"],
  standalone: true,
  imports: [IonIcon],
})
export class MemberRoleModalComponent implements OnInit {
  private readonly modalCtrl = inject(ModalController);

  @Input() memberName = "";
  @Input() relationshipLabel = "";
  @Input() initialRole: CircleRole = "member";
  /** Admins can only be removed after being demoted, so the button is hidden for them. */
  @Input() canRemove = false;

  draftRole: CircleRole = "member";

  constructor() {
    addIcons({
      checkmarkOutline,
      closeOutline,
      personOutline,
      personRemoveOutline,
      shieldCheckmarkOutline,
    });
  }

  ngOnInit(): void {
    this.draftRole = this.initialRole;
  }

  get initials(): string {
    return initialsFor(this.memberName);
  }

  get gradient(): string {
    return avatarGradient(this.memberName);
  }

  get changed(): boolean {
    return this.draftRole !== this.initialRole;
  }

  selectRole(role: CircleRole): void {
    this.draftRole = role;
  }

  save(): void {
    if (!this.changed) return;
    const result: MemberRoleResult = { action: "role", role: this.draftRole };
    void this.modalCtrl.dismiss(result, "confirm");
  }

  remove(): void {
    const result: MemberRoleResult = { action: "remove" };
    void this.modalCtrl.dismiss(result, "destructive");
  }

  close(): void {
    void this.modalCtrl.dismiss(null, "cancel");
  }
}
