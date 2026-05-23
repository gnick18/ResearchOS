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

/** Canonical BeakerBot rendered size (px square) across the reward
 *  scenes. Reverse-engineered from Eureka's effective scale, which
 *  Grant called out as "perfect" (Scene polish C brief, 2026-05-23).
 *  Eureka renders BeakerBot via `<BeakerBot className="w-32 h-32" />`
 *  inside a 128x128 wrapper — w-32 / h-32 in Tailwind = 8rem = 128px
 *  at the default 16px root font-size. The other scenes had drifted
 *  to 72 / 80 / 96 / 128 over the course of development; Scene polish
 *  C standardizes on Eureka's 128 so back-to-back scenes plant
 *  BeakerBot at the same visual weight.
 *
 *  Change THIS NUMBER to scale every reward scene's BeakerBot
 *  uniformly. Scene-local overrides (Ladder's 96, Skateboard's 72)
 *  reference this constant and apply a documented scale factor on
 *  top — the bot in those scenes is geometrically tied to a prop
 *  (ladder rungs, skateboard deck) that wasn't sized for a full
 *  128px bot. */
export const BEAKERBOT_SCENE_SIZE_PX = 128;

/** Tailwind className mirror of BEAKERBOT_SCENE_SIZE_PX, used as the
 *  `className` prop on `<BeakerBot ... />` itself. Bundled here so a
 *  future bulk tweak only has to change one place — bump
 *  BEAKERBOT_SCENE_SIZE_PX and update this string in lockstep.
 *  (Tailwind requires literal class names, so we can't interpolate.) */
export const BEAKERBOT_SCENE_SIZE_CLASS = "w-32 h-32";
