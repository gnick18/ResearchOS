"use client";

// sequence Phase 1 bot — /sequences top-level workbench (read view + library).
// SnapGene-style working tree on the left (collection selector + sortable list
// + search), a READ-ONLY SeqViz view on the right. Phase 1 is view-only; no
// editing, enzymes, primers, or cloning (Phases 2-3). New top-level route is
// excluded from the wiki-coverage gate pending a Phase 4 wiki page.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AppShell from "@/components/AppShell";
import Tooltip from "@/components/Tooltip";
import SequenceEditView from "@/components/sequences/SequenceEditView";
import SequenceNewDialog, {
  type NewSequenceSubmit,
} from "@/components/sequences/SequenceNewDialog";
import SequenceDropZone from "@/components/sequences/SequenceDropZone";
import SequenceImportTargetDialog, {
  type ImportTargetRequest,
} from "@/components/sequences/SequenceImportTargetDialog";
import CloningWorkspace from "@/components/sequences/CloningWorkspace";
import { sequencesApi, projectsApi } from "@/lib/local-api";
import {
  importSequenceFile,
  buildNewSequence,
  type ImportedSequence,
} from "@/lib/sequences/import";
import {
  IMPORT_ACCEPT_ATTR,
  partitionImportableFiles,
  importStatusText,
} from "@/lib/sequences/bulk-import";
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

/** Plus glyph for the New action. Inline SVG (no emojis). */
function PlusIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/** Upload / import glyph (tray with an up-arrow). Inline SVG (no emojis). */
function ImportIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 9 12 4 17 9" />
      <line x1="12" y1="4" x2="12" y2="16" />
    </svg>
  );
}

/** Assemble glyph: a plasmid built from fragments — a ring drawn as three arc
 *  segments with gaps (DNA pieces joining into a circular construct), reading as
 *  molecular-biology assembly / cloning. Inline SVG, stroke-only. */
function AssembleIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {/* Circumference of r=8 is ~50.27; "12.5 4.25" x3 ≈ 50.25 -> three even
          arc fragments with small gaps (the junctions of an assembled plasmid). */}
      <circle cx="12" cy="12" r="8" strokeDasharray="12.5 4.25" />
    </svg>
  );
}

/** Downward chevron for the Import split-menu. Inline SVG (no emojis). */
function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/** Folder glyph for the "Choose folder…" import action. Inline SVG (no emojis). */
function FolderIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** File glyph for the "Choose files…" import action. Inline SVG (no emojis). */
function FileIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
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
      <span className="text-xs">{active ? (sortDir === "asc" ? "▲" : "▼") : ""}</span>
    </button>
  );
}

export default function SequencesPage() {
  const [collection, setCollection] = useState<Collection>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [assembleOpen, setAssembleOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  // Transient status line under the toolbar (import counts / parse errors).
  const [status, setStatus] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  // "Import into" chooser request, set when an import target is ambiguous
  // (All Sequences / Unfiled). Null when no chooser is open.
  const [importTarget, setImportTarget] = useState<ImportTargetRequest | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const importMenuRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

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

  // Persist the edited GenBank back to disk (atomic .gb rewrite via the store),
  // then refresh the summary + detail queries so the library and header update.
  const handleSave = useCallback(
    async (genbank: string): Promise<boolean> => {
      if (selectedId == null) return false;
      setSaving(true);
      try {
        await sequencesApi.update(selectedId, { genbank });
        await queryClient.invalidateQueries({ queryKey: ["sequence", selectedId] });
        await queryClient.invalidateQueries({ queryKey: ["sequences"] });
        return true;
      } catch {
        return false;
      } finally {
        setSaving(false);
      }
    },
    [selectedId, queryClient],
  );

  // Create one-or-more sequences via the store, refresh the library, and select
  // the first newly-created one. Shared by the import + new-from-paste paths.
  const persistNew = useCallback(
    async (
      imports: ImportedSequence[],
      projectIds: string[],
      onProgress?: (done: number, total: number) => void,
    ): Promise<number | null> => {
      let firstId: number | null = null;
      let done = 0;
      for (const imp of imports) {
        const rec = await sequencesApi.create({
          display_name: imp.display_name,
          genbank: imp.genbank,
          seq_type: imp.seq_type,
          project_ids: projectIds,
        });
        if (rec && firstId == null) firstId = rec.id;
        done += 1;
        onProgress?.(done, imports.length);
        // Progressive refresh: for a big folder import (dozens of files) the
        // create loop is slow, so refresh the list every few records (fire and
        // forget, no await — it must not block the loop) so sequences appear as
        // they land and the user never has to manually reload.
        if (done % 8 === 0 && done < imports.length) {
          void queryClient.invalidateQueries({ queryKey: ["sequences"] });
        }
      }
      // Final authoritative refetch once every record is written.
      await queryClient.invalidateQueries({ queryKey: ["sequences"] });
      if (firstId != null) setSelectedId(firstId);
      return firstId;
    },
    [queryClient],
  );

  // When a project collection is active, new sequences land in it; otherwise
  // they are Unfiled (All / Unfiled views ⇒ no project link).
  const activeProjectIds = useMemo(
    () => (collection === "all" || collection === "unfiled" ? [] : [collection]),
    [collection],
  );

  // NEW flow: build a sequence from pasted bases (or a blank one).
  const handleNewSubmit = useCallback(
    async (data: NewSequenceSubmit) => {
      setNewOpen(false);
      const imp = buildNewSequence({
        name: data.name,
        seqType: data.seqType,
        rawSequence: data.rawSequence,
        allowEmpty: data.allowEmpty,
      });
      if (!imp) {
        setStatus({ text: "Could not create the sequence — no valid bases.", tone: "error" });
        return;
      }
      const id = await persistNew([imp], activeProjectIds);
      if (id != null) {
        setStatus({ text: `Created "${imp.display_name}".`, tone: "ok" });
      }
    },
    [persistNew, activeProjectIds],
  );

  // Resolve a collection id (a stringified project id) to its display name, for
  // the destination-named status line. Falls back to "Unfiled" for null / no
  // match (the All / Unfiled views, or a project that has since disappeared).
  const destinationName = useCallback(
    (projectId: string | null): string => {
      if (!projectId) return "Unfiled";
      const proj = projects.find((p) => String(p.id) === projectId);
      return proj ? proj.name : "Unfiled";
    },
    [projects],
  );

  // Persist gathered imports into a chosen target and report a destination-named
  // status line. `projectId` is null for Unfiled, or a stringified project id.
  // Shared by the direct (project-active) path and the chooser confirm.
  const finishImport = useCallback(
    async (imports: ImportedSequence[], projectId: string | null, skipped: number) => {
      setImporting(true);
      try {
        await persistNew(
          imports,
          projectId ? [projectId] : [],
          (doneN, total) => {
            // Live progress for multi-file / folder imports so the user sees it
            // working (and the list filling in) rather than a frozen "Import".
            if (total > 1 && doneN < total) {
              setStatus({ text: `Importing ${doneN} of ${total}…`, tone: "ok" });
            }
          },
        );
        setStatus({
          text: importStatusText(imports.length, skipped, destinationName(projectId)),
          tone: "ok",
        });
      } finally {
        setImporting(false);
      }
    },
    [persistNew, destinationName],
  );

  // IMPORT flow (shared core): filter the gathered files to importable
  // sequence extensions (folder pick + drag-drop hand us EVERY file, so the
  // filter happens here, not the input's `accept`), then read each kept file
  // (text for .gb/.fasta, bytes for .dna), parse via the vendored bio-parsers,
  // convert to GenBank, and create. `filtered` is false for the single-/multi-
  // file picker (its `accept` already constrained the choice), so a deliberately
  // -picked non-sequence file still surfaces a parse error.
  //
  // Destination: when a specific project collection is active, the target is
  // unambiguous, so import straight into it. When the active collection is All
  // Sequences / Unfiled, the target is AMBIGUOUS, so open the "Import into"
  // chooser (defaulting to Unfiled) instead of silently dropping the files. All
  // three entry paths (file picker, folder picker, drag-drop) funnel here.
  const handleImport = useCallback(
    async (incoming: File[], opts?: { filtered?: boolean }) => {
      if (incoming.length === 0) return;
      setImporting(true);
      setStatus(null);
      try {
        let files = incoming;
        let skipped = 0;
        if (opts?.filtered) {
          const part = partitionImportableFiles(incoming);
          files = part.kept;
          skipped = part.skipped;
          if (files.length === 0) {
            const noun = skipped === 1 ? "file" : "files";
            setStatus({
              text: `No sequence files found (skipped ${skipped} non-sequence ${noun}).`,
              tone: "error",
            });
            return;
          }
        }
        const allImports: ImportedSequence[] = [];
        const messages: string[] = [];
        for (const file of files) {
          try {
            const bytes = await file.arrayBuffer();
            const res = await importSequenceFile(file.name, bytes);
            allImports.push(...res.sequences);
            messages.push(...res.messages);
          } catch {
            messages.push(`Failed to read "${file.name}".`);
          }
        }
        if (allImports.length === 0) {
          setStatus({
            text: messages[0] ?? "No sequences could be imported.",
            tone: "error",
          });
          return;
        }
        // Specific project active ⇒ unambiguous, import straight in.
        if (activeProjectIds.length > 0) {
          await finishImport(allImports, activeProjectIds[0], skipped);
          return;
        }
        // Ambiguous (All / Unfiled) ⇒ ask which collection to file into. The
        // chooser owns the rest of the flow (persist on Import, abort on
        // Cancel).
        setImportTarget({
          count: allImports.length,
          skipped,
          projects: projects.map((p) => ({ id: String(p.id), name: p.name })),
          onConfirm: (projectId) => {
            setImportTarget(null);
            void finishImport(allImports, projectId, skipped);
          },
          onCancel: () => setImportTarget(null),
        });
      } finally {
        // Release the import lock. The direct-import path already finished via
        // finishImport (which manages its own lock); the chooser path hands off
        // to onConfirm/onCancel, so the toolbar must be interactive meanwhile.
        setImporting(false);
      }
    },
    [activeProjectIds, finishImport, projects],
  );

  // File picker (single / multi): the input `accept` already constrains the
  // choice, so no extension filter — funnel straight through the import core.
  const handleFilesPicked = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      try {
        await handleImport(Array.from(files));
      } finally {
        // Reset so re-picking the same file fires onChange again.
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [handleImport],
  );

  // Folder picker (webkitdirectory): grabs EVERY file in the folder; the
  // `accept` attribute is ignored for directory mode, so we filter in code.
  const handleFolderPicked = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      try {
        await handleImport(Array.from(files), { filtered: true });
      } finally {
        if (folderInputRef.current) folderInputRef.current.value = "";
      }
    },
    [handleImport],
  );

  // Drag-and-drop: the drop zone hands us a flat File[] (folders recursed); the
  // mix is unknown, so filter in code like the folder picker.
  const handleDroppedFiles = useCallback(
    (files: File[]) => {
      void handleImport(files, { filtered: true });
    },
    [handleImport],
  );

  // Clear the transient status after a short delay.
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 6000);
    return () => clearTimeout(t);
  }, [status]);

  // Close the Import menu on outside click / Escape.
  useEffect(() => {
    if (!importMenuOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!importMenuRef.current?.contains(e.target as Node)) {
        setImportMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setImportMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [importMenuOpen]);

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-7rem)] gap-4 px-4 pb-4">
        {/* LEFT: working tree / library. Wrapped in a drag-and-drop target so a
            user can drop files or a whole folder anywhere on the library to
            bulk-import (folders recursed; non-sequence files skipped). */}
        <SequenceDropZone
          onFiles={handleDroppedFiles}
          disabled={importing}
          className="flex w-[22rem] shrink-0 flex-col"
        >
        <aside className="flex h-full w-full flex-col rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-4 py-3">
            {/* Stack the title + description above the actions so they get the
                full sidebar width (no truncated title / thin wrapped text); the
                action buttons sit on their own row below. Calm, Apple-ish. */}
            <div className="flex flex-col gap-3">
              <div>
                <h1 className="text-lg font-semibold text-gray-900">Sequences</h1>
                <p className="mt-0.5 text-xs text-gray-500">
                  Your plasmids and sequences, organized by project.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setNewOpen(true)}
                  className="flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-700"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  New
                </button>
                {/* Assemble: open the standalone overlap-assembly (Gibson /
                    NEBuilder HiFi) workspace. Combines several library
                    sequences into a new construct. */}
                <Tooltip label="Assemble a new construct from fragments (Gibson / NEBuilder HiFi overlap assembly).">
                  <button
                    type="button"
                    onClick={() => setAssembleOpen(true)}
                    className="flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100"
                  >
                    <AssembleIcon className="h-3.5 w-3.5" />
                    Assemble
                  </button>
                </Tooltip>
                {/* Import split-menu: pick files, or pick a whole folder
                    (e.g. a SnapGene collection). Drag-and-drop also works
                    anywhere on the library. */}
                <div className="relative" ref={importMenuRef}>
                  <Tooltip label="Import files or a whole folder. You can also drag files or a folder onto the library.">
                    <button
                      type="button"
                      onClick={() => setImportMenuOpen((o) => !o)}
                      disabled={importing}
                      aria-haspopup="menu"
                      aria-expanded={importMenuOpen}
                      className="flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50"
                    >
                      <ImportIcon className="h-3.5 w-3.5" />
                      {importing ? "Importing…" : "Import"}
                      <ChevronDownIcon className="h-3 w-3 text-gray-400" />
                    </button>
                  </Tooltip>
                  {importMenuOpen ? (
                    <div
                      role="menu"
                      className="absolute right-0 z-30 mt-1 w-48 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setImportMenuOpen(false);
                          fileInputRef.current?.click();
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-100"
                      >
                        <FileIcon className="h-3.5 w-3.5 text-gray-400" />
                        Choose files…
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setImportMenuOpen(false);
                          folderInputRef.current?.click();
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-100"
                      >
                        <FolderIcon className="h-3.5 w-3.5 text-gray-400" />
                        Choose folder…
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            {status ? (
              <p
                className={`mt-2 text-xs ${
                  status.tone === "error" ? "text-rose-600" : "text-emerald-600"
                }`}
              >
                {status.text}
              </p>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={IMPORT_ACCEPT_ATTR}
              className="hidden"
              onChange={(e) => handleFilesPicked(e.target.files)}
            />
            {/* Folder picker. webkitdirectory grabs every file in the chosen
                folder (accept is ignored for directory mode), so the kept set
                is filtered in code by handleFolderPicked. */}
            <input
              ref={folderInputRef}
              type="file"
              multiple
              // Non-standard attributes for directory selection (cast for TS).
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              className="hidden"
              onChange={(e) => handleFolderPicked(e.target.files)}
            />
          </div>

          {/* Collection selector */}
          <div className="border-b border-gray-100 px-3 py-2">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">
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
              sequences.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                  <p className="text-sm font-medium text-gray-600">No sequences yet</p>
                  <p className="text-xs leading-relaxed text-gray-400">
                    Use New, Assemble, or Import above to create a sequence or
                    bring in a GenBank, FASTA, or SnapGene file.
                  </p>
                </div>
              ) : (
                <div className="px-4 py-6 text-sm text-gray-400">
                  No sequences match this filter.
                </div>
              )
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
                        <span className="block text-xs text-gray-400">
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
        </SequenceDropZone>

        {/* RIGHT: the single fluid editor surface. No Read|Edit modal toggle —
            you select / inspect (readout) / edit / double-click a feature all in
            one place (SnapGene / Benchling spirit). The /sequences route renders
            it editable (the user's own sequences); a read-only embed passes
            readOnly to the same component. */}
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
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <SequenceEditView
                  key={selected.id}
                  sequence={selected}
                  onSave={handleSave}
                  saving={saving}
                />
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

      {/* "Import into" chooser — shown only when the active collection is
          ambiguous (All Sequences / Unfiled). Picks the destination project (or
          Unfiled) before the gathered sequences are persisted. */}
      <SequenceImportTargetDialog request={importTarget} />

      <SequenceNewDialog
        open={newOpen}
        onCancel={() => setNewOpen(false)}
        onSubmit={handleNewSubmit}
      />

      {/* Standalone overlap-assembly (Gibson / NEBuilder HiFi) workspace. The
          saved construct lands in the active collection and opens in the editor. */}
      <CloningWorkspace
        open={assembleOpen}
        onClose={() => setAssembleOpen(false)}
        activeProjectIds={activeProjectIds}
        onSaved={async (newId) => {
          setAssembleOpen(false);
          await queryClient.invalidateQueries({ queryKey: ["sequences"] });
          setSelectedId(newId);
          setStatus({ text: "Construct assembled and saved.", tone: "ok" });
        }}
      />
    </AppShell>
  );
}
