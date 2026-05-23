// frontend/src/components/beakerbot/scene-constants.ts
//
// Shared constants across the BeakerBot easter-egg scenes. The scenes
// have historically each picked their own ground-line value (8vh /
// 10vh / 20vh / 80vh-12px / bottom:0 with a per-stage offset), which
// means back-to-back scenes can put BeakerBot at visibly different
// heights. Scene polish B standardizes the bench/floor line so the
// composition reads consistently regardless of which scene rolled.
//
// Skateboard's `bottomY` prop (default 85 = 85%) and ScreenBump's
// anchor-variable layout deliberately stay outside this constant —
// those scenes don't share the "BeakerBot on a bench" framing, so a
// shared ground-line would actively hurt them.

/** Vertical distance from the bottom of the viewport to BeakerBot's
 *  feet across the bench-style scenes (Ladder, BugStomp,
 *  TooManyBeakers, Centrifuge, Eureka). Expressed in `vh` so the line
 *  tracks viewport height the same way the existing scene transforms
 *  already do. Value chosen by Grant's scene polish B brief (2026-05-23). */
export const SCENE_GROUND_BOTTOM_VH = 12;

/** Same value rendered as a CSS string for use in inline styles
 *  (`bottom: SCENE_GROUND_BOTTOM_CSS`). Centralizes the unit so callers
 *  never spell the unit out themselves and accidentally pick `px`. */
export const SCENE_GROUND_BOTTOM_CSS = `${SCENE_GROUND_BOTTOM_VH}vh`;
