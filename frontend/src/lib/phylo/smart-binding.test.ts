import { describe, it, expect } from "vitest";
import { parseNewick } from "./parse";
import {
  rankJoinCandidates,
  enumerateOverlays,
  geomsForKind,
  mergeTableColumnsIntoMetadata,
  type CandidateTable,
} from "./smart-binding";
import type { DataHubDocContent } from "@/lib/datahub/model/types";

// Tips A, B, C, D.
const tree = parseNewick("((A:0.1,B:0.1):0.2,(C:0.1,D:0.1):0.2);");

function table(
  id: string,
  name: string,
  columns: DataHubDocContent["columns"],
  rows: DataHubDocContent["rows"],
): CandidateTable {
  return {
    id,
    name,
    content: {
      meta: {
        id,
        name,
        project_ids: [],
        folder_path: null,
        table_type: "grouped",
        created_at: "2026-06-10T00:00:00.000Z",
      },
      columns,
      rows,
      analyses: [],
      plots: [],
    },
  };
}

// joins A,B,C (3 of 4); MIC numeric, phenotype categorical.
const resistance = table(
  "t-res",
  "resistance_assay",
  [
    { id: "strain", name: "strain_id", role: "x", dataType: "text" },
    { id: "mic", name: "MIC", role: "y", dataType: "number" },
    { id: "phen", name: "phenotype", role: "group", dataType: "text" },
  ],
  [
    { id: "r0", cells: { strain: "A", mic: 2, phen: "R" } },
    { id: "r1", cells: { strain: "B", mic: 8, phen: "R" } },
    { id: "r2", cells: { strain: "C", mic: 1, phen: "S" } },
    { id: "r3", cells: { strain: "Z", mic: 9, phen: "R" } }, // matches no tip
  ],
);

// joins all 4; one numeric column.
const growth = table(
  "t-grow",
  "growth_rates",
  [
    { id: "id", name: "id", role: "x", dataType: "text" },
    { id: "rate", name: "rate", role: "y", dataType: "number" },
  ],
  [
    { id: "r0", cells: { id: "A", rate: 0.4 } },
    { id: "r1", cells: { id: "B", rate: 0.6 } },
    { id: "r2", cells: { id: "C", rate: 0.5 } },
    { id: "r3", cells: { id: "D", rate: 0.7 } },
  ],
);

// joins nothing (foreign labels).
const unrelated = table(
  "t-unrel",
  "sites",
  [
    { id: "loc", name: "location", role: "x", dataType: "text" },
    { id: "lat", name: "lat", role: "y", dataType: "number" },
  ],
  [
    { id: "r0", cells: { loc: "Madison", lat: 43 } },
    { id: "r1", cells: { loc: "Boston", lat: 42 } },
  ],
);

// joins all 4 but carries ONLY the join key (no overlayable column).
const keyOnly = table(
  "t-key",
  "key_only",
  [{ id: "id", name: "id", role: "x", dataType: "text" }],
  [
    { id: "r0", cells: { id: "A" } },
    { id: "r1", cells: { id: "B" } },
    { id: "r2", cells: { id: "C" } },
    { id: "r3", cells: { id: "D" } },
  ],
);

describe("geomsForKind", () => {
  it("numeric drives bars/heat/dots/point, recommends bars", () => {
    const g = geomsForKind("numeric");
    expect(g.geoms).toEqual(["bars", "heat", "dots", "point"]);
    expect(g.recommendedGeom).toBe("bars");
  });
  it("categorical drives only a color strip", () => {
    const g = geomsForKind("categorical");
    expect(g.geoms).toEqual(["strip"]);
    expect(g.recommendedGeom).toBe("strip");
  });
});

describe("enumerateOverlays", () => {
  it("classifies each non-join column and maps it to geoms", () => {
    const overlays = enumerateOverlays(tree, resistance.content, "strain");
    const byCol = Object.fromEntries(overlays.map((o) => [o.columnName, o]));
    expect(Object.keys(byCol).sort()).toEqual(["MIC", "phenotype"]);
    expect(byCol.MIC.columnKind).toBe("numeric");
    expect(byCol.MIC.geoms).toContain("bars");
    expect(byCol.phenotype.columnKind).toBe("categorical");
    expect(byCol.phenotype.geoms).toEqual(["strip"]);
  });

  it("excludes the join column itself", () => {
    const overlays = enumerateOverlays(tree, resistance.content, "strain");
    expect(overlays.find((o) => o.columnId === "strain")).toBeUndefined();
  });

  it("skips a column with no value on any joined tip", () => {
    // 'note' is blank for every joining tip (A,B,C); only the non-joining Z has it.
    const t = table(
      "t-n",
      "n",
      [
        { id: "strain", name: "strain_id", role: "x", dataType: "text" },
        { id: "v", name: "v", role: "y", dataType: "number" },
        { id: "note", name: "note", role: "group", dataType: "text" },
      ],
      [
        { id: "r0", cells: { strain: "A", v: 1, note: "" } },
        { id: "r1", cells: { strain: "B", v: 2, note: "" } },
        { id: "r2", cells: { strain: "Z", v: 3, note: "hi" } },
      ],
    );
    const overlays = enumerateOverlays(tree, t.content, "strain");
    expect(overlays.map((o) => o.columnName)).toEqual(["v"]);
  });
});

describe("rankJoinCandidates", () => {
  it("ranks by tip-coverage desc and reports exact matched counts", () => {
    const ranked = rankJoinCandidates(tree, [resistance, growth]);
    expect(ranked.map((c) => c.tableId)).toEqual(["t-grow", "t-res"]);
    expect(ranked[0].joinRate).toBe(1); // growth joins 4/4
    expect(ranked[0].matchedTips).toBe(4);
    expect(ranked[0].totalTips).toBe(4);
    expect(ranked[1].joinRate).toBe(0.75); // resistance joins 3/4
    expect(ranked[1].matchedTips).toBe(3);
    expect(ranked[1].joinColumnName).toBe("strain_id");
  });

  it("drops tables that join nothing or carry only the join key", () => {
    const ranked = rankJoinCandidates(tree, [unrelated, keyOnly, growth]);
    expect(ranked.map((c) => c.tableId)).toEqual(["t-grow"]);
  });
});

describe("mergeTableColumnsIntoMetadata", () => {
  it("builds fresh tip-keyed rows when nothing is bound yet", () => {
    const out = mergeTableColumnsIntoMetadata({
      tree,
      existing: null,
      tableName: "resistance_assay",
      content: resistance.content,
      joinColumnId: "strain",
      columnIds: ["mic", "phen"],
    });
    expect(out.tipColumn).toBe("tip");
    expect(out.addedColumns).toEqual([
      { columnId: "mic", name: "MIC" },
      { columnId: "phen", name: "phenotype" },
    ]);
    // One row per tip (axis complete); D is blank (did not join).
    expect(out.rows).toHaveLength(4);
    const byTip = Object.fromEntries(out.rows.map((r) => [r.tip, r]));
    expect(byTip.A.MIC).toBe("2");
    expect(byTip.A.phenotype).toBe("R");
    expect(byTip.D.MIC).toBe("");
    expect(byTip.D.phenotype).toBe("");
  });

  it("preserves existing columns and adds onto matched rows", () => {
    const existing = {
      tipColumn: "name",
      rows: [
        { name: "A", clade: "I" },
        { name: "B", clade: "I" },
        { name: "C", clade: "II" },
        { name: "D", clade: "II" },
      ],
    };
    const out = mergeTableColumnsIntoMetadata({
      tree,
      existing,
      tableName: "growth_rates",
      content: growth.content,
      joinColumnId: "id",
      columnIds: ["rate"],
    });
    expect(out.tipColumn).toBe("name");
    const byTip = Object.fromEntries(out.rows.map((r) => [r.name, r]));
    expect(byTip.A.clade).toBe("I"); // existing column untouched
    expect(byTip.A.rate).toBe("0.4"); // merged column added
    expect(byTip.D.rate).toBe("0.7");
    // The source existing rows are not mutated.
    expect(existing.rows[0]).toEqual({ name: "A", clade: "I" });
  });

  it("namespaces a colliding column name", () => {
    const existing = {
      tipColumn: "name",
      rows: [
        { name: "A", MIC: "old" },
        { name: "B", MIC: "old" },
        { name: "C", MIC: "old" },
      ],
    };
    const out = mergeTableColumnsIntoMetadata({
      tree,
      existing,
      tableName: "resistance_assay",
      content: resistance.content,
      joinColumnId: "strain",
      columnIds: ["mic"],
    });
    expect(out.addedColumns).toEqual([
      { columnId: "mic", name: "resistance_assay:MIC" },
    ]);
    const byTip = Object.fromEntries(out.rows.map((r) => [r.name, r]));
    expect(byTip.A.MIC).toBe("old"); // original kept
    expect(byTip.A["resistance_assay:MIC"]).toBe("2"); // merged under a safe name
  });

  it("reuses an already-merged identical column instead of duplicating it", () => {
    // First add MIC fresh (e.g. the GUI door, bars).
    const first = mergeTableColumnsIntoMetadata({
      tree,
      existing: null,
      tableName: "resistance_assay",
      content: resistance.content,
      joinColumnId: "strain",
      columnIds: ["mic"],
    });
    // Second add of the SAME column onto that result (e.g. the chat door, heatmap).
    const second = mergeTableColumnsIntoMetadata({
      tree,
      existing: { rows: first.rows, tipColumn: first.tipColumn },
      tableName: "resistance_assay",
      content: resistance.content,
      joinColumnId: "strain",
      columnIds: ["mic"],
    });
    // Bound to the EXISTING column, not a namespaced duplicate.
    expect(second.addedColumns).toEqual([{ columnId: "mic", name: "MIC" }]);
    const cols = new Set(second.rows.flatMap((r) => Object.keys(r)));
    expect(cols.has("resistance_assay:MIC")).toBe(false);
    expect(cols.has("MIC")).toBe(true);
    const byTip = Object.fromEntries(
      second.rows.map((r) => [r[first.tipColumn], r]),
    );
    expect(byTip.A.MIC).toBe("2"); // value preserved
  });

  it("appends a row for a tip that has table data but no existing row", () => {
    const existing = {
      tipColumn: "name",
      rows: [{ name: "A", clade: "I" }], // only A bound
    };
    const out = mergeTableColumnsIntoMetadata({
      tree,
      existing,
      tableName: "growth_rates",
      content: growth.content,
      joinColumnId: "id",
      columnIds: ["rate"],
    });
    const byTip = Object.fromEntries(out.rows.map((r) => [r.name, r]));
    // B, C, D were not in the binding but join growth_rates -> appended.
    expect(byTip.B.rate).toBe("0.6");
    expect(byTip.D.rate).toBe("0.7");
    expect(out.rows).toHaveLength(4);
  });
});
