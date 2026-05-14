"use client";

import { useMemo, useState } from "react";
import type { ParsedNotebook, ParsedNode } from "@/lib/import/eln/types";

interface PreviewStepProps {
  parsed: ParsedNotebook;
}

interface Counts {
  folders: number;
  pages: number;
  entries: number;
  attachments: number;
}

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

export default function PreviewStep({ parsed }: PreviewStepProps) {
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
        <h3 className="text-sm font-semibold text-gray-900">
          Here&apos;s what we found in the notebook.
        </h3>
        <p className="text-xs text-gray-500 mt-1">
          Review the shape of the export before we generate a default import
          plan. Nothing has been written to your folder yet.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
        <p className="text-sm text-gray-900">
          Notebook: <strong>{parsed.notebookName ?? "(unnamed)"}</strong>
        </p>
        <p className="text-xs text-gray-600">
          Export by{" "}
          <span className="font-medium">{parsed.exportedBy ?? "unknown"}</span>{" "}
          on{" "}
          <span className="font-medium">{parsed.exportedAt ?? "unknown date"}</span>
        </p>
        {rootCrumb && (
          <p className="text-xs text-gray-600">
            Imported root: <code className="text-[11px] bg-gray-100 px-1 py-0.5 rounded">{rootCrumb}</code>
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
          <p className="text-sm font-medium text-amber-900">
            {missingCount} online-only image{missingCount === 1 ? "" : "s"} not bundled in the ZIP
          </p>
          <p className="text-xs text-amber-800 mt-1">
            LabArchives stores some pasted images as URLs that aren&apos;t
            embedded in the offline export. We&apos;ll record the URLs so you
            can relink them later from a LabArchives login.
          </p>
        </div>
      )}

      <div>
        <p className="text-xs font-medium text-gray-700 mb-2">Tree preview</p>
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
      <p className="text-[10px] uppercase tracking-wide text-gray-500 font-medium">{label}</p>
      <p className="text-lg text-gray-900 font-semibold leading-tight">{value}</p>
    </div>
  );
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
        <span className="text-[10px] text-gray-500 ml-1">
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
