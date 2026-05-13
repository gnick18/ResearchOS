"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { methodsApi, fetchAllTasks, filesApi } from "@/lib/local-api";
import type { Method, Task } from "@/lib/types";
import RenderedMarkdown from "@/components/RenderedMarkdown";

interface MethodPickerProps {
  open: boolean;
  currentMethodId: number | null;
  /** Pin "Recently used in this project" at the top when available. */
  currentProjectId?: number;
  /** Hide these methods entirely — e.g. methods already attached to the task. */
  excludeMethodIds?: number[];
  onSelect: (methodId: number) => void | Promise<void>;
  onClose: () => void;
}

type FlatRow =
  | { kind: "header"; label: string; count: number; sectionKey: string }
  | { kind: "method"; method: Method; sectionKey: string };

const UNCATEGORIZED = "Uncategorized";
const RECENT_LIMIT = 5;

function methodIdsOf(t: Task): number[] {
  return t.method_ids ?? [];
}

/**
 * Map of method-id -> most recent task start_date that used it.
 * Caller filters which tasks to consider (e.g. by project).
 */
function buildRecency(tasks: Task[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const t of tasks) {
    for (const mid of methodIdsOf(t)) {
      const existing = out.get(mid);
      if (!existing || (t.start_date && t.start_date > existing)) {
        out.set(mid, t.start_date ?? "");
      }
    }
  }
  return out;
}

function topByRecency(
  recency: Map<number, string>,
  byId: Map<number, Method>,
  limit: number
): Method[] {
  return Array.from(recency.entries())
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, limit)
    .map(([id]) => byId.get(id))
    .filter((m): m is Method => !!m);
}

export default function MethodPicker({
  open,
  currentMethodId,
  currentProjectId,
  excludeMethodIds,
  onSelect,
  onClose,
}: MethodPickerProps) {
  const { data: allMethods = [], isLoading } = useQuery({
    queryKey: ["methods"],
    queryFn: methodsApi.list,
  });

  const excludeSet = useMemo(
    () => new Set(excludeMethodIds ?? []),
    [excludeMethodIds]
  );

  const methods = useMemo(
    () => (excludeSet.size === 0 ? allMethods : allMethods.filter((m) => !excludeSet.has(m.id))),
    [allMethods, excludeSet]
  );

  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: fetchAllTasks,
  });

  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  // Reset internal state when the picker is (re)opened. Uses the "compare to
  // previous prop in render" pattern documented in the React docs as the
  // preferred alternative to syncing state via useEffect.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuery("");
      setHighlightedIndex(0);
    }
  }

  // Focus the search input on open. Side effect on the DOM, so it stays in
  // an effect — but no setState here, so the lint rule is happy.
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const methodById = useMemo(() => {
    const m = new Map<number, Method>();
    for (const x of methods) m.set(x.id, x);
    return m;
  }, [methods]);

  const recentInProject = useMemo(() => {
    if (currentProjectId == null) return [] as Method[];
    const projectTasks = tasks.filter((t) => t.project_id === currentProjectId);
    return topByRecency(buildRecency(projectTasks), methodById, RECENT_LIMIT);
  }, [tasks, currentProjectId, methodById]);

  const recentAnywhere = useMemo(() => {
    return topByRecency(buildRecency(tasks), methodById, RECENT_LIMIT);
  }, [tasks, methodById]);

  const flatRows: FlatRow[] = useMemo(() => {
    const raw = query.trim().toLowerCase();
    const tagQuery = raw.startsWith("#") ? raw.slice(1) : raw;

    const filtered = methods.filter((m) => {
      if (!raw) return true;
      if (m.name.toLowerCase().includes(raw)) return true;
      if (tagQuery && m.tags?.some((t) => t.toLowerCase().includes(tagQuery))) {
        return true;
      }
      return false;
    });

    const rows: FlatRow[] = [];

    // Pinned sections — only shown when the user hasn't typed a query.
    // Search mode prioritises matches; pinned context becomes noise.
    if (!raw) {
      if (recentInProject.length > 0) {
        rows.push({
          kind: "header",
          label: "Recently used in this project",
          count: recentInProject.length,
          sectionKey: "pinned-project",
        });
        for (const m of recentInProject) {
          rows.push({ kind: "method", method: m, sectionKey: "pinned-project" });
        }
      }

      // Skip "Recently used" if its top entries are the same as the project
      // section above — avoid an identical pinned block.
      const projectIds = new Set(recentInProject.map((m) => m.id));
      const recentDeduped = recentAnywhere.filter((m) => !projectIds.has(m.id));
      if (recentDeduped.length > 0) {
        rows.push({
          kind: "header",
          label: "Recently used",
          count: recentDeduped.length,
          sectionKey: "pinned-recent",
        });
        for (const m of recentDeduped) {
          rows.push({ kind: "method", method: m, sectionKey: "pinned-recent" });
        }
      }
    }

    // Regular folder-grouped view of all (filtered) methods.
    const byFolder = new Map<string, Method[]>();
    for (const m of filtered) {
      const folder = m.folder_path || UNCATEGORIZED;
      const bucket = byFolder.get(folder);
      if (bucket) bucket.push(m);
      else byFolder.set(folder, [m]);
    }

    const folderNames = Array.from(byFolder.keys()).sort((a, b) => {
      if (a === UNCATEGORIZED) return 1;
      if (b === UNCATEGORIZED) return -1;
      return a.localeCompare(b);
    });

    for (const folder of folderNames) {
      const items = (byFolder.get(folder) ?? []).slice().sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      );
      rows.push({
        kind: "header",
        label: folder,
        count: items.length,
        sectionKey: `folder:${folder}`,
      });
      for (const method of items) {
        rows.push({
          kind: "method",
          method,
          sectionKey: `folder:${folder}`,
        });
      }
    }
    return rows;
  }, [methods, query, recentInProject, recentAnywhere]);

  const selectableIndices = useMemo(
    () =>
      flatRows
        .map((r, i) => (r.kind === "method" ? i : -1))
        .filter((i) => i !== -1),
    [flatRows]
  );

  const highlightedMethod: Method | null = useMemo(() => {
    const row = flatRows[highlightedIndex];
    return row?.kind === "method" ? row.method : null;
  }, [flatRows, highlightedIndex]);

  // Clamp the highlighted index when the filtered list changes (e.g. the user
  // types in the search box and the previously-highlighted row is no longer
  // present). This is a defensive sync that responds to derived state, so it
  // legitimately needs setState in an effect.
  useEffect(() => {
    if (selectableIndices.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHighlightedIndex(-1);
      return;
    }
    if (!selectableIndices.includes(highlightedIndex)) {
      setHighlightedIndex(selectableIndices[0]);
    }
  }, [selectableIndices, highlightedIndex]);

  useEffect(() => {
    if (highlightedIndex < 0) return;
    const el = rowRefs.current.get(highlightedIndex);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  if (!open) return null;

  const moveHighlight = (direction: 1 | -1) => {
    if (selectableIndices.length === 0) return;
    const currentPos = selectableIndices.indexOf(highlightedIndex);
    const nextPos =
      currentPos === -1
        ? 0
        : Math.min(
            selectableIndices.length - 1,
            Math.max(0, currentPos + direction)
          );
    setHighlightedIndex(selectableIndices[nextPos]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveHighlight(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveHighlight(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = flatRows[highlightedIndex];
      if (row?.kind === "method") {
        void onSelect(row.method.id);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/30 backdrop-blur-sm pt-[10vh] px-4"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="w-full max-w-5xl bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: "80vh", minHeight: "min(80vh, 480px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
          <svg
            className="w-4 h-4 text-gray-400 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search methods by name or #tag…"
            className="flex-1 text-sm outline-none placeholder-gray-400"
          />
          <button
            onClick={onClose}
            className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 border border-gray-200 rounded"
            aria-label="Close picker"
          >
            Esc
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
        <div ref={listRef} className="w-full md:w-[380px] md:shrink-0 overflow-y-auto md:border-r md:border-gray-100">
          {isLoading ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              Loading methods…
            </div>
          ) : allMethods.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              No methods available. Create some in the Methods section first.
            </div>
          ) : methods.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              All methods are already attached.
            </div>
          ) : flatRows.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              No methods match &ldquo;{query}&rdquo;. Try a different search or
              clear the input.
            </div>
          ) : (
            flatRows.map((row, index) => {
              if (row.kind === "header") {
                const isPinned = row.sectionKey.startsWith("pinned-");
                const headerCls = isPinned
                  ? "sticky top-0 z-10 bg-blue-50/95 backdrop-blur px-4 py-2 text-[11px] uppercase tracking-wide font-semibold text-blue-700 border-b border-blue-200 border-l-2 border-l-blue-400"
                  : "sticky top-0 z-10 bg-gray-100/95 backdrop-blur px-4 py-2 text-[11px] uppercase tracking-wide font-semibold text-gray-700 border-b border-gray-200";
                return (
                  <div key={`h:${row.sectionKey}`} className={headerCls}>
                    {row.label}
                    <span
                      className={`ml-2 normal-case tracking-normal font-normal ${
                        isPinned ? "text-blue-400" : "text-gray-400"
                      }`}
                    >
                      {row.count}
                    </span>
                  </div>
                );
              }
              const m = row.method;
              const isCurrent = m.id === currentMethodId;
              const isHighlighted = index === highlightedIndex;
              return (
                <button
                  key={`${row.sectionKey}:${m.id}`}
                  ref={(el) => {
                    if (el) rowRefs.current.set(index, el);
                    else rowRefs.current.delete(index);
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => void onSelect(m.id)}
                  className={`w-full text-left px-4 py-2.5 border-b border-gray-50 transition-colors ${
                    isHighlighted ? "bg-blue-50" : "bg-white hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {m.name}
                      </span>
                      {m.method_type === "pcr" && (
                        <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded shrink-0">
                          PCR
                        </span>
                      )}
                      {m.method_type === "pdf" && (
                        <span className="text-xs px-1.5 py-0.5 bg-rose-100 text-rose-600 rounded shrink-0">
                          PDF
                        </span>
                      )}
                    </div>
                    {isCurrent && (
                      <span className="text-xs text-green-600 shrink-0">
                        ✓ Current
                      </span>
                    )}
                  </div>
                  {m.tags && m.tags.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {m.tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>
        <div className="hidden md:flex md:flex-1 flex-col bg-gray-50/40 overflow-hidden">
          <MethodPreview method={highlightedMethod} />
        </div>
        </div>

        <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-100 text-[11px] text-gray-400 bg-gray-50">
          <span>
            <kbd className="px-1 py-0.5 bg-white border border-gray-200 rounded text-gray-600">
              ↑
            </kbd>
            <kbd className="ml-0.5 px-1 py-0.5 bg-white border border-gray-200 rounded text-gray-600">
              ↓
            </kbd>{" "}
            navigate
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-white border border-gray-200 rounded text-gray-600">
              ↵
            </kbd>{" "}
            select
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-white border border-gray-200 rounded text-gray-600">
              esc
            </kbd>{" "}
            close
          </span>
        </div>
      </div>
    </div>
  );
}

function MethodPreview({ method }: { method: Method | null }) {
  const isPcr =
    method?.method_type === "pcr" ||
    (method?.source_path?.startsWith("pcr://") ?? false);
  const isPdf =
    method?.method_type === "pdf" ||
    (method?.source_path?.toLowerCase().endsWith(".pdf") ?? false);
  const canFetchFile = !!method?.source_path && !isPcr;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["method-preview", method?.id],
    queryFn: () => filesApi.readFile(method!.source_path!),
    enabled: canFetchFile,
    staleTime: 5 * 60_000,
  });

  // For PDFs, decode the base64 content into a blob URL for the <iframe>.
  // Revoke when the method changes or the component unmounts so we don't
  // leak object URLs while the user arrows through the list. The setState
  // here is a legitimate sync between an external resource (the blob URL)
  // and React state, with cleanup — exactly what useEffect is for.
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isPdf || !data?.content) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPdfUrl(null);
      return;
    }
    let url: string | null = null;
    try {
      const binary = atob(data.content);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/pdf" });
      url = URL.createObjectURL(blob);
      setPdfUrl(url);
    } catch {
      setPdfUrl(null);
    }
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [isPdf, data?.content]);

  if (!method) {
    return (
      <div className="h-full flex items-center justify-center p-8 text-center text-sm text-gray-400">
        Hover or use ↑↓ to preview a method here.
      </div>
    );
  }

  const basePath = method.source_path?.includes("/")
    ? method.source_path.split("/").slice(0, -1).join("/")
    : undefined;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-5 pt-4 pb-3 border-b border-gray-100 bg-white">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-gray-900 truncate">
            {method.name}
          </h3>
          {isPcr && (
            <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded shrink-0">
              PCR
            </span>
          )}
          {isPdf && (
            <span className="text-xs px-1.5 py-0.5 bg-rose-100 text-rose-600 rounded shrink-0">
              PDF
            </span>
          )}
          {method.folder_path && (
            <span className="text-xs text-gray-400 truncate">
              {method.folder_path}
            </span>
          )}
        </div>
        {method.tags && method.tags.length > 0 && (
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {method.tags.map((tag) => (
              <span
                key={tag}
                className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        {isPcr ? (
          <div className="overflow-y-auto px-5 py-4 text-sm text-gray-500">
            PCR protocol — select the method to view and edit its gradient and
            recipe.
          </div>
        ) : !canFetchFile ? (
          <div className="overflow-y-auto px-5 py-4 text-sm text-gray-500">
            No content available.
          </div>
        ) : isLoading ? (
          <div className="overflow-y-auto px-5 py-4 text-sm text-gray-400 animate-pulse">
            Loading preview…
          </div>
        ) : isError ? (
          <div className="overflow-y-auto px-5 py-4 text-sm text-red-600">
            Couldn&rsquo;t load preview.
          </div>
        ) : isPdf ? (
          pdfUrl ? (
            <iframe
              src={pdfUrl}
              className="flex-1 w-full bg-white border-0"
              title={method.name}
            />
          ) : (
            <div className="overflow-y-auto px-5 py-4 text-sm text-gray-500">
              Unable to display PDF.
            </div>
          )
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="prose prose-sm prose-gray max-w-none">
              <RenderedMarkdown
                content={data?.content ?? ""}
                basePath={basePath}
                ownerUsername={method.owner}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
