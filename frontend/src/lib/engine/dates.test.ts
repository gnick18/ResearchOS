import { describe, it, expect } from "vitest";
import {
  resolveWeekend,
  isWeekendActiveForTask,
  computeEndDate,
  addBusinessDays,
} from "../engine/dates";

describe("resolveWeekend", () => {
  it("weekday unchanged when weekends are off", () => {
    const d = new Date(2026, 1, 9);
    expect(resolveWeekend(d, false)).toEqual(d);
  });

  it("Saturday pushed to Monday when weekends are off", () => {
    const sat = new Date(2026, 1, 14);
    expect(sat.getDay()).toBe(6);
    const result = resolveWeekend(sat, false);
    expect(result).toEqual(new Date(2026, 1, 16));
    expect(result.getDay()).toBe(1);
  });

  it("Sunday pushed to Monday when weekends are off", () => {
    const sun = new Date(2026, 1, 15);
    expect(sun.getDay()).toBe(0);
    const result = resolveWeekend(sun, false);
    expect(result).toEqual(new Date(2026, 1, 16));
  });

  it("Saturday unchanged when weekends are active", () => {
    const sat = new Date(2026, 1, 14);
    expect(resolveWeekend(sat, true)).toEqual(sat);
  });

  it("Sunday unchanged when weekends are active", () => {
    const sun = new Date(2026, 1, 15);
    expect(resolveWeekend(sun, true)).toEqual(sun);
  });

  it("Friday unchanged regardless of weekend setting", () => {
    const fri = new Date(2026, 1, 13);
    expect(resolveWeekend(fri, false)).toEqual(fri);
    expect(resolveWeekend(fri, true)).toEqual(fri);
  });
});

describe("isWeekendActiveForTask", () => {
  it("override true", () => {
    expect(isWeekendActiveForTask(true, false)).toBe(true);
  });

  it("override false", () => {
    expect(isWeekendActiveForTask(false, true)).toBe(false);
  });

  it("override null falls back to project true", () => {
    expect(isWeekendActiveForTask(null, true)).toBe(true);
  });

  it("override null falls back to project false", () => {
    expect(isWeekendActiveForTask(null, false)).toBe(false);
  });

  it("override undefined falls back to project true", () => {
    expect(isWeekendActiveForTask(undefined, true)).toBe(true);
  });

  it("override undefined falls back to project false", () => {
    expect(isWeekendActiveForTask(undefined, false)).toBe(false);
  });
});

describe("computeEndDate", () => {
  it("1-day task starts and ends on the same day", () => {
    const mon = new Date(2026, 1, 9);
    expect(computeEndDate(mon, 1, true)).toEqual(mon);
    expect(computeEndDate(mon, 1, false)).toEqual(mon);
  });

  it("5-day task with weekends active: Mon to Fri (calendar days)", () => {
    const mon = new Date(2026, 1, 9);
    expect(computeEndDate(mon, 5, true)).toEqual(new Date(2026, 1, 13));
  });

  it("5-day task with weekends off: Mon to Fri (skipping Sat/Sun)", () => {
    const mon = new Date(2026, 1, 9);
    const result = computeEndDate(mon, 5, false);
    expect(result).toEqual(new Date(2026, 1, 13));
  });

  it("7 business days starting Monday ends next Tuesday", () => {
    const mon = new Date(2026, 1, 9);
    const result = computeEndDate(mon, 7, false);
    expect(result).toEqual(new Date(2026, 1, 17));
  });

  it("7 calendar days starting Monday ends Sunday", () => {
    const mon = new Date(2026, 1, 9);
    const result = computeEndDate(mon, 7, true);
    expect(result).toEqual(new Date(2026, 1, 15));
  });

  it("10 business days = 2 full weeks Mon-Fri", () => {
    const mon = new Date(2026, 1, 9);
    const result = computeEndDate(mon, 10, false);
    expect(result).toEqual(new Date(2026, 1, 20));
  });

  it("invalid duration raises error", () => {
    const mon = new Date(2026, 1, 9);
    expect(() => computeEndDate(mon, 0, true)).toThrow();
    expect(() => computeEndDate(mon, -1, false)).toThrow();
  });

  it("start on Wednesday, 3 business days ends Friday", () => {
    const wed = new Date(2026, 1, 11);
    const result = computeEndDate(wed, 3, false);
    expect(result).toEqual(new Date(2026, 1, 13));
  });

  it("start on Thursday, 3 business days ends Monday (skips weekend)", () => {
    const thu = new Date(2026, 1, 12);
    const result = computeEndDate(thu, 3, false);
    expect(result).toEqual(new Date(2026, 1, 16));
  });
});

describe("addBusinessDays", () => {
  it("zero days returns same date", () => {
    const mon = new Date(2026, 1, 9);
    expect(addBusinessDays(mon, 0, false)).toEqual(mon);
  });

  it("add one business day from Friday returns Monday", () => {
    const fri = new Date(2026, 1, 13);
    const result = addBusinessDays(fri, 1, false);
    expect(result).toEqual(new Date(2026, 1, 16));
  });

  it("add 5 business days from Monday returns next Monday", () => {
    const mon = new Date(2026, 1, 9);
    const result = addBusinessDays(mon, 5, false);
    expect(result).toEqual(new Date(2026, 1, 16));
  });

  it("with weekends active, just add calendar days", () => {
    const mon = new Date(2026, 1, 9);
    const result = addBusinessDays(mon, 5, true);
    expect(result).toEqual(new Date(2026, 1, 14));
  });
});
