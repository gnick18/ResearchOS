// change-params bot. Tests for the ResultsSheet "Test options" panel.
//
// The contract here.
//   - A t-test result shows a "Test options" toolbar button; toggling it reveals
//     the parameters panel with the schema controls (Tail seg, Variance seg).
//   - Clicking a control fires onParamChange with the schema key + chosen value.
//   - An analysis type with no editable options (linear regression) hides the
//     affordance entirely rather than opening an empty panel.
//   - When onParamChange is not provided the affordance is hidden (read-only).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ResultsSheet from "../ResultsSheet";
import type {
  AnalysisSpec,
  DataHubDocContent,
  DataHubDocument,
} from "@/lib/datahub/model/types";

afterEach(() => cleanup());

const COLUMN_META: DataHubDocument = {
  id: "demo",
  name: "Assay",
  project_ids: [],
  folder_path: null,
  table_type: "column",
  created_at: "2026-06-10T00:00:00.000Z",
};

const CONTROL = [98, 102, 95, 105, 100, 99];
const DRUG_A = [78, 82, 75, 80, 85, 79];

function columnContent(): DataHubDocContent {
  const cols = [
    { id: "col-1", name: "Control" },
    { id: "col-2", name: "Drug A" },
  ];
  const series = [CONTROL, DRUG_A];
  const rows = Array.from({ length: 6 }, (_, r) => ({
    id: `row-${r + 1}`,
    cells: {
      "col-1": series[0][r],
      "col-2": series[1][r],
    } as Record<string, number>,
  }));
  return {
    meta: COLUMN_META,
    columns: cols.map((c) => ({
      id: c.id,
      name: c.name,
      role: "y" as const,
      dataType: "number" as const,
    })),
    rows,
    analyses: [],
    plots: [],
  };
}

function ttestSpec(params: Record<string, unknown> = {}): AnalysisSpec {
  return {
    id: "a1",
    type: "unpairedTTest",
    params,
    inputs: { columnIds: ["col-1", "col-2"] },
    resultCache: null,
    resultStale: false,
  };
}

describe("ResultsSheet test-options panel", () => {
  it("reveals the schema controls and fires onParamChange on a click", () => {
    const onParamChange = vi.fn();
    render(
      <ResultsSheet
        spec={ttestSpec()}
        content={columnContent()}
        title="Control vs Drug A"
        onParamChange={onParamChange}
      />,
    );

    // The panel is hidden until the toolbar button is pressed.
    expect(screen.queryByTestId("results-params-panel")).toBeNull();

    fireEvent.click(screen.getByTestId("datahub-results-params"));

    // The unpaired t-test exposes Tail + Variance.
    expect(screen.getByTestId("results-params-panel")).toBeTruthy();
    expect(screen.getByTestId("results-param-tail")).toBeTruthy();
    expect(screen.getByTestId("results-param-variance")).toBeTruthy();

    // Picking Student (pooled) variance fires the change with the schema value.
    fireEvent.click(screen.getByRole("button", { name: "Student (pooled)" }));
    expect(onParamChange).toHaveBeenCalledWith("variance", "student");

    // Picking a one-sided tail fires the tail change.
    fireEvent.click(screen.getByRole("button", { name: "One-sided (greater)" }));
    expect(onParamChange).toHaveBeenCalledWith("tail", "greater");
  });

  it("reflects the stored value as the active control", () => {
    render(
      <ResultsSheet
        spec={ttestSpec({ variance: "student" })}
        content={columnContent()}
        title="Control vs Drug A"
        onParamChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("datahub-results-params"));
    const studentBtn = screen.getByRole("button", { name: "Student (pooled)" });
    expect(studentBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("hides the affordance for an analysis with no editable options", () => {
    // Regression takes no engine options, so there is nothing to edit.
    const regSpec: AnalysisSpec = {
      id: "a2",
      type: "linearRegression",
      params: {},
      inputs: { columnIds: ["col-y"] },
      resultCache: null,
      resultStale: false,
    };
    const xyContent: DataHubDocContent = {
      meta: { ...COLUMN_META, table_type: "xy" },
      columns: [
        { id: "col-x", name: "Dose", role: "x", dataType: "number" },
        { id: "col-y", name: "Response", role: "y", dataType: "number" },
      ],
      rows: [
        { id: "r1", cells: { "col-x": 1, "col-y": 2 } },
        { id: "r2", cells: { "col-x": 2, "col-y": 4 } },
        { id: "r3", cells: { "col-x": 3, "col-y": 6 } },
      ],
      analyses: [],
      plots: [],
    };
    render(
      <ResultsSheet
        spec={regSpec}
        content={xyContent}
        title="Dose response"
        onParamChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("datahub-results-params")).toBeNull();
  });

  it("hides the affordance entirely when onParamChange is absent", () => {
    render(
      <ResultsSheet
        spec={ttestSpec()}
        content={columnContent()}
        title="Control vs Drug A"
      />,
    );
    expect(screen.queryByTestId("datahub-results-params")).toBeNull();
  });
});
