/**
 * purchase-history.ts
 *
 * Version history for purchase items, the structured-record analogue of
 * history.ts (notes). Reads a purchase item's Loro native history and
 * reconstructs the field-map state at any past version. This is the engine
 * layer that purchase-history-engine.ts wires into the GENERIC
 * EntityVersionHistorySidebar + the purchase adapter + grouping, which expect
 * the same index convention and canonical-string shape as the notes path.
 *
 * Key design decisions (identical to history.ts):
 *   - Every call to listPurchaseVersions or reconstruct* uses a FRESH throwaway
 *     clone from loadOrRebuildPurchaseDoc. The live editing doc is never touched.
 *   - doc.checkout() DETACHES the clone; the clone is discarded after projection.
 *   - Versions are sorted by lamport ascending, so index 0 is the oldest change
 *     (the seed / genesis), matching the index convention buildVersionList wants.
 *   - The frontier for a change = { peer, counter: counter + length - 1 }, the
 *     last op in the change, because checkout to that op produces the full state
 *     AFTER the entire change is applied.
 *   - The canonical string is produced by the SAME canonicalize() the notes path
 *     uses, so the purchase adapter parses it the same way and the existing
 *     grouping code is reused unchanged.
 *
 * Purchase items are a FLAT field map (getPurchaseFields projects a PurchaseItem),
 * so reconstruction is simpler than notes (no markdown entries / per-entry
 * metadata). canonicalize() strips the volatile total_price / last_edited_*
 * stamps (see canonicalize.ts FLAG-derived-cache list) so a recompute-only save
 * does not pollute the diff.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { LoroDoc } from "loro-crdt";
import { loadOrRebuildPurchaseDoc } from "./purchase-sidecar-store";
import { getPurchaseFields } from "./purchase-doc";
import { readActors } from "./actors";
import { canonicalize } from "@/lib/history/canonicalize";
import type { PurchaseItem } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One entry in the ordered version list derived from Loro's native history.
 * Index 0 is the OLDEST change (the seed); the highest index is HEAD.
 * Mirrors LoroVersionEntry in history.ts.
 */
export interface PurchaseVersionEntry {
  /** Position in the lamport-sorted change list. 0 = oldest (seed). */
  index: number;
  /** Frontier identifying this version: the last op of the change. */
  frontiers: { peer: string; counter: number }[];
  /** Wall-clock time of the change in milliseconds since epoch. */
  timestampMs: number;
  /** Raw Loro peer id string for the actor who made this change. */
  peer: string;
  /** Resolved display name for the actor ("seed" for peer "0"). */
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
 * Flatten getAllChanges() (a Map<peer, Change[]>) into a single array sorted by
 * lamport ascending so that index 0 is the oldest operation. Identical to the
 * flattenAndSort in history.ts (lamport is the only correct causal order across
 * peers; wall-clock timestamps can be skewed between devices).
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
 * List all versions in a purchase item's Loro history, oldest first
 * (index 0 = seed). Loads the sidecar into a fresh throwaway doc (never touches
 * a live editing handle), flattens getAllChanges() sorted by lamport, and maps
 * each change to a PurchaseVersionEntry with resolved actor identity.
 */
export async function listPurchaseVersions(
  owner: string,
  id: number,
): Promise<PurchaseVersionEntry[]> {
  // Fresh throwaway clone -- never used for editing.
  const doc = await loadOrRebuildPurchaseDoc(owner, id);
  const actors = await readActors(owner);

  const changes = flattenAndSort(doc);

  return changes.map((change, index) => {
    const peer = change.peer;

    // Resolve username from the actors map. The seed peer ("0") is the
    // deterministic seeder, not a real device, so label it "seed" rather than
    // the raw "0" string which would confuse users.
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
      frontiers: [{ peer, counter: change.counter + change.length - 1 }],
      timestampMs: change.timestamp * 1000,
      peer,
      username,
      message: change.message ?? "",
    };
  });
}

/**
 * Reconstruct the PurchaseItem field map at a given version index.
 *
 * Uses a fresh throwaway clone (separate per call) so concurrent calls are safe.
 * Checks out the clone to the version's frontier, projects it to a PurchaseItem
 * via getPurchaseFields, and discards the detached clone.
 */
export async function reconstructPurchaseAt(
  owner: string,
  id: number,
  versionIndex: number,
): Promise<PurchaseItem> {
  // Separate fresh clone per call -- do not share state across calls.
  const doc = await loadOrRebuildPurchaseDoc(owner, id);
  const changes = flattenAndSort(doc);

  if (versionIndex < 0 || versionIndex >= changes.length) {
    throw new Error(
      `[loro/purchase-history] reconstructPurchaseAt: versionIndex ${versionIndex} out of range [0, ${changes.length - 1}]`,
    );
  }

  const change = changes[versionIndex];
  // change.peer is a PeerID string (`${number}` template literal type).
  const frontier = [
    {
      peer: change.peer as `${number}`,
      counter: change.counter + change.length - 1,
    },
  ];

  // checkout() detaches the doc from HEAD and time-travels to this frontier.
  // The clone is discarded after projection, so the detached state never leaks.
  doc.checkout(frontier);

  return getPurchaseFields(doc);
}

/**
 * Reconstruct the canonical JSON string at a given version index.
 *
 * Returns the same pretty-printed format as the notes path
 * (canonicalize.ts: JSON.stringify(record, null, 2) + "\n" with volatile keys
 * stripped and remaining keys sorted). This is what the purchase adapter's
 * projectBody expects, so the generic grouping + diff code works unchanged.
 */
export async function reconstructPurchaseCanonicalAt(
  owner: string,
  id: number,
  versionIndex: number,
): Promise<string> {
  const item = await reconstructPurchaseAt(owner, id, versionIndex);
  return canonicalize(item);
}
