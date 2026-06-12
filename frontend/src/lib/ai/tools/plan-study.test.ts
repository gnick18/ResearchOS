// Unit tests for the BeakerBot plan_study tool (ai plan-study bot, 2026-06-12).
//
// Test strategy: the tool holds NO statistics of its own, it maps args to the
// validated power engine and relays. So we assert it routes each design + mode to
// the right engine call (a known sample-size value matches the engine directly), a
// power answer is a probability in (0, 1), and bad / missing args fail gracefully
// rather than throwing.

import { describe, it, expect } from "vitest";

// Real engine, to assert the tool relays the engine's number unchanged.
import {
  sampleSizeTwoSampleT,
  sampleSizeOneWayAnova,
  cohenFFromEtaSquared,
} from "@/lib/datahub/engine/power";

import { planStudyTool, type PlanStudyResult } from "./plan-study";

const run = (args: Record<string, unknown>) =>
  planStudyTool.execute(args) as Promise<PlanStudyResult>;

describe("plan_study sampleSize mode", () => {
  it("twoSampleT returns exactly the engine sample-size value", async () => {
    const expected = sampleSizeTwoSampleT(0.5, 0.05, 0.8);
    expect(expected).not.toBeNull();
    const res = await run({
      design: "twoSampleT",
      mode: "sampleSize",
      effect: 0.5,
      alpha: 0.05,
      power: 0.8,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result).toBe(expected);
      // A medium effect at 80% power is a textbook ~64 per group; sanity-bound it.
      expect(res.result).toBeGreaterThan(50);
      expect(res.result).toBeLessThan(80);
      expect(Number.isInteger(res.result)).toBe(true);
    }
  });

  it("twoSampleT applies the default alpha and power when omitted", async () => {
    const expected = sampleSizeTwoSampleT(0.5, 0.05, 0.8);
    const res = await run({
      design: "twoSampleT",
      mode: "sampleSize",
      effect: 0.5,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result).toBe(expected);
      expect(res.inputs.alpha).toBe(0.05);
      expect(res.inputs.power).toBe(0.8);
    }
  });

  it("oneWayAnova routes total-N through the engine with k groups", async () => {
    const f = cohenFFromEtaSquared(0.06); // a medium-ish eta-squared
    const expected = sampleSizeOneWayAnova(3, f, 0.05, 0.8);
    expect(expected).not.toBeNull();
    const res = await run({
      design: "oneWayAnova",
      mode: "sampleSize",
      effect: f,
      k: 3,
      alpha: 0.05,
      power: 0.8,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result).toBe(expected);
      expect(res.inputs.k).toBe(3);
    }
  });

  it("accepts string-numeric args (model may pass strings)", async () => {
    const res = await run({
      design: "twoSampleT",
      mode: "sampleSize",
      effect: "0.5",
      alpha: "0.05",
      power: "0.8",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result).toBe(sampleSizeTwoSampleT(0.5, 0.05, 0.8));
    }
  });
});

describe("plan_study power mode", () => {
  it("returns a probability in (0, 1) for twoSampleT", async () => {
    const res = await run({
      design: "twoSampleT",
      mode: "power",
      effect: 0.5,
      n: 30,
      alpha: 0.05,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result).toBeGreaterThan(0);
      expect(res.result).toBeLessThan(1);
      expect(res.result_label).toContain("power");
    }
  });

  it("correlation power is a probability in (0, 1)", async () => {
    const res = await run({
      design: "correlation",
      mode: "power",
      effect: 0.3,
      n: 80,
      alpha: 0.05,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result).toBeGreaterThan(0);
      expect(res.result).toBeLessThan(1);
    }
  });
});

describe("plan_study detectableEffect mode", () => {
  it("returns a positive detectable effect for pairedT", async () => {
    const res = await run({
      design: "pairedT",
      mode: "detectableEffect",
      n: 25,
      alpha: 0.05,
      power: 0.8,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result).toBeGreaterThan(0);
      expect(res.result_label).toContain("dz");
    }
  });
});

describe("plan_study error paths", () => {
  it("rejects an unknown design", async () => {
    const res = await run({ design: "chiSquare", mode: "sampleSize", effect: 0.5 });
    expect(res.ok).toBe(false);
  });

  it("rejects an unknown mode", async () => {
    const res = await run({ design: "twoSampleT", mode: "magic", effect: 0.5 });
    expect(res.ok).toBe(false);
  });

  it("requires an effect for sampleSize mode", async () => {
    const res = await run({ design: "twoSampleT", mode: "sampleSize" });
    expect(res.ok).toBe(false);
  });

  it("requires n for power mode", async () => {
    const res = await run({ design: "twoSampleT", mode: "power", effect: 0.5 });
    expect(res.ok).toBe(false);
  });

  it("requires k for oneWayAnova", async () => {
    const res = await run({
      design: "oneWayAnova",
      mode: "sampleSize",
      effect: 0.25,
    });
    expect(res.ok).toBe(false);
  });

  it("relays the engine's no-finite-N result for a zero effect", async () => {
    const res = await run({
      design: "twoSampleT",
      mode: "sampleSize",
      effect: 0,
    });
    expect(res.ok).toBe(false);
  });

  it("rejects an out-of-range alpha", async () => {
    const res = await run({
      design: "twoSampleT",
      mode: "sampleSize",
      effect: 0.5,
      alpha: 1.5,
    });
    expect(res.ok).toBe(false);
  });
});
