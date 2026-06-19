// Model A lab free-trial decision-core tests (Grant 2026-06-19).
//
// The pure heart of the 90-day no-card trial: the phase + the charge/accrue
// decision. These run in the node project (no DOM), so they are the trustworthy
// guard on "no charge during the trial" and "pause, do not silently accrue, at
// day 90 with no card".

import { describe, expect, it } from "vitest";

import {
  labTrialPhase,
  labTrialDecision,
  isTrialPaused,
  trialEndsAtFrom,
} from "../lab-trial";

const NOW = new Date("2026-07-01T00:00:00.000Z");
const FUTURE = new Date("2026-09-29T00:00:00.000Z").toISOString(); // trial open
const PAST = new Date("2026-06-01T00:00:00.000Z").toISOString(); // trial over

describe("labTrialPhase", () => {
  it("is none when no trial is set (solo, dept, pre-trial labs)", () => {
    expect(labTrialPhase({ trialEndsAt: null, hasCard: false }, NOW)).toBe("none");
    expect(labTrialPhase({ trialEndsAt: null, hasCard: true }, NOW)).toBe("none");
  });

  it("is trialing while now is before trial_ends_at", () => {
    expect(labTrialPhase({ trialEndsAt: FUTURE, hasCard: false }, NOW)).toBe("trialing");
    expect(labTrialPhase({ trialEndsAt: FUTURE, hasCard: true }, NOW)).toBe("trialing");
  });

  it("forks at trial end on whether a card is on file", () => {
    expect(labTrialPhase({ trialEndsAt: PAST, hasCard: true }, NOW)).toBe("ended_with_card");
    expect(labTrialPhase({ trialEndsAt: PAST, hasCard: false }, NOW)).toBe("ended_no_card");
  });

  it("treats the exact boundary (now == trial_ends_at) as ended", () => {
    const at = NOW.toISOString();
    expect(labTrialPhase({ trialEndsAt: at, hasCard: false }, NOW)).toBe("ended_no_card");
  });

  it("reads an unparseable trial value as no trial, never suppressing a charge", () => {
    expect(labTrialPhase({ trialEndsAt: "not-a-date", hasCard: true }, NOW)).toBe("none");
  });
});

describe("labTrialDecision", () => {
  it("no trial: charge and accrue (unchanged engine behavior)", () => {
    expect(labTrialDecision({ trialEndsAt: null, hasCard: true }, NOW)).toEqual({
      phase: "none",
      shouldCharge: true,
      shouldAccrue: true,
    });
  });

  it("trialing: accrue (record usage) but NEVER charge the card", () => {
    expect(labTrialDecision({ trialEndsAt: FUTURE, hasCard: true }, NOW)).toEqual({
      phase: "trialing",
      shouldCharge: false,
      shouldAccrue: true,
    });
  });

  it("trial ended with a card: resume normal charging", () => {
    expect(labTrialDecision({ trialEndsAt: PAST, hasCard: true }, NOW)).toEqual({
      phase: "ended_with_card",
      shouldCharge: true,
      shouldAccrue: true,
    });
  });

  it("trial ended with NO card: pause (no new accrual, no charge)", () => {
    expect(labTrialDecision({ trialEndsAt: PAST, hasCard: false }, NOW)).toEqual({
      phase: "ended_no_card",
      shouldCharge: false,
      shouldAccrue: false,
    });
  });
});

describe("isTrialPaused", () => {
  it("is true only for an expired trial with no card", () => {
    expect(isTrialPaused({ trialEndsAt: PAST, hasCard: false }, NOW)).toBe(true);
    expect(isTrialPaused({ trialEndsAt: PAST, hasCard: true }, NOW)).toBe(false);
    expect(isTrialPaused({ trialEndsAt: FUTURE, hasCard: false }, NOW)).toBe(false);
    expect(isTrialPaused({ trialEndsAt: null, hasCard: false }, NOW)).toBe(false);
  });
});

describe("trialEndsAtFrom", () => {
  it("adds the day count to the signup date", () => {
    const start = new Date("2026-06-19T12:00:00.000Z");
    const end = trialEndsAtFrom(start, 90);
    // 90 days after 2026-06-19 is 2026-09-17.
    expect(end.slice(0, 10)).toBe("2026-09-17");
  });

  it("clamps a negative day count to the signup instant (never a past trial)", () => {
    const start = new Date("2026-06-19T12:00:00.000Z");
    expect(trialEndsAtFrom(start, -5).slice(0, 10)).toBe("2026-06-19");
  });
});
