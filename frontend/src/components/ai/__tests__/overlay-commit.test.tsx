import { describe, it, expect, vi, beforeEach } from "vitest";

// The chat host commit orchestrates phylo + datahub primitives + the engine.
// Mock all of them so we can assert: (a) a resolvable selection persists a spliced
// overlay panel + navigates, and (b) an UNRESOLVED selection (column already on the
// tree, not reported by the engine) FAILS loudly instead of a silent false success.

const h = vi.hoisted(() => ({
  getMock: vi.fn(),
  updateMetaMock: vi.fn(async () => ({})),
  mergeMock: vi.fn(),
  navMock: vi.fn(),
}));
const { getMock, updateMetaMock, mergeMock, navMock } = h;

vi.mock("@/lib/phylo/api", () => ({
  phyloApi: { get: h.getMock, updateMeta: h.updateMetaMock },
}));
vi.mock("@/lib/datahub/api", () => ({
  dataHubApi: { getContent: vi.fn(async () => ({ columns: [], rows: [] })) },
}));
vi.mock("@/lib/phylo/parse", () => ({
  parseTree: vi.fn(() => ({ id: 0, name: "root", children: [] })),
  leaves: vi.fn(() => [{}, {}]),
}));
vi.mock("@/lib/phylo/smart-binding", () => ({
  mergeTableColumnsIntoMetadata: h.mergeMock,
}));
vi.mock("@/lib/phylo/panels", () => ({
  projectTracksToPanels: vi.fn(() => [{ id: "labels-0", kind: "labels", visible: true }]),
}));
vi.mock("@/components/phylo/PhyloLayers", () => ({
  makePanel: vi.fn((kind: string, cols: string[]) => ({
    id: `${kind}-x`,
    kind,
    column: cols[0],
    visible: true,
  })),
}));
vi.mock("@/components/ai/navigation-bridge", () => ({
  requestNavigation: h.navMock,
}));

import { applyOverlayCommit } from "../overlay-commit";

const SELECTION = { columnId: "mic", columnName: "MIC", geom: "heat" as const };

beforeEach(() => {
  vi.clearAllMocks();
  getMock.mockResolvedValue({
    tree: "(A,B);",
    meta: {
      id: "3",
      name: "Phase4 Tree",
      figure: { layout: "rectangular", branchLengths: true, tracks: {}, panels: [{ id: "labels-0", kind: "labels", visible: true }] },
      metadata: { tipColumn: "tip", rows: [{ tip: "A" }] },
    },
  });
});

describe("applyOverlayCommit", () => {
  it("persists a spliced overlay panel (bound to the merged name) and navigates", async () => {
    mergeMock.mockReturnValue({
      rows: [{ tip: "A", MIC: "1.2" }],
      tipColumn: "tip",
      addedColumns: [{ columnId: "mic", name: "MIC" }],
    });

    const res = await applyOverlayCommit({
      treeId: "3",
      tableId: "t1",
      tableName: "resistance_assay",
      joinColumnId: "strain_id",
      selections: [SELECTION],
    });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.treeName).toBe("Phase4 Tree");
    expect(updateMetaMock).toHaveBeenCalledTimes(1);
    const patch = (updateMetaMock.mock.calls[0] as unknown[])[1] as {
      figure: { panels: { kind: string; column?: string }[] };
    };
    const heat = patch.figure.panels.find((p) => p.kind === "heat");
    expect(heat).toBeTruthy();
    expect(heat?.column).toBe("MIC");
    // Spliced BEFORE the labels panel (labels stays outermost).
    const kinds = patch.figure.panels.map((p) => p.kind);
    expect(kinds.indexOf("heat")).toBeLessThan(kinds.indexOf("labels"));
    // No navigation: the chat host shows the result as an inline card in place.
    expect(navMock).not.toHaveBeenCalled();
  });

  it("fails loudly (no false success) when no selection resolves to a panel", async () => {
    // The engine reports NO bound name for the column (e.g. already on the tree
    // and not yet reused), so no panel can be built.
    mergeMock.mockReturnValue({
      rows: [{ tip: "A", MIC: "1.2" }],
      tipColumn: "tip",
      addedColumns: [],
    });

    const res = await applyOverlayCommit({
      treeId: "3",
      tableId: "t1",
      tableName: "resistance_assay",
      joinColumnId: "strain_id",
      selections: [SELECTION],
    });

    expect(res.ok).toBe(false);
    expect(updateMetaMock).not.toHaveBeenCalled();
    expect(navMock).not.toHaveBeenCalled();
  });
});
