// frontend/src/lib/beakerbot/__tests__/entry-lines.test.ts
//
// Unit tests for buildEntryGreetingLines (Tier A) and buildReturningLines
// (Tier B) in entry-lines.ts. Pure functions, no DOM, no side-effects.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { describe, expect, it } from "vitest";

import {
  buildEntryGreetingLines,
  buildReturningLines,
  type UserStatsSummary,
} from "../entry-lines";

// ─── TIER A: buildEntryGreetingLines ─────────────────────────────────────────

describe("buildEntryGreetingLines", () => {
  it("opens with Good morning for hours before noon", () => {
    const lines = buildEntryGreetingLines({ hour: 8 });
    expect(lines[0]).toBe("Good morning.");
  });

  it("opens with Good afternoon for hours 12 to 17", () => {
    const lines = buildEntryGreetingLines({ hour: 14 });
    expect(lines[0]).toBe("Good afternoon.");
  });

  it("opens with Good evening for hours 18 and above", () => {
    const lines = buildEntryGreetingLines({ hour: 20 });
    expect(lines[0]).toBe("Good evening.");
  });

  it("boundary hour 12 resolves to Good afternoon not Good morning", () => {
    expect(buildEntryGreetingLines({ hour: 12 })[0]).toBe("Good afternoon.");
  });

  it("boundary hour 18 resolves to Good evening not Good afternoon", () => {
    expect(buildEntryGreetingLines({ hour: 18 })[0]).toBe("Good evening.");
  });

  it("boundary hour 0 resolves to Good morning", () => {
    expect(buildEntryGreetingLines({ hour: 0 })[0]).toBe("Good morning.");
  });

  it("includes Welcome back when returning is true", () => {
    const lines = buildEntryGreetingLines({ hour: 9, returning: true });
    expect(lines).toContain("Welcome back.");
  });

  it("does not include Welcome back when returning is false", () => {
    const lines = buildEntryGreetingLines({ hour: 9, returning: false });
    expect(lines).not.toContain("Welcome back.");
  });

  it("includes Hi there when returning is false", () => {
    const lines = buildEntryGreetingLines({ hour: 9, returning: false });
    expect(lines).toContain("Hi there.");
  });

  it("includes the value and invitation lines regardless of time", () => {
    const lines = buildEntryGreetingLines({ hour: 10 });
    expect(lines).toContain("Your lab, your data, your machine.");
    expect(lines).toContain("Ready when you are.");
  });

  it("includes one playful warmth line", () => {
    const lines = buildEntryGreetingLines({ hour: 10 });
    expect(lines).toContain("I kept the beakers warm for you.");
  });

  it("stays a tight, non-redundant set (no carousel of near-duplicates)", () => {
    const lines = buildEntryGreetingLines({ hour: 10, returning: true });
    // Curated down on purpose. Guard against the old redundant lines and a
    // ballooning count so the bubble stays sparse and special.
    expect(lines.length).toBeLessThanOrEqual(5);
    expect(lines).not.toContain("Everything stays on your own disk.");
    expect(lines).not.toContain("Pick a folder and we will dive right in.");
    expect(lines).not.toContain("Good to see you.");
    expect(lines).not.toContain("I have been bubbling away while you were gone.");
  });

  it("greeting line is always first", () => {
    const morning = buildEntryGreetingLines({ hour: 6 });
    expect(morning[0]).toBe("Good morning.");

    const evening = buildEntryGreetingLines({ hour: 21 });
    expect(evening[0]).toBe("Good evening.");
  });

  it("returns more than one line", () => {
    const lines = buildEntryGreetingLines({ hour: 10 });
    expect(lines.length).toBeGreaterThan(1);
  });

  it("contains no numbers (Tier A is number-free)", () => {
    const lines = buildEntryGreetingLines({ hour: 10, returning: true });
    const hasNumber = lines.some((l) => /\d/.test(l));
    expect(hasNumber).toBe(false);
  });
});

// ─── TIER B: buildReturningLines ─────────────────────────────────────────────

/** Convenience base: a now timestamp. */
const NOW = 1_718_000_000_000; // a fixed point in time

/** A full, populated stats object. */
const fullStats: UserStatsSummary = {
  updatedAt: NOW - 86_400_000,
  experiments: 4,
  notes: 1250,
  projects: 3,
  tasks: 7,
  checkinsThisMonth: 5,
  wordsLastWeek: 3400,
  streakDays: 12,
  experimentsLast6Months: 18,
  lastActivityAt: NOW - 2 * 86_400_000, // 2 days ago
};

describe("buildReturningLines", () => {
  it("opens with a time-of-day greeting when no name is provided", () => {
    const lines = buildReturningLines({
      hour: 9,
      stats: null,
      now: NOW,
    });
    expect(lines[0]).toBe("Good morning.");
  });

  it("incorporates the name into the greeting when provided", () => {
    const lines = buildReturningLines({
      name: "Alice",
      hour: 9,
      stats: null,
      now: NOW,
    });
    expect(lines[0]).toBe("Good morning, Alice.");
  });

  it("uses Good afternoon in the greeting for afternoon hours", () => {
    const lines = buildReturningLines({
      name: "Bob",
      hour: 15,
      stats: null,
      now: NOW,
    });
    expect(lines[0]).toBe("Good afternoon, Bob.");
  });

  it("uses Good evening in the greeting for evening hours", () => {
    const lines = buildReturningLines({
      name: "Carol",
      hour: 20,
      stats: null,
      now: NOW,
    });
    expect(lines[0]).toBe("Good evening, Carol.");
  });

  it("falls back gracefully when stats is null", () => {
    const lines = buildReturningLines({ hour: 10, stats: null, now: NOW });
    expect(lines).toContain("Good to have you back.");
    expect(lines.length).toBeGreaterThan(0);
  });

  it("produces the days-since line when lastActivityAt is set and >= 1 day ago", () => {
    const lines = buildReturningLines({
      hour: 10,
      stats: { ...fullStats },
      now: NOW,
    });
    // lastActivityAt is 2 days ago
    expect(lines).toContain("It has been 2 days. Good to see you.");
  });

  it("uses singular day wording when exactly 1 day has passed", () => {
    const stats: UserStatsSummary = {
      ...fullStats,
      lastActivityAt: NOW - 86_400_000,
    };
    const lines = buildReturningLines({ hour: 10, stats, now: NOW });
    expect(lines).toContain("It has been 1 day. Good to see you.");
  });

  it("omits the days-since line when last activity was less than 1 day ago", () => {
    const stats: UserStatsSummary = {
      ...fullStats,
      lastActivityAt: NOW - 3600_000, // 1 hour ago
    };
    const lines = buildReturningLines({ hour: 10, stats, now: NOW });
    const hasDaysLine = lines.some((l) => l.startsWith("It has been"));
    expect(hasDaysLine).toBe(false);
  });

  it("omits the days-since line when lastActivityAt is absent", () => {
    const stats: UserStatsSummary = { updatedAt: NOW };
    const lines = buildReturningLines({ hour: 10, stats, now: NOW });
    const hasDaysLine = lines.some((l) => l.startsWith("It has been"));
    expect(hasDaysLine).toBe(false);
  });

  it("includes the experiments line when experiments > 0", () => {
    const lines = buildReturningLines({ hour: 10, stats: fullStats, now: NOW });
    expect(lines).toContain("You have 4 experiments going.");
  });

  it("includes the experimentsLast6Months line when present and > 0", () => {
    const lines = buildReturningLines({ hour: 10, stats: fullStats, now: NOW });
    expect(lines).toContain(
      "You started 18 experiments in the last 6 months.",
    );
  });

  it("includes the notes line formatted with thousands separator", () => {
    const lines = buildReturningLines({ hour: 10, stats: fullStats, now: NOW });
    expect(lines).toContain("1,250 notes and counting.");
  });

  it("includes the projects line when projects > 0", () => {
    const lines = buildReturningLines({ hour: 10, stats: fullStats, now: NOW });
    expect(lines).toContain("3 projects on the bench.");
  });

  it("includes the wordsLastWeek line when present and > 0", () => {
    const lines = buildReturningLines({ hour: 10, stats: fullStats, now: NOW });
    expect(lines).toContain("You wrote about 3,400 words last week.");
  });

  it("includes the checkinsThisMonth line when present and > 0", () => {
    const lines = buildReturningLines({ hour: 10, stats: fullStats, now: NOW });
    expect(lines).toContain("5 check-ins this month.");
  });

  it("includes the streakDays line when present and > 0", () => {
    const lines = buildReturningLines({ hour: 10, stats: fullStats, now: NOW });
    expect(lines).toContain("12-day writing streak. Nice.");
  });

  it("skips the experiments line when experiments is 0", () => {
    const stats: UserStatsSummary = { ...fullStats, experiments: 0 };
    const lines = buildReturningLines({ hour: 10, stats, now: NOW });
    const hasExperiments = lines.some((l) => l.includes("experiments going"));
    expect(hasExperiments).toBe(false);
  });

  it("skips the notes line when notes is 0", () => {
    const stats: UserStatsSummary = { ...fullStats, notes: 0 };
    const lines = buildReturningLines({ hour: 10, stats, now: NOW });
    const hasNotes = lines.some((l) => l.includes("notes and counting"));
    expect(hasNotes).toBe(false);
  });

  it("skips the streakDays line when streakDays is 0", () => {
    const stats: UserStatsSummary = { ...fullStats, streakDays: 0 };
    const lines = buildReturningLines({ hour: 10, stats, now: NOW });
    const hasStreak = lines.some((l) => l.includes("writing streak"));
    expect(hasStreak).toBe(false);
  });

  it("skips all stat lines when every field is absent", () => {
    const stats: UserStatsSummary = { updatedAt: NOW };
    const lines = buildReturningLines({ hour: 10, stats, now: NOW });
    // Falls back to warm line
    expect(lines).toContain("Good to have you back.");
  });

  it("falls back to the warm line when all present stats are exactly 0", () => {
    const stats: UserStatsSummary = {
      updatedAt: NOW,
      experiments: 0,
      notes: 0,
      projects: 0,
    };
    const lines = buildReturningLines({ hour: 10, stats, now: NOW });
    expect(lines).toContain("Good to have you back.");
  });

  it("greeting is always the first line", () => {
    const lines = buildReturningLines({
      name: "Dana",
      hour: 14,
      stats: fullStats,
      now: NOW,
    });
    expect(lines[0]).toBe("Good afternoon, Dana.");
  });

  it("formats large numbers with commas", () => {
    const stats: UserStatsSummary = {
      updatedAt: NOW,
      notes: 12500,
      wordsLastWeek: 8200,
    };
    const lines = buildReturningLines({ hour: 9, stats, now: NOW });
    expect(lines).toContain("12,500 notes and counting.");
    expect(lines).toContain("You wrote about 8,200 words last week.");
  });
});
