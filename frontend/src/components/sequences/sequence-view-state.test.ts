// sequence Phase 2c bot — view-control filtering logic.

import { describe, it, expect } from "vitest";
import {
  DEFAULT_VIEW_STATE,
  isFeatureVisible,
  typeKey,
  featureKey,
  type SequenceViewState,
} from "./sequence-view-state";

const f = (over: Partial<Parameters<typeof isFeatureVisible>[1]> = {}) => ({
  name: "g",
  type: "CDS",
  start: 0,
  end: 10,
  strand: 1,
  ...over,
});

describe("calm default", () => {
  it("shows features + ruler, hides heavier layers by default", () => {
    expect(DEFAULT_VIEW_STATE.showFeatures).toBe(true);
    expect(DEFAULT_VIEW_STATE.showIndex).toBe(true);
    expect(DEFAULT_VIEW_STATE.showEnzymes).toBe(false);
    expect(DEFAULT_VIEW_STATE.showTranslation).toBe(false);
    expect(DEFAULT_VIEW_STATE.showOrfs).toBe(false);
    expect(DEFAULT_VIEW_STATE.showComplement).toBe(false);
    // primer style bot — primers now draw via the dedicated primers layer (not
    // the annotation layer), so they default VISIBLE to avoid disappearing.
    expect(DEFAULT_VIEW_STATE.showPrimers).toBe(true);
    expect(DEFAULT_VIEW_STATE.forceLinear).toBe(false);
  });
});

describe("isFeatureVisible", () => {
  it("shows features by default", () => {
    expect(isFeatureVisible(DEFAULT_VIEW_STATE, f())).toBe(true);
  });
  it("hides all features when the master switch is off", () => {
    const v: SequenceViewState = { ...DEFAULT_VIEW_STATE, showFeatures: false };
    expect(isFeatureVisible(v, f())).toBe(false);
  });
  it("hides a feature whose type is hidden (case-insensitive)", () => {
    const v: SequenceViewState = { ...DEFAULT_VIEW_STATE, hiddenTypes: { cds: true } };
    expect(isFeatureVisible(v, f({ type: "CDS" }))).toBe(false);
    expect(isFeatureVisible(v, f({ type: "promoter" }))).toBe(true);
  });
  it("hides an individually-hidden feature", () => {
    const target = f({ name: "secret" });
    const v: SequenceViewState = {
      ...DEFAULT_VIEW_STATE,
      hiddenFeatures: { [featureKey(target)]: true },
    };
    expect(isFeatureVisible(v, target)).toBe(false);
    expect(isFeatureVisible(v, f({ name: "other" }))).toBe(true);
  });
});

describe("keys", () => {
  it("typeKey normalizes blank/undefined to misc_feature", () => {
    expect(typeKey(undefined)).toBe("misc_feature");
    expect(typeKey("  CDS ")).toBe("cds");
  });
  it("featureKey is stable for identical features", () => {
    expect(featureKey(f())).toBe(featureKey(f()));
  });
});
