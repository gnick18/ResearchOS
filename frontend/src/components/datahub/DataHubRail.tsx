"use client";

// The Data Hub left navigator rail (datahub-tab-p1, family-tree by datahub-chrome).
//   - a Collection filter (All / Unfiled / one project per the real project list)
//   - a foldered Data Tables tree, grouped by folder_path (collapsible folders,
//     a table-type tag per row, active highlight, New table + New folder)
//   - each table's RESULTS and GRAPHS nest UNDER the table they came from, a
//     family tree, indented with a left border, instead of three flat lists.
//
// Why the children only show under the open table: a Data Hub document carries
// its analyses + plots inside its own content, so only the open table's children
// are loaded. The selected table auto-expands to reveal its analyses and figures
// beneath it; selecting another table loads + reveals that one's family. This
// matches the indented nav in docs/mockups/datahub-table-results-audit.html.
//
// Icons: the registry has no dedicated analysis glyph, so an analysis row reuses
// "list" and the Results subhead reuses "tree" (a branching-diagram glyph); a
// figure uses "chart". Noted in the build report.
//
// House style: <Icon> only, Tooltip on icon-only buttons, brand + semantic
// tokens, no emojis / em-dashes / mid-sentence colons.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import { useOptionalContextMenu } from "@/components/context-menu/ContextMenuProvider";
import type { EditMenuItem } from "@/components/sequences/SequenceEditMenu";
import type { Project } from "@/lib/types";
import type {
  AnalysisSpec,
  DataHubDocument,
  PlotSpec,
} from "@/lib/datahub/model/types";
import { readPlotStyle } from "@/lib/datahub/plot-spec";
import { primarySourceId } from "@/lib/datahub/transform/recipe";

/** A short, human label for an analysis type (rail row text). */
function analysisLabel(type: string): string {
  switch (type) {
    case "oneWayAnova":
      return "One-way ANOVA";
    case "unpairedTTest":
      return "Unpaired t-test";
    case "pairedTTest":
      return "Paired t-test";
    case "mannWhitneyU":
      return "Mann-Whitney U";
    case "wilcoxonSignedRank":
      return "Wilcoxon signed-rank";
    case "kruskalWallis":
      return "Kruskal-Wallis";
    case "repeatedMeasuresAnova":
      return "Repeated-measures ANOVA";
    case "linearMixedModel":
      return "Linear mixed model";
    case "correlationPearson":
      return "Pearson correlation";
    case "correlationSpearman":
      return "Spearman correlation";
    case "linearRegression":
      return "Linear regression";
    case "twoWayAnova":
      return "Two-way ANOVA";
    case "kaplanMeier":
      return "Survival analysis";
    case "coxRegression":
      return "Cox proportional hazards";
    default:
      return type;
  }
}

/** A short, human label for a plot kind (rail row text). The figure's own
 *  title is used when it has been set, so a renamed figure reads naturally. */
function plotLabel(spec: PlotSpec): string {
  const style = readPlotStyle(spec);
  const title = style.title.trim();
  if (title !== "") return title;
  switch (style.kind) {
    case "columnBar":
      return "Bar graph";
    case "xyScatter":
      return "XY graph";
    case "groupedBar":
      return "Grouped bar";
    case "survivalCurve":
      return "Survival curve";
    case "columnScatter":
    default:
      return "Column scatter";
  }
}

/**
 * The inline rename input shown in place of a rail row's label while it is being
 * renamed. Auto-focuses + selects, commits on Enter / blur, cancels on Escape.
 * This is the rail analog of grid-crud-menu's ColumnRenameInput (same Enter /
 * blur / Escape idiom, no window.prompt), styled flush inside a left-aligned row.
 */
function RailRenameInput({
  initialName,
  ariaLabel,
  onCommit,
  onCancel,
  className,
}: {
  initialName: string;
  ariaLabel: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  // Escape sets a flag so the blur that follows does not also commit the value.
  const cancelledRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => ref.current?.select(), 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <input
      ref={ref}
      type="text"
      defaultValue={initialName}
      aria-label={ariaLabel}
      // The row's click / context handlers must not fire while editing the name.
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (cancelledRef.current) {
          cancelledRef.current = false;
          onCancel();
          return;
        }
        onCommit(e.currentTarget.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          cancelledRef.current = true;
          e.currentTarget.blur();
        }
      }}
      className={
        className ??
        "min-w-0 flex-1 rounded bg-surface-raised px-1 text-left text-meta text-foreground outline-none focus:ring-1 focus:ring-accent"
      }
    />
  );
}

// "all" | "unfiled" | a stringified project id.
export type Collection = "all" | "unfiled" | string;

/** The label for a table's type tag (capitalized archetype name). */
function typeTag(type: DataHubDocument["table_type"]): string {
  switch (type) {
    case "column":
      return "Column";
    case "xy":
      return "XY";
    case "grouped":
      return "Grouped";
    case "survival":
      return "Survival";
    default:
      return type;
  }
}

/** Group the visible tables by folder_path. null / "" is the project root and
 *  sorts first (rendered as un-foldered rows); named folders follow, sorted. */
function groupByFolder(
  tables: DataHubDocument[],
): { folder: string | null; tables: DataHubDocument[] }[] {
  const root: DataHubDocument[] = [];
  const folders = new Map<string, DataHubDocument[]>();
  for (const t of tables) {
    const f = t.folder_path && t.folder_path.trim() !== "" ? t.folder_path : null;
    if (f === null) root.push(t);
    else {
      const arr = folders.get(f) ?? [];
      arr.push(t);
      folders.set(f, arr);
    }
  }
  const out: { folder: string | null; tables: DataHubDocument[] }[] = [];
  if (root.length > 0) out.push({ folder: null, tables: root });
  for (const folder of [...folders.keys()].sort()) {
    out.push({ folder, tables: folders.get(folder)! });
  }
  return out;
}

/** A child row in the family tree (an analysis or a figure), indented under its
 *  parent table with a left border, matching the mockup's `.it.ind` rows. */
function ChildRow({
  icon,
  label,
  active,
  onSelect,
  onContextMenu,
  renaming,
  onRenameCommit,
  onRenameCancel,
  testId,
  trailing,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  label: string;
  active: boolean;
  onSelect: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** When true, the label is swapped for the inline rename input. */
  renaming?: boolean;
  onRenameCommit?: (name: string) => void;
  onRenameCancel?: () => void;
  testId?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      onContextMenu={onContextMenu}
      data-testid={testId}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-meta transition-colors ${
        active
          ? "bg-accent-soft font-medium text-accent"
          : "text-foreground-muted hover:bg-surface-raised hover:text-foreground"
      }`}
    >
      <Icon
        name={icon}
        className={`h-3.5 w-3.5 shrink-0 ${active ? "text-accent" : "text-foreground-muted"}`}
      />
      {renaming ? (
        <RailRenameInput
          initialName={label}
          ariaLabel="Rename item"
          onCommit={(name) => onRenameCommit?.(name)}
          onCancel={() => onRenameCancel?.()}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">{label}</span>
      )}
      {trailing}
    </button>
  );
}

/** A small "+ add" affordance for a child group (Results / Graphs). */
function AddChildButton({
  label,
  onClick,
  disabled,
  testId,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon name="plus" className="h-3.5 w-3.5 shrink-0" />
      {label}
    </button>
  );
}

export default function DataHubRail({
  projects,
  tables,
  collection,
  onCollectionChange,
  selectedTableId,
  onSelectTable,
  onNewTable,
  onNewFolder,
  onImport,
  onPlanStudy,
  counts,
  analyses,
  selectedAnalysisId,
  onSelectAnalysis,
  onNewAnalysis,
  onGuidedAnalysis,
  analysesEnabled,
  plots,
  selectedPlotId,
  onSelectPlot,
  onNewGraph,
  graphsEnabled,
  onRenameTable,
  onDuplicateTable,
  onDeleteTable,
  onExportTable,
  onRenameAnalysis,
  onDeleteAnalysis,
  onReRunAnalysis,
  onRenamePlot,
  onDeletePlot,
  onDuplicatePlot,
  onExportPlotPng,
  onExportPlotSvg,
}: {
  projects: Project[];
  /** The tables visible under the active collection filter. */
  tables: DataHubDocument[];
  collection: Collection;
  onCollectionChange: (c: Collection) => void;
  selectedTableId: string | null;
  onSelectTable: (id: string) => void;
  onNewTable: () => void;
  onNewFolder: () => void;
  /** Opens the import dialog (paste from Excel / pick a CSV into a new table). */
  onImport: () => void;
  /**
   * Opens the power / sample-size planner. It is a stateless calculator, so it
   * sits in the rail header rather than the table toolbar, reachable even before
   * any table exists (a study is planned before its data).
   */
  onPlanStudy: () => void;
  /** All / Unfiled / per-project counts for the selector labels. */
  counts: { all: number; unfiled: number; perProject: Map<string, number> };
  /** The open table's stored analyses (empty until one is run). */
  analyses: AnalysisSpec[];
  selectedAnalysisId: string | null;
  onSelectAnalysis: (id: string) => void;
  onNewAnalysis: () => void;
  /** Opens the guided analysis wizard (the assumption-aware test picker). */
  onGuidedAnalysis: () => void;
  /** True once a table is open so a new analysis can be added. */
  analysesEnabled: boolean;
  /** The open table's stored figures (empty until one is made). */
  plots: PlotSpec[];
  selectedPlotId: string | null;
  onSelectPlot: (id: string) => void;
  onNewGraph: () => void;
  /** True once a table is open so a new graph can be added. */
  graphsEnabled: boolean;
  // --- Right-click item actions (phase 2b). All optional so a rail rendered
  // without them (an isolated render) simply shows no menu item for the missing
  // action. The page wires the full set.
  /** Rename a table (inline, commits the new display name). */
  onRenameTable?: (id: string, name: string) => void;
  /** Duplicate a table into a fresh "<name> copy" document. */
  onDuplicateTable?: (id: string) => void;
  /** Delete a table (both files). */
  onDeleteTable?: (id: string) => void;
  /** Export a table as a CSV download. */
  onExportTable?: (id: string) => void;
  /** Rename an analysis (inline). A blank name clears it back to the label. */
  onRenameAnalysis?: (id: string, name: string) => void;
  /** Delete an analysis. */
  onDeleteAnalysis?: (id: string) => void;
  /** Force-recompute an analysis against the current data and select it. */
  onReRunAnalysis?: (id: string) => void;
  /** Rename a figure (inline). A blank name clears it back to the label. */
  onRenamePlot?: (id: string, name: string) => void;
  /** Delete a figure. */
  onDeletePlot?: (id: string) => void;
  /** Duplicate a figure (clones the spec under a "<name> copy"). */
  onDuplicatePlot?: (id: string) => void;
  /** Export a figure as a PNG download (no need to open it). */
  onExportPlotPng?: (id: string) => void;
  /** Export a figure as an SVG download (no need to open it). */
  onExportPlotSvg?: (id: string) => void;
}) {
  const groups = useMemo(() => groupByFolder(tables), [tables]);
  // A table id -> name lookup so a derived table can show its source's name in
  // the rail ("from <source>"). Built from the visible tables; a source outside
  // the current filter falls back to a generic label.
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tables) m.set(t.id, t.name);
    return m;
  }, [tables]);
  // Closed folders by name. Folders start open (the mockup's default).
  const [closedFolders, setClosedFolders] = useState<Set<string>>(new Set());
  // Tables the user has explicitly collapsed. The selected table is expanded by
  // default (its family is loaded and worth showing), so we track the opposite,
  // a set of collapsed table ids, instead of a set of expanded ones.
  const [collapsedTables, setCollapsedTables] = useState<Set<string>>(new Set());

  const toggleFolder = (folder: string) =>
    setClosedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });

  const toggleTable = (id: string) =>
    setCollapsedTables((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // The app-wide right-click menu. Optional so an isolated render (a unit test
  // that does not mount the provider) does not throw; the menus just never open.
  const ctx = useOptionalContextMenu();
  const openMenu = ctx?.openMenu ?? (() => {});

  // Which rail item is being renamed inline, keyed by kind so a table, an
  // analysis, and a figure can never collide on a shared id. null means none.
  const [renaming, setRenaming] = useState<
    { kind: "table" | "analysis" | "plot"; id: string } | null
  >(null);
  const isRenaming = (kind: "table" | "analysis" | "plot", id: string) =>
    renaming?.kind === kind && renaming.id === id;
  const cancelRename = useCallback(() => setRenaming(null), []);

  // Build + open the table row's menu. Rename (inline), Duplicate, Delete, then a
  // divider before Analyze / New graph / Export. A missing handler drops its item
  // rather than rendering a dead one.
  const openTableMenu = useCallback(
    (e: React.MouseEvent, table: DataHubDocument) => {
      const items: EditMenuItem[] = [];
      if (onRenameTable) {
        items.push({
          id: "rename",
          label: "Rename",
          enabled: true,
          onRun: () => setRenaming({ kind: "table", id: table.id }),
        });
      }
      if (onDuplicateTable) {
        items.push({
          id: "duplicate",
          label: "Duplicate",
          enabled: true,
          onRun: () => onDuplicateTable(table.id),
        });
      }
      if (onDeleteTable) {
        items.push({
          id: "delete",
          label: "Delete",
          enabled: true,
          destructive: true,
          onRun: () => onDeleteTable(table.id),
        });
      }
      // Analyze / New graph need the table open; selecting it first loads its
      // doc, then the action fires against the now-open table.
      const wasActive = table.id === selectedTableId;
      items.push({
        id: "analyze",
        label: "Analyze",
        enabled: true,
        group: true,
        onRun: () => {
          if (!wasActive) onSelectTable(table.id);
          onNewAnalysis();
        },
      });
      items.push({
        id: "new-graph",
        label: "New graph",
        enabled: true,
        onRun: () => {
          if (!wasActive) onSelectTable(table.id);
          onNewGraph();
        },
      });
      if (onExportTable) {
        items.push({
          id: "export-csv",
          label: "Export (CSV)",
          enabled: true,
          group: true,
          onRun: () => onExportTable(table.id),
        });
      }
      openMenu(e, items);
    },
    [
      onRenameTable,
      onDuplicateTable,
      onDeleteTable,
      onExportTable,
      onNewAnalysis,
      onNewGraph,
      onSelectTable,
      selectedTableId,
      openMenu,
    ],
  );

  // Build + open an analysis child's menu. Rename, divider, Re-run, Make graph,
  // divider, Delete (destructive).
  const openAnalysisMenu = useCallback(
    (e: React.MouseEvent, analysis: AnalysisSpec) => {
      const items: EditMenuItem[] = [];
      if (onRenameAnalysis) {
        items.push({
          id: "rename",
          label: "Rename",
          enabled: true,
          onRun: () => setRenaming({ kind: "analysis", id: analysis.id }),
        });
      }
      if (onReRunAnalysis) {
        items.push({
          id: "re-run",
          label: "Re-run",
          enabled: true,
          group: true,
          onRun: () => onReRunAnalysis(analysis.id),
        });
      }
      // Make graph opens the New-graph dialog against the open table (the same
      // chooser the rail's New graph button uses).
      items.push({
        id: "make-graph",
        label: "Make graph",
        enabled: graphsEnabled,
        onRun: () => {
          onSelectAnalysis(analysis.id);
          onNewGraph();
        },
      });
      if (onDeleteAnalysis) {
        items.push({
          id: "delete",
          label: "Delete",
          enabled: true,
          destructive: true,
          group: true,
          onRun: () => onDeleteAnalysis(analysis.id),
        });
      }
      openMenu(e, items);
    },
    [
      onRenameAnalysis,
      onReRunAnalysis,
      onDeleteAnalysis,
      onSelectAnalysis,
      onNewGraph,
      graphsEnabled,
      openMenu,
    ],
  );

  // Build + open a figure child's menu. Rename, Duplicate, divider, Export PNG,
  // Export SVG, divider, Delete (destructive).
  const openPlotMenu = useCallback(
    (e: React.MouseEvent, plot: PlotSpec) => {
      const items: EditMenuItem[] = [];
      if (onRenamePlot) {
        items.push({
          id: "rename",
          label: "Rename",
          enabled: true,
          onRun: () => setRenaming({ kind: "plot", id: plot.id }),
        });
      }
      if (onDuplicatePlot) {
        items.push({
          id: "duplicate",
          label: "Duplicate",
          enabled: true,
          onRun: () => onDuplicatePlot(plot.id),
        });
      }
      if (onExportPlotPng) {
        items.push({
          id: "export-png",
          label: "Export PNG",
          enabled: true,
          group: true,
          onRun: () => onExportPlotPng(plot.id),
        });
      }
      if (onExportPlotSvg) {
        items.push({
          id: "export-svg",
          label: "Export SVG",
          enabled: true,
          onRun: () => onExportPlotSvg(plot.id),
        });
      }
      if (onDeletePlot) {
        items.push({
          id: "delete",
          label: "Delete",
          enabled: true,
          destructive: true,
          group: true,
          onRun: () => onDeletePlot(plot.id),
        });
      }
      openMenu(e, items);
    },
    [
      onRenamePlot,
      onDuplicatePlot,
      onExportPlotPng,
      onExportPlotSvg,
      onDeletePlot,
      openMenu,
    ],
  );

  // Render one table as a family-tree node: the table row, then (when it is the
  // open table and not collapsed) its Results and Graphs nested beneath it,
  // indented under a left border. Only the open table has its analyses + plots
  // loaded, so a non-selected table shows just its row until it is selected.
  const renderTableNode = (table: DataHubDocument) => {
    const active = table.id === selectedTableId;
    const isOpen = active;
    const expanded = isOpen && !collapsedTables.has(table.id);
    // A derived table is computed from a source via a transform; mark it so it
    // reads differently from an entered table in the rail.
    const derived = table.derivedFrom;
    // sourceTableId is the legacy single-op field; primarySourceId reads either
    // it or the new recipe.sources[0] so the rail still names the source after
    // the derivedFrom widening.
    const derivedSourceId = derived ? primarySourceId(derived) : null;
    const sourceName = derived
      ? (derivedSourceId ? nameById.get(derivedSourceId) ?? "another table" : "another table")
      : null;
    return (
      <div key={table.id}>
        <div
          onContextMenu={(e) => openTableMenu(e, table)}
          className={`group flex w-full items-center gap-1 rounded-md pr-2 text-body transition-colors ${
            active
              ? "bg-accent-soft font-medium text-accent"
              : "text-foreground hover:bg-surface-sunken"
          }`}
        >
          {/* The chevron toggles the open table's family; for a non-open table it
              selects it (which loads + reveals its family). */}
          <Tooltip label={expanded ? "Collapse" : "Expand"}>
            <button
              type="button"
              onClick={() => (isOpen ? toggleTable(table.id) : onSelectTable(table.id))}
              aria-label={expanded ? "Collapse table" : "Expand table"}
              className="shrink-0 rounded p-1 text-foreground-muted transition-colors hover:text-foreground"
            >
              <Icon
                name={expanded ? "chevronDown" : "chevronRight"}
                className={`h-3 w-3 ${active ? "text-accent" : ""}`}
              />
            </button>
          </Tooltip>
          <button
            type="button"
            onClick={() => onSelectTable(table.id)}
            className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
          >
            <Icon
              name="table"
              className={`h-4 w-4 shrink-0 ${active ? "text-accent" : "text-foreground-muted"}`}
            />
            {isRenaming("table", table.id) ? (
              <RailRenameInput
                initialName={table.name}
                ariaLabel="Rename table"
                className="min-w-0 flex-1 rounded bg-surface-raised px-1 text-left text-body text-foreground outline-none focus:ring-1 focus:ring-accent"
                onCommit={(name) => {
                  setRenaming(null);
                  onRenameTable?.(table.id, name);
                }}
                onCancel={cancelRename}
              />
            ) : (
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{table.name}</span>
                {derived && (
                  <span className="truncate text-[10px] font-normal text-foreground-muted">
                    from {sourceName}
                  </span>
                )}
              </span>
            )}
            {derived && (
              <Tooltip label={`Derived from ${sourceName}`}>
                <span
                  className="flex shrink-0 items-center rounded border border-border px-1 text-[10px] font-medium uppercase text-foreground-muted"
                  data-testid="datahub-rail-derived-badge"
                  aria-label={`Derived from ${sourceName}`}
                >
                  <Icon name="transform" className="h-2.5 w-2.5" />
                </span>
              </Tooltip>
            )}
            <span className="shrink-0 rounded border border-border px-1 text-[10px] font-medium uppercase text-foreground-muted">
              {typeTag(table.table_type)}
            </span>
          </button>
        </div>

        {expanded && (
          <div className="ml-[13px] mt-0.5 flex flex-col gap-1.5 border-l-2 border-border pb-1 pl-2">
            {/* Results subgroup */}
            <div data-testid="datahub-results-section">
              <div className="flex items-center justify-between px-2 py-0.5">
                <div className="flex items-center gap-1.5">
                  <Icon name="results" className="h-3 w-3 text-foreground-muted" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
                    Results
                  </span>
                </div>
                <Tooltip label="Guided analysis">
                  <button
                    type="button"
                    onClick={onGuidedAnalysis}
                    disabled={!analysesEnabled}
                    aria-label="Guided analysis"
                    className="rounded p-0.5 text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    data-testid="datahub-guided-analysis-button"
                  >
                    <Icon name="features" className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              </div>
              {analyses.length === 0 ? (
                <p className="px-2 pb-1 text-[11px] leading-snug text-foreground-muted">
                  No analyses yet. Run a t-test or ANOVA on this table, or let the
                  guided wizard pick the right test.
                </p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {analyses.map((a) => (
                    <ChildRow
                      key={a.id}
                      icon="list"
                      label={a.name ?? analysisLabel(a.type)}
                      active={a.id === selectedAnalysisId}
                      onSelect={() => onSelectAnalysis(a.id)}
                      onContextMenu={(e) => openAnalysisMenu(e, a)}
                      renaming={isRenaming("analysis", a.id)}
                      onRenameCommit={(name) => {
                        setRenaming(null);
                        onRenameAnalysis?.(a.id, name);
                      }}
                      onRenameCancel={cancelRename}
                      trailing={
                        a.resultStale ? (
                          <Tooltip label="Re-runs on open">
                            <span
                              className="shrink-0 rounded border border-border px-1 text-[10px] font-medium uppercase text-foreground-muted"
                            >
                              stale
                            </span>
                          </Tooltip>
                        ) : undefined
                      }
                    />
                  ))}
                </div>
              )}
              <AddChildButton
                label="New analysis"
                onClick={onNewAnalysis}
                disabled={!analysesEnabled}
              />
            </div>

            {/* Graphs subgroup */}
            <div data-testid="datahub-graphs-section">
              <div className="flex items-center px-2 py-0.5">
                <Icon name="chart" className="mr-1.5 h-3 w-3 text-foreground-muted" />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
                  Graphs
                </span>
              </div>
              {plots.length === 0 ? (
                <p className="px-2 pb-1 text-[11px] leading-snug text-foreground-muted">
                  No graphs yet. Make a column scatter or bar from this table.
                </p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {plots.map((p) => (
                    <ChildRow
                      key={p.id}
                      icon="chart"
                      label={p.name ?? plotLabel(p)}
                      active={p.id === selectedPlotId}
                      onSelect={() => onSelectPlot(p.id)}
                      onContextMenu={(e) => openPlotMenu(e, p)}
                      renaming={isRenaming("plot", p.id)}
                      onRenameCommit={(name) => {
                        setRenaming(null);
                        onRenamePlot?.(p.id, name);
                      }}
                      onRenameCancel={cancelRename}
                    />
                  ))}
                </div>
              )}
              <AddChildButton
                label="New graph"
                onClick={onNewGraph}
                disabled={!graphsEnabled}
              />
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <aside
      className="flex h-full w-[232px] shrink-0 flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-surface-sunken p-3"
      data-testid="datahub-rail"
    >
      {/* Collection filter */}
      <div className="border-b border-border pb-3">
        <label className="mb-1 block text-meta font-medium uppercase tracking-wide text-foreground-muted">
          Collection
        </label>
        <select
          value={collection}
          onChange={(e) => onCollectionChange(e.target.value as Collection)}
          className="w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
          data-testid="datahub-collection-select"
        >
          <option value="all">All collections ({counts.all})</option>
          <option value="unfiled">Unfiled ({counts.unfiled})</option>
          {projects.length > 0 && (
            <optgroup label="Projects">
              {projects.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name} ({counts.perProject.get(String(p.id)) ?? 0})
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {/* Data Tables tree */}
      <div>
        <div className="mb-1 flex items-center justify-between px-1">
          <span className="text-meta font-semibold uppercase tracking-wide text-foreground-muted">
            Data Tables
          </span>
          <div className="flex items-center gap-0.5">
            <Tooltip label="Plan study (power and sample size)">
              <button
                type="button"
                onClick={onPlanStudy}
                aria-label="Plan study (power and sample size)"
                className="rounded p-1 text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                data-testid="datahub-rail-plan-study"
              >
                <Icon name="gauge" className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <Tooltip label="Import data">
              <button
                type="button"
                onClick={onImport}
                aria-label="Import data"
                className="rounded p-1 text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
              >
                <Icon name="import" className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <Tooltip label="New folder">
              <button
                type="button"
                onClick={onNewFolder}
                aria-label="New folder"
                className="rounded p-1 text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
              >
                <Icon name="folder" className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <Tooltip label="New table">
              <button
                type="button"
                onClick={onNewTable}
                aria-label="New table"
                className="rounded p-1 text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
              >
                <Icon name="plus" className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          </div>
        </div>

        {tables.length === 0 ? (
          <p className="px-1 py-2 text-meta text-foreground-muted">
            No tables in this collection yet. Use New table to start one.
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {groups.map((grp) => {
              if (grp.folder === null) {
                return grp.tables.map((t) => renderTableNode(t));
              }
              const closed = closedFolders.has(grp.folder);
              return (
                <div key={grp.folder}>
                  <button
                    type="button"
                    onClick={() => toggleFolder(grp.folder!)}
                    className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-meta font-semibold uppercase tracking-wide text-foreground-muted transition-colors hover:bg-surface-raised"
                  >
                    <Icon
                      name={closed ? "chevronRight" : "chevronDown"}
                      className="h-3 w-3 shrink-0"
                    />
                    <Icon name="folder" className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-left">
                      {grp.folder}
                    </span>
                    <span className="shrink-0 text-[10px] opacity-70">
                      {grp.tables.length}
                    </span>
                  </button>
                  {!closed && (
                    <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-1">
                      {grp.tables.map((t) => renderTableNode(t))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
