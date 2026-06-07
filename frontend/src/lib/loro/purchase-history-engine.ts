/**
 * purchase-history-engine.ts
 *
 * Purchase items on Loro (docs/proposals/PURCHASE_LORO.md) chunk 4 = a
 * Loro-backed VersionHistorySource for purchase items, mirroring
 * history-engine.ts (notes). makeLoroPurchaseHistoryEngine(owner, id) returns
 * the same readHistory + reconstructState surface the GENERIC
 * EntityVersionHistorySidebar consumes, so the purchase adapter + grouping logic
 * drive the sidebar from a purchase item's Loro native history with no sidebar
 * change.
 *
 * Row mapping rules (identical to the notes engine):
 *   - index 0 (the seed, peer "0") maps to a GenesisRow. buildVersionList SKIPS
 *     genesis rows when building the renderable list, which is right: the seed is
 *     the baseline record snapshot, not a restorable user-visible version.
 *   - Every other index maps to a DeltaRow with kind derived from the Loro commit
 *     message ("restore*" -> "revert", else "update"). The delta / post_hash
 *     fields are STUBBED to "" because the Loro engine reconstructs via
 *     doc.checkout(), not delta replay, so they carry no semantic content here.
 *
 * Index alignment: the versionIndex the sidebar passes to reconstructState is the
 * row's position in the array (0 = seed), which equals PurchaseVersionEntry.index.
 * No offset arithmetic.
 *
 * Unlike makeLoroHistoryEngine (which captures a `base` Note), this engine
 * captures (owner, id): the purchase reconstruct path loads the sidecar from
 * (owner, id) directly, so no base record needs threading through.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import type { VersionHistorySource } from "@/components/history/EntityVersionHistorySidebar";
import {
  listPurchaseVersions,
  reconstructPurchaseCanonicalAt,
} from "./purchase-history";
import type { DeltaRow, GenesisRow, HistoryRow } from "@/lib/history/types";

/**
 * Derive the best HistoryEditKind for a Loro commit message. A message starting
 * with "restore" (case-insensitive) comes from the restore path
 * (restorePurchaseVersion); everything else is an ordinary field edit.
 */
function kindFromMessage(message: string): DeltaRow["kind"] {
  if (message.toLowerCase().startsWith("restore")) return "revert";
  return "update";
}

/**
 * Build a VersionHistorySource backed by a purchase item's Loro native history.
 *
 * The returned object captures (owner, id) in its closure and ignores the
 * entityType / passed-owner / id arguments the sidebar threads in (the engine is
 * bound to one item at construction time, the closure binding is authoritative).
 * The wiring passes entityType = "purchase_items" and id = the same id, which is
 * consistent.
 */
export function makeLoroPurchaseHistoryEngine(
  owner: string,
  id: number,
): VersionHistorySource {
  return {
    async readHistory(
      _entityType: string,
      _owner: string,
      _id: number,
    ): Promise<HistoryRow[]> {
      const entries = await listPurchaseVersions(owner, id);

      return entries.map((entry): HistoryRow => {
        if (entry.index === 0) {
          // The seed commit is the baseline -- not a user-authored version.
          const genesis: GenesisRow = {
            id: `loro-purchase-seed-${id}`,
            ts: new Date(entry.timestampMs).toISOString(),
            v: 1,
            actor: entry.username,
            owner,
            kind: "genesis",
            // Stubbed: never read by buildVersionList or the adapter.
            post_hash: "",
          };
          return genesis;
        }

        // User-authored edit. delta + post_hash are intentionally stubbed (the
        // Loro engine reconstructs via doc.checkout(), not delta replay).
        const delta: DeltaRow = {
          id: `loro-purchase-v${entry.index}-${id}`,
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
      _owner: string,
      _id: number,
      versionIndex: number,
      // headCanonical is unused by the Loro engine: doc.checkout() carries its
      // own full state, no anchor resolution needed.
      _headCanonical?: string,
    ): Promise<string> {
      return reconstructPurchaseCanonicalAt(owner, id, versionIndex);
    },
  };
}
