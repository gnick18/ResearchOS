// seq nav bot — unit tests for the linear-navigation zoom + viewport math.
import { describe, expect, it } from "vitest";
import {
  MAP_ZOOM,
  MIN_LINEAR_ZOOM,
  MAX_LINEAR_ZOOM,
  DEFAULT_LINEAR_ZOOM,
  initialLinearZoom,
  clampLinearZoom,
  isMapZoom,
  visibleFraction,
  viewportWindow,
  bpToScrollTop,
  trackXToBp,
  bpToTrackX,
  pinchDeltaToZoom,
  PINCH_ZOOM_SENSITIVITY,
  zoomForTargetSpan,
  ZOOM_PER_SPAN_OCTAVE,
  bpUnderCursor,
  anchorScrollTopForBp,
  showInOverview,
  OVERVIEW_WHOLE_SPAN_FRACTION,
  spanForZoom,
  achievableSpanRange,
  clampSequenceZoom,
  SEQUENCE_MIN_LINEAR_ZOOM,
} from "./sequence-zoom";

describe("initialLinearZoom", () => {
  it("opens small sequences at base level", () => {
    expect(initialLinearZoom(500)).toBe(DEFAULT_LINEAR_ZOOM);
    expect(initialLinearZoom(2000)).toBe(DEFAULT_LINEAR_ZOOM);
  });

  it("opens very large contigs at the overview map", () => {
    expect(initialLinearZoom(50000)).toBe(MIN_LINEAR_ZOOM);
    expect(initialLinearZoom(61000)).toBe(MIN_LINEAR_ZOOM);
    expect(isMapZoom(initialLinearZoom(61000))).toBe(true);
  });

  it("interpolates monotonically in between (bigger seq -> more zoomed out)", () => {
    const z5k = initialLinearZoom(5000);
    const z10k = initialLinearZoom(10000);
    const z30k = initialLinearZoom(30000);
    expect(z5k).toBeGreaterThan(z10k);
    expect(z10k).toBeGreaterThan(z30k);
    expect(z5k).toBeLessThan(DEFAULT_LINEAR_ZOOM);
    expect(z30k).toBeGreaterThanOrEqual(MIN_LINEAR_ZOOM);
  });

  it("guards against bad input", () => {
    expect(initialLinearZoom(0)).toBe(DEFAULT_LINEAR_ZOOM);
    expect(initialLinearZoom(-10)).toBe(DEFAULT_LINEAR_ZOOM);
    expect(initialLinearZoom(NaN)).toBe(DEFAULT_LINEAR_ZOOM);
  });
});

describe("clampLinearZoom", () => {
  it("clamps to range", () => {
    expect(clampLinearZoom(-5)).toBe(MIN_LINEAR_ZOOM);
    expect(clampLinearZoom(0)).toBe(MIN_LINEAR_ZOOM);
    expect(clampLinearZoom(250)).toBe(MAX_LINEAR_ZOOM);
    expect(clampLinearZoom(42)).toBe(42);
    expect(clampLinearZoom(NaN)).toBe(DEFAULT_LINEAR_ZOOM);
  });
});

describe("isMapZoom", () => {
  it("flags overview-map zoom levels", () => {
    expect(isMapZoom(1)).toBe(true);
    expect(isMapZoom(MAP_ZOOM)).toBe(true);
    expect(isMapZoom(MAP_ZOOM + 1)).toBe(false);
    expect(isMapZoom(50)).toBe(false);
  });
});

describe("pinchDeltaToZoom", () => {
  it("zooms IN on a negative deltaY (fingers spread / pinch out)", () => {
    // -30 * 0.5 = +15
    expect(pinchDeltaToZoom(50, -30)).toBe(50 + 30 * PINCH_ZOOM_SENSITIVITY);
    expect(pinchDeltaToZoom(50, -30)).toBeGreaterThan(50);
  });

  it("zooms OUT on a positive deltaY (fingers pinch together)", () => {
    expect(pinchDeltaToZoom(50, 30)).toBe(50 - 30 * PINCH_ZOOM_SENSITIVITY);
    expect(pinchDeltaToZoom(50, 30)).toBeLessThan(50);
  });

  it("clamps into the slider range", () => {
    expect(pinchDeltaToZoom(MAX_LINEAR_ZOOM, -1000)).toBe(MAX_LINEAR_ZOOM);
    expect(pinchDeltaToZoom(MIN_LINEAR_ZOOM, 1000)).toBe(MIN_LINEAR_ZOOM);
  });

  it("is a no-op on a zero / non-finite delta", () => {
    expect(pinchDeltaToZoom(42, 0)).toBe(42);
    expect(pinchDeltaToZoom(42, NaN)).toBe(42);
  });

  it("falls back to the default zoom for a non-finite current zoom", () => {
    expect(pinchDeltaToZoom(NaN, 0)).toBe(DEFAULT_LINEAR_ZOOM);
  });
});

describe("visibleFraction", () => {
  it("is 1 when the whole sequence fits", () => {
    expect(visibleFraction(100, 100)).toBe(1);
    expect(visibleFraction(100, 200)).toBe(1);
  });
  it("is the client/scroll ratio when scrolled", () => {
    expect(visibleFraction(1000, 250)).toBeCloseTo(0.25, 5);
  });
  it("guards bad geometry", () => {
    expect(visibleFraction(0, 100)).toBe(1);
    expect(visibleFraction(100, 0)).toBe(1);
  });
});

describe("viewportWindow", () => {
  it("returns the whole sequence when not scrollable", () => {
    expect(viewportWindow({ scrollTop: 0, scrollHeight: 0, clientHeight: 100, seqLength: 6000 })).toEqual({
      start: 0,
      end: 6000,
    });
  });

  it("maps top-of-scroll to the start window", () => {
    const w = viewportWindow({ scrollTop: 0, scrollHeight: 1000, clientHeight: 250, seqLength: 60000 });
    expect(w.start).toBe(0);
    // ~25% of the sequence visible
    expect(w.end).toBeGreaterThan(14000);
    expect(w.end).toBeLessThan(16000);
  });

  it("maps mid-scroll to a centered window and clamps the bottom", () => {
    const mid = viewportWindow({ scrollTop: 500, scrollHeight: 1000, clientHeight: 250, seqLength: 60000 });
    expect(mid.start).toBeGreaterThan(25000);
    expect(mid.start).toBeLessThan(35000);

    const bottom = viewportWindow({ scrollTop: 750, scrollHeight: 1000, clientHeight: 250, seqLength: 60000 });
    expect(bottom.end).toBe(60000);
    expect(bottom.start).toBeLessThan(bottom.end);
  });
});

describe("bpToScrollTop", () => {
  it("is the inverse mapping of viewportWindow start", () => {
    const seqLength = 60000;
    const scrollHeight = 1000;
    const clientHeight = 250;
    const st = bpToScrollTop({ bp: 30000, scrollHeight, clientHeight, seqLength });
    // 30000/60000 = 0.5 of scrollHeight, clamped to maxScroll (750)
    expect(st).toBe(500);
    const w = viewportWindow({ scrollTop: st, scrollHeight, clientHeight, seqLength });
    expect(w.start).toBeGreaterThan(25000);
    expect(w.start).toBeLessThan(35000);
  });
  it("clamps to max scroll", () => {
    const st = bpToScrollTop({ bp: 60000, scrollHeight: 1000, clientHeight: 250, seqLength: 60000 });
    expect(st).toBe(750);
  });
});

describe("trackXToBp / bpToTrackX round-trip", () => {
  it("maps pixels<->bp across the track width", () => {
    const w = 600;
    const len = 60000;
    expect(trackXToBp(0, w, len)).toBe(0);
    expect(trackXToBp(w, w, len)).toBe(len);
    expect(trackXToBp(300, w, len)).toBe(30000);
    expect(bpToTrackX(0, w, len)).toBe(0);
    expect(bpToTrackX(len, w, len)).toBe(w);
    expect(bpToTrackX(30000, w, len)).toBeCloseTo(300, 5);
  });
  it("clamps out-of-range input", () => {
    expect(trackXToBp(-50, 600, 60000)).toBe(0);
    expect(trackXToBp(9999, 600, 60000)).toBe(60000);
    expect(bpToTrackX(-5, 600, 60000)).toBe(0);
    expect(bpToTrackX(99999, 600, 60000)).toBe(600);
  });
});

describe("cursor-anchored zoom math (bpUnderCursor / anchorScrollTopForBp)", () => {
  it("recovers the bp under the cursor from scroll + cursor Y", () => {
    // scrollHeight 1000 px maps 0..10000 bp; cursor 200 px below a 300 px scroll
    // sits at y=500 -> half-way -> 5000 bp.
    expect(
      bpUnderCursor({ cursorY: 200, scrollTop: 300, scrollHeight: 1000, seqLength: 10000 }),
    ).toBe(5000);
    // top of an unscrolled view -> bp 0.
    expect(
      bpUnderCursor({ cursorY: 0, scrollTop: 0, scrollHeight: 1000, seqLength: 10000 }),
    ).toBe(0);
  });
  it("clamps the cursor bp into [0, seqLength]", () => {
    expect(
      bpUnderCursor({ cursorY: 9999, scrollTop: 9999, scrollHeight: 1000, seqLength: 10000 }),
    ).toBe(10000);
  });
  it("solves the scrollTop that puts a bp back under the cursor on a new layout", () => {
    // After zoom the layout doubled to 2000 px tall. To put bp 5000 (frac 0.5,
    // i.e. y=1000) under a cursor 200 px down, scrollTop = 1000 - 200 = 800.
    expect(
      anchorScrollTopForBp({
        bp: 5000,
        cursorY: 200,
        newScrollHeight: 2000,
        clientHeight: 600,
        seqLength: 10000,
      }),
    ).toBe(800);
  });
  it("clamps the anchored scrollTop to [0, maxScroll]", () => {
    // Desired scrollTop would be negative near the top -> clamp to 0.
    expect(
      anchorScrollTopForBp({
        bp: 0,
        cursorY: 200,
        newScrollHeight: 2000,
        clientHeight: 600,
        seqLength: 10000,
      }),
    ).toBe(0);
    // Near the end, desired exceeds maxScroll (2000-600=1400) -> clamp to 1400.
    expect(
      anchorScrollTopForBp({
        bp: 10000,
        cursorY: 0,
        newScrollHeight: 2000,
        clientHeight: 600,
        seqLength: 10000,
      }),
    ).toBe(1400);
  });
  it("round-trips: bp under cursor before == bp under cursor after a zoom", () => {
    const seqLength = 8000;
    // Before zoom: scrollHeight 1000, scrolled to 250, cursor 250 px down.
    const before = { scrollTop: 250, scrollHeight: 1000, cursorY: 250 };
    const bp = bpUnderCursor({ ...before, seqLength });
    // After zoom: layout grew to 4000 px. Apply the anchor.
    const newScrollHeight = 4000;
    const newScrollTop = anchorScrollTopForBp({
      bp,
      cursorY: before.cursorY,
      newScrollHeight,
      clientHeight: 600,
      seqLength,
    });
    // The bp now under the cursor should match the original bp (within rounding).
    const after = bpUnderCursor({
      cursorY: before.cursorY,
      scrollTop: newScrollTop,
      scrollHeight: newScrollHeight,
      seqLength,
    });
    expect(after).toBeCloseTo(bp, -1); // within ~a few bp (sub-row drift aside)
  });
});

describe("showInOverview — mini-map whole-span / source filter", () => {
  const len = 10000;
  it("hides GenBank `source` features (any case)", () => {
    expect(showInOverview({ type: "source", start: 0, end: 100 }, len)).toBe(false);
    expect(showInOverview({ type: "SOURCE", start: 0, end: 100 }, len)).toBe(false);
    expect(showInOverview({ type: " Source ", start: 0, end: 100 }, len)).toBe(false);
  });
  it("hides any feature spanning >= ~99% of the sequence", () => {
    expect(showInOverview({ type: "CDS", start: 0, end: len }, len)).toBe(false);
    expect(showInOverview({ type: "misc_feature", start: 0, end: 9950 }, len)).toBe(false);
    expect(showInOverview({ start: 50, end: len }, len)).toBe(false); // 99.5%
  });
  it("keeps ordinary sub-span features", () => {
    expect(showInOverview({ type: "CDS", start: 100, end: 900 }, len)).toBe(true);
    expect(showInOverview({ type: "gene", start: 0, end: 9000 }, len)).toBe(true); // 90%
  });
  it("is permissive when seqLength is unknown / non-positive", () => {
    expect(showInOverview({ type: "CDS", start: 0, end: 100 }, 0)).toBe(true);
    expect(showInOverview({ type: "CDS", start: 0, end: 100 }, NaN)).toBe(true);
  });
  it("the threshold constant is ~99%", () => {
    expect(OVERVIEW_WHOLE_SPAN_FRACTION).toBeCloseTo(0.99, 5);
  });
});

describe("zoomForTargetSpan (editable bp-in-view field -> zoom)", () => {
  it("returns the current zoom when the target equals the current span", () => {
    expect(
      zoomForTargetSpan({ currentZoom: 50, currentSpan: 1000, targetSpan: 1000 }),
    ).toBe(50);
  });

  it("raises the zoom to show FEWER bases (zoom in)", () => {
    const z = zoomForTargetSpan({ currentZoom: 40, currentSpan: 1000, targetSpan: 500 });
    expect(z).toBeGreaterThan(40);
    // one octave (halving) == ZOOM_PER_SPAN_OCTAVE steps
    expect(z).toBe(clampLinearZoom(40 + ZOOM_PER_SPAN_OCTAVE));
  });

  it("lowers the zoom to show MORE bases (zoom out)", () => {
    const z = zoomForTargetSpan({ currentZoom: 60, currentSpan: 1000, targetSpan: 2000 });
    expect(z).toBeLessThan(60);
    expect(z).toBe(clampLinearZoom(60 - ZOOM_PER_SPAN_OCTAVE));
  });

  it("is monotonic: a smaller target span never lowers the zoom", () => {
    const wide = zoomForTargetSpan({ currentZoom: 50, currentSpan: 4000, targetSpan: 3000 });
    const narrow = zoomForTargetSpan({ currentZoom: 50, currentSpan: 4000, targetSpan: 200 });
    expect(narrow).toBeGreaterThanOrEqual(wide);
  });

  it("clamps into the slider range", () => {
    expect(
      zoomForTargetSpan({ currentZoom: 95, currentSpan: 10000, targetSpan: 1 }),
    ).toBe(MAX_LINEAR_ZOOM);
    expect(
      zoomForTargetSpan({ currentZoom: 5, currentSpan: 100, targetSpan: 1_000_000 }),
    ).toBe(MIN_LINEAR_ZOOM);
  });

  it("guards bad input (non-positive / non-finite spans)", () => {
    expect(zoomForTargetSpan({ currentZoom: 50, currentSpan: 0, targetSpan: 100 })).toBe(50);
    expect(zoomForTargetSpan({ currentZoom: 50, currentSpan: 100, targetSpan: 0 })).toBe(50);
    expect(zoomForTargetSpan({ currentZoom: NaN, currentSpan: 100, targetSpan: 50 })).toBe(
      clampLinearZoom(DEFAULT_LINEAR_ZOOM + ZOOM_PER_SPAN_OCTAVE),
    );
  });
});

describe("clampSequenceZoom — Sequence view floor (FIX 1)", () => {
  it("floors below the bases-free schematic band", () => {
    expect(clampSequenceZoom(1)).toBe(SEQUENCE_MIN_LINEAR_ZOOM);
    expect(clampSequenceZoom(MIN_LINEAR_ZOOM)).toBe(SEQUENCE_MIN_LINEAR_ZOOM);
    expect(clampSequenceZoom(MAP_ZOOM)).toBe(SEQUENCE_MIN_LINEAR_ZOOM);
  });
  it("keeps zooms at/above the floor untouched and caps at the max", () => {
    expect(clampSequenceZoom(50)).toBe(50);
    expect(clampSequenceZoom(SEQUENCE_MIN_LINEAR_ZOOM)).toBe(SEQUENCE_MIN_LINEAR_ZOOM);
    expect(clampSequenceZoom(250)).toBe(MAX_LINEAR_ZOOM);
  });
  it("the floor is strictly above the map / schematic threshold", () => {
    // SeqViz collapses to a bases-free line at zoom <= 10; the floor must clear it.
    expect(SEQUENCE_MIN_LINEAR_ZOOM).toBeGreaterThan(MAP_ZOOM);
    expect(SEQUENCE_MIN_LINEAR_ZOOM).toBeGreaterThan(10);
  });
  it("falls back to the default for non-finite input", () => {
    expect(clampSequenceZoom(NaN)).toBe(DEFAULT_LINEAR_ZOOM);
  });
});

describe("spanForZoom — inverse of zoomForTargetSpan (FIX 3)", () => {
  it("returns the current span at the current zoom", () => {
    expect(spanForZoom({ currentZoom: 50, currentSpan: 1000, zoom: 50 })).toBeCloseTo(1000, 5);
  });
  it("halves the span per ZOOM_PER_SPAN_OCTAVE knob units of zoom-IN", () => {
    const s = spanForZoom({ currentZoom: 40, currentSpan: 1000, zoom: 40 + ZOOM_PER_SPAN_OCTAVE });
    expect(s).toBeCloseTo(500, 5);
  });
  it("doubles the span per octave of zoom-OUT", () => {
    const s = spanForZoom({ currentZoom: 60, currentSpan: 1000, zoom: 60 - ZOOM_PER_SPAN_OCTAVE });
    expect(s).toBeCloseTo(2000, 5);
  });
  it("round-trips against zoomForTargetSpan", () => {
    // The zoom that yields a 250 bp span, fed back through spanForZoom, recovers ~250.
    const z = zoomForTargetSpan({ currentZoom: 50, currentSpan: 1800, targetSpan: 250 });
    const back = spanForZoom({ currentZoom: 50, currentSpan: 1800, zoom: z });
    expect(back).toBeCloseTo(250, -1); // within rounding of the integer zoom step
  });
  it("guards bad input", () => {
    expect(spanForZoom({ currentZoom: 50, currentSpan: 0, zoom: 50 })).toBe(0);
  });
});

describe("achievableSpanRange — bp-in-view clamp to what the renderer can honor (FIX 3)", () => {
  it("caps the WIDEST span at the molecule length", () => {
    const r = achievableSpanRange({ currentZoom: 50, currentSpan: 600, seqLength: 1800 });
    expect(r.max).toBe(1800);
  });

  it("the SMALLEST span is the max-zoom projection of the live sample (not 1)", () => {
    // 1800 bp molecule, live sample 600 bp visible at zoom 50. At MAX zoom (100)
    // the span shrinks by (100-50) knob units == that many / ZOOM_PER_SPAN_OCTAVE
    // octaves. The achievable floor is that projected span, NOT 1.
    const r = achievableSpanRange({ currentZoom: 50, currentSpan: 600, seqLength: 1800 });
    const expectedMin = Math.round(
      spanForZoom({ currentZoom: 50, currentSpan: 600, zoom: MAX_LINEAR_ZOOM }),
    );
    expect(r.min).toBe(Math.max(1, Math.min(1800, expectedMin)));
    expect(r.min).toBeGreaterThan(1);
    expect(r.min).toBeLessThan(r.max);
  });

  it("a too-small request (below the floor) clamps UP to the achievable minimum", () => {
    // A short, already-tight sample so the achievable floor is well above a tiny
    // request: mirrors the verifier's case (typing a span the view can't honor).
    const r = achievableSpanRange({ currentZoom: 20, currentSpan: 1200, seqLength: 1800 });
    const requested = Math.max(1, r.min - 1); // strictly below the floor
    const clamped = Math.min(r.max, Math.max(r.min, requested));
    expect(clamped).toBe(r.min);
    expect(clamped).toBeGreaterThanOrEqual(requested);
  });

  it("a too-large request clamps DOWN to the molecule length", () => {
    const r = achievableSpanRange({ currentZoom: 50, currentSpan: 600, seqLength: 1800 });
    const clamped = Math.min(r.max, Math.max(r.min, 999999));
    expect(clamped).toBe(1800);
  });

  it("min never exceeds max even when the sample is already near the floor", () => {
    const r = achievableSpanRange({ currentZoom: 95, currentSpan: 220, seqLength: 1800 });
    expect(r.min).toBeLessThanOrEqual(r.max);
    expect(r.min).toBeGreaterThanOrEqual(1);
  });

  it("falls back to [1, seqLength] when there is no live span sample", () => {
    expect(achievableSpanRange({ currentZoom: 50, currentSpan: 0, seqLength: 1800 })).toEqual({
      min: 1,
      max: 1800,
    });
  });
});
