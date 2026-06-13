// Tests for match_figure_style (PDF-reproduce Output 4, BeakerAI lane, 2026-06-13).
//
// Covers:
//   (a) sanitizeFigureSpec normalizes a loose / garbage input to a valid
//       PhyloFigureSpec (bad layout -> rectangular, missing branchLengths -> true,
//       missing tracks -> {}, passes through panels / legend / scales, and passes
//       AlignedPanel.options through as-is per the stable-but-untyped contract).
//   (b) treeRef path calls updateTreeMeta with the figure + navigates to
//       /phylo?doc=<id>#ros=studio.
//   (c) treeText path calls createTree with the figure and navigates using the
//       returned id.
//   (d) neither provided -> error result that does NOT write or navigate.
//
// Unit-tested with injected deps (phyloToolsDeps), no real folder. Mirrors the
// style of phylo-tools.test.ts.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  matchFigureStyleTool,
  sanitizeFigureSpec,
  sanitizeMetadataBinding,
  phyloToolsDeps,
} from "./phylo-tools";
import type { PhyloMeta } from "@/lib/phylo/api";
import type { RawPhyloFiles } from "@/lib/phylo/phylo-store";
import type { PhyloFigureSpec } from "@/lib/phylo/types";

function meta(over: Partial<PhyloMeta> = {}): PhyloMeta {
  return {
    id: "t1",
    name: "cyp51A tree",
    project_ids: [],
    added_at: "2026-06-12T00:00:00.000Z",
    format: "newick",
    tip_count: 42,
    ...over,
  } as PhyloMeta;
}

function rawFiles(over: Partial<PhyloMeta> = {}): RawPhyloFiles {
  return {
    meta: meta({ id: "9", name: "Reproduced figure", source: "paste", ...over }),
    tree: "(A,B);",
  };
}

beforeEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// (a) sanitizeFigureSpec
// ---------------------------------------------------------------------------

describe("sanitizeFigureSpec", () => {
  it("normalizes a garbage input to a valid default PhyloFigureSpec", () => {
    const spec = sanitizeFigureSpec({
      layout: "spiral", // not a valid PhyloLayout
      branchLengths: "yes", // not a boolean
      tracks: "nope", // not a record
    });
    expect(spec.layout).toBe("rectangular");
    expect(spec.branchLengths).toBe(true);
    expect(spec.tracks).toEqual({});
    expect(spec.legend).toBeUndefined();
    expect(spec.scales).toBeUndefined();
    expect(spec.panels).toBeUndefined();
  });

  it("defaults a totally absent / non-object input", () => {
    const spec = sanitizeFigureSpec(undefined);
    expect(spec).toEqual({ layout: "rectangular", branchLengths: true, tracks: {} });
  });

  it("keeps a valid layout and a false branchLengths (cladogram)", () => {
    const spec = sanitizeFigureSpec({ layout: "circular", branchLengths: false, tracks: {} });
    expect(spec.layout).toBe("circular");
    expect(spec.branchLengths).toBe(false);
  });

  it("drops non-boolean track entries", () => {
    const spec = sanitizeFigureSpec({
      tracks: { support: true, labels: "on", strip: false },
    });
    expect(spec.tracks).toEqual({ support: true, strip: false });
  });

  it("passes legend through when boolean", () => {
    expect(sanitizeFigureSpec({ legend: false }).legend).toBe(false);
    expect(sanitizeFigureSpec({ legend: "yes" }).legend).toBeUndefined();
  });

  it("passes well-formed scales through and drops malformed scale fields", () => {
    const spec = sanitizeFigureSpec({
      scales: { category: "brand", bar: "viridis", heat: { gc: "magma", bad: 7 } },
    });
    expect(spec.scales).toEqual({
      category: "brand",
      bar: "viridis",
      heat: { gc: "magma" },
    });
  });

  it("passes panels through and keeps AlignedPanel.options as-is (untyped contract)", () => {
    const spec = sanitizeFigureSpec({
      panels: [
        {
          id: "labels-1",
          kind: "labels",
          visible: true,
          options: { italic: true, fontSize: 11, align: "right" },
        },
        {
          id: "support-1",
          kind: "support",
          visible: true,
          options: { cutoff: 70 },
        },
      ],
    });
    expect(spec.panels).toHaveLength(2);
    // options pass through verbatim, the stable-but-untyped per-layer style bag.
    expect(spec.panels![0].options).toEqual({ italic: true, fontSize: 11, align: "right" });
    expect(spec.panels![1].options).toEqual({ cutoff: 70 });
    expect(spec.panels![0].kind).toBe("labels");
  });

  it("drops a panel with no usable kind and fills a missing id", () => {
    const spec = sanitizeFigureSpec({
      panels: [
        { kind: "notakind", visible: true }, // dropped
        { kind: "bars", visible: true, column: "expr" }, // kept, id filled
      ],
    });
    expect(spec.panels).toHaveLength(1);
    expect(spec.panels![0].kind).toBe("bars");
    expect(spec.panels![0].id).toBe("layer-1"); // index in the source array
    expect(spec.panels![0].column).toBe("expr");
  });

  it("omits panels entirely when none survive sanitization", () => {
    const spec = sanitizeFigureSpec({ panels: [{ kind: "junk" }, "nope", 5] });
    expect(spec.panels).toBeUndefined();
  });

  it("guards a scalar options value off a panel", () => {
    const spec = sanitizeFigureSpec({
      panels: [{ id: "p", kind: "strip", visible: true, options: "loud" }],
    });
    expect(spec.panels![0].options).toBeUndefined();
  });
});

describe("sanitizeMetadataBinding", () => {
  it("returns null without a usable tipColumn", () => {
    expect(sanitizeMetadataBinding(undefined)).toBeNull();
    expect(sanitizeMetadataBinding({})).toBeNull();
    expect(sanitizeMetadataBinding({ tipColumn: "  " })).toBeNull();
  });
  it("keeps a tip column plus column -> track bindings", () => {
    const b = sanitizeMetadataBinding({
      tipColumn: "taxon",
      categoryColumn: "host",
      barColumn: "expr",
      heatColumns: ["gc", "len", 7],
    });
    expect(b).toEqual({
      tipColumn: "taxon",
      categoryColumn: "host",
      barColumn: "expr",
      heatColumns: ["gc", "len"],
    });
  });
});

// ---------------------------------------------------------------------------
// match_figure_style tool
// ---------------------------------------------------------------------------

describe("match_figure_style tool", () => {
  it("is non-gated (action and previewable falsy)", () => {
    expect(matchFigureStyleTool.action).toBeFalsy();
    expect(matchFigureStyleTool.previewable).toBeFalsy();
  });

  // (b) treeRef path
  it("treeRef: writes the figure via updateTreeMeta and navigates to the studio deep link", async () => {
    vi.spyOn(phyloToolsDeps, "listTrees").mockResolvedValue([meta()]);
    const update = vi
      .spyOn(phyloToolsDeps, "updateTreeMeta")
      .mockResolvedValue(meta());
    const create = vi.spyOn(phyloToolsDeps, "createTree");
    const nav = vi.spyOn(phyloToolsDeps, "navigate").mockImplementation(() => {});

    const out = (await matchFigureStyleTool.execute({
      figure: { layout: "circular", branchLengths: false, tracks: { support: true } },
      treeRef: "cyp51A tree",
    })) as { ok: boolean; id: string; name: string; embed: string };

    expect(out.ok).toBe(true);
    expect(out.id).toBe("t1");
    expect(out.embed).toBe("[cyp51A tree](/phylo?doc=t1#ros=studio)");

    // updateTreeMeta called with the sanitized figure (no metadata key here).
    expect(update).toHaveBeenCalledTimes(1);
    const [calledId, patch] = update.mock.calls[0];
    expect(calledId).toBe("t1");
    const fig = (patch as { figure: PhyloFigureSpec }).figure;
    expect(fig.layout).toBe("circular");
    expect(fig.branchLengths).toBe(false);
    expect(fig.tracks).toEqual({ support: true });
    expect("metadata" in (patch as object)).toBe(false);

    // Navigated to the studio, did NOT create a tree.
    expect(nav).toHaveBeenCalledWith("/phylo?doc=t1#ros=studio");
    expect(create).not.toHaveBeenCalled();
  });

  it("treeRef: attaches metadata when the figure showed column tracks", async () => {
    vi.spyOn(phyloToolsDeps, "listTrees").mockResolvedValue([meta()]);
    const update = vi.spyOn(phyloToolsDeps, "updateTreeMeta").mockResolvedValue(meta());
    vi.spyOn(phyloToolsDeps, "navigate").mockImplementation(() => {});

    await matchFigureStyleTool.execute({
      figure: { layout: "rectangular", branchLengths: true, tracks: {} },
      treeRef: "t1",
      metadata: { tipColumn: "taxon", categoryColumn: "host" },
    });

    const patch = update.mock.calls[0][1] as { metadata?: { tipColumn: string } };
    expect(patch.metadata).toEqual({ tipColumn: "taxon", categoryColumn: "host" });
  });

  it("treeRef: errors (no write, no navigate) when the named tree is not found", async () => {
    vi.spyOn(phyloToolsDeps, "listTrees").mockResolvedValue([meta({ name: "Alpha" })]);
    const update = vi.spyOn(phyloToolsDeps, "updateTreeMeta");
    const nav = vi.spyOn(phyloToolsDeps, "navigate").mockImplementation(() => {});

    const out = (await matchFigureStyleTool.execute({
      figure: { layout: "rectangular", branchLengths: true, tracks: {} },
      treeRef: "ghost tree",
    })) as { ok: boolean; error: string };

    expect(out.ok).toBe(false);
    expect(out.error).toContain("Alpha");
    expect(update).not.toHaveBeenCalled();
    expect(nav).not.toHaveBeenCalled();
  });

  // (c) treeText path
  it("treeText: creates a tree with the figure and navigates using the returned id", async () => {
    const create = vi
      .spyOn(phyloToolsDeps, "createTree")
      .mockResolvedValue(rawFiles({ id: "9" }));
    const update = vi.spyOn(phyloToolsDeps, "updateTreeMeta");
    const nav = vi.spyOn(phyloToolsDeps, "navigate").mockImplementation(() => {});

    const out = (await matchFigureStyleTool.execute({
      figure: { layout: "slanted", branchLengths: true, tracks: {} },
      treeText: "(A,(B,C));",
      name: "My styled tree",
    })) as { ok: boolean; id: string; embed: string };

    expect(out.ok).toBe(true);
    expect(out.id).toBe("9");

    expect(create).toHaveBeenCalledTimes(1);
    const [tree, createMeta] = create.mock.calls[0];
    expect(tree).toBe("(A,(B,C));");
    expect(createMeta.name).toBe("My styled tree");
    expect(createMeta.source).toBe("paste");
    expect(createMeta.format).toBe("newick");
    expect(createMeta.project_ids).toEqual([]);
    expect(createMeta.figure!.layout).toBe("slanted");

    // Navigated using the returned id (9), not the name. Did NOT update an existing tree.
    expect(nav).toHaveBeenCalledWith("/phylo?doc=9#ros=studio");
    expect(update).not.toHaveBeenCalled();
  });

  it("treeText: defaults the name to 'Reproduced figure'", async () => {
    const create = vi
      .spyOn(phyloToolsDeps, "createTree")
      .mockResolvedValue(rawFiles({ id: "9", name: "Reproduced figure" }));
    vi.spyOn(phyloToolsDeps, "navigate").mockImplementation(() => {});

    await matchFigureStyleTool.execute({
      figure: { layout: "rectangular", branchLengths: true, tracks: {} },
      treeText: "(A,B);",
    });
    expect(create.mock.calls[0][1].name).toBe("Reproduced figure");
  });

  // (d) neither provided
  it("errors (no write, no navigate) when neither treeRef nor treeText is provided", async () => {
    const create = vi.spyOn(phyloToolsDeps, "createTree");
    const update = vi.spyOn(phyloToolsDeps, "updateTreeMeta");
    const nav = vi.spyOn(phyloToolsDeps, "navigate").mockImplementation(() => {});
    const list = vi.spyOn(phyloToolsDeps, "listTrees");

    const out = (await matchFigureStyleTool.execute({
      figure: { layout: "rectangular", branchLengths: true, tracks: {} },
    })) as { ok: boolean; error: string };

    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/your own tree/i);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(nav).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it("treats blank-string treeRef and treeText as not provided", async () => {
    const nav = vi.spyOn(phyloToolsDeps, "navigate").mockImplementation(() => {});
    const out = (await matchFigureStyleTool.execute({
      figure: {},
      treeRef: "   ",
      treeText: "",
    })) as { ok: boolean };
    expect(out.ok).toBe(false);
    expect(nav).not.toHaveBeenCalled();
  });
});
