// Tests for the two cross-member figure tools, lab_plots (read-only discovery)
// and lab_figure (action, composes a PI-owned figure page).
//
// Each tool is built via its factory with mock deps so the inventory shape, the
// page-creation grid, and the degrade paths are exercised without the relay,
// crypto, audit, or disk.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";

// Stub the lab readers so importing lab-figure does not eagerly pull the relay /
// local-api graph (mirrors lab-head.test.ts). The default tool instances import
// these, but the tests exercise the factories with injected mocks.
vi.mock("@/lib/lab/lab-scoped-read", () => ({ readLabMembersWork: vi.fn() }));
vi.mock("@/lib/figure/figure-page-store", () => ({
  createFigurePageDoc: vi.fn(),
  saveFigurePage: vi.fn(),
}));
vi.mock("@/lib/lab/lab-member-plots-source", async (importActual) => {
  // Keep the real id helpers + type constant; only stub the heavy renderer.
  const actual = await importActual<
    typeof import("@/lib/lab/lab-member-plots-source")
  >();
  return {
    ...actual,
    renderLabMemberPlot: vi.fn(),
  };
});

import {
  makeLabPlotsTool,
  makeLabFigureTool,
  type LabPlotsDeps,
  type LabFigureDeps,
} from "../lab-figure";
import {
  createFigurePage,
  type FigurePage,
} from "@/lib/figure/figure-page";
import type { PlotSpec } from "@/lib/datahub/model/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal real PlotSpec readPlotStyle / readPlotSource tolerate. */
function makePlot(id: string, title: string, kind = "columnBar"): PlotSpec {
  return {
    id,
    type: kind,
    style: { kind, title },
    source: {},
  };
}

/** A datahub record carrying a DataHubDocContent with the given plots. */
function makeDatahubRecord(
  docId: string,
  docName: string,
  plots: PlotSpec[],
): { recordType: string; recordId: string; plaintext: Uint8Array } {
  const content = {
    meta: { id: docId, name: docName, project_ids: [], folder_path: null, table_type: "column", created_at: "2026-01-01" },
    columns: [],
    rows: [],
    analyses: [],
    plots,
  };
  return {
    recordType: "datahub",
    recordId: docId,
    plaintext: new TextEncoder().encode(JSON.stringify(content)),
  };
}

function makeReadResult(
  members: Array<{
    owner: string;
    records: Array<{ recordType: string; recordId: string; plaintext: Uint8Array }>;
    error?: string;
  }>,
) {
  return { ok: true as const, members };
}

// ---------------------------------------------------------------------------
// lab_plots
// ---------------------------------------------------------------------------

describe("lab_plots", () => {
  it("returns an inventory of every member's plots with stable ids", async () => {
    const deps: LabPlotsDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeDatahubRecord("10", "Growth", [
                makePlot("pA", "Growth curve", "xyScatter"),
                makePlot("pB", "Bar of means", "columnBar"),
              ]),
            ],
          },
          {
            owner: "bob",
            records: [
              makeDatahubRecord("4", "Assay", [makePlot("pZ", "", "pie")]),
            ],
          },
        ]),
    };

    const tool = makeLabPlotsTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    expect(res.hasLab).toBe(true);
    expect(res.totalPlots).toBe(3);

    const plots = res.plots as Array<Record<string, unknown>>;
    const ids = plots.map((p) => p.plotId);
    expect(ids).toContain("alice::10::pA");
    expect(ids).toContain("alice::10::pB");
    expect(ids).toContain("bob::4::pZ");

    // Title falls back to table name + kind when the plot has no title.
    const bobPlot = plots.find((p) => p.plotId === "bob::4::pZ")!;
    expect(bobPlot.member).toBe("bob");
    expect(bobPlot.table).toBe("Assay");
    expect(bobPlot.kind).toBe("pie");
    expect(bobPlot.title).toBeNull();

    const byMember = res.byMember as Record<string, number>;
    expect(byMember.alice).toBe(2);
    expect(byMember.bob).toBe(1);
  });

  it("restricts the inventory to one member when member is passed", async () => {
    const deps: LabPlotsDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [makeDatahubRecord("10", "Growth", [makePlot("pA", "A")])],
          },
          {
            owner: "bob",
            records: [makeDatahubRecord("4", "Assay", [makePlot("pZ", "Z")])],
          },
        ]),
    };

    const tool = makeLabPlotsTool(deps);
    const res = (await tool.execute({ member: "bob" })) as Record<string, unknown>;
    const plots = res.plots as Array<Record<string, unknown>>;
    expect(plots).toHaveLength(1);
    expect(plots[0].plotId).toBe("bob::4::pZ");
  });

  it("degrades to hasLab false when there is no lab", async () => {
    const deps: LabPlotsDeps = {
      readWork: async () => ({
        ok: false as const,
        error: "this account is not bound to a lab",
        members: [],
      }),
    };
    const tool = makeLabPlotsTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    expect(res.hasLab).toBe(false);
    expect((res.plots as unknown[]).length).toBe(0);
    expect(typeof res.note).toBe("string");
  });

  it("is read-only (no action flag)", () => {
    const tool = makeLabPlotsTool({ readWork: vi.fn() });
    expect(tool.action).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// lab_figure
// ---------------------------------------------------------------------------

describe("lab_figure", () => {
  it("has action:true, isDestructive returns false, and describes the action", () => {
    const tool = makeLabFigureTool({
      createPage: vi.fn(),
      savePage: vi.fn(),
      renderPlot: vi.fn(),
    });
    expect(tool.action).toBe(true);
    expect(tool.isDestructive?.({})).toBe(false);
    const desc = tool.describeAction?.({
      plotIds: ["alice::10::pA", "bob::4::pZ"],
      title: "Figure 1",
    });
    expect(desc?.summary).toContain("Figure 1");
    expect(desc?.summary).toContain("2 member plots");
  });

  it("creates a PI-owned page, places one panel per plot in a grid, and saves it", async () => {
    let saved: FigurePage | null = null;
    const createPage = vi.fn(async (name: string) =>
      createFigurePage("99", name, null),
    );
    const savePage = vi.fn(async (page: FigurePage) => {
      saved = page;
    });
    // The compose tool uses naturalAspect for layout, not the svg body, so a
    // plain marker string stands in (and keeps an inline-svg literal out of this
    // test file, which the icon-guard would otherwise flag).
    const renderPlot = vi.fn(async () => ({ svg: "stub-svg", naturalAspect: 1.5 }));

    const deps: LabFigureDeps = { createPage, savePage, renderPlot };
    const tool = makeLabFigureTool(deps);

    const res = (await tool.execute({
      plotIds: ["alice::10::pA", "alice::10::pB", "bob::4::pZ"],
      title: "Cross-member figure",
      columns: 2,
    })) as Record<string, unknown>;

    expect(res.ok).toBe(true);
    expect(res.figureId).toBe("99");
    expect(res.link).toBe("/figures/99");
    expect(res.panelCount).toBe(3);

    expect(createPage).toHaveBeenCalledWith("Cross-member figure", null);
    expect(savePage).toHaveBeenCalledTimes(1);
    expect(saved).not.toBeNull();
    const page = saved as unknown as FigurePage;
    expect(page.panels).toHaveLength(3);
    // Each panel references the lab-member-plots source.
    for (const panel of page.panels) {
      expect(panel.ref.type).toBe("lab_member_plots");
    }
    // Grid: 3 plots, 2 columns -> row 0 has two panels (same yIn), col 0 then 1.
    const [p0, p1, p2] = page.panels;
    expect(p0.yIn).toBeCloseTo(p1.yIn, 5); // same row
    expect(p1.xIn).toBeGreaterThan(p0.xIn); // second column is to the right
    expect(p2.yIn).toBeGreaterThan(p0.yIn); // third panel wraps to the next row
    expect(p2.xIn).toBeCloseTo(p0.xIn, 5); // wraps back to the first column
  });

  it("degrades on an empty plotIds list without creating a page", async () => {
    const createPage = vi.fn();
    const deps: LabFigureDeps = {
      createPage,
      savePage: vi.fn(),
      renderPlot: vi.fn(),
    };
    const tool = makeLabFigureTool(deps);
    const res = (await tool.execute({ plotIds: [] })) as Record<string, unknown>;
    expect(res.ok).toBe(false);
    expect(typeof res.error).toBe("string");
    expect(createPage).not.toHaveBeenCalled();
  });

  it("flags unresolved plot ids but still saves the page", async () => {
    const createPage = vi.fn(async (name: string) =>
      createFigurePage("7", name, null),
    );
    const renderPlot = vi.fn(async () => null); // every plot fails to resolve
    const deps: LabFigureDeps = {
      createPage,
      savePage: vi.fn(),
      renderPlot,
    };
    const tool = makeLabFigureTool(deps);
    const res = (await tool.execute({
      plotIds: ["ghost::1::x"],
    })) as Record<string, unknown>;
    expect(res.ok).toBe(true);
    expect(res.panelCount).toBe(1);
    expect(res.unresolvedPlotIds).toEqual(["ghost::1::x"]);
  });
});
