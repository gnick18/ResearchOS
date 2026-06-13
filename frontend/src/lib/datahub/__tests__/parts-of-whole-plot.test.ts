// parts-of-whole-plot.test.ts
//
// Render smoke tests for the three Parts-of-whole figures (pie, donut, stacked
// bar). There is NO statistic here (no test, no p-value), so the rigor is on the
// SEGMENTS: each kind lays out one segment per present category, the fractions
// sum to 1 (the segments sum to the whole), each segment is tagged with its
// category index for the color editor, and each kind serializes to a valid SVG
// string without throwing. Follows the estimation / diagnostic plot tests.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import type {
  DataHubDocContent,
  DataHubDocument,
} from "@/lib/datahub/model/types";
import {
  buildPlotSpec,
  readPlotStyle,
  renderPlot,
  defaultPlotStyle,
} from "@/lib/datahub/plot-spec";
import {
  layoutPartsOfWhole,
  renderPartsOfWholeSvg,
  isPartsOfWholeKind,
} from "@/lib/datahub/parts-of-whole-plot";
import {
  buildEmptyPartsOfWholeTable,
  CATEGORY_LABEL_COLUMN_ID,
  VALUE_COLUMN_ID,
} from "@/lib/datahub/parts-of-whole-table";

const META: DataHubDocument = {
  id: "tbl-pow",
  name: "Composition",
  project_ids: [],
  folder_path: null,
  table_type: "partsOfWhole",
  created_at: "2026-06-12T00:00:00.000Z",
};

/** A Parts-of-whole table with three positive categories (30 / 50 / 20). */
function content(): DataHubDocContent {
  const { columns } = buildEmptyPartsOfWholeTable(0);
  const rows = [
    ["T cells", 30],
    ["B cells", 50],
    ["NK cells", 20],
  ].map(([label, value], i) => ({
    id: `r${i}`,
    cells: { [CATEGORY_LABEL_COLUMN_ID]: label, [VALUE_COLUMN_ID]: value },
  }));
  return { meta: META, columns, rows, analyses: [], plots: [] };
}

describe("isPartsOfWholeKind", () => {
  it("matches the three parts-of-whole kinds only", () => {
    expect(isPartsOfWholeKind("pie")).toBe(true);
    expect(isPartsOfWholeKind("donut")).toBe(true);
    expect(isPartsOfWholeKind("stackedBar")).toBe(true);
    expect(isPartsOfWholeKind("columnBar")).toBe(false);
  });
});

describe("layout segments", () => {
  for (const kind of ["pie", "donut", "stackedBar"] as const) {
    it(`${kind}: one segment per category, fractions sum to 1`, () => {
      const style = { ...defaultPlotStyle(), kind };
      const geo = layoutPartsOfWhole(content(), style);
      expect(geo.kind).toBe(kind);
      expect(geo.segments).toHaveLength(3);
      const sum = geo.segments.reduce((a, s) => a + s.fraction, 0);
      expect(sum).toBeCloseTo(1, 10);
      expect(geo.segments.map((s) => s.percent)).toEqual([30, 50, 20]);
      // Each segment carries its category index for the color editor.
      expect(geo.segments.map((s) => s.index)).toEqual([0, 1, 2]);
      expect(geo.emptyMessage).toBeNull();
    });
  }

  it("donut hole radius respects the style ratio", () => {
    const style = { ...defaultPlotStyle(), kind: "donut" as const, donutHoleRatio: 0.5 };
    const geo = layoutPartsOfWhole(content(), style);
    expect(geo.innerRadius).toBeCloseTo(geo.radius * 0.5, 6);
  });

  it("pie has no inner radius", () => {
    const geo = layoutPartsOfWhole(content(), {
      ...defaultPlotStyle(),
      kind: "pie",
    });
    expect(geo.innerRadius).toBe(0);
  });

  it("an empty table lays out an empty-state, no segments", () => {
    const empty: DataHubDocContent = {
      meta: META,
      columns: buildEmptyPartsOfWholeTable(0).columns,
      rows: [],
      analyses: [],
      plots: [],
    };
    const geo = layoutPartsOfWhole(empty, { ...defaultPlotStyle(), kind: "pie" });
    expect(geo.segments).toHaveLength(0);
    expect(geo.emptyMessage).not.toBeNull();
  });
});

describe("SVG serialization", () => {
  for (const kind of ["pie", "donut", "stackedBar"] as const) {
    it(`${kind}: renders a valid SVG string with one tagged element per category`, () => {
      const style = { ...defaultPlotStyle(), kind };
      const geo = layoutPartsOfWhole(content(), style);
      const svg = renderPartsOfWholeSvg(geo, style);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
      // One data-series tagged element per category (a wedge or a bar segment).
      for (let i = 0; i < 3; i++) {
        expect(svg).toContain(`data-series="${i}"`);
      }
    });
  }

  it("the empty state still renders a valid SVG", () => {
    const empty: DataHubDocContent = {
      meta: META,
      columns: buildEmptyPartsOfWholeTable(0).columns,
      rows: [],
      analyses: [],
      plots: [],
    };
    const style = { ...defaultPlotStyle(), kind: "stackedBar" as const };
    const geo = layoutPartsOfWhole(empty, style);
    const svg = renderPartsOfWholeSvg(geo, style);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
  });
});

describe("renderPlot end to end", () => {
  for (const kind of ["pie", "donut", "stackedBar"] as const) {
    it(`${kind}: renderPlot drives the parts-of-whole pipeline`, () => {
      const spec = buildPlotSpec({
        id: `plot-${kind}`,
        kind,
        tableId: META.id,
      });
      expect(readPlotStyle(spec).kind).toBe(kind);
      const { svg } = renderPlot(spec, content(), null);
      expect(svg).toContain("<svg");
      expect(svg).toContain('data-series="0"');
    });
  }
});
