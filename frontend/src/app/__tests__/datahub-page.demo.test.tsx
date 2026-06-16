/**
 * /datahub route gate vs demo mode.
 *
 * Data Hub is flag-gated (DATAHUB_ENABLED, default off). With the flag off, a
 * real production visit shows the calm not-enabled notice, but a demo session
 * renders the real surface so the public demo can showcase it.
 *
 * Pins:
 *   - flag off + not demo -> the not-enabled notice (prod default, unchanged);
 *   - flag off + demo      -> the real surface (the rail + a seeded table) renders.
 *
 * The flag is forced off, the client-only demo signal is mocked behind a holder,
 * and the Loro store + api are faked (mirrors datahub-page.render.test) so the
 * test never touches the File System Access API or Loro WASM.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  CellValue,
  DataHubDocContent,
  DataHubDocument,
} from "@/lib/datahub/model/types";

// Flag OFF so only the demo signal can open the surface.
vi.mock("@/lib/datahub/config", () => ({
  DATAHUB_ENABLED: false,
  BIGTABLE_ENABLED: false,
  isBigTableEnabled: () => false,
}));

const holder = vi.hoisted(() => ({ demo: false }));
vi.mock("@/lib/file-system/wiki-capture-mock", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/file-system/wiki-capture-mock")
    >();
  return { ...actual, getDemoMode: () => holder.demo };
});

vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "mira" }),
}));

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
    rows: [
      { id: "row-1", cells: { "col-1": 10 as CellValue, "col-2": 55 as CellValue } },
      { id: "row-2", cells: { "col-1": 20 as CellValue, "col-2": 60 as CellValue } },
    ],
    analyses: [],
    plots: [],
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

const { docState } = vi.hoisted(() => ({
  docState: { content: null as DataHubDocContent | null },
}));

vi.mock("@/lib/loro/datahub-store", () => ({
  openDataHubDoc: vi.fn(async () => {
    docState.content = null;
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
    return {
      ...docState.content,
      rows: docState.content.rows.map((r) => ({ id: r.id, cells: { ...r.cells } })),
    };
  }),
  setCell: vi.fn(),
  addRow: vi.fn(),
  addColumn: vi.fn(),
  updateColumn: vi.fn(),
  setAnalysis: vi.fn(),
  setPlot: vi.fn(),
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
  holder.demo = false;
});
afterEach(() => {
  holder.demo = false;
});

describe("DataHubPage — gate vs demo mode", () => {
  it("shows the not-enabled notice when the flag is off and it is not a demo", async () => {
    renderPage();
    expect(await screen.findByText(/Data Hub is not enabled/i)).toBeInTheDocument();
    expect(screen.queryByTestId("datahub-rail")).not.toBeInTheDocument();
  });

  it("renders the real surface in demo mode even with the flag off", async () => {
    holder.demo = true;
    renderPage();
    expect(await screen.findByTestId("datahub-rail")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getAllByText("Cell viability assay").length,
      ).toBeGreaterThan(0);
    });
    expect(
      screen.queryByText(/Data Hub is not enabled/i),
    ).not.toBeInTheDocument();
  });
});
