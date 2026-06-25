// Profile consolidation feature flag.
//
// Gates Phase 2 of the thin-account-settings-home refactor
// (docs/proposals/2026-06-24-thin-account-settings-home.md). When ON, the
// scattered identity editors (display name, ORCID, affiliation, avatar, bio,
// links) fold into ONE cloud profile editor backed by account_profiles via
// /api/account/profile, and the duplicate local-folder editors are retired.
// When OFF, the existing editors stay exactly as they are today.
//
// Enable locally by setting NEXT_PUBLIC_PROFILE_CONSOLIDATION=1 in
// frontend/.env.local. Flip to "1" or "true" in Vercel to turn on in a deployed
// environment. Default false (unset in prod) so the merge is safe and byte
// identical everywhere with the flag off.
//
// No emojis, no em-dashes, no mid-sentence colons.

/**
 * Whether profile consolidation is active. NEXT_PUBLIC so both client and
 * server read the same baked value. Default false (unset in prod).
 */
export const PROFILE_CONSOLIDATION_ENABLED =
  process.env.NEXT_PUBLIC_PROFILE_CONSOLIDATION === "1" ||
  process.env.NEXT_PUBLIC_PROFILE_CONSOLIDATION === "true";
