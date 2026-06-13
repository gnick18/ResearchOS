// Tests for the pure ranking + ref-mapping helpers behind the @ mention picker
// (ai at-mentions bot, 2026-06-13). The component render is not exercised here;
// only the deterministic helpers that decide which objects show and how they map
// to an AttachedRef.

import { describe, it, expect } from "vitest";
import { rankEntries, entryToRef } from "@/components/ai/ComposerMentionPicker";
import type { GlobalIndexEntry } from "@/components/beaker-search/global-index";

function entry(over: Partial<GlobalIndexEntry>): GlobalIndexEntry {
  return {
    type: "note",
    key: "k",
    label: "Label",
    meta: "",
    haystack: "label",
    recencyAt: 0,
    iconName: "file",
    href: "/x",
    enabled: true,
    ...over,
  };
}

describe("rankEntries", () => {
  it("returns recency-ordered enabled entries for an empty query", () => {
    const a = entry({ key: "a", recencyAt: 100 });
    const b = entry({ key: "b", recencyAt: 200 });
    const disabled = entry({ key: "c", recencyAt: 999, enabled: false });
    const out = rankEntries([a, b, disabled], "");
    expect(out.map((e) => e.key)).toEqual(["b", "a"]);
  });

  it("filters by haystack and ranks label-prefix matches first", () => {
    const prefix = entry({ key: "p", label: "qPCR run", haystack: "qpcr run" });
    const mid = entry({ key: "m", label: "old qpcr", haystack: "old qpcr" });
    const miss = entry({ key: "x", label: "western", haystack: "western" });
    const out = rankEntries([mid, prefix, miss], "qpcr");
    expect(out.map((e) => e.key)).toEqual(["p", "m"]);
  });
});

describe("entryToRef", () => {
  it("maps an index entry to an AttachedRef", () => {
    const e = entry({
      type: "datahub",
      key: "datahub:me:5",
      label: "Expression table",
      href: "/datahub?doc=5",
    });
    expect(entryToRef(e)).toEqual({
      type: "datahub",
      id: "datahub:me:5",
      name: "Expression table",
      deepLink: "/datahub?doc=5",
    });
  });
});
