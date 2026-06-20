// Multi-lab P3: materialize the lab ROSTER and per-member metadata into the
// active member (OPFS) folder.
//
// WHY THIS EXISTS (P2 left this gap):
//   P2 materialized shared-with-me RECORDS into the member folder so the
//   record-reading consumers light up, but it never wrote the roster, member
//   identity, or per-member metadata. The folder-bound IDENTITY consumers read
//   DIFFERENT files than the record consumers:
//     - useLabUserProfileMap (display names + PI badge) reads each member's
//       `users/<owner>/settings.json` (displayName + account_type).
//     - useUserColorMap / useUserColor read `users/_user_metadata.json` (colors).
//     - useLabRosterRows / PeoplePage / CommentsThread / MentionPicker /
//       AttributionChip / UserAvatar / version-history actor labels all resolve
//       a co-member's display through one of those two files.
//   For a JOINED member none of those files exist for the OTHER members, so every
//   co-member renders as a bare username with no PI badge and a fallback color.
//   This module writes them so the existing folder-bound consumers light up
//   WITHOUT re-pointing each one (the folder model: materialize, do not re-point).
//
// SOURCE OF TRUTH:
//   - The roster comes from the head-signed relay record
//     (getLabRemote(labId).record.members), VERIFIED by verifyMembershipLog at
//     the caller BEFORE this runs, so a forged roster cannot expand the set.
//   - Each member's display name comes from their published DIRECTORY profile
//     (fetched by the fingerprint of their ed25519 public key). The directory
//     profile is already directory data (server-readable by design), so caching
//     it locally introduces no NEW server-readable lab content.
//   - The PI badge (account_type === "lab_head") comes from the member's role on
//     the signed roster ("head" -> "lab_head", "member" -> "member").
//   - Colors have NO shared source (a member's color is a per-folder local
//     choice in _user_metadata.json, never published). We assign a deterministic
//     palette color per member so co-members stay visually distinct and stable,
//     and we NEVER overwrite an existing local color entry (so the viewer's own
//     chosen color is preserved).
//
// RESIDENCY (CRITICAL):
//   This writes ONLY a local cache of directory data + the signed roster into the
//   member's OPFS folder. The viewer's OWN settings.json and OWN color entry are
//   NEVER overwritten (own identity is local source-of-truth). No new
//   server-readable lab content is created: member directory profiles are already
//   directory data; _user_metadata is a local cache.
//
// FLAG: the production caller (the pull runner) is gated by LAB_AS_FOLDER_ENABLED.
//   With the flag off this module is never invoked, so flag-off is byte-identical.
//
// ALL external effects are injected via LabRosterMaterializeDeps so the function
// is fully unit-testable without a browser, file-system handle, or network.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { fileService } from "../file-system/file-service";
import { pickUserColor } from "../file-system/user-color";
import { fingerprint } from "../sharing/identity/keys";
import {
  compactFingerprint,
  fetchProfileByFingerprint,
  type PublishedProfile,
} from "../sharing/profile";
import { hexToBytes } from "@noble/hashes/utils.js";
import type { LabMember, LabRecord } from "./lab-membership";

// ---------------------------------------------------------------------------
// Constants mirrored from the consumer-side modules.
// ---------------------------------------------------------------------------

/** The on-disk metadata file the color consumers read. Mirrors
 *  user-metadata.ts METADATA_PATH (kept local so this module does not import a
 *  write-queue-bearing module). */
const METADATA_PATH = "users/_user_metadata.json";

// The deterministic color a co-member with no stored color is assigned comes
// from the single source (user-color.ts pickUserColor / deterministicUserColor).
// That is the same hash + same hex palette the metadata auto-assign and the
// pre-folder picker fallback use, so the color materialize ASSIGNS here is
// identical to the fallback every consumer would otherwise compute. The
// write-queue-bearing user-metadata module is deliberately NOT imported (the
// color helper is a dependency-free leaf).

// ---------------------------------------------------------------------------
// Local copies of the on-disk shapes we read / write. We deliberately keep
// these to the MINIMAL slice we touch and preserve every other field on a
// read-modify-write, so we never clobber state a consumer or a parallel writer
// owns.
// ---------------------------------------------------------------------------

interface MetadataEntryLike {
  color: string;
  created_at: string;
  /** Soft-delete tombstone (ISO timestamp). When set, discoverUsers /
   *  usersApi.list filter the user out. The ghost-cleanup reconcile sets this on
   *  a materialized co-member who has left the relay roster (trash, not destroy)
   *  and clears it when they re-appear. */
  deleted_at?: string;
  /** True when this entry was created by THIS materialize for a co-member (a
   *  cached identity, not a real local user). Only flagged entries are eligible
   *  for the reconcile to tombstone, so a genuine local user is never auto-
   *  tombstoned. */
  materialized_member?: boolean;
  [k: string]: unknown;
}

interface MetadataFileLike {
  users: Record<string, MetadataEntryLike>;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Injectable seams.
// ---------------------------------------------------------------------------

/**
 * The directory-profile fetcher. Default: fetchProfileByFingerprint. Returns
 * null when the member has not published a profile (then the display name is
 * left unset and the consumer falls back to the username, exactly as today for
 * a member with no settings.json).
 */
export type ProfileFetcher = (
  compactFp: string,
) => Promise<PublishedProfile | null>;

/**
 * File effects for the materialize. Defaults to the production fileService.
 * readJson is needed for the read-modify-write of _user_metadata.json and the
 * own-settings preserve check.
 */
export interface RosterFileIO {
  ensureDir(path: string): Promise<void>;
  writeText(path: string, text: string): Promise<void>;
  readJson<T>(path: string): Promise<T | null>;
}

export interface LabRosterMaterializeDeps {
  fileIO?: RosterFileIO;
  fetchProfile?: ProfileFetcher;
}

const defaultFileIO: RosterFileIO = {
  ensureDir: async (path) => {
    await fileService.ensureDir(path);
  },
  writeText: (path, text) => fileService.writeText(path, text),
  readJson: (path) => fileService.readJson(path),
};

// ---------------------------------------------------------------------------
// Result.
// ---------------------------------------------------------------------------

export interface RosterMaterializeResult {
  /** Usernames whose `users/<owner>/settings.json` presence was written. */
  presenceWritten: string[];
  /** Usernames a settings.json was written for (display + role materialized). */
  settingsWritten: string[];
  /** Usernames added to _user_metadata.json (a fresh color entry). */
  metadataAdded: string[];
  /** Previously-materialized co-members who left the relay roster and were
   *  TOMBSTONED (deleted_at set) this run. Trash, not destroy: their dir is left
   *  in place and the entry is reversible. Never the viewer or the head. */
  tombstoned: string[];
  /** Co-members who were tombstoned but are back on the roster, so their
   *  deleted_at was cleared (un-tombstoned) and they were re-materialized. */
  unTombstoned: string[];
  /** The viewer username, whose own identity files were intentionally PRESERVED. */
  viewer: string;
}

// ---------------------------------------------------------------------------
// materializeLabRoster.
// ---------------------------------------------------------------------------

/**
 * Maps a signed-roster role to the on-disk account_type the consumers read. The
 * head is the PI ("lab_head" drives the PI badge), everyone else is a "member".
 */
function roleToAccountType(role: LabMember["role"]): "lab_head" | "member" {
  return role === "head" ? "lab_head" : "member";
}

/**
 * Resolve the compact directory fingerprint for a member from their ed25519
 * public key (the same derivation publishProfile uses). Returns null when the
 * key is malformed so a single bad roster entry never throws the whole run.
 */
function fingerprintForMember(member: LabMember): string | null {
  try {
    const pub = hexToBytes(member.ed25519PublicKey);
    return compactFingerprint(fingerprint(pub));
  } catch {
    return null;
  }
}

/**
 * Materializes the lab ROSTER + per-member metadata into the active member
 * folder so the folder-bound IDENTITY consumers light up.
 *
 * For each roster member OTHER than the viewer:
 *   1. Ensure `users/<owner>/` exists (the presence scaffold discoverUsers and
 *      the per-user readers walk).
 *   2. Write `users/<owner>/settings.json` with displayName (from the directory
 *      profile) + account_type (from the signed role). Written fresh each run so
 *      a role change or a renamed display name propagates. We do NOT preserve a
 *      stale co-member settings.json because the relay roster is authoritative
 *      for a co-member's identity (only the VIEWER's own settings is local
 *      source-of-truth, which we never touch).
 *   3. Add a `_user_metadata.json` color entry IF the member has none yet
 *      (preserving any existing local color, including the viewer's own),
 *      flagged `materialized_member: true` so the reconcile can later tombstone
 *      it. A previously-tombstoned member who is back on the roster is
 *      un-tombstoned (deleted_at cleared) and re-materialized.
 *
 * After the per-member pass it RECONCILES removals: any entry THIS materialize
 * created (materialized_member === true) whose username is no longer on the
 * current roster is TOMBSTONED (deleted_at set) so it stops showing up as a
 * ghost in People / mentions / colors. Trash not destroy (the dir stays, the
 * tombstone is reversible), idempotent, and it NEVER touches the viewer, the
 * head, a current member, or a genuine local user (no materialized flag).
 *
 * The VIEWER's own `users/<viewer>/settings.json` and own color entry are NEVER
 * written here. Their own identity lives locally and is the source of truth.
 *
 * @param record  the head-signed lab record. The caller MUST verifyMembershipLog
 *                before passing it so a forged roster cannot expand the set.
 * @param viewer  the current member's username (skipped, identity preserved).
 * @param deps    injected effects (all optional, production defaults).
 */
export async function materializeLabRoster(
  record: LabRecord,
  viewer: string,
  deps: LabRosterMaterializeDeps = {},
): Promise<RosterMaterializeResult> {
  const io = deps.fileIO ?? defaultFileIO;
  const fetchProfile = deps.fetchProfile ?? fetchProfileByFingerprint;

  const presenceWritten: string[] = [];
  const settingsWritten: string[] = [];
  const metadataAdded: string[] = [];
  const tombstoned: string[] = [];
  const unTombstoned: string[] = [];

  // The full roster, head first. record.head is the PI; record.members is the
  // complete roster (the signed log guarantees head + members agree). We iterate
  // members, which on a valid record already includes the head entry, so we
  // build a de-duped roster keyed by username to avoid a double write if a
  // record lists the head both at .head and inside .members.
  const roster = new Map<string, LabMember>();
  roster.set(record.head.username, record.head);
  for (const m of record.members) {
    roster.set(m.username, m);
  }

  // Read the metadata file once, mutate, write once (read-modify-write). This
  // mirrors ensureLabUserMetadata's pattern but never touches an existing entry
  // so the viewer's own color (and any co-member's previously cached color)
  // survives.
  const metaFile =
    (await io.readJson<MetadataFileLike>(METADATA_PATH)) ?? { users: {} };
  if (!metaFile.users || typeof metaFile.users !== "object") {
    metaFile.users = {};
  }
  const takenColors = new Set<string>(
    Object.values(metaFile.users).map((e) => e?.color).filter(Boolean) as string[],
  );
  let metaMutated = false;
  const now = new Date().toISOString();

  for (const [username, member] of roster) {
    // RESIDENCY: never overwrite the viewer's own identity. Their settings.json
    // and color entry are local source-of-truth.
    if (username === viewer) continue;

    // 1. Presence scaffold.
    const userDir = `users/${username}`;
    await io.ensureDir(userDir);
    presenceWritten.push(username);

    // 2. Display name from the directory profile (best-effort).
    let displayName: string | null = null;
    const fp = fingerprintForMember(member);
    if (fp) {
      try {
        const profile = await fetchProfile(fp);
        if (profile && typeof profile.displayName === "string" && profile.displayName.length > 0) {
          displayName = profile.displayName;
        }
      } catch {
        // A directory hiccup leaves displayName null; the consumer falls back to
        // the username, exactly as today for a member with no settings.json.
      }
    }

    // Write the MINIMAL settings slice the identity consumers read. We preserve
    // any other fields already on a cached co-member settings.json so a second
    // run does not strip unrelated state, but the display name + account_type
    // (the relay-authoritative identity) always win.
    const settingsPath = `${userDir}/settings.json`;
    const existing =
      (await io.readJson<Record<string, unknown>>(settingsPath)) ?? {};
    const merged = {
      ...existing,
      displayName,
      account_type: roleToAccountType(member.role),
      // Lab Manager (Phase 1): materialize the signed roster's `admin` flag so the
      // folder-bound capability consumers (useIsLabManager) light up without
      // re-fetching the relay record. Relay-authoritative like account_type, so it
      // always wins on a re-run. Never on the head (the head holds every power).
      lab_manager: member.admin === true && member.role !== "head",
    };
    await io.writeText(settingsPath, JSON.stringify(merged));
    settingsWritten.push(username);

    // 3. Color entry: add ONLY when missing so we never overwrite a local color.
    const existingEntry = metaFile.users[username];
    if (!existingEntry) {
      const color = pickUserColor(takenColors, username);
      takenColors.add(color);
      // Flag the entry as materialized so the reconcile below can safely tombstone
      // it (and only it) when this member later leaves the roster. A genuine local
      // user this viewer created carries no such flag and is never auto-tombstoned.
      metaFile.users[username] = {
        color,
        created_at: now,
        materialized_member: true,
      };
      metadataAdded.push(username);
      metaMutated = true;
    } else if (existingEntry.deleted_at) {
      // Re-added member who was previously tombstoned: clear the tombstone so
      // they reappear in People / mentions / colors, and (re-)flag the entry as
      // materialized so a future removal can tombstone it again. We do NOT touch
      // their stored color (residency: a chosen color survives).
      delete existingEntry.deleted_at;
      existingEntry.materialized_member = true;
      unTombstoned.push(username);
      metaMutated = true;
    }
  }

  // Ghost-cleanup reconcile: a member removed from the relay roster leaves a
  // materialized scaffold + metadata entry behind (materialize only ADDS, it
  // never pruned). For every entry THIS materialize created (materialized_member
  // === true) whose username is no longer on the current roster, TOMBSTONE it
  // (set deleted_at) so discoverUsers / the pickers filter it out. This is trash
  // not destroy: the dir is left in place and the tombstone is reversible (a re-
  // added member is un-tombstoned above), so the change is idempotent and safe.
  //
  // SAFETY INVARIANTS:
  //   - Never the VIEWER: their identity is local source-of-truth and they carry
  //     no materialized_member flag anyway (we skip writing their entry).
  //   - Never the HEAD or any current roster member: they are in `roster`.
  //   - Never a genuine local / co-located user: only entries WE flagged
  //     materialized_member are touched. An un-flagged entry (a real local user,
  //     or a pre-flag legacy entry) is left exactly as-is.
  //   - Idempotent: an already-tombstoned ghost is skipped (no re-write).
  for (const [username, entry] of Object.entries(metaFile.users)) {
    if (username === viewer) continue;
    if (roster.has(username)) continue;
    if (!entry || entry.materialized_member !== true) continue;
    if (entry.deleted_at) continue; // already tombstoned, idempotent.
    entry.deleted_at = now;
    tombstoned.push(username);
    metaMutated = true;
  }

  if (metaMutated) {
    await io.writeText(METADATA_PATH, JSON.stringify(metaFile));
  }

  return {
    presenceWritten,
    settingsWritten,
    metadataAdded,
    tombstoned,
    unTombstoned,
    viewer,
  };
}

/** Exposed for unit tests: the role -> account_type mapping. */
export const _roleToAccountTypeForTest = roleToAccountType;
