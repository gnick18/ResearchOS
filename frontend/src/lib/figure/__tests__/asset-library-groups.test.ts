import { describe, it, expect } from "vitest";

import {
  listCategoryGroups,
  sectionForCategory,
  type LibraryAsset,
} from "@/lib/figure/asset-library";

function asset(category: string | null): LibraryAsset {
  return {
    uid: `x:${category}`,
    source: "x",
    sourceId: String(category),
    title: "t",
    creator: null,
    license: "CC0",
    licenseUrl: null,
    requiresAttribution: false,
    sourceUrl: "",
    credit: "",
    svgPath: "",
    tags: [],
    category,
    fills: 1,
    hasViewBox: true,
  };
}

describe("category grouping", () => {
  it("maps known categories to their section", () => {
    expect(sectionForCategory("Mammals")).toBe("Organisms");
    expect(sectionForCategory("Nucleic acids")).toBe("Molecular");
    expect(sectionForCategory("Lab apparatus")).toBe("Lab & methods");
    expect(sectionForCategory("Machine learning")).toBe("Data & informatics");
  });

  it("unmapped + null categories fall to Other", () => {
    expect(sectionForCategory("Totally novel community tag")).toBe("Other");
    expect(sectionForCategory(null)).toBe("Other");
  });

  it("groups present categories in section order, omitting empty sections", () => {
    const groups = listCategoryGroups([
      asset("Birds"),
      asset("Mammals"),
      asset("Chemistry"),
      asset("Nucleic acids"),
      asset("Made up thing"),
    ]);
    const sections = groups.map((g) => g.section);
    // Organisms before Molecular before Chemistry; Other always trails.
    expect(sections).toEqual(["Organisms", "Molecular", "Chemistry", "Other"]);
    // categories within a section are sorted
    expect(groups[0].categories).toEqual(["Birds", "Mammals"]);
    expect(groups.at(-1)).toEqual({ section: "Other", categories: ["Made up thing"] });
  });

  it("returns no groups for an empty manifest", () => {
    expect(listCategoryGroups([])).toEqual([]);
  });
});
