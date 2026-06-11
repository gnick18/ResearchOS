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
  | { kind: "range"; lo: number; hi: number; len: number; gc: number; tm?: number; featureName?: string };

/**
 * overview featclick bot — the SELECTED FEATURE this selection corresponds to,
 * if any. When the live selection range exactly equals a selected feature's
 * [start, end] (0-based half-open, the shape `externalSel` / the feature carry),
 * the readout PREFIXES the feature NAME (SnapGene style, e.g. "FUN_007645
 * (31,971 .. 32,687 = 717 bp)"). A plain range selection passes none and reads
 * coords-only exactly as before.
 */
export interface SelectedFeatureContext {
  name: string;
  start: number;
  end: number;
}

/** Derive the readout values from a SeqViz selection over a sequence string.
 *  Returns null when there is no usable selection. */
export function deriveSelectionReadout(
  selection: Selection | null,
  seq: string,
  selectedFeature?: SelectedFeatureContext | null,
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
  // overview featclick bot — only attach the feature NAME when the selection
  // range matches that feature's own span (so a later free-hand drag inside the
  // feature reads as a plain range, not the feature). Compared in the raw 0-based
  // half-open space the feature + selection share, before the 1-based display
  // conversion below.
  let featureName: string | undefined;
  if (
    selectedFeature &&
    typeof selectedFeature.name === "string" &&
    selectedFeature.name.trim() &&
    Math.min(selectedFeature.start, selectedFeature.end) === lo &&
    Math.max(selectedFeature.start, selectedFeature.end) === hi
  ) {
    featureName = selectedFeature.name;
  }
  // SnapGene shows 1-based inclusive coordinates (e.g. "5..10").
  return { kind: "range", lo: lo + 1, hi, len, gc, tm, featureName };
}

/** Tm-chip color on a cool-to-hot gradient so the drag badge reads temperature
 *  at a glance: a low / weak Tm trends blue, a high / strong Tm trends red, and
 *  the primer-ideal middle lands on violet (so it matches the old flat chip near
 *  60 C). Light fill plus a darker same-hue text keeps the contrast readable.
 *  RGB lerp from blue (#2563eb) to red (#dc2626); the midpoint is violet. */
function tmChipColors(tm: number): { backgroundColor: string; color: string } {
  const TMIN = 48;
  const TMAX = 72;
  const t = Math.max(0, Math.min(1, (tm - TMIN) / (TMAX - TMIN)));
  const r = Math.round(37 + (220 - 37) * t);
  const g = Math.round(99 + (38 - 99) * t);
  const b = Math.round(235 + (38 - 235) * t);
  return {
    backgroundColor: `rgba(${r}, ${g}, ${b}, 0.16)`,
    color: `rgb(${Math.round(r * 0.62)}, ${Math.round(g * 0.62)}, ${Math.round(b * 0.62)})`,
  };
}

/** The inner content of the readout (coords / bp / GC%, or caret, or a hint).
 *  Parents wrap this with their own footer chrome. The Tm always renders as the
 *  temperature-gradient chip (blue -> violet -> red via `tmChipColors`), so the
 *  drag-time floating badge and the bottom strip share one unified presentation,
 *  not just one derive path. */
export function SelectionReadoutContent({
  readout,
}: {
  readout: SelectionReadout | null;
}) {
  if (readout == null) {
    return (
      <span className="text-gray-400 dark:text-foreground-muted">
        Click or select bases to see coordinates.
      </span>
    );
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
      {readout.featureName ? (
        <span className="font-semibold text-gray-900">{readout.featureName}</span>
      ) : null}
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
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 font-medium"
          style={tmChipColors(readout.tm)}
        >
          Tm {readout.tm.toFixed(1)} °C
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
      role="status"
      aria-live="polite"
      className={`flex items-center gap-4 border-t border-gray-100 bg-gray-50 px-3 py-1.5 text-meta text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-foreground-muted ${className ?? ""}`}
    >
      <SelectionReadoutContent readout={readout} />
    </div>
  );
}
