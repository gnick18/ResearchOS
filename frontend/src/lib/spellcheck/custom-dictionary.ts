// The persisted custom spell-check dictionary (the words a user adds via "Add to
// dictionary"). Stored in the DATA FOLDER, not localStorage, so it survives a
// browser change and is scoped to the account:
//
//   Lab account  -> `_spellcheck_dictionary.json` at the folder root, shared by
//                   every lab member (adding a term once teaches the whole lab's
//                   checkers). Root `_*.json` is the existing lab-wide meta-file
//                   convention (_announcements.json, _pi_audit.json, ...).
//   Solo account -> `users/<user>/spellcheck_dictionary.json`, that one person's
//                   list, synced across their own devices through the folder.
//
// The lab signal is `settings.lab_id` (set on lab-member activation). Writes are
// a read-modify-write UNION so two members adding words around the same time do
// not clobber each other's additions. Auto-seeded vocabulary (inventory, method,
// note words) is NOT stored here, it re-derives from the data each session; only
// the manually-added words need persisting.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { fileService } from "../file-system/file-service";

const LAB_DICTIONARY_PATH = "_spellcheck_dictionary.json";

function soloDictionaryPath(user: string): string {
  return `users/${user}/spellcheck_dictionary.json`;
}

interface CustomDictionaryFile {
  version: 1;
  words: string[];
}

/** The dictionary file path for this account, lab-wide or per-user. */
export function customDictionaryPath(
  currentUser: string,
  labId: string | null | undefined,
): string {
  return labId ? LAB_DICTIONARY_PATH : soloDictionaryPath(currentUser);
}

/** Read the persisted custom words for this account. Empty when not connected,
 *  no user, or the file is absent / malformed (fileService treats those as
 *  missing, so this never throws). */
export async function readCustomDictionary(
  currentUser: string,
  labId: string | null | undefined,
): Promise<string[]> {
  if (!fileService.isConnected() || !currentUser) return [];
  const data = await fileService.readJson<CustomDictionaryFile>(
    customDictionaryPath(currentUser, labId),
  );
  if (!data || !Array.isArray(data.words)) return [];
  return data.words.filter((w) => typeof w === "string" && w.trim().length > 0);
}

/**
 * Add a word to the persisted custom dictionary (union read-modify-write).
 * Returns true when the word was new and written, false when it was already
 * present, not connected, or invalid. Case-insensitive de-dupe.
 */
export async function addCustomWord(
  currentUser: string,
  labId: string | null | undefined,
  word: string,
): Promise<boolean> {
  const w = word.trim();
  if (!w || !fileService.isConnected() || !currentUser) return false;
  const existing = await readCustomDictionary(currentUser, labId);
  const key = w.toLowerCase();
  if (existing.some((e) => e.toLowerCase() === key)) return false;
  const next: CustomDictionaryFile = { version: 1, words: [...existing, w] };
  await fileService.writeJson(customDictionaryPath(currentUser, labId), next);
  return true;
}
