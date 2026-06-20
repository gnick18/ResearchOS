// Account-centric folder identity, the per-folder OWNER record (Phase B).
//
// A data folder is owned EXCLUSIVELY by one ResearchOS account, identified by its
// signing-key fingerprint (the durable primary key) plus the published email as a
// human-readable label. The record lives at users/_folder_owner.json, a sentinel
// under users/ sibling to _global_counters.json (NOT a user directory, so
// user-discovery skips it).
//
// EVERYTHING here is consumed only behind MULTI_FOLDER_ENABLED. The pure helpers
// have no IO and are unit-tested directly. The read/write helpers are thin
// fileService wrappers mirroring sidecar.ts.
//
// DECISIONS (locked, do not re-litigate):
// - D1 exclusive owner keyed on signing-key fingerprint, email is a label only.
// - D4 a folder with NO owner record is ADOPTED silently by the connecting
//   account (adoptRecord). Only a record whose owner_fingerprint differs from the
//   connecting account is a foreign takeover (isForeignTakeover) and warns.
// - D6 takeover records the previous owner + the sweep event so ownership can be
//   reverted (revertRecord) and the swept shares restored.
//
// KEY DATA-SAFETY GUARD: rebind-on-takeover is data-safe ONLY while DEVICE_KEY_V2
// at-rest encryption stays OFF. Today a different account can open and read the
// folder bytes after a takeover because nothing on disk is encrypted to the prior
// owner's key. If at-rest encryption ever ships, the takeover/rebind flow MUST be
// re-reviewed (the new owner would not hold the prior owner's unwrap key, so a
// blind rebind would strand data). See file-system-context.tsx takeover branch.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { fileService } from "./file-service";
import { ensureGitignoreEntries } from "./gitignore";

/**
 * A single takeover event. Recorded on the owner record so a "Revert ownership"
 * action can restore exactly the set of shared files that were swept to trash
 * under this id (D6), and hand ownership back to from_fingerprint.
 */
export interface TakeoverEvent {
  id: string;
  at: string;
  from_fingerprint: string;
  to_fingerprint: string;
  swept_count: number;
}

/**
 * The per-folder owner record. owner_fingerprint is the durable primary key
 * (the connecting account's Ed25519 signing-key fingerprint, computed with the
 * same fingerprint() the sidecar uses so comparisons match). owner_email is a
 * human-readable label only. previous_owner + takeover_events exist for revert.
 */
export interface FolderOwnerRecord {
  version: 1;
  owner_fingerprint: string;
  owner_email?: string;
  previous_owner?: string;
  takeover_events?: TakeoverEvent[];
}

// Sentinel path under users/, sibling to _global_counters.json. user-discovery
// SKIP_DIRECTORIES learns this name so it is never treated as a user.
export const FOLDER_OWNER_PATH = "users/_folder_owner.json";

/**
 * Reads the folder owner record. Returns null when the file is absent, which
 * means the folder has no owner yet (an unowned / legacy folder, D4).
 */
export async function readFolderOwner(): Promise<FolderOwnerRecord | null> {
  return fileService.readJson<FolderOwnerRecord>(FOLDER_OWNER_PATH);
}

/**
 * Writes (or replaces) the folder owner record.
 */
export async function writeFolderOwner(rec: FolderOwnerRecord): Promise<void> {
  await fileService.writeJson(FOLDER_OWNER_PATH, rec);
  // Keep the owner sentinel out of any git repo the data folder happens to be,
  // same convention as the identity sidecar. Best-effort, the record still works
  // if the append fails. This write path is only ever reached behind
  // MULTI_FOLDER_ENABLED, so flag-off behavior is unaffected.
  try {
    await ensureGitignoreEntries(["_folder_owner.json", "users/_folder_owner.json"]);
  } catch {
    // best-effort; the owner record still works if the append fails
  }
}

// ── Pure helpers (no IO, unit-testable) ─────────────────────────────────────

/** Whether the record names the given fingerprint as the exclusive owner. */
export function isOwnedBy(
  rec: FolderOwnerRecord | null,
  fingerprint: string,
): boolean {
  return rec !== null && rec.owner_fingerprint === fingerprint;
}

/**
 * Whether opening this folder as the given account is a FOREIGN takeover, the
 * record exists AND its owner_fingerprint differs from the connecting account.
 * An absent record is NOT a takeover (it is a silent adopt, D4).
 */
export function isForeignTakeover(
  rec: FolderOwnerRecord | null,
  fingerprint: string,
): boolean {
  return rec !== null && rec.owner_fingerprint !== fingerprint;
}

/**
 * A fresh owner record for the connecting account (D4 adopt). Used when a folder
 * has no owner record yet, even if it already carries multiple users/ dirs, the
 * connecting account adopts as the sole exclusive owner.
 */
export function adoptRecord(
  fingerprint: string,
  email?: string,
): FolderOwnerRecord {
  return {
    version: 1,
    owner_fingerprint: fingerprint,
    ...(email ? { owner_email: email } : {}),
  };
}

/**
 * The owner record after a deliberate takeover (D2 warn-then-allow). Sets the
 * owner to the new account, records the prior owner as previous_owner, and
 * appends the takeover event so it can be reverted.
 */
export function takeoverRecord(
  prev: FolderOwnerRecord,
  newFingerprint: string,
  newEmail: string | undefined,
  event: TakeoverEvent,
): FolderOwnerRecord {
  return {
    version: 1,
    owner_fingerprint: newFingerprint,
    ...(newEmail ? { owner_email: newEmail } : {}),
    previous_owner: prev.owner_fingerprint,
    takeover_events: [...(prev.takeover_events ?? []), event],
  };
}

/**
 * The owner record after reverting the most recent takeover (D6). Hands
 * ownership back to the previous_owner from the last event, pops that event, and
 * restores previous_owner to whatever it was BEFORE that takeover (the prior
 * event's from_fingerprint, if any). Returns null when there is nothing to
 * revert (no takeover events recorded).
 */
export function revertRecord(rec: FolderOwnerRecord): FolderOwnerRecord | null {
  const events = rec.takeover_events ?? [];
  if (events.length === 0) return null;

  const last = events[events.length - 1];
  const remaining = events.slice(0, -1);
  const priorEvent = remaining[remaining.length - 1];

  return {
    version: 1,
    owner_fingerprint: last.from_fingerprint,
    // Drop the email label, it belonged to the account we are reverting away
    // from. A subsequent connect by the restored owner re-stamps its own label.
    ...(remaining.length > 0
      ? { previous_owner: priorEvent.from_fingerprint }
      : {}),
    ...(remaining.length > 0 ? { takeover_events: remaining } : {}),
  };
}

/**
 * The from/to fingerprints of the most recent takeover, plus its event id, or
 * null when nothing has been taken over. Convenience for the revert UI so it can
 * label "restore ownership to X" and pass the right event id to the sweep
 * restore.
 */
export function lastTakeover(rec: FolderOwnerRecord | null): TakeoverEvent | null {
  if (!rec) return null;
  const events = rec.takeover_events ?? [];
  return events.length > 0 ? events[events.length - 1] : null;
}

/**
 * A takeover event id. Callers pass a fixed string in tests, real callers pass a
 * timestamp + a short random suffix at runtime (Date.now / Math.random are fine
 * inside a call, just not at module top, so this stays tree-shake-pure and the
 * helpers above accept the id rather than minting it).
 */
export function makeTakeoverEventId(
  nowIso: string,
  randomSuffix: string,
): string {
  // Sanitize so the id is filesystem-safe (it becomes a trash subdirectory name
  // via trashFile(path, eventId)). Keep only path-safe characters.
  const safeTime = nowIso.replace(/[^0-9A-Za-z]/g, "");
  const safeRand = randomSuffix.replace(/[^0-9A-Za-z]/g, "");
  return `takeover-${safeTime}-${safeRand}`;
}
