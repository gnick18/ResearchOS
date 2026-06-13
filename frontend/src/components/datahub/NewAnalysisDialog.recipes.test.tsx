/**
 * NewAnalysisDialog.recipes.test.tsx
 *
 * Coverage for the saved-recipe touch points of the New analysis dialog:
 *   - the picker FILTERS by table type, so a recipe saved on a Column table does
 *     not show when the open table is an XY table,
 *   - applying a recipe submits an analysis carrying the recipe's analysisType
 *     AND its params (the params round-trip end to end through onSubmit).
 *
 * The recipes store and the BeakerBot bridge are mocked at the module seam so
 * the test exercises the real filter + apply logic without disk or a provider.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type {
  AnalysisRecipe,
} from "@/lib/datahub/recipes-store";
import type { DataHubDocContent, DataHubTableType } from "@/lib/datahub/model/types";

// Mocked recipe table the store returns. Mutated per test.
let storeRecipes: AnalysisRecipe[] = [];

vi.mock("@/lib/datahub/recipes-store", () => ({
  recipesApi: {
    list: vi.fn(async () => storeRecipes),
    create: vi.fn(async () => ({}) as AnalysisRecipe),
    rename: vi.fn(async () => null),
    remove: vi.fn(async () => true),
  },
}));

vi.mock("@/components/beaker-search/BeakerSearchProvider", () => ({
  useBeakerSearch: () => ({ openBeakerBot: vi.fn() }),
}));

vi.mock("@/components/ai/message-bridge", () => ({
  sendToBeakerBot: vi.fn(async () => undefined),
}));

import NewAnalysisDialog from "./NewAnalysisDialog";

afterEach(() => cleanup());
beforeEach(() => {
  storeRecipes = [];
});

/** A minimal column table with two numeric groups, enough for a t-test. */
function columnContent(): DataHubDocContent {
  return {
    meta: {
      id: "1",
      name: "Cells",
      project_ids: [],
      folder_path: null,
      table_type: "column",
      created_at: "2026-06-12T00:00:00Z",
    },
    columns: [
      { id: "c1", name: "Control", role: "y", dataType: "number", datasetId: "g1" },
      { id: "c2", name: "Treated", role: "y", dataType: "number", datasetId: "g2" },
    ],
    rows: [
      { id: "r1", cells: { c1: 5, c2: 8 } },
      { id: "r2", cells: { c1: 6, c2: 9 } },
      { id: "r3", cells: { c1: 4, c2: 7 } },
    ],
    analyses: [],
    plots: [],
  };
}

/** A minimal XY table with an X column and one numeric Y column. */
function xyContent(): DataHubDocContent {
  return {
    meta: {
      id: "2",
      name: "Curve",
      project_ids: [],
      folder_path: null,
      table_type: "xy",
      created_at: "2026-06-12T00:00:00Z",
    },
    columns: [
      { id: "x", name: "Dose", role: "x", dataType: "number" },
      { id: "y1", name: "Signal", role: "y", dataType: "number", datasetId: "yd1" },
    ],
    rows: [
      { id: "r1", cells: { x: 1, y1: 2 } },
      { id: "r2", cells: { x: 2, y1: 4 } },
      { id: "r3", cells: { x: 3, y1: 6 } },
    ],
    analyses: [],
    plots: [],
  };
}

function recipe(
  over: Partial<AnalysisRecipe> & { tableType: DataHubTableType },
): AnalysisRecipe {
  return {
    id: over.id ?? "1",
    name: over.name ?? "My recipe",
    analysisType: over.analysisType ?? "unpairedTTest",
    params: over.params ?? {},
    tableType: over.tableType,
    created_at: "2026-06-12T00:00:00Z",
  };
}

describe("NewAnalysisDialog saved recipes", () => {
  it("shows a Column recipe on a Column table", async () => {
    storeRecipes = [
      recipe({ name: "One-sided Welch", analysisType: "unpairedTTest", tableType: "column" }),
    ];
    render(
      <NewAnalysisDialog
        open
        content={columnContent()}
        onCancel={() => {}}
        onSubmit={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("datahub-recipe-list")).toBeTruthy(),
    );
    expect(screen.getByText("One-sided Welch")).toBeTruthy();
  });

  it("does NOT show a Column recipe on an XY table (filters by table type)", async () => {
    storeRecipes = [
      recipe({ name: "One-sided Welch", analysisType: "unpairedTTest", tableType: "column" }),
    ];
    render(
      <NewAnalysisDialog
        open
        content={xyContent()}
        onCancel={() => {}}
        onSubmit={() => {}}
      />,
    );
    // Let the async list load settle.
    await waitFor(() =>
      expect(screen.getByTestId("datahub-new-analysis-dialog")).toBeTruthy(),
    );
    expect(screen.queryByTestId("datahub-recipe-list")).toBeNull();
    expect(screen.queryByText("One-sided Welch")).toBeNull();
  });

  it("applying a recipe submits its analysisType and params", async () => {
    const user = userEvent.setup();
    storeRecipes = [
      recipe({
        name: "One-sided Welch",
        analysisType: "unpairedTTest",
        params: { tail: "greater", variance: "welch" },
        tableType: "column",
      }),
    ];
    const onSubmit = vi.fn();
    render(
      <NewAnalysisDialog
        open
        content={columnContent()}
        onCancel={() => {}}
        onSubmit={onSubmit}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("datahub-recipe-apply")).toBeTruthy(),
    );
    await user.click(screen.getByTestId("datahub-recipe-apply"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.type).toBe("unpairedTTest");
    expect(payload.params).toEqual({ tail: "greater", variance: "welch" });
    // A two-group t-test resolves two column ids from the table.
    expect(payload.columnIds).toHaveLength(2);
  });
});
