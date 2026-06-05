"use client";

import { useMemo, useState } from "react";
import type { ParsedNotebook, ParsedNode } from "@/lib/import/eln/types";
import type { ChangedPage } from "@/lib/import/eln/apply";

interface PreviewStepProps {
  parsed: ParsedNotebook;
  /** Pages that match an existing on-disk task by dedupKey but whose
   *  content has drifted since last import. When empty, the
   *  "page changed" prompt panel is hidden. */
  changedPages?: ChangedPage[];
  /** IDs of changed pages the user has opted to overwrite. */
  overwritePageIds?: Set<string>;
  /** Update the overwrite set in the parent. */
  onOverwriteChange?: (next: Set<string>) => void;
}

interface Counts {
  folders: number;
  pages: number;
  entries: number;
  attachments: number;
}

// Stable empty-set sentinel so the component prop default doesn't allocate a
// fresh Set on every render (would re-trigger useMemo deps in callers).
const EMPTY_SET: Set<string> = new Set();

function countTree(nodes: ParsedNode[]): { folders: number; pages: number } {
  let folders = 0;
  let pages = 0;
  for (const node of nodes) {
    if (node.kind === "folder") {
      folders++;
      const child = countTree(node.children ?? []);
      folders += child.folders;
      pages += child.pages;
    } else {
      pages++;
    }
  }
  return { folders, pages };
}

export default function PreviewStep({
  parsed,
  changedPages = [],
  overwritePageIds = EMPTY_SET,
  onOverwriteChange,
}: PreviewStepProps) {
  const counts: Counts = useMemo(() => {
    const treeCounts = countTree(parsed.tree);
    let entries = 0;
    let attachments = 0;
    for (const page of parsed.pages) {
      entries += page.entries.length;
      for (const e of page.entries) {
        attachments += e.attachments.length;
      }
    }
    return {
      folders: treeCounts.folders,
      pages: treeCounts.pages,
      entries,
      attachments,
    };
  }, [parsed]);

  const missingCount = parsed.missingInlineImages.length;
  const rootCrumb = parsed.rootBreadcrumb.join(" / ");

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-body font-semibold text-gray-900">
          Here&apos;s what we found in the notebook.
        </h3>
        <p className="text-meta text-gray-500 mt-1">
          Review the shape of the export before we generate a default import
          plan. Nothing has been written to your folder yet.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
        <p className="text-body text-gray-900">
          Notebook: <strong>{parsed.notebookName ?? "(unnamed)"}</strong>
        </p>
        <p className="text-meta text-gray-600">
          Export by{" "}
          <span className="font-medium">{parsed.exportedBy ?? "unknown"}</span>{" "}
          on{" "}
          <span className="font-medium">{parsed.exportedAt ?? "unknown date"}</span>
        </p>
        {rootCrumb && (
          <p className="text-meta text-gray-600">
            Imported root: <code className="text-meta bg-gray-100 px-1 py-0.5 rounded">{rootCrumb}</code>
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard label="Folders" value={counts.folders} />
        <StatCard label="Pages" value={counts.pages} />
        <StatCard label="Entries" value={counts.entries} />
        <StatCard label="Attachments" value={counts.attachments} />
      </div>

      {missingCount > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-body font-medium text-amber-900">
            {missingCount} online-only image{missingCount === 1 ? "" : "s"} not bundled in the ZIP
          </p>
          <p className="text-meta text-amber-800 mt-1">
            LabArchives stores some pasted images as URLs that aren&apos;t
            embedded in the offline export. We&apos;ll record the URLs so you
            can relink them later from a LabArchives login.
          </p>
        </div>
      )}

      {changedPages.length > 0 && onOverwriteChange && (
        <ChangedPagesPanel
          changedPages={changedPages}
          overwritePageIds={overwritePageIds}
          onOverwriteChange={onOverwriteChange}
        />
      )}

      <div>
        <p className="text-meta font-medium text-gray-700 mb-2">Tree preview</p>
        <div className="rounded-lg border border-gray-200 bg-white max-h-64 overflow-y-auto p-2 text-xs font-mono">
          {parsed.tree.length === 0 ? (
            <p className="text-gray-500 px-2 py-1">No tree nodes parsed.</p>
          ) : (
            parsed.tree.map((node, idx) => (
              <TreeNodeView key={`${node.treeNodeId}:${idx}`} node={node} depth={0} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <p className="text-meta uppercase tracking-wide text-gray-500 font-medium">{label}</p>
      <p className="text-heading text-gray-900 font-semibold leading-tight">{value}</p>
    </div>
  );
}

/**
 * Surface re-imported pages whose LabArchives content has drifted since the
 * last import. Default is "skip" (the historical silent-dedup behavior).
 * The user can opt individual pages — or the whole batch — into the
 * overwrite path, which replaces the existing task's on-disk notes
 * (preserving the task ID + share metadata).
 */
function ChangedPagesPanel({
  changedPages,
  overwritePageIds,
  onOverwriteChange,
}: {
  changedPages: ChangedPage[];
  overwritePageIds: Set<string>;
  onOverwriteChange: (next: Set<string>) => void;
}) {
  const allSelected =
    changedPages.length > 0 &&
    changedPages.every((p) => overwritePageIds.has(p.pageId));
  const someSelected = changedPages.some((p) => overwritePageIds.has(p.pageId));

  const togglePage = (pageId: string) => {
    const next = new Set(overwritePageIds);
    if (next.has(pageId)) next.delete(pageId);
    else next.add(pageId);
    onOverwriteChange(next);
  };

  const toggleAll = () => {
    if (allSelected) {
      onOverwriteChange(new Set());
    } else {
      onOverwriteChange(new Set(changedPages.map((p) => p.pageId)));
    }
  };

  const selectedCount = changedPages.filter((p) =>
    overwritePageIds.has(p.pageId),
  ).length;

  return (
    <div className="rounded-lg border border-blue-300 bg-blue-50">
      <div className="px-4 py-3 border-b border-blue-200">
        <p className="text-body font-medium text-blue-900">
          {changedPages.length} page{changedPages.length === 1 ? " has" : "s have"} changed since your last import
        </p>
        <p className="text-meta text-blue-800 mt-1">
          These pages match notebooks you&apos;ve imported before, but their
          content was edited in LabArchives after that. By default they&apos;ll
          be skipped (current behavior). Tick a page to overwrite the existing
          task&apos;s notes.md and attachments — the task itself (id, name,
          project, sharing, dates) is preserved.
        </p>
        {changedPages.length > 1 && (
          <label className="mt-2 flex items-center gap-2 text-meta text-blue-900 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = !allSelected && someSelected;
              }}
              onChange={toggleAll}
              className="rounded border-blue-400"
            />
            <span className="font-medium">
              Overwrite all {changedPages.length} changed pages
              {selectedCount > 0 && selectedCount < changedPages.length
                ? ` (${selectedCount} selected)`
                : ""}
            </span>
          </label>
        )}
      </div>
      <ul className="max-h-48 overflow-y-auto divide-y divide-blue-200/60">
        {changedPages.map((p) => (
          <li key={p.pageId} className="px-4 py-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={overwritePageIds.has(p.pageId)}
                onChange={() => togglePage(p.pageId)}
                className="mt-0.5 rounded border-blue-400"
              />
              <div className="flex-1 min-w-0">
                <p className="text-meta font-medium text-blue-900 truncate">
                  {p.pageName}
                  <span className="text-blue-700/80 font-normal ml-2">
                    → existing task #{p.existingTaskId}
                  </span>
                </p>
                <p className="text-meta text-blue-700/90 mt-0.5">
                  {p.reason === "entry-count-changed"
                    ? `Entry count changed: ${p.previousEntryCount} → ${p.currentEntryCount}`
                    : `Edited ${formatDelta(p.previouslyImportedAt, p.latestEntryUpdatedAt)} after last import`}
                </p>
                {p.treePath.length > 0 && (
                  <p className="text-[10px] text-blue-700/70 mt-0.5 font-mono truncate">
                    {p.treePath.join(" / ")}
                  </p>
                )}
              </div>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Render a coarse "N hours/days after" gap string. Safe on missing inputs. */
function formatDelta(prevIso: string, nextIso: string | null): string {
  if (!nextIso || !prevIso) return "after last import";
  const prev = Date.parse(prevIso);
  const next = Date.parse(nextIso);
  if (!Number.isFinite(prev) || !Number.isFinite(next) || next <= prev) {
    return "after last import";
  }
  const deltaMs = next - prev;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (deltaMs < hour) {
    const m = Math.max(1, Math.round(deltaMs / minute));
    return `${m} minute${m === 1 ? "" : "s"}`;
  }
  if (deltaMs < day) {
    const h = Math.round(deltaMs / hour);
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  const d = Math.round(deltaMs / day);
  return `${d} day${d === 1 ? "" : "s"}`;
}

function TreeNodeView({ node, depth }: { node: ParsedNode; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const indent = { paddingLeft: `${depth * 12 + 4}px` };

  if (node.kind === "page") {
    return (
      <div className="px-2 py-0.5 text-gray-700 flex items-center gap-1" style={indent}>
        <span className="text-gray-400">·</span>
        <span className="truncate">{node.name}</span>
      </div>
    );
  }

  const children = node.children ?? [];
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-2 py-0.5 hover:bg-gray-50 flex items-center gap-1"
        style={indent}
      >
        <span className="text-gray-500 w-3 inline-block">{open ? "▾" : "▸"}</span>
        <span className="font-medium text-gray-800 truncate">{node.name}</span>
        <span className="text-meta text-gray-500 ml-1">
          ({children.length} {children.length === 1 ? "item" : "items"})
        </span>
      </button>
      {open &&
        children.map((c, idx) => (
          <TreeNodeView key={`${c.treeNodeId}:${idx}`} node={c} depth={depth + 1} />
        ))}
    </div>
  );
}
