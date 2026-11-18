import { Component, Input, OnInit, inject } from "@angular/core";
import { IonIcon, ModalController } from "@ionic/angular";
import { addIcons } from "ionicons";
import {
  checkmarkOutline,
  closeOutline,
  ellipsisHorizontalOutline,
  femaleOutline,
  heartOutline,
  maleOutline,
  personOutline,
  personRemoveOutline,
  shieldCheckmarkOutline,
} from "ionicons/icons";
import { avatarGradient, initialsFor } from "../../../core/utils/avatar";
import { MemberRelationship } from "../../../core/models/squad.models";

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
  /** Admins can only be removed after being demoted, so the button is hidden for them. */
  @Input() canRemove = false;

  draftRelationship: MemberRelationshipOption = null;

  // All available relationship options in display order
  readonly relationshipOptions: { value: MemberRelationshipOption; label: string; icon: string }[] = [
    { value: null, label: "None", icon: "person-outline" },
    { value: "mom", label: "Mom", icon: "female-outline" },
    { value: "dad", label: "Dad", icon: "male-outline" },
    { value: "son", label: "Son", icon: "person-outline" },
    { value: "daughter", label: "Daughter", icon: "person-outline" },
    { value: "child", label: "Child", icon: "person-outline" },
    { value: "grandparent", label: "Grandparent", icon: "person-outline" },
    { value: "partner", label: "Partner", icon: "heart-outline" },
    { value: "friend", label: "Friend", icon: "person-outline" },
    { value: "other", label: "Other", icon: "ellipsis-horizontal-outline" },
  ];

  constructor() {
    addIcons({
      checkmarkOutline,
      closeOutline,
      ellipsisHorizontalOutline,
      femaleOutline,
      heartOutline,
      maleOutline,
      personOutline,
      personRemoveOutline,
      shieldCheckmarkOutline,
    });
  }

  ngOnInit(): void {
    this.draftRelationship = this.initialRelationship;
  }

  get initials(): string {
    const name = (this.memberName ?? "").trim();
    if (!name) return "?";
    const parts = name.split(/[\s._-]+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
  }

  get gradient(): string {
    const name = this.memberName ?? "";
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const pairs = [
      ["#6366f1", "#8b5cf6"],
      ["#3b82f6", "#06b6d4"],
      ["#10b981", "#34d399"],
      ["#f59e0b", "#fbbf24"],
      ["#f43f5e", "#fb7185"],
      ["#8b5cf6", "#d946ef"],
      ["#14b8a6", "#2dd4bf"],
      ["#0ea5e9", "#38bdf8"],
    ];
    const [from, to] = pairs[Math.abs(hash) % pairs.length];
    return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;
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