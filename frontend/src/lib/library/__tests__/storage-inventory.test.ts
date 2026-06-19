import { describe, expect, it } from "vitest";
import { aggregateObjects, segments } from "../storage-inventory";

describe("segments", () => {
  it("splits a key into top and second path segments", () => {
    expect(segments("assets/servier/blood.svg")).toEqual(["assets", "servier"]);
    expect(segments("lab-sites/labkey123/page.html")).toEqual(["lab-sites", "labkey123"]);
  });
  it("treats a slashless key as a root object with no child", () => {
    expect(segments("manifest.json")).toEqual(["(root)", null]);
  });
  it("handles a single trailing segment with no second level", () => {
    expect(segments("relay/abc")).toEqual(["relay", "abc"]);
  });
});

describe("aggregateObjects", () => {
  it("totals objects and bytes and groups by top-level prefix", () => {
    const { totalObjects, totalBytes, prefixes } = aggregateObjects([
      { key: "assets/servier/a.svg", size: 100 },
      { key: "assets/servier/b.svg", size: 200 },
      { key: "assets/arcadia/c.svg", size: 50 },
      { key: "manifest.json", size: 10 },
    ]);
    expect(totalObjects).toBe(4);
    expect(totalBytes).toBe(360);
    // Sorted by bytes desc: assets (350) before (root) (10).
    expect(prefixes.map((p) => p.prefix)).toEqual(["assets", "(root)"]);
    const assets = prefixes[0];
    expect(assets.objects).toBe(3);
    expect(assets.bytes).toBe(350);
    // Children (per source) sorted by bytes: servier (300) before arcadia (50).
    expect(assets.children.map((c) => c.prefix)).toEqual(["servier", "arcadia"]);
    expect(assets.children[0]).toMatchObject({ prefix: "servier", objects: 2, bytes: 300 });
  });

  it("gives a per-lab breakdown under a shared lab prefix", () => {
    const { prefixes } = aggregateObjects([
      { key: "lab-sites/labA/index.html", size: 1000 },
      { key: "lab-sites/labA/logo.png", size: 4000 },
      { key: "lab-sites/labB/index.html", size: 500 },
    ]);
    const labSites = prefixes.find((p) => p.prefix === "lab-sites");
    expect(labSites?.bytes).toBe(5500);
    expect(labSites?.children.map((c) => c.prefix)).toEqual(["labA", "labB"]);
    expect(labSites?.children[0]).toMatchObject({ prefix: "labA", objects: 2, bytes: 5000 });
  });

  it("is empty for no objects", () => {
    expect(aggregateObjects([])).toEqual({ totalObjects: 0, totalBytes: 0, prefixes: [] });
  });
});
