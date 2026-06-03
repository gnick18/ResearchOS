"use client";

// sequence Phase 1 bot — READ-ONLY SeqViz view of a selected sequence. Phase 1
// is view-only: no caret editing, no clipboard, no enzymes/primers, no view
// toggles (those are Phases 2-3). SeqViz is mounted client-side only via
// next/dynamic (ssr: false) since it touches the DOM / ResizeObserver.
//
// 2c-polish bot: read mode now also tracks the live SeqViz selection and shows
// the shared selection readout (coords / length bp / GC%) so viewers can probe
// a region without entering edit mode (Grant ask).

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { SequenceDetail } from "@/lib/types";
import type { AnnotationProp } from "@/vendor/seqviz/elements";
import type { Selection } from "@/vendor/seqviz/selectionContext";
import SequenceSelectionReadout from "./SequenceSelectionReadout";

// Dynamically import the vendored SeqViz client-only. The default export is the
// SeqViz React component.
const SeqViz = dynamic(() => import("@/vendor/seqviz"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-gray-400">
      Loading viewer…
    </div>
  ),
});

export default function SequenceReadView({ sequence }: { sequence: SequenceDetail }) {
  // Track the live SeqViz selection so the readout can show coords / bp / GC%.
  const [selection, setSelection] = useState<Selection | null>(null);

  const annotations: AnnotationProp[] = useMemo(
    () =>
      sequence.annotations.map((a) => ({
        name: a.name,
        start: a.start,
        end: a.end,
        direction: a.direction,
        color: a.color,
      })),
    [sequence.annotations],
  );

  // Plasmids (circular) read best as "both" (circular map + linear track);
  // linear molecules show just the linear viewer.
  const viewer = sequence.circular ? "both" : "linear";

  return (
    <div className="flex h-full w-full flex-col">
      <div className="min-h-0 flex-1">
        <SeqViz
          name={sequence.locus_name || sequence.display_name}
          seq={sequence.seq}
          seqType={sequence.seq_type === "protein" ? "aa" : sequence.seq_type}
          annotations={annotations}
          primers={[]}
          viewer={viewer}
          onSelection={setSelection}
          showComplement
          showIndex
          disableExternalFonts
          style={{ height: "100%", width: "100%" }}
        />
      </div>
      {/* Shared live selection readout (coords / length bp / GC%). */}
      <SequenceSelectionReadout selection={selection} seq={sequence.seq} />
    </div>
  );
}
