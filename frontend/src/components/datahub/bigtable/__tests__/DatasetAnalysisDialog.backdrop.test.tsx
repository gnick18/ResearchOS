// Regression: the dataset-lane Analyze dialog must not discard a computed
// result to a stray backdrop click. Live testing saw the dialog close during a
// "Run another" transition when a viewport reflow displaced a click onto the
// full-screen backdrop, throwing away the analysis. The contract:
//   - From the clean chooser (no result, not running), a backdrop click closes.
//   - Once a result is showing, a backdrop click is ignored (work is protected);
//     only the explicit Cancel / Done / Save / Escape controls close.

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import DatasetAnalysisDialog from "../DatasetAnalysisDialog";
import type { DatasetSidecar } from "@/lib/datahub/bigtable/types";

// Stub the validated-engine seam so the dialog can run without DuckDB / WASM.
// `unpairedTTest` is a real analysis id so the live TYPE_META lookup (label /
// blurb / groupCount="two") resolves — the chooser drives a two-column picker.
vi.mock("@/lib/datahub/bigtable/dataset-analyses", () => ({
  runAnalysisOnDataset: vi.fn(async () => ({ ok: true })),
  buildDatasetAnalysisContent: vi.fn(async () => ({
    spec: {
      id: "s",
      type: "unpairedTTest",
      params: {},
      inputs: { columnIds: [] },
      resultCache: null,
      resultStale: false,
    },
    content: {},
  })),
  validDatasetAnalysisTypes: () => ({ wide: ["unpairedTTest"], groupBy: [] }),
  analysisIsXY: () => false,
  analysisIsWholeTableMultiCol: () => false,
}));
vi.mock("@/lib/datahub/bigtable/dataset-columns", () => ({
  readDistinctLabels: vi.fn(async () => []),
}));
vi.mock("@/lib/datahub/bigtable/dataset-store", () => ({
  saveDatasetAnalysis: vi.fn(async () => null),
}));
// ResultsSheet pulls in the whole results renderer; a stub is enough to assert
// the dialog is in its result state.
vi.mock("@/components/datahub/ResultsSheet", () => ({
  default: () => <div data-testid="results-stub" />,
}));

afterEach(() => cleanup());

const SIDECAR = {
  id: "ds-1",
  name: "Big assay",
  schema: [
    { name: "Control", type: "number" },
    { name: "Drug A", type: "number" },
  ],
  colCount: 2,
  recipe: {},
} as unknown as DatasetSidecar;

function renderDialog() {
  const onClose = vi.fn();
  render(
    <DatasetAnalysisDialog
      open
      owner="me"
      sidecar={SIDECAR}
      handle={{} as never}
      onClose={onClose}
    />,
  );
  const backdrop = document.querySelector(".bg-black\\/40") as HTMLElement;
  return { onClose, backdrop };
}

describe("DatasetAnalysisDialog backdrop dismiss", () => {
  it("closes on a backdrop click from the clean chooser", () => {
    const { onClose, backdrop } = renderDialog();
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores a backdrop click once a result is showing", async () => {
    const { onClose, backdrop } = renderDialog();

    // Drive the chooser to a runnable state: pick the test, then two distinct
    // numeric columns (the run button is gated by canRun until both are set).
    fireEvent.click(screen.getByText("Unpaired t-test"));
    const selects = document.querySelectorAll("select");
    expect(selects.length).toBe(2);
    fireEvent.change(selects[0], { target: { value: "Control" } });
    fireEvent.change(selects[1], { target: { value: "Drug A" } });

    fireEvent.click(screen.getByTestId("dataset-analysis-run"));
    await waitFor(() => screen.getByTestId("results-stub"));

    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });
});
