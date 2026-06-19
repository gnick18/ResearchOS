import { describe, expect, it } from "vitest";
import { ALL_ENTITY_TYPES, type TrashEntityType } from "@/lib/trash";
import { SECTION_ORDER } from "../trash-sections";

// Regression guard for the bug where a type was added to `TrashEntityType`
// (and so could be soft-deleted to `_trash/<type>/`) but never got a section
// here — leaving its trashed records INVISIBLE on /trash with no way to
// restore them. This bit "molecule" and "storage_node" (2026-06-15 fix).

describe("SECTION_ORDER coverage", () => {
  const sectionKeys = SECTION_ORDER.map((s) => s.key);

  it("renders a section for EVERY trashable entity type", () => {
    const missing = ALL_ENTITY_TYPES.filter(
      (t) => !sectionKeys.includes(t),
    );
    // A non-empty list means deleted records of those types would be
    // stranded on disk with no restore UI.
    expect(missing).toEqual([]);
  });

  it("explicitly covers molecule and storage_node (the original gap)", () => {
    expect(sectionKeys).toContain<TrashEntityType>("molecule");
    expect(sectionKeys).toContain<TrashEntityType>("storage_node");
  });

  it("has no duplicate section keys", () => {
    expect(new Set(sectionKeys).size).toBe(sectionKeys.length);
  });

  it("gives every section a non-empty human label", () => {
    for (const { key, label } of SECTION_ORDER) {
      expect(label, `label for ${key}`).toMatch(/\S/);
    }
  });
});
