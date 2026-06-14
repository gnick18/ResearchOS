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
 * Gates the lab tier (cross-folder group with a PI-co-owned lab key). Env-driven
 * so it is controllable from Vercel without a code change. Default false (unset),
 * so prod stays dark until NEXT_PUBLIC_LAB_TIER_ENABLED is set to "1" or "true".
 * NEXT_PUBLIC so both the client components and the server routes read the same
 * value (it bakes at build, so a change needs a redeploy). Set it in
 * frontend/.env.local for local dev.
 */
export const LAB_TIER_ENABLED =
  process.env.NEXT_PUBLIC_LAB_TIER_ENABLED === "1" ||
  process.env.NEXT_PUBLIC_LAB_TIER_ENABLED === "true";
