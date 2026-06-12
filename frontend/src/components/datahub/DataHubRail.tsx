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

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import type { Project } from "@/lib/types";
import type {
  AnalysisSpec,
  DataHubDocument,
  PlotSpec,
} from "@/lib/datahub/model/types";
import { readPlotStyle } from "@/lib/datahub/plot-spec";

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
  testId,
  trailing,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  label: string;
  active: boolean;
  onSelect: () => void;
  testId?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
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
      <span className="min-w-0 flex-1 truncate">{label}</span>
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
}) {
  const groups = useMemo(() => groupByFolder(tables), [tables]);
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

  // Render one table as a family-tree node: the table row, then (when it is the
  // open table and not collapsed) its Results and Graphs nested beneath it,
  // indented under a left border. Only the open table has its analyses + plots
  // loaded, so a non-selected table shows just its row until it is selected.
  const renderTableNode = (table: DataHubDocument) => {
    const active = table.id === selectedTableId;
    const isOpen = active;
    const expanded = isOpen && !collapsedTables.has(table.id);
    return (
      <div key={table.id}>
        <div
          className={`group flex w-full items-center gap-1 rounded-md pr-2 text-body transition-colors ${
            active
              ? "bg-accent-soft font-medium text-accent"
              : "text-foreground hover:bg-surface-sunken"
          }`}
        >
          {/* The chevron toggles the open table's family; for a non-open table it
              selects it (which loads + reveals its family). */}
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
          <button
            type="button"
            onClick={() => onSelectTable(table.id)}
            className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
          >
            <Icon
              name="table"
              className={`h-4 w-4 shrink-0 ${active ? "text-accent" : "text-foreground-muted"}`}
            />
            <span className="min-w-0 flex-1 truncate">{table.name}</span>
            <span className="shrink-0 rounded border border-border px-1 text-[10px] font-medium uppercase text-foreground-muted">
              {typeTag(table.table_type)}
            </span>
          </button>
        </div>

        {expanded && (
          <div className="ml-[13px] mt-0.5 flex flex-col gap-1.5 border-l border-border pb-1 pl-2">
            {/* Results subgroup */}
            <div data-testid="datahub-results-section">
              <div className="flex items-center justify-between px-2 py-0.5">
                <div className="flex items-center gap-1.5">
                  <Icon name="tree" className="h-3 w-3 text-foreground-muted" />
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
                      label={analysisLabel(a.type)}
                      active={a.id === selectedAnalysisId}
                      onSelect={() => onSelectAnalysis(a.id)}
                      trailing={
                        a.resultStale ? (
                          <span
                            className="shrink-0 rounded border border-border px-1 text-[10px] font-medium uppercase text-foreground-muted"
                            title="Re-runs on open"
                          >
                            stale
                          </span>
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
                      label={plotLabel(p)}
                      active={p.id === selectedPlotId}
                      onSelect={() => onSelectPlot(p.id)}
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
