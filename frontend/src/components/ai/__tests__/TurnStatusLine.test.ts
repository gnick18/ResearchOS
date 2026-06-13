// TurnStatusLine unit tests (BeakerAI lane manager, 2026-06-13).
//
// Pins the pure formatting helpers and the phaseWord heuristic. No DOM or
// React rendering needed for these: they are plain functions importable from
// TurnStatusLine.tsx.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { formatElapsed, formatTokens, phaseWord } from "../TurnStatusLine";

describe("formatElapsed", () => {
  it("shows 0 seconds as '0s'", () => {
    expect(formatElapsed(0)).toBe("0s");
  });

  it("shows sub-minute durations in seconds only", () => {
    expect(formatElapsed(1000)).toBe("1s");
    expect(formatElapsed(8000)).toBe("8s");
    expect(formatElapsed(59000)).toBe("59s");
  });

  it("shows exactly one minute as '1m 0s'", () => {
    expect(formatElapsed(60000)).toBe("1m 0s");
  });

  it("shows minutes and remaining seconds", () => {
    expect(formatElapsed(134000)).toBe("2m 14s");
    expect(formatElapsed(966000)).toBe("16m 6s");
  });

  it("truncates sub-second precision (does not round up)", () => {
    // 1500ms -> 1s, not 2s
    expect(formatElapsed(1500)).toBe("1s");
    // 61999ms -> 1m 1s, not 1m 2s
    expect(formatElapsed(61999)).toBe("1m 1s");
  });
});

describe("formatTokens", () => {
  it("shows 0 as '0'", () => {
    expect(formatTokens(0)).toBe("0");
  });

  it("shows negative as '0'", () => {
    expect(formatTokens(-5)).toBe("0");
  });

  it("shows sub-1000 counts as raw numbers", () => {
    expect(formatTokens(1)).toBe("1");
    expect(formatTokens(999)).toBe("999");
  });

  it("formats thousands with one decimal place and 'k' suffix", () => {
    expect(formatTokens(1000)).toBe("1.0k");
    expect(formatTokens(12400)).toBe("12.4k");
    expect(formatTokens(48300)).toBe("48.3k");
    expect(formatTokens(182700)).toBe("182.7k");
  });

  it("rounds to one decimal", () => {
    // 1050 -> 1.1k (rounds 1.05 to 1.1 per JS toFixed semantics)
    expect(formatTokens(1050)).toBe("1.1k");
  });
});

describe("phaseWord", () => {
  it("returns 'starting' when no tool steps have been dispatched yet", () => {
    expect(phaseWord(0, 0, null)).toBe("starting");
    expect(phaseWord(0, 0, "Thinking")).toBe("starting");
  });

  it("returns 'working' when a tool is running and few steps done", () => {
    expect(phaseWord(1, 1, "Checking your tasks")).toBe("working");
    expect(phaseWord(1, 2, "Working on it")).toBe("working");
  });

  it("returns 'almost done' when three or more steps dispatched", () => {
    expect(phaseWord(1, 3, "Running the analysis")).toBe("almost done");
    expect(phaseWord(0, 4, null)).toBe("almost done");
  });

  it("returns 'wrapping up' when no tool is running but steps exist (thinking after tools)", () => {
    expect(phaseWord(0, 2, "Thinking")).toBe("wrapping up");
  });

  it("returns 'waiting' when the status label contains Waiting", () => {
    expect(phaseWord(0, 1, "Waiting for your go-ahead")).toBe("waiting");
    expect(phaseWord(1, 2, "Waiting for your choice")).toBe("waiting");
    expect(phaseWord(0, 0, "Waiting for your review")).toBe("waiting");
  });
});
