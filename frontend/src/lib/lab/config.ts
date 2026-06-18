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

/**
 * Gates the reload-reconnect hardening for the lab sign-in resume path. When a
 * member reloads the page, the OAuth cookie and the at-rest identity both
 * survive, but openLabKey re-fetches the sealed key envelope from the relay
 * (a Cloudflare Durable Object, separate infra from the Vercel auth endpoint).
 * A transient relay error or a not-yet-propagated lab record makes that fetch
 * throw, which today bounces a still-authenticated member to the full
 * "Sign in to your lab" gate.
 *
 * With this flag on, openLabKey caches the PUBLIC sealed artifacts locally (the
 * head-signed lab record plus this member's current-generation key envelope,
 * which is exactly what a blind relay serves) and falls back to that cache when
 * the relay is unreachable, re-deriving the lab key offline. The 32-byte lab key
 * is NEVER persisted; it is re-derived from the envelope, the same guarantee the
 * head already relies on via pending genesis. The OAuth-email-to-membership
 * binding still runs against the cached record, so a stale OAuth session cannot
 * open the lab from cache.
 *
 * Default false (unset). NEXT_PUBLIC so client and server read the same value;
 * it bakes at build, so a change needs a redeploy. Set NEXT_PUBLIC_LAB_RELOAD_RECONNECT
 * in frontend/.env.local for local dev.
 */
export const LAB_RELOAD_RECONNECT_ENABLED =
  process.env.NEXT_PUBLIC_LAB_RELOAD_RECONNECT === "1" ||
  process.env.NEXT_PUBLIC_LAB_RELOAD_RECONNECT === "true";
