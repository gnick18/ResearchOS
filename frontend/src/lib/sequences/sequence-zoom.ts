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

// ─── wrap toggle bot — SINGLE-LINE (UNWRAPPED) HORIZONTAL NAVIGATION ──────────
//
// In single-line mode the linear viewer renders the WHOLE sequence on one
// continuous row whose pixel width is `seqLength * charWidth` (wider than the
// container), and the scroller scrolls HORIZONTALLY. The visible-bp window is
// therefore read from the horizontal scroll geometry (scrollLeft / scrollWidth /
// clientWidth) instead of the vertical geometry the wrapped mode uses. These
// pure helpers mirror viewportWindow / bpToScrollTop on the X axis so the
// overview box, the "bp in view" field, and the window readout all keep working.
// All are DOM-free and unit-tested in isolation.

/** Lowest character width (px per base) the single-line view will draw at: still
 *  legible at a small monospace size. Reached at the minimum zoom. */
export const SINGLE_LINE_MIN_CHAR_WIDTH = 3.5;
/** Highest character width (px per base): large, comfortable bases at max zoom. */
export const SINGLE_LINE_MAX_CHAR_WIDTH = 18;

/**
 * Map the 0-100 linear zoom knob to a per-base pixel width for SINGLE-LINE mode.
 * More zoom => wider characters => fewer bases visible in the container (the
 * SnapGene single-line feel). Linear interpolation across the legible band,
 * clamped to [SINGLE_LINE_MIN_CHAR_WIDTH, SINGLE_LINE_MAX_CHAR_WIDTH]. Pure +
 * DOM-free so the renderer can call it and tests can pin the mapping.
 */
export function zoomToCharWidth(zoom: number): number {
  const z = Number.isFinite(zoom) ? Math.min(MAX_LINEAR_ZOOM, Math.max(MIN_LINEAR_ZOOM, zoom)) : DEFAULT_LINEAR_ZOOM;
  const t = (z - MIN_LINEAR_ZOOM) / (MAX_LINEAR_ZOOM - MIN_LINEAR_ZOOM); // 0..1
  return SINGLE_LINE_MIN_CHAR_WIDTH + t * (SINGLE_LINE_MAX_CHAR_WIDTH - SINGLE_LINE_MIN_CHAR_WIDTH);
}

/**
 * The fraction of the whole sequence visible in single-line mode, derived from
 * the horizontal scroll geometry (the row scrolls left-right, so the visible
 * horizontal fraction == the visible bp fraction). Returns (0, 1]; 1 == fits.
 */
export function visibleFractionH(scrollWidth: number, clientWidth: number): number {
  if (!Number.isFinite(scrollWidth) || scrollWidth <= 0) return 1;
  if (!Number.isFinite(clientWidth) || clientWidth <= 0) return 1;
  return Math.min(1, clientWidth / scrollWidth);
}

/**
 * Horizontal variant of viewportWindow: map the single-line scroller's HORIZONTAL
 * geometry to the [start, end) bp window currently visible, for the overview box
 * + the coordinate-bar readouts. `scrollLeft` is the current horizontal offset.
 * Clamped to [0, seqLength], always end > start.
 */
export function viewportWindowH(opts: {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
  seqLength: number;
}): { start: number; end: number } {
  const { scrollLeft, scrollWidth, clientWidth, seqLength } = opts;
  if (!Number.isFinite(seqLength) || seqLength <= 0) return { start: 0, end: 0 };
  if (!Number.isFinite(scrollWidth) || scrollWidth <= 0) {
    return { start: 0, end: seqLength };
  }
  const frac = visibleFractionH(scrollWidth, clientWidth);
  const span = Math.max(1, Math.round(frac * seqLength));
  const leftFrac = Math.max(0, Math.min(1, scrollLeft / scrollWidth));
  let start = Math.round(leftFrac * seqLength);
  start = Math.max(0, Math.min(seqLength - 1, start));
  let end = start + span;
  if (end > seqLength) {
    end = seqLength;
    start = Math.max(0, end - span);
  }
  return { start, end };
}

/**
 * Horizontal variant of bpToScrollTop: given a target bp (the desired left edge
 * of the window), what scrollLeft positions the single-line view there? Used when
 * the user drags the overview box / coordinate scrollbar in single-line mode.
 * Clamped to [0, maxScroll].
 */
export function bpToScrollLeft(opts: {
  bp: number;
  scrollWidth: number;
  clientWidth: number;
  seqLength: number;
}): number {
  const { bp, scrollWidth, clientWidth, seqLength } = opts;
  if (!Number.isFinite(seqLength) || seqLength <= 0) return 0;
  if (!Number.isFinite(scrollWidth) || scrollWidth <= 0) return 0;
  const frac = Math.max(0, Math.min(1, bp / seqLength));
  const maxScroll = Math.max(0, scrollWidth - Math.max(0, clientWidth));
  return Math.max(0, Math.min(maxScroll, Math.round(frac * scrollWidth)));
}

/**
 * Convert an x pixel offset within the overview track (width `trackWidth`) to a
 * base-pair position. The overview lays the track domain out left-to-right.
 *
 * overview zoom bot — the track no longer always spans the WHOLE molecule. The
 * optional `lo`/`hi` describe the bp DOMAIN the track currently covers (the
 * overview EXTENT). When omitted they default to `[0, seqLength]`, so every
 * existing 3-arg call (`trackXToBp(x, width, len)`) is byte-for-byte unchanged.
 */
export function trackXToBp(
  x: number,
  trackWidth: number,
  seqLength: number,
  lo = 0,
  hi = seqLength,
): number {
  if (!Number.isFinite(trackWidth) || trackWidth <= 0) return 0;
  const span = hi - lo;
  if (!Number.isFinite(span) || span <= 0) return Math.round(lo);
  const frac = Math.max(0, Math.min(1, x / trackWidth));
  return Math.round(lo + frac * span);
}

/**
 * Convert a base-pair position to an x pixel offset within the overview track.
 *
 * overview zoom bot — `lo`/`hi` give the bp DOMAIN the track covers (the overview
 * EXTENT). Omitted, they default to `[0, seqLength]`, so the existing 3-arg call
 * (`bpToTrackX(bp, width, len)`) is unchanged. When an extent is supplied, the bp
 * is projected onto `[lo, hi]` and clamped to the track edges so a bp outside the
 * extent pins to the nearest edge (partial-overlap features clamp to 0 / width).
 */
export function bpToTrackX(
  bp: number,
  trackWidth: number,
  seqLength: number,
  lo = 0,
  hi = seqLength,
): number {
  const span = hi - lo;
  if (!Number.isFinite(span) || span <= 0) return 0;
  const frac = Math.max(0, Math.min(1, (bp - lo) / span));
  return frac * trackWidth;
}

/**
 * overview zoom bot — CURSOR-ANCHORED EXTENT ZOOM (pure).
 *
 * The overview bar has its OWN zoom, independent of the detail view. A scroll /
 * pinch over the bar shrinks or grows the visible bp EXTENT `[start, end]`,
 * anchored so the bp under the cursor stays put. `cursorFraction` is the cursor's
 * position across the track (0 at the left edge, 1 at the right). `factor` is the
 * span multiplier (< 1 zooms IN / narrows the extent, > 1 zooms OUT / widens it).
 *
 * Anchor: the bp under the cursor is `anchor = start + cursorFraction * span`.
 * After scaling the span by `factor`, we keep `anchor` at the same fraction:
 *   newStart = anchor - cursorFraction * newSpan.
 *
 * CLAMP:
 *   - the new span is floored at `minSpan` (so it can't invert or get glitchy)
 *     and capped at the whole molecule `seqLength`;
 *   - the resulting window is shifted to stay inside `[0, seqLength]`.
 * Pure + DOM-free so it is unit-testable in isolation.
 */
export function zoomExtentAroundCursor(opts: {
  extent: { start: number; end: number };
  seqLength: number;
  cursorFraction: number;
  factor: number;
  minSpan: number;
}): { start: number; end: number } {
  const { extent, seqLength, cursorFraction, factor, minSpan } = opts;
  const len = Number.isFinite(seqLength) && seqLength > 0 ? seqLength : 0;
  if (len <= 0) return { start: 0, end: 0 };
  const curStart = Math.max(0, Math.min(len, extent.start));
  const curEnd = Math.max(curStart, Math.min(len, extent.end));
  const curSpan = Math.max(1, curEnd - curStart);
  const frac = Math.max(0, Math.min(1, cursorFraction));
  const anchor = curStart + frac * curSpan;
  // Clamp the new span: floored so it can't invert, capped at the whole molecule.
  const floor = Math.max(1, Math.min(len, Math.round(minSpan)));
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  let newSpan = Math.round(curSpan * f);
  newSpan = Math.max(floor, Math.min(len, newSpan));
  let start = Math.round(anchor - frac * newSpan);
  // Shift the window so it stays inside [0, seqLength] without changing its span.
  start = Math.max(0, Math.min(len - newSpan, start));
  const end = start + newSpan;
  return { start, end };
}

/**
 * overview zoom bot — PAN a zoomed extent by a bp delta, keeping its span and
 * staying inside `[0, seqLength]`. Used for horizontal-wheel / drag panning of a
 * zoomed overview. Pure + DOM-free.
 */
export function panExtent(
  extent: { start: number; end: number },
  deltaBp: number,
  seqLength: number,
): { start: number; end: number } {
  const len = Number.isFinite(seqLength) && seqLength > 0 ? seqLength : 0;
  if (len <= 0) return { start: 0, end: 0 };
  const span = Math.max(1, Math.min(len, extent.end - extent.start));
  const d = Number.isFinite(deltaBp) ? Math.round(deltaBp) : 0;
  let start = Math.round(extent.start) + d;
  start = Math.max(0, Math.min(len - span, start));
  return { start, end: start + span };
}

// ─── overview slider bot — OVERVIEW-EXTENT ZOOM SLIDER (span <-> 0..100) ───────
//
// The bottom zoom slider was repurposed to drive the TOP overview bar's zoom (its
// bp EXTENT span), not the base/text view. These pure helpers map the slider's
// 0..100 position to a target extent SPAN and back, and rescale the extent to a
// target span anchored on its CENTER. The mapping is LOG scale (matching the
// bar's own exponential wheel-zoom feel): one octave of span is a constant slider
// distance, so the slider feels even across a 60 kb molecule the same as a 3 kb
// one. Pure + DOM-free so they are unit-testable in isolation.

/** overview slider bot — the absolute floor for the overview extent span (never
 *  zoom the bar tighter than this many bp). The bar's own wheel-zoom uses the
 *  same floor (max with the detail window span); the slider mirrors it so the two
 *  controls share a minimum. */
export const OVERVIEW_MIN_SPAN_FLOOR = 50;

/**
 * overview slider bot — the minimum extent span for the overview, never tighter
 * than the detail window span (so the viewport box stays meaningful) and never
 * below OVERVIEW_MIN_SPAN_FLOOR. Mirrors the inline `minSpan()` in
 * SequenceOverviewBar so the slider and the bar's wheel-zoom share one floor.
 */
export function overviewMinSpan(winSpan: number, seqLength: number): number {
  const len = Number.isFinite(seqLength) && seqLength > 0 ? seqLength : 0;
  const ws = Number.isFinite(winSpan) && winSpan > 0 ? winSpan : 0;
  const floor = Math.max(OVERVIEW_MIN_SPAN_FLOOR, ws);
  if (len <= 0) return Math.max(1, Math.round(floor));
  return Math.max(1, Math.min(len, Math.round(floor)));
}

/** The slider runs 0..100; 0 == whole molecule, 100 == the minimum span. */
export const OVERVIEW_SLIDER_MIN = 0;
export const OVERVIEW_SLIDER_MAX = 100;

/**
 * overview slider bot — map an extent SPAN to a 0..100 slider position on a LOG
 * scale. Whole molecule (span == seqLength) -> 0; the minimum span (`minSpan`) ->
 * 100; spans in between interpolate by log so each octave is even. Clamped to
 * [0, 100]. The degenerate case (minSpan >= seqLength, i.e. a molecule shorter
 * than the floor) returns 0 (already whole). Pure.
 */
export function extentSpanToSlider(opts: {
  span: number;
  seqLength: number;
  minSpan: number;
}): number {
  const { span, seqLength, minSpan } = opts;
  const len = Number.isFinite(seqLength) && seqLength > 0 ? seqLength : 0;
  if (len <= 0) return OVERVIEW_SLIDER_MIN;
  const floor = Math.max(1, Math.min(len, Math.round(minSpan)));
  if (floor >= len) return OVERVIEW_SLIDER_MIN;
  const s = Math.max(floor, Math.min(len, Number.isFinite(span) && span > 0 ? span : len));
  // t = 0 at whole molecule, 1 at the floor (log scale).
  const t = (Math.log(len) - Math.log(s)) / (Math.log(len) - Math.log(floor));
  const v = OVERVIEW_SLIDER_MIN + t * (OVERVIEW_SLIDER_MAX - OVERVIEW_SLIDER_MIN);
  return Math.max(OVERVIEW_SLIDER_MIN, Math.min(OVERVIEW_SLIDER_MAX, Math.round(v)));
}

/**
 * overview slider bot — INVERSE of extentSpanToSlider: map a 0..100 slider
 * position to a target extent SPAN (log scale). 0 -> whole molecule (seqLength),
 * 100 -> the minimum span. Clamped to [minSpan, seqLength]. Pure.
 */
export function sliderToExtentSpan(opts: {
  slider: number;
  seqLength: number;
  minSpan: number;
}): number {
  const { slider, seqLength, minSpan } = opts;
  const len = Number.isFinite(seqLength) && seqLength > 0 ? seqLength : 0;
  if (len <= 0) return 0;
  const floor = Math.max(1, Math.min(len, Math.round(minSpan)));
  if (floor >= len) return len;
  const v = Number.isFinite(slider) ? slider : OVERVIEW_SLIDER_MIN;
  const t = Math.max(0, Math.min(1, (v - OVERVIEW_SLIDER_MIN) / (OVERVIEW_SLIDER_MAX - OVERVIEW_SLIDER_MIN)));
  // Interpolate log-span from whole molecule (t=0) down to the floor (t=1).
  const logSpan = Math.log(len) - t * (Math.log(len) - Math.log(floor));
  const span = Math.round(Math.exp(logSpan));
  return Math.max(floor, Math.min(len, span));
}

/**
 * overview slider bot — rescale an extent to a target SPAN anchored on its CENTER
 * (keep the extent's midpoint fixed while changing the span). Reuses the proven
 * cursor-anchored math at cursorFraction 0.5, so the clamp / shift behavior is
 * identical to the bar's wheel-zoom. Pure.
 */
export function rescaleExtentToSpan(opts: {
  extent: { start: number; end: number };
  seqLength: number;
  targetSpan: number;
  minSpan: number;
}): { start: number; end: number } {
  const { extent, seqLength, targetSpan, minSpan } = opts;
  const curStart = Math.max(0, Math.min(seqLength, extent.start));
  const curEnd = Math.max(curStart, Math.min(seqLength, extent.end));
  const curSpan = Math.max(1, curEnd - curStart);
  const target = Number.isFinite(targetSpan) && targetSpan > 0 ? targetSpan : curSpan;
  const factor = target / curSpan;
  return zoomExtentAroundCursor({
    extent: { start: curStart, end: curEnd },
    seqLength,
    cursorFraction: 0.5,
    factor,
    minSpan,
  });
}

/**
 * overview zoom bot — FRAME the overview EXTENT to a selected bp range so a Map
 * selection that lands in Sequence view shows up snugly in the bar.
 *
 * The selection `[lo, hi]` is padded by `padFraction` of its OWN span on each
 * side (default 0.4 == pad 40% per side) so the highlighted region sits with a
 * little air around it rather than flush to the edges. A `minSpan` floor keeps a
 * 1-bp pick from framing an unreadably tight window. The framed extent is clamped
 * to `[0, seqLength]`; if padding would overflow one edge the window is shifted
 * (not just clipped) so the full padded span is preserved where the molecule
 * allows. Pure + DOM-free so it is unit-testable.
 */
export function frameExtentToSelection(opts: {
  selection: { start: number; end: number };
  seqLength: number;
  padFraction?: number;
  minSpan?: number;
}): { start: number; end: number } {
  const { selection, seqLength, padFraction = 0.4, minSpan = 60 } = opts;
  const len = Number.isFinite(seqLength) && seqLength > 0 ? seqLength : 0;
  if (len <= 0) return { start: 0, end: 0 };
  let selLo = Math.min(selection.start, selection.end);
  let selHi = Math.max(selection.start, selection.end);
  selLo = Math.max(0, Math.min(len, selLo));
  selHi = Math.max(0, Math.min(len, selHi));
  const selSpan = Math.max(0, selHi - selLo);
  const pad = Math.max(0, padFraction) * selSpan;
  let span = selSpan + 2 * pad;
  // Floor so a tiny / zero-width pick still frames a readable window.
  span = Math.max(Math.max(1, Math.round(minSpan)), Math.round(span));
  span = Math.min(len, span);
  const center = (selLo + selHi) / 2;
  let start = Math.round(center - span / 2);
  start = Math.max(0, Math.min(len - span, start));
  return { start, end: start + span };
}

/**
 * overview selband bot — the SELECTION BAND rect for the overview strip.
 *
 * The bar draws the shared editor selection (the same range the LinearMap + base
 * view highlight) as a translucent band so the user sees WHAT IS SELECTED on the
 * mini-map alongside the viewport box (WHERE they are looking). The selection
 * `[start, end]` is projected onto the active overview EXTENT `[lo, hi]` via the
 * extent-aware bpToTrackX, clamped to the track edges so a selection running past
 * the visible extent pins to the nearest edge.
 *
 * Returns null when there is no selection, when the track has no width, or when
 * the selection lies ENTIRELY outside the visible extent (nothing to draw). The
 * returned x0/x1 are TRACK-relative (do not include TRACK_PAD_X); the caller adds
 * the pad. `clampedLeft` / `clampedRight` mark which ends were clipped by the
 * extent (so the caller can drop an edge rule if the bound is off-screen).
 *
 * Pure + DOM-free so it is unit-testable in isolation.
 */
export function overviewSelectionRect(opts: {
  selection: { start: number; end: number } | null | undefined;
  trackWidth: number;
  seqLength: number;
  lo: number;
  hi: number;
}): { x0: number; x1: number; clampedLeft: boolean; clampedRight: boolean } | null {
  const { selection, trackWidth, seqLength, lo, hi } = opts;
  if (!selection) return null;
  if (!Number.isFinite(trackWidth) || trackWidth <= 0) return null;
  if (!Number.isFinite(seqLength) || seqLength <= 0) return null;
  const selLo = Math.min(selection.start, selection.end);
  const selHi = Math.max(selection.start, selection.end);
  // Entirely outside the visible extent -> nothing to draw.
  if (selHi <= lo || selLo >= hi) return null;
  const x0 = bpToTrackX(selLo, trackWidth, seqLength, lo, hi);
  const x1 = bpToTrackX(selHi, trackWidth, seqLength, lo, hi);
  return {
    x0,
    x1,
    clampedLeft: selLo < lo,
    clampedRight: selHi > hi,
  };
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

/**
 * overview featclick bot — HIT-TEST a clicked bp against the overview's drawn
 * features and return the MOST SPECIFIC match, or null when the click missed
 * every feature (a bare-track click).
 *
 * `features` is the already-drawn set, IN DRAW ORDER (a later entry sits on top).
 * The pick is the NARROWEST [start, end] that contains the clicked bp; ties (two
 * equally narrow features over the same bp) resolve to the TOPMOST (last-drawn)
 * one, matching what the eye reads as "on top". The bp is compared against each
 * feature's TRUE span, so a click resolves anywhere along the on-screen arrow.
 *
 * Pure + DOM-free so it is unit-testable in isolation; the component calls it
 * with the same features it draws.
 */
export function pickOverviewFeatureAtBp<T extends { start: number; end: number }>(
  features: readonly T[],
  bp: number,
): T | null {
  let best: T | null = null;
  let bestSpan = Infinity;
  for (const f of features) {
    if (bp < f.start || bp > f.end) continue;
    const span = f.end - f.start;
    // <= so a later-drawn (topmost) feature of equal width wins the tie.
    if (span <= bestSpan) {
      best = f;
      bestSpan = span;
    }
  }
  return best;
}
