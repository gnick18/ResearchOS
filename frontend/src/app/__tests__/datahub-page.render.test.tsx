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

function seedContent(): DataHubDocContent {
  return {
    meta: SEED_META,
    columns: [
      { id: "col-1", name: "Control", role: "y", dataType: "number" },
      { id: "col-2", name: "Drug A", role: "y", dataType: "number" },
    ],
    rows: SEED_ROWS.map((r) => ({ id: r.id, cells: { ...r.cells } })),
    analyses: [],
    plots: [],
  };
}

vi.mock("@/lib/local-api", () => ({
  projectsApi: { list: vi.fn(async () => []) },
}));

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
  docState: { content: null as DataHubDocContent | null },
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
});

describe("DataHubPage — slice 1 skeleton + Column-table loop", () => {
  it("renders the rail, collection filter, and the seeded data table", async () => {
    renderPage();

    // The rail and its collection filter render.
    expect(await screen.findByTestId("datahub-rail")).toBeInTheDocument();
    expect(screen.getByTestId("datahub-collection-select")).toBeInTheDocument();

    // Results + Graphs are present as empty-state placeholders.
    expect(screen.getByTestId("datahub-results-section")).toBeInTheDocument();
    expect(screen.getByTestId("datahub-graphs-section")).toBeInTheDocument();
    expect(screen.getByText(/No analyses yet/i)).toBeInTheDocument();
    expect(screen.getByText(/No graphs yet/i)).toBeInTheDocument();

    // The seeded table opens and its grid renders.
    await screen.findByTestId("datahub-data-grid");
    expect(screen.getAllByText("Cell viability assay").length).toBeGreaterThan(0);
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
