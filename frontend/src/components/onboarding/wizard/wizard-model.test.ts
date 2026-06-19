// Unit tests for the pure wizard navigation reducer and progress math.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, expect, it } from "vitest";
import {
  initWizardNav,
  wizardNavReducer,
  wizardProgress,
} from "./wizard-model";

const reduce = wizardNavReducer;

describe("wizardNavReducer", () => {
  it("starts at index 0, not done, not closed", () => {
    const s = initWizardNav();
    expect(s).toEqual({ index: 0, done: false, closed: false });
  });

  it("next advances the index", () => {
    let s = initWizardNav();
    s = reduce(s, { type: "next" }, 4);
    expect(s.index).toBe(1);
    s = reduce(s, { type: "next" }, 4);
    expect(s.index).toBe(2);
  });

  it("skip advances like next", () => {
    let s = initWizardNav();
    s = reduce(s, { type: "skip" }, 4);
    expect(s.index).toBe(1);
  });

  it("next from the last step finishes (done=true)", () => {
    let s = { index: 3, done: false, closed: false };
    s = reduce(s, { type: "next" }, 4);
    expect(s.done).toBe(true);
    expect(s.index).toBe(3);
  });

  it("skip from the last step also finishes", () => {
    let s = { index: 0, done: false, closed: false };
    s = reduce(s, { type: "skip" }, 1);
    expect(s.done).toBe(true);
  });

  it("back decrements the index", () => {
    let s = { index: 2, done: false, closed: false };
    s = reduce(s, { type: "back" }, 4);
    expect(s.index).toBe(1);
  });

  it("back is clamped at the first step", () => {
    let s = initWizardNav();
    s = reduce(s, { type: "back" }, 4);
    expect(s.index).toBe(0);
  });

  it("close sets closed=true", () => {
    let s = initWizardNav();
    s = reduce(s, { type: "close" }, 4);
    expect(s.closed).toBe(true);
  });

  it("goto clamps into range", () => {
    const s = initWizardNav();
    expect(reduce(s, { type: "goto", index: 99 }, 4).index).toBe(3);
    expect(reduce(s, { type: "goto", index: -5 }, 4).index).toBe(0);
    expect(reduce(s, { type: "goto", index: 2 }, 4).index).toBe(2);
  });

  it("is terminal once done (ignores further actions)", () => {
    const done = { index: 3, done: true, closed: false };
    expect(reduce(done, { type: "next" }, 4)).toBe(done);
    expect(reduce(done, { type: "back" }, 4)).toBe(done);
    expect(reduce(done, { type: "close" }, 4)).toBe(done);
  });

  it("is terminal once closed", () => {
    const closed = { index: 1, done: false, closed: true };
    expect(reduce(closed, { type: "next" }, 4)).toBe(closed);
    expect(reduce(closed, { type: "back" }, 4)).toBe(closed);
  });

  it("a double next from the last step cannot over-advance", () => {
    let s = { index: 0, done: false, closed: false };
    s = reduce(s, { type: "next" }, 1);
    const after = reduce(s, { type: "next" }, 1);
    expect(after.done).toBe(true);
    expect(after.index).toBe(0);
  });
});

describe("wizardProgress", () => {
  it("returns a 1-based current and shows the counter for multi-step", () => {
    expect(wizardProgress(0, 4)).toEqual({
      current: 1,
      total: 4,
      showCounter: true,
    });
    expect(wizardProgress(2, 4)).toEqual({
      current: 3,
      total: 4,
      showCounter: true,
    });
  });

  it("hides the counter for a single-step track", () => {
    expect(wizardProgress(0, 1)).toEqual({
      current: 1,
      total: 1,
      showCounter: false,
    });
  });

  it("clamps an out-of-range index", () => {
    expect(wizardProgress(9, 4).current).toBe(4);
    expect(wizardProgress(-2, 4).current).toBe(1);
  });

  it("never reports a total below 1", () => {
    expect(wizardProgress(0, 0).total).toBe(1);
  });
});
