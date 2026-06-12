// cell-exclusion.test.ts
//
// Excluding a value (the Prism outlier affordance) must filter the input set and
// NOTHING else. These tests pin that an excluded cell is treated exactly like an
// absent cell: a t-test / ANOVA on a group with one excluded value equals the
// same test on the data physically without that value; the plot stats skip it;
// an absent excludedCells set is byte-identical to before the field existed; and
// the set round-trips through Loro.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, expect, it } from "vitest";
import { LoroDoc } from "loro-crdt";
import type { DataHubDocContent } from "@/lib/datahub/model/types";
import {
  excludedKey,
  excludedSet,
  isCellExcluded,
  toggleCellExclusion,
} from "./cell-exclusion";
import { columnValues, computeGroupStats } from "./column-table";
import { resolveGroups } from "./run-analysis";
import { resolvePlotGroups, defaultPlotStyle } from "./plot-spec";
import { unpairedTTest, oneWayAnova } from "./engine";
import {
  seedDataHubDoc,
  getDataHubContent,
} from "@/lib/loro/datahub-doc";

/** A two-group Column table with the given replicate values, optionally with an
 *  excluded-cell key list on meta. */
function twoGroups(
  a: (number | null)[],
  b: (number | null)[],
  excludedCells?: string[],
): DataHubDocContent {
  const n = Math.max(a.length, b.length);
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      id: `r${i}`,
      cells: { ca: a[i] ?? null, cb: b[i] ?? null } as Record<
        string,
        number | string | null
      >,
    });
  }
  return {
    meta: {
      id: "t1",
      name: "t",
      project_ids: [],
      folder_path: null,
      table_type: "column",
      ...(excludedCells ? { excludedCells } : {}),
      created_at: "",
    },
    columns: [
      { id: "ca", name: "Control", role: "y", dataType: "number" },
      { id: "cb", name: "Treated", role: "y", dataType: "number" },
    ],
    rows,
    analyses: [],
    plots: [],
  };
}

describe("cell-exclusion helpers", () => {
  it("builds the stable rowId:columnId key", () => {
    expect(excludedKey("r3", "ca")).toBe("r3:ca");
  });

  it("isCellExcluded reads meta.excludedCells", () => {
    const content = twoGroups([1, 2, 3], [4, 5, 6], ["r1:ca"]);
    expect(isCellExcluded(content, "r1", "ca")).toBe(true);
    expect(isCellExcluded(content, "r0", "ca")).toBe(false);
    // Absent field means nothing excluded.
    const clean = twoGroups([1, 2, 3], [4, 5, 6]);
    expect(isCellExcluded(clean, "r1", "ca")).toBe(false);
  });

  it("toggleCellExclusion adds, removes, and stays sorted without mutating input", () => {
    const content = twoGroups([1, 2, 3], [4, 5, 6]);
    const added = toggleCellExclusion(content, "r2", "cb");
    expect(added).toEqual(["r2:cb"]);
    // Input content was not mutated.
    expect(content.meta.excludedCells).toBeUndefined();

    const withTwo = twoGroups([1, 2, 3], [4, 5, 6], ["r2:cb"]);
    const both = toggleCellExclusion(withTwo, "r0", "ca");
    // Sorted output for byte-stable serialization.
    expect(both).toEqual(["r0:ca", "r2:cb"]);

    // Toggling an excluded cell again includes it.
    const removed = toggleCellExclusion(withTwo, "r2", "cb");
    expect(removed).toEqual([]);
  });

  it("excludedSet returns a fresh mutable set", () => {
    const content = twoGroups([1, 2, 3], [4, 5, 6], ["r1:ca"]);
    const s = excludedSet(content);
    expect(s.has("r1:ca")).toBe(true);
    s.add("x");
    // The doc was not affected by mutating the returned set.
    expect(content.meta.excludedCells).toEqual(["r1:ca"]);
  });
});

describe("excluding filters the input set, not the math", () => {
  it("columnValues skips an excluded cell, treating it as absent", () => {
    const excluded = twoGroups([10, 999, 12], [4, 5, 6], ["r1:ca"]);
    expect(columnValues(excluded, "ca")).toEqual([10, 12]);
    // The other group is untouched.
    expect(columnValues(excluded, "cb")).toEqual([4, 5, 6]);
  });

  it("a t-test with one excluded value equals the same test without that value", () => {
    // 999 is an outlier in group A, excluded at r1:ca. The exclusion path must
    // match a table that physically omits that replicate (null in its place).
    const excluded = twoGroups([10, 999, 12, 11], [4, 5, 6, 7], ["r1:ca"]);
    const omitted = twoGroups([10, null, 12, 11], [4, 5, 6, 7]);

    const ga = resolveGroups(excluded, ["ca", "cb"]);
    const gb = resolveGroups(omitted, ["ca", "cb"]);
    expect(ga[0].values).toEqual(gb[0].values);
    expect(ga[0].values).toEqual([10, 12, 11]);

    const ra = unpairedTTest(ga[0].values, ga[1].values, { variance: "welch" });
    const rb = unpairedTTest(gb[0].values, gb[1].values, { variance: "welch" });
    expect(ra.ok && rb.ok).toBe(true);
    if (ra.ok && rb.ok) {
      expect(ra.statistic).toBeCloseTo(rb.statistic, 12);
      expect(ra.pValue).toBeCloseTo(rb.pValue, 12);
      expect(ra.df).toBeCloseTo(rb.df, 12);
    }
  });

  it("an ANOVA with one excluded value equals the same test without that value", () => {
    const excluded: DataHubDocContent = {
      ...twoGroups([1, 2, 3], [4, 5, 60], ["r2:cc"]),
    };
    // Add a third group with an outlier excluded at r2:cc.
    excluded.columns.push({ id: "cc", name: "High", role: "y", dataType: "number" });
    excluded.rows[0].cells.cc = 7;
    excluded.rows[1].cells.cc = 8;
    excluded.rows[2].cells.cc = 900; // the outlier, excluded
    excluded.meta.excludedCells = ["r2:cc"];

    const ge = resolveGroups(excluded, ["ca", "cb", "cc"]);
    const data: Record<string, number[]> = {};
    for (const g of ge) data[g.name] = g.values;
    // The omitted-physically version: 900 simply not present.
    const omittedData: Record<string, number[]> = {
      Control: [1, 2, 3],
      Treated: [4, 5, 60],
      High: [7, 8],
    };
    expect(data).toEqual(omittedData);

    const ra = oneWayAnova(data, { postHoc: "tukey" });
    const rb = oneWayAnova(omittedData, { postHoc: "tukey" });
    expect(ra.ok && rb.ok).toBe(true);
    if (ra.ok && rb.ok) {
      expect(ra.statistic).toBeCloseTo(rb.statistic, 12);
      expect(ra.pValue).toBeCloseTo(rb.pValue, 12);
    }
  });

  it("plot stats and replicate dots skip an excluded value", () => {
    const excluded = twoGroups([10, 999, 12], [4, 5, 6], ["r1:ca"]);
    const groups = resolvePlotGroups(excluded, defaultPlotStyle());
    const a = groups.find((g) => g.id === "ca")!;
    // The jittered replicate dots ignore the excluded value.
    expect(a.values).toEqual([10, 12]);
    // The mean / n match the engine describe on the not-excluded values.
    const s = computeGroupStats(excluded, "ca");
    expect(s.n).toBe(2);
    expect(s.mean).toBeCloseTo(11, 12);
    expect(a.stats.mean).toBeCloseTo(11, 12);
  });
});

describe("excludedCells back-compat + Loro round-trip", () => {
  it("an absent excludedCells set is byte-identical to before the field existed", () => {
    const clean = twoGroups([1, 2, 3], [4, 5, 6]);
    // A table with an empty excluded array must seed the same bytes as one with
    // no field at all (the serializer drops an empty set).
    const emptyArr = twoGroups([1, 2, 3], [4, 5, 6], []);
    const a = seedDataHubDoc(clean);
    const b = seedDataHubDoc(emptyArr);
    expect(Buffer.from(a)).toEqual(Buffer.from(b));
  });

  it("round-trips a non-empty excluded set through Loro", () => {
    const content = twoGroups([10, 999, 12], [4, 5, 6], ["r1:ca", "r0:cb"]);
    const doc = new LoroDoc();
    doc.import(seedDataHubDoc(content));
    const projected = getDataHubContent(doc, "t1");
    // Sorted on the way out, so the projected order is deterministic.
    expect(projected.meta.excludedCells).toEqual(["r0:cb", "r1:ca"]);
    // And the exclusion still filters the engine input after the round-trip.
    expect(columnValues(projected, "ca")).toEqual([10, 12]);
  });

  it("two devices seeding the same exclusions in different order produce equal bytes", () => {
    const c1 = twoGroups([1, 2, 3], [4, 5, 6], ["r1:ca", "r0:cb"]);
    const c2 = twoGroups([1, 2, 3], [4, 5, 6], ["r0:cb", "r1:ca"]);
    expect(Buffer.from(seedDataHubDoc(c1))).toEqual(
      Buffer.from(seedDataHubDoc(c2)),
    );
  });
});
