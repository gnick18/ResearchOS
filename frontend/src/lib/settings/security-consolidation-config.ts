// Security consolidation feature flag.
//
// Gates Phase 3 of the thin-account-settings-home refactor
// (docs/proposals/2026-06-24-thin-account-settings-home.md). When ON, the three
// scattered "security" surfaces fold into ONE folderless-capable Settings
// "Security & keys" section, so a no-folder user can still set up or unlock
// their end-to-end device key in Settings (the thin Account launcher from P4
// no longer carries that affordance). When OFF, the existing Settings "account"
// section and the AccountHub security panel stay exactly as today.
//
// Enable locally by setting NEXT_PUBLIC_SECURITY_CONSOLIDATION=1 in
// frontend/.env.local. Flip to "1" or "true" in Vercel to turn on in a deployed
// environment. Default false (unset in prod) so the merge is safe and byte
// identical everywhere with the flag off.
//
// No emojis, no em-dashes, no mid-sentence colons.

/**
 * Whether the consolidated "Security & keys" Settings section is active.
 * NEXT_PUBLIC so both client and server read the same baked value. Default
 * false (unset in prod).
 */
export const SECURITY_CONSOLIDATION_ENABLED =
  process.env.NEXT_PUBLIC_SECURITY_CONSOLIDATION === "1" ||
  process.env.NEXT_PUBLIC_SECURITY_CONSOLIDATION === "true";
