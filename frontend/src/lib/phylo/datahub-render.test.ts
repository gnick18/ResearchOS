// Phylo Phase 4 render core: a datahubPlot panel draws a tip-aligned Data Hub
// grouped-bar figure through the shared renderPlot seam, placed at the panel
// cursor. The figure NUMBERS are the Data Hub engine's (asserted in the datahub
// plot-spec suite); this confirms the phylo render path threads the resolved
// inputs in, hands over the tree's alignedAxis, and places the returned fragment.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { parseNewick } from "./parse";
import { layoutRectangular, rectTipAxis } from "./layout";
import { figureToRenderSpec } from "./figure-to-render";
import { renderTreeSvg, type RenderSpec } from "./render";
import { buildPlotSpec } from "@/lib/datahub/plot-spec";
import type { DataHubDocContent } from "@/lib/datahub/model/types";
import type { AlignedPanel } from "./types";

const TREE = parseNewick("(t1:1,t2:1);");
const LAYOUT_OPTS = {
  width: 460,
  height: 300,
  rightInset: 140,
  padding: 16,
  phylogram: true,
};
const NO_TRACKS = {
  labels: false,
  labelsItalic: false,
  points: false,
  strip: false,
  bars: false,
  heat: false,
  clade: false,
  support: false,
};

// Two tips, two series (Phylum A / B). The row label column carries the tree tip
// IDS (the join key the alignedAxis order matches), set per-test from the layout.
function abundanceContent(idA: string, idB: string): DataHubDocContent {
  return {
    meta: {
      id: "tg",
      name: "Abundance",
      project_ids: [],
      folder_path: null,
      table_type: "grouped",
      created_at: "2026-06-10T00:00:00.000Z",
    },
    columns: [
      { id: "rowlabel", name: "Tip", role: "x", dataType: "text" },
      { id: "a0", name: "Phylum A", role: "y", dataType: "number", datasetId: "d0", subcolumnKind: "replicate" },
      { id: "b0", name: "Phylum B", role: "y", dataType: "number", datasetId: "d1", subcolumnKind: "replicate" },
    ],
    rows: [
      { id: "r0", cells: { rowlabel: idA, a0: 2, b0: 8 } },
      { id: "r1", cells: { rowlabel: idB, a0: 6, b0: 6 } },
    ],
    analyses: [],
    plots: [],
  };
}

function specWithPanel(
  panels: AlignedPanel[],
  layout: "rectangular" | "circular",
  datahubPanels?: RenderSpec["datahubPanels"],
): RenderSpec {
  const base = figureToRenderSpec(
    TREE,
    { layout, phylogram: true, tracks: NO_TRACKS, panels },
    { width: 600, height: 300 },
  );
  return { ...base, datahubPanels };
}

describe("phylo render: datahubPlot tip-aligned panel (Phase 4 render core)", () => {
  const axis = rectTipAxis(TREE, layoutRectangular(TREE, LAYOUT_OPTS));
  const ids = axis.tips.map((t) => String(t.id));
  const panel: AlignedPanel = { id: "p1", kind: "datahubPlot", visible: true };
  const resolved = {
    p1: {
      plotSpec: buildPlotSpec({ id: "plot1", kind: "groupedBar", tableId: "tg" }),
      content: abundanceContent(ids[0], ids[1]),
      analysis: null,
    },
  };

  it("renders the tip-aligned grouped-bar fragment, placed at the panel cursor", () => {
    const withPanel = renderTreeSvg(TREE, specWithPanel([panel], "rectangular", resolved));
    const without = renderTreeSvg(TREE, specWithPanel([panel], "rectangular", {}));
    // A valid, closed SVG root either way.
    expect(withPanel.trimEnd().endsWith("</svg>")).toBe(true);
    // The resolved panel adds the Data Hub fragment, wrapped in a translate(x, 0)
    // group at the panel start cursor, with bar rects, so it is strictly larger.
    expect(withPanel.length).toBeGreaterThan(without.length);
    expect(withPanel).toMatch(/translate\([\d.]+,\s*0\)/);
    expect(withPanel).toContain("<rect");
  });

  it("draws nothing for the panel when its resolved inputs are absent (no throw)", () => {
    expect(() =>
      renderTreeSvg(TREE, specWithPanel([panel], "rectangular", {})),
    ).not.toThrow();
  });

  it("skips the datahubPlot panel in a circular layout (rectangular-only v1)", () => {
    // The adapter throws on a circular axis; the render path must catch + skip,
    // not crash the whole figure.
    expect(() =>
      renderTreeSvg(TREE, specWithPanel([panel], "circular", resolved)),
    ).not.toThrow();
  });

  it("shows the Data Hub series as a color key in the tree legend", () => {
    const legendPanel: AlignedPanel = { ...panel, legend: true };
    const svg = renderTreeSvg(
      TREE,
      specWithPanel([legendPanel], "rectangular", resolved),
    );
    // The grouped-bar series names are the panel's color key.
    expect(svg).toContain("Phylum A");
    expect(svg).toContain("Phylum B");
  });
});
