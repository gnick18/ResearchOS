// linear-map zoom bot — unit tests for the linear map's visible-window math.
import { describe, expect, it } from "vitest";
import {
  MIN_WINDOW_BP,
  clampSpan,
  sliderToSpan,
  spanToSlider,
  windowAroundCenter,
  windowAroundPoint,
  fullWindow,
  panWindow,
  jogScrubToDeltaBp,
  JOG_SENSITIVITY,
  resizeWindowEdge,
  spanOverlapsWindow,
  clipSpanToWindow,
  rulerStepForSpan,
} from "./linear-map-window";

describe("clampSpan", () => {
  it("floors the span at MIN_WINDOW_BP", () => {
    expect(clampSpan(10, 5000)).toBe(MIN_WINDOW_BP);
    expect(clampSpan(MIN_WINDOW_BP - 1, 5000)).toBe(MIN_WINDOW_BP);
  });
  it("caps the span at the molecule length", () => {
    expect(clampSpan(99999, 5000)).toBe(5000);
  });
  it("passes a valid span through (rounded)", () => {
    expect(clampSpan(200.4, 5000)).toBe(200);
  });
  it("never lets the cap drop below MIN even for tiny molecules", () => {
    expect(clampSpan(10, 30)).toBe(MIN_WINDOW_BP);
  });
});

describe("sliderToSpan / spanToSlider", () => {
  const len = 10000;
  it("pos 0 = whole molecule, pos 1 = MIN_WINDOW_BP", () => {
    expect(sliderToSpan(0, len)).toBe(len);
    expect(sliderToSpan(1, len)).toBe(MIN_WINDOW_BP);
  });
  it("is monotonic decreasing in pos", () => {
    let prev = Infinity;
    for (let p = 0; p <= 1.0001; p += 0.1) {
      const s = sliderToSpan(p, len);
      expect(s).toBeLessThanOrEqual(prev + 1e-6);
      prev = s;
    }
  });
  it("is a roughly log scale: equal pos steps give ~constant span ratio", () => {
    const a = sliderToSpan(0.25, len);
    const b = sliderToSpan(0.5, len);
    const c = sliderToSpan(0.75, len);
    const r1 = a / b;
    const r2 = b / c;
    // ratios within ~5% of each other (rounding noise aside)
    expect(Math.abs(r1 - r2) / r1).toBeLessThan(0.05);
  });
  it("round-trips span -> slider -> span within rounding", () => {
    for (const p of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const span = sliderToSpan(p, len);
      const back = spanToSlider(span, len);
      const span2 = sliderToSpan(back, len);
      expect(Math.abs(span2 - span)).toBeLessThanOrEqual(2);
    }
  });
  it("pins to molecule length when too small to zoom", () => {
    expect(sliderToSpan(0, 40)).toBe(MIN_WINDOW_BP);
    expect(sliderToSpan(1, 40)).toBe(MIN_WINDOW_BP);
    expect(spanToSlider(MIN_WINDOW_BP, 40)).toBe(0);
  });
});

describe("windowAroundCenter", () => {
  it("centers a window on the given bp", () => {
    expect(windowAroundCenter(5000, 200, 10000)).toEqual({ start: 4900, end: 5100 });
  });
  it("clamps a window that runs off the left", () => {
    expect(windowAroundCenter(10, 200, 10000)).toEqual({ start: 0, end: 200 });
  });
  it("clamps a window that runs off the right", () => {
    expect(windowAroundCenter(9990, 200, 10000)).toEqual({ start: 9800, end: 10000 });
  });
  it("keeps the full span when clamped", () => {
    const w = windowAroundCenter(0, 200, 10000);
    expect(w.end - w.start).toBe(200);
  });
  it("never exceeds the molecule for a span larger than it", () => {
    const w = windowAroundCenter(50, 99999, 1000);
    expect(w).toEqual({ start: 0, end: 1000 });
  });
});

describe("windowAroundPoint", () => {
  const len = 10000;
  it("places the anchor at the requested fraction across the track", () => {
    // anchor 5000 at fraction 0.25 with span 1000 -> start = 5000 - 250 = 4750.
    expect(windowAroundPoint(5000, 1000, 0.25, len)).toEqual({ start: 4750, end: 5750 });
  });
  it("matches windowAroundCenter at fraction 0.5", () => {
    expect(windowAroundPoint(5000, 200, 0.5, len)).toEqual(windowAroundCenter(5000, 200, len));
  });
  it("keeps the anchor bp under the same fraction after a zoom-in (cursor anchor)", () => {
    // Cursor at fraction 0.3 over a window [1000, 10000] sits on bp 3700.
    const win0 = { start: 1000, end: 10000 };
    const span0 = win0.end - win0.start; // 9000
    const frac = 0.3;
    const anchorBp = win0.start + frac * span0; // 3700
    // Zoom in to span 3000; the anchor must still sit at frac 0.3 (within rounding).
    const win1 = windowAroundPoint(anchorBp, 3000, frac, len);
    const bpAtFracAfter = win1.start + frac * (win1.end - win1.start);
    expect(Math.abs(bpAtFracAfter - anchorBp)).toBeLessThanOrEqual(1);
  });
  it("clamps a window that runs off the left", () => {
    // anchor 10 at fraction 0.5 span 200 would start at -90 -> slid to 0.
    expect(windowAroundPoint(10, 200, 0.5, len)).toEqual({ start: 0, end: 200 });
  });
  it("clamps a window that runs off the right", () => {
    expect(windowAroundPoint(9990, 200, 0.5, len)).toEqual({ start: 9800, end: 10000 });
  });
  it("keeps the full span when clamped at an edge", () => {
    const w = windowAroundPoint(0, 200, 0, len);
    expect(w.end - w.start).toBe(200);
  });
  it("never exceeds the molecule for a span larger than it", () => {
    expect(windowAroundPoint(50, 99999, 0.4, 1000)).toEqual({ start: 0, end: 1000 });
  });
  it("clamps the fraction to 0..1", () => {
    expect(windowAroundPoint(5000, 1000, -5, len)).toEqual(windowAroundPoint(5000, 1000, 0, len));
    expect(windowAroundPoint(5000, 1000, 5, len)).toEqual(windowAroundPoint(5000, 1000, 1, len));
  });
});

describe("fullWindow", () => {
  it("is the whole molecule", () => {
    expect(fullWindow(1800)).toEqual({ start: 0, end: 1800 });
  });
});

describe("panWindow", () => {
  const len = 10000;
  it("slides the window right keeping its span", () => {
    expect(panWindow({ start: 100, end: 300 }, 50, len)).toEqual({ start: 150, end: 350 });
  });
  it("clamps at the left edge", () => {
    expect(panWindow({ start: 100, end: 300 }, -500, len)).toEqual({ start: 0, end: 200 });
  });
  it("clamps at the right edge", () => {
    expect(panWindow({ start: 9700, end: 9900 }, 500, len)).toEqual({ start: 9800, end: 10000 });
  });
});

describe("jogScrubToDeltaBp", () => {
  it("maps a full-track drag to JOG_SENSITIVITY * span", () => {
    // Drag the whole 400px track on a 600 bp window -> 0.3 * 600 = 180 bp.
    expect(jogScrubToDeltaBp(400, 400, 600)).toBeCloseTo(JOG_SENSITIVITY * 600);
  });
  it("is FINE: a comfortable drag nudges only a handful of bp at tight zoom", () => {
    // 30px drag on a 400px track at a 60 bp window: 30/400 * 60 * 0.3 ~= 1.35 bp.
    const delta = jogScrubToDeltaBp(30, 400, 60);
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThan(3);
  });
  it("scales with the visible span (consistent feel across zoom)", () => {
    // Same drag fraction -> proportionally larger delta at a wider window.
    const tight = jogScrubToDeltaBp(50, 400, 100);
    const wide = jogScrubToDeltaBp(50, 400, 1000);
    expect(wide / tight).toBeCloseTo(10);
  });
  it("is signed: dragging right returns a positive (forward) delta", () => {
    expect(jogScrubToDeltaBp(40, 400, 600)).toBeGreaterThan(0);
    expect(jogScrubToDeltaBp(-40, 400, 600)).toBeLessThan(0);
  });
  it("is far finer than a navigator-box drag of the same fraction", () => {
    // The navigator maps a drag fraction ~1:1 to a molecule fraction. The jog
    // moves only JOG_SENSITIVITY of the WINDOW span for that same fraction.
    const fullTrackPx = 400;
    const winSpan = 600;
    const jogDelta = jogScrubToDeltaBp(fullTrackPx, fullTrackPx, winSpan);
    expect(jogDelta).toBeLessThan(winSpan); // never even a full window per drag
    expect(jogDelta).toBeCloseTo(JOG_SENSITIVITY * winSpan);
  });
  it("guards a zero/invalid track width", () => {
    expect(Number.isFinite(jogScrubToDeltaBp(10, 0, 100))).toBe(true);
  });
});

describe("resizeWindowEdge", () => {
  const len = 10000;
  it("moves the start edge keeping the end fixed", () => {
    expect(resizeWindowEdge({ start: 4000, end: 6000 }, "start", 4500, len)).toEqual({
      start: 4500,
      end: 6000,
    });
  });
  it("moves the end edge keeping the start fixed", () => {
    expect(resizeWindowEdge({ start: 4000, end: 6000 }, "end", 5500, len)).toEqual({
      start: 4000,
      end: 5500,
    });
  });
  it("enforces the MIN_WINDOW_BP floor on start drag", () => {
    const w = resizeWindowEdge({ start: 4000, end: 6000 }, "start", 5990, len);
    expect(w.end - w.start).toBe(MIN_WINDOW_BP);
    expect(w.end).toBe(6000);
  });
  it("enforces the MIN_WINDOW_BP floor on end drag", () => {
    const w = resizeWindowEdge({ start: 4000, end: 6000 }, "end", 4010, len);
    expect(w.end - w.start).toBe(MIN_WINDOW_BP);
    expect(w.start).toBe(4000);
  });
  it("clamps to molecule bounds", () => {
    expect(resizeWindowEdge({ start: 4000, end: 6000 }, "end", 99999, len).end).toBe(len);
    expect(resizeWindowEdge({ start: 4000, end: 6000 }, "start", -50, len).start).toBe(0);
  });
});

describe("spanOverlapsWindow / clipSpanToWindow", () => {
  it("detects overlap including touching endpoints", () => {
    expect(spanOverlapsWindow(100, 200, 150, 250)).toBe(true);
    expect(spanOverlapsWindow(100, 150, 150, 250)).toBe(true);
    expect(spanOverlapsWindow(100, 149, 150, 250)).toBe(false);
    expect(spanOverlapsWindow(300, 400, 150, 250)).toBe(false);
  });
  it("clips a straddling span to the window edges", () => {
    expect(clipSpanToWindow(100, 300, 150, 250)).toEqual({ lo: 150, hi: 250 });
    expect(clipSpanToWindow(180, 220, 150, 250)).toEqual({ lo: 180, hi: 220 });
  });
  it("returns null when fully outside", () => {
    expect(clipSpanToWindow(0, 50, 150, 250)).toBeNull();
  });
});

describe("rulerStepForSpan", () => {
  it("gives finer ticks for a small visible span", () => {
    // a 200 bp window targets 25/interval -> snaps to 50
    expect(rulerStepForSpan(200)).toBe(50);
  });
  it("gives coarse ticks for the whole molecule", () => {
    expect(rulerStepForSpan(60000)).toBe(10000);
  });
  it("never returns below 1", () => {
    expect(rulerStepForSpan(60)).toBeGreaterThanOrEqual(1);
    expect(rulerStepForSpan(8)).toBeGreaterThanOrEqual(1);
  });
});
