// Coverage for the needs-raw message on a summary table (subcol UI chunk 3).
//
// When a summary-format Column table runs a test that needs raw replicates (a
// paired / rank-based / correlation / regression test), the result sheet shows a
// calm, specific "switch to Replicates" message rather than a broken or empty
// result. A summary-compatible test (unpaired t-test) still renders its result.

import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import ResultsSheet from "./ResultsSheet";
import { buildSummaryColumnTable } from "@/lib/datahub/summary-table";
import type { AnalysisSpec, DataHubDocContent } from "@/lib/datahub/model/types";

afterEach(() => cleanup());

function summaryContent(): DataHubDocContent {
  const built = buildSummaryColumnTable(
    [
      { datasetId: "g1", name: "Control", mean: 5, spread: 0.8, n: 6 },
      { datasetId: "g2", name: "Treated", mean: 8, spread: 1.1, n: 6 },
    ],
    "mean-sd-n",
  );
  return {
    meta: {
      id: "1",
      name: "Summary",
      project_ids: [],
      folder_path: null,
      table_type: "column",
      entryFormat: "mean-sd-n",
      created_at: "2026-06-11T00:00:00Z",
    },
    columns: built.columns,
    rows: built.rows,
    analyses: [],
    plots: [],
  };
}

function spec(type: string): AnalysisSpec {
  return {
    id: "a1",
    type,
    params: {},
    inputs: { columnIds: ["g1", "g2"] },
    resultCache: null,
    resultStale: true,
  };
}

describe("ResultsSheet needs-raw on a summary table", () => {
  it("shows the switch-to-Replicates message for a paired test", () => {
    render(
      <ResultsSheet
        spec={spec("pairedTTest")}
        content={summaryContent()}
        title="Paired t-test"
      />,
    );
    expect(screen.getByTestId("results-needs-raw")).toBeTruthy();
    expect(
      screen.getByText(/needs raw replicate values/i),
    ).toBeTruthy();
  });

  it("renders the result for a summary-compatible test (unpaired t)", () => {
    render(
      <ResultsSheet
        spec={spec("unpairedTTest")}
        content={summaryContent()}
        title="Unpaired t-test"
      />,
    );
    // The unpaired t runs from summary stats, so no needs-raw notice; the
    // tabular result table renders instead.
    expect(screen.queryByTestId("results-needs-raw")).toBeNull();
    expect(screen.getByTestId("results-ttest-table")).toBeTruthy();
  });
});
