// linear-map zoom bot — pure, renderer-free math for the SnapGene-style LINEAR
// MAP's visible-window zoom + context navigator. The map shows a sub-window
// [winStart, winEnd] of the molecule (default = whole molecule); these helpers
// convert between a 0..1 zoom SLIDER position and the window SPAN (bp), clamp +
// recenter the window on zoom, pan/clamp it, and clip a feature span to the
// visible window. Kept DOM-free + dependency-free so the mapping is unit-tested
// in isolation (the renderer just calls these).
//
// WHY A LOG SLIDER: span ranges from the whole molecule (could be 100,000 bp)
// down to the MIN_WINDOW_BP cap (60 bp). A linear slider would spend almost its
// whole travel near the wide end; a log mapping makes each slider increment a
// roughly CONSTANT zoom RATIO so the control feels smooth across the full range.

/**
 * The smallest visible window (max zoom). Below this the map would want to show
 * individual base letters, which is the Sequence tab's job: the linear MAP must
 * never render nucleotides, so this is a hard floor on the window span.
 */
export const MIN_WINDOW_BP = 60;

/** Clamp a window span to [MIN_WINDOW_BP, seqLength]. */
export function clampSpan(span: number, seqLength: number): number {
  const max = Math.max(MIN_WINDOW_BP, Math.round(seqLength));
  if (!Number.isFinite(span)) return max;
  return Math.min(max, Math.max(MIN_WINDOW_BP, Math.round(span)));
}

/**
 * Map a 0..1 SLIDER position to a window SPAN (bp), log-scaled.
 *
 * pos = 0  -> whole molecule (widest span == seqLength, capped at >= MIN).
 * pos = 1  -> MIN_WINDOW_BP (most zoomed in).
 *
 * Interpolation is geometric: span = wide * (tight / wide) ^ pos, so equal slider
 * steps multiply the span by a constant factor (constant zoom ratio). When the
 * molecule is at or under MIN_WINDOW_BP there is no room to zoom, so the span is
 * pinned to the molecule length for every position.
 */
export function sliderToSpan(pos: number, seqLength: number): number {
  const wide = Math.max(MIN_WINDOW_BP, Math.round(seqLength));
  const tight = MIN_WINDOW_BP;
  if (wide <= tight) return wide;
  const p = Math.max(0, Math.min(1, Number.isFinite(pos) ? pos : 0));
  const span = wide * Math.pow(tight / wide, p);
  return clampSpan(span, seqLength);
}

/**
 * Inverse of sliderToSpan: map a window SPAN (bp) back to a 0..1 slider position.
 * Used to keep the slider thumb in lockstep when the window is changed by other
 * means (navigator drag, +/- buttons, edge resize). Returns 0 when the molecule
 * is too small to zoom.
 */
export function spanToSlider(span: number, seqLength: number): number {
  const wide = Math.max(MIN_WINDOW_BP, Math.round(seqLength));
  const tight = MIN_WINDOW_BP;
  if (wide <= tight) return 0;
  const s = clampSpan(span, seqLength);
  // pos = log(s / wide) / log(tight / wide)
  const pos = Math.log(s / wide) / Math.log(tight / wide);
  return Math.max(0, Math.min(1, pos));
}

/**
 * Build a window of a given SPAN centered on `center`, clamped to [0, seqLength].
 * The span is clamped to [MIN_WINDOW_BP, seqLength] first; if clamping the center
 * would push an edge past a molecule bound, the window slides back inside so it
 * always keeps its full span (when the span fits) and never exceeds the molecule.
 */
export function windowAroundCenter(
  center: number,
  span: number,
  seqLength: number,
): { start: number; end: number } {
  const len = Math.max(0, Math.round(seqLength));
  const s = clampSpan(span, len);
  const c = Math.max(0, Math.min(len, Number.isFinite(center) ? center : len / 2));
  let start = Math.round(c - s / 2);
  let end = start + s;
  if (start < 0) {
    start = 0;
    end = s;
  }
  if (end > len) {
    end = len;
    start = Math.max(0, end - s);
  }
  return { start, end };
}

/**
 * Build a window of a given SPAN such that `anchorBp` lands at `fraction` (0..1)
 * across the track, then clamp to [0, seqLength]. This is the CURSOR-ANCHORED
 * zoom used by the map's trackpad pinch (map pinch bot): the bp under the cursor
 * before the zoom stays under the cursor after it, matching the SeqViz / SnapGene
 * feel. The span is clamped to [MIN_WINDOW_BP, seqLength] first; if anchoring at
 * the exact fraction would push an edge past a molecule bound, the window slides
 * back inside so it always keeps its full span (when the span fits) and never
 * exceeds the molecule. With fraction 0.5 this reduces to windowAroundCenter.
 */
export function windowAroundPoint(
  anchorBp: number,
  span: number,
  fraction: number,
  seqLength: number,
): { start: number; end: number } {
  const len = Math.max(0, Math.round(seqLength));
  const s = clampSpan(span, len);
  const a = Math.max(0, Math.min(len, Number.isFinite(anchorBp) ? anchorBp : len / 2));
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0.5));
  // We want start + f * s == a, so the anchor sits f of the way across the track.
  let start = Math.round(a - f * s);
  let end = start + s;
  if (start < 0) {
    start = 0;
    end = s;
  }
  if (end > len) {
    end = len;
    start = Math.max(0, end - s);
  }
  return { start, end };
}

/** The whole-molecule window (default zoom). */
export function fullWindow(seqLength: number): { start: number; end: number } {
  return { start: 0, end: Math.max(0, Math.round(seqLength)) };
}

/**
 * PAN a window by a bp delta, clamped so it stays inside [0, seqLength] keeping
 * its span. Positive delta moves right (toward the molecule end).
 */
export function panWindow(
  win: { start: number; end: number },
  deltaBp: number,
  seqLength: number,
): { start: number; end: number } {
  const len = Math.max(0, Math.round(seqLength));
  const span = win.end - win.start;
  const d = Number.isFinite(deltaBp) ? deltaBp : 0;
  let start = Math.round(win.start + d);
  start = Math.max(0, Math.min(len - span, start));
  return { start, end: start + span };
}

/**
 * JOG WHEEL sensitivity factor (map jog wheel bot). A drag of the FULL track
 * width nudges the window by this fraction of its CURRENT span, so the jog is
 * far finer than the navigator box (where a full-width drag pans roughly the
 * whole molecule). Scaling by the current span keeps the feel consistent across
 * zoom levels: at a tight 60 bp window a comfortable drag nudges a handful of
 * bp; when less zoomed the same drag covers proportionally more.
 */
export const JOG_SENSITIVITY = 0.3;

/**
 * Convert a horizontal jog-wheel DRAG (pixels) into a fine pan DELTA (bp). The
 * pan is proportional to (dragPx / trackWidthPx) * winSpan * JOG_SENSITIVITY, so
 * it scales with the visible span (consistent feel across zoom) yet stays much
 * finer than dragging the whole-molecule navigator box the same distance.
 * Positive dragPx (drag right) returns a positive delta (window moves toward the
 * molecule end), matching a tactile wheel that scrolls content with the drag.
 */
export function jogScrubToDeltaBp(
  dragPx: number,
  trackWidthPx: number,
  winSpan: number,
): number {
  const dx = Number.isFinite(dragPx) ? dragPx : 0;
  const tw = Number.isFinite(trackWidthPx) && trackWidthPx > 0 ? trackWidthPx : 1;
  const span = Number.isFinite(winSpan) && winSpan > 0 ? winSpan : 1;
  return (dx / tw) * span * JOG_SENSITIVITY;
}

/**
 * RESIZE a window by moving ONE edge to a target bp, keeping the OTHER edge fixed
 * (the navigator's edge-drag = zoom). Enforces the MIN_WINDOW_BP floor so the
 * dragged edge can never collapse the window below the cap, and clamps to the
 * molecule bounds. `edge` is which handle is being dragged.
 */
export function resizeWindowEdge(
  win: { start: number; end: number },
  edge: "start" | "end",
  targetBp: number,
  seqLength: number,
): { start: number; end: number } {
  const len = Math.max(0, Math.round(seqLength));
  const t = Math.max(0, Math.min(len, Math.round(Number.isFinite(targetBp) ? targetBp : 0)));
  if (edge === "start") {
    // Fixed right edge; the new start can come no closer than MIN_WINDOW_BP.
    const fixedEnd = win.end;
    const start = Math.min(t, fixedEnd - MIN_WINDOW_BP);
    return { start: Math.max(0, start), end: fixedEnd };
  }
  // Fixed left edge; the new end can come no closer than MIN_WINDOW_BP.
  const fixedStart = win.start;
  const end = Math.max(t, fixedStart + MIN_WINDOW_BP);
  return { start: fixedStart, end: Math.min(len, end) };
}

/**
 * Does a feature/segment span [lo, hi] OVERLAP the visible window [winStart,
 * winEnd]? Endpoints touching count as overlap. Used to skip drawing items fully
 * outside the window.
 */
export function spanOverlapsWindow(
  lo: number,
  hi: number,
  winStart: number,
  winEnd: number,
): boolean {
  return hi >= winStart && lo <= winEnd;
}

/**
 * CLIP a span [lo, hi] to the window [winStart, winEnd]. Returns the visible
 * sub-span, or null if it lies fully outside. A feature box that straddles a
 * window edge is clipped to that edge so it never draws past the strand ends.
 */
export function clipSpanToWindow(
  lo: number,
  hi: number,
  winStart: number,
  winEnd: number,
): { lo: number; hi: number } | null {
  if (!spanOverlapsWindow(lo, hi, winStart, winEnd)) return null;
  return { lo: Math.max(lo, winStart), hi: Math.min(hi, winEnd) };
}

/**
 * Pick a "nice" ruler tick step for the VISIBLE span so a zoomed window shows
 * finer ticks (e.g. a 200 bp window shows ~25/50 bp ticks). Aims for ~8 intervals
 * across whatever span is visible, snapped to a 1/2/5 * 10^n value, floored at 1.
 */
export function rulerStepForSpan(visibleSpan: number): number {
  if (!Number.isFinite(visibleSpan) || visibleSpan <= 0) return 1;
  const target = visibleSpan / 8;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  const candidates = [1, 2, 5, 10].map((m) => m * pow);
  for (const c of candidates) if (c >= target) return Math.max(1, c);
  return Math.max(1, candidates[candidates.length - 1]);
}
