// Mobile notebook chooser, the laptop publisher (chooser bot, 2026-06-09).
//
// Builds a sealed snapshot listing every notebook the current user can FILE
// INTO (own notes, shared-with-edit notes, 1:1 notebooks) and seals a copy
// for each paired phone using the same pattern as inventory-snapshot.ts.
//
// The phone uses this snapshot to render the NotebookChooser bottom-sheet,
// which groups notebooks into: Own / Shared (edit only) / 1:1. View-only
// shares are intentionally EXCLUDED (you cannot file there).
//
// Snapshot name on the relay: "notebooks"
//
// The decrypted shape the phone reads after openSealed is NotebooksSnapshot.
// Each NotebookSummary item carries enough data for the chooser UI and the
// route-capture-note command (noteId, owner, entries for the entry picker).
//
// No em-dashes, no emojis, no mid-sentence colons.

import { labApi, buildCurrentViewer } from "@/lib/local-api";
import { discoverUsers } from "@/lib/file-system/user-discovery";
import { sealToRecipient } from "@/lib/sharing/encryption";
import { decodePublicKey } from "@/lib/sharing/identity/keys";
import { listDevices, publishSnapshot, type UserCaptureKeys } from "./client";
import {
  canWriteIgnoringPiRole,
  normalizeSharedWith,
} from "@/lib/sharing/unified";
import type { Note, OneOnOne } from "@/lib/types";
import { normalizeOneOnOne } from "@/lib/one-on-one/normalize";

// ── Types ────────────────────────────────────────────────────────────────────

/** One entry row the chooser can show inside a multi-entry running-log note. */
export interface NotebookEntryStub {
  id: string;
  title: string;
  /** ISO YYYY-MM-DD date string. */
  date: string;
}

/**
 * One notebook (a Note record) as it appears in the chooser's notebook list.
 *
 * kind discriminates the section it appears in:
 *   "own"      — a note the user owns (personal or shared-out by them)
 *   "shared"   — a note owned by someone else, shared with the user at "edit"
 *   "oneOnOne" — a note scoped to a 1:1 lab-head <-> member relationship
 *
 * entries is populated for running-log notes (is_running_log true) and also for
 * all notes so the chooser has a title to show. Capped at 20 newest entries.
 *
 * lastEditedEntryId: the entry the user most recently touched, or null when
 * there is no clear signal. Used to pre-select the "recommended" entry in the
 * NoteEntryPicker when no focus context provides a more precise one.
 */
export interface NotebookSummary {
  noteId: number;
  /** The username the note lives under (= the note's `username` field). */
  owner: string;
  title: string;
  isRunningLog: boolean;
  /** "own" | "shared" | "oneOnOne" */
  kind: "own" | "shared" | "oneOnOne";
  entries: NotebookEntryStub[];
  lastEditedEntryId: string | null;
  /**
   * For shared notes: the owner's username (who shared it).
   * For 1:1 notebooks: the other participant's username so the chooser can
   * show "1:1 with <partnerName>". Null for own notebooks.
   */
  partnerUsername: string | null;
  /**
   * For 1:1 notebooks: whether the current user is the lab head in the 1:1.
   * Used to render the PI/student tag. Null for own/shared.
   */
  isLabHead: boolean | null;
}

/** The full snapshot the phone decrypts. */
export interface NotebooksSnapshot {
  generatedAt: string;
  notebooks: NotebookSummary[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Pick the entry the user last edited (by updated_at, falling back to date).
 * Returns the entry id of the most-recent entry, or null when there are none.
 */
function resolveLastEditedEntryId(note: Note): string | null {
  if (!note.entries || note.entries.length === 0) return null;
  const sorted = [...note.entries].sort((a, b) => {
    const ta = (a as { updated_at?: string }).updated_at ?? a.date ?? "";
    const tb = (b as { updated_at?: string }).updated_at ?? b.date ?? "";
    return tb.localeCompare(ta);
  });
  return sorted[0]?.id ?? null;
}

/** Build entry stubs for the chooser, sorted newest-first, capped at 20. */
function buildEntryStubs(note: Note): NotebookEntryStub[] {
  if (!note.entries || note.entries.length === 0) return [];
  const sorted = [...note.entries].sort((a, b) => {
    const da = a.date ?? "";
    const db = b.date ?? "";
    return db.localeCompare(da);
  });
  return sorted.slice(0, 20).map((e) => ({
    id: e.id,
    title: e.title ?? "Untitled entry",
    date: e.date ?? "",
  }));
}

/**
 * Resolve the username a note should be filed under.
 * `note.username` is the creator attribution + folder routing key.
 * Falls back to the folder we found it in when the field is absent (legacy notes).
 */
function resolveNoteOwner(note: Note, folderUsername: string): string {
  return note.username || folderUsername;
}

// ── Snapshot builder ─────────────────────────────────────────────────────────

/**
 * Build the notebooks snapshot for the current user. Returns a list of every
 * notebook the user can file into, grouped by kind. View-only shares are
 * excluded because you cannot route a capture there.
 *
 * Identification strategy:
 *   - Own notes: owner === currentUser (includes notes the user created and
 *     optionally shared out, plus unshared personal notes).
 *   - Shared notes (edit only): owned by someone else; canWriteIgnoringPiRole
 *     returns true for the current user (i.e. the user appears in shared_with
 *     with level "edit", or the "*" whole-lab sentinel with level "edit").
 *     The PI role-based write-all (lab_head write-all) is intentionally
 *     excluded via canWriteIgnoringPiRole so the PI's chooser shows only
 *     explicitly shared notebooks, not every lab member's note.
 *   - 1:1 notes: carry one_on_one_id; the current user is either the labHead
 *     or member of that 1:1. Both participants have edit access (both are in
 *     shared_with at "edit").
 */
export async function buildNotebooksSnapshot(): Promise<NotebooksSnapshot> {
  const viewer = await buildCurrentViewer();
  const currentUser = viewer.username;

  if (!currentUser) {
    return { generatedAt: new Date().toISOString(), notebooks: [] };
  }

  const allUsernames = await discoverUsers();
  const notebooks: NotebookSummary[] = [];

  // ── Own and shared notes ──────────────────────────────────────────────────
  // Walk every user's note folder. Gate on ownership or explicit edit share.
  // Skip notes that carry one_on_one_id (those are handled separately below
  // so we can attach the partner/isLabHead metadata from the 1:1 record).

  for (const username of allUsernames) {
    let userNotes: Note[];
    try {
      userNotes = await labApi.getUserNotes(username);
    } catch {
      // One user folder being unreadable must not abort the whole snapshot.
      continue;
    }

    for (const note of userNotes) {
      // 1:1 notes handled in the oneOnOne section below.
      if (note.one_on_one_id) continue;

      const owner = resolveNoteOwner(note, username);
      const isOwn = owner === currentUser;

      if (isOwn) {
        // Owner always has write access.
        notebooks.push({
          noteId: note.id,
          owner,
          title: note.title || "Untitled notebook",
          isRunningLog: note.is_running_log ?? false,
          kind: "own",
          entries: buildEntryStubs(note),
          lastEditedEntryId: resolveLastEditedEntryId(note),
          partnerUsername: null,
          isLabHead: null,
        });
      } else {
        // Only include notes where the current user has explicit edit access
        // (not just the implicit lab-head write-all). This ensures the chooser
        // shows only notes the user was deliberately invited to edit.
        const sharedRecord = {
          owner,
          shared_with: normalizeSharedWith(note.shared_with ?? []),
        };
        if (!canWriteIgnoringPiRole(sharedRecord, viewer)) continue;

        notebooks.push({
          noteId: note.id,
          owner,
          title: note.title || "Untitled notebook",
          isRunningLog: note.is_running_log ?? false,
          kind: "shared",
          entries: buildEntryStubs(note),
          lastEditedEntryId: resolveLastEditedEntryId(note),
          partnerUsername: owner,
          isLabHead: null,
        });
      }
    }
  }

  // ── 1:1 notebooks ─────────────────────────────────────────────────────────
  // Fetch the 1:1 records the current user participates in, then walk all
  // user folders to find notes carrying each 1:1's id. Both the lab head and
  // the member can file into any note scoped to their 1:1.

  let oneOnOnes: OneOnOne[] = [];
  try {
    oneOnOnes = await labApi.getOneOnOnes();
  } catch {
    // Best-effort: 1:1 section omitted when unavailable.
  }

  const ooById = new Map<string, OneOnOne>();
  for (const oo of oneOnOnes) {
    ooById.set(oo.id, oo);
  }

  // Deduplicate by "owner:noteId" — notes live in one folder but the walk
  // visits every folder, so we could see the same note via two usernames if
  // the note was somehow mirrored. Guard defensively.
  const seenOneOnOne = new Set<string>();

  for (const username of allUsernames) {
    let userNotes: Note[];
    try {
      userNotes = await labApi.getUserNotes(username);
    } catch {
      continue;
    }

    for (const note of userNotes) {
      if (!note.one_on_one_id) continue;

      const oo = ooById.get(note.one_on_one_id);
      // Skip notes whose 1:1 we could not resolve, or where the current user
      // is not a participant. `getOneOnOnes` returns normalized records, so we
      // read the generalized `members`/`mentor` instead of the legacy binary.
      if (!oo) continue;
      const normalized = normalizeOneOnOne(oo);
      const isParticipant = normalized.members.includes(currentUser);
      if (!isParticipant) continue;

      const owner = resolveNoteOwner(note, username);
      const dedupKey = `${owner}:${note.id}`;
      if (seenOneOnOne.has(dedupKey)) continue;
      seenOneOnOne.add(dedupKey);

      // The partner is the other member of a pair space (the first non-viewer
      // for a group). The mentor flag is whether the viewer mentors this space.
      const partnerUsername =
        normalized.members.find((m) => m !== currentUser) ?? "";
      const isLabHead = normalized.mentor === currentUser;

      notebooks.push({
        noteId: note.id,
        owner,
        title: note.title || "Untitled 1:1 notebook",
        isRunningLog: note.is_running_log ?? false,
        kind: "oneOnOne",
        entries: buildEntryStubs(note),
        lastEditedEntryId: resolveLastEditedEntryId(note),
        partnerUsername,
        isLabHead,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    notebooks,
  };
}

// ── Publisher ────────────────────────────────────────────────────────────────

/**
 * Build the notebooks snapshot once, seal a copy to each paired phone's
 * X25519 key, and publish it to the relay under the "notebooks" name.
 * Mirrors publishInventoryToAllDevices exactly.
 * Returns how many were published vs skipped (no seal key on file).
 */
export async function publishNotebooksToAllDevices(
  keys: UserCaptureKeys,
): Promise<{ published: number; skipped: number }> {
  const devices = await listDevices(keys);
  if (devices.length === 0) return { published: 0, skipped: 0 };

  const snap = await buildNotebooksSnapshot();
  const plaintext = new TextEncoder().encode(JSON.stringify(snap));

  let published = 0;
  let skipped = 0;
  for (const device of devices) {
    if (!device.x25519Pubkey) {
      console.info(
        `[notebooks-publisher] skip device ${device.devicePubkey.slice(0, 12)}... (no x25519 seal key)`,
      );
      skipped += 1;
      continue;
    }
    const sealed = sealToRecipient(
      plaintext,
      decodePublicKey(device.x25519Pubkey),
    );
    await publishSnapshot(keys, "notebooks", device.devicePubkey, sealed);
    published += 1;
  }
  return { published, skipped };
}
