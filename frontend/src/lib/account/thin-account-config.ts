// Thin-account feature flag (Phase 4 of the thin-account-settings-home refactor).
//
// Gates the thinned /account hub. Settings now owns identity, billing, and
// security (P1 + P2 already shipped flag-dark), so the Account hub becomes a
// LAUNCHER. When ON, AccountHubShell renders a single-column thin launcher
// (identity header + Folders card + Go-to links + lab companion). When OFF, the
// full left-nav multi-section hub renders exactly as it does today.
//
// IMPORTANT: the thin launcher intentionally has NO security/key-setup
// affordance (that moves to Settings in P3, which is not yet built), so this
// flag must only be flipped together with P1 + P2 + P3.
//
// Enable locally by setting NEXT_PUBLIC_THIN_ACCOUNT=1 in frontend/.env.local.
// Flip to "1" or "true" in Vercel to turn on in a deployed environment.
//
// No emojis, no em-dashes, no mid-sentence colons.

/**
 * Whether the thin account launcher is active. NEXT_PUBLIC so both client and
 * server read the same baked value. Default false (unset in prod) so the merge
 * is safe.
 */
export const THIN_ACCOUNT_ENABLED =
  process.env.NEXT_PUBLIC_THIN_ACCOUNT === "1" ||
  process.env.NEXT_PUBLIC_THIN_ACCOUNT === "true";
