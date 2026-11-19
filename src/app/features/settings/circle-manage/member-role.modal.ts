import { Component, Input, OnInit, inject } from "@angular/core";
import { IonIcon, ModalController } from "@ionic/angular";
import { addIcons } from "ionicons";
import {
  checkmarkOutline,
  closeCircleOutline,
  closeOutline,
  ellipsisHorizontalOutline,
  femaleOutline,
  happyOutline,
  heartOutline,
  maleOutline,
  manOutline,
  peopleOutline,
  personAddOutline,
  personRemoveOutline,
  womanOutline,
} from "ionicons/icons";
import { avatarGradient, initialsFor } from "../../../core/utils/avatar";
import { MemberRelationship } from "../../../core/models/circle.models";

export type MemberRelationshipOption = MemberRelationship | null;

/** What the circle manager does with the picker's answer. */
export interface MemberRelationshipResult {
  action: "relationship" | "remove";
  relationship?: MemberRelationshipOption;
}

/**
 * Small bottom sheet that lets an admin pick a member's relationship label
 * (or remove the member). Presented from the circle management sheet.
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
  @Input() initialRelationship: MemberRelationshipOption = null;
  /** Resolved profile picture URL, or null when the member has none. */
  @Input() avatarUrl: string | null = null;
  /** Admins can only be removed after being demoted, so the button is hidden for them. */
  @Input() canRemove = false;

  draftRelationship: MemberRelationshipOption = null;

  // All available relationship options in display order. Each relationship has
  // its own icon instead of a generic person silhouette.
  readonly relationshipOptions: { value: MemberRelationshipOption; label: string; icon: string }[] = [
    { value: "dad", label: "Dad", icon: "male-outline" },
    { value: "mom", label: "Mom", icon: "female-outline" },
    { value: "son", label: "Son", icon: "man-outline" },
    { value: "daughter", label: "Daughter", icon: "woman-outline" },
    { value: "child", label: "Child", icon: "happy-outline" },
    { value: "grandparent", label: "Grandparent", icon: "people-outline" },
    { value: "partner", label: "Partner / Spouse", icon: "heart-outline" },
    { value: "friend", label: "Friend", icon: "person-add-outline" },
    { value: "other", label: "Other", icon: "ellipsis-horizontal-outline" },
    { value: null, label: "No relationship", icon: "close-circle-outline" },
  ];

  constructor() {
    addIcons({
      checkmarkOutline,
      closeCircleOutline,
      closeOutline,
      ellipsisHorizontalOutline,
      femaleOutline,
      happyOutline,
      heartOutline,
      maleOutline,
      manOutline,
      peopleOutline,
      personAddOutline,
      personRemoveOutline,
      womanOutline,
    });
  }

  ngOnInit(): void {
    this.draftRelationship = this.initialRelationship;
  }

  get initials(): string {
    return initialsFor(this.memberName);
  }

  get gradient(): string {
    return avatarGradient(this.memberName);
  }

  get changed(): boolean {
    return this.draftRelationship !== this.initialRelationship;
  }

  selectRelationship(rel: MemberRelationshipOption): void {
    this.draftRelationship = rel;
  }

  save(): void {
    if (!this.changed) return;
    const result: MemberRelationshipResult = { action: "relationship", relationship: this.draftRelationship };
    void this.modalCtrl.dismiss(result, "confirm");
  }

  remove(): void {
    const result: MemberRelationshipResult = { action: "remove" };
    void this.modalCtrl.dismiss(result, "destructive");
  }

  close(): void {
    void this.modalCtrl.dismiss(null, "cancel");
  }
}