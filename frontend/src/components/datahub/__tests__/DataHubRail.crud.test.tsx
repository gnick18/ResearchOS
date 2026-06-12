// datahub-rail-crud bot. Tests for the rail right-click CRUD menus (phase 2b).
//
// The rail rows (a table, an analysis child, a figure child) each register a
// right-click menu through the shared ContextMenuProvider. The contract here.
//   - The table menu offers Rename / Duplicate / Delete, then Analyze / New graph
//     / Export, and fires the matching handler with the row id.
//   - The analysis menu offers Rename / Re-run / Make graph / Delete.
//   - The figure menu offers Rename / Duplicate / Export PNG / Export SVG / Delete.
//   - Rename swaps the row label for an inline input (no window.prompt) and
//     commits the typed name on Enter.
//   - The rail keeps showing spec.name when present, the computed label when not.
//
// The provider is mounted (not mocked) so openMenu runs through the real document
// event path, the same surface ContextMenuProvider.test.tsx exercises.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import { ContextMenuProvider } from "@/components/context-menu/ContextMenuProvider";
import DataHubRail from "../DataHubRail";
import type {
  AnalysisSpec,
  DataHubDocument,
  PlotSpec,
} from "@/lib/datahub/model/types";

afterEach(() => cleanup());

function rightClick(el: Element) {
  const ev = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: 40,
    clientY: 60,
  });
  act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
}

const table: DataHubDocument = {
  id: "t1",
  name: "Viability assay",
  project_ids: [],
  folder_path: null,
  table_type: "column",
  created_at: "2026-06-10T00:00:00Z",
};

const analysis: AnalysisSpec = {
  id: "a1",
  type: "unpairedTTest",
  params: {},
  inputs: {},
  resultCache: null,
  resultStale: false,
};

const namedAnalysis: AnalysisSpec = { ...analysis, id: "a2", name: "Primary t-test" };

const plot: PlotSpec = {
  id: "p1",
  type: "columnScatter",
  style: { title: "" },
  source: {},
};

const namedPlot: PlotSpec = { ...plot, id: "p2", name: "Figure 1", style: { title: "" } };

/** Render the rail with the open table selected (so its children show) plus a
 *  full set of handler spies. Returns the spies for assertions. */
function renderRail(
  over: {
    analyses?: AnalysisSpec[];
    plots?: PlotSpec[];
  } = {},
) {
  const spies = {
    onSelectTable: vi.fn(),
    onSelectAnalysis: vi.fn(),
    onSelectPlot: vi.fn(),
    onNewAnalysis: vi.fn(),
    onNewGraph: vi.fn(),
    onRenameTable: vi.fn(),
    onDuplicateTable: vi.fn(),
    onDeleteTable: vi.fn(),
    onExportTable: vi.fn(),
    onRenameAnalysis: vi.fn(),
    onDeleteAnalysis: vi.fn(),
    onReRunAnalysis: vi.fn(),
    onRenamePlot: vi.fn(),
    onDeletePlot: vi.fn(),
    onDuplicatePlot: vi.fn(),
    onExportPlotPng: vi.fn(),
    onExportPlotSvg: vi.fn(),
  };
  render(
    <ContextMenuProvider>
      <DataHubRail
        projects={[]}
        tables={[table]}
        collection="all"
        onCollectionChange={() => {}}
        selectedTableId={table.id}
        onSelectTable={spies.onSelectTable}
        onNewTable={() => {}}
        onNewFolder={() => {}}
        onImport={() => {}}
        onPlanStudy={() => {}}
        counts={{ all: 1, unfiled: 1, perProject: new Map() }}
        analyses={over.analyses ?? [analysis]}
        selectedAnalysisId={null}
        onSelectAnalysis={spies.onSelectAnalysis}
        onNewAnalysis={spies.onNewAnalysis}
        onGuidedAnalysis={() => {}}
        analysesEnabled
        plots={over.plots ?? [plot]}
        selectedPlotId={null}
        onSelectPlot={spies.onSelectPlot}
        onNewGraph={spies.onNewGraph}
        graphsEnabled
        onRenameTable={spies.onRenameTable}
        onDuplicateTable={spies.onDuplicateTable}
        onDeleteTable={spies.onDeleteTable}
        onExportTable={spies.onExportTable}
        onRenameAnalysis={spies.onRenameAnalysis}
        onDeleteAnalysis={spies.onDeleteAnalysis}
        onReRunAnalysis={spies.onReRunAnalysis}
        onRenamePlot={spies.onRenamePlot}
        onDeletePlot={spies.onDeletePlot}
        onDuplicatePlot={spies.onDuplicatePlot}
        onExportPlotPng={spies.onExportPlotPng}
        onExportPlotSvg={spies.onExportPlotSvg}
      />
    </ContextMenuProvider>,
  );
  return spies;
}

function menu() {
  return screen.getByTestId("sequence-context-menu");
}

describe("rail labels (spec.name with fallback)", () => {
  it("shows the computed label when an analysis / figure has no name", () => {
    renderRail();
    expect(screen.getByText("Unpaired t-test")).toBeInTheDocument();
    expect(screen.getByText("Column scatter")).toBeInTheDocument();
  });

  it("shows spec.name when present", () => {
    renderRail({ analyses: [namedAnalysis], plots: [namedPlot] });
    expect(screen.getByText("Primary t-test")).toBeInTheDocument();
    expect(screen.getByText("Figure 1")).toBeInTheDocument();
  });
});

describe("table row menu", () => {
  it("offers the full table vocabulary", () => {
    renderRail();
    rightClick(screen.getByText("Viability assay"));
    const m = menu();
    for (const label of ["Rename", "Duplicate", "Delete", "Analyze", "New graph", "Export (CSV)"]) {
      expect(within(m).getByRole("menuitem", { name: label })).toBeInTheDocument();
    }
  });

  it("Duplicate / Delete / Export fire with the table id", () => {
    const spies = renderRail();
    rightClick(screen.getByText("Viability assay"));
    fireEvent.click(within(menu()).getByRole("menuitem", { name: "Duplicate" }));
    expect(spies.onDuplicateTable).toHaveBeenCalledWith("t1");

    rightClick(screen.getByText("Viability assay"));
    fireEvent.click(within(menu()).getByRole("menuitem", { name: "Delete" }));
    expect(spies.onDeleteTable).toHaveBeenCalledWith("t1");

    rightClick(screen.getByText("Viability assay"));
    fireEvent.click(within(menu()).getByRole("menuitem", { name: "Export (CSV)" }));
    expect(spies.onExportTable).toHaveBeenCalledWith("t1");
  });

  it("Rename opens an inline input that commits the typed name on Enter", () => {
    const spies = renderRail();
    rightClick(screen.getByText("Viability assay"));
    fireEvent.click(within(menu()).getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByLabelText("Rename table") as HTMLInputElement;
    expect(input.value).toBe("Viability assay");
    fireEvent.change(input, { target: { value: "Renamed assay" } });
    // Enter blurs the input; the commit fires from onBlur (the same path a click
    // away takes). jsdom does not dispatch a synthetic blur from .blur(), so
    // drive it explicitly to mirror the Enter-then-blur sequence.
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(spies.onRenameTable).toHaveBeenCalledWith("t1", "Renamed assay");
  });
});

describe("analysis child menu", () => {
  it("offers Rename / Re-run / Make graph / Delete and fires them", () => {
    const spies = renderRail();
    const row = screen.getByText("Unpaired t-test");
    rightClick(row);
    const m = menu();
    for (const label of ["Rename", "Re-run", "Make graph", "Delete"]) {
      expect(within(m).getByRole("menuitem", { name: label })).toBeInTheDocument();
    }
    fireEvent.click(within(m).getByRole("menuitem", { name: "Re-run" }));
    expect(spies.onReRunAnalysis).toHaveBeenCalledWith("a1");

    rightClick(screen.getByText("Unpaired t-test"));
    fireEvent.click(within(menu()).getByRole("menuitem", { name: "Delete" }));
    expect(spies.onDeleteAnalysis).toHaveBeenCalledWith("a1");
  });

  it("Rename commits the typed name", () => {
    const spies = renderRail();
    rightClick(screen.getByText("Unpaired t-test"));
    fireEvent.click(within(menu()).getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByLabelText("Rename item") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "My test" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(spies.onRenameAnalysis).toHaveBeenCalledWith("a1", "My test");
  });
});

describe("figure child menu", () => {
  it("offers Rename / Duplicate / Export PNG / Export SVG / Delete and fires them", () => {
    const spies = renderRail();
    rightClick(screen.getByText("Column scatter"));
    const m = menu();
    for (const label of ["Rename", "Duplicate", "Export PNG", "Export SVG", "Delete"]) {
      expect(within(m).getByRole("menuitem", { name: label })).toBeInTheDocument();
    }
    fireEvent.click(within(m).getByRole("menuitem", { name: "Export PNG" }));
    expect(spies.onExportPlotPng).toHaveBeenCalledWith("p1");

    rightClick(screen.getByText("Column scatter"));
    fireEvent.click(within(menu()).getByRole("menuitem", { name: "Export SVG" }));
    expect(spies.onExportPlotSvg).toHaveBeenCalledWith("p1");

    rightClick(screen.getByText("Column scatter"));
    fireEvent.click(within(menu()).getByRole("menuitem", { name: "Duplicate" }));
    expect(spies.onDuplicatePlot).toHaveBeenCalledWith("p1");

    rightClick(screen.getByText("Column scatter"));
    fireEvent.click(within(menu()).getByRole("menuitem", { name: "Delete" }));
    expect(spies.onDeletePlot).toHaveBeenCalledWith("p1");
  });
});
