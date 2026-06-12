// Coverage for the Column-table grid's two render modes (subcol UI chunk 2).
//
// In replicates mode the grid shows the replicate rows + the live mean / SD /
// SEM / n footer (the existing behavior). In a summary entry format it shows the
// compact summary editor instead (per-group Mean / spread / N cells, labeled per
// format), with no replicate rows and no footer. A cell edit calls back up.

import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import DataTableGrid from "./DataTableGrid";
import { buildSummaryColumnTable } from "@/lib/datahub/summary-table";
import type { DataHubDocContent } from "@/lib/datahub/model/types";

afterEach(() => cleanup());

function replicatesContent(): DataHubDocContent {
  return {
    meta: {
      id: "1",
      name: "Reps",
      project_ids: [],
      folder_path: null,
      table_type: "column",
      created_at: "2026-06-11T00:00:00Z",
    },
    columns: [
      { id: "col-1", name: "Control", role: "y", dataType: "number" },
      { id: "col-2", name: "Treated", role: "y", dataType: "number" },
    ],
    rows: [
      { id: "row-1", cells: { "col-1": 2, "col-2": 10 } },
      { id: "row-2", cells: { "col-1": 4, "col-2": 12 } },
    ],
    analyses: [],
    plots: [],
  };
}

function summaryContent(
  format: "mean-sd-n" | "mean-sem-n" = "mean-sd-n",
): DataHubDocContent {
  const built = buildSummaryColumnTable(
    [
      { datasetId: "g1", name: "Control", mean: 5.2, spread: 0.4, n: 6 },
      { datasetId: "g2", name: "Treated", mean: 6.1, spread: 0.5, n: 5 },
    ],
    format,
  );
  return {
    meta: {
      id: "2",
      name: "Summary",
      project_ids: [],
      folder_path: null,
      table_type: "column",
      entryFormat: format,
      created_at: "2026-06-11T00:00:00Z",
    },
    columns: built.columns,
    rows: built.rows,
    analyses: [],
    plots: [],
  };
}

describe("DataTableGrid replicates mode", () => {
  it("renders replicate rows and the live footer", () => {
    render(
      <DataTableGrid
        content={replicatesContent()}
        onCellCommit={() => {}}
        onAddRow={() => {}}
        onAddColumn={() => {}}
      />,
    );
    // The footer mean row is present (replicates path), the summary editor is not.
    expect(screen.getByTestId("datahub-footer-mean")).toBeTruthy();
    expect(screen.queryByTestId("datahub-summary-mean")).toBeNull();
    // A replicate cell is editable.
    expect(
      screen.getByLabelText("Control replicate 1"),
    ).toBeTruthy();
  });
});

describe("DataTableGrid summary mode", () => {
  it("renders the Mean / SD / N editor and no replicate footer", () => {
    render(
      <DataTableGrid
        content={summaryContent("mean-sd-n")}
        onCellCommit={() => {}}
        onAddRow={() => {}}
        onAddColumn={() => {}}
      />,
    );
    // The three summary stat rows render; the replicate footer does not.
    expect(screen.getByTestId("datahub-summary-mean")).toBeTruthy();
    expect(screen.getByTestId("datahub-summary-sd")).toBeTruthy();
    expect(screen.getByTestId("datahub-summary-n")).toBeTruthy();
    expect(screen.queryByTestId("datahub-footer-mean")).toBeNull();
    // Each group's Mean cell carries the entered value.
    const ctrlMean = screen.getByLabelText("Control Mean") as HTMLInputElement;
    expect(ctrlMean.value).toBe("5.2");
    const treatedN = screen.getByLabelText("Treated N") as HTMLInputElement;
    expect(treatedN.value).toBe("5");
  });

  it("labels the spread row SEM for a mean-sem-n table", () => {
    render(
      <DataTableGrid
        content={summaryContent("mean-sem-n")}
        onCellCommit={() => {}}
        onAddRow={() => {}}
        onAddColumn={() => {}}
      />,
    );
    expect(screen.getByTestId("datahub-summary-sem")).toBeTruthy();
    expect(screen.queryByTestId("datahub-summary-sd")).toBeNull();
    expect(screen.getByLabelText("Control SEM")).toBeTruthy();
  });

  it("commits a summary cell edit through onCellCommit", () => {
    const onCellCommit = vi.fn();
    render(
      <DataTableGrid
        content={summaryContent("mean-sd-n")}
        onCellCommit={onCellCommit}
        onAddRow={() => {}}
        onAddColumn={() => {}}
      />,
    );
    const cell = screen.getByLabelText("Control Mean") as HTMLInputElement;
    fireEvent.change(cell, { target: { value: "9.9" } });
    fireEvent.blur(cell);
    // Wired to the single summary row id and the group's mean subcolumn id.
    expect(onCellCommit).toHaveBeenCalledWith("row-1", "g1-mean", "9.9");
  });
});
