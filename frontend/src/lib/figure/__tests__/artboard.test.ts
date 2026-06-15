import { describe, it, expect } from "vitest";
import {
  PAPER_PRESETS,
  DEFAULT_ARTBOARD_STATE,
  CUSTOM_PAPER_ID,
  getPreset,
  readArtboardState,
  pageDims,
  pageScale,
  placeFigureCentered,
  inToCm,
  cmToIn,
  pxAtDpi,
  fitFeedback,
  fitFigureToPage,
  rulerTicks,
  artboardExportSvg,
  artboardInitial,
  loadArtboardPrefs,
  type ArtboardState,
} from "../artboard";

const base = (over: Partial<ArtboardState> = {}): ArtboardState => ({
  ...DEFAULT_ARTBOARD_STATE,
  ...over,
});

describe("presets + state reading", () => {
  it("default state is disabled so an old figure renders unchanged", () => {
    expect(DEFAULT_ARTBOARD_STATE.enabled).toBe(false);
  });

  it("getPreset resolves known ids and returns undefined for custom", () => {
    expect(getPreset("letter")?.wIn).toBe(8.5);
    expect(getPreset("journal-1col")?.wIn).toBe(3.5);
    expect(getPreset(CUSTOM_PAPER_ID)).toBeUndefined();
  });

  it("every preset has positive portrait dimensions", () => {
    for (const p of PAPER_PRESETS) {
      expect(p.wIn).toBeGreaterThan(0);
      expect(p.hIn).toBeGreaterThan(0);
    }
  });

  it("readArtboardState fills defaults for missing / malformed input", () => {
    expect(readArtboardState(undefined)).toEqual(DEFAULT_ARTBOARD_STATE);
    expect(readArtboardState({ enabled: true, paperId: "a4", orientation: "landscape" }))
      .toMatchObject({ enabled: true, paperId: "a4", orientation: "landscape" });
    // garbage orientation falls back to portrait
    expect(readArtboardState({ orientation: "sideways" }).orientation).toBe("portrait");
  });
});

describe("artboardInitial + prefs", () => {
  it("reads a figure's own stored artboard when present (authoritative)", () => {
    expect(artboardInitial({ enabled: true, paperId: "a4" })).toMatchObject({
      enabled: true,
      paperId: "a4",
    });
  });
  it("falls back to the disabled default for a fresh figure (no storage in node)", () => {
    // No window in the node test env, so prefs are empty and the default wins.
    expect(artboardInitial(undefined)).toEqual(DEFAULT_ARTBOARD_STATE);
    expect(loadArtboardPrefs()).toEqual({});
  });
});

describe("page geometry", () => {
  it("portrait keeps W x H, landscape swaps to wider-than-tall", () => {
    expect(pageDims(base({ paperId: "letter" }))).toEqual({ wIn: 8.5, hIn: 11 });
    expect(pageDims(base({ paperId: "letter", orientation: "landscape" }))).toEqual({
      wIn: 11,
      hIn: 8.5,
    });
  });

  it("custom uses the custom dims and falls back when missing", () => {
    expect(
      pageDims(base({ paperId: CUSTOM_PAPER_ID, customWIn: 4, customHIn: 3 })),
    ).toEqual({ wIn: 4, hIn: 3 });
    // no custom dims -> a sane fallback, never NaN
    const fb = pageDims(base({ paperId: CUSTOM_PAPER_ID }));
    expect(fb.wIn).toBeGreaterThan(0);
    expect(fb.hIn).toBeGreaterThan(0);
  });

  it("pageScale fits the longest edge into the stage box", () => {
    // Letter portrait, 11 in tall, into a 360px stage -> ~32.7 px/in
    expect(pageScale({ wIn: 8.5, hIn: 11 }, 360)).toBeCloseTo(360 / 11, 6);
  });

  it("placeFigureCentered centers and clamps offsets at zero", () => {
    expect(placeFigureCentered({ wIn: 8.5, hIn: 11 }, 3.5, 2.5)).toEqual({
      figWIn: 3.5,
      figHIn: 2.5,
      leftIn: 2.5,
      topIn: 4.25,
    });
    // figure larger than page -> offsets clamp to 0, not negative
    const p = placeFigureCentered({ wIn: 3, hIn: 3 }, 5, 5);
    expect(p.leftIn).toBe(0);
    expect(p.topIn).toBe(0);
  });
});

describe("conversions", () => {
  it("in <-> cm round-trips", () => {
    expect(inToCm(1)).toBeCloseTo(2.54, 6);
    expect(cmToIn(2.54)).toBeCloseTo(1, 6);
  });
  it("pxAtDpi multiplies inches by dpi and rounds", () => {
    expect(pxAtDpi(3.5, 300)).toBe(1050);
    expect(pxAtDpi(2.5, 300)).toBe(750);
  });
});

describe("fit feedback", () => {
  const page = { wIn: 8.5, hIn: 11 };
  it("flags overflow when either dimension exceeds the page", () => {
    expect(fitFeedback(page, 9, 2).verdict).toBe("overflow"); // too wide
    expect(fitFeedback(page, 4, 12).verdict).toBe("overflow"); // too tall
  });
  it("flags room when narrow and good in the middle band", () => {
    expect(fitFeedback(page, 3, 2).verdict).toBe("room"); // < 55% width
    expect(fitFeedback(page, 6, 4).verdict).toBe("good"); // ~70% width, fits
  });
});

describe("fitFigureToPage", () => {
  it("width-constrains a wide figure within the margin", () => {
    // page 8.5 wide, 0.5 margin each side -> 7.5 avail width; aspect 2 -> 3.75 tall
    const r = fitFigureToPage({ wIn: 8.5, hIn: 11 }, 2);
    expect(r.figWIn).toBeCloseTo(7.5, 6);
    expect(r.figHIn).toBeCloseTo(3.75, 6);
  });
  it("height-caps a tall figure that would overflow", () => {
    // available height 3 (4-1 margins); tall aspect 0.5 -> height-cap to 3, width 1.5
    const r = fitFigureToPage({ wIn: 8, hIn: 4 }, 0.5);
    expect(r.figHIn).toBeCloseTo(3, 6);
    expect(r.figWIn).toBeCloseTo(1.5, 6);
  });
});

describe("rulerTicks", () => {
  it("inch ticks land on each whole inch", () => {
    const t = rulerTicks(3.4, "in");
    expect(t.map((x) => x.label)).toEqual(["0", "1", "2", "3"]);
    expect(t.every((x) => x.major)).toBe(true);
  });
  it("cm ticks land on each cm with majors every 5", () => {
    const t = rulerTicks(cmToIn(6), "cm"); // ~6 cm
    expect(t.map((x) => x.label)).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
    expect(t.find((x) => x.label === "5")?.major).toBe(true);
    expect(t.find((x) => x.label === "3")?.major).toBe(false);
  });
});

describe("artboardExportSvg", () => {
  // A minimal figure SVG shaped like the real renderers (root width/height first,
  // then a separate viewBox), so the rewrite contract is exercised.
  const figureSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="430" height="340" viewBox="0 0 430 340"><rect width="430" height="340" fill="#fff"/></svg>';

  it("figure mode sets the root to true inches and keeps the viewBox", () => {
    const out = artboardExportSvg({
      figureSvg,
      figWIn: 3.5,
      figHIn: 2.5,
      mode: "figure",
    });
    expect(out).toContain('width="3.5in"');
    expect(out).toContain('height="2.5in"');
    expect(out).toContain('viewBox="0 0 430 340"'); // untouched
  });

  it("page mode wraps an inch-sized sheet with the figure nested + positioned", () => {
    const page = { wIn: 8.5, hIn: 11 };
    const placement = placeFigureCentered(page, 3.5, 2.5);
    const out = artboardExportSvg({
      figureSvg,
      figWIn: 3.5,
      figHIn: 2.5,
      mode: "page",
      page,
      placement,
    });
    // outer sheet carries physical inches + an inch user-space viewBox
    expect(out).toMatch(/^<svg[^>]*width="8.5in"[^>]*height="11in"/);
    expect(out).toContain('viewBox="0 0 8.5 11"');
    // white sheet behind
    expect(out).toContain('<rect x="0" y="0" width="8.5" height="11" fill="#ffffff"/>');
    // figure nested at the centered position, sized to the placement box (inch units)
    expect(out).toContain('x="2.5"');
    expect(out).toContain('y="4.25"');
    // the inner figure's own viewBox still scales its content
    expect(out).toContain('viewBox="0 0 430 340"');
  });

  it("page mode can omit the white sheet", () => {
    const page = { wIn: 6, hIn: 6 };
    const placement = placeFigureCentered(page, 4, 4);
    const out = artboardExportSvg({
      figureSvg,
      figWIn: 4,
      figHIn: 4,
      mode: "page",
      page,
      placement,
      includeSheet: false,
    });
    expect(out).not.toContain("fill=\"#ffffff\"");
  });
});
