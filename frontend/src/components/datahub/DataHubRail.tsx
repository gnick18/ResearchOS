"use client";

// The Data Hub left navigator rail (datahub-tab-p1). Mirrors the mockup's three
// stacked sections:
//   - a Collection filter (All / Unfiled / one project per the real project list)
//   - a foldered Data Tables tree, grouped by folder_path (collapsible folders,
//     a table-type tag per row, active highlight, New table + New folder)
//   - Results and Graphs sections, rendered as empty-state placeholders for now
//     (analyses + graphs are the next slice).
//
// Icons: the registry has no "table" or "chart" glyph and new registry entries
// need Grant's sign-off, so a data table reuses "list" (the closest grid glyph)
// and the Results / Graphs section headers reuse "tree" (a branching-diagram
// glyph, the nearest analysis/plot stand-in). Noted in the build report.
//
// House style: <Icon> only, Tooltip on icon-only buttons, brand + semantic
// tokens, no emojis / em-dashes / mid-sentence colons.

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import type { Project } from "@/lib/types";
import type { DataHubDocument } from "@/lib/datahub/model/types";

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

function TableRow({
  table,
  active,
  onSelect,
}: {
  table: DataHubDocument;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body transition-colors ${
        active
          ? "bg-accent-soft font-medium text-accent"
          : "text-foreground hover:bg-surface-sunken"
      }`}
    >
      <Icon
        name="list"
        className={`h-4 w-4 shrink-0 ${active ? "text-accent" : "text-foreground-muted"}`}
      />
      <span className="min-w-0 flex-1 truncate">{table.name}</span>
      <span className="shrink-0 rounded border border-border px-1 text-[10px] font-medium uppercase text-foreground-muted">
        {typeTag(table.table_type)}
      </span>
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
  counts,
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
  /** All / Unfiled / per-project counts for the selector labels. */
  counts: { all: number; unfiled: number; perProject: Map<string, number> };
}) {
  const groups = useMemo(() => groupByFolder(tables), [tables]);
  // Closed folders by name. Folders start open (the mockup's default).
  const [closedFolders, setClosedFolders] = useState<Set<string>>(new Set());

  const toggleFolder = (folder: string) =>
    setClosedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });

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
                return grp.tables.map((t) => (
                  <TableRow
                    key={t.id}
                    table={t}
                    active={t.id === selectedTableId}
                    onSelect={() => onSelectTable(t.id)}
                  />
                ));
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
                      {grp.tables.map((t) => (
                        <TableRow
                          key={t.id}
                          table={t}
                          active={t.id === selectedTableId}
                          onSelect={() => onSelectTable(t.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Results (empty-state placeholder; the analysis slice is next) */}
      <EmptySection
        title="Results"
        icon="tree"
        emptyLabel="No analyses yet"
        actionLabel="New analysis"
        testid="datahub-results-section"
      />

      {/* Graphs (empty-state placeholder; the graphs slice is next) */}
      <EmptySection
        title="Graphs"
        icon="tree"
        emptyLabel="No graphs yet"
        actionLabel="New graph"
        testid="datahub-graphs-section"
      />
    </aside>
  );
}

/** A rail section that is intentionally empty for slice 1: a header, an
 *  empty-state line, and a disabled "New ..." button so the surface reads as
 *  "coming next" without being clickable. */
function EmptySection({
  title,
  icon,
  emptyLabel,
  actionLabel,
  testid,
}: {
  title: string;
  icon: "tree";
  emptyLabel: string;
  actionLabel: string;
  testid: string;
}) {
  return (
    <div className="border-t border-border pt-3" data-testid={testid}>
      <div className="mb-1 flex items-center gap-1.5 px-1">
        <Icon name={icon} className="h-3.5 w-3.5 text-foreground-muted" />
        <span className="text-meta font-semibold uppercase tracking-wide text-foreground-muted">
          {title}
        </span>
      </div>
      <p className="px-1 text-meta text-foreground-muted">{emptyLabel}</p>
      <button
        type="button"
        disabled
        aria-disabled
        className="mt-1.5 flex w-full cursor-not-allowed items-center gap-1 rounded-md border border-dashed border-border px-2 py-1.5 text-meta font-medium text-foreground-muted opacity-60"
      >
        <Icon name="plus" className="h-3.5 w-3.5" />
        {actionLabel}
      </button>
    </div>
  );
}
