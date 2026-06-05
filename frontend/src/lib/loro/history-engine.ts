/**
 * Phase 2 chunk 3: Loro-backed VersionHistorySource.
 *
 * makeLoroHistoryEngine(base) returns a VersionHistorySource that drives
 * EntityVersionHistorySidebar from a note's Loro native history instead of
 * the legacy jsdiff delta store. The existing adapter (notesAdapter) and
 * grouping logic (buildVersionList) consume the rows and canonical strings
 * unchanged because the canonical format is identical (canonicalize.ts
 * pretty-prints both paths the same way).
 *
 * Row mapping rules:
 *   - index 0 (the seed, peer "0", message "seed from legacy note") maps to a
 *     GenesisRow. buildVersionList SKIPS genesis rows when building the
 *     renderable list, which is exactly right: the seed is the baseline
 *     document snapshot, not a restorable user-visible version.
 *   - Every other index maps to a DeltaRow with kind derived from the Loro
 *     commit message ("restore*" -> "revert", else "update"). The `delta` and
 *     `post_hash` fields are STUBBED to "" because buildVersionList and the
 *     notesAdapter never read them; only the legacy engine's reconstruct path
 *     uses them. The Loro engine reconstructs via doc.checkout(), not delta
 *     replay, so those fields carry no semantic content here.
 *
 * Index alignment: the versionIndex the sidebar passes to reconstructState is
 * the row's position in the array (0 = seed), which equals LoroVersionEntry.index
 * (also 0 = seed). No offset arithmetic needed.
 */

import type { VersionHistorySource } from "@/components/history/EntityVersionHistorySidebar";
import { listVersions, reconstructCanonicalAt } from "./history";
import type { DeltaRow, GenesisRow, HistoryRow } from "@/lib/history/types";
import type { Note } from "@/lib/types";

/**
 * Derive the best HistoryEditKind for a Loro commit message.
 *
 * A message starting with "restore" (case-insensitive) comes from the restore
 * path (chunk 4); everything else is an ordinary content edit.
 */
function kindFromMessage(message: string): DeltaRow["kind"] {
  if (message.toLowerCase().startsWith("restore")) return "revert";
  return "update";
}

/**
 * Build a VersionHistorySource backed by the note's Loro native history.
 *
 * The returned object captures `base` in its closure and ignores the
 * entityType / id arguments (the Loro engine is bound to one note at
 * construction time). Chunk 5 (NoteVersionHistorySidebar wiring) will pass
 * entityType = "notes" and id = base.id, which are consistent, but the
 * closure binding is the authoritative lookup key.
 */
export function makeLoroHistoryEngine(base: Note): VersionHistorySource {
  return {
    async readHistory(
      _entityType: string,
      owner: string,
      _id: number,
    ): Promise<HistoryRow[]> {
      const entries = await listVersions(owner, base);

      return entries.map((entry): HistoryRow => {
        if (entry.index === 0) {
          // The seed commit is the baseline -- not a user-authored version.
          // Map to GenesisRow so buildVersionList skips it in the render list.
          const genesis: GenesisRow = {
            id: `loro-seed-${base.id}`,
            ts: new Date(entry.timestampMs).toISOString(),
            v: 1,
            actor: entry.username,
            owner,
            kind: "genesis",
            // Stubbed: this hash is never read by buildVersionList or the
            // notesAdapter. The Loro engine reconstructs via checkout, not hash.
            post_hash: "",
          };
          return genesis;
        }

        // User-authored edit. delta and post_hash are intentionally stubbed:
        // the Loro engine reconstructs state via doc.checkout(), not by
        // replaying delta patches, so these fields are never consumed.
        const delta: DeltaRow = {
          id: `loro-v${entry.index}-${base.id}`,
          ts: new Date(entry.timestampMs).toISOString(),
          v: 1,
          actor: entry.username,
          owner,
          kind: kindFromMessage(entry.message),
          delta: "",
          post_hash: "",
        };
        return delta;
      });
    },

    async reconstructState(
      _entityType: string,
      owner: string,
      _id: number,
      versionIndex: number,
      // headCanonical is unused by the Loro engine: it reconstructs by
      // doc.checkout() which has its own full state, no anchor resolution needed.
      _headCanonical?: string,
    ): Promise<string> {
      return reconstructCanonicalAt(owner, base, versionIndex);
    },
  };
}
