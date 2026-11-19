import { Component, Input, inject } from "@angular/core";
import { IonIcon, PopoverController } from "@ionic/angular";
import { addIcons } from "ionicons";
import { addOutline, checkmarkOutline, keyOutline } from "ionicons/icons";
import { Circle } from "../../../core/models/circle.models";

/** Action chosen from the circle dropdown. */
export type CircleMenuResult =
  | { action: "create" }
  | { action: "join" }
  | { action: "switch"; circleId: number };

/**
 * Dropdown shown under the toolbar circle chip: the current circle name, a
 * switcher listing every circle the user belongs to (the active one carries a
 * checkmark), and create/join actions side by side. Dismisses with the chosen
 * action; MapPage reacts after the popover closes so the alert opens against a
 * clean backdrop.
 */
@Component({
  selector: "app-circle-menu-popover",
  standalone: true,
  imports: [IonIcon],
  templateUrl: "./circle-menu-popover.component.html",
  styleUrls: ["./circle-menu-popover.component.scss"],
})
export class CircleMenuPopoverComponent {
  /** Name of the circle currently shown in the toolbar chip. */
  @Input() circleName = "";

  /** Every circle the user belongs to, listed as a switcher. */
  @Input() circles: Circle[] = [];

  /** Circle currently shown on the map; gets the checkmark. */
  @Input() activeCircleId: number | null = null;

  private readonly popoverCtrl = inject(PopoverController);

  constructor() {
    addIcons({ addOutline, checkmarkOutline, keyOutline });
  }

  pick(action: "create" | "join"): void {
    const result: CircleMenuResult = { action };
    void this.popoverCtrl.dismiss(result);
  }

  /** Tapping the active circle just closes; any other one switches the map. */
  selectCircle(circle: Circle): void {
    if (circle.id === this.activeCircleId) {
      void this.popoverCtrl.dismiss();
      return;
    }
    const result: CircleMenuResult = { action: "switch", circleId: circle.id };
    void this.popoverCtrl.dismiss(result);
  }
}
