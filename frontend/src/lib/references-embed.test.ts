import { describe, it, expect } from "vitest";
import {
  parseObjectEmbed,
  buildObjectEmbedHref,
  objectEmbedMarkdown,
  objectReferenceMarkdown,
  swapEmbedView,
  setEmbedOpt,
  DEFAULT_EMBED_VIEW,
  type ObjectRefType,
} from "./references";

describe("parseObjectEmbed", () => {
  it("treats a plain object link as a chip (backward compatible)", () => {
    const d = parseObjectEmbed("/sequences?seq=2");
    expect(d).toEqual({
      type: "sequence",
      id: "2",
      view: "chip",
      isEmbed: false,
      opts: {},
    });
  });

  it("reads a block view from the #ros fragment", () => {
    const d = parseObjectEmbed("/sequences?seq=2#ros=map");
    expect(d?.view).toBe("map");
    expect(d?.isEmbed).toBe(true);
  });

  it("treats #ros=chip as an explicit chip, not an embed", () => {
    const d = parseObjectEmbed("/sequences?seq=2#ros=chip");
    expect(d?.view).toBe("chip");
    expect(d?.isEmbed).toBe(false);
  });

  it("parses string opts (region, ref, pin) and int opts (rows, w)", () => {
    const d = parseObjectEmbed(
      "/sequences?seq=2#ros=map&region=1-500&w=420&rows=8&ref=ik:LUKBXSAW&pin=2026-06-11T19:00:00Z",
    );
    expect(d?.opts).toEqual({
      region: "1-500",
      w: 420,
      rows: 8,
      ref: "ik:LUKBXSAW",
      pin: "2026-06-11T19:00:00Z",
    });
  });

  it("ignores a non-numeric int opt instead of crashing", () => {
    const d = parseObjectEmbed("/datahub?doc=2#ros=table&rows=abc");
    expect(d?.opts.rows).toBeUndefined();
    expect(d?.view).toBe("table");
  });

  it("carries a Data Hub sub-object id (analysis) in the fragment", () => {
    const d = parseObjectEmbed("/datahub?doc=2#ros=result&analysis=a3");
    expect(d).toMatchObject({ type: "datahub", id: "2", view: "result" });
    expect(d?.opts.analysis).toBe("a3");
  });

  it("resolves an absolute app URL with a fragment", () => {
    const d = parseObjectEmbed("https://research-os.app/chemistry?molecule=7#ros=card");
    expect(d).toMatchObject({ type: "molecule", id: "7", view: "card", isEmbed: true });
  });

  it("returns null for a non-object href", () => {
    expect(parseObjectEmbed("https://example.com/page#ros=map")).toBeNull();
    expect(parseObjectEmbed("")).toBeNull();
    expect(parseObjectEmbed(null)).toBeNull();
  });
});

describe("buildObjectEmbedHref", () => {
  it("builds a bare deep link for a chip (no fragment)", () => {
    expect(buildObjectEmbedHref("sequence", 2)).toBe("/sequences?seq=2");
    expect(buildObjectEmbedHref("sequence", 2, { view: "chip" })).toBe("/sequences?seq=2");
  });

  it("appends the view and opts as a fragment", () => {
    const href = buildObjectEmbedHref("sequence", 2, { view: "map", region: "1-500", w: 420 });
    const d = parseObjectEmbed(href);
    expect(d).toMatchObject({ type: "sequence", id: "2", view: "map" });
    expect(d?.opts).toMatchObject({ region: "1-500", w: 420 });
  });

  it("round-trips every opt through parse", () => {
    const href = buildObjectEmbedHref("datahub", "d1", {
      view: "result",
      analysis: "a3",
      pin: "2026-06-11T19:00:00Z",
      ref: "uuid:abc-123",
    });
    const d = parseObjectEmbed(href);
    expect(d?.view).toBe("result");
    expect(d?.opts).toMatchObject({
      analysis: "a3",
      pin: "2026-06-11T19:00:00Z",
      ref: "uuid:abc-123",
    });
  });
});

describe("markdown builders", () => {
  it("objectEmbedMarkdown writes [caption](href#ros=...)", () => {
    expect(objectEmbedMarkdown("sequence", 2, "pUC19 map", { view: "map" })).toBe(
      "[pUC19 map](/sequences?seq=2#ros=map)",
    );
  });

  it("objectReferenceMarkdown stays the bare mention form", () => {
    expect(objectReferenceMarkdown("sequence", 2, "pUC19")).toBe("[pUC19](/sequences?seq=2)");
  });

  it("dataset embed round-trips through parseObjectEmbed with view table (Phase 4)", () => {
    const md = objectEmbedMarkdown("dataset", "5", "Plate reads", { view: "table" });
    expect(md).toBe("[Plate reads](/datahub?dataset=5#ros=table)");
    // The link text is the href inside [caption](href).
    const href = md.slice(md.indexOf("(") + 1, -1);
    const d = parseObjectEmbed(href);
    expect(d).toMatchObject({
      type: "dataset",
      id: "5",
      view: "table",
      isEmbed: true,
    });
  });

  it("escapes brackets in the name so they cannot break the link", () => {
    const md = objectReferenceMarkdown("sequence", 2, "pGEX-3X [clone]");
    expect(md).toBe("[pGEX-3X \\[clone\\]](/sequences?seq=2)");
    // Parens in the name are fine and left as-is (valid CommonMark link text).
    expect(objectReferenceMarkdown("sequence", 2, "pGEX-3X (U13852)")).toBe(
      "[pGEX-3X (U13852)](/sequences?seq=2)",
    );
  });
});

describe("swapEmbedView", () => {
  it("swaps the view while preserving type and id", () => {
    expect(swapEmbedView("/sequences?seq=2#ros=map", "bases")).toBe(
      "/sequences?seq=2#ros=bases",
    );
  });

  it("preserves every opt across the swap", () => {
    const before = "/datahub?doc=2#ros=table&rows=8&cols=4&analysis=a3&pin=2026-06-11T19:00:00Z";
    const after = swapEmbedView(before, "result");
    const d = parseObjectEmbed(after);
    expect(d?.view).toBe("result");
    expect(d?.opts).toMatchObject({
      rows: 8,
      cols: 4,
      analysis: "a3",
      pin: "2026-06-11T19:00:00Z",
    });
  });

  it("preserves a sequence region opt", () => {
    const after = swapEmbedView("/sequences?seq=2#ros=map&region=1-500", "bases");
    const d = parseObjectEmbed(after);
    expect(d?.view).toBe("bases");
    expect(d?.opts.region).toBe("1-500");
  });

  it("returns a non-object href unchanged", () => {
    expect(swapEmbedView("https://example.com/page", "map")).toBe(
      "https://example.com/page",
    );
    expect(swapEmbedView("#some-anchor", "map")).toBe("#some-anchor");
    expect(swapEmbedView("mailto:a@b.com", "map")).toBe("mailto:a@b.com");
  });

  it("applies a view to a plain object link (it parses as an object ref)", () => {
    // A bare object link has view "chip". Swapping gives it a real block view,
    // which is what an insert-as-embed flow wants. Only truly non-object hrefs
    // are passed through untouched.
    expect(swapEmbedView("/sequences?seq=2", "map")).toBe("/sequences?seq=2#ros=map");
  });

  it("round-trips back to the original view byte-for-byte", () => {
    const original = "/datahub?doc=2#ros=table&rows=8&cols=4";
    const flipped = swapEmbedView(original, "plot");
    const back = swapEmbedView(flipped, "table");
    expect(back).toBe(original);
  });
});

describe("setEmbedOpt (pin fragment seam)", () => {
  it("adds a pin opt, preserving the view and other opts", () => {
    const after = setEmbedOpt("/sequences?seq=2#ros=map&region=1-500", "pin", "s_abc123");
    const d = parseObjectEmbed(after);
    expect(d?.view).toBe("map");
    expect(d?.opts.pin).toBe("s_abc123");
    expect(d?.opts.region).toBe("1-500");
  });

  it("removes the pin opt when value is null", () => {
    const after = setEmbedOpt("/datahub?doc=2#ros=table&pin=s_abc123&rows=8", "pin", null);
    const d = parseObjectEmbed(after);
    expect(d?.opts.pin).toBeUndefined();
    expect(d?.opts.rows).toBe(8);
    expect(d?.view).toBe("table");
  });

  it("add then remove returns the original href byte-for-byte", () => {
    const original = "/sequences?seq=2#ros=map&region=1-500";
    const pinned = setEmbedOpt(original, "pin", "s_abc123");
    expect(pinned).not.toBe(original);
    const unpinned = setEmbedOpt(pinned, "pin", null);
    expect(unpinned).toBe(original);
  });

  it("add then remove is byte-identical on a multi-opt Data Hub embed", () => {
    // Canonical opt order (string opts before int opts), the order a freshly built
    // embed produces. setEmbedOpt rebuilds through the same builder, so a canonical
    // href round-trips byte-for-byte. (A hand-authored non-canonical href is
    // normalized to canonical on the first rebuild, which is correct behavior.)
    const original = "/datahub?doc=2#ros=table&analysis=a3&rows=8&cols=4";
    const pinned = setEmbedOpt(original, "pin", "s_xy9zab");
    const unpinned = setEmbedOpt(pinned, "pin", null);
    expect(unpinned).toBe(original);
  });

  it("returns a non-object href unchanged", () => {
    expect(setEmbedOpt("https://example.com/page", "pin", "s_abc123")).toBe(
      "https://example.com/page",
    );
    expect(setEmbedOpt("mailto:a@b.com", "pin", null)).toBe("mailto:a@b.com");
  });

  it("an empty-string value clears the opt (same as null)", () => {
    const after = setEmbedOpt("/sequences?seq=2#ros=map&pin=s_abc123", "pin", "");
    expect(parseObjectEmbed(after)?.opts.pin).toBeUndefined();
  });
});

describe("DEFAULT_EMBED_VIEW", () => {
  it("has an entry for every object type", () => {
    const types: ObjectRefType[] = [
      "sequence",
      "collection",
      "method",
      "note",
      "file",
      "project",
      "molecule",
      "datahub",
      "task",
      "experiment",
    ];
    for (const t of types) expect(DEFAULT_EMBED_VIEW[t]).toBeTruthy();
  });

  it("defaults sequence to map and molecule to the identity card", () => {
    expect(DEFAULT_EMBED_VIEW.sequence).toBe("map");
    expect(DEFAULT_EMBED_VIEW.molecule).toBe("card");
  });
});

describe("transclusion section fragment (P7-2)", () => {
  it("parses a note transclude embed with an encoded section heading", () => {
    const d = parseObjectEmbed("/notes/5#ros=transclude&section=Lysis%20step");
    expect(d).toEqual({
      type: "note",
      id: "5",
      view: "transclude",
      isEmbed: true,
      opts: { section: "Lysis step" },
    });
  });

  it("round-trips the section opt through buildObjectEmbedHref", () => {
    const href = buildObjectEmbedHref("note", 5, {
      view: "transclude",
      section: "Lysis step",
    });
    expect(href).toBe("/notes/5#ros=transclude&section=Lysis+step");
    const d = parseObjectEmbed(href);
    expect(d?.view).toBe("transclude");
    expect(d?.opts.section).toBe("Lysis step");
  });

  it("a transclude with no section parses to an empty opts.section", () => {
    const d = parseObjectEmbed("/notes/9#ros=transclude");
    expect(d?.view).toBe("transclude");
    expect(d?.opts.section).toBeUndefined();
  });

  it("setEmbedOpt can add and clear the section opt", () => {
    const base = "/notes/3#ros=transclude";
    const withSection = setEmbedOpt(base, "section", "Results");
    expect(parseObjectEmbed(withSection)?.opts.section).toBe("Results");
    const cleared = setEmbedOpt(withSection, "section", null);
    expect(parseObjectEmbed(cleared)?.opts.section).toBeUndefined();
  });
});
