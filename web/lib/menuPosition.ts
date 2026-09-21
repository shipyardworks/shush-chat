export type PopoverSize = { width: number; height: number };
export type Viewport = { width: number; height: number };

export type PlacementOptions =
  /** Desktop: opens beside the dots button that triggered it. */
  | { mode: "side"; mine: boolean }
  /** Mobile long-press: opens above or below the message bubble itself. */
  | { mode: "stack" }
  /** A header button's dropdown: under it, starting at its near edge. */
  | { mode: "below" };

const MARGIN = 8;

/**
 * One rule set for every popover in the app: never overlap the thing that opened it, always
 * stay fully inside the viewport, and prefer the side with more room. Used by the desktop
 * three-dot menu (anchor = the dots button), the mobile long-press sheet (anchor = the bubble)
 * and the requests dropdown (anchor = the header button), so there is exactly one place this
 * logic can be wrong.
 */
export const positionPopover = (
  anchor: DOMRect,
  size: PopoverSize,
  viewport: Viewport,
  opts: PlacementOptions,
): { left: number; top: number } => {
  const clampX = (left: number) =>
    Math.min(Math.max(MARGIN, left), viewport.width - size.width - MARGIN);
  const clampY = (top: number) =>
    Math.min(Math.max(MARGIN, top), viewport.height - size.height - MARGIN);

  if (opts.mode === "below") {
    /*
     * Its top-left corner goes under the trigger's left edge, then the clamp pulls it back on
     * screen. Hanging it from the right edge instead is what put a 320px panel's far side
     * almost at the opposite edge of a phone: correctly aligned, and a whole screen's width
     * away from the button it belongs to. Starting at the near edge and clamping puts the
     * corner nearest the trigger as close to it as the panel's own width allows.
     */
    return { left: clampX(anchor.left), top: clampY(anchor.bottom + MARGIN) };
  }

  if (opts.mode === "side") {
    // Away from the bubble: yours sit on the right, so the menu goes left, and the other way
    // round for theirs -- the pointer that opened it is already there.
    const left = clampX(opts.mine ? anchor.left - size.width - 6 : anchor.right + 6);
    const top = clampY(anchor.top + anchor.height / 2 - size.height / 2);
    return { left, top };
  }

  // Stacked above or below the bubble, whichever side actually has room, so the sheet and the
  // message it is about are never the same rectangle.
  const gap = 10;
  const roomAbove = anchor.top;
  const roomBelow = viewport.height - anchor.bottom;
  const top = clampY(
    roomAbove >= size.height + gap || roomAbove >= roomBelow
      ? anchor.top - size.height - gap
      : anchor.bottom + gap,
  );
  const left = clampX(anchor.left + anchor.width / 2 - size.width / 2);
  return { left, top };
};
