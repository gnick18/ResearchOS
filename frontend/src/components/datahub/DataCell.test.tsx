// Coverage for the shared DataCell (exclude-value affordance).
//
// A data cell right-click opens OUR menu (Exclude value, then Cut / Copy / Paste)
// rather than the browser's native one, and toggling routes through the page's
// onToggleExclusion. An excluded cell keeps its value VISIBLE but renders struck
// through with a tooltip, and offers Include value instead.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import DataTableGrid from "./DataTableGrid";
import { ContextMenuProvider } from "@/components/context-menu/ContextMenuProvider";
import type { DataHubDocContent } from "@/lib/datahub/model/types";

afterEach(() => cleanup());

function content(excludedCells?: string[]): DataHubDocContent {
  return {
    meta: {
      id: "1",
      name: "Reps",
      project_ids: [],
      folder_path: null,
      table_type: "column",
      ...(excludedCells ? { excludedCells } : {}),
      created_at: "2026-06-11T00:00:00Z",
    },
    columns: [{ id: "col-1", name: "Control", role: "y", dataType: "number" }],
    rows: [
      { id: "row-1", cells: { "col-1": 2 } },
      { id: "row-2", cells: { "col-1": 99 } },
    ],
    analyses: [],
    plots: [],
  };
}

function renderGrid(
  c: DataHubDocContent,
  onToggleExclusion = vi.fn(),
): { onToggleExclusion: ReturnType<typeof vi.fn> } {
  render(
    <ContextMenuProvider>
      <DataTableGrid
        content={c}
        onCellCommit={() => {}}
        onToggleExclusion={onToggleExclusion}
        onAddRow={() => {}}
        onAddColumn={() => {}}
      />
    </ContextMenuProvider>,
  );
  return { onToggleExclusion };
}

describe("DataCell exclude-value menu", () => {
  it("right-click on a data cell opens our menu with Exclude value + Cut/Copy/Paste", () => {
    renderGrid(content());
    const cell = screen.getByLabelText("Control replicate 2");
    fireEvent.contextMenu(cell);
    // Our shared context menu opened (not the native one).
    expect(screen.getByTestId("sequence-context-menu")).toBeTruthy();
    expect(screen.getByText("Exclude value")).toBeTruthy();
    // The native editing actions are preserved in our menu.
    expect(screen.getByText("Copy")).toBeTruthy();
    expect(screen.getByText("Cut")).toBeTruthy();
    expect(screen.getByText("Paste")).toBeTruthy();
  });

  it("clicking Exclude value calls onToggleExclusion for the cell", () => {
    const { onToggleExclusion } = renderGrid(content());
    const cell = screen.getByLabelText("Control replicate 2");
    fireEvent.contextMenu(cell);
    fireEvent.click(screen.getByText("Exclude value"));
    expect(onToggleExclusion).toHaveBeenCalledWith("row-2", "col-1");
  });

  it("an excluded cell renders its value, struck through, and offers Include value", () => {
    renderGrid(content(["row-2:col-1"]));
    const cell = screen.getByLabelText("Control replicate 2") as HTMLInputElement;
    // The value is still shown (excluded, not deleted).
    expect(cell.value).toBe("99");
    // Marked excluded for styling + the struck-through class.
    expect(cell.getAttribute("data-excluded")).toBe("true");
    expect(cell.className).toContain("line-through");
    // The cell <td> carries the excluded testid.
    expect(screen.getByTestId("datahub-cell-excluded")).toBeTruthy();
    // The menu now offers Include value.
    fireEvent.contextMenu(cell);
    expect(screen.getByText("Include value")).toBeTruthy();
    expect(screen.queryByText("Exclude value")).toBeNull();
  });

  it("a not-excluded cell is not struck through", () => {
    renderGrid(content(["row-2:col-1"]));
    const other = screen.getByLabelText("Control replicate 1") as HTMLInputElement;
    expect(other.getAttribute("data-excluded")).toBeNull();
    expect(other.className).not.toContain("line-through");
  });
});
