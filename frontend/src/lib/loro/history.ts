/**
 * Loro history engine for Phase 2 version control.
 *
 * Reads a note's Loro native history and reconstructs the note state at any
 * past version. This is the engine layer that the adapter shim (chunk 3) will
 * wire into the existing EntityVersionHistorySidebar + notesAdapter + grouping,
 * which expect the same index convention and canonical-string shape as the
 * legacy delta engine.
 *
 * Key design decisions:
 *   - Every call to listVersions or reconstructNoteAt uses a FRESH throwaway
 *     clone from loadOrRebuild. The live editing doc is never touched.
 *   - doc.checkout() DETACHES the clone; the clone is discarded after projection.
 *   - Versions are sorted by lamport ascending, so index 0 is the oldest change
 *     (matching the legacy engine where versionIndex 0 is the anchor/genesis row).
 *   - The frontier for a change = { peer, counter: counter + length - 1 }, the
 *     last op in the change, because checkout to that op produces the full state
 *     AFTER the entire change is applied.
 *   - The canonical string is produced by the same canonicalize() used by the
 *     legacy engine, so the existing notesAdapter.projectBody (projectNoteState)
 *     parses it unchanged.
 */

import { LoroDoc } from "loro-crdt";
import { loadOrRebuild } from "./sidecar-store";
import { projectToNote } from "./mirror";
import { readActors } from "./actors";
import { canonicalize } from "@/lib/history/canonicalize";
import type { Note } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One entry in the ordered version list derived from Loro's native history.
 *
 * Index convention matches the legacy engine: index 0 is the OLDEST change
 * (the seed / genesis), and the highest index is the newest (HEAD). The
 * existing EntityVersionHistorySidebar and grouping code receive a newest-first
 * view model built on top of these indices; they invert ordering themselves.
 */
export interface LoroVersionEntry {
  /** Position in the lamport-sorted change list. 0 = oldest (seed). */
  index: number;
  /**
   * Frontier identifying this version: the last op of the change.
   * Passing this to doc.checkout() produces the full doc state after the change.
   */
  frontiers: { peer: string; counter: number }[];
  /** Wall-clock time of the change in milliseconds since epoch. */
  timestampMs: number;
  /** Raw Loro peer id string for the actor who made this change. */
  peer: string;
  /**
   * Resolved display name for the actor. Falls back to the raw peer string
   * when the actors map has no entry, except for the seed peer ("0") which
   * shows "seed" to indicate it came from the deterministic seeder.
   */
  username: string;
  /** Commit message set at doc.commit({ message }). Empty string when absent. */
  message: string;
}

// ---------------------------------------------------------------------------
// Internal: flatten and sort Loro changes by lamport
// ---------------------------------------------------------------------------

interface LoroChange {
  peer: string;
  counter: number;
  lamport: number;
  timestamp: number;
  message: string | undefined;
  length: number;
}

/**
 * Flatten getAllChanges() (a Map<peer, Change[]>) into a single array sorted
 * by lamport ascending so that index 0 is the oldest operation.
 *
 * Lamport ordering is the only correct causal ordering across peers: wall-clock
 * timestamps can be skewed between devices and are unreliable for ordering.
 */
function flattenAndSort(doc: LoroDoc): LoroChange[] {
  const allChanges = doc.getAllChanges() as Map<string, LoroChange[]>;
  const flat: LoroChange[] = [];
  for (const changes of allChanges.values()) {
    for (const change of changes) {
      flat.push(change);
    }
  }
  flat.sort((a, b) => a.lamport - b.lamport);
  return flat;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List all versions in a note's Loro history, oldest first (index 0 = seed).
 *
 * Loads the sidecar into a fresh throwaway doc (never touches the live editing
 * doc), flattens getAllChanges() sorted by lamport, and maps each change to a
 * LoroVersionEntry with resolved actor identity.
 */
export async function listVersions(
  owner: string,
  base: Note,
): Promise<LoroVersionEntry[]> {
  // Fresh throwaway clone -- this doc is never used for editing.
  const doc = await loadOrRebuild(owner, base);
  const actors = await readActors(owner);

  const changes = flattenAndSort(doc);

  return changes.map((change, index) => {
    const peer = change.peer;

    // Resolve username from the actors map. The seed peer ("0") is a special
    // case: it is the deterministic seeder, not a real device, so label it
    // "seed" rather than the raw "0" string which would confuse users.
    let username: string;
    if (peer === "0") {
      username = "seed";
    } else if (actors[peer]) {
      username = actors[peer].username;
    } else {
      username = peer;
    }

    return {
      index,
      // The frontier is the LAST op of the change (counter + length - 1).
      // Checking out to this frontier puts the doc in the state produced by
      // the entire change, not just the first op.
      frontiers: [{ peer, counter: change.counter + change.length - 1 }],
      timestampMs: change.timestamp * 1000,
      peer,
      username,
      message: change.message ?? "",  // Change.message is string | undefined
    };
  });
}

/**
 * Reconstruct the Note state at a given version index.
 *
 * Uses a fresh throwaway clone (separate per call) so concurrent calls are
 * safe. Checks out the clone to the version's frontier, projects it to a Note
 * via projectToNote, and discards the detached clone.
 */
export async function reconstructNoteAt(
  owner: string,
  base: Note,
  versionIndex: number,
): Promise<Note> {
  // Separate fresh clone per call -- do not share state across calls.
  const doc = await loadOrRebuild(owner, base);
  const changes = flattenAndSort(doc);

  if (versionIndex < 0 || versionIndex >= changes.length) {
    throw new Error(
      `[loro/history] reconstructNoteAt: versionIndex ${versionIndex} out of range [0, ${changes.length - 1}]`,
    );
  }

  const change = changes[versionIndex];
  // change.peer is a PeerID string (`${number}` template literal type).
  // The cast is safe: getAllChanges() guarantees peer is a PeerID string.
  const frontier = [
    {
      peer: change.peer as `${number}`,
      counter: change.counter + change.length - 1,
    },
  ];

  // checkout() detaches the doc from HEAD and time-travels to this frontier.
  // The clone is discarded after projection, so the detached state never leaks.
  doc.checkout(frontier);

  return projectToNote(doc, base);
}

/**
 * Reconstruct the canonical JSON string at a given version index.
 *
 * Returns the same pretty-printed format as the legacy engine's reconstructState
 * (canonicalize.ts: JSON.stringify(record, null, 2) + "\n" with volatile keys
 * stripped and remaining keys sorted). This is what notesAdapter.projectBody
 * (projectNoteState) expects, so the existing adapter + grouping work unchanged
 * in chunk 3.
 */
export async function reconstructCanonicalAt(
  owner: string,
  base: Note,
  versionIndex: number,
): Promise<string> {
  const note = await reconstructNoteAt(owner, base, versionIndex);
  return canonicalize(note);
}
