import { Component, Input, inject } from "@angular/core";
import { IonIcon, PopoverController } from "@ionic/angular";
import { addIcons } from "ionicons";
import { addOutline, checkmarkOutline, keyOutline } from "ionicons/icons";
import { Squad } from "../../../core/models/squad.models";

/** Action chosen from the squad dropdown. */
export type SquadMenuResult =
  | { action: "create" }
  | { action: "join" }
  | { action: "switch"; squadId: number };

/**
 * Dropdown shown under the toolbar squad chip: the current squad name, a
 * switcher listing every squad the user belongs to (the active one carries a
 * checkmark), and create/join actions side by side. Dismisses with the chosen
 * action; MapPage reacts after the popover closes so the alert opens against a
 * clean backdrop.
 */
@Component({
  selector: "app-squad-menu-popover",
  standalone: true,
  imports: [IonIcon],
  templateUrl: "./squad-menu-popover.component.html",
  styleUrls: ["./squad-menu-popover.component.scss"],
})
export class SquadMenuPopoverComponent {
  /** Name of the squad currently shown in the toolbar chip. */
  @Input() squadName = "";

  /** Every squad the user belongs to, listed as a switcher. */
  @Input() squads: Squad[] = [];

  /** Squad currently shown on the map; gets the checkmark. */
  @Input() activeSquadId: number | null = null;

  private readonly popoverCtrl = inject(PopoverController);

  constructor() {
    addIcons({ addOutline, checkmarkOutline, keyOutline });
  }

  pick(action: "create" | "join"): void {
    const result: SquadMenuResult = { action };
    void this.popoverCtrl.dismiss(result);
  }

  /** Tapping the active squad just closes; any other one switches the map. */
  selectSquad(squad: Squad): void {
    if (squad.id === this.activeSquadId) {
      void this.popoverCtrl.dismiss();
      return;
    }
    const result: SquadMenuResult = { action: "switch", squadId: squad.id };
    void this.popoverCtrl.dismiss(result);
  }
}
