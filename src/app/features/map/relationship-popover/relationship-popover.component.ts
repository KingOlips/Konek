import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnInit,
  inject,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import {
  IonButton,
  IonContent,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  ModalController,
  PopoverController,
} from "@ionic/angular";
import { addIcons } from "ionicons";
import {
  checkmarkOutline,
  closeOutline,
  personOutline,
  personCircleOutline,
  personAddOutline,
  maleOutline,
  femaleOutline,
  heartOutline,
  walkOutline,
} from "ionicons/icons";
import { MemberRelationship } from "../../../core/models/squad.models";

interface RelationshipOption {
  value: MemberRelationship | null;
  label: string;
  icon: string;
}

const RELATIONSHIP_OPTIONS: RelationshipOption[] = [
  { value: "dad", label: "Dad", icon: "male-outline" },
  { value: "mom", label: "Mom", icon: "female-outline" },
  { value: "son", label: "Son", icon: "person-outline" },
  { value: "daughter", label: "Daughter", icon: "person-outline" },
  { value: "child", label: "Child", icon: "person-outline" },
  { value: "grandparent", label: "Grandparent", icon: "person-circle-outline" },
  { value: "partner", label: "Partner / Spouse", icon: "heart-outline" },
  { value: "friend", label: "Friend", icon: "person-add-outline" },
  { value: "other", label: "Other", icon: "walk-outline" },
  { value: null, label: "Clear relationship", icon: "close-outline" },
];

/**
 * Popover for selecting a family/friend relationship label.
 * Presented from the member detail sheet.
 */
@Component({
  selector: "app-relationship-popover",
  standalone: true,
  imports: [CommonModule, IonContent, IonList, IonItem, IonLabel, IonButton, IonIcon],
  template: `
    <ion-content class="popover-content">
      <div class="popover-header">
        <p class="popover-title">Relationship for {{ memberName }}</p>
        <ion-button fill="clear" class="close-btn" (click)="dismiss(null)">
          <ion-icon name="close-outline" slot="icon-only"></ion-icon>
        </ion-button>
      </div>

      <ion-list class="popover-list" lines="none">
        @for (opt of options; track opt.value) {
          <ion-item
            class="popover-item"
            [class.selected]="selected === opt.value"
            button
            detail="false"
            (click)="select(opt.value)"
          >
            <ion-icon [name]="opt.icon" slot="start" class="item-icon"></ion-icon>
            <ion-label>{{ opt.label }}</ion-label>
            @if (selected === opt.value) {
              <ion-icon name="checkmark-outline" slot="end" class="check-icon"></ion-icon>
            }
          </ion-item>
        }
      </ion-list>
    </ion-content>
  `,
  styles: [`
    :host {
      --width: 280px;
      --height: auto;
    }

    .popover-content {
      --background: var(--popover-surface, #fff);
      --color: var(--popover-ink, #0f172a);
      --padding: 0;
    }

    :host-context(.dark) .popover-content {
      --popover-surface: #1c2028;
      --popover-ink: #f4f5f7;
    }

    .popover-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--popover-line, #e2e8f0);
    }

    :host-context(.dark) .popover-header {
      --popover-line: #233049;
    }

    .popover-title {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: var(--popover-ink);
    }

    .close-btn {
      --background: transparent;
      --background-hover: rgba(15, 23, 42, 0.06);
      --border-radius: 8px;
    }

    .popover-list {
      padding: 4px 0;
    }

    .popover-item {
      --padding-start: 16px;
      --padding-end: 16px;
      --min-height: 48px;
      --background: transparent;
      --background-hover: rgba(15, 23, 42, 0.04);
      --background-activated: rgba(15, 23, 42, 0.08);
      --color: var(--popover-ink);
      font-size: 14.5px;
      font-weight: 500;
    }

    .popover-item.selected {
      --background: rgba(37, 99, 235, 0.1);
    }

    :host-context(.dark) .popover-item.selected {
      --background: rgba(37, 99, 235, 0.2);
    }

    .item-icon {
      font-size: 20px;
      color: var(--popover-muted, #64748b);
      margin-end: 12px;
    }

    .popover-item.selected .item-icon {
      color: #2563eb;
    }

    .check-icon {
      color: #2563eb;
      font-size: 20px;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RelationshipPopoverComponent implements OnInit {
  private readonly popoverCtrl = inject(PopoverController);

  @Input() currentRelationship: MemberRelationship | null = null;
  @Input() memberName = "";
  @Input() isAdmin = false;
  @Input() currentUserId: number | null = null;
  @Input() targetUserId: number | null = null;

  selected: MemberRelationship | null = null;
  options = RELATIONSHIP_OPTIONS;

  ngOnInit(): void {
    this.selected = this.currentRelationship;
  }

  constructor() {
    addIcons({
      checkmarkOutline,
      closeOutline,
      personOutline,
      personCircleOutline,
      personAddOutline,
      maleOutline,
      femaleOutline,
      heartOutline,
      walkOutline,
    });
  }

  select(value: MemberRelationship | null): void {
    this.selected = value;
  }

  dismiss(value: MemberRelationship | null): void {
    this.popoverCtrl.dismiss(value);
  }
}