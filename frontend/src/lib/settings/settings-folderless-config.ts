// Settings folderless feature flag.
//
// Gates Phase 1 of the thin-account-settings-home refactor
// (docs/proposals/2026-06-24-thin-account-settings-home.md). When ON, /settings
// becomes reachable and usable with NO data folder connected (a cloud OAuth
// session only), mounting just the cloud-safe sections behind a calm "connect a
// folder" info card for the folder-scoped ones. When OFF, /settings still
// requires a connected folder exactly as it does today.
//
// Enable locally by setting NEXT_PUBLIC_SETTINGS_FOLDERLESS=1 in
// frontend/.env.local. Flip to "1" or "true" in Vercel to turn on in a deployed
// environment. Default false (unset in prod) so the merge is safe and byte
// identical everywhere with the flag off.
//
// No emojis, no em-dashes, no mid-sentence colons.

/**
 * Whether folderless /settings is active. NEXT_PUBLIC so both client and server
 * read the same baked value. Default false (unset in prod).
 */
export const SETTINGS_FOLDERLESS_ENABLED =
  process.env.NEXT_PUBLIC_SETTINGS_FOLDERLESS === "1" ||
  process.env.NEXT_PUBLIC_SETTINGS_FOLDERLESS === "true";
