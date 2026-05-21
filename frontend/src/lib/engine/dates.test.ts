import { describe, it, expect } from "vitest";
import {
  resolveWeekend,
  isWeekendActiveForTask,
  computeEndDate,
  computeStartDateFromEnd,
  addBusinessDays,
  subtractBusinessDays,
  isProjectSkipDate,
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

// ---- PTO-aware extension (Streak Phase S4, proposal §6.6 / L9) ----
//
// These tests pin the L9 backward-compat invariant: when ptoDates is
// empty or omitted, every helper returns the exact pre-S4 result.
// When ptoDates contains a weekday, that weekday is skipped just like
// Sat/Sun whenever weekendActive is false.

describe("isProjectSkipDate", () => {
  it("weekendActive=true never skips, even on a weekend OR PTO date", () => {
    const sat = new Date(2026, 1, 14); // Sat
    expect(isProjectSkipDate(sat, true, ["2026-02-14"])).toBe(false);
  });

  it("weekendActive=false skips Sat/Sun", () => {
    expect(isProjectSkipDate(new Date(2026, 1, 14), false)).toBe(true); // Sat
    expect(isProjectSkipDate(new Date(2026, 1, 15), false)).toBe(true); // Sun
  });

  it("weekendActive=false skips weekday PTO", () => {
    expect(
      isProjectSkipDate(new Date(2026, 1, 11), false, ["2026-02-11"]),
    ).toBe(true); // Wed
  });

  it("weekendActive=false does NOT skip non-PTO weekdays", () => {
    expect(
      isProjectSkipDate(new Date(2026, 1, 12), false, ["2026-02-11"]),
    ).toBe(false); // Thu
  });
});

describe("resolveWeekend with PTO", () => {
  it("empty ptoDates reproduces pre-S4 behavior", () => {
    const sat = new Date(2026, 1, 14);
    expect(resolveWeekend(sat, false, [])).toEqual(new Date(2026, 1, 16));
    expect(resolveWeekend(sat, false)).toEqual(new Date(2026, 1, 16));
  });

  it("weekday PTO is pushed forward to the next non-skip day", () => {
    // Wed Feb 11 is PTO → expect Thu Feb 12.
    const wed = new Date(2026, 1, 11);
    expect(resolveWeekend(wed, false, ["2026-02-11"])).toEqual(
      new Date(2026, 1, 12),
    );
  });

  it("PTO on Monday after a weekend resolves to Tuesday (no infinite loop)", () => {
    // Sat → Mon via nextMonday, but Mon is PTO → step forward to Tue.
    const sat = new Date(2026, 1, 14); // Sat
    const next = resolveWeekend(sat, false, ["2026-02-16"]);
    expect(next).toEqual(new Date(2026, 1, 17)); // Tue
  });

  it("weekendActive=true bypasses PTO entirely", () => {
    const wed = new Date(2026, 1, 11);
    expect(resolveWeekend(wed, true, ["2026-02-11"])).toEqual(wed);
  });
});

describe("computeEndDate with PTO", () => {
  it("empty ptoDates reproduces pre-S4 behavior", () => {
    const mon = new Date(2026, 1, 9);
    expect(computeEndDate(mon, 5, false, [])).toEqual(new Date(2026, 1, 13));
    expect(computeEndDate(mon, 5, false)).toEqual(new Date(2026, 1, 13));
  });

  it("3-day task with PTO Wednesday extends past the PTO day", () => {
    // Mon-Tue-Wed normally; with Wed Feb 11 as PTO: Mon-Tue-Thu (end Thu).
    const mon = new Date(2026, 1, 9);
    expect(computeEndDate(mon, 3, false, ["2026-02-11"])).toEqual(
      new Date(2026, 1, 12),
    );
  });

  it("weekendActive=true ignores PTO entirely (calendar-day arithmetic)", () => {
    const mon = new Date(2026, 1, 9);
    expect(computeEndDate(mon, 3, true, ["2026-02-11"])).toEqual(
      new Date(2026, 1, 11),
    );
  });
});

describe("computeStartDateFromEnd with PTO", () => {
  it("empty ptoDates reproduces pre-S4 behavior", () => {
    const fri = new Date(2026, 1, 13);
    expect(computeStartDateFromEnd(fri, 5, false, [])).toEqual(
      new Date(2026, 1, 9),
    );
  });

  it("PTO weekday is skipped in the backward walk", () => {
    // 3 business days ending Thu Feb 12 with Wed Feb 11 PTO: Mon-Tue-Thu.
    const thu = new Date(2026, 1, 12);
    expect(computeStartDateFromEnd(thu, 3, false, ["2026-02-11"])).toEqual(
      new Date(2026, 1, 9),
    );
  });
});

describe("addBusinessDays / subtractBusinessDays with PTO", () => {
  it("addBusinessDays empty PTO = pre-S4", () => {
    const mon = new Date(2026, 1, 9);
    expect(addBusinessDays(mon, 5, false, [])).toEqual(new Date(2026, 1, 16));
  });

  it("addBusinessDays steps over a PTO weekday", () => {
    // From Mon Feb 9, add 1 business day with Tue Feb 10 PTO → Wed Feb 11.
    const mon = new Date(2026, 1, 9);
    expect(addBusinessDays(mon, 1, false, ["2026-02-10"])).toEqual(
      new Date(2026, 1, 11),
    );
  });

  it("subtractBusinessDays steps over a PTO weekday", () => {
    // From Fri Feb 13, sub 1 business day with Thu Feb 12 PTO → Wed Feb 11.
    const fri = new Date(2026, 1, 13);
    expect(subtractBusinessDays(fri, 1, false, ["2026-02-12"])).toEqual(
      new Date(2026, 1, 11),
    );
  });

  it("weekendActive=true bypasses PTO", () => {
    const mon = new Date(2026, 1, 9);
    expect(addBusinessDays(mon, 5, true, ["2026-02-10", "2026-02-11"])).toEqual(
      new Date(2026, 1, 14),
    );
  });
});
