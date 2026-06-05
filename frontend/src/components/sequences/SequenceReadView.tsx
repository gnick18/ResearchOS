"use client";

// sequence seq-unify bot — the READ-ONLY surface is now just the UNIFIED editor
// rendered with `readOnly`. There is no separate read renderer anymore: the
// Read|Edit modal toggle was collapsed (SnapGene/Benchling have no such mode),
// so this is a thin wrapper kept for callers that want an explicitly read-only
// embed (future in-note embeds / read-only-shared sequences). The /sequences
// route renders <SequenceEditView> directly (editable). Selection + readout +
// double-click feature info all work in read-only.

import type { SequenceDetail } from "@/lib/types";
import SequenceEditView from "./SequenceEditView";
import type { SequenceViewMode } from "./SequenceTabBar";

export default function SequenceReadView({
  sequence,
  initialViewMode,
  initialShowEnzymes,
  embedded,
}: {
  sequence: SequenceDetail;
  /** Seed the embedded map's view tab (e.g. "map" to open on the ring). */
  initialViewMode?: SequenceViewMode;
  /** Start the cut-site layer ON (restriction / Golden Gate previews). */
  initialShowEnzymes?: boolean;
  /** Hide the editor toolbar row for a slim preview embed. */
  embedded?: boolean;
}) {
  return (
    <SequenceEditView
      sequence={sequence}
      readOnly
      initialViewMode={initialViewMode}
      initialShowEnzymes={initialShowEnzymes}
      embedded={embedded}
    />
  );
}
