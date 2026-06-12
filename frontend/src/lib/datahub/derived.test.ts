import { describe, expect, it } from "vitest";
import type {
  CellValue,
  DataHubDocContent,
  DerivedFrom,
} from "@/lib/datahub/model/types";
import { recomputeDerived } from "./derived";
import { LoroDoc } from "loro-crdt";
import { seedDataHubDoc, getDataHubContent } from "@/lib/loro/datahub-doc";

/** A minimal single-column source content with the given Y values. */
function source(values: CellValue[]): DataHubDocContent {
  return {
    meta: {
      id: "src",
      name: "Source",
      project_ids: [],
      folder_path: null,
      table_type: "column",
      created_at: "",
    },
    columns: [{ id: "c0", name: "A", role: "y", dataType: "number" }],
    rows: values.map((v, i) => ({ id: `r${i}`, cells: { c0: v } })),
    analyses: [],
    plots: [],
  };
}

/** A derived document carrying a derivedFrom link plus an (irrelevant) snapshot. */
function derived(link: DerivedFrom): DataHubDocContent {
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
    // A stale snapshot that the recompute should IGNORE (it always re-fetches).
    columns: [{ id: "c0", name: "A", role: "y", dataType: "number" }],
    rows: [{ id: "r0", cells: { c0: 999 } }],
    analyses: [],
    plots: [],
  };
}

function col(content: DataHubDocContent, columnId: string): CellValue[] {
  return content.rows.map((r) => r.cells[columnId] ?? null);
}

describe("recomputeDerived (the live link)", () => {
  it("recomputes a derived doc from its source", async () => {
    const der = derived({
      sourceTableId: "src",
      transform: "transform",
      params: { func: "log10" },
    });
    const result = await recomputeDerived(der, async () => source([1, 10, 100]));
    expect(result.isDerived).toBe(true);
    expect(result.sourceMissing).toBe(false);
    // Computed from the SOURCE (1,10,100 -> 0,1,2), not the 999 snapshot.
    expect(col(result.content, "c0")).toEqual([0, 1, 2]);
    // The derived doc's own identity is preserved.
    expect(result.content.meta.id).toBe("der");
    expect(result.content.meta.derivedFrom?.transform).toBe("transform");
  });

  it("editing the source then recomputing reflects the change", async () => {
    const der = derived({
      sourceTableId: "src",
      transform: "transform",
      params: { func: "linear", k: 10 },
    });
    let live = source([1, 2, 3]);
    const resolve = async () => live;

    const first = await recomputeDerived(der, resolve);
    expect(col(first.content, "c0")).toEqual([10, 20, 30]);

    // Simulate the user editing the source table, then reopening the derived one.
    live = source([5, 6]);
    const second = await recomputeDerived(der, resolve);
    expect(col(second.content, "c0")).toEqual([50, 60]);
  });

  it("handles a missing / deleted source gracefully (empty, no crash)", async () => {
    const der = derived({
      sourceTableId: "gone",
      transform: "transform",
      params: { func: "log10" },
    });
    const result = await recomputeDerived(der, async () => null);
    expect(result.isDerived).toBe(true);
    expect(result.sourceMissing).toBe(true);
    expect(result.content.columns).toEqual([]);
    expect(result.content.rows).toEqual([]);
    // The derived doc identity still survives so the rail can still label it.
    expect(result.content.meta.id).toBe("der");
  });

  it("a non-derived doc passes through unchanged (no recompute)", async () => {
    const plain = source([1, 2, 3]);
    let resolverCalled = false;
    const result = await recomputeDerived(plain, async () => {
      resolverCalled = true;
      return null;
    });
    expect(result.isDerived).toBe(false);
    expect(result.sourceMissing).toBe(false);
    expect(result.content).toBe(plain);
    expect(resolverCalled).toBe(false);
  });

  it("a transpose recompute flips the derived archetype", async () => {
    const der = derived({
      sourceTableId: "src",
      transform: "transpose",
      params: {},
    });
    const result = await recomputeDerived(der, async () => source([1, 2]));
    expect(result.content.meta.table_type).toBe("column");
    // Transpose yields a label column plus one column per source row (2).
    expect(result.content.columns.length).toBe(1 + 2);
  });
});

describe("derivedFrom model round-trip and back-compat", () => {
  it("seeds and projects a derived link through the Loro doc", () => {
    const der = derived({
      sourceTableId: "src",
      transform: "normalize",
      params: { mode: "max" },
    });
    const doc = new LoroDoc();
    doc.import(seedDataHubDoc(der));
    const projected = getDataHubContent(doc, "der");
    expect(projected.meta.derivedFrom).toEqual({
      sourceTableId: "src",
      transform: "normalize",
      params: { mode: "max" },
    });
  });

  it("a doc WITHOUT derivedFrom seeds byte-identically to before the field existed", () => {
    const plain = source([1, 2, 3]);
    // Two seeds of the same plain content are byte-equal (determinism), and the
    // projection never invents a derivedFrom field.
    const a = seedDataHubDoc(plain);
    const b = seedDataHubDoc(plain);
    expect(a).toEqual(b);
    const doc = new LoroDoc();
    doc.import(a);
    const projected = getDataHubContent(doc, "src");
    expect(projected.meta.derivedFrom).toBeUndefined();
  });
});
