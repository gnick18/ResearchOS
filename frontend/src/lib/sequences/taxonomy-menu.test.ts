// sequence editor master. Tests for the Copy / Paste taxonomy menu enablement
// rule shared by the editor's Analyze menu and the list-row context menu. Copy
// is enabled only when the sequence HAS taxonomy; Paste only when the clipboard
// holds one. Also checks the ids are namespaced and the onRun wires through.

import { describe, expect, it, vi } from "vitest";
import { buildTaxonomyMenuItems } from "./apply-taxonomy";

describe("buildTaxonomyMenuItems enablement", () => {
  it("disables Copy when the sequence has no taxonomy", () => {
    const items = buildTaxonomyMenuItems({
      hasTaxonomy: false,
      clipboardHasTaxonomy: true,
      onCopy: () => {},
      onPaste: () => {},
      idPrefix: "analyze",
    });
    const copy = items.find((i) => i.label === "Copy taxonomy");
    expect(copy?.enabled).toBe(false);
  });

  it("enables Copy when the sequence has taxonomy", () => {
    const items = buildTaxonomyMenuItems({
      hasTaxonomy: true,
      clipboardHasTaxonomy: false,
      onCopy: () => {},
      onPaste: () => {},
      idPrefix: "row",
    });
    const copy = items.find((i) => i.label === "Copy taxonomy");
    expect(copy?.enabled).toBe(true);
  });

  it("disables Paste when the clipboard is empty", () => {
    const items = buildTaxonomyMenuItems({
      hasTaxonomy: true,
      clipboardHasTaxonomy: false,
      onCopy: () => {},
      onPaste: () => {},
      idPrefix: "analyze",
    });
    const paste = items.find((i) => i.label === "Paste taxonomy");
    expect(paste?.enabled).toBe(false);
  });

  it("enables Paste when the clipboard holds a taxonomy", () => {
    const items = buildTaxonomyMenuItems({
      hasTaxonomy: false,
      clipboardHasTaxonomy: true,
      onCopy: () => {},
      onPaste: () => {},
      idPrefix: "analyze",
    });
    const paste = items.find((i) => i.label === "Paste taxonomy");
    expect(paste?.enabled).toBe(true);
  });

  it("namespaces the ids by prefix and wires onRun", () => {
    const onCopy = vi.fn();
    const onPaste = vi.fn();
    const items = buildTaxonomyMenuItems({
      hasTaxonomy: true,
      clipboardHasTaxonomy: true,
      onCopy,
      onPaste,
      idPrefix: "row",
    });
    expect(items.map((i) => i.id)).toEqual([
      "row-copy-taxonomy",
      "row-paste-taxonomy",
    ]);
    items[0].onRun();
    items[1].onRun();
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onPaste).toHaveBeenCalledTimes(1);
  });
});
