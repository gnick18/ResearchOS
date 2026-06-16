"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Tooltip from "@/components/Tooltip";
import GridCanvas, {
  rowLabel,
  wellId,
  parseWellId,
} from "@/components/ui/GridCanvas";
import {
  ADDED_ROW_CLASSES,
  MODIFIED_BADGE_CLASSES,
  MODIFIED_CELL_CLASSES,
  MODIFIED_CHIP_TEXT,
  originalValueTooltip,
} from "@/lib/methods/diff-display";
import type {
  PlateRegionLabel,
  PlateSize,
  PlateWellAnnotation,
  PlateWellRole,
} from "@/lib/types";

/**
 * Interactive editor for a Plate Layout — the click-paint analogue to the LC
 * gradient editor / PCR interactive gradient editor.
 *
 * Single shape: the editor always operates on a per-well annotation map
 * (`wells: Record<wellId, PlateWellAnnotation>`) plus a plate size. The
 * /methods modal flattens its output into `region_labels` (1×1 rectangles) at
 * save time; the experiment-page tab content writes the same map through to
 * `TaskMethodAttachment.plate_annotation`. Region labels coming in from the
 * source are expanded to wells before the editor sees them (see
 * `regionLabelsToWells` below) so the editor doesn't need to think about two
 * representations.
 *
 * Brushes: Blank / Sample / Control / NA / Custom-labeled / Erase. Click-and-
 * drag paints multiple wells. The Sample brush exposes a tiny sample-id input
 * inline so the painted well carries that label as `sample_label`. The Custom
 * brush exposes a custom-label input, which lands as `custom_label`.
 *
 * Diff mode: when `originalWells` is supplied, wells whose role changed get
 * `MODIFIED_CELL_CLASSES`; wells annotated only in the snapshot use the
 * green-tinted `ADDED_ROW_CLASSES` style; tooltips surface the original
 * role/label via `originalValueTooltip`.
 */

export interface PlateLayoutEditorProps {
  plateSize: PlateSize;
  onPlateSizeChange?: (size: PlateSize) => void;
  wells: Record<string, PlateWellAnnotation>;
  onWellsChange?: (wells: Record<string, PlateWellAnnotation>) => void;
  description?: string | null;
  onDescriptionChange?: (description: string | null) => void;
  /** When true, all inputs render read-only (no painting, no editing). */
  readOnly?: boolean;
  /** When set, diff display compares against these source values and shows
   *  the "Modified from source" chip + per-well highlights. */
  originalWells?: Record<string, PlateWellAnnotation>;
  originalPlateSize?: PlateSize;
  originalDescription?: string | null;
  /** When true, the plate-size selector is locked (typical for task-attached
   *  mode — the source's plate size is the contract). */
  lockPlateSize?: boolean;
}

const PLATE_SIZE_OPTIONS: PlateSize[] = [12, 24, 48, 96, 384];

const ROLE_LABELS: Record<PlateWellRole, string> = {
  blank: "Blank",
  sample: "Sample",
  control: "Control",
  na: "N/A",
  custom: "Custom",
};

/** Tailwind color classes per role. Picked to read distinctly at small well
 *  sizes and to stay legible on the grid background. */
const ROLE_BG: Record<PlateWellRole, string> = {
  blank: "bg-slate-200 text-slate-700",
  sample: "bg-emerald-500 text-white",
  control: "bg-amber-400 text-amber-950",
  na: "bg-surface-sunken text-foreground-muted",
  custom: "bg-fuchsia-400 text-white",
};

/** Border ring for the role dot in the brush palette. */
const ROLE_RING: Record<PlateWellRole, string> = {
  blank: "ring-slate-300",
  sample: "ring-emerald-600",
  control: "ring-amber-500",
  na: "ring-gray-300",
  custom: "ring-fuchsia-500",
};

export function dimsForSize(size: PlateSize): { rows: number; cols: number } {
  switch (size) {
    case 12: return { rows: 3, cols: 4 };
    case 24: return { rows: 4, cols: 6 };
    case 48: return { rows: 6, cols: 8 };
    case 96: return { rows: 8, cols: 12 };
    case 384: return { rows: 16, cols: 24 };
  }
}

// The cell-id scheme (`rowLabel` / `wellId` / `parseWellId`) now lives in the
// shared `GridCanvas` primitive (design FLAG-G). Re-exported here so existing
// importers (`PlateViewer`, the method tab content, the dims test) keep their
// `@/components/PlateLayoutEditor` import path and the `A1` cell-id contract is
// unchanged.
export { rowLabel, wellId, parseWellId };

/** Expand `region_labels` into a `wells` map. Each region paints every well
 *  it covers; later regions overwrite earlier ones (matches the rendering
 *  contract). `sample_label` is not on region records, so it's always absent
 *  here — which is correct: source templates carry roles + labels, not
 *  per-well sample identifiers. */
export function regionLabelsToWells(
  regions: PlateRegionLabel[] | undefined,
): Record<string, PlateWellAnnotation> {
  const wells: Record<string, PlateWellAnnotation> = {};
  if (!regions) return wells;
  for (const r of regions) {
    for (let row = r.row_start; row <= r.row_end; row += 1) {
      for (let col = r.col_start; col <= r.col_end; col += 1) {
        const id = wellId(row, col);
        const ann: PlateWellAnnotation = { role: r.role };
        if (r.custom_label !== undefined) ann.custom_label = r.custom_label;
        if (r.notes !== undefined) ann.notes = r.notes;
        wells[id] = ann;
      }
    }
  }
  return wells;
}

/** Project a `wells` map back to `region_labels` as 1×1 rectangles. Used by
 *  the /methods create flow to persist the source template. Per-task
 *  `sample_label` is intentionally dropped — sample identifiers belong on
 *  the per-task snapshot, not the source template. */
export function wellsToRegionLabels(
  wells: Record<string, PlateWellAnnotation>,
): PlateRegionLabel[] {
  const out: PlateRegionLabel[] = [];
  for (const [id, ann] of Object.entries(wells)) {
    const parsed = parseWellId(id);
    if (!parsed) continue;
    const region: PlateRegionLabel = {
      row_start: parsed.row,
      row_end: parsed.row,
      col_start: parsed.col,
      col_end: parsed.col,
      role: ann.role,
    };
    if (ann.custom_label !== undefined) region.custom_label = ann.custom_label;
    if (ann.notes !== undefined) region.notes = ann.notes;
    out.push(region);
  }
  return out;
}

function annotationsEqual(
  a: PlateWellAnnotation | undefined,
  b: PlateWellAnnotation | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.role === b.role &&
    (a.sample_label ?? "") === (b.sample_label ?? "") &&
    (a.custom_label ?? "") === (b.custom_label ?? "") &&
    (a.replicate_index ?? null) === (b.replicate_index ?? null) &&
    (a.notes ?? "") === (b.notes ?? "")
  );
}

function wellsMapsEqual(
  a: Record<string, PlateWellAnnotation>,
  b: Record<string, PlateWellAnnotation>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!annotationsEqual(a[k], b[k])) return false;
  }
  return true;
}

function shortLabelFor(ann: PlateWellAnnotation): string {
  if (ann.role === "sample" && ann.sample_label) {
    return ann.sample_label.length > 4
      ? ann.sample_label.slice(0, 3) + "…"
      : ann.sample_label;
  }
  if (ann.role === "custom" && ann.custom_label) {
    return ann.custom_label.length > 4
      ? ann.custom_label.slice(0, 3) + "…"
      : ann.custom_label;
  }
  switch (ann.role) {
    case "blank":   return "B";
    case "sample":  return "S";
    case "control": return "C";
    case "na":      return "—";
    case "custom":  return "?";
  }
}

function tooltipFor(id: string, ann: PlateWellAnnotation | undefined): string {
  if (!ann) return id;
  const parts: string[] = [`${id} — ${ROLE_LABELS[ann.role]}`];
  if (ann.sample_label) parts.push(`Sample: ${ann.sample_label}`);
  if (ann.custom_label) parts.push(`Label: ${ann.custom_label}`);
  if (ann.replicate_index !== undefined) parts.push(`Replicate ${ann.replicate_index}`);
  if (ann.notes) parts.push(ann.notes);
  return parts.join(" · ");
}

export default function PlateLayoutEditor(props: PlateLayoutEditorProps) {
  const {
    plateSize,
    onPlateSizeChange,
    wells,
    onWellsChange,
    description,
    onDescriptionChange,
    readOnly = false,
    originalWells,
    originalPlateSize,
    originalDescription,
    lockPlateSize = false,
  } = props;

  const editable = !readOnly && !!onWellsChange;
  const diffMode = originalWells !== undefined;

  const { rows, cols } = useMemo(() => dimsForSize(plateSize), [plateSize]);

  const [brush, setBrush] = useState<PlateWellRole>("sample");
  const [sampleInput, setSampleInput] = useState("");
  const [customInput, setCustomInput] = useState("");
  const [replicateInput, setReplicateInput] = useState("");

  // Per-row sample-label quick entry: one input per row that paints the whole
  // row as role "sample" with the typed sample_label (mirrors fillRow). Earns
  // its keep on 384-well plates where labeling 16 rows by hand is tedious.
  const [rowSampleInputs, setRowSampleInputs] = useState<Record<number, string>>({});
  const [showRowLabels, setShowRowLabels] = useState(plateSize === 384);
  // 384-well (24 columns) needs a denser grid; "compact" also drops the
  // per-well letters so the wells stay legible at this size.
  const dense = cols >= 24;
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    // Auto-reveal the per-row labeler when the user switches to 384-well.
    if (plateSize === 384) setShowRowLabels(true);
  }, [plateSize]);

  const paintWell = useCallback(
    (id: string) => {
      if (!editable || !onWellsChange) return;
      const next = { ...wells };
      const ann: PlateWellAnnotation = { role: brush };
      if (brush === "sample" && sampleInput.trim()) {
        ann.sample_label = sampleInput.trim();
      }
      if (brush === "custom" && customInput.trim()) {
        ann.custom_label = customInput.trim();
      }
      if (replicateInput.trim() && /^\d+$/.test(replicateInput.trim())) {
        ann.replicate_index = Number(replicateInput.trim());
      }
      next[id] = ann;
      onWellsChange(next);
    },
    [brush, customInput, editable, onWellsChange, replicateInput, sampleInput, wells],
  );

  const eraseWell = useCallback(
    (id: string) => {
      if (!editable || !onWellsChange) return;
      if (!Object.prototype.hasOwnProperty.call(wells, id)) return;
      const next = { ...wells };
      delete next[id];
      onWellsChange(next);
    },
    [editable, onWellsChange, wells],
  );

  // GridCanvas owns the mouse-down / drag / mouse-up paint machinery and surfaces
  // each painted cell here; Shift/Alt arrive as `erase`. The paint/erase choice
  // and the per-well annotation shape stay exactly as before.
  const handleCellPaint = useCallback(
    (id: string, opts: { erase: boolean }) => {
      if (opts.erase) {
        eraseWell(id);
      } else {
        paintWell(id);
      }
    },
    [eraseWell, paintWell],
  );

  const fillRow = useCallback(
    (row: number) => {
      if (!editable) return;
      for (let col = 0; col < cols; col += 1) paintWell(wellId(row, col));
    },
    [cols, editable, paintWell],
  );
  const fillColumn = useCallback(
    (col: number) => {
      if (!editable) return;
      for (let row = 0; row < rows; row += 1) paintWell(wellId(row, col));
    },
    [editable, paintWell, rows],
  );

  // Paint an entire row as role "sample" with the given label. Sourced from
  // the row's own quick-entry input rather than the global brush, but writes
  // the same per-well annotations the brush path does (round-trips into the
  // PlateAnnotationSnapshot.wells map on save).
  const applyRowSample = useCallback(
    (row: number, label: string) => {
      if (!editable || !onWellsChange) return;
      const trimmed = label.trim();
      if (!trimmed) return;
      const next = { ...wells };
      for (let col = 0; col < cols; col += 1) {
        next[wellId(row, col)] = { role: "sample", sample_label: trimmed };
      }
      onWellsChange(next);
    },
    [cols, editable, onWellsChange, wells],
  );
  const commitRowSample = useCallback(
    (row: number) => {
      applyRowSample(row, rowSampleInputs[row] ?? "");
    },
    [applyRowSample, rowSampleInputs],
  );

  const handleClearAll = useCallback(() => {
    if (!editable || !onWellsChange) return;
    if (!confirm("Clear all well annotations?")) return;
    onWellsChange({});
  }, [editable, onWellsChange]);

  const isModified = useMemo(() => {
    if (!diffMode) return false;
    if (originalPlateSize !== undefined && originalPlateSize !== plateSize) return true;
    if (originalDescription !== undefined && (originalDescription ?? "") !== (description ?? "")) return true;
    if (!originalWells) return false;
    return !wellsMapsEqual(wells, originalWells);
  }, [diffMode, description, originalDescription, originalPlateSize, originalWells, plateSize, wells]);

  // Per-well diff classification.
  const wellDiffClass = useCallback(
    (id: string): string => {
      if (!diffMode || !originalWells) return "";
      const live = wells[id];
      const orig = originalWells[id];
      if (!live) return "";
      if (!orig) return ADDED_ROW_CLASSES;
      if (live.role !== orig.role) return MODIFIED_CELL_CLASSES;
      return "";
    },
    [diffMode, originalWells, wells],
  );

  const wellTooltipExtra = useCallback(
    (id: string): string | undefined => {
      if (!diffMode || !originalWells) return undefined;
      const live = wells[id];
      const orig = originalWells[id];
      if (!live || !orig) return undefined;
      if (live.role !== orig.role) {
        return originalValueTooltip(ROLE_LABELS[orig.role]);
      }
      if ((live.sample_label ?? "") !== (orig.sample_label ?? "") && orig.sample_label) {
        return originalValueTooltip(orig.sample_label);
      }
      return undefined;
    },
    [diffMode, originalWells, wells],
  );

  // Cell + header sizing scales down for the 16x24 (384-well) grid so it stays
  // usable; 12/24/48/96 keep their original sizing untouched. The dense grid uses
  // a sub-scale text-[8px] on purpose: the TYPE_SCALE has no tier below text-meta
  // (12px), which would overflow a 384-well cell, so this is a deliberate exception.
  const wellSizeClass = !dense
    ? "w-8 h-8 text-meta"
    : compact
      ? "w-4 h-4"
      : "w-6 h-6 text-[8px]";
  const colHeaderClass = !dense ? "w-8" : compact ? "w-4" : "w-6";
  const rowHeaderClass = !dense ? "w-6" : compact ? "w-4" : "w-6";
  const showWellLabels = !compact;

  return (
    <div className="space-y-4">
      {isModified && (
        <div>
          <span className={MODIFIED_BADGE_CLASSES}>{MODIFIED_CHIP_TEXT}</span>
        </div>
      )}

      {/* Top controls — plate size + clear */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <label className="text-meta font-medium text-foreground-muted">Plate size</label>
          {lockPlateSize || !onPlateSizeChange ? (
            <span className="text-body font-semibold text-foreground">{plateSize}-well</span>
          ) : (
            <div className="inline-flex rounded-lg border border-border overflow-hidden">
              {PLATE_SIZE_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onPlateSizeChange(s)}
                  className={`px-3 py-1.5 text-meta ${
                    s === plateSize
                      ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-medium"
                      : "bg-surface-raised text-foreground-muted hover:bg-surface-sunken"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        {editable && (
          <div className="flex items-center gap-2 flex-wrap">
            {dense && (
              <button
                type="button"
                onClick={() => setCompact((v) => !v)}
                className="ros-btn-neutral px-2 py-1 text-meta text-foreground-muted"
              >
                {compact ? "Comfortable cells" : "Compact cells"}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowRowLabels((v) => !v)}
              className={`px-2 py-1 text-meta rounded border ${
                showRowLabels
                  ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-border text-foreground-muted hover:bg-surface-sunken"
              }`}
            >
              {showRowLabels ? "Hide row sample labels" : "Per-row sample labels"}
            </button>
            <button
              onClick={handleClearAll}
              className="px-2 py-1 text-meta text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded"
            >
              Clear all wells
            </button>
          </div>
        )}
      </div>

      {/* Brush palette */}
      {editable && (
        <div className="border border-border rounded-lg p-3 bg-surface-sunken">
          <p className="text-meta font-medium text-foreground-muted mb-2">
            Pick a brush, then click (or drag) wells to paint them. Hold Shift to erase.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            {(Object.keys(ROLE_LABELS) as PlateWellRole[]).map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setBrush(role)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-meta ${
                  brush === role
                    ? `${ROLE_BG[role]} ring-2 ${ROLE_RING[role]} font-medium`
                    : "bg-surface-raised text-foreground-muted hover:bg-surface-sunken border border-border"
                }`}
              >
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${ROLE_BG[role]}`} />
                {ROLE_LABELS[role]}
              </button>
            ))}
          </div>
          {/* Inputs for sample / custom brushes */}
          <div className="mt-2 flex flex-wrap gap-3 items-center">
            {brush === "sample" && (
              <label className="flex items-center gap-1 text-meta text-foreground-muted">
                Sample identifier
                <input
                  type="text"
                  value={sampleInput}
                  onChange={(e) => setSampleInput(e.target.value)}
                  placeholder="e.g. Sample 5 @ 10 µM"
                  className="px-2 py-1 border border-border rounded text-meta focus:outline-none focus:ring-1 focus:ring-emerald-500 w-56"
                />
              </label>
            )}
            {brush === "custom" && (
              <label className="flex items-center gap-1 text-meta text-foreground-muted">
                Custom label
                <input
                  type="text"
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  placeholder="e.g. Strain ΔADE2"
                  className="px-2 py-1 border border-border rounded text-meta focus:outline-none focus:ring-1 focus:ring-fuchsia-500 w-56"
                />
              </label>
            )}
            <label className="flex items-center gap-1 text-meta text-foreground-muted">
              Replicate #
              <input
                type="text"
                value={replicateInput}
                onChange={(e) => setReplicateInput(e.target.value)}
                placeholder="optional"
                className="px-2 py-1 border border-border rounded text-meta focus:outline-none focus:ring-1 focus:ring-emerald-500 w-20"
              />
            </label>
          </div>
        </div>
      )}

      {/* Plate grid — rendered through the shared GridCanvas primitive
          (design FLAG-G). Every plate-specific concern (role colors, diff
          highlighting, the per-row sample-id inputs, the 384-well dense/compact
          sizing) is supplied as props; GridCanvas owns only the cell-id scheme,
          the headers, and the paint/click engine. */}
      <GridCanvas
        rows={rows}
        cols={cols}
        editable={editable}
        onCellPaint={handleCellPaint}
        ariaLabel="Plate grid"
        cellClassName={wellSizeClass}
        colHeaderClassName={colHeaderClass}
        rowHeaderClassName={rowHeaderClass}
        largeColHeaderText={!dense}
        onRowHeaderClick={editable ? fillRow : undefined}
        rowHeaderTooltip={(r) => `Fill row ${rowLabel(r)} with the current brush`}
        onColHeaderClick={editable ? fillColumn : undefined}
        colHeaderTooltip={(c) => `Fill column ${c + 1}`}
        extraHeader={
          editable && showRowLabels ? (
            <span className="text-meta font-medium text-foreground-muted pl-1">
              Row sample id
            </span>
          ) : undefined
        }
        rowExtra={
          editable && showRowLabels
            ? (r) => (
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={rowSampleInputs[r] ?? ""}
                    onChange={(e) =>
                      setRowSampleInputs((prev) => ({ ...prev, [r]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitRowSample(r);
                      }
                    }}
                    placeholder={`Row ${rowLabel(r)}`}
                    aria-label={`Sample id for row ${rowLabel(r)}`}
                    className="w-28 px-1.5 py-0.5 border border-border rounded text-meta focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <Tooltip label={`Label all of row ${rowLabel(r)} as this sample`} placement="right">
                    <button
                      type="button"
                      onClick={() => commitRowSample(r)}
                      className="p-1 text-foreground-muted hover:text-emerald-600 dark:hover:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded"
                      aria-label={`Apply sample to row ${rowLabel(r)}`}
                    >
                      <svg
                        viewBox="0 0 16 16"
                        width="12"
                        height="12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M3 8.5l3.5 3.5L13 5" />
                      </svg>
                    </button>
                  </Tooltip>
                </div>
              )
            : undefined
        }
        cell={(id) => {
          const ann = wells[id];
          const diffClass = wellDiffClass(id);
          const extra = wellTooltipExtra(id);
          const baseClasses = ann
            ? `${ROLE_BG[ann.role]} font-medium`
            : "bg-surface-raised text-foreground-muted";
          const ttip = (extra ? `${extra} — ` : "") + tooltipFor(id, ann);
          return {
            className: `${baseClasses} ${diffClass}`,
            label: showWellLabels && ann ? shortLabelFor(ann) : "",
            title: ttip,
            ariaLabel: `Well ${id}`,
          };
        }}
      />

      {/* Annotation list — flat summary for assistive tech + at-a-glance read */}
      <PlateAnnotationSummary wells={wells} originalWells={originalWells} />

      {/* Description */}
      {(onDescriptionChange || (description && description.trim())) && (
        <div>
          <h4 className="text-meta font-semibold text-foreground-muted mb-2 uppercase tracking-wide">
            Description
          </h4>
          {editable && onDescriptionChange ? (
            <textarea
              value={description ?? ""}
              onChange={(e) => onDescriptionChange(e.target.value || null)}
              rows={2}
              placeholder="Optional notes about the plate (assay type, expected readout, references)…"
              className={`w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                originalDescription !== undefined && (description ?? "") !== (originalDescription ?? "")
                  ? MODIFIED_CELL_CLASSES
                  : ""
              }`}
            />
          ) : (
            <p className="text-body text-foreground-muted whitespace-pre-wrap">{description}</p>
          )}
        </div>
      )}
    </div>
  );
}

function PlateAnnotationSummary({
  wells,
  originalWells,
}: {
  wells: Record<string, PlateWellAnnotation>;
  originalWells?: Record<string, PlateWellAnnotation>;
}) {
  const counts = useMemo(() => {
    const c: Record<PlateWellRole, number> = {
      blank: 0,
      sample: 0,
      control: 0,
      na: 0,
      custom: 0,
    };
    for (const ann of Object.values(wells)) c[ann.role] += 1;
    return c;
  }, [wells]);
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  if (total === 0 && !originalWells) {
    return (
      <p className="text-meta text-foreground-muted">
        No wells annotated yet. Pick a brush above and click any well to start.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-3 text-meta text-foreground-muted">
      {(Object.keys(ROLE_LABELS) as PlateWellRole[]).map((role) => (
        <span key={role} className="inline-flex items-center gap-1">
          <span className={`inline-block w-2.5 h-2.5 rounded-full ${ROLE_BG[role]}`} />
          {ROLE_LABELS[role]}: <span className="font-medium text-foreground">{counts[role]}</span>
        </span>
      ))}
      <span className="text-foreground-muted">Total annotated: {total}</span>
    </div>
  );
}
