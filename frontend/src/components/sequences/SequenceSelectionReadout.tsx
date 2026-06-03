"use client";

// sequence 2c-polish bot — the LIVE SELECTION READOUT, extracted from
// SequenceEditView so the READ view can share it (Grant ask). Driven by a
// SeqViz selection + the sequence string: shows 1-based inclusive coordinates
// (lo..hi), length in bp, and GC% for a range, or the caret position for a bare
// click. Pure presentation; reuses gcPercent from edit-model. The edit view
// renders it inside its own footer chrome (mode-identical to before); the read
// view renders it as a slim footer bar.

import { useMemo } from "react";
import type { Selection } from "@/vendor/seqviz/selectionContext";
import { gcPercent } from "@/lib/sequences/edit-model";
import { nearestNeighborTm } from "@/lib/calculators/tm-nn";

export type SelectionReadout =
  | { kind: "caret"; caret: number }
  | { kind: "range"; lo: number; hi: number; len: number; gc: number; tm?: number };

/** Derive the readout values from a SeqViz selection over a sequence string.
 *  Returns null when there is no usable selection. */
export function deriveSelectionReadout(
  selection: Selection | null,
  seq: string,
): SelectionReadout | null {
  if (!selection || typeof selection.start !== "number" || typeof selection.end !== "number") {
    return null;
  }
  const lo = Math.min(selection.start, selection.end);
  const hi = Math.max(selection.start, selection.end);
  const len = hi - lo;
  if (len <= 0) {
    // A bare caret: show the caret position only.
    return { kind: "caret", caret: lo };
  }
  const gc = gcPercent(seq, lo, hi);
  // Tm is meaningful only for oligo-length selections: compute the unified
  // nearest-neighbor Tm (the same model the primer tools use) for 8..50 bp, and
  // omit it otherwise (a 2 kb gene has no useful annealing Tm).
  let tm: number | undefined;
  if (len >= 8 && len <= 50) {
    const r = nearestNeighborTm(seq.slice(lo, hi));
    if (r) tm = r.tm;
  }
  // SnapGene shows 1-based inclusive coordinates (e.g. "5..10").
  return { kind: "range", lo: lo + 1, hi, len, gc, tm };
}

/** The inner content of the readout (coords / bp / GC%, or caret, or a hint).
 *  Parents wrap this with their own footer chrome. */
export function SelectionReadoutContent({ readout }: { readout: SelectionReadout | null }) {
  if (readout == null) {
    return <span className="text-gray-400">Click or select bases to see coordinates.</span>;
  }
  if (readout.kind === "caret") {
    return (
      <span>
        Caret at <span className="font-medium text-gray-800">{(readout.caret + 1).toLocaleString()}</span>
      </span>
    );
  }
  return (
    <>
      <span>
        <span className="font-medium text-gray-800">
          {readout.lo.toLocaleString()}..{readout.hi.toLocaleString()}
        </span>
      </span>
      <span>
        <span className="font-medium text-gray-800">{readout.len.toLocaleString()}</span> bp
      </span>
      <span>
        <span className="font-medium text-gray-800">{readout.gc.toFixed(0)}%</span> GC
      </span>
      {readout.tm != null ? (
        <span>
          Tm <span className="font-medium text-gray-800">{readout.tm.toFixed(1)} °C</span>
        </span>
      ) : null}
    </>
  );
}

/** A complete footer-bar readout (chrome + content), driven by a selection +
 *  the sequence string. Used by the read view; the edit view composes the
 *  derive helper + content into its own existing footer instead. */
export default function SequenceSelectionReadout({
  selection,
  seq,
  className,
}: {
  selection: Selection | null;
  seq: string;
  className?: string;
}) {
  const readout = useMemo(() => deriveSelectionReadout(selection, seq), [selection, seq]);
  return (
    <div
      className={`flex items-center gap-4 border-t border-gray-100 bg-gray-50 px-3 py-1.5 text-xs text-gray-600 ${className ?? ""}`}
    >
      <SelectionReadoutContent readout={readout} />
    </div>
  );
}
