// Suppress a <Tooltip>'s focus-reveal during a PROGRAMMATIC focus.
//
// <Tooltip> reveals on focus, which is correct for keyboard users tabbing to a
// control. But when we programmatically RESTORE or RETURN focus to a
// tooltip-wrapped trigger (e.g. after closing a popup or a sub-panel with
// Escape), that reveal pops the tooltip unbidden while the pointer is
// elsewhere. focusWithoutTooltip() opens a brief window during which <Tooltip>
// skips its focus-reveal, so the focus return still happens (good a11y) without
// the stray bubble.
//
// This is the shared, reusable form of the BeakerSearch pill fix: there we drop
// the refocus entirely (refocusing self-labeled chrome adds no a11y value); here
// the refocus DOES matter (returning a keyboard user to the control they opened
// a disclosure from), so we keep it and only mute the tooltip.

let suppressUntil = 0;
const WINDOW_MS = 200;

/**
 * Focus `el` without revealing its surrounding <Tooltip>. Use anywhere focus is
 * moved programmatically to a tooltip-wrapped control (restore-on-close,
 * return-from-sub-panel) so the tooltip does not pop with the pointer away.
 */
export function focusWithoutTooltip(el: HTMLElement | null | undefined): void {
  if (!el || typeof el.focus !== "function") return;
  suppressUntil = Date.now() + WINDOW_MS;
  el.focus();
}

/** True while a focusWithoutTooltip() call is still suppressing focus-reveal.
 *  Read by <Tooltip> in its focus handler. */
export function isTooltipFocusSuppressed(): boolean {
  return Date.now() < suppressUntil;
}
