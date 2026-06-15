// Multi-folder feature flag. Phase A of the account/folder/identity redesign:
// the app remembers a SET of data folders (not just one) and lets the user
// switch the active folder without re-running the OS picker each time.
//
// Same NEXT_PUBLIC env pattern as ONBOARDING_WIZARD_ENABLED / LAB_TIER_ENABLED,
// so it is OFF by default in prod (env unset), safe to commit and push, and
// turned on locally with NEXT_PUBLIC_MULTI_FOLDER=1 in frontend/.env.local.
//
// When OFF, behavior is byte-identical to today: the app reads and writes the
// single legacy DIRECTORY_HANDLE_KEY, the folder switcher UI never renders, and
// connect() replaces the active folder exactly as before. The migration and
// read paths in indexeddb-store stay safe whether the flag is on or off (the
// remembered-set is only consulted when the flag is on).
//
// No emojis, no em-dashes, no mid-sentence colons.

export const MULTI_FOLDER_ENABLED =
  process.env.NEXT_PUBLIC_MULTI_FOLDER === "1" ||
  process.env.NEXT_PUBLIC_MULTI_FOLDER === "true";
