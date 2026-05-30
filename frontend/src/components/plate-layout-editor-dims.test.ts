// frontend/src/components/plate-layout-editor-dims.test.ts
//
// Pure-function coverage for the PlateLayoutEditor grid helpers, focused on
// 384-well support: the 16 x 24 dimension map, the well-id <-> row/col
// round-trip across the full A-P row range, and the wells -> region_labels
// projection the create flow runs on save. The A-P case is a regression guard:
// parseWellId previously only matched rows A-H, so wells in rows I-P were
// silently dropped when a 384-well layout was saved.

import { describe, expect, it } from "vitest";
import {
  dimsForSize,
  parseWellId,
  rowLabel,
  wellId,
  wellsToRegionLabels,
} from "./PlateLayoutEditor";
import type { PlateWellAnnotation } from "@/lib/types";

describe("PlateLayoutEditor 384-well grid helpers", () => {
  it("dimsForSize(384) is a 16 x 24 grid", () => {
    expect(dimsForSize(384)).toEqual({ rows: 16, cols: 24 });
  });

  it("leaves the existing grid sizes unchanged", () => {
    expect(dimsForSize(12)).toEqual({ rows: 3, cols: 4 });
    expect(dimsForSize(24)).toEqual({ rows: 4, cols: 6 });
    expect(dimsForSize(48)).toEqual({ rows: 6, cols: 8 });
    expect(dimsForSize(96)).toEqual({ rows: 8, cols: 12 });
  });

  it("rowLabel covers rows A through P", () => {
    expect(rowLabel(0)).toBe("A");
    expect(rowLabel(15)).toBe("P");
  });

  it("round-trips well ids across the full 16 x 24 range", () => {
    expect(wellId(0, 0)).toBe("A1");
    expect(wellId(8, 0)).toBe("I1"); // an I-P row the old regex dropped
    expect(wellId(15, 23)).toBe("P24");

    expect(parseWellId("A1")).toEqual({ row: 0, col: 0 });
    expect(parseWellId("I1")).toEqual({ row: 8, col: 0 });
    expect(parseWellId("P24")).toEqual({ row: 15, col: 23 });
  });

  it("projects a per-row sample fill on row P into region_labels (rows I-P regression)", () => {
    // Mimic the per-row quick-entry path: paint all 24 columns of row P
    // (index 15) as a sample, then project to region_labels the way the
    // create flow does on save. Before widening parseWellId to A-P these
    // wells were silently dropped here.
    const { cols } = dimsForSize(384);
    const wells: Record<string, PlateWellAnnotation> = {};
    for (let c = 0; c < cols; c += 1) {
      wells[wellId(15, c)] = { role: "sample", sample_label: "Lysate P" };
    }

    const regions = wellsToRegionLabels(wells);

    expect(regions).toHaveLength(cols);
    expect(regions.every((r) => r.role === "sample")).toBe(true);
    expect(regions.every((r) => r.row_start === 15 && r.row_end === 15)).toBe(true);
    expect(new Set(regions.map((r) => r.col_start)).size).toBe(cols);
  });
});
