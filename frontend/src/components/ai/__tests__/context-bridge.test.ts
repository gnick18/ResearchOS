// Pins for the BeakerBot context bridge (ai context-layer0 bot, 2026-06-11).
//
// describeBeakerContext is pure, so all cases run with zero side effects and
// no folder. The store setters/getters are tested for round-trip correctness.
// The panel injection and the page publisher are covered here at the pure
// function level; the integration (BeakerBotPanel + DataHubPage wiring) is
// verified by the broader panel test and manual smoke tests.

import { describe, expect, it, afterEach } from "vitest";
import {
  setBeakerContext,
  getBeakerContext,
  describeBeakerContext,
  type BeakerContext,
} from "../context-bridge";

// Reset the module-level store between cases so tests are independent.
afterEach(() => {
  setBeakerContext(null);
});

// ---------------------------------------------------------------------------
// Module-level store
// ---------------------------------------------------------------------------

describe("setBeakerContext / getBeakerContext", () => {
  it("round-trips a context through the store", () => {
    const ctx: BeakerContext = {
      route: "/datahub",
      pageLabel: "Data Hub",
      selection: { type: "datahub-table", id: "t1", name: "fakeGFP qPCR" },
    };
    setBeakerContext(ctx);
    expect(getBeakerContext()).toEqual(ctx);
  });

  it("returns null after clearing", () => {
    setBeakerContext({ route: "/datahub" });
    setBeakerContext(null);
    expect(getBeakerContext()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// describeBeakerContext (PURE)
// ---------------------------------------------------------------------------

describe("describeBeakerContext", () => {
  it("returns null when context is null", () => {
    expect(describeBeakerContext(null)).toBeNull();
  });

  it("returns null for a route-only context (no selection, not useful)", () => {
    expect(
      describeBeakerContext({ route: "/datahub", pageLabel: "Data Hub" }),
    ).toBeNull();
  });

  it("describes a selected table with its id", () => {
    const ctx: BeakerContext = {
      route: "/datahub",
      pageLabel: "Data Hub",
      selection: { type: "datahub-table", id: "table-123", name: "fakeGFP qPCR" },
    };
    const desc = describeBeakerContext(ctx);
    expect(desc).not.toBeNull();
    expect(desc).toContain("Data Hub");
    expect(desc).toContain("fakeGFP qPCR");
    expect(desc).toContain("table-123");
    // The model should not see a blank type label.
    expect(desc).toContain("table");
  });

  it("describes a selected analysis with id and parent table", () => {
    const ctx: BeakerContext = {
      route: "/datahub",
      pageLabel: "Data Hub",
      selection: {
        type: "datahub-analysis",
        id: "analysis-1718000000000",
        name: "Unpaired t-test",
        parent: { type: "datahub-table", id: "table-abc", name: "fakeGFP qPCR" },
      },
    };
    const desc = describeBeakerContext(ctx);
    expect(desc).not.toBeNull();
    // The model must be able to see both the analysis id and the parent table name.
    expect(desc).toContain("analysis-1718000000000");
    expect(desc).toContain("Unpaired t-test");
    expect(desc).toContain("fakeGFP qPCR");
    // The description must tell the model to use the id directly.
    expect(desc).toContain("analysis-1718000000000");
    expect(desc).toMatch(/use its id/i);
  });

  it("describes a selected note (non-datahub selection)", () => {
    const ctx: BeakerContext = {
      route: "/notes",
      pageLabel: "Notes",
      selection: { type: "note", id: "note-99", name: "qPCR optimisation round 3" },
    };
    const desc = describeBeakerContext(ctx);
    expect(desc).not.toBeNull();
    expect(desc).toContain("Notes");
    expect(desc).toContain("note-99");
    expect(desc).toContain("qPCR optimisation round 3");
  });

  it("includes a resolution hint so the model does not ask when unambiguous", () => {
    const ctx: BeakerContext = {
      route: "/datahub",
      pageLabel: "Data Hub",
      selection: {
        type: "datahub-analysis",
        id: "analysis-42",
        name: "One-way ANOVA",
        parent: { type: "datahub-table", id: "t-5", name: "Growth curve" },
      },
    };
    const desc = describeBeakerContext(ctx);
    // The hint tells the model to resolve "this" to the selection and use its id.
    expect(desc).toMatch(/they most likely mean/i);
    expect(desc).toContain("analysis-42");
  });

  it("does not contain em-dashes, emojis, or mid-sentence colons in its output", () => {
    const ctx: BeakerContext = {
      route: "/datahub",
      pageLabel: "Data Hub",
      selection: {
        type: "datahub-analysis",
        id: "analysis-1",
        name: "t-test",
        parent: { type: "datahub-table", id: "t-1", name: "My Table" },
      },
    };
    const desc = describeBeakerContext(ctx) ?? "";
    expect(desc).not.toContain("—"); // em-dash
    expect(desc).not.toContain("–"); // en-dash
    // No emoji characters (basic range check).
    expect(/[\u{1F300}-\u{1FFFF}]/u.test(desc)).toBe(false);
  });
});
