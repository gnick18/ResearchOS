// Onboarding tutor — live target resolution.
//
// When Beaker drives a real page, the choreography's logical target (for example
// "datahub-plot-button") has to resolve to where that control actually is on
// screen, so the presenter cursor lands on it. Real controls opt in by carrying
// a `data-tutor-target="<id>"` attribute. This mirrors how guide_to_element
// resolves a perceived ref back to a live element, kept separate here so the
// onboarding layer does not depend on the chat perception pipeline.
//
// The center math is pure and unit-tested. The DOM lookup is a thin wrapper so
// the rest of the engine stays testable. No emojis, no em-dashes, no mid-sentence
// colons.

export const TUTOR_TARGET_ATTR = "data-tutor-target";

export interface Point {
  x: number;
  y: number;
}

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The point the cursor should aim for (center of the target), expressed in the
 *  same coordinate space as `container`. Pure, so it is unit-tested directly. */
export function centerInContainer(target: RectLike, container: RectLike): Point {
  return {
    x: target.left - container.left + target.width / 2,
    y: target.top - container.top + target.height / 2,
  };
}

/** A box in container coordinates (top-left + size), for the soft-ring spotlight
 *  which must wrap the WHOLE control, not just sit at its center. */
export interface BoxLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The target's box expressed in `container` coordinates. Pure, unit-tested.
 *  The soft ring renders at this box (optionally padded) so it hugs the control;
 *  the cursor still aims for its center via centerInContainer. */
export function rectInContainer(target: RectLike, container: RectLike): BoxLike {
  return {
    x: target.left - container.left,
    y: target.top - container.top,
    width: target.width,
    height: target.height,
  };
}

/** Build the attribute selector for a logical target id. */
export function targetSelector(id: string): string {
  return `[${TUTOR_TARGET_ATTR}="${id}"]`;
}

/** Resolve a logical target to a point inside `container`, or null when the
 *  control is not on the page (the cursor layer then falls back to a default
 *  position rather than pointing at nothing). DOM-touching, kept thin. */
export function resolveTargetPoint(
  id: string | null,
  container: Element | null,
  doc: Document | null = typeof document === "undefined" ? null : document,
): Point | null {
  if (!id || !container || !doc) return null;
  const el = doc.querySelector(targetSelector(id));
  if (!el) return null;
  return centerInContainer(
    el.getBoundingClientRect(),
    container.getBoundingClientRect(),
  );
}

/** Resolve a logical target to its box inside `container`, or null when the
 *  control is not on the page. The soft-ring spotlight renders at this box.
 *  DOM-touching, kept thin (mirrors resolveTargetPoint). */
export function resolveTargetRect(
  id: string | null,
  container: Element | null,
  doc: Document | null = typeof document === "undefined" ? null : document,
): BoxLike | null {
  if (!id || !container || !doc) return null;
  const el = doc.querySelector(targetSelector(id));
  if (!el) return null;
  return rectInContainer(
    el.getBoundingClientRect(),
    container.getBoundingClientRect(),
  );
}
