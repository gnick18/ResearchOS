// thinking-status tests (BeakerAI manager, 2026-06-12).
//
// Pins the pure status-line mapping. A few known tool phases map to the expected
// friendly strings, an unknown tool falls back to "Working on it", and the
// awaiting-approval phase maps to the right wait copy. Pure, runs in node-env
// (.test.ts), no DOM.

import { describe, expect, it } from "vitest";
import { statusLabel } from "./thinking-status";
import type { LoopStatus } from "@/lib/ai/agent-loop";

describe("statusLabel", () => {
  it("maps the thinking phase to Thinking", () => {
    expect(statusLabel({ phase: "thinking" })).toBe("Thinking");
  });

  it("maps known tools to their friendly phrases", () => {
    const cases: Array<[string, string]> = [
      ["search_my_work", "Searching your work"],
      ["run_datahub_analysis", "Running the analysis"],
      ["make_datahub_graph", "Making the figure"],
      ["wrangle_table", "Wrangling the data"],
      ["transform_table", "Wrangling the data"],
      ["write_note", "Writing it up"],
      ["fetch_sequence", "Fetching from NCBI"],
      ["assemble_gibson", "Planning the assembly"],
      ["design_primers", "Designing primers"],
      ["search_pubchem", "Looking up PubChem"],
      ["create_experiment_chain", "Setting up the experiments"],
    ];
    for (const [toolName, expected] of cases) {
      const status: LoopStatus = { phase: "tool", toolName };
      expect(statusLabel(status)).toBe(expected);
    }
  });

  it("falls back to Working on it for an unknown tool", () => {
    const status: LoopStatus = { phase: "tool", toolName: "totally_new_tool" };
    expect(statusLabel(status)).toBe("Working on it");
  });

  it("maps awaiting-approval to the right wait copy", () => {
    expect(
      statusLabel({ phase: "awaiting-approval", toolName: "click_element" }),
    ).toBe("Waiting for your go-ahead");
    expect(
      statusLabel({ phase: "awaiting-approval", toolName: "ask_user" }),
    ).toBe("Waiting for your choice");
    expect(
      statusLabel({ phase: "awaiting-approval", toolName: "write_note" }),
    ).toBe("Waiting for your review");
  });
});
