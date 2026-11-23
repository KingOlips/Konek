import type { IControl, Map as MapLibreMap } from "maplibre-gl";

/**
 * MapLibre control that switches the camera between the flat 2D view and the
 * tilted 3D view.
 *
 * The compass alone cannot do this: tapping it only resets the bearing, so a
 * phone has no way back to 3D after the map was flattened. This button gives
 * touch users an explicit toggle, and it tracks manual two-finger tilting.
 */
export class PitchToggleControl implements IControl {
  private readonly _group: HTMLDivElement;
  private readonly _button: HTMLButtonElement;
  private _map: MapLibreMap | null = null;

  private readonly _onPitchChange = (): void => this._refresh();
  private readonly _onClick = (event: MouseEvent): void => {
    event.preventDefault();
    this._toggle();
  };

  /** @param tiltPitch Camera pitch used for the 3D view, in degrees. */
  constructor(private readonly _tiltPitch: number) {
    this._group = document.createElement("div");
    this._group.className = "maplibregl-ctrl maplibregl-ctrl-group";

    this._button = document.createElement("button");
    this._button.type = "button";
    this._button.className = "maplibregl-ctrl-pitch-toggle";
    this._button.addEventListener("click", this._onClick);
    this._group.appendChild(this._button);
  }

  onAdd(map: MapLibreMap): HTMLElement {
    this._map = map;
    map.on("pitch", this._onPitchChange);
    this._refresh();
    return this._group;
  }

  onRemove(map: MapLibreMap): void {
    map.off("pitch", this._onPitchChange);
    this._button.removeEventListener("click", this._onClick);
    this._map = null;
  }

  private _toggle(): void {
    const map = this._map;
    if (!map) return;

    const isTilted = map.getPitch() > 1;
    map.easeTo({
      pitch: isTilted ? 0 : this._tiltPitch,
      duration: 600,
      essential: true,
    });
  }

  /** Keep the label in sync with manual gestures and camera moves. */
  private _refresh(): void {
    const map = this._map;
    if (!map) return;

    const isTilted = map.getPitch() > 1;
    const label = isTilted ? "Switch to 2D view" : "Switch to 3D view";
    this._button.textContent = isTilted ? "2D" : "3D";
    this._button.title = label;
    this._button.setAttribute("aria-label", label);
    this._button.setAttribute("aria-pressed", String(isTilted));
  }
}
