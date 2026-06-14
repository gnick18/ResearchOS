import { describe, it, expect } from "vitest";

import { mergeMapStyle, featureKey, type SequenceMapStyle } from "@/lib/sequences/figure-style";

describe("featureKey", () => {
  it("is stable from name + start + end", () => {
    expect(featureKey({ name: "AmpR", start: 100, end: 900 })).toBe("AmpR:100:900");
  });
});

describe("mergeMapStyle (canonical base + per-panel override)", () => {
  it("the override scalar wins; the base fills the rest", () => {
    const base: SequenceMapStyle = { featureScale: 1.5, showTicks: false, showLabels: true };
    const over: SequenceMapStyle = { showTicks: true };
    expect(mergeMapStyle(base, over)).toMatchObject({
      featureScale: 1.5,
      showTicks: true,
      showLabels: true,
    });
  });

  it("deep-merges perFeature per key (override field wins, base field kept)", () => {
    const base: SequenceMapStyle = {
      perFeature: { "AmpR:1:9": { color: "#0000ff", hidden: false }, "ori:2:8": { hidden: true } },
    };
    const over: SequenceMapStyle = { perFeature: { "AmpR:1:9": { color: "#ff0000" } } };
    const m = mergeMapStyle(base, over);
    expect(m.perFeature).toEqual({
      "AmpR:1:9": { color: "#ff0000", hidden: false }, // override color wins, base hidden kept
      "ori:2:8": { hidden: true }, // base-only key survives
    });
  });

  it("handles missing inputs", () => {
    expect(mergeMapStyle(undefined, undefined)).toEqual({
      featureScale: undefined,
      showTicks: undefined,
      showLabels: undefined,
      perFeature: undefined,
    });
    expect(mergeMapStyle({ featureScale: 2 }, undefined).featureScale).toBe(2);
  });
});
