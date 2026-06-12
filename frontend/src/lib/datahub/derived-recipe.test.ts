/**
 * Widened derived-table recipe tests (wrangle-2 phase 2, chunk 2).
 *
 * Phase 2 widens a derived table's link from a single transform to a PIPELINE
 * recipe (sources + recipe ops). This file proves the three things that make the
 * widening safe:
 *   1. A LEGACY single-op derived doc recomputes BYTE-IDENTICALLY to the
 *      standalone transforms.ts call it used before phase 2, and round-trips
 *      through the Loro doc with only its legacy keys (byte-stable on disk).
 *   2. A NEW multi-op recipe (filter then groupby) recomputes correctly and
 *      round-trips through the Loro doc with its recipe keys.
 *   3. A 2-source join recipe resolves BOTH sources from the sources map.
 * Plus the absent / missing-source behavior is unchanged.
 *
 * House voice: no em-dashes, no emojis, no mid-sentence colons.
 */

import { describe, expect, it } from "vitest";
import type {
  CellValue,
  ColumnDef,
  DataHubDocContent,
  DerivedFrom,
} from "@/lib/datahub/model/types";
import { recomputeDerived } from "./derived";
import {
  transformValues,
  normalize,
  removeBaseline,
  fractionOfTotal,
} from "./transforms";
import { LoroDoc } from "loro-crdt";
import { seedDataHubDoc, getDataHubContent } from "@/lib/loro/datahub-doc";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function table(
  id: string,
  columns: { id: string; name: string; role?: ColumnDef["role"]; type?: "number" | "text" }[],
  rows: Record<string, CellValue>[],
  tableType: DataHubDocContent["meta"]["table_type"] = "column",
): DataHubDocContent {
  const colDefs: ColumnDef[] = columns.map((c) => ({
    id: c.id,
    name: c.name,
    role: c.role ?? "y",
    dataType: c.type ?? "number",
  }));
  return {
    meta: {
      id,
      name: id,
      project_ids: [],
      folder_path: null,
      table_type: tableType,
      created_at: "",
    },
    columns: colDefs,
    rows: rows.map((r, i) => {
      const cells: Record<string, CellValue> = {};
      for (const c of colDefs) cells[c.id] = r[c.id] ?? null;
      return { id: `r${i}`, cells };
    }),
    analyses: [],
    plots: [],
  };
}

function derivedDoc(link: DerivedFrom): DataHubDocContent {
  return {
    meta: {
      id: "der",
      name: "Derived",
      project_ids: [],
      folder_path: null,
      table_type: "column",
      created_at: "",
      derivedFrom: link,
    },
    // A stale snapshot the recompute must ignore.
    columns: [{ id: "c0", name: "A", role: "y", dataType: "number" }],
    rows: [{ id: "r0", cells: { c0: 999 } }],
    analyses: [],
    plots: [],
  };
}

/** Compare the recompute body to a transforms.ts result body byte-for-byte. */
function expectBodyEquals(content: DataHubDocContent, direct: DataHubDocContent) {
  expect(content.columns).toEqual(direct.columns);
  expect(content.rows).toEqual(direct.rows);
  expect(content.meta.table_type).toBe(direct.meta.table_type);
}

// ---------------------------------------------------------------------------
// 1. Legacy single-op back-compat (byte-identical recompute)
// ---------------------------------------------------------------------------

describe("legacy single-op derived doc recomputes byte-identically", () => {
  const src = table("src", [
    { id: "y1", name: "Control" },
    { id: "y2", name: "Treated" },
  ], [
    { y1: 10, y2: 4 },
    { y1: 20, y2: 8 },
    { y1: 40, y2: 16 },
  ]);

  it("transform (log10) matches transformValues directly", async () => {
    const der = derivedDoc({ sourceTableId: "src", transform: "transform", params: { func: "log10" } });
    const result = await recomputeDerived(der, async () => src);
    expectBodyEquals(result.content, transformValues(src, { func: "log10" }));
  });

  it("normalize (max) matches normalize directly", async () => {
    const der = derivedDoc({ sourceTableId: "src", transform: "normalize", params: { mode: "max" } });
    const result = await recomputeDerived(der, async () => src);
    expectBodyEquals(result.content, normalize(src, { mode: "max" }));
  });

  it("removeBaseline (column) matches removeBaseline directly, dropped column", async () => {
    const der = derivedDoc({
      sourceTableId: "src",
      transform: "removeBaseline",
      params: { mode: "column", baselineColumnId: "y2" },
    });
    const result = await recomputeDerived(der, async () => src);
    expectBodyEquals(
      result.content,
      removeBaseline(src, { mode: "column", baselineColumnId: "y2" }),
    );
  });

  it("fractionOfTotal (column percent) matches fractionOfTotal directly", async () => {
    const der = derivedDoc({
      sourceTableId: "src",
      transform: "fractionOfTotal",
      params: { scope: "column", asPercent: true },
    });
    const result = await recomputeDerived(der, async () => src);
    expectBodyEquals(
      result.content,
      fractionOfTotal(src, { scope: "column", asPercent: true }),
    );
  });

  it("a legacy link round-trips through the Loro doc with only its legacy keys", () => {
    const der = derivedDoc({ sourceTableId: "src", transform: "normalize", params: { mode: "max" } });
    const doc = new LoroDoc();
    doc.import(seedDataHubDoc(der));
    const projected = getDataHubContent(doc, "der");
    // Exactly the legacy keys, no recipe keys invented (byte-stable on disk).
    expect(projected.meta.derivedFrom).toEqual({
      sourceTableId: "src",
      transform: "normalize",
      params: { mode: "max" },
    });
    expect(projected.meta.derivedFrom?.sources).toBeUndefined();
    expect(projected.meta.derivedFrom?.recipe).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. New multi-op recipe
// ---------------------------------------------------------------------------

describe("a multi-op recipe recomputes correctly and round-trips", () => {
  const src = table("src", [
    { id: "g", name: "group", type: "text" },
    { id: "v", name: "value" },
  ], [
    { g: "a", v: 1 },
    { g: "a", v: 3 },
    { g: "b", v: 10 },
    { g: "b", v: 20 },
    { g: "c", v: 100 },
  ]);

  const link: DerivedFrom = {
    sources: ["src"],
    recipe: [
      // Drop the small-value rows, then mean by group.
      {
        kind: "filter",
        node: { type: "condition", condition: { column: "value", op: "ge", value: 3 } },
      },
      { kind: "groupby", by: ["group"], aggregations: [{ column: "value", func: "mean" }] },
    ],
  };

  it("filter then groupby produces the grouped means of the surviving rows", async () => {
    const der = derivedDoc(link);
    const result = await recomputeDerived(der, async () => src);
    expect(result.isDerived).toBe(true);
    expect(result.sourceMissing).toBe(false);
    const names = result.content.columns.map((c) => c.name);
    expect(names).toEqual(["group", "value_mean"]);
    const groupId = result.content.columns[0].id;
    const meanId = result.content.columns[1].id;
    const out = result.content.rows.map((r) => ({
      g: r.cells[groupId],
      m: r.cells[meanId],
    }));
    // value >= 3 keeps a:3, b:10, b:20, c:100. Means: a=3, b=15, c=100.
    expect(out).toEqual([
      { g: "a", m: 3 },
      { g: "b", m: 15 },
      { g: "c", m: 100 },
    ]);
  });

  it("the recipe link round-trips through the Loro doc with its recipe keys", () => {
    const der = derivedDoc(link);
    const doc = new LoroDoc();
    doc.import(seedDataHubDoc(der));
    const projected = getDataHubContent(doc, "der");
    expect(projected.meta.derivedFrom).toEqual(link);
    // Legacy keys are absent on a recipe link.
    expect(projected.meta.derivedFrom?.sourceTableId).toBeUndefined();
    expect(projected.meta.derivedFrom?.transform).toBeUndefined();
  });

  it("a folded column transform inside a recipe runs too", async () => {
    const der = derivedDoc({
      sources: ["src"],
      recipe: [{ kind: "column-transform", params: { func: "linear", k: 2, b: 0 } }],
    });
    const result = await recomputeDerived(der, async () => src);
    // value doubled (group text column is non-numeric, stays null under a y-only
    // numeric transform, matching transforms.ts which only touches data columns).
    const valueId = result.content.columns.find((c) => c.name === "value")!.id;
    expect(result.content.rows.map((r) => r.cells[valueId])).toEqual([2, 6, 20, 40, 200]);
  });
});

// ---------------------------------------------------------------------------
// 3. Two-source join recipe
// ---------------------------------------------------------------------------

describe("a 2-source join recipe resolves both sources", () => {
  const left = table("L", [
    { id: "k", name: "id", type: "text" },
    { id: "a", name: "left_val" },
  ], [
    { k: "x", a: 1 },
    { k: "y", a: 2 },
  ]);
  const right = table("R", [
    { id: "k", name: "id", type: "text" },
    { id: "b", name: "right_val" },
  ], [
    { k: "x", b: 10 },
    { k: "y", b: 20 },
  ]);

  it("inner join on id pulls columns from both sources", async () => {
    const der = derivedDoc({
      sources: ["L", "R"],
      recipe: [{ kind: "join", rightRef: "R", on: ["id"], how: "inner" }],
    });
    const resolve = async (id: string) =>
      id === "L" ? left : id === "R" ? right : null;
    const result = await recomputeDerived(der, resolve);
    expect(result.sourceMissing).toBe(false);
    const names = result.content.columns.map((c) => c.name);
    expect(names).toEqual(["id", "left_val", "right_val"]);
    const ids = result.content.columns.map((c) => c.id);
    const get = (row: number, col: string) =>
      result.content.rows[row].cells[result.content.columns.find((c) => c.name === col)!.id];
    expect(get(0, "id")).toBe("x");
    expect(get(0, "left_val")).toBe(1);
    expect(get(0, "right_val")).toBe(10);
    expect(get(1, "right_val")).toBe(20);
    void ids;
  });

  it("a missing second source yields the clean empty state", async () => {
    const der = derivedDoc({
      sources: ["L", "R"],
      recipe: [{ kind: "join", rightRef: "R", on: ["id"], how: "inner" }],
    });
    const resolve = async (id: string) => (id === "L" ? left : null);
    const result = await recomputeDerived(der, resolve);
    expect(result.sourceMissing).toBe(true);
    expect(result.content.columns).toEqual([]);
    expect(result.content.rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Absent derivedFrom unchanged
// ---------------------------------------------------------------------------

describe("absent derivedFrom is untouched", () => {
  it("a non-derived doc passes through unchanged with no resolver call", async () => {
    const plain = table("plain", [{ id: "y1", name: "A" }], [{ y1: 1 }, { y1: 2 }]);
    let called = false;
    const result = await recomputeDerived(plain, async () => {
      called = true;
      return null;
    });
    expect(result.isDerived).toBe(false);
    expect(result.content).toBe(plain);
    expect(called).toBe(false);
  });
});
