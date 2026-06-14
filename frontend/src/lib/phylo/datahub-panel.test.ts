import { describe, it, expect } from "vitest";
import { parseNewick, leaves } from "./parse";
import { layoutRectangular, layoutCircular, rectTipAxis, circularTipAxis, type LayoutOptions } from "./layout";
import {
  tipAxisToAlignedAxis,
  joinContentToTips,
  datahubJoinRate,
} from "./datahub-panel";
import type { DataHubDocContent } from "@/lib/datahub/model/types";

const OPTS: LayoutOptions = { width: 560, height: 420, rightInset: 120, padding: 16, phylogram: true };

describe("tipAxisToAlignedAxis", () => {
  const tree = parseNewick("((A:0.1,B:0.1):0.2,(C:0.1,D:0.1):0.2);");
  const axis = rectTipAxis(tree, layoutRectangular(tree, OPTS));

  it("emits tip IDS (not names) in tree order, orientation rows", () => {
    const out = tipAxisToAlignedAxis(axis);
    expect(out.order).toEqual(axis.tips.map((t) => String(t.id)));
    expect(out.orientation).toBe("rows");
    // The display names are a parallel array, never the matching key.
    expect(out.order).not.toEqual(leaves(tree).map((t) => t.name));
  });

  it("emits each tip's y center as its position, and the band thickness", () => {
    const out = tipAxisToAlignedAxis(axis);
    expect(out.positions).toEqual(axis.tips.map((t) => t.y));
    expect(out.band).toBe(axis.bandHeight);
    expect(out.positions).toHaveLength(out.order.length);
  });

  it("omits length by default and passes it through when given", () => {
    expect(tipAxisToAlignedAxis(axis).length).toBeUndefined();
    expect(tipAxisToAlignedAxis(axis, 160).length).toBe(160);
  });

  it("throws on a circular axis (v1 rectangular only)", () => {
    const cAxis = circularTipAxis(tree, layoutCircular(tree, OPTS));
    expect(() => tipAxisToAlignedAxis(cAxis)).toThrow(/rectangular only/);
  });
});

describe("joinContentToTips / datahubJoinRate", () => {
  const tree = parseNewick("((A:0.1,B:0.1):0.2,(C:0.1,D:0.1):0.2);");
  // The join column "sp" carries tip NAMES; one extra row ("Z") matches no tip.
  function content(): DataHubDocContent {
    return {
      meta: { id: "t", name: "Abundance", project_ids: [], folder_path: null, table_type: "grouped", created_at: "2026-06-10T00:00:00.000Z" },
      columns: [
        { id: "sp", name: "Species", role: "x", dataType: "text" },
        { id: "v", name: "Value", role: "y", dataType: "number" },
      ],
      rows: [
        { id: "r0", cells: { sp: "A", v: 1 } },
        { id: "r1", cells: { sp: "B", v: 2 } },
        { id: "r2", cells: { sp: "C", v: 3 } },
        { id: "r3", cells: { sp: "D", v: 4 } },
        { id: "r4", cells: { sp: "Z", v: 9 } },
      ],
      analyses: [],
      plots: [],
    };
  }

  it("relabels the x-role column to the matched tip ids and drops unmatched rows", () => {
    const out = joinContentToTips(content(), "sp", tree);
    // The non-joining "Z" row is gone; one row per matched tip.
    expect(out.rows).toHaveLength(4);
    const tipIds = new Set(leaves(tree).map((t) => String(t.id)));
    // Every output row's label is now a tree tip id (not the original name).
    for (const r of out.rows) expect(tipIds.has(String(r.cells.sp))).toBe(true);
    // The y values ride along unchanged (layout, not computation).
    const byLabel = Object.fromEntries(out.rows.map((r) => [String(r.cells.sp), r.cells.v]));
    const idOf = (name: string) => String(leaves(tree).find((t) => t.name === name)!.id);
    expect(byLabel[idOf("A")]).toBe(1);
    expect(byLabel[idOf("D")]).toBe(4);
  });

  it("reports the tip join rate, and never mutates the source content", () => {
    const c = content();
    expect(datahubJoinRate(c, "sp", tree)).toBe(1); // all 4 tips join
    expect(datahubJoinRate(c, "v", tree)).toBe(0); // numbers match no tip name
    // The source rows are untouched (still names, still 5 rows incl Z).
    expect(c.rows).toHaveLength(5);
    expect(c.rows[0].cells.sp).toBe("A");
  });

  it("returns content unchanged when there is no x-role column", () => {
    const c = content();
    c.columns = c.columns.map((col) => ({ ...col, role: "y" as const }));
    expect(joinContentToTips(c, "sp", tree)).toBe(c);
  });
});
