"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAllTasks, fetchAllMethodsIncludingShared, filesApi } from "@/lib/local-api";
import type { Method, Task, TaskMethodAttachment } from "@/lib/types";
import { getMethodTypeMeta } from "@/lib/methods/method-type-registry";
import { attachmentKey, methodKey } from "@/lib/methods/lookup";
import RenderedMarkdown from "@/components/RenderedMarkdown";

interface MethodPickerProps {
  open: boolean;
  currentMethodId: number | null;
  /** Pin "Recently used in this project" at the top when available. */
  currentProjectId?: number;
  /**
   * Hide these methods entirely — e.g. methods already attached to the task.
   * Composite `(method_id, owner)` keys so the picker can still surface a
   * public method that happens to share an id with an already-attached
   * private method (per-user id collision class). Callers must resolve
   * attachment-owner-null to the task owner before passing — the picker
   * matches strictly on the resolved namespace.
   */
  excludeMethods?: Array<{ method_id: number; owner: string }>;
  /**
   * Receives the selected method's `(id, owner)` so callers can persist the
   * attachment with the right namespace without re-resolving against a list
   * where the bare id could collide.
   */
  onSelect: (methodId: number, methodOwner: string) => void | Promise<void>;
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
 * Map of composite `(owner, id)` method key -> most recent task start_date
 * that used it. Keyed on the composite so two same-id different-owner
 * methods (e.g. alex's private 5 and morgan's private 5 surfaced in the
 * same project's recency window) don't shadow each other. The owner is
 * resolved per the same rule as `resolveMethodForAttachment`: an explicit
 * `attachment.owner` wins; null falls back to the task owner.
 */
function buildRecency(tasks: Task[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of tasks) {
    const attachmentByMid = new Map<number, TaskMethodAttachment>();
    for (const a of t.method_attachments ?? []) {
      attachmentByMid.set(a.method_id, a);
    }
    for (const mid of methodIdsOf(t)) {
      const att = attachmentByMid.get(mid);
      const key = attachmentKey(
        { method_id: mid, owner: att?.owner ?? null },
        t.owner,
      );
      const existing = out.get(key);
      if (!existing || (t.start_date && t.start_date > existing)) {
        out.set(key, t.start_date ?? "");
      }
    }
  }
  return out;
}

function topByRecency(
  recency: Map<string, string>,
  byKey: Map<string, Method>,
  limit: number
): Method[] {
  return Array.from(recency.entries())
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, limit)
    .map(([key]) => byKey.get(key))
    .filter((m): m is Method => !!m);
}

export default function MethodPicker({
  open,
  currentMethodId,
  currentProjectId,
  excludeMethods,
  onSelect,
  onClose,
}: MethodPickerProps) {
  const { data: allMethods = [], isLoading } = useQuery({
    queryKey: ["methods"],
    queryFn: fetchAllMethodsIncludingShared,
  });

  // Composite-key excludeSet: `${owner}:${id}`. Callers pre-resolve
  // attachment.owner=null to the task owner, so the picker can match
  // strictly without needing the task context.
  const excludeSet = useMemo(() => {
    const set = new Set<string>();
    for (const a of excludeMethods ?? []) {
      set.add(`${a.owner}:${a.method_id}`);
    }
    return set;
  }, [excludeMethods]);

  const methods = useMemo(
    () =>
      excludeSet.size === 0
        ? allMethods
        : allMethods.filter((m) => !excludeSet.has(`${m.owner}:${m.id}`)),
    [allMethods, excludeSet],
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

  const methodByKey = useMemo(() => {
    const m = new Map<string, Method>();
    for (const x of methods) m.set(methodKey(x), x);
    return m;
  }, [methods]);

  const recentInProject = useMemo(() => {
    if (currentProjectId == null) return [] as Method[];
    const projectTasks = tasks.filter((t) => t.project_id === currentProjectId);
    return topByRecency(buildRecency(projectTasks), methodByKey, RECENT_LIMIT);
  }, [tasks, currentProjectId, methodByKey]);

  const recentAnywhere = useMemo(() => {
    return topByRecency(buildRecency(tasks), methodByKey, RECENT_LIMIT);
  }, [tasks, methodByKey]);

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
      // section above — avoid an identical pinned block. Dedup on the
      // composite `(owner, id)` key so two methods that happen to share a
      // numeric id but live in different owner namespaces both still surface.
      const projectKeys = new Set(recentInProject.map((m) => methodKey(m)));
      const recentDeduped = recentAnywhere.filter((m) => !projectKeys.has(methodKey(m)));
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
        void onSelect(row.method.id, row.method.owner);
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
            (() => {
              // Track the running index of method (non-header) rows so the
              // first method tile in the rendered list gets the canonical
              // `experiment-attach-method-picker-first-method` anchor. The
              // §6.6 cursor demo (MethodAttachmentAttachStep) clicks this
              // anchor to attach the funny markdown method authored in
              // §6.4d; without it the demo silently no-ops and every
              // downstream §6.6 + §6.7 step wedges. Each subsequent tile
              // also gets `experiment-attach-method-picker-method-{idx}`
              // so future steps can target a specific method by index.
              let methodIdx = -1;
              return flatRows.map((row, index) => {
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
              methodIdx += 1;
              const tourTarget =
                methodIdx === 0
                  ? "experiment-attach-method-picker-first-method"
                  : `experiment-attach-method-picker-method-${methodIdx}`;
              return (
                <button
                  key={`${row.sectionKey}:${methodKey(m)}`}
                  ref={(el) => {
                    if (el) rowRefs.current.set(index, el);
                    else rowRefs.current.delete(index);
                  }}
                  data-tour-target={tourTarget}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => void onSelect(m.id, m.owner)}
                  className={`w-full text-left px-4 py-2.5 border-b border-gray-50 transition-colors ${
                    isHighlighted ? "bg-blue-50" : "bg-white hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {m.name}
                      </span>
                      {m.method_type && m.method_type !== "markdown" && (() => {
                        const meta = getMethodTypeMeta(m.method_type);
                        return (
                          <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${meta.color.bg} ${meta.color.text}`}>
                            {meta.shortLabel}
                          </span>
                        );
                      })()}
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
            });
            })()
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
  const isLc =
    method?.method_type === "lc_gradient" ||
    (method?.source_path?.startsWith("lc_gradient://") ?? false);
  const isPlate =
    method?.method_type === "plate" ||
    (method?.source_path?.startsWith("plate://") ?? false);
  const isCellCulture =
    method?.method_type === "cell_culture" ||
    (method?.source_path?.startsWith("cell_culture://") ?? false);
  const isMassSpec =
    method?.method_type === "mass_spec" ||
    (method?.source_path?.startsWith("mass_spec://") ?? false);
  const isPdf =
    method?.method_type === "pdf" ||
    (method?.source_path?.toLowerCase().endsWith(".pdf") ?? false);
  const canFetchFile =
    !!method?.source_path && !isPcr && !isLc && !isPlate && !isCellCulture && !isMassSpec;

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
          {isLc && (
            <span className="text-xs px-1.5 py-0.5 bg-sky-100 text-sky-600 rounded shrink-0">
              LC
            </span>
          )}
          {(isPlate || isCellCulture || isPdf) && (() => {
            const typeId = isPlate
              ? "plate"
              : isCellCulture
              ? "cell_culture"
              : "pdf";
            const meta = getMethodTypeMeta(typeId);
            return (
              <span
                className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${meta.color.bg} ${meta.color.text}`}
              >
                {meta.shortLabel}
              </span>
            );
          })()}
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
        ) : isLc ? (
          <div className="overflow-y-auto px-5 py-4 text-sm text-gray-500">
            LC gradient — select the method to view its solvent gradient, column,
            and ingredients.
          </div>
        ) : isPlate ? (
          <div className="overflow-y-auto px-5 py-4 text-sm text-gray-500">
            Plate layout — select the method to view the plate grid and any
            pre-labeled regions.
          </div>
        ) : isCellCulture ? (
          <div className="overflow-y-auto px-5 py-4 text-sm text-gray-500">
            Cell culture passaging — select the method to view its schedule,
            media, and planned cadence.
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
