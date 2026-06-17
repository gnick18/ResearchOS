// Account-scoped settings (Phase 1) feature flag.
//
// Account-scoped settings live in OUR cloud as an E2E-encrypted blob keyed by
// the user's identity hash, so a few preferences + external connections follow
// the user across every connected folder (the Owen Sullivan calendar scare).
// See docs/proposals/2026-06-17-account-vs-folder-settings.md.
//
// Phase 1 is the store + crypto + API + the first two account-scoped fields
// (external calendar feeds and the lab-head / PI capability). Everything is dark
// behind this single flag. Fails CLOSED, so a deploy that does not set it behaves
// byte-for-byte as before (the API 404s and the client uses folder-local only).
//
// NEXT_PUBLIC so the client module AND the server route read the SAME value (it
// bakes at build, so flipping it needs a redeploy). Mirrors LAB_TIER_ENABLED and
// the billing config switches. Set NEXT_PUBLIC_ACCOUNT_SETTINGS in
// frontend/.env.local for local dev.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

/**
 * Whether the account-scoped settings surface is on. Fails closed (default off):
 * an unset flag means the cloud store + API are dark and the client falls back to
 * folder-local settings only. Read by both the server route and the client
 * module so they stay in lockstep.
 */
export function isAccountSettingsEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_ACCOUNT_SETTINGS;
  return v === "1" || v === "true";
}
