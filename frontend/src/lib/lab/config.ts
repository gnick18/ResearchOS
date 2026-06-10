// Lab tier (cross-folder group) feature flag.
//
// Phase 1 is the crypto core only (lab key, membership log, rotation, recovery)
// with thorough tests. It is wired into NOTHING (no UI, no folder layout, no
// sync). This flag keeps the whole lab tier dormant until later phases turn it
// on deliberately. See docs/proposals/LAB_TIER_REDESIGN.md (and the locked
// model recorded by the sharing manager 2026-06-07).
//
// No emojis, no em-dashes, no mid-sentence colons.

/**
 * Gates the lab tier (cross-folder group with a PI-co-owned lab key). Default
 * false. Phase 1 ships the crypto core dark behind this, so none of it can run
 * in the app until a later phase flips it on.
 */
export const LAB_TIER_ENABLED = true; // LOCAL TEST ONLY — do not commit/push; origin/main stays false until launch
