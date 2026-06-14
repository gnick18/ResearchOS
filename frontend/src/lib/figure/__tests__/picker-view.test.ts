import { describe, it, expect } from "vitest";

import { buildPickerView, refKind } from "@/lib/figure/picker-view";
import type { FigureRef } from "@/lib/figure/figure-source";

function ref(p: Partial<FigureRef> & { id: string }): FigureRef {
  return { type: "datahub", name: p.id, ...p };
}

const REFS: FigureRef[] = [
  ref({ id: "1", name: "Dose-response", group: "Drug screen", kind: "XY" }),
  ref({ id: "2", name: "Growth curve", group: "Growth assays", kind: "XY" }),
  ref({ id: "3", name: "Heat-shock survival", group: "Stress assays", kind: "bar" }),
  ref({ id: "4", name: "Two-drug dose-response", group: "Drug screen", kind: "XY" }),
  ref({ id: "5", name: "fakeGFP expression", group: "Expression", kind: "column scatter" }),
];

const base = { kindFilter: null, groupBy: "none" as const, query: "", sourceLabel: "Data Hub plot" };

describe("buildPickerView", () => {
  it("lists distinct kinds in first-seen order for the chips", () => {
    const v = buildPickerView(REFS, base);
    expect(v.kinds).toEqual(["XY", "bar", "column scatter"]);
  });

  it("filters by kind", () => {
    const v = buildPickerView(REFS, { ...base, kindFilter: "XY" });
    expect(v.count).toBe(3);
    expect(v.groups[0].refs.every((r) => r.kind === "XY")).toBe(true);
  });

  it("searches across name, group, and kind", () => {
    expect(buildPickerView(REFS, { ...base, query: "growth" }).count).toBe(1); // name + group
    expect(buildPickerView(REFS, { ...base, query: "drug screen" }).count).toBe(2); // group
    expect(buildPickerView(REFS, { ...base, query: "scatter" }).count).toBe(1); // kind
  });

  it("groups by table (the ref group) preserving first-seen order", () => {
    const v = buildPickerView(REFS, { ...base, groupBy: "table" });
    expect(v.groups.map((g) => g.label)).toEqual([
      "Drug screen",
      "Growth assays",
      "Stress assays",
      "Expression",
    ]);
    expect(v.groups[0].refs.map((r) => r.id)).toEqual(["1", "4"]);
  });

  it("groups by type (kind)", () => {
    const v = buildPickerView(REFS, { ...base, groupBy: "type" });
    expect(v.groups.map((g) => g.label)).toEqual(["XY", "bar", "column scatter"]);
    expect(v.groups[0].refs).toHaveLength(3);
  });

  it("none mode is one unlabeled group of everything matched", () => {
    const v = buildPickerView(REFS, { ...base, groupBy: "none" });
    expect(v.groups).toHaveLength(1);
    expect(v.groups[0].label).toBe("");
    expect(v.groups[0].refs).toHaveLength(5);
  });

  it("falls back to the source label / Other when group or kind is absent", () => {
    const sparse = [ref({ id: "x", name: "untyped" })];
    const v = buildPickerView(sparse, { ...base, groupBy: "table" });
    expect(v.groups[0].label).toBe("Data Hub plot");
    expect(refKind(sparse[0])).toBe("Other");
  });

  it("returns no groups when nothing matches", () => {
    const v = buildPickerView(REFS, { ...base, query: "zzz" });
    expect(v.count).toBe(0);
    expect(v.groups).toHaveLength(0);
  });
});
