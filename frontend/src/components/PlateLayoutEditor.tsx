"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Tooltip from "@/components/Tooltip";
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

const PLATE_SIZE_OPTIONS: PlateSize[] = [12, 24, 48, 96];

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
  na: "bg-gray-100 text-gray-400",
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
  }
}

export function rowLabel(row: number): string {
  return String.fromCharCode(65 + row);
}

export function wellId(row: number, col: number): string {
  return `${rowLabel(row)}${col + 1}`;
}

export function parseWellId(id: string): { row: number; col: number } | null {
  const m = id.match(/^([A-H])(\d+)$/);
  if (!m) return null;
  return { row: m[1].charCodeAt(0) - 65, col: Number(m[2]) - 1 };
}

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
  const paintingRef = useRef(false);

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

  const handleWellMouseDown = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (!editable) return;
      paintingRef.current = true;
      if (e.shiftKey || e.altKey) {
        eraseWell(id);
      } else {
        paintWell(id);
      }
    },
    [eraseWell, editable, paintWell],
  );

  const handleWellMouseEnter = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (!paintingRef.current || !editable) return;
      if (e.shiftKey || e.altKey) {
        eraseWell(id);
      } else {
        paintWell(id);
      }
    },
    [eraseWell, editable, paintWell],
  );

  const stopPainting = useCallback(() => {
    paintingRef.current = false;
  }, []);

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

  return (
    <div className="space-y-4" onMouseUp={stopPainting} onMouseLeave={stopPainting}>
      {isModified && (
        <div>
          <span className={MODIFIED_BADGE_CLASSES}>{MODIFIED_CHIP_TEXT}</span>
        </div>
      )}

      {/* Top controls — plate size + clear */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-gray-500">Plate size</label>
          {lockPlateSize || !onPlateSizeChange ? (
            <span className="text-sm font-semibold text-gray-700">{plateSize}-well</span>
          ) : (
            <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
              {PLATE_SIZE_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onPlateSizeChange(s)}
                  className={`px-3 py-1.5 text-xs ${
                    s === plateSize
                      ? "bg-emerald-100 text-emerald-700 font-medium"
                      : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        {editable && (
          <button
            onClick={handleClearAll}
            className="px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded"
          >
            Clear all wells
          </button>
        )}
      </div>

      {/* Brush palette */}
      {editable && (
        <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
          <p className="text-xs font-medium text-gray-500 mb-2">
            Pick a brush, then click (or drag) wells to paint them. Hold Shift to erase.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            {(Object.keys(ROLE_LABELS) as PlateWellRole[]).map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setBrush(role)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs ${
                  brush === role
                    ? `${ROLE_BG[role]} ring-2 ${ROLE_RING[role]} font-medium`
                    : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
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
              <label className="flex items-center gap-1 text-xs text-gray-600">
                Sample identifier
                <input
                  type="text"
                  value={sampleInput}
                  onChange={(e) => setSampleInput(e.target.value)}
                  placeholder="e.g. Sample 5 @ 10 µM"
                  className="px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 w-56"
                />
              </label>
            )}
            {brush === "custom" && (
              <label className="flex items-center gap-1 text-xs text-gray-600">
                Custom label
                <input
                  type="text"
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  placeholder="e.g. Strain ΔADE2"
                  className="px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-fuchsia-500 w-56"
                />
              </label>
            )}
            <label className="flex items-center gap-1 text-xs text-gray-600">
              Replicate #
              <input
                type="text"
                value={replicateInput}
                onChange={(e) => setReplicateInput(e.target.value)}
                placeholder="optional"
                className="px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 w-20"
              />
            </label>
          </div>
        </div>
      )}

      {/* Plate grid */}
      <div className="border border-gray-200 rounded-lg p-3 bg-white overflow-x-auto">
        <table className="border-collapse select-none" aria-label="Plate grid">
          <thead>
            <tr>
              <th className="p-0.5 w-7"></th>
              {Array.from({ length: cols }).map((_, c) => (
                <th key={c} className="p-0.5 text-center">
                  {editable ? (
                    <Tooltip label={`Fill column ${c + 1}`} placement="top">
                      <button
                        onClick={() => fillColumn(c)}
                        className="w-8 text-[10px] font-medium text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 rounded px-0.5 py-0.5"
                      >
                        {c + 1}
                      </button>
                    </Tooltip>
                  ) : (
                    <span className="text-[10px] font-medium text-gray-500">{c + 1}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, r) => (
              <tr key={r}>
                <th className="p-0.5 align-middle">
                  {editable ? (
                    <Tooltip label={`Fill row ${rowLabel(r)}`} placement="right">
                      <button
                        onClick={() => fillRow(r)}
                        className="w-6 text-[10px] font-medium text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 rounded px-0.5 py-0.5"
                      >
                        {rowLabel(r)}
                      </button>
                    </Tooltip>
                  ) : (
                    <span className="text-[10px] font-medium text-gray-500">{rowLabel(r)}</span>
                  )}
                </th>
                {Array.from({ length: cols }).map((_, c) => {
                  const id = wellId(r, c);
                  const ann = wells[id];
                  const diffClass = wellDiffClass(id);
                  const extra = wellTooltipExtra(id);
                  const baseClasses = ann
                    ? `${ROLE_BG[ann.role]} font-medium`
                    : "bg-white text-gray-300";
                  const ttip = (extra ? `${extra} — ` : "") + tooltipFor(id, ann);
                  return (
                    <td key={c} className="p-0.5">
                      <button
                        type="button"
                        disabled={!editable}
                        onMouseDown={(e) => handleWellMouseDown(id, e)}
                        onMouseEnter={(e) => handleWellMouseEnter(id, e)}
                        title={ttip}
                        className={`w-8 h-8 rounded-full border border-gray-200 ${baseClasses} ${diffClass} text-[10px] flex items-center justify-center ${
                          editable ? "cursor-pointer hover:ring-2 hover:ring-emerald-300" : "cursor-default"
                        }`}
                        aria-label={`Well ${id}`}
                      >
                        {ann ? shortLabelFor(ann) : ""}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Annotation list — flat summary for assistive tech + at-a-glance read */}
      <PlateAnnotationSummary wells={wells} originalWells={originalWells} />

      {/* Description */}
      {(onDescriptionChange || (description && description.trim())) && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
            Description
          </h4>
          {editable && onDescriptionChange ? (
            <textarea
              value={description ?? ""}
              onChange={(e) => onDescriptionChange(e.target.value || null)}
              rows={2}
              placeholder="Optional notes about the plate (assay type, expected readout, references)…"
              className={`w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                originalDescription !== undefined && (description ?? "") !== (originalDescription ?? "")
                  ? MODIFIED_CELL_CLASSES
                  : ""
              }`}
            />
          ) : (
            <p className="text-sm text-gray-600 whitespace-pre-wrap">{description}</p>
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
      <p className="text-xs text-gray-400">
        No wells annotated yet. Pick a brush above and click any well to start.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-3 text-xs text-gray-600">
      {(Object.keys(ROLE_LABELS) as PlateWellRole[]).map((role) => (
        <span key={role} className="inline-flex items-center gap-1">
          <span className={`inline-block w-2.5 h-2.5 rounded-full ${ROLE_BG[role]}`} />
          {ROLE_LABELS[role]}: <span className="font-medium text-gray-700">{counts[role]}</span>
        </span>
      ))}
      <span className="text-gray-400">Total annotated: {total}</span>
    </div>
  );
}
