import { createAnimation } from "@ionic/angular";
import type { Animation, AnimationBuilder } from "@ionic/angular";

/**
 * Duration shared by the chip CSS transition and the dropdown animation.
 * Keep in sync with `$circle-menu-duration` in map.page.scss.
 */
export const CIRCLE_MENU_DURATION = 220;

/**
 * Easing shared by the chip CSS transition and the dropdown animation.
 * Keep in sync with `$circle-menu-easing` in map.page.scss.
 */
export const CIRCLE_MENU_EASING = "cubic-bezier(0.25, 0.46, 0.45, 0.94)";

/** Corner radius of the closed chip pill. */
export const CIRCLE_CHIP_PILL_RADIUS = 21;

/** Corner radius of the open chip's top corners. */
export const CIRCLE_CHIP_CARD_RADIUS = 16;

/** Height of the strip that stays visible while the menu unfolds. */
const REVEAL_STRIP = 10;

/** One chip shape, in viewport coordinates. */
export interface CircleMenuFrame {
  left: number;
  top: number;
  width: number;
  height: number;
  bottom: number;
  /** Backdrop clip-path that keeps this chip shape un-dimmed. */
  hole: string;
}

/** Chip shapes the dropdown animates between. */
export interface CircleMenuGeometry {
  /** Shape the menu grows out of. */
  start: CircleMenuFrame;
  /** Expanded card the menu settles into. */
  end: CircleMenuFrame;
  /** Pill the menu returns to on close. */
  collapsed: CircleMenuFrame;
}

/** Handle to the live enter animation, so a resize can take over its styles. */
export interface CircleMenuAnimationRef {
  current?: Animation;
}

/** True when the user asked for less motion. */
const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Bottom inset reserved for the home indicator or gesture navigation. */
export const getCircleMenuBottomInset = (): number => {
  if (typeof document === "undefined") return 12;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--ion-safe-area-bottom")
    .trim();
  const safeArea = Number.parseFloat(raw);
  return Math.max(12, Number.isFinite(safeArea) ? safeArea : 0);
};

/**
 * Horizontal insets that keep only the chip's own width visible inside the
 * wider card. The menu then unfolds from the chip instead of the screen edge.
 */
const revealInsets = (
  from: CircleMenuFrame,
  to: CircleMenuFrame
): { left: number; right: number } => ({
  left: Math.max(0, Math.round(from.left - to.left)),
  right: Math.max(0, Math.round(to.left + to.width - (from.left + from.width))),
});

/** Clip-path that hides the card down to a thin strip at its top edge. */
const revealClip = (insets: { left: number; right: number }): string =>
  `inset(0 ${insets.right}px calc(100% - ${REVEAL_STRIP}px) ${insets.left}px round 0 0 ${REVEAL_STRIP}px ${REVEAL_STRIP}px)`;

/** Clip-path that shows the whole card. */
const fullClip = `inset(0 0 0 0 round 0 0 16px 16px)`;

/** Add an element to an animation only when it exists. */
const addIfPresent = (
  animation: Animation,
  element: HTMLElement | null | undefined
): Animation => (element ? animation.addElement(element) : animation);

/**
 * Enter animation: the dropdown unfolds out of the chip while the chip itself
 * widens. The card keeps its final box for the whole animation; only the
 * visible strip grows, so the menu content never reflows mid-flight.
 */
export const createCircleMenuEnterAnimation = (
  geometry: CircleMenuGeometry,
  chip: HTMLElement,
  animationRef?: CircleMenuAnimationRef
): AnimationBuilder => {
  return (baseEl: HTMLElement) => {
    const root = baseEl.shadowRoot;
    const content = root?.querySelector<HTMLElement>(".popover-content");
    const wrapper = root?.querySelector<HTMLElement>(".popover-wrapper");
    const backdrop = root?.querySelector<HTMLElement>("ion-backdrop");
    if (!content) {
      return createAnimation().duration(0);
    }

    const { start, end } = geometry;
    const duration = prefersReducedMotion() ? 0 : CIRCLE_MENU_DURATION;

    // The card is laid out in its final spot from the first frame; the reveal
    // only decides how much of it is visible. Keep its height inside the
    // viewport so short landscape screens can scroll to every action.
    const availableHeight = Math.max(
      1,
      window.innerHeight - end.bottom - getCircleMenuBottomInset()
    );
    content.style.width = `${end.width}px`;
    content.style.maxHeight = `${availableHeight}px`;
    content.style.overflowY = "auto";
    content.style.top = `calc(${end.bottom}px + var(--offset-y, 0px))`;
    content.style.left = `calc(${end.left}px + var(--offset-x, 0px))`;

    const reveal = createAnimation()
      .addElement(content)
      .duration(duration)
      .easing(CIRCLE_MENU_EASING)
      // Web Animations keyframes use camelCase property names.
      .fromTo("clipPath", revealClip(revealInsets(start, end)), fullClip)
      .fromTo("opacity", 0.01, 1)
      .afterStyles({ "clip-path": "none", opacity: "1" });

    // Ionic keeps the wrapper transparent until its own animation runs.
    const wrapperAnimation = addIfPresent(
      createAnimation()
        .duration(duration)
        .easing(CIRCLE_MENU_EASING)
        .fromTo("opacity", 0.01, 1)
        .afterStyles({ opacity: "1" }),
      wrapper
    );

    // The backdrop hole follows the chip so the chip never dims.
    const backdropAnimation = addIfPresent(
      createAnimation()
        .duration(duration)
        .easing(CIRCLE_MENU_EASING)
        .fromTo("clipPath", start.hole, end.hole)
        .fromTo("opacity", 0.01, "var(--backdrop-opacity)")
        .afterStyles({
          "clip-path": end.hole,
          opacity: "var(--backdrop-opacity)",
        }),
      backdrop
    );

    // Keep chip shape on the same Web Animations timeline as the backdrop hole.
    const startRadius = Math.min(
      CIRCLE_CHIP_PILL_RADIUS,
      start.height / 2,
      start.width / 2
    );
    const endRadius = Math.min(
      CIRCLE_CHIP_CARD_RADIUS,
      end.height / 2,
      end.width / 2
    );
    const chipAnimation = createAnimation()
      .addElement(chip)
      .duration(duration)
      .easing(CIRCLE_MENU_EASING)
      .fromTo("width", `${start.width}px`, `${end.width}px`)
      .fromTo(
        "borderRadius",
        `${startRadius}px`,
        `${endRadius}px ${endRadius}px 0 0`
      )
      .afterStyles({
        width: `${end.width}px`,
        "border-radius": `${endRadius}px ${endRadius}px 0 0`,
      });

    const caret = chip.querySelector<HTMLElement>(".chip-caret");
    const caretAnimation = addIfPresent(
      createAnimation()
        .duration(duration)
        .easing(CIRCLE_MENU_EASING)
        .fromTo("transform", "rotate(0deg)", "rotate(180deg)"),
      caret
    );

    const animation = createAnimation()
      .duration(duration)
      .easing(CIRCLE_MENU_EASING)
      .addAnimation([
        reveal,
        wrapperAnimation,
        backdropAnimation,
        chipAnimation,
        caretAnimation,
      ]);

    if (animationRef) {
      animationRef.current = animation;
    }
    return animation;
  };
};

/** Leave animation: the menu folds back into the chip. */
export const createCircleMenuLeaveAnimation = (
  geometry: CircleMenuGeometry,
  chip: HTMLElement
): AnimationBuilder => {
  return (baseEl: HTMLElement) => {
    const root = baseEl.shadowRoot;
    const content = root?.querySelector<HTMLElement>(".popover-content");
    const wrapper = root?.querySelector<HTMLElement>(".popover-wrapper");
    const backdrop = root?.querySelector<HTMLElement>("ion-backdrop");
    if (!content) {
      return createAnimation().duration(0);
    }

    const { end, collapsed } = geometry;
    const duration = prefersReducedMotion() ? 0 : CIRCLE_MENU_DURATION;

    const collapse = createAnimation()
      .addElement(content)
      .duration(duration)
      .easing(CIRCLE_MENU_EASING)
      .fromTo("clipPath", fullClip, revealClip(revealInsets(collapsed, end)))
      .fromTo("opacity", 1, 0.01);

    const wrapperAnimation = addIfPresent(
      createAnimation()
        .duration(duration)
        .easing(CIRCLE_MENU_EASING)
        .fromTo("opacity", 1, 0.01),
      wrapper
    );

    const backdropAnimation = addIfPresent(
      createAnimation()
        .duration(duration)
        .easing(CIRCLE_MENU_EASING)
        .fromTo("clipPath", end.hole, collapsed.hole)
        .fromTo("opacity", "var(--backdrop-opacity)", 0.01),
      backdrop
    );

    const endRadius = Math.min(
      CIRCLE_CHIP_CARD_RADIUS,
      end.height / 2,
      end.width / 2
    );
    const collapsedRadius = Math.min(
      CIRCLE_CHIP_PILL_RADIUS,
      collapsed.height / 2,
      collapsed.width / 2
    );
    const chipAnimation = createAnimation()
      .addElement(chip)
      .duration(duration)
      .easing(CIRCLE_MENU_EASING)
      .fromTo("width", `${end.width}px`, `${collapsed.width}px`)
      .fromTo(
        "borderRadius",
        `${endRadius}px ${endRadius}px 0 0`,
        `${collapsedRadius}px`
      )
      .afterStyles({
        width: `${collapsed.width}px`,
        "border-radius": `${collapsedRadius}px`,
      });

    const caret = chip.querySelector<HTMLElement>(".chip-caret");
    const caretAnimation = addIfPresent(
      createAnimation()
        .duration(duration)
        .easing(CIRCLE_MENU_EASING)
        .fromTo("transform", "rotate(180deg)", "rotate(0deg)"),
      caret
    );

    return createAnimation()
      .duration(duration)
      .easing(CIRCLE_MENU_EASING)
      .addAnimation([
        collapse,
        wrapperAnimation,
        backdropAnimation,
        chipAnimation,
        caretAnimation,
      ]);
  };
};
