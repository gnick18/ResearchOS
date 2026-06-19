// Multi-lab P1 feature flag (a lab IS a folder).
//
// Locked model (Grant 2026-06-18): a lab is a folder. Joining a lab must NOT
// overwrite the current folder's lab_id (the Emile-test bug, where a lab head who
// joined another lab corrupted their own folder). Instead, joining auto-creates a
// managed OPFS member folder, registers it in the account remembered-folders set,
// writes account_type=member + lab_id into THAT new folder, and switches to it.
// The current folder is left untouched.
//
// Same NEXT_PUBLIC env pattern as NEXT_PUBLIC_MULTI_FOLDER. OFF by default in prod
// (env unset), safe to commit and push, turned on locally with
// NEXT_PUBLIC_LAB_AS_FOLDER=1 in frontend/.env.local.
//
// When OFF, behavior is BYTE-IDENTICAL to today: join writes lab_id onto the
// CURRENT folder (the legacy single-lab_id behavior), no member folder is
// provisioned, and the folder switcher renders no lab labels.
//
// No emojis, no em-dashes, no mid-sentence colons.

export const LAB_AS_FOLDER_ENABLED =
  process.env.NEXT_PUBLIC_LAB_AS_FOLDER === "1" ||
  process.env.NEXT_PUBLIC_LAB_AS_FOLDER === "true";
