"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { methodsApi } from "@/lib/local-api";
import type { Method } from "@/lib/types";

interface MethodPickerProps {
  open: boolean;
  currentMethodId: number | null;
  onSelect: (methodId: number) => void | Promise<void>;
  onClose: () => void;
}

type FlatRow =
  | { kind: "header"; folder: string; count: number }
  | { kind: "method"; method: Method };

const UNCATEGORIZED = "Uncategorized";

export default function MethodPicker({
  open,
  currentMethodId,
  onSelect,
  onClose,
}: MethodPickerProps) {
  const { data: methods = [], isLoading } = useQuery({
    queryKey: ["methods"],
    queryFn: methodsApi.list,
  });

  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlightedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

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

    const rows: FlatRow[] = [];
    for (const folder of folderNames) {
      const items = (byFolder.get(folder) ?? []).slice().sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      );
      rows.push({ kind: "header", folder, count: items.length });
      for (const method of items) {
        rows.push({ kind: "method", method });
      }
    }
    return rows;
  }, [methods, query]);

  const selectableIndices = useMemo(
    () =>
      flatRows
        .map((r, i) => (r.kind === "method" ? i : -1))
        .filter((i) => i !== -1),
    [flatRows]
  );

  useEffect(() => {
    if (selectableIndices.length === 0) {
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 backdrop-blur-sm pt-[10vh] px-4"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="w-full max-w-2xl bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: "75vh" }}
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

        <div ref={listRef} className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              Loading methods…
            </div>
          ) : methods.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              No methods available. Create some in the Methods section first.
            </div>
          ) : flatRows.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              No methods match &ldquo;{query}&rdquo;. Try a different search or
              clear the input.
            </div>
          ) : (
            flatRows.map((row, index) => {
              if (row.kind === "header") {
                return (
                  <div
                    key={`h:${row.folder}`}
                    className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur px-4 py-1.5 text-[11px] uppercase tracking-wide font-semibold text-gray-500 border-b border-gray-100"
                  >
                    {row.folder}
                    <span className="ml-2 text-gray-400 normal-case tracking-normal font-normal">
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
                  key={m.id}
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
