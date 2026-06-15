import { describe, it, expect } from "vitest";
import {
  withAnalysisPickerUi,
  analysisPickerFromResult,
  capabilitiesToFacts,
  type AnalysisPickerPayload,
} from "@/lib/ai/analysis-picker";
import type { TableCapabilities } from "@/lib/datahub/table-capabilities";

const caps: TableCapabilities = {
  analyses: [
    { id: "unpairedTTest", kind: "analysis", label: "Unpaired t-test", hint: "two groups" },
  ],
  graphs: [{ id: "columnBar", kind: "graph", label: "Bar chart", hint: "means" }],
};

const payload: AnalysisPickerPayload = {
  widget: "analysisPicker",
  tableId: "t1",
  tableName: "qPCR",
  capabilities: caps,
};

describe("analysis-picker seam", () => {
  it("attaches and reads back the payload under _ui", () => {
    const result = withAnalysisPickerUi({ ok: true }, payload);
    expect(analysisPickerFromResult(result)).toEqual(payload);
  });

  it("does not claim a result without the payload", () => {
    expect(analysisPickerFromResult({ ok: true })).toBeNull();
    expect(analysisPickerFromResult(null)).toBeNull();
    expect(
      analysisPickerFromResult({ _ui: { widget: "overlayWizard" } }),
    ).toBeNull();
  });

  it("does not claim a malformed payload (no tableId / no capabilities)", () => {
    expect(
      analysisPickerFromResult({ _ui: { widget: "analysisPicker" } }),
    ).toBeNull();
  });

  it("capabilitiesToFacts is a lean label view", () => {
    const facts = capabilitiesToFacts(caps);
    expect(facts.analyses).toEqual([
      { id: "unpairedTTest", kind: "analysis", label: "Unpaired t-test", hint: "two groups" },
    ]);
    expect(facts.graphs[0].label).toBe("Bar chart");
  });
});
