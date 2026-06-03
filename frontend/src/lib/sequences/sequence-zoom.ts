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

/**
 * nav polish bot — the lowest zoom the SEQUENCE view is allowed to reach. SeqViz
 * collapses to a bases-free schematic line at `zoom <= 10` (see
 * SeqViewerContainer.linearProps), which is visually identical to the Map view's
 * feature schematic. The Sequence tab is the base-level view, so we floor its
 * effective zoom just above that band: dragging the slider all the way down still
 * shows legible bases, so toggling Map<->Sequence is always an obvious change.
 */
export const SEQUENCE_MIN_LINEAR_ZOOM = 12;

/** Clamp a zoom into the SEQUENCE view's range [SEQUENCE_MIN_LINEAR_ZOOM, MAX]. */
export function clampSequenceZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_LINEAR_ZOOM;
  return Math.min(MAX_LINEAR_ZOOM, Math.max(SEQUENCE_MIN_LINEAR_ZOOM, zoom));
}

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
 * seq pinch bot — map a trackpad PINCH wheel delta to a new zoom level.
 *
 * A macOS trackpad pinch surfaces as a `wheel` event with `ctrlKey === true`;
 * `deltaY` is NEGATIVE when the fingers spread apart (pinch OUT == zoom IN) and
 * POSITIVE when they pinch together (zoom OUT). We move the existing 0-100 zoom
 * knob by `-deltaY * PINCH_ZOOM_SENSITIVITY` so spreading raises the zoom and the
 * gesture feels continuous (a typical pinch fires many small-delta events). The
 * result is clamped into [MIN_LINEAR_ZOOM, MAX_LINEAR_ZOOM].
 *
 * Pure + DOM-free so it is unit-testable; the component just feeds it
 * `event.deltaY` and the current zoom.
 */
export const PINCH_ZOOM_SENSITIVITY = 0.5;

export function pinchDeltaToZoom(currentZoom: number, deltaY: number): number {
  const base = Number.isFinite(currentZoom) ? currentZoom : DEFAULT_LINEAR_ZOOM;
  if (!Number.isFinite(deltaY) || deltaY === 0) return clampLinearZoom(base);
  return clampLinearZoom(base - deltaY * PINCH_ZOOM_SENSITIVITY);
}

/**
 * seq nav bot — EDITABLE "bp in view" field -> zoom (the inverse of the live
 * readout, calibrated against the renderer instead of guessed from a formula).
 *
 * SeqViz's linear `zoom` knob controls bases-per-row, but how many bp end up
 * VISIBLE also depends on the container height (rows on screen), which pure math
 * can't know. So instead of a fragile closed form we CALIBRATE off the live
 * sample the editor already measures every frame: the current zoom and the bp
 * span currently in view. Higher zoom => fewer bp per row => fewer bp in view, so
 * span and zoom move INVERSELY and roughly geometrically (bpsPerRow scales with
 * 1/seqFontSize, and seqFontSize is ~linear in zoom over the legible band). We
 * therefore step zoom by the LOG-ratio of current span to target span: to halve
 * the visible span the user must roughly double the effective resolution.
 *
 * `ZOOM_PER_SPAN_OCTAVE` is how many zoom-knob units correspond to one halving
 * of the visible span; tuned so dragging the full 1..100 range sweeps the whole
 * legible span range of a typical molecule. The result is clamped to the slider
 * range. Pure + DOM-free so it is unit-testable; the component feeds it the live
 * (zoom, span) sample and the user's requested span.
 */
export const ZOOM_PER_SPAN_OCTAVE = 14;

export function zoomForTargetSpan(opts: {
  currentZoom: number;
  currentSpan: number;
  targetSpan: number;
}): number {
  const { currentZoom, currentSpan, targetSpan } = opts;
  const base = Number.isFinite(currentZoom) ? currentZoom : DEFAULT_LINEAR_ZOOM;
  if (!Number.isFinite(currentSpan) || currentSpan <= 0) return clampLinearZoom(base);
  if (!Number.isFinite(targetSpan) || targetSpan <= 0) return clampLinearZoom(base);
  // octaves > 0 when we want a SMALLER span (zoom in => raise the knob).
  const octaves = Math.log2(currentSpan / targetSpan);
  return clampLinearZoom(Math.round(base + octaves * ZOOM_PER_SPAN_OCTAVE));
}

/**
 * nav polish bot — INVERSE of zoomForTargetSpan: what bp span ends up visible at
 * a given zoom, projected from the live (zoom, span) calibration sample?
 *
 * zoomForTargetSpan maps a span delta to a zoom delta of
 * `log2(currentSpan / targetSpan) * ZOOM_PER_SPAN_OCTAVE`. Solving for the span at
 * an arbitrary `zoom` inverts that: each ZOOM_PER_SPAN_OCTAVE knob units HALVES
 * the visible span. So
 *   span(zoom) = currentSpan * 2 ^ (-(zoom - currentZoom) / ZOOM_PER_SPAN_OCTAVE).
 * Used to compute the ACHIEVABLE span at the slider extremes (the renderer's max
 * zoom can't show fewer bases than span(MAX_LINEAR_ZOOM), and its min zoom can't
 * show more than span(MIN_LINEAR_ZOOM)). Pure + DOM-free for unit testing.
 */
export function spanForZoom(opts: {
  currentZoom: number;
  currentSpan: number;
  zoom: number;
}): number {
  const { currentZoom, currentSpan, zoom } = opts;
  if (!Number.isFinite(currentSpan) || currentSpan <= 0) return 0;
  const base = Number.isFinite(currentZoom) ? currentZoom : DEFAULT_LINEAR_ZOOM;
  const target = Number.isFinite(zoom) ? zoom : base;
  return currentSpan * Math.pow(2, -(target - base) / ZOOM_PER_SPAN_OCTAVE);
}

/**
 * nav polish bot — the ACHIEVABLE [min, max] bp-in-view span the linear renderer
 * can actually honor, projected from the live (zoom, span) sample and bounded by
 * the slider's zoom range AND the molecule length.
 *
 * The smallest achievable span is what the MAX zoom shows (SeqViz caps zoom, so
 * on a small molecule the field can't go below ~hundreds of bp); the largest is
 * the whole molecule (capped at `seqLength`, since you can never view more bases
 * than exist). The editable bp-in-view field clamps user input into this range
 * and, on commit, snaps the displayed value to the span actually achieved so it
 * never advertises a span the view can't render. Pure + DOM-free.
 */
export function achievableSpanRange(opts: {
  currentZoom: number;
  currentSpan: number;
  seqLength: number;
}): { min: number; max: number } {
  const { currentZoom, currentSpan, seqLength } = opts;
  const len = Number.isFinite(seqLength) && seqLength > 0 ? seqLength : 0;
  if (!Number.isFinite(currentSpan) || currentSpan <= 0) {
    // No live sample yet: the only safe bound is the molecule length.
    return { min: 1, max: Math.max(1, len) };
  }
  // Smallest span: at the highest (most zoomed-in) knob value.
  const tight = spanForZoom({ currentZoom, currentSpan, zoom: MAX_LINEAR_ZOOM });
  // Largest span: at the lowest knob value (whole-molecule overview).
  const wide = spanForZoom({ currentZoom, currentSpan, zoom: MIN_LINEAR_ZOOM });
  const cap = len > 0 ? len : Math.max(currentSpan, Math.round(wide));
  const min = Math.max(1, Math.min(cap, Math.round(tight)));
  const max = Math.max(min, Math.min(cap, Math.round(wide)));
  return { min, max };
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
 * seq pinch bot — CURSOR-ANCHORED ZOOM math (pure).
 *
 * SeqViz's linear viewer wraps the sequence into stacked rows and scrolls
 * VERTICALLY (there is no horizontal scroll), so the meaningful anchor axis is
 * the cursor's Y, not its X: the visible vertical fraction maps linearly to the
 * bp fraction (the same relationship viewportWindow / bpToScrollTop rely on).
 *
 * Step 1 (BEFORE zoom): from the cursor's Y offset inside the scroller and the
 * pre-zoom geometry, recover the bp sitting under the cursor.
 */
export function bpUnderCursor(opts: {
  cursorY: number;
  scrollTop: number;
  scrollHeight: number;
  seqLength: number;
}): number {
  const { cursorY, scrollTop, scrollHeight, seqLength } = opts;
  if (!Number.isFinite(seqLength) || seqLength <= 0) return 0;
  if (!Number.isFinite(scrollHeight) || scrollHeight <= 0) return 0;
  const y = (Number.isFinite(scrollTop) ? scrollTop : 0) + (Number.isFinite(cursorY) ? cursorY : 0);
  const frac = Math.max(0, Math.min(1, y / scrollHeight));
  return Math.round(frac * seqLength);
}

/**
 * Step 2 (AFTER zoom, with the NEW scrollHeight): what scrollTop puts `bp` back
 * under the cursor's Y? Solve (scrollTop + cursorY) / newScrollHeight == bp/len
 * for scrollTop, then clamp to [0, maxScroll]. This is the linear adjustment that
 * keeps the row under the pointer fixed across a zoom step.
 *
 * NOTE (honest limitation): because the layout is row-wrapped, only the VERTICAL
 * (which-row) position is anchored exactly; the horizontal column within a row
 * shifts slightly when bases-per-row changes on zoom. There is no horizontal
 * scroll to correct that, so sub-row drift of a few bases is expected and is the
 * closest practical anchoring for this renderer.
 */
export function anchorScrollTopForBp(opts: {
  bp: number;
  cursorY: number;
  newScrollHeight: number;
  clientHeight: number;
  seqLength: number;
}): number {
  const { bp, cursorY, newScrollHeight, clientHeight, seqLength } = opts;
  if (!Number.isFinite(seqLength) || seqLength <= 0) return 0;
  if (!Number.isFinite(newScrollHeight) || newScrollHeight <= 0) return 0;
  const frac = Math.max(0, Math.min(1, bp / seqLength));
  const desired = frac * newScrollHeight - (Number.isFinite(cursorY) ? cursorY : 0);
  const maxScroll = Math.max(0, newScrollHeight - Math.max(0, clientHeight));
  return Math.max(0, Math.min(maxScroll, Math.round(desired)));
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

/** A feature spanning at least this fraction of the whole sequence counts as a
 *  "whole-span" feature for the overview mini-map filter (the GenBank `source`
 *  feature, or any annotation drawn end-to-end, paints a full-width bar that just
 *  clutters the map). 0.99 = covers ~the entire sequence. */
export const OVERVIEW_WHOLE_SPAN_FRACTION = 0.99;

/**
 * MINI-MAP-ONLY predicate: should this feature be shown as a tick on the overview
 * bar? Returns false for GenBank `source` features and for any feature whose span
 * covers >= ~99% of the sequence (a near-full-width bar that adds no navigational
 * value). Everything else is kept. This does NOT touch the main viewer, the
 * FeaturesPanel, or the underlying data — it is purely a render filter for the
 * overview strip.
 *
 * Pure + DOM-free so it is unit-testable in isolation.
 */
export function showInOverview(
  feature: { type?: string; start: number; end: number },
  seqLength: number,
): boolean {
  if ((feature.type ?? "").trim().toLowerCase() === "source") return false;
  if (!Number.isFinite(seqLength) || seqLength <= 0) return true;
  const span = feature.end - feature.start;
  if (!Number.isFinite(span) || span <= 0) return true;
  return span / seqLength < OVERVIEW_WHOLE_SPAN_FRACTION;
}
