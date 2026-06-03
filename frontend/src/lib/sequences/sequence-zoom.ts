// seq nav bot — pure math for SnapGene-style LINEAR NAVIGATION: the seamless
// zoom control, the initial fit-to-length zoom, and the bp<->fraction mapping
// that powers the overview/context bar's viewport box. Kept renderer-free and
// dependency-free so it is unit-testable in isolation (no SeqViz, no DOM).
//
// SeqViz's linear `zoom` is a 0-100 knob that scales font/element size and, via
// SeqViewerContainer.linearProps(), the number of bases per rendered row:
//   - zoom <= 5  -> the "overview map" (a thin line, features as arrows, no
//                   individual legible bases): this is MAP MODE.
//   - ~50        -> base-level (the SeqViz default).
//   - up to 100  -> very large bases.
// We expose a 0-100 slider wired straight to that knob, plus a length-aware
// INITIAL zoom so a 61 kb contig opens as a legible whole-contig map while a
// small plasmid opens detailed.

/** SeqViz renders the linear overview "map" (line + feature arrows, no bases) at
 *  this zoom and below. Mirrors the `zoom <= 5` branch in SeqViewerContainer. */
export const MAP_ZOOM = 5;

/** The lowest the slider/zoom can go (full overview map). */
export const MIN_LINEAR_ZOOM = 1;
/** The highest the slider/zoom can go (large bases). */
export const MAX_LINEAR_ZOOM = 100;

/** SeqViz's own default linear zoom (base-level, comfortable). */
export const DEFAULT_LINEAR_ZOOM = 50;

/** Length (bp) at/under which a molecule opens at full base-level detail. */
const SMALL_SEQ_BP = 2000;
/** Length (bp) at/over which a molecule opens at the full overview map. */
const LARGE_SEQ_BP = 50000;

/**
 * Pick a sensible INITIAL linear zoom from the sequence length (the "fit-ish"
 * default that replaces the crude `>5000 bp -> zoom 2` stand-in).
 *
 * - small sequences (<= ~2 kb, e.g. an oligo / small insert) open at base level
 *   so the user sees individual bases immediately;
 * - large contigs (>= ~50 kb, e.g. a 61 kb genomic contig) open at the overview
 *   MAP so the whole thing is legible as feature arrows;
 * - in between, we interpolate on a log scale (length grows fast) so a typical
 *   5-10 kb plasmid opens partly zoomed-out but still readable.
 *
 * Returned value is clamped to [MIN_LINEAR_ZOOM, MAX_LINEAR_ZOOM].
 */
export function initialLinearZoom(seqLength: number): number {
  if (!Number.isFinite(seqLength) || seqLength <= 0) return DEFAULT_LINEAR_ZOOM;
  if (seqLength <= SMALL_SEQ_BP) return DEFAULT_LINEAR_ZOOM;
  if (seqLength >= LARGE_SEQ_BP) return MIN_LINEAR_ZOOM;

  // Log-interpolate between the small-seq anchor (base level) and the large-seq
  // anchor (map). t in [0,1]: 0 at SMALL_SEQ_BP, 1 at LARGE_SEQ_BP.
  const lo = Math.log(SMALL_SEQ_BP);
  const hi = Math.log(LARGE_SEQ_BP);
  const t = (Math.log(seqLength) - lo) / (hi - lo);
  const zoom = DEFAULT_LINEAR_ZOOM + t * (MAP_ZOOM - DEFAULT_LINEAR_ZOOM);
  return clampLinearZoom(Math.round(zoom));
}

/** Clamp an arbitrary number into the slider's linear-zoom range. */
export function clampLinearZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_LINEAR_ZOOM;
  return Math.min(MAX_LINEAR_ZOOM, Math.max(MIN_LINEAR_ZOOM, zoom));
}

/** Is this zoom at/below the overview-map threshold (i.e. MAP MODE)? */
export function isMapZoom(zoom: number): boolean {
  return zoom <= MAP_ZOOM;
}

/**
 * The fraction of the whole sequence visible in the main linear view, derived
 * from the scroll container's geometry. The linear viewer stacks rows of bases
 * vertically and scrolls, so the visible vertical fraction == the visible bp
 * fraction. Returns a value in (0, 1]; 1 means the whole sequence fits.
 */
export function visibleFraction(scrollHeight: number, clientHeight: number): number {
  if (!Number.isFinite(scrollHeight) || scrollHeight <= 0) return 1;
  if (!Number.isFinite(clientHeight) || clientHeight <= 0) return 1;
  return Math.min(1, clientHeight / scrollHeight);
}

/**
 * Map the main view's scroll geometry to the [start, end) bp window currently
 * visible, used to position the overview bar's viewport box. `scrollTop` is the
 * scroller's current scroll offset; scroll/client/seqLength give the scale.
 * The window is clamped to [0, seqLength] and always has end > start.
 */
export function viewportWindow(opts: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  seqLength: number;
}): { start: number; end: number } {
  const { scrollTop, scrollHeight, clientHeight, seqLength } = opts;
  if (!Number.isFinite(seqLength) || seqLength <= 0) return { start: 0, end: 0 };
  if (!Number.isFinite(scrollHeight) || scrollHeight <= 0) {
    return { start: 0, end: seqLength };
  }
  const frac = visibleFraction(scrollHeight, clientHeight);
  const span = Math.max(1, Math.round(frac * seqLength));
  const topFrac = Math.max(0, Math.min(1, scrollTop / scrollHeight));
  let start = Math.round(topFrac * seqLength);
  start = Math.max(0, Math.min(seqLength - 1, start));
  let end = start + span;
  if (end > seqLength) {
    end = seqLength;
    start = Math.max(0, end - span);
  }
  return { start, end };
}

/**
 * Inverse of viewportWindow's start: given a target bp (the desired center or
 * top of the window), what scrollTop positions the main view there? Used when
 * the user drags the overview viewport box. Clamped to [0, maxScroll].
 */
export function bpToScrollTop(opts: {
  bp: number;
  scrollHeight: number;
  clientHeight: number;
  seqLength: number;
}): number {
  const { bp, scrollHeight, clientHeight, seqLength } = opts;
  if (!Number.isFinite(seqLength) || seqLength <= 0) return 0;
  if (!Number.isFinite(scrollHeight) || scrollHeight <= 0) return 0;
  const frac = Math.max(0, Math.min(1, bp / seqLength));
  const maxScroll = Math.max(0, scrollHeight - Math.max(0, clientHeight));
  return Math.max(0, Math.min(maxScroll, Math.round(frac * scrollHeight)));
}

/**
 * Convert an x pixel offset within the overview track (width `trackWidth`) to a
 * base-pair position. The overview lays the whole sequence out left-to-right.
 */
export function trackXToBp(x: number, trackWidth: number, seqLength: number): number {
  if (!Number.isFinite(trackWidth) || trackWidth <= 0) return 0;
  const frac = Math.max(0, Math.min(1, x / trackWidth));
  return Math.round(frac * seqLength);
}

/** Convert a base-pair position to an x pixel offset within the overview track. */
export function bpToTrackX(bp: number, trackWidth: number, seqLength: number): number {
  if (!Number.isFinite(seqLength) || seqLength <= 0) return 0;
  const frac = Math.max(0, Math.min(1, bp / seqLength));
  return frac * trackWidth;
}
