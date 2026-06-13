// Phylo Tree Studio, per-column color scales (phylo Phase 0, publication-grade).
//
// The renderer used to color every track from one categorical palette and the
// heatmap as binary on / off. This module is the seam that lets a BOUND metadata
// column drive a real scale: a numeric column becomes a CONTINUOUS sequential
// gradient (a Data Hub sequential palette sampled by the value's position in its
// range) and a non-numeric column stays a CATEGORICAL set of distinct hues. The
// renderer asks this module for "the color for this column's value on this tip"
// and "the legend for this column", so the strip, points, bars, and heatmap all
// agree, and the legend matches exactly what the cells drew.
//
// Why reuse Data Hub palettes (lib/datahub/palettes.ts): researchers already
// pick Viridis / Blues / Greens there, the ramps are color-blind + print safe,
// and samplePalette already does even-spacing along a ramp. We do NOT reinvent
// color here, we classify the column and sample the shared engine.
//
// Pure data, browser-safe, no DOM, no React. render.ts consumes the scales it
// returns and emits the SVG.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { leaves, type TreeNode } from "./parse";
import {
  paletteById,
  samplePalette,
  type Palette,
} from "@/lib/datahub/palettes";
import { CATEGORY_PALETTE } from "./render-palette";

/** How a bound column reads, decided from its matched values. */
export type ColumnKind = "numeric" | "categorical";

/** A resolved scale for one column, the renderer's single source for its color. */
export interface ColorScale {
  column: string;
  kind: ColumnKind;
  /** Numeric domain, present only for a continuous scale. */
  domain?: { min: number; max: number };
  /** The sequential palette id sampled for a continuous scale. */
  paletteId?: string;
  /** Map a tip's raw cell value to a fill, "" / unmatched -> the empty fill. */
  colorFor(raw: string | undefined): string;
  /** Distinct ordered categories, present only for a categorical scale. */
  categories?: string[];
  /** Stable value -> color for a categorical scale (legend + cells agree). */
  categoryColors?: Record<string, string>;
}

/** The fill used for a tip with no value for the column (empty join cell). */
export const EMPTY_FILL = "#f1f5f9";

/** The default sequential ramp for numeric columns (color-blind + print safe). */
export const DEFAULT_CONTINUOUS_PALETTE_ID = "viridis";

/**
 * A value is numeric when it parses to a finite number after trimming. A blank
 * cell is NOT counted (a missing value should not force a column categorical).
 */
function isNumericCell(raw: string): boolean {
  const v = raw.trim();
  if (v === "") return false;
  return Number.isFinite(Number(v));
}

/**
 * Classify a column from the values it actually carries across the matched tips.
 * A column is numeric when it has at least one non-blank value and EVERY non-blank
 * value parses to a finite number, else categorical. The all-or-nothing rule keeps
 * a column like "0/1/resistant" categorical rather than half-gradient.
 */
export function classifyColumn(
  root: TreeNode,
  metadata: Map<number, Record<string, string>> | undefined,
  column: string | undefined,
): ColumnKind {
  if (!metadata || !column) return "categorical";
  let sawValue = false;
  for (const tip of leaves(root)) {
    const raw = metadata.get(tip.id)?.[column];
    if (raw === undefined || raw.trim() === "") continue;
    sawValue = true;
    if (!isNumericCell(raw)) return "categorical";
  }
  return sawValue ? "numeric" : "categorical";
}

/** The numeric [min, max] of a column across matched tips (blanks skipped). */
function numericDomain(
  root: TreeNode,
  metadata: Map<number, Record<string, string>>,
  column: string,
): { min: number; max: number } {
  const vals: number[] = [];
  for (const tip of leaves(root)) {
    const raw = metadata.get(tip.id)?.[column];
    if (raw === undefined || raw.trim() === "") continue;
    const n = Number(raw);
    if (Number.isFinite(n)) vals.push(n);
  }
  if (vals.length === 0) return { min: 0, max: 1 };
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

/** Distinct categorical values of a column across matched tips, in first-seen order. */
function distinctValues(
  root: TreeNode,
  metadata: Map<number, Record<string, string>>,
  column: string,
): string[] {
  const seen: string[] = [];
  for (const tip of leaves(root)) {
    const raw = metadata.get(tip.id)?.[column];
    if (raw && !seen.includes(raw)) seen.push(raw);
  }
  return seen;
}

/** How many gradient stops a continuous scale interpolates across. */
const GRADIENT_STOPS = 32;

/**
 * Interpolate a continuous color at t in [0, 1] along a sampled ramp. The ramp is
 * sampled to a dense GRADIENT_STOPS stops once, then the position picks the
 * nearest stop, so a value maps to a smooth-looking color without a per-call
 * palette resample. Out-of-range t is clamped.
 */
function rampColor(ramp: string[], t: number): string {
  if (ramp.length === 0) return "#000000";
  const clamped = Math.max(0, Math.min(1, t));
  const idx = Math.round(clamped * (ramp.length - 1));
  return ramp[idx] ?? ramp[ramp.length - 1];
}

/**
 * Build the color scale for a bound column. A numeric column resolves to a
 * continuous sequential gradient (the given palette id, default Viridis), a
 * non-numeric column to the categorical palette as before. The returned scale is
 * what every colored track + the legend read, so cells and legend never diverge.
 *
 * `categoryColors` lets a caller pin colors for specific values (so the primary
 * category column stays byte-identical to the existing buildCategoryColors path).
 * It is an OVERLAY, not a replacement, so a column the pinned map does not cover
 * still gets distinct palette colors for every value in both the cells and legend.
 */
export function buildColorScale(
  root: TreeNode,
  metadata: Map<number, Record<string, string>> | undefined,
  column: string,
  options?: {
    paletteId?: string;
    extraPalettes?: Palette[];
    categoryColors?: Record<string, string>;
  },
): ColorScale {
  const kind = classifyColumn(root, metadata, column);

  if (metadata && kind === "numeric") {
    const domain = numericDomain(root, metadata, column);
    const paletteId = options?.paletteId ?? DEFAULT_CONTINUOUS_PALETTE_ID;
    const palette = paletteById(paletteId, options?.extraPalettes);
    const ramp = samplePalette(palette, GRADIENT_STOPS);
    const span = domain.max - domain.min;
    return {
      column,
      kind: "numeric",
      domain,
      paletteId: palette.id,
      colorFor(raw) {
        if (raw === undefined || raw.trim() === "") return EMPTY_FILL;
        const n = Number(raw);
        if (!Number.isFinite(n)) return EMPTY_FILL;
        const t = span > 0 ? (n - domain.min) / span : 0.5;
        return rampColor(ramp, t);
      },
    };
  }

  // Categorical. Always build a full palette over THIS column's distinct values,
  // then overlay any pinned categoryColors on top (pinned wins for the keys it
  // has). A pinned map built for a different column (e.g. CLADE) must never
  // replace the full map, or a rebound column (e.g. COUNTRY) misses every value
  // and falls back to EMPTY_FILL (blank legend + monochrome ring).
  const categories = metadata
    ? distinctValues(root, metadata, column)
    : [];
  const categoryColors = {
    ...buildCategoricalColors(categories),
    ...(options?.categoryColors ?? {}),
  };
  return {
    column,
    kind: "categorical",
    categories,
    categoryColors,
    colorFor(raw) {
      if (raw === undefined || raw.trim() === "") return EMPTY_FILL;
      return categoryColors[raw] ?? EMPTY_FILL;
    },
  };
}

/** Assign the brand categorical palette to an ordered list of distinct values. */
export function buildCategoricalColors(
  categories: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  categories.forEach(
    (v, i) => (out[v] = CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]),
  );
  return out;
}
