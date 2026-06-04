/**
 * Deterministic seed builder: converts a legacy Note into a Loro snapshot whose
 * bytes are IDENTICAL across any two devices that seed the same note independently.
 *
 * This is the single most important correctness property in Phase 1. If two devices
 * each seed from the same legacy file and the bytes differ, their docs are treated as
 * independent forks by the CRDT merge, and the content is duplicated rather than
 * converged. See UNIFIED_DATA_MODEL.md section 9 ("the fork pitfall").
 *
 * Three knobs make the output deterministic:
 *   1. Fixed peer id (SEED_ACTOR_ID) -- every seeder uses the same actor, so all
 *      operations carry the same (peer, counter) ids.
 *   2. Fixed timestamp derived from the note's own created_at field, never wall-clock.
 *      Loro timestamps are in seconds; we parse the ISO string and floor to seconds.
 *      If created_at is absent we fall back to SEED_EPOCH (1970-01-01T00:00:00Z).
 *   3. Canonical insert ordering -- meta keys in a declared fixed order, entries sorted
 *      by their id string (lexicographic), each Text content inserted in one operation.
 */

import { LoroDoc, LoroMap, LoroText } from "loro-crdt";
import type { Note } from "@/lib/types";

// ---------------------------------------------------------------------------
// Exported constants (other chunks need these)
// ---------------------------------------------------------------------------

/**
 * Fixed actor id used for every seed commit.
 * Must never be used as a device's live editing peer id -- only the seed uses it.
 * Documented here so chunks 2-5 can detect "this op came from a seed commit" if needed.
 */
export const seedActorId: bigint = BigInt(0);

/**
 * Fallback epoch timestamp (seconds) used when a note has no created_at field.
 * Zero = 1970-01-01T00:00:00Z. This is intentional and documented; a note that
 * predates created_at tracking just gets the epoch as its seed timestamp.
 */
export const SEED_EPOCH = 0;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse an ISO 8601 string to a Unix timestamp in seconds.
 * Returns SEED_EPOCH on any parse failure, which keeps the output deterministic
 * even for malformed or missing timestamps.
 */
function isoToSeconds(iso: string | null | undefined): number {
  if (!iso) return SEED_EPOCH;
  const ms = Date.parse(iso);
  if (isNaN(ms)) return SEED_EPOCH;
  return Math.floor(ms / 1000);
}

// ---------------------------------------------------------------------------
// Core builder
// ---------------------------------------------------------------------------

/**
 * Seed a legacy Note into a Loro snapshot.
 *
 * The returned Uint8Array is byte-identical for any two callers given the same
 * Note object (modulo normalized field ordering -- see canonical ordering below).
 * The snapshot can be loaded into a fresh LoroDoc on any device and will merge
 * cleanly with any other doc seeded from the same Note, because all operations
 * share the same (peer, counter) ids.
 *
 * Fields tracked by the seed (per locked design doc section 9):
 *   meta map: title, description, is_running_log, created_at
 *   entries movable list: each entry's id, title, date, created_at, updated_at,
 *                         and a nested Text container holding the content string.
 *
 * Fields explicitly IGNORED (comments, flagged, is_shared, updated_at on note,
 * username -- these are either runtime state or not tracked by the CRDT pilot).
 */
export function seedNoteDoc(note: Note): Uint8Array {
  const doc = new LoroDoc();

  // Step 1: fixed peer id. Every op in this commit gets (SEED_ACTOR_ID, counter).
  doc.setPeerId(seedActorId);

  // Step 2: write meta in canonical key order (title, description, is_running_log,
  // created_at). Order matters because Loro encodes ops in insertion order and
  // the same insertion sequence must play out on both devices.
  const meta = doc.getMap("meta");
  meta.set("title",          note.title       ?? "");
  meta.set("description",    note.description ?? "");
  meta.set("is_running_log", note.is_running_log ?? false);
  meta.set("created_at",     note.created_at  ?? "");

  // Step 3: write entries sorted by id (lexicographic). Sorting the caller's
  // input array removes any dependency on the order entries happen to be stored
  // in the JSON file, which may differ across devices that independently edited
  // the file before the CRDT was introduced.
  const sortedEntries = [...note.entries].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );

  const entries = doc.getMovableList("entries");

  for (let i = 0; i < sortedEntries.length; i++) {
    const e = sortedEntries[i];

    // Insert a child LoroMap at position i. insertContainer returns the live
    // container handle we can write into immediately.
    const entryMap = entries.insertContainer(i, new LoroMap());

    // Write scalar fields in a fixed declared order (same reasoning as meta).
    entryMap.set("id",         e.id         ?? "");
    entryMap.set("title",      e.title      ?? "");
    entryMap.set("date",       e.date       ?? "");
    entryMap.set("created_at", e.created_at ?? "");
    entryMap.set("updated_at", e.updated_at ?? "");

    // Nest a LoroText for the content body. setContainer attaches it as a child
    // of the entryMap and returns the live LoroText handle.
    const text = entryMap.setContainer("content", new LoroText());

    // Insert the full content string in ONE operation. A single insert avoids
    // any dependency on chunking decisions and keeps the op count deterministic.
    if (e.content) {
      text.insert(0, e.content);
    }
  }

  // Step 4: commit with the fixed timestamp. Loro enforces monotonically
  // increasing timestamps within a peer, but since this is the only commit
  // on this peer (the seed peer is never reused for real edits), a single
  // timestamp is all that is needed.
  const timestamp = isoToSeconds(note.created_at);
  doc.commit({
    message:   "seed from legacy note",
    timestamp,
  });

  // Step 5: export as a full snapshot. The "snapshot" mode includes the full
  // op log and state, so the receiving device can both load the current state
  // AND replay history from the first op.
  return doc.export({ mode: "snapshot" });
}

/**
 * Alias for clarity in chunk 2's rebuild-from-mirror path.
 * Semantically identical to seedNoteDoc.
 */
export const rebuildFromNote = seedNoteDoc;
