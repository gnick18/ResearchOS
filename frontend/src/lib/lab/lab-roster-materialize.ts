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

/** Hex-only palette mirrored from user-metadata.ts USER_COLOR_PALETTE (the
 *  rainbow sentinels are intentionally excluded: they are opt-in only and must
 *  never be auto-assigned). Kept local so the deterministic assignment here
 *  matches the swatches the rest of the app uses without importing the
 *  write-queue-bearing module. */
const HEX_PALETTE = [
  "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

// ---------------------------------------------------------------------------
// Local copies of the on-disk shapes we read / write. We deliberately keep
// these to the MINIMAL slice we touch and preserve every other field on a
// read-modify-write, so we never clobber state a consumer or a parallel writer
// owns.
// ---------------------------------------------------------------------------

interface MetadataEntryLike {
  color: string;
  created_at: string;
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
 *      (preserving any existing local color, including the viewer's own).
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
    };
    await io.writeText(settingsPath, JSON.stringify(merged));
    settingsWritten.push(username);

    // 3. Color entry: add ONLY when missing so we never overwrite a local color.
    if (!metaFile.users[username]) {
      const color = pickColor(takenColors, username);
      takenColors.add(color);
      metaFile.users[username] = { color, created_at: now };
      metadataAdded.push(username);
      metaMutated = true;
    }
  }

  if (metaMutated) {
    await io.writeText(METADATA_PATH, JSON.stringify(metaFile));
  }

  return { presenceWritten, settingsWritten, metadataAdded, viewer };
}

/**
 * Deterministic palette assignment mirroring user-metadata.ts pickColor: prefer
 * an unused palette swatch, else fall back to a stable per-username hash so two
 * members never silently collapse to one color and the choice is stable across
 * runs.
 */
function pickColor(taken: Set<string>, username: string): string {
  for (const color of HEX_PALETTE) {
    if (!taken.has(color)) return color;
  }
  // Hash fallback (same algorithm as user-metadata.ts hashColor).
  let hash = 0;
  for (let i = 0; i < username.length; i += 1) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return HEX_PALETTE[Math.abs(hash) % HEX_PALETTE.length];
}

/** Exposed for unit tests: the role -> account_type mapping. */
export const _roleToAccountTypeForTest = roleToAccountType;
