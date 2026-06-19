// Phase-out-multi-user-folders feature flag (one folder per person).
//
// Grant's decision (2026-06-19): retire the legacy multi-user-folder model
// (several real humans sharing ONE local data folder). With lab accounts syncing
// E2E, collaboration goes through the account / relay, not a shared local folder.
// The shared-folder path lets people skirt real lab accounts and forces a long
// tail of "is this folder multi-user" edge cases.
//
// Enforcement (two levers), BOTH gated by this single flag:
//   1. BLOCK NEW: a folder that already has >= 1 real local user never offers
//      "create another user". The first user of an EMPTY folder is still allowed.
//   2. GRACE-THEN-FORCE: an EXISTING genuinely-multi-user folder keeps the
//      migrate-to-solo gate, but the unlimited "Keep it shared for now" dismiss
//      becomes a bounded grace; once grace is exhausted the gate is blocking
//      (Convert or Take-my-data-out), while the "Use a different folder" disconnect
//      escape always stays so a user is never trapped.
//
// Same NEXT_PUBLIC env pattern as NEXT_PUBLIC_LAB_AS_FOLDER and
// NEXT_PUBLIC_MULTI_FOLDER. OFF by default in prod (env unset), safe to commit and
// push, turned on locally with NEXT_PUBLIC_SINGLE_USER_FOLDERS=1 in
// frontend/.env.local.
//
// When OFF, every surface is BYTE-IDENTICAL to today: the create-another-user
// action keeps today's behavior, and the migrate gate keeps its unlimited dismiss.
//
// No emojis, no em-dashes, no mid-sentence colons.

export const SINGLE_USER_FOLDERS_ENABLED =
  process.env.NEXT_PUBLIC_SINGLE_USER_FOLDERS === "1" ||
  process.env.NEXT_PUBLIC_SINGLE_USER_FOLDERS === "true";
