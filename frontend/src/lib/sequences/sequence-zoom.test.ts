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
