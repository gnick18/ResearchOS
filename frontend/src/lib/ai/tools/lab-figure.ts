// Two BeakerBot lab-head tools for cross-member figures (the PI synthesis lane).
//
//  - lab_plots  (read-only): an inventory of every lab member's saved DataHub
//    plots, with the stable id the figure tool places. Pure discovery: the PI or
//    the model sees what plots exist and their ids. It NEVER interprets.
//  - lab_figure (action, non-destructive): compose chosen member plots into a
//    multi-panel figure PAGE the PI owns, laid out in a grid, and save it. It
//    returns a link to open the page. Panels are live references, so they update
//    when the member's data changes. It NEVER interprets the members' results.
//
// Both go through the AUDITED, PI-role-gated lab-scoped read (readWork). They
// mirror the lab-head tool pattern: a factory takes injected deps so the logic
// is unit-testable without the relay, crypto, audit, or disk, and the exported
// default instance wires the real collaborators.
//
// The figure is owned by the PI: createFigurePageDoc mints it under the head's
// own users/<owner>/figures prefix. That is the resolved ownership decision.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { AiTool } from "./types";
import { readLabMembersWork } from "@/lib/lab/lab-scoped-read";
import type { DataHubDocContent, PlotSpec } from "@/lib/datahub/model/types";
import { readPlotStyle } from "@/lib/datahub/plot-spec";
import {
  createFigurePageDoc,
  saveFigurePage,
} from "@/lib/figure/figure-page-store";
import {
  addPanel as addPanelToPage,
  pageSizeIn,
  PAGE_MARGIN_IN,
  GRID_GAP_IN,
  type FigurePage,
} from "@/lib/figure/figure-page";
import {
  LAB_MEMBER_PLOTS_TYPE,
  makeLabPlotId,
  renderLabMemberPlot,
} from "@/lib/lab/lab-member-plots-source";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Parse one member's datahub records into DataHubDocContent docs. */
function parseMemberDocs(
  records: Array<{ recordType: string; plaintext: Uint8Array }>,
): DataHubDocContent[] {
  const out: DataHubDocContent[] = [];
  for (const r of records) {
    if (r.recordType !== "datahub") continue;
    try {
      const text = new TextDecoder().decode(r.plaintext);
      const parsed = JSON.parse(text) as DataHubDocContent;
      if (parsed && parsed.meta && Array.isArray(parsed.plots)) {
        out.push(parsed);
      }
    } catch {
      // A corrupt or partially-synced record is skipped, never thrown.
    }
  }
  return out;
}

/** A short, human label for a plot kind, mirrored from the figure source. */
function kindLabel(spec: PlotSpec): string {
  const k = readPlotStyle(spec).kind;
  const map: Record<string, string> = {
    columnScatter: "column scatter",
    columnBar: "bar",
    groupedBar: "grouped bar",
    xyScatter: "XY",
    survivalCurve: "survival",
    estimationGardnerAltman: "estimation",
    estimationCumming: "estimation",
    pie: "pie",
    donut: "donut",
    stackedBar: "stacked bar",
  };
  return map[k] ?? k;
}

// ---------------------------------------------------------------------------
// lab_plots (read-only)
// ---------------------------------------------------------------------------

export interface LabPlotsDeps {
  readWork: typeof readLabMembersWork;
}

export function makeLabPlotsTool(deps: LabPlotsDeps): AiTool {
  return {
    name: "lab_plots",
    description:
      "List every lab member's saved Data Hub plots across the whole lab so you can see what figures exist and get each plot's id. Returns, per plot, its id (the owner::doc::plot string lab_figure needs), the member who owns it, the table it lives in, its kind, and its title. Pass member to restrict to one member's plots. Read-only. Every read is audited. Lab-head only. This is pure discovery; it never judges any member's results.",
    parameters: {
      type: "object",
      properties: {
        member: {
          type: "string",
          description:
            "Optional. Restrict the inventory to this member's username.",
        },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const member =
        typeof args.member === "string" ? args.member.trim() : "";

      const result = await deps.readWork({ recordTypes: ["datahub"] });
      if (!result.ok || result.members.length === 0) {
        return {
          hasLab: false,
          plots: [],
          byMember: {},
          note:
            result.error ??
            "No lab plot data is available. Either this account is not a lab head, no members have synced, or the lab is not reachable.",
        };
      }

      interface PlotEntry {
        plotId: string;
        member: string;
        table: string;
        kind: string;
        title: string | null;
      }

      const plots: PlotEntry[] = [];
      const byMember: Record<string, number> = {};

      for (const m of result.members) {
        if (member && m.owner !== member) continue;
        const docs = parseMemberDocs(m.records);
        for (const content of docs) {
          for (const plot of content.plots ?? []) {
            const title = readPlotStyle(plot).title?.trim() || null;
            plots.push({
              plotId: makeLabPlotId(m.owner, content.meta.id, plot.id),
              member: m.owner,
              table: content.meta.name,
              kind: kindLabel(plot),
              title,
            });
            byMember[m.owner] = (byMember[m.owner] ?? 0) + 1;
          }
        }
      }

      return {
        hasLab: true,
        totalPlots: plots.length,
        plots,
        byMember,
        note:
          "These are the lab's saved Data Hub plots. Use a plotId with lab_figure to compose a figure. The tool reports the plots only; it does not interpret any result.",
      };
    },
  };
}

// ---------------------------------------------------------------------------
// lab_figure (action, non-destructive)
// ---------------------------------------------------------------------------

export interface LabFigureDeps {
  /** Mint a PI-owned figure page (under the head's own figures prefix). */
  createPage: (
    name: string,
    collectionId: string | null,
  ) => Promise<FigurePage>;
  /** Persist the composed page. */
  savePage: (page: FigurePage) => Promise<void>;
  /** Render one lab-member plot at a real-inch box, for the natural aspect. */
  renderPlot: typeof renderLabMemberPlot;
}

/** The default render opts for a one-off aspect probe (light theme, 96 dpi). */
const PROBE_OPTS = {
  widthIn: 3,
  heightIn: 2.4,
  dpi: 96,
  theme: "light" as const,
};

export function makeLabFigureTool(deps: LabFigureDeps): AiTool {
  return {
    name: "lab_figure",
    description:
      "Compose chosen lab-member plots into a multi-panel figure page that YOU (the PI) own, laid out in a grid, then save it and return a link to open it. Pass plotIds (the owner::doc::plot ids from lab_plots), an optional title, and an optional columns count (grid width, default 2). Each panel is a LIVE reference to the member's plot, so it updates when their data changes. This is an action and runs only after you confirm. Non-destructive. Lab-head only. It composes the plots; it never judges any member's results.",
    parameters: {
      type: "object",
      properties: {
        plotIds: {
          type: "array",
          items: { type: "string" },
          description:
            "The plot ids to place, each an owner::doc::plot string from lab_plots.",
        },
        title: {
          type: "string",
          description:
            "Optional title for the figure page. Defaults to 'Lab figure'.",
        },
        columns: {
          type: "number",
          description:
            "Optional grid width (number of columns). Default 2.",
        },
      },
      required: ["plotIds"],
      additionalProperties: false,
    },
    action: true,
    isDestructive: () => false,
    describeAction: (args) => {
      const ids = Array.isArray(args.plotIds) ? args.plotIds : [];
      const title =
        typeof args.title === "string" && args.title.trim()
          ? args.title.trim()
          : "Lab figure";
      const cols =
        typeof args.columns === "number" && args.columns > 0
          ? Math.floor(args.columns)
          : 2;
      return {
        summary: `Create a figure you own called "${title}" with ${ids.length} member plot${ids.length === 1 ? "" : "s"} in a ${cols}-column grid.`,
      };
    },
    execute: async (args) => {
      const plotIds = Array.isArray(args.plotIds)
        ? args.plotIds.filter((x): x is string => typeof x === "string")
        : [];
      const title =
        typeof args.title === "string" && args.title.trim()
          ? args.title.trim()
          : "Lab figure";
      const columns =
        typeof args.columns === "number" && args.columns >= 1
          ? Math.floor(args.columns)
          : 2;

      if (plotIds.length === 0) {
        return {
          ok: false,
          error:
            "plotIds is required and must list at least one plot id. Call lab_plots first to get the ids.",
        };
      }

      // Mint the PI-owned page.
      let page: FigurePage;
      try {
        page = await deps.createPage(title, null);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      // Lay panels out in a `columns`-wide grid across the page content area.
      // Each cell width is the usable width split into `columns` columns with a
      // gap between them; the cell height matches the cell width over the plot's
      // natural aspect (best-effort aspect preservation), capped to the cell.
      const { wIn, hIn } = pageSizeIn(page);
      const usableW = Math.max(0.1, wIn - 2 * PAGE_MARGIN_IN);
      const usableH = Math.max(0.1, hIn - 2 * PAGE_MARGIN_IN);
      const cellW = (usableW - (columns - 1) * GRID_GAP_IN) / columns;
      // Reserve a little vertical room per row for the label; rows can overflow
      // the page on a tall stack, the PI rearranges in the composer.
      const rows = Math.ceil(plotIds.length / columns);
      const maxCellH = (usableH - (rows - 1) * GRID_GAP_IN) / Math.max(1, rows);

      let placed = 0;
      const missing: string[] = [];

      for (let i = 0; i < plotIds.length; i++) {
        const id = plotIds[i];
        // Render once to get the natural aspect (best-effort; a missing plot
        // is still placed with a default aspect so the panel is a visible
        // not-found rather than silently dropped).
        let aspect = 1.25;
        try {
          const rendered = await deps.renderPlot(id, PROBE_OPTS);
          if (rendered) {
            aspect = rendered.naturalAspect > 0 ? rendered.naturalAspect : 1.25;
          } else {
            missing.push(id);
          }
        } catch {
          missing.push(id);
        }

        // Size the panel to the grid cell, aspect-aware, height-capped.
        const col = i % columns;
        const row = Math.floor(i / columns);
        let w = cellW;
        let h = w / Math.max(0.2, aspect);
        if (h > maxCellH) {
          h = maxCellH;
          w = h * aspect;
          if (w > cellW) w = cellW;
        }
        const xIn = PAGE_MARGIN_IN + col * (cellW + GRID_GAP_IN);
        const yIn = PAGE_MARGIN_IN + row * (maxCellH + GRID_GAP_IN);

        // addPanel appends with its own default sizing; we then override the
        // panel's box to the computed grid cell so the layout is a true grid.
        const ref = { type: LAB_MEMBER_PLOTS_TYPE, id };
        const panelId = `p${i + 1}`;
        page = addPanelToPage(page, ref, panelId, aspect);
        page = {
          ...page,
          panels: page.panels.map((p) =>
            p.panelId === panelId
              ? { ...p, xIn, yIn, wIn: w, hIn: h }
              : p,
          ),
        };
        placed += 1;
      }

      try {
        await deps.savePage(page);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      return {
        ok: true,
        figureId: page.id,
        link: `/figures/${page.id}`,
        panelCount: placed,
        ...(missing.length > 0 ? { unresolvedPlotIds: missing } : {}),
        note: "Created a figure you own. Panels reference each member's live plot, so they update when the member's data changes.",
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Default instances (real deps)
// ---------------------------------------------------------------------------

export const labPlotsTool = makeLabPlotsTool({ readWork: readLabMembersWork });

export const labFigureTool = makeLabFigureTool({
  createPage: (name, collectionId) => createFigurePageDoc(name, collectionId),
  savePage: (page) => saveFigurePage(page),
  renderPlot: renderLabMemberPlot,
});
