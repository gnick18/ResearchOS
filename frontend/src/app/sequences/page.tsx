"use client";

// sequence Phase 1 bot — /sequences top-level workbench (read view + library).
// SnapGene-style working tree on the left (collection selector + sortable list
// + search), a READ-ONLY SeqViz view on the right. Phase 1 is view-only; no
// editing, enzymes, primers, or cloning (Phases 2-3). New top-level route is
// excluded from the wiki-coverage gate pending a Phase 4 wiki page.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import AppShell from "@/components/AppShell";
import SequenceReadView from "@/components/sequences/SequenceReadView";
import { sequencesApi, projectsApi } from "@/lib/local-api";
import type { SequenceRecord, SeqType } from "@/lib/types";

type SortKey = "name" | "type" | "length" | "added";
type SortDir = "asc" | "desc";

// "all" | "unfiled" | a project id (as string)
type Collection = "all" | "unfiled" | string;

function seqTypeLabel(t: SeqType): string {
  return t === "protein" ? "Protein" : t === "rna" ? "RNA" : "DNA";
}

function formatAdded(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Circular / linear glyph. Inline SVG per the no-emoji icon convention. */
function MoleculeIcon({ circular, className }: { circular: boolean; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {circular ? (
        <circle cx="12" cy="12" r="8" />
      ) : (
        <line x1="4" y1="12" x2="20" y2="12" />
      )}
    </svg>
  );
}

function SortHeader({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
  className,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sortKey === col;
  return (
    <button
      type="button"
      onClick={() => onSort(col)}
      className={`flex items-center gap-1 text-left text-xs font-medium uppercase tracking-wide ${
        active ? "text-gray-700" : "text-gray-400"
      } hover:text-gray-700 ${className ?? ""}`}
    >
      {label}
      <span className="text-[10px]">{active ? (sortDir === "asc" ? "▲" : "▼") : ""}</span>
    </button>
  );
}

export default function SequencesPage() {
  const [collection, setCollection] = useState<Collection>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: sequences = [], isLoading } = useQuery({
    queryKey: ["sequences"],
    queryFn: () => sequencesApi.list(),
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", "for-sequences"],
    queryFn: () => projectsApi.list(),
  });

  // Filter by collection.
  const inCollection = useMemo(() => {
    if (collection === "all") return sequences;
    if (collection === "unfiled") return sequences.filter((s) => s.project_ids.length === 0);
    return sequences.filter((s) => s.project_ids.includes(collection));
  }, [sequences, collection]);

  // Filter by search.
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return inCollection;
    return inCollection.filter((s) => s.display_name.toLowerCase().includes(q));
  }, [inCollection, search]);

  // Sort.
  const sorted = useMemo(() => {
    const arr = [...searched];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.display_name.localeCompare(b.display_name) * dir;
        case "type":
          return a.seq_type.localeCompare(b.seq_type) * dir;
        case "length":
          return (a.length - b.length) * dir;
        case "added":
          return (
            (new Date(a.added_at).getTime() - new Date(b.added_at).getTime()) * dir
          );
        default:
          return 0;
      }
    });
    return arr;
  }, [searched, sortKey, sortDir]);

  // Keep a valid selection: default to the first visible sequence.
  useEffect(() => {
    if (sorted.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId == null || !sorted.some((s) => s.id === selectedId)) {
      setSelectedId(sorted[0].id);
    }
  }, [sorted, selectedId]);

  const onSort = (k: SortKey) => {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir("asc");
    }
  };

  // Counts for the collection selector.
  const unfiledCount = useMemo(
    () => sequences.filter((s) => s.project_ids.length === 0).length,
    [sequences],
  );
  const projectCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sequences) {
      for (const pid of s.project_ids) m.set(pid, (m.get(pid) ?? 0) + 1);
    }
    return m;
  }, [sequences]);

  const { data: selected } = useQuery({
    queryKey: ["sequence", selectedId],
    queryFn: () => (selectedId == null ? null : sequencesApi.get(selectedId)),
    enabled: selectedId != null,
  });

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-7rem)] gap-4 px-4 pb-4">
        {/* LEFT: working tree / library */}
        <aside className="flex w-[22rem] shrink-0 flex-col rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-4 py-3">
            <h1 className="text-lg font-semibold text-gray-800">Sequences</h1>
            <p className="mt-0.5 text-xs text-gray-500">
              Your plasmids and sequences, organized by project.
            </p>
          </div>

          {/* Collection selector */}
          <div className="border-b border-gray-100 px-3 py-2">
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Collection
            </label>
            <select
              value={collection}
              onChange={(e) => setCollection(e.target.value as Collection)}
              className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-sky-400 focus:outline-none"
            >
              <option value="all">All Sequences ({sequences.length})</option>
              <option value="unfiled">Unfiled ({unfiledCount})</option>
              {projects.length > 0 && (
                <optgroup label="Projects">
                  {projects.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name} ({projectCounts.get(String(p.id)) ?? 0})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* Search */}
          <div className="border-b border-gray-100 px-3 py-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sequences…"
              className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-700 placeholder:text-gray-400 focus:border-sky-400 focus:outline-none"
            />
          </div>

          {/* Sort header */}
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-gray-100 px-3 py-1.5">
            <SortHeader label="Name" col="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="Type" col="type" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="Length" col="length" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
          </div>

          {/* List */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="px-4 py-6 text-sm text-gray-400">Loading…</div>
            ) : sorted.length === 0 ? (
              <div className="px-4 py-6 text-sm text-gray-400">
                {sequences.length === 0
                  ? "No sequences yet."
                  : "No sequences match this filter."}
              </div>
            ) : (
              <ul>
                {sorted.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(s.id)}
                      className={`flex w-full items-center gap-2 border-b border-gray-50 px-3 py-2 text-left hover:bg-sky-50 ${
                        selectedId === s.id ? "bg-sky-50" : ""
                      }`}
                    >
                      <MoleculeIcon
                        circular={s.circular}
                        className={`h-4 w-4 shrink-0 ${
                          selectedId === s.id ? "text-sky-500" : "text-gray-400"
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-800">
                          {s.display_name}
                        </span>
                        <span className="block text-[11px] text-gray-400">
                          {seqTypeLabel(s.seq_type)} · {s.length.toLocaleString()} bp ·{" "}
                          {formatAdded(s.added_at)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* RIGHT: read view */}
        <section className="flex min-w-0 flex-1 flex-col rounded-lg border border-gray-200 bg-white">
          {selected ? (
            <>
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-gray-800">
                    {selected.display_name}
                  </h2>
                  <p className="text-xs text-gray-500">
                    {seqTypeLabel(selected.seq_type)} ·{" "}
                    {selected.circular ? "Circular" : "Linear"} ·{" "}
                    {selected.length.toLocaleString()} bp · {selected.feature_count}{" "}
                    {selected.feature_count === 1 ? "feature" : "features"}
                  </p>
                </div>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  Read only
                </span>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden p-2">
                <SequenceReadView key={selected.id} sequence={selected} />
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
              {sequences.length === 0
                ? "No sequences to display yet."
                : "Select a sequence from the library."}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
