"use client";

// sequence Phase 1 bot — READ-ONLY SeqViz view of a selected sequence. Phase 1
// is view-only: no caret editing, no clipboard, no enzymes/primers, no view
// toggles (those are Phases 2-3). SeqViz is mounted client-side only via
// next/dynamic (ssr: false) since it touches the DOM / ResizeObserver.
//
// 2c-polish bot: read mode now also tracks the live SeqViz selection and shows
// the shared selection readout (coords / length bp / GC%) so viewers can probe
// a region without entering edit mode (Grant ask).

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { SequenceDetail } from "@/lib/types";
import type { AnnotationProp } from "@/vendor/seqviz/elements";
import type { Selection } from "@/vendor/seqviz/selectionContext";
import SequenceSelectionReadout from "./SequenceSelectionReadout";
import FeatureEditorDialog, {
  type FeatureEditorRequest,
} from "./FeatureEditorDialog";
import { documentFromDetail } from "@/lib/sequences/edit-model";
import {
  segmentsOf,
  qualifiersFromNotes,
  readNoteFlag,
  TRANSLATE_NOTE_KEY,
  PRIORITIZE_NOTE_KEY,
} from "@/lib/sequences/feature-edit";

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
  // READ-ONLY feature popup, opened by double-clicking a feature on the map.
  const [featureView, setFeatureView] = useState<FeatureEditorRequest | null>(null);

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

  // A full document (re-parsed from the .gb) so the read-only popup can surface
  // qualifiers, multi-segment locations, and the per-feature display flags that
  // the lossy `annotations` summary drops.
  const doc = useMemo(() => documentFromDetail(sequence), [sequence]);

  // DOUBLE-CLICK A FEATURE -> open the READ-ONLY info popup. Match the clicked
  // annotation back to its feature by (name, start, end), with name/start
  // fallbacks (mirrors the edit view's resolver).
  const handleAnnotationDoubleClick = useCallback(
    (range: { name: string; start: number; end: number; direction?: number }) => {
      let index = doc.features.findIndex(
        (f) => f.name === range.name && f.start === range.start && f.end === range.end,
      );
      if (index < 0) index = doc.features.findIndex((f) => f.name === range.name);
      if (index < 0) index = doc.features.findIndex((f) => f.start === range.start);
      if (index < 0) return;
      const f = doc.features[index];
      setFeatureView({
        mode: "view",
        seqLength: doc.seq.length,
        seq: doc.seq,
        initial: {
          name: f.name,
          type: f.type || "misc_feature",
          strand: f.strand === -1 ? -1 : 1,
          start: f.start,
          end: f.end,
          color: f.color,
          segments: segmentsOf(f),
          qualifiers: qualifiersFromNotes(f.notes),
          translate: readNoteFlag(f.notes, TRANSLATE_NOTE_KEY),
          prioritize: readNoteFlag(f.notes, PRIORITIZE_NOTE_KEY),
        },
        onCancel: () => setFeatureView(null),
      });
    },
    [doc],
  );

  // Plasmids (circular) read best as "both" (circular map + linear track);
  // linear molecules show just the linear viewer.
  const viewer = sequence.circular ? "both" : "linear";

  // Adaptive default zoom: SeqViz's linear zoom defaults to 50 (base-level),
  // which is unreadable for a long genomic contig (hundreds of base rows, no
  // map). At linear zoom <= 5 SeqViz renders the overview "map" (features as
  // arrows along a line). So open large sequences zoomed-out to that map and
  // keep small plasmids at the detailed default. (A real zoom control is a
  // follow-up; this just makes big sequences legible by default.)
  const linearZoom = (sequence.seq?.length ?? 0) > 5000 ? 2 : 50;

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
          zoom={{ linear: linearZoom }}
          onSelection={setSelection}
          onAnnotationDoubleClick={handleAnnotationDoubleClick}
          showComplement
          showIndex
          disableExternalFonts
          style={{ height: "100%", width: "100%" }}
        />
      </div>
      {/* Shared live selection readout (coords / length bp / GC%). */}
      <SequenceSelectionReadout selection={selection} seq={sequence.seq} />
      {/* Read-only feature info popup (double-click a feature on the map). */}
      <FeatureEditorDialog request={featureView} />
    </div>
  );
}
