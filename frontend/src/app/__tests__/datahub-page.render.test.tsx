import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  CellValue,
  DataHubDocContent,
  DataHubDocument,
} from "@/lib/datahub/model/types";

/**
 * Data Hub slice 1: the tab skeleton (collection filter + foldered Data Tables
 * tree + Results/Graphs empty states) plus the Column-table data-entry loop.
 *
 * Pins:
 *   - the rail, the collection filter, and a seeded data table render without
 *     crashing with the flag forced ON;
 *   - editing a cell flows through the (faked) Loro store and the footer's
 *     mean / SD / SEM / n recompute through the REAL engine.
 *
 * The Loro store + doc are faked with a tiny in-memory content holder so the
 * test never touches the File System Access API or the Loro WASM, while the grid
 * + footer (the real DataTableGrid, which calls the real engine `describe`) are
 * exercised end to end.
 */

// Flag ON so the route renders instead of the "not enabled" gate.
vi.mock("@/lib/datahub/config", () => ({ DATAHUB_ENABLED: true }));

vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "mira" }),
}));

// A seeded one-table catalog: a Column table with two groups and three rows.
const SEED_ROWS = [
  { id: "row-1", cells: { "col-1": 10 as CellValue, "col-2": 55 as CellValue } },
  { id: "row-2", cells: { "col-1": 20 as CellValue, "col-2": 60 as CellValue } },
  { id: "row-3", cells: { "col-1": 30 as CellValue, "col-2": 50 as CellValue } },
];

const SEED_META: DataHubDocument = {
  id: "1",
  name: "Cell viability assay",
  project_ids: [],
  folder_path: null,
  table_type: "column",
  created_at: "2026-06-10T00:00:00.000Z",
};

// A stored t-test analysis (Control vs Drug A), so a `?analysis=` deep-link test
// can assert the page lands on the result sheet. ResultsSheet recomputes from the
// content on render, so the spec needs only its type + column inputs to render the
// real t-test table; resultCache is left null. Seeded only when the deep-link test
// flips docState.seedAnalyses on (the other tests keep the empty-analyses default).
const SEED_TTEST = {
  id: "analysis-ttest-1",
  type: "unpairedTTest",
  params: {},
  inputs: { columnIds: ["col-1", "col-2"] },
  resultCache: null,
  resultStale: false,
};

// A stored column bar figure, so a `?plot=` deep-link test can assert the page
// lands on the figure (the Graphs editor) rather than the raw data grid. The
// engine draws the figure from the content on render, so the spec carries only
// its kind + source. Seeded only when docState.seedPlots is flipped on.
const SEED_PLOT = {
  id: "plot-1",
  type: "columnBar",
  style: { kind: "columnBar", errorBar: "sem" },
  source: { tableId: "1", analysisId: null },
};

function seedContent(): DataHubDocContent {
  return {
    meta: SEED_META,
    columns: [
      { id: "col-1", name: "Control", role: "y", dataType: "number" },
      { id: "col-2", name: "Drug A", role: "y", dataType: "number" },
    ],
    rows: SEED_ROWS.map((r) => ({ id: r.id, cells: { ...r.cells } })),
    analyses: docState.seedAnalyses ? [{ ...SEED_TTEST }] : [],
    plots: docState.seedPlots ? [{ ...SEED_PLOT }] : [],
  };
}

// The datahub page now transitively imports the BeakerBot AI tool registry,
// which reaches method-catalog.ts; that module reads methodsApi / pcrApi /
// lcGradientApi / plateApi / cellCultureApi / massSpecApi / filesApi from
// @/lib/local-api at module load. Spread the real module so those exports
// survive, and only stub projectsApi.list (what the page actually calls).
vi.mock("@/lib/local-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/local-api")>();
  return {
    ...actual,
    projectsApi: { ...actual.projectsApi, list: vi.fn(async () => []) },
  };
});

// The page renders NewAnalysisDialog, which calls useBeakerSearch. The tests
// render <DataHubPage/> without the provider, so stub the hook with a minimal
// no-op API (NewAnalysisDialog only uses openBeakerBot).
vi.mock("@/components/beaker-search/BeakerSearchProvider", async (io) => {
  const actual =
    await io<typeof import("@/components/beaker-search/BeakerSearchProvider")>();
  return {
    ...actual,
    useBeakerSearch: () => ({
      open: false,
      openPalette: () => {},
      closePalette: () => {},
      togglePalette: () => {},
      hasSource: false,
      openBeakerBot: () => {},
    }),
  };
});

vi.mock("@/lib/datahub/api", () => ({
  dataHubApi: {
    list: vi.fn(async (): Promise<DataHubDocument[]> => [SEED_META]),
    create: vi.fn(async () => SEED_META),
  },
}));

// The fake Loro doc holds the live content; setCell / addRow / addColumn mutate
// it, getDataHubContent returns a snapshot, and the store hands the page a
// minimal handle. This is enough for the page's edit -> reproject -> engine loop.
const { docState } = vi.hoisted(() => ({
  docState: {
    content: null as DataHubDocContent | null,
    // When true, seedContent includes the stored t-test, so the `?analysis=`
    // deep-link test can land on its result sheet. Off by default.
    seedAnalyses: false,
    // When true, seedContent includes the stored bar figure, so the `?plot=`
    // deep-link test can land on the Graphs editor. Off by default.
    seedPlots: false,
  },
}));

vi.mock("@/lib/loro/datahub-store", () => ({
  openDataHubDoc: vi.fn(async () => {
    docState.content = null; // reset per open; the test seeds via doc mock below
    return {
      doc: { __fake: true },
      commit: vi.fn(async () => {}),
      flush: vi.fn(async () => {}),
      subscribe: vi.fn(() => () => {}),
      close: vi.fn(async () => {}),
    };
  }),
}));

vi.mock("@/lib/loro/datahub-doc", () => ({
  getDataHubContent: vi.fn((): DataHubDocContent => {
    if (!docState.content) docState.content = seedContent();
    // Return a deep-ish copy so React sees a new object each reproject.
    return {
      ...docState.content,
      rows: docState.content.rows.map((r) => ({ id: r.id, cells: { ...r.cells } })),
    };
  }),
  setCell: vi.fn((_doc: unknown, rowId: string, columnId: string, value: CellValue) => {
    if (!docState.content) docState.content = seedContent();
    const row = docState.content.rows.find((r) => r.id === rowId);
    if (row) row.cells[columnId] = value;
  }),
  addRow: vi.fn((_doc: unknown, row: { id: string; cells: Record<string, CellValue> }) => {
    if (!docState.content) docState.content = seedContent();
    docState.content.rows.push({ id: row.id, cells: { ...row.cells } });
    return row.id;
  }),
  addColumn: vi.fn(),
}));

import DataHubPage from "../datahub/page";

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DataHubPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  docState.content = null;
  docState.seedAnalyses = false;
  docState.seedPlots = false;
  // Reset any deep-link query the prior test set, so each case starts clean.
  window.history.replaceState(null, "", "/datahub");
});

describe("DataHubPage — slice 1 skeleton + Column-table loop", () => {
  it("renders the rail, collection filter, and the seeded data table", async () => {
    renderPage();

    // The rail and its collection filter render.
    expect(await screen.findByTestId("datahub-rail")).toBeInTheDocument();
    expect(screen.getByTestId("datahub-collection-select")).toBeInTheDocument();

    // The seeded table opens and its grid renders.
    await screen.findByTestId("datahub-data-grid");
    expect(screen.getAllByText("Cell viability assay").length).toBeGreaterThan(0);

    // The open table auto-expands, so its Results + Graphs subgroups render
    // nested under it as empty-state placeholders.
    expect(await screen.findByTestId("datahub-results-section")).toBeInTheDocument();
    expect(screen.getByTestId("datahub-graphs-section")).toBeInTheDocument();
    expect(screen.getByText(/No analyses yet/i)).toBeInTheDocument();
    expect(screen.getByText(/No graphs yet/i)).toBeInTheDocument();
  });

  it("nests a stored analysis under its table in the rail family tree", async () => {
    docState.seedAnalyses = true;
    renderPage();

    // The open table auto-expands, so its Results subgroup is visible and the
    // analysis row lives INSIDE that nested section (the family tree), not in a
    // separate flat list.
    await screen.findByTestId("datahub-data-grid");
    const results = await screen.findByTestId("datahub-results-section");
    expect(
      await within(results).findByText(/Unpaired t-test/i),
    ).toBeInTheDocument();
  });

  it("recomputes the mean / SD / SEM / n footer when a cell is edited", async () => {
    renderPage();

    const grid = await screen.findByTestId("datahub-data-grid");

    // The Control group starts [10, 20, 30]: mean 20.
    const meanRow = await screen.findByTestId("datahub-footer-mean");
    await waitFor(() => {
      expect(within(meanRow).getByText("20.00")).toBeInTheDocument();
    });
    // n is 3 for the seeded group.
    expect(within(screen.getByTestId("datahub-footer-n")).getAllByText("3").length).toBeGreaterThan(0);

    // Edit the first Control replicate 10 -> 40. New group [40,20,30]: mean 30.
    const firstCell = within(grid).getByLabelText("Control replicate 1");
    fireEvent.change(firstCell, { target: { value: "40" } });
    fireEvent.blur(firstCell);

    await waitFor(() => {
      expect(within(screen.getByTestId("datahub-footer-mean")).getByText("30.00")).toBeInTheDocument();
    });
  });
});

describe("DataHubPage — analysis deep link (?doc=&analysis=)", () => {
  it("lands on the analysis result sheet, not the data grid, when ?analysis= names a stored analysis", async () => {
    // BeakerBot's run navigates here so the user sees the test RESULT.
    docState.seedAnalyses = true;
    window.history.replaceState(null, "", "/datahub?doc=1&analysis=analysis-ttest-1");
    renderPage();

    // The result sheet (the t-test table) is shown, not the raw replicate grid.
    expect(await screen.findByTestId("results-ttest-table")).toBeInTheDocument();
    expect(screen.queryByTestId("datahub-data-grid")).not.toBeInTheDocument();
  });

  it("falls back to the data grid when ?analysis= names an unknown analysis", async () => {
    // A stale or wrong analysis id must not error or leave the page stuck; the
    // table still opens on its data grid.
    docState.seedAnalyses = true;
    window.history.replaceState(null, "", "/datahub?doc=1&analysis=does-not-exist");
    renderPage();

    expect(await screen.findByTestId("datahub-data-grid")).toBeInTheDocument();
    expect(screen.queryByTestId("results-ttest-table")).not.toBeInTheDocument();
  });

  it("lands on the data grid when only ?doc= is present (backward compatible)", async () => {
    docState.seedAnalyses = true;
    window.history.replaceState(null, "", "/datahub?doc=1");
    renderPage();

    expect(await screen.findByTestId("datahub-data-grid")).toBeInTheDocument();
    expect(screen.queryByTestId("results-ttest-table")).not.toBeInTheDocument();
  });
});

describe("DataHubPage — figure deep link (?doc=&plot=)", () => {
  it("lands on the figure (the Graphs editor), not the data grid, when ?plot= names a stored plot", async () => {
    // BeakerBot's make_datahub_graph navigates here so the user sees the chart.
    docState.seedPlots = true;
    window.history.replaceState(null, "", "/datahub?doc=1&plot=plot-1");
    renderPage();

    // The Graphs editor (the figure) is shown, not the raw replicate grid.
    expect(await screen.findByTestId("datahub-graph-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("datahub-data-grid")).not.toBeInTheDocument();
  });

  it("falls back to the data grid when ?plot= names an unknown plot", async () => {
    docState.seedPlots = true;
    window.history.replaceState(null, "", "/datahub?doc=1&plot=does-not-exist");
    renderPage();

    expect(await screen.findByTestId("datahub-data-grid")).toBeInTheDocument();
    expect(screen.queryByTestId("datahub-graph-editor")).not.toBeInTheDocument();
  });

  it("lands on the data grid when only ?doc= is present (backward compatible)", async () => {
    docState.seedPlots = true;
    window.history.replaceState(null, "", "/datahub?doc=1");
    renderPage();

    expect(await screen.findByTestId("datahub-data-grid")).toBeInTheDocument();
    expect(screen.queryByTestId("datahub-graph-editor")).not.toBeInTheDocument();
  });
});
