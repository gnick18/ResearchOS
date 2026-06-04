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
  zoomExtentAroundCursor,
  panExtent,
  frameExtentToSelection,
  overviewMinSpan,
  extentSpanToSlider,
  sliderToExtentSpan,
  rescaleExtentToSpan,
  OVERVIEW_MIN_SPAN_FLOOR,
  OVERVIEW_SLIDER_MIN,
  OVERVIEW_SLIDER_MAX,
  overviewSelectionRect,
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

// pinch-zoom bot — the SEQUENCE detail viewer composes the trackpad pinch as
// clampSequenceZoom(pinchDeltaToZoom(current, deltaY)) so a pinch shares the EXACT
// same [SEQUENCE_MIN_LINEAR_ZOOM, MAX] range the slider uses. This pins that
// composition and the dead-zone fix: before the floor, a long contig whose zoom
// sat below the Sequence floor could pinch DOWN into the 1..11 band that the
// viewer pins at the floor anyway, so the molecule never visibly changed.
describe("Sequence-view pinch composition: clampSequenceZoom(pinchDeltaToZoom(...))", () => {
  const seqPinch = (zoom: number, deltaY: number) =>
    clampSequenceZoom(pinchDeltaToZoom(zoom, deltaY));

  it("zooms IN (negative deltaY) within the Sequence range, matching the slider", () => {
    const next = seqPinch(50, -30); // +15
    expect(next).toBe(65);
    expect(next).toBeGreaterThan(50);
    expect(next).toBeLessThanOrEqual(MAX_LINEAR_ZOOM);
  });

  it("zooming OUT never sinks below the Sequence floor (no dead zone)", () => {
    // A big positive delta would drive raw pinch toward MIN_LINEAR_ZOOM (1), but
    // the Sequence view floors at SEQUENCE_MIN_LINEAR_ZOOM so pinch == slider.
    expect(seqPinch(SEQUENCE_MIN_LINEAR_ZOOM, 1000)).toBe(SEQUENCE_MIN_LINEAR_ZOOM);
    // Even starting BELOW the floor (a long-contig auto zoom), the result is floored.
    expect(seqPinch(MAP_ZOOM, 100)).toBe(SEQUENCE_MIN_LINEAR_ZOOM);
    expect(seqPinch(MAP_ZOOM, -100)).toBeGreaterThanOrEqual(SEQUENCE_MIN_LINEAR_ZOOM);
  });

  it("caps at MAX on a hard zoom-in pinch", () => {
    expect(seqPinch(MAX_LINEAR_ZOOM, -1000)).toBe(MAX_LINEAR_ZOOM);
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

// overview zoom bot — the extent-aware (non-zero lo) bp<->x mapping that lets the
// overview bar render a sub-range of the molecule across the full track.
describe("trackXToBp / bpToTrackX over a non-zero extent [lo, hi]", () => {
  it("maps the extent domain across the whole track width", () => {
    const w = 600;
    const len = 60000;
    // Extent [10000, 20000] (span 10000) spans the 600px track.
    expect(trackXToBp(0, w, len, 10000, 20000)).toBe(10000);
    expect(trackXToBp(w, w, len, 10000, 20000)).toBe(20000);
    expect(trackXToBp(300, w, len, 10000, 20000)).toBe(15000);
    expect(bpToTrackX(10000, w, len, 10000, 20000)).toBe(0);
    expect(bpToTrackX(20000, w, len, 10000, 20000)).toBe(w);
    expect(bpToTrackX(15000, w, len, 10000, 20000)).toBeCloseTo(300, 5);
  });
  it("clamps a bp outside the extent to the nearest track edge", () => {
    const w = 600;
    const len = 60000;
    // bp before lo pins to 0; bp after hi pins to the track width (partial-overlap
    // features clamp to the edges rather than spilling off-track).
    expect(bpToTrackX(5000, w, len, 10000, 20000)).toBe(0);
    expect(bpToTrackX(50000, w, len, 10000, 20000)).toBe(w);
  });
  it("is byte-compatible with the 3-arg whole-molecule call", () => {
    const w = 600;
    const len = 60000;
    expect(bpToTrackX(30000, w, len)).toBe(bpToTrackX(30000, w, len, 0, len));
    expect(trackXToBp(300, w, len)).toBe(trackXToBp(300, w, len, 0, len));
  });
});

describe("zoomExtentAroundCursor (independent overview zoom anchor + clamp)", () => {
  it("keeps the bp under the cursor put while narrowing the span (zoom in)", () => {
    // Whole molecule, cursor at the center (frac 0.5 -> anchor bp 5000). Halving
    // the span to 5000 should keep 5000 at the center -> [2500, 7500].
    const next = zoomExtentAroundCursor({
      extent: { start: 0, end: 10000 },
      seqLength: 10000,
      cursorFraction: 0.5,
      factor: 0.5,
      minSpan: 50,
    });
    expect(next).toEqual({ start: 2500, end: 7500 });
  });
  it("anchors at an off-center cursor", () => {
    // Cursor a quarter across (frac 0.25 -> anchor bp 2500). Halving span to 5000
    // keeps 2500 at frac 0.25 -> start = 2500 - 0.25*5000 = 1250.
    const next = zoomExtentAroundCursor({
      extent: { start: 0, end: 10000 },
      seqLength: 10000,
      cursorFraction: 0.25,
      factor: 0.5,
      minSpan: 50,
    });
    expect(next).toEqual({ start: 1250, end: 6250 });
  });
  it("floors the span at minSpan so it can't invert or get glitchy", () => {
    const next = zoomExtentAroundCursor({
      extent: { start: 4000, end: 6000 },
      seqLength: 10000,
      cursorFraction: 0.5,
      factor: 0.001, // would collapse to ~2 bp without the floor
      minSpan: 200,
    });
    expect(next.end - next.start).toBe(200);
    // still anchored at the center (bp 5000).
    expect(next.start).toBe(4900);
    expect(next.end).toBe(5100);
  });
  it("caps the span at the whole molecule and clamps the window in-range", () => {
    const next = zoomExtentAroundCursor({
      extent: { start: 2000, end: 4000 },
      seqLength: 10000,
      cursorFraction: 0.5,
      factor: 100, // would blow past the molecule without the cap
      minSpan: 50,
    });
    expect(next).toEqual({ start: 0, end: 10000 });
  });
  it("shifts (not just clips) the window to stay inside [0, seqLength]", () => {
    // Widen an extent whose anchored start would overflow the right edge: the
    // window keeps its span and shifts left to stay inside the molecule.
    const next = zoomExtentAroundCursor({
      extent: { start: 9500, end: 9800 },
      seqLength: 10000,
      cursorFraction: 1, // anchor bp 9800
      factor: 10, // span 300 -> 3000
      minSpan: 50,
    });
    expect(next.end - next.start).toBe(3000);
    // anchored start = 9800 - 3000 = 6800, fits inside [0, 7000] -> unchanged.
    expect(next).toEqual({ start: 6800, end: 9800 });
  });
  it("shifts left when the anchored window would overflow the right edge", () => {
    const next = zoomExtentAroundCursor({
      extent: { start: 9000, end: 9900 },
      seqLength: 10000,
      cursorFraction: 0, // anchor bp 9000, keep it at the LEFT edge
      factor: 2, // span 900 -> 1800
      minSpan: 50,
    });
    expect(next.end - next.start).toBe(1800);
    // anchored start = 9000, but 9000 + 1800 = 10800 > 10000 -> shift to 8200.
    expect(next).toEqual({ start: 8200, end: 10000 });
  });
});

describe("panExtent (pan a zoomed overview without changing its span)", () => {
  it("shifts the window by the bp delta, preserving the span", () => {
    expect(panExtent({ start: 2000, end: 4000 }, 500, 10000)).toEqual({
      start: 2500,
      end: 4500,
    });
  });
  it("clamps the panned window inside [0, seqLength]", () => {
    expect(panExtent({ start: 2000, end: 4000 }, -5000, 10000)).toEqual({
      start: 0,
      end: 2000,
    });
    expect(panExtent({ start: 8000, end: 9500 }, 5000, 10000)).toEqual({
      start: 8500,
      end: 10000,
    });
  });
});

describe("frameExtentToSelection (frame the overview to a Map selection)", () => {
  it("pads a selection by ~40% of its span on each side", () => {
    // Selection [4000, 5000] (span 1000), 40% pad each side -> span 1800 centered
    // on 4500 -> [3600, 5400].
    const ext = frameExtentToSelection({
      selection: { start: 4000, end: 5000 },
      seqLength: 10000,
    });
    expect(ext).toEqual({ start: 3600, end: 5400 });
  });
  it("floors a tiny / 1-bp pick to a readable minimum span", () => {
    const ext = frameExtentToSelection({
      selection: { start: 5000, end: 5000 },
      seqLength: 10000,
      minSpan: 60,
    });
    expect(ext.end - ext.start).toBe(60);
    // centered on the pick (bp 5000).
    expect(ext.start).toBe(4970);
    expect(ext.end).toBe(5030);
  });
  it("normalizes a reversed selection and clamps to [0, seqLength]", () => {
    // Reversed bounds near the start: framing can't go below 0, so it shifts right.
    const ext = frameExtentToSelection({
      selection: { start: 500, end: 100 },
      seqLength: 10000,
      padFraction: 0.5,
    });
    // span = 400 + 2*200 = 800, centered on 300 -> would start at -100 -> clamp 0.
    expect(ext).toEqual({ start: 0, end: 800 });
  });
  it("never frames wider than the whole molecule", () => {
    const ext = frameExtentToSelection({
      selection: { start: 0, end: 10000 },
      seqLength: 10000,
      padFraction: 0.5,
    });
    expect(ext).toEqual({ start: 0, end: 10000 });
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

describe("overviewSelectionRect (selection band over the overview extent)", () => {
  const w = 600;
  const len = 60000;

  it("maps a selection to track x over the WHOLE-molecule extent", () => {
    // 10000..20000 of a 60000 bp molecule on a 600px track -> 100..200.
    const r = overviewSelectionRect({
      selection: { start: 10000, end: 20000 },
      trackWidth: w,
      seqLength: len,
      lo: 0,
      hi: len,
    });
    expect(r).not.toBeNull();
    expect(r!.x0).toBeCloseTo(100, 5);
    expect(r!.x1).toBeCloseTo(200, 5);
    expect(r!.clampedLeft).toBe(false);
    expect(r!.clampedRight).toBe(false);
  });

  it("normalizes a reversed selection (start > end)", () => {
    const a = overviewSelectionRect({ selection: { start: 20000, end: 10000 }, trackWidth: w, seqLength: len, lo: 0, hi: len });
    const b = overviewSelectionRect({ selection: { start: 10000, end: 20000 }, trackWidth: w, seqLength: len, lo: 0, hi: len });
    expect(a).toEqual(b);
  });

  it("maps + CLAMPS over a zoomed extent [lo, hi], flagging the clipped edges", () => {
    // extent 10000..20000 on a 600px track. A selection 5000..15000 starts BEFORE
    // the extent (clamps to x0=0) and ends mid-extent (15000 -> 300).
    const r = overviewSelectionRect({
      selection: { start: 5000, end: 15000 },
      trackWidth: w,
      seqLength: len,
      lo: 10000,
      hi: 20000,
    });
    expect(r).not.toBeNull();
    expect(r!.x0).toBe(0); // clamped to the left track edge
    expect(r!.x1).toBeCloseTo(300, 5);
    expect(r!.clampedLeft).toBe(true);
    expect(r!.clampedRight).toBe(false);
  });

  it("clamps a selection running past the RIGHT edge of the extent", () => {
    const r = overviewSelectionRect({ selection: { start: 18000, end: 50000 }, trackWidth: w, seqLength: len, lo: 10000, hi: 20000 });
    expect(r).not.toBeNull();
    expect(r!.x1).toBe(w);
    expect(r!.clampedRight).toBe(true);
  });

  it("returns null when the selection is ENTIRELY outside the extent", () => {
    expect(overviewSelectionRect({ selection: { start: 100, end: 5000 }, trackWidth: w, seqLength: len, lo: 10000, hi: 20000 })).toBeNull();
    expect(overviewSelectionRect({ selection: { start: 30000, end: 40000 }, trackWidth: w, seqLength: len, lo: 10000, hi: 20000 })).toBeNull();
  });

  it("returns null for no selection / zero track width / no sequence", () => {
    expect(overviewSelectionRect({ selection: null, trackWidth: w, seqLength: len, lo: 0, hi: len })).toBeNull();
    expect(overviewSelectionRect({ selection: { start: 1, end: 2 }, trackWidth: 0, seqLength: len, lo: 0, hi: len })).toBeNull();
    expect(overviewSelectionRect({ selection: { start: 1, end: 2 }, trackWidth: w, seqLength: 0, lo: 0, hi: 0 })).toBeNull();
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

// ─── wrap toggle bot — SINGLE-LINE (horizontal) navigation math ───────────────
import {
  zoomToCharWidth,
  visibleFractionH,
  viewportWindowH,
  bpToScrollLeft,
  SINGLE_LINE_MIN_CHAR_WIDTH,
  SINGLE_LINE_MAX_CHAR_WIDTH,
} from "./sequence-zoom";

describe("zoomToCharWidth (single-line px-per-base from the zoom knob)", () => {
  it("maps the min zoom to the min char width and max zoom to the max", () => {
    expect(zoomToCharWidth(MIN_LINEAR_ZOOM)).toBeCloseTo(SINGLE_LINE_MIN_CHAR_WIDTH, 5);
    expect(zoomToCharWidth(MAX_LINEAR_ZOOM)).toBeCloseTo(SINGLE_LINE_MAX_CHAR_WIDTH, 5);
  });

  it("is monotonic: more zoom => wider characters => fewer bases on screen", () => {
    expect(zoomToCharWidth(80)).toBeGreaterThan(zoomToCharWidth(40));
    expect(zoomToCharWidth(40)).toBeGreaterThan(zoomToCharWidth(12));
  });

  it("clamps out-of-range / non-finite zoom into the legible band", () => {
    expect(zoomToCharWidth(-50)).toBeCloseTo(SINGLE_LINE_MIN_CHAR_WIDTH, 5);
    expect(zoomToCharWidth(500)).toBeCloseTo(SINGLE_LINE_MAX_CHAR_WIDTH, 5);
    const nan = zoomToCharWidth(Number.NaN);
    expect(nan).toBeGreaterThanOrEqual(SINGLE_LINE_MIN_CHAR_WIDTH);
    expect(nan).toBeLessThanOrEqual(SINGLE_LINE_MAX_CHAR_WIDTH);
  });
});

describe("visibleFractionH (horizontal visible fraction)", () => {
  it("returns the clientWidth/scrollWidth ratio, capped at 1", () => {
    expect(visibleFractionH(1000, 250)).toBeCloseTo(0.25, 5);
    expect(visibleFractionH(200, 400)).toBe(1); // whole row fits
  });
  it("degrades safely to 1 on bad geometry", () => {
    expect(visibleFractionH(0, 100)).toBe(1);
    expect(visibleFractionH(1000, 0)).toBe(1);
  });
});

describe("viewportWindowH (single-line visible bp window from horizontal scroll)", () => {
  it("at scrollLeft 0 shows the leftmost slice", () => {
    // 1000 bp row, container shows 1/4 -> ~250 bp window starting at 0.
    const w = viewportWindowH({ scrollLeft: 0, scrollWidth: 4000, clientWidth: 1000, seqLength: 1000 });
    expect(w.start).toBe(0);
    expect(w.end).toBe(250);
  });

  it("mid-scroll slides the window proportionally to scrollLeft", () => {
    // halfway scrolled -> window starts ~halfway through the molecule.
    const w = viewportWindowH({ scrollLeft: 2000, scrollWidth: 4000, clientWidth: 1000, seqLength: 1000 });
    expect(w.start).toBe(500);
    expect(w.end).toBe(750);
  });

  it("at max scroll the window butts against the end (end == seqLength)", () => {
    // scrollLeft == scrollWidth - clientWidth == 3000
    const w = viewportWindowH({ scrollLeft: 3000, scrollWidth: 4000, clientWidth: 1000, seqLength: 1000 });
    expect(w.end).toBe(1000);
    expect(w.start).toBe(750);
  });

  it("zooming in (smaller visible fraction) shrinks the window span", () => {
    const wide = viewportWindowH({ scrollLeft: 0, scrollWidth: 4000, clientWidth: 1000, seqLength: 1000 });
    const tight = viewportWindowH({ scrollLeft: 0, scrollWidth: 8000, clientWidth: 1000, seqLength: 1000 });
    expect(tight.end - tight.start).toBeLessThan(wide.end - wide.start);
  });

  it("whole row fitting yields the full molecule window", () => {
    const w = viewportWindowH({ scrollLeft: 0, scrollWidth: 800, clientWidth: 1000, seqLength: 1000 });
    expect(w.start).toBe(0);
    expect(w.end).toBe(1000);
  });

  it("degrades to the whole molecule on bad geometry", () => {
    expect(viewportWindowH({ scrollLeft: 0, scrollWidth: 0, clientWidth: 100, seqLength: 500 })).toEqual({
      start: 0,
      end: 500,
    });
    expect(viewportWindowH({ scrollLeft: 0, scrollWidth: 100, clientWidth: 100, seqLength: 0 })).toEqual({
      start: 0,
      end: 0,
    });
  });
});

describe("bpToScrollLeft (drag the overview box -> horizontal pan)", () => {
  it("maps bp fraction to scrollLeft, clamped to [0, maxScroll]", () => {
    // bp 500 of 1000 over a 4000px row -> 2000px, clamped to maxScroll 3000.
    expect(bpToScrollLeft({ bp: 500, scrollWidth: 4000, clientWidth: 1000, seqLength: 1000 })).toBe(2000);
  });
  it("bp at the start is scrollLeft 0", () => {
    expect(bpToScrollLeft({ bp: 0, scrollWidth: 4000, clientWidth: 1000, seqLength: 1000 })).toBe(0);
  });
  it("bp at the end clamps to maxScroll (scrollWidth - clientWidth)", () => {
    expect(bpToScrollLeft({ bp: 1000, scrollWidth: 4000, clientWidth: 1000, seqLength: 1000 })).toBe(3000);
  });
  it("is the inverse of viewportWindowH at a representative offset", () => {
    const seqLength = 1000, scrollWidth = 4000, clientWidth = 1000;
    const left = bpToScrollLeft({ bp: 500, scrollWidth, clientWidth, seqLength });
    const w = viewportWindowH({ scrollLeft: left, scrollWidth, clientWidth, seqLength });
    expect(Math.abs(w.start - 500)).toBeLessThanOrEqual(1);
  });
  it("degrades safely on bad geometry", () => {
    expect(bpToScrollLeft({ bp: 100, scrollWidth: 0, clientWidth: 100, seqLength: 500 })).toBe(0);
    expect(bpToScrollLeft({ bp: 100, scrollWidth: 1000, clientWidth: 100, seqLength: 0 })).toBe(0);
  });
});

describe("overview slider bot — overviewMinSpan (shared extent floor)", () => {
  it("floors at OVERVIEW_MIN_SPAN_FLOOR when the detail window is tiny", () => {
    expect(overviewMinSpan(10, 10000)).toBe(OVERVIEW_MIN_SPAN_FLOOR);
  });
  it("never tighter than the detail window span", () => {
    expect(overviewMinSpan(800, 10000)).toBe(800);
  });
  it("caps at the molecule length", () => {
    expect(overviewMinSpan(9999, 200)).toBe(200);
  });
});

describe("overview slider bot — extentSpanToSlider / sliderToExtentSpan", () => {
  const seqLength = 60000;
  const minSpan = 50;

  it("slider MIN maps to / from the whole molecule", () => {
    expect(extentSpanToSlider({ span: seqLength, seqLength, minSpan })).toBe(OVERVIEW_SLIDER_MIN);
    expect(sliderToExtentSpan({ slider: OVERVIEW_SLIDER_MIN, seqLength, minSpan })).toBe(seqLength);
  });

  it("slider MAX maps to / from the minimum span", () => {
    expect(extentSpanToSlider({ span: minSpan, seqLength, minSpan })).toBe(OVERVIEW_SLIDER_MAX);
    expect(sliderToExtentSpan({ slider: OVERVIEW_SLIDER_MAX, seqLength, minSpan })).toBe(minSpan);
  });

  it("round-trips a mid span within rounding tolerance", () => {
    const span = 6000;
    const slider = extentSpanToSlider({ span, seqLength, minSpan });
    const back = sliderToExtentSpan({ slider, seqLength, minSpan });
    // Log scale + integer slider snapping, so allow a few percent.
    expect(Math.abs(back - span) / span).toBeLessThan(0.1);
  });

  it("is monotonic — a bigger slider value yields a smaller span (more zoom)", () => {
    const a = sliderToExtentSpan({ slider: 20, seqLength, minSpan });
    const b = sliderToExtentSpan({ slider: 80, seqLength, minSpan });
    expect(b).toBeLessThan(a);
  });

  it("clamps the slider position into [MIN, MAX]", () => {
    expect(extentSpanToSlider({ span: seqLength * 2, seqLength, minSpan })).toBe(OVERVIEW_SLIDER_MIN);
    expect(extentSpanToSlider({ span: 1, seqLength, minSpan })).toBe(OVERVIEW_SLIDER_MAX);
  });

  it("degenerate molecule (shorter than the floor) is always whole / slider 0", () => {
    expect(extentSpanToSlider({ span: 30, seqLength: 30, minSpan: 50 })).toBe(OVERVIEW_SLIDER_MIN);
    expect(sliderToExtentSpan({ slider: 100, seqLength: 30, minSpan: 50 })).toBe(30);
  });
});

describe("overview slider bot — rescaleExtentToSpan (center-anchored)", () => {
  const seqLength = 10000;

  it("keeps the extent centered while changing the span", () => {
    // extent [4000,6000] center 5000; rescale to span 1000 -> [4500,5500].
    const next = rescaleExtentToSpan({
      extent: { start: 4000, end: 6000 },
      seqLength,
      targetSpan: 1000,
      minSpan: 50,
    });
    expect(next.end - next.start).toBe(1000);
    const center = (next.start + next.end) / 2;
    expect(Math.abs(center - 5000)).toBeLessThanOrEqual(1);
  });

  it("widening to the whole molecule shifts to stay in [0, seqLength]", () => {
    const next = rescaleExtentToSpan({
      extent: { start: 100, end: 300 },
      seqLength,
      targetSpan: seqLength,
      minSpan: 50,
    });
    expect(next).toEqual({ start: 0, end: seqLength });
  });

  it("honors the minSpan floor", () => {
    const next = rescaleExtentToSpan({
      extent: { start: 4000, end: 6000 },
      seqLength,
      targetSpan: 1,
      minSpan: 200,
    });
    expect(next.end - next.start).toBe(200);
  });

  it("slider-driven rescale preserves the center end-to-end", () => {
    const minSpan = overviewMinSpan(120, seqLength);
    const extent = { start: 3000, end: 7000 }; // center 5000
    const targetSpan = sliderToExtentSpan({ slider: 70, seqLength, minSpan });
    const next = rescaleExtentToSpan({ extent, seqLength, targetSpan, minSpan });
    const center = (next.start + next.end) / 2;
    expect(Math.abs(center - 5000)).toBeLessThanOrEqual(1);
    expect(next.end - next.start).toBe(targetSpan);
  });
});
