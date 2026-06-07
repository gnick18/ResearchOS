// frontend/src/components/ui/__tests__/GridCanvas.test.tsx
//
// Inventory box-finder foundation (2026-06-07). Pins the shared `GridCanvas`
// primitive extracted from `PlateLayoutEditor` (design FLAG-G): the cell-id
// scheme (`wellId` / `parseWellId` / `rowLabel`) round-trips, the grid renders
// rows x cols cells, the per-cell render hook drives className/label/aria, and
// a click surfaces the painted cell id to the caller.

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GridCanvas, { wellId, parseWellId, rowLabel } from "../GridCanvas";

describe("GridCanvas cell-id scheme", () => {
  it("rowLabel covers A through P", () => {
    expect(rowLabel(0)).toBe("A");
    expect(rowLabel(15)).toBe("P");
  });

  it("wellId / parseWellId round-trip across the full A-P range", () => {
    const cases: Array<[number, number]> = [
      [0, 0],
      [8, 0], // an I-P row the old A-H regex dropped
      [15, 23], // P24, the 384-well corner
      [3, 11],
    ];
    for (const [row, col] of cases) {
      const id = wellId(row, col);
      expect(parseWellId(id)).toEqual({ row, col });
    }
  });

  it("parseWellId rejects malformed ids", () => {
    expect(parseWellId("Z1")).toBeNull(); // row beyond P
    expect(parseWellId("A")).toBeNull(); // no column
    expect(parseWellId("1A")).toBeNull(); // wrong order
    expect(parseWellId("")).toBeNull();
  });
});

describe("GridCanvas render", () => {
  it("renders exactly rows x cols cell buttons", () => {
    render(
      <GridCanvas rows={3} cols={4} editable={false} cell={(id) => ({ ariaLabel: id })} />,
    );
    // 3 x 4 = 12 cells; their aria-labels are the cell ids.
    expect(screen.getByLabelText("A1")).toBeTruthy();
    expect(screen.getByLabelText("C4")).toBeTruthy();
    // The header letters/numbers exist as plain text in read-only mode.
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.getByText("C")).toBeTruthy();
  });

  it("applies the caller's per-cell className + label", () => {
    render(
      <GridCanvas
        rows={1}
        cols={2}
        editable={false}
        cell={(id) => ({
          ariaLabel: id,
          label: id === "A1" ? "X" : "",
          className: id === "A1" ? "bg-emerald-500" : "",
        })}
      />,
    );
    const a1 = screen.getByLabelText("A1");
    expect(a1.className).toContain("bg-emerald-500");
    expect(a1.textContent).toBe("X");
  });

  it("surfaces the clicked cell id (and erase modifier) to onCellPaint", () => {
    const onCellPaint = vi.fn();
    render(
      <GridCanvas
        rows={2}
        cols={2}
        editable
        onCellPaint={onCellPaint}
        cell={(id) => ({ ariaLabel: id })}
      />,
    );
    const b2 = screen.getByLabelText("B2");
    fireEvent.mouseDown(b2);
    expect(onCellPaint).toHaveBeenCalledWith("B2", { erase: false });

    // Shift-click is the erase gesture.
    fireEvent.mouseDown(b2, { shiftKey: true });
    expect(onCellPaint).toHaveBeenLastCalledWith("B2", { erase: true });
  });

  it("does not paint when read-only", () => {
    const onCellPaint = vi.fn();
    render(
      <GridCanvas
        rows={1}
        cols={1}
        editable={false}
        onCellPaint={onCellPaint}
        cell={(id) => ({ ariaLabel: id })}
      />,
    );
    fireEvent.mouseDown(screen.getByLabelText("A1"));
    expect(onCellPaint).not.toHaveBeenCalled();
  });

  it("fires the row/column header handlers when editable", () => {
    const onRowHeaderClick = vi.fn();
    const onColHeaderClick = vi.fn();
    render(
      <GridCanvas
        rows={2}
        cols={2}
        editable
        onRowHeaderClick={onRowHeaderClick}
        onColHeaderClick={onColHeaderClick}
        cell={(id) => ({ ariaLabel: id })}
      />,
    );
    fireEvent.click(screen.getByText("B")); // row header for row index 1
    expect(onRowHeaderClick).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByText("2")); // column header for col index 1
    expect(onColHeaderClick).toHaveBeenCalledWith(1);
  });
});
