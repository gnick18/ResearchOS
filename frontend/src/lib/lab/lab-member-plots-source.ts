// The cross-member FigureSource: a PI's figure composer lists every lab member's
// saved DataHub plot as a placeable panel, so the head can compose a multi-panel
// figure out of the lab's work. It mirrors the Data Hub FigureSource
// (lib/datahub/figure-source.ts), but its inventory comes from the AUDITED,
// PI-role-gated lab-scoped read (lib/lab/lab-scoped-read.ts) rather than the
// signed-in user's own documents.
//
// A figure id is "<owner>::<docId>::<plotId>" so a panel resolves to the exact
// member, the document, and the plot it draws. The "::" delimiter cannot collide
// with a real owner / doc / plot id (those never contain a literal "::").
//
// list() gates to the lab head: it reads the current account type via
// buildCurrentViewer (the same reader lab-scoped-read role-gates on) and returns
// [] for a non-head, so the source never appears for a member. render() resolves
// the member's content from a short-lived cache that list() populates, so a
// recompose does not re-pull the whole lab on every panel.
//
// editHref returns "#" because a PI cannot open another member's DataHub doc; the
// double-click stays inert rather than navigating to a 404.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { buildCurrentViewer } from "@/lib/local-api";
import { readLabMembersWork } from "@/lib/lab/lab-scoped-read";
import {
  renderPlot,
  readPlotStyle,
  readPlotSource,
  withStyle,
} from "@/lib/datahub/plot-spec";
import type {
  DataHubDocContent,
  PlotSpec,
  AnalysisSpec,
} from "@/lib/datahub/model/types";
import {
  registerFigureSource,
  missingPanelSvg,
  type FigureSource,
  type FigureRef,
  type RenderedFigure,
  type RenderOpts,
} from "@/lib/figure/figure-source";

/** The Data Hub FIG default aspect (w / h), mirrored from datahub/figure-source. */
const DEFAULT_ASPECT = 430 / 340;

/** The id delimiter. A real owner / doc / plot id never contains "::". */
const SEP = "::";

/** The source type, referenced by the lab_figure tool when it places panels. */
export const LAB_MEMBER_PLOTS_TYPE = "lab_member_plots";

// ---------------------------------------------------------------------------
// Id scheme
// ---------------------------------------------------------------------------

/** Build a "<owner>::<docId>::<plotId>" figure id. */
export function makeLabPlotId(
  owner: string,
  docId: string,
  plotId: string,
): string {
  return `${owner}${SEP}${docId}${SEP}${plotId}`;
}

/** Split a "<owner>::<docId>::<plotId>" id back into its parts. */
export function splitLabPlotId(
  id: string,
): { owner: string; docId: string; plotId: string } {
  const parts = id.split(SEP);
  return {
    owner: parts[0] ?? "",
    docId: parts[1] ?? "",
    plotId: parts[2] ?? "",
  };
}

// ---------------------------------------------------------------------------
// Account-type gate + injected deps (for tests)
// ---------------------------------------------------------------------------

/**
 * The collaborators this source composes. Defaults are the real wiring; tests
 * pass mocks so the gate + id round-trip are checkable without the relay.
 */
export interface LabMemberPlotsDeps {
  readWork: typeof readLabMembersWork;
  /** Resolve the current account type outside React (buildCurrentViewer wraps
   *  the same settings read useAccountType is built on). */
  getAccountType: () => Promise<string>;
}

const defaultDeps: LabMemberPlotsDeps = {
  readWork: readLabMembersWork,
  getAccountType: async () => (await buildCurrentViewer()).account_type,
};

// ---------------------------------------------------------------------------
// Short-lived cache (owner -> that member's DataHubDocContent[])
// ---------------------------------------------------------------------------
//
// readLabMembersWork pulls from the relay and decrypts, and render() runs per
// panel on every recompose. list() populates this cache, and render() reuses it
// within the TTL so one recompose does not re-pull the whole lab. The cache
// invalidates naturally by TTL (no explicit bust needed).

const CACHE_TTL_MS = 30_000;

let cacheByOwner = new Map<string, DataHubDocContent[]>();
let cacheStamp = 0;

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

/**
 * Pull every member's datahub docs through the audited lab-scoped read, keyed by
 * owner, and refresh the cache. Returns null when the read is refused (not a lab
 * head, no lab, lab unreachable) so the caller can degrade to an empty inventory.
 */
async function pullLabDocs(
  deps: LabMemberPlotsDeps,
): Promise<Map<string, DataHubDocContent[]> | null> {
  const result = await deps.readWork({ recordTypes: ["datahub"] });
  if (!result.ok) return null;
  const map = new Map<string, DataHubDocContent[]>();
  for (const member of result.members) {
    map.set(member.owner, parseMemberDocs(member.records));
  }
  cacheByOwner = map;
  cacheStamp = Date.now();
  return map;
}

/**
 * The lab docs for an owner, served from the cache when fresh, otherwise a fresh
 * pull. render() uses this so a recompose that touches many panels pulls once.
 */
async function getOwnerDocs(
  owner: string,
  deps: LabMemberPlotsDeps,
): Promise<DataHubDocContent[]> {
  const fresh = Date.now() - cacheStamp <= CACHE_TTL_MS;
  if (fresh && cacheByOwner.has(owner)) {
    return cacheByOwner.get(owner) ?? [];
  }
  const map = await pullLabDocs(deps);
  if (!map) return [];
  return map.get(owner) ?? [];
}

/** Test-only cache reset so a test starts cold. */
export function _clearLabMemberPlotsCache(): void {
  cacheByOwner = new Map();
  cacheStamp = 0;
}

// ---------------------------------------------------------------------------
// Plot helpers (mirrored from datahub/figure-source)
// ---------------------------------------------------------------------------

/** The intrinsic aspect of a plot, from its stored size or the FIG default. */
function plotNaturalAspect(spec: PlotSpec): number {
  const s = readPlotStyle(spec);
  if (s.width && s.height && s.width > 0 && s.height > 0) {
    return s.width / s.height;
  }
  return DEFAULT_ASPECT;
}

/** A short, human label for a plot kind, for the picker. */
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

/** Resolve the analysis a plot draws, from the doc's analyses. */
function resolveAnalysis(
  spec: PlotSpec,
  content: DataHubDocContent,
): AnalysisSpec | null {
  const source = readPlotSource(spec);
  return source.analysisId
    ? content.analyses?.find((a) => a.id === source.analysisId) ?? null
    : null;
}

/**
 * Size a plot to the panel's real-inch box and render it with the SAME path the
 * Data Hub editor uses, so a composed panel is numbers-identical to the source.
 */
function sizeAndRender(
  content: DataHubDocContent,
  plot: PlotSpec,
  opts: RenderOpts,
): { svg: string; naturalAspect: number } {
  const aspect = plotNaturalAspect(plot);
  const palette = opts.style?.options?.palette;
  const sized = withStyle(plot, {
    width: opts.widthIn,
    height: opts.heightIn,
    sizeUnit: "in",
    ...(opts.overrides?.hideTitle ? { title: "" } : {}),
    ...(typeof palette === "string" && palette ? { palette } : {}),
  }) as PlotSpec;
  const analysis = resolveAnalysis(sized, content);
  const { svg } = renderPlot(sized, content, analysis);
  return { svg, naturalAspect: aspect };
}

// ---------------------------------------------------------------------------
// The source factory
// ---------------------------------------------------------------------------

/**
 * Build the lab-member-plots FigureSource. Tests pass mocked deps; the exported
 * default instance uses the real audited read + account-type reader.
 */
export function makeLabMemberPlotsFigureSource(
  deps: LabMemberPlotsDeps = defaultDeps,
): FigureSource {
  return {
    type: LAB_MEMBER_PLOTS_TYPE,
    label: "Lab members' plots",

    async list(): Promise<FigureRef[]> {
      // Gate: only a lab head ever sees this source. A non-head gets an empty
      // list, so the picker never offers another member's plots to a member.
      const accountType = await deps.getAccountType();
      if (accountType !== "lab_head") return [];

      const map = await pullLabDocs(deps);
      if (!map) return [];

      const refs: FigureRef[] = [];
      for (const [owner, docs] of map) {
        for (const content of docs) {
          const docId = content.meta.id;
          for (const plot of content.plots ?? []) {
            const kind = kindLabel(plot);
            const title = readPlotStyle(plot).title?.trim();
            refs.push({
              id: makeLabPlotId(owner, docId, plot.id),
              type: LAB_MEMBER_PLOTS_TYPE,
              // The plot's own title when it has one, else table name + kind.
              name: title || `${content.meta.name} (${kind})`,
              // Group by member so the picker buckets plots per owner.
              group: owner,
              kind,
            });
          }
        }
      }
      return refs;
    },

    async render(id, opts): Promise<RenderedFigure> {
      const { owner, docId, plotId } = splitLabPlotId(id);
      if (!owner || !docId || !plotId) {
        return missingPanelSvg(opts.widthIn, opts.heightIn);
      }
      const docs = await getOwnerDocs(owner, deps);
      const content = docs.find((d) => d.meta.id === docId) ?? null;
      const plot = content?.plots?.find((p) => p.id === plotId) ?? null;
      if (!content || !plot) {
        return missingPanelSvg(opts.widthIn, opts.heightIn);
      }
      return sizeAndRender(content, plot, opts);
    },

    editHref(): string {
      // A PI cannot open another member's DataHub doc; keep the double-click
      // inert rather than navigating to a 404.
      return "#";
    },
  };
}

/** The default instance, real audited read + account-type reader. */
export const labMemberPlotsFigureSource = makeLabMemberPlotsFigureSource();

/** Register the lab-member-plots source. Called once from register-sources. */
export function registerLabMemberPlotsFigureSource(): void {
  registerFigureSource(labMemberPlotsFigureSource);
}

/**
 * Render one lab-member plot at a real-inch box, reusing the cache. Exposed so
 * the lab_figure tool can size + place a panel without re-implementing the pull,
 * the cache, or the renderPlot wiring. Returns the rendered SVG + the plot's
 * natural aspect, or null when the id no longer resolves.
 */
export async function renderLabMemberPlot(
  id: string,
  opts: RenderOpts,
  deps: LabMemberPlotsDeps = defaultDeps,
): Promise<{ svg: string; naturalAspect: number } | null> {
  const { owner, docId, plotId } = splitLabPlotId(id);
  if (!owner || !docId || !plotId) return null;
  const docs = await getOwnerDocs(owner, deps);
  const content = docs.find((d) => d.meta.id === docId) ?? null;
  const plot = content?.plots?.find((p) => p.id === plotId) ?? null;
  if (!content || !plot) return null;
  return sizeAndRender(content, plot, opts);
}
