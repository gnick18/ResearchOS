// BeakerBot workflow macros, pure-helper unit tests (BeakerAI lane, 2026-06-13).
//
// Covers the pure data helpers in beaker-macros-store. The disk-touching helpers
// reuse the same JsonStore as beaker-chats-store (exercised through the
// conversation-store thread tests with the FSA layer mocked), so here we only
// pin the pure logic, the /token slug, uniqueness, step capture, the frozen-date
// detection, and dangling-step detection.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import {
  slugifyMacroName,
  ensureUniqueMacroName,
  captureMacroSteps,
  looksDateLike,
  stepHasFixedDate,
  findDanglingSteps,
  MACRO_NOISE_TOOLS,
  type MacroStep,
  type CapturedInvocation,
} from "../beaker-macros-store";

describe("slugifyMacroName", () => {
  it("lowercases and hyphenates a human label", () => {
    expect(slugifyMacroName("Monday rollup")).toBe("monday-rollup");
  });

  it("collapses punctuation runs to a single hyphen and trims edges", () => {
    expect(slugifyMacroName("  QC batch!! (v2) ")).toBe("qc-batch-v2");
  });

  it("caps length and never leaves a trailing hyphen", () => {
    const slug = slugifyMacroName("a".repeat(60));
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("falls back to 'macro' when nothing usable remains", () => {
    expect(slugifyMacroName("!!!")).toBe("macro");
    expect(slugifyMacroName("   ")).toBe("macro");
  });
});

describe("ensureUniqueMacroName", () => {
  it("returns the desired name when it is free", () => {
    expect(ensureUniqueMacroName("monday-rollup", ["qc-batch"])).toBe(
      "monday-rollup",
    );
  });

  it("appends a numeric suffix on collision, case-insensitively", () => {
    expect(
      ensureUniqueMacroName("monday-rollup", ["Monday-Rollup"]),
    ).toBe("monday-rollup-2");
  });

  it("skips past several taken suffixes", () => {
    expect(
      ensureUniqueMacroName("dig", ["dig", "dig-2", "dig-3"]),
    ).toBe("dig-4");
  });
});

describe("captureMacroSteps", () => {
  const invocations: CapturedInvocation[] = [
    { tool: "go_to_page", args: { path: "/data" }, label: "Open Data Hub" },
    {
      tool: "lab_digest",
      args: { range: "this week" },
      label: "Lab digest for this week",
    },
    { tool: "read_page", args: {}, label: "Read the page" },
    {
      tool: "write_note",
      args: { title: "Weekly summary" },
      label: "Draft a summary note",
    },
  ];

  it("drops navigation and read noise, keeping the meaningful steps in order", () => {
    const steps = captureMacroSteps(invocations);
    expect(steps.map((s) => s.tool)).toEqual(["lab_digest", "write_note"]);
  });

  it("carries args verbatim and trims labels, enabling each step", () => {
    const steps = captureMacroSteps([
      { tool: "lab_digest", args: { range: "this week" }, label: "  Digest  " },
    ]);
    expect(steps[0]).toEqual({
      tool: "lab_digest",
      args: { range: "this week" },
      label: "Digest",
      enabled: true,
    });
  });

  it("treats propose_plan as noise (the plan tool is not a replayable step)", () => {
    expect(MACRO_NOISE_TOOLS.has("propose_plan")).toBe(true);
    const steps = captureMacroSteps([
      { tool: "propose_plan", args: { steps: ["a", "b"] }, label: "Plan" },
    ]);
    expect(steps).toEqual([]);
  });
});

describe("looksDateLike / stepHasFixedDate", () => {
  it("flags an ISO date string", () => {
    expect(looksDateLike("2026-06-13")).toBe(true);
    expect(looksDateLike("2026-06-13T08:00:00Z")).toBe(true);
  });

  it("does not flag a relative phrase", () => {
    expect(looksDateLike("this week")).toBe(false);
    expect(looksDateLike("last_month")).toBe(false);
  });

  it("looks one level into a range object", () => {
    expect(looksDateLike({ start: "2026-06-08", end: "2026-06-13" })).toBe(true);
    expect(looksDateLike({ range: "this week" })).toBe(false);
  });

  it("marks a step whose args froze a date", () => {
    const frozen: MacroStep = {
      tool: "lab_digest",
      args: { start: "2026-06-08", end: "2026-06-13" },
      label: "Digest",
    };
    const relative: MacroStep = {
      tool: "lab_digest",
      args: { range: "this week" },
      label: "Digest",
    };
    expect(stepHasFixedDate(frozen)).toBe(true);
    expect(stepHasFixedDate(relative)).toBe(false);
  });
});

describe("findDanglingSteps", () => {
  it("returns steps whose tool is no longer registered", () => {
    const known = new Set(["lab_digest", "write_note"]);
    const macro = {
      steps: [
        { tool: "lab_digest", args: {}, label: "Digest" },
        { tool: "old_renamed_tool", args: {}, label: "Legacy step" },
        { tool: "write_note", args: {}, label: "Note" },
      ] as MacroStep[],
    };
    const dangling = findDanglingSteps(macro, known);
    expect(dangling.map((s) => s.tool)).toEqual(["old_renamed_tool"]);
  });

  it("returns nothing when every tool is known", () => {
    const known = new Set(["lab_digest"]);
    const macro = { steps: [{ tool: "lab_digest", args: {}, label: "D" }] as MacroStep[] };
    expect(findDanglingSteps(macro, known)).toEqual([]);
  });
});
