// figure/artboard.ts
//
// Shared "plot artboard / publication page frame" core, used by EVERY figure
// surface (Data Hub plots, Tree Studio, any future plot editor). The artboard is
// an optional page frame behind a figure: you pick a real paper or journal-column
// size, the figure sits inside it at true scale, and because the figure is sized
// in REAL INCHES the exported SVG carries those physical dimensions, so what you
// see drops into the manuscript with no rescaling guesswork.
//
// This module is PURE (no DOM, no React) so it is fully unit-testable. It owns the
// genuinely new pieces: paper presets, page geometry, page-vs-figure scaling, the
// room/fit/overflow feedback, ruler ticks, and an SVG export wrapper that carries
// true inch dimensions. It does NOT redefine unit math or the SVG root-size
// rewrite: those are imported from the validated plot-spec engine so there is one
// source of truth and the validated render path is never forked.
//
// No em-dashes, no emojis, no mid-sentence colons.

import {
  toInches,
  toDesignPx,
  fromDesignPx,
  convertUnit,
  withRootSize,
} from "@/lib/datahub/plot-spec";

// Re-export the unit primitives so a consumer can pull everything artboard from
// one place without reaching into plot-spec directly.
export { toInches, toDesignPx, fromDesignPx, convertUnit };

export type Orientation = "portrait" | "landscape";
export type RulerUnit = "in" | "cm";

/** A paper / journal-column preset. Dimensions are PORTRAIT inches (W x H). */
export interface PaperPreset {
  id: string;
  label: string;
  wIn: number;
  hIn: number;
  kind: "paper" | "journal" | "slide" | "square";
}

/**
 * The per-figure artboard configuration. Stored additively on the figure spec
 * (an absent value means disabled, so an old figure renders exactly as before).
 * The figure's own size (width / height / unit / dpi) stays on the consumer's
 * existing style; the artboard never duplicates it.
 */
export interface ArtboardState {
  /** Off by default: the page frame only shows when the user wants publication context. */
  enabled: boolean;
  /** A preset id, or "custom" to use customWIn / customHIn. */
  paperId: string;
  orientation: Orientation;
  customWIn?: number;
  customHIn?: number;
  rulers: boolean;
  rulerUnit: RulerUnit;
}

export const CUSTOM_PAPER_ID = "custom";

// Exact values from the locked mockup (docs/mockups/2026-06-13-plot-artboard-page-frame.html).
export const PAPER_PRESETS: PaperPreset[] = [
  { id: "letter", label: "Letter (8.5 x 11 in)", wIn: 8.5, hIn: 11, kind: "paper" },
  { id: "a4", label: "A4 (8.27 x 11.69 in)", wIn: 8.27, hIn: 11.69, kind: "paper" },
  { id: "legal", label: "Legal (8.5 x 14 in)", wIn: 8.5, hIn: 14, kind: "paper" },
  {
    id: "journal-1col",
    label: "Journal single column (3.5 in wide)",
    wIn: 3.5,
    hIn: 9,
    kind: "journal",
  },
  {
    id: "journal-2col",
    label: "Journal double column (7.2 in wide)",
    wIn: 7.2,
    hIn: 9,
    kind: "journal",
  },
  {
    id: "slide-169",
    label: "Slide 16:9 (13.3 x 7.5 in)",
    wIn: 13.3,
    hIn: 7.5,
    kind: "slide",
  },
  { id: "square", label: "Square (6 x 6 in)", wIn: 6, hIn: 6, kind: "square" },
];

export const DEFAULT_ARTBOARD_STATE: ArtboardState = {
  enabled: false,
  paperId: "letter",
  orientation: "portrait",
  rulers: true,
  rulerUnit: "in",
};

/** Look up a preset by id (undefined for "custom" or an unknown id). */
export function getPreset(id: string): PaperPreset | undefined {
  return PAPER_PRESETS.find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
// Cross-figure DEFAULT preferences (paper / orientation / ruler unit), so a NEW
// figure starts on the paper the user last reached for. The per-figure spec stays
// the source of truth once a figure has its own stored artboard; these prefs only
// seed a fresh one. Stored in localStorage, guarded for SSR / no-storage.
// ---------------------------------------------------------------------------

const PREFS_KEY = "figure-artboard-prefs-v1";

export interface ArtboardPrefs {
  paperId?: string;
  orientation?: Orientation;
  rulerUnit?: RulerUnit;
}

/** Read the saved default paper / orientation / ruler-unit prefs (empty if none). */
export function loadArtboardPrefs(): ArtboardPrefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Record<string, unknown>;
    const out: ArtboardPrefs = {};
    if (typeof p.paperId === "string") out.paperId = p.paperId;
    if (p.orientation === "portrait" || p.orientation === "landscape") {
      out.orientation = p.orientation;
    }
    if (p.rulerUnit === "in" || p.rulerUnit === "cm") out.rulerUnit = p.rulerUnit;
    return out;
  } catch {
    return {};
  }
}

/** Remember the paper / orientation / ruler-unit of the current artboard. */
export function saveArtboardPrefs(state: ArtboardState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        paperId: state.paperId,
        orientation: state.orientation,
        rulerUnit: state.rulerUnit,
      }),
    );
  } catch {
    // ignore a storage write failure (private mode, quota); prefs are best-effort.
  }
}

/**
 * The initial artboard state for a figure: its OWN stored value when present
 * (authoritative), otherwise the disabled default seeded with the user's last-used
 * paper / orientation / ruler-unit prefs so a fresh figure feels familiar.
 */
export function artboardInitial(stored: unknown): ArtboardState {
  if (stored && typeof stored === "object") return readArtboardState(stored);
  return { ...DEFAULT_ARTBOARD_STATE, ...loadArtboardPrefs() };
}

/**
 * Read an unknown stored value into a valid ArtboardState, filling defaults for
 * any missing / malformed field. A spec written before this feature returns the
 * default (disabled) state, so it renders unchanged.
 */
export function readArtboardState(raw: unknown): ArtboardState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_ARTBOARD_STATE };
  const r = raw as Record<string, unknown>;
  const orientation: Orientation =
    r.orientation === "landscape" ? "landscape" : "portrait";
  const rulerUnit: RulerUnit = r.rulerUnit === "cm" ? "cm" : "in";
  const paperId =
    typeof r.paperId === "string" && r.paperId ? r.paperId : DEFAULT_ARTBOARD_STATE.paperId;
  const out: ArtboardState = {
    enabled: r.enabled === true,
    paperId,
    orientation,
    rulers: r.rulers !== false,
    rulerUnit,
  };
  if (typeof r.customWIn === "number" && r.customWIn > 0) out.customWIn = r.customWIn;
  if (typeof r.customHIn === "number" && r.customHIn > 0) out.customHIn = r.customHIn;
  return out;
}

/** The resolved page size in inches (after the orientation flip + custom). */
export interface PageDims {
  wIn: number;
  hIn: number;
}

/** Fallback page used when a custom size has no valid dimensions yet. */
const FALLBACK_PAGE: PageDims = { wIn: 8.5, hIn: 11 };

/**
 * Resolve the page size in inches from the state, applying the orientation flip.
 * Portrait keeps the preset W x H; landscape swaps to the wider-than-tall form.
 */
export function pageDims(state: ArtboardState): PageDims {
  let wIn: number;
  let hIn: number;
  if (state.paperId === CUSTOM_PAPER_ID) {
    wIn = state.customWIn && state.customWIn > 0 ? state.customWIn : FALLBACK_PAGE.wIn;
    hIn = state.customHIn && state.customHIn > 0 ? state.customHIn : FALLBACK_PAGE.hIn;
  } else {
    const p = getPreset(state.paperId) ?? PAPER_PRESETS[0];
    wIn = p.wIn;
    hIn = p.hIn;
  }
  if (state.orientation === "landscape") {
    return { wIn: Math.max(wIn, hIn), hIn: Math.min(wIn, hIn) };
  }
  return { wIn, hIn };
}

/**
 * The scale (stage px per inch) that fits a page into a square stage of
 * maxStagePx on its longest edge. Display only: the export path never uses it.
 */
export function pageScale(page: PageDims, maxStagePx: number): number {
  const longest = Math.max(page.wIn, page.hIn);
  if (longest <= 0) return 0;
  return maxStagePx / longest;
}

/** A figure centered within the page, geometry in inches. */
export interface FigurePlacement {
  figWIn: number;
  figHIn: number;
  /** Centered offset of the figure within the page, in inches. */
  leftIn: number;
  topIn: number;
}

/** Center a figure of the given inch size within the page (offsets clamped at 0). */
export function placeFigureCentered(
  page: PageDims,
  figWIn: number,
  figHIn: number,
): FigurePlacement {
  return {
    figWIn,
    figHIn,
    leftIn: Math.max(0, (page.wIn - figWIn) / 2),
    topIn: Math.max(0, (page.hIn - figHIn) / 2),
  };
}

const CM_PER_INCH = 2.54;

/** Inches to centimeters (for the cm ruler). */
export function inToCm(inches: number): number {
  return inches * CM_PER_INCH;
}

/** Centimeters to inches. */
export function cmToIn(cm: number): number {
  return cm / CM_PER_INCH;
}

/**
 * The raster-equivalent pixel count for a physical length at a DPI. Drives the
 * export readout ("3.5 x 2.5 in @ 300 DPI = 1050 x 750 px"). The SVG itself stays
 * vector, so DPI never rescales it, only the informational px figure.
 */
export function pxAtDpi(inches: number, dpi: number): number {
  return Math.round(inches * dpi);
}

export type FitVerdict = "room" | "good" | "overflow";

export interface FitFeedback {
  verdict: FitVerdict;
  message: string;
  /** Figure width as a fraction of page width (0..1+), for the controls readout. */
  widthFrac: number;
}

/**
 * The live room / good-fit / overflow hint. Overflow wins if EITHER dimension
 * exceeds the page (the mockup only checked width; a tall figure on a short page
 * overflows too). Otherwise a figure under ~55% of the page width reads as having
 * room, and the rest read as a good fit.
 */
export function fitFeedback(
  page: PageDims,
  figWIn: number,
  figHIn: number,
): FitFeedback {
  const widthFrac = page.wIn > 0 ? figWIn / page.wIn : 0;
  if (figWIn > page.wIn || figHIn > page.hIn) {
    return {
      verdict: "overflow",
      message: "Overflows the page, scale the figure down.",
      widthFrac,
    };
  }
  if (widthFrac < 0.55) {
    return {
      verdict: "room",
      message: "Lots of room, you could make it bigger.",
      widthFrac,
    };
  }
  return { verdict: "good", message: "Good fit for this page.", widthFrac };
}

/**
 * The largest centered figure that keeps the figure aspect ratio and leaves a
 * small margin on every edge. Used by the "Fit figure to page" button. aspect is
 * figureWidth / figureHeight.
 */
export function fitFigureToPage(
  page: PageDims,
  aspect: number,
  marginIn = 0.5,
): { figWIn: number; figHIn: number } {
  const availW = Math.max(0, page.wIn - 2 * marginIn);
  const availH = Math.max(0, page.hIn - 2 * marginIn);
  if (aspect <= 0 || availW <= 0 || availH <= 0) {
    return { figWIn: availW, figHIn: availH };
  }
  // Width-constrained first; if that overflows the available height, height-cap.
  let figWIn = availW;
  let figHIn = figWIn / aspect;
  if (figHIn > availH) {
    figHIn = availH;
    figWIn = figHIn * aspect;
  }
  return { figWIn, figHIn };
}

export interface RulerTick {
  /** Distance from the page origin along this edge, in inches (for px scaling). */
  posIn: number;
  /** The integer label at this tick, in the ruler's unit. */
  label: string;
  major: boolean;
}

/**
 * Whole-unit ruler ticks along an edge of the given inch length. For inches the
 * ticks land on each inch; for cm they land on each centimeter (converted back to
 * an inch position so the caller scales them with the same px-per-inch factor).
 */
export function rulerTicks(lengthIn: number, unit: RulerUnit): RulerTick[] {
  const out: RulerTick[] = [];
  if (lengthIn <= 0) return out;
  if (unit === "cm") {
    const totalCm = Math.floor(inToCm(lengthIn));
    for (let c = 0; c <= totalCm; c++) {
      out.push({ posIn: cmToIn(c), label: String(c), major: c % 5 === 0 });
    }
    return out;
  }
  const totalIn = Math.floor(lengthIn);
  for (let i = 0; i <= totalIn; i++) {
    out.push({ posIn: i, label: String(i), major: true });
  }
  return out;
}

/** Round an inch value to a tidy number for an SVG attribute. */
function n(v: number): string {
  return String(Number(v.toFixed(4)));
}

export type ArtboardExportMode = "figure" | "page";

export interface ArtboardExportArgs {
  /** The consumer's self-contained figure SVG (the same string it renders today). */
  figureSvg: string;
  figWIn: number;
  figHIn: number;
  /** "figure" exports just the figure at true inches. "page" exports the full sheet. */
  mode: ArtboardExportMode;
  /** Required for page mode: the page size in inches. */
  page?: PageDims;
  /** Required for page mode: where the figure sits in the page. */
  placement?: FigurePlacement;
  /** Page mode only: draw the white sheet behind the figure (default true). */
  includeSheet?: boolean;
}

/**
 * Set x / y on the root <svg> (for nesting) without disturbing its viewBox. The
 * root element is the first <svg token (the renderers write it first), matching
 * the contract withRootSize relies on.
 */
function setRootPosition(svg: string, xIn: number, yIn: number): string {
  return svg.replace(/<svg\b/, `<svg x="${n(xIn)}" y="${n(yIn)}"`);
}

/**
 * Produce export-ready SVG markup that carries TRUE physical inch dimensions.
 *
 * figure mode: the figure alone, root sized to figWIn x figHIn inches, viewBox
 * untouched (delegates to the proven withRootSize rewrite). This is the
 * publication-exact figure that drops into a manuscript.
 *
 * page mode: the whole page sheet at pageWIn x pageHIn inches, with the figure
 * nested at its centered placement. The outer SVG uses inch user units (viewBox =
 * page inches), an optional white sheet rect sits behind, and the figure is nested
 * as an inner <svg> whose root width / height become the placement box (in inch
 * user units) and whose own viewBox scales the figure into that box. Vector
 * throughout, so the result is exact at any zoom.
 */
export function artboardExportSvg(args: ArtboardExportArgs): string {
  const { figureSvg, figWIn, figHIn } = args;
  if (args.mode === "figure" || !args.page || !args.placement) {
    return withRootSize(figureSvg, `${n(figWIn)}in`, `${n(figHIn)}in`);
  }
  const page = args.page;
  const place = args.placement;
  // Nest the figure: position it, then size its root to the placement box in the
  // outer inch user space (no "in" suffix here, the outer viewBox already maps
  // user units to inches). The figure's own viewBox does the internal scaling.
  let inner = setRootPosition(figureSvg, place.leftIn, place.topIn);
  inner = withRootSize(inner, n(place.figWIn), n(place.figHIn));
  const sheet =
    args.includeSheet === false
      ? ""
      : `<rect x="0" y="0" width="${n(page.wIn)}" height="${n(page.hIn)}" fill="#ffffff"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(page.wIn)}in" height="${n(page.hIn)}in" ` +
    `viewBox="0 0 ${n(page.wIn)} ${n(page.hIn)}">` +
    sheet +
    inner +
    `</svg>`
  );
}
