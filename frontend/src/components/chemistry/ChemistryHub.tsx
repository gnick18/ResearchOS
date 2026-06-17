"use client";

// The /chemistry workbench (left-rail redesign, Grant 2026-06-11). Mirrors the
// /sequences split-pane: a signature left list rail (collection selector + the
// molecules in that collection) and a main pane that shows the selected
// molecule's detail (fast RDKit view) or, with nothing selected, the launcher.
// Clicking around the rail is instant because the detail view is RDKit-rendered;
// drawing/editing opens the Ketcher popup on demand (heavy to mount).
//
// The parent (app/chemistry/page.tsx) owns the editor + PubChem + import popups,
// so this takes their open callbacks. Selection + collection + the deep-link live
// here.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  substructureMatches,
  similarityRank,
  type SimilarityResult,
} from "@/lib/chemistry/structure-search";

import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons";
import { moleculesApi, type Molecule } from "@/lib/chemistry/api";
import { getRdkit } from "@/lib/chemistry/rdkit";
import { emitMoleculeDeleted } from "@/lib/chemistry/delete-toast-bus";
import { projectsApi } from "@/lib/local-api";
import { useContextMenu } from "@/components/context-menu/ContextMenuProvider";
import type { EditMenuItem } from "@/components/sequences/SequenceEditMenu";
import { referenceClipboardText } from "@/lib/copy-reference";
import { objectReferenceMarkdown } from "@/lib/references";
import { setBeakerContext } from "@/components/ai/context-bridge";
import SendReferencePicker from "@/components/references/SendReferencePicker";
import {
  useSplitShell,
  SplitDivider,
  RailReopenButton,
} from "@/components/SplitShell";
import { MoleculeThumbnail } from "./MoleculeThumbnail";
import { MoleculeDetail } from "./MoleculeDetail";
import { LiteratureSearch } from "./LiteratureSearch";

const LIST_WIDTH_KEY = "researchos:chemistry:listWidth";
type SortKey = "recent" | "name";
type MainView = "auto" | "literature";
type SearchMode = "text" | "structure";
type StructureMode = "substructure" | "similar";

export function ChemistryHub({
  onNewStructure,
  onOpenMolecule,
  onSearchPubchem,
  onImportFile,
  selectSignal,
}: {
  onNewStructure: () => void;
  onOpenMolecule: (id: string) => void;
  onSearchPubchem: () => void;
  onImportFile: () => void;
  // A nonce-stamped request to select a molecule by id (e.g. just imported from
  // PubChem or a file), so the hub lands the user on it. The nonce lets the same
  // id be re-selected, and re-runs the effect only when the parent fires it.
  selectSignal?: { id: string; nonce: number } | null;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [collection, setCollection] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mainView, setMainView] = useState<MainView>("auto");
  // Bulk selection (v2 Phase 1d). A non-empty set shows the action bar; bulk
  // delete routes each id through the recoverable trash and fires ONE shared
  // Undo toast, mirroring the sequences library.
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // Right-click quick-actions menu state. renameTarget drives the rename modal;
  // sendMolecule drives the "Send to..." picker.
  const [renameTarget, setRenameTarget] = useState<Molecule | null>(null);
  const [sendMolecule, setSendMolecule] = useState<Molecule | null>(null);
  // Transient confirmation after a "Send to..." completes (the hub has no other
  // toast surface for it, unlike the sequence header's status line).
  const [sendNotice, setSendNotice] = useState<string | null>(null);
  const sendNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryClient = useQueryClient();
  const { openMenu } = useContextMenu();

  // Structure search state (v2 Phase 2). When searchMode === "structure", the
  // text input becomes a SMILES/SMARTS field and the list is replaced by async
  // RDKit results. Text mode is unchanged.
  const [searchMode, setSearchMode] = useState<SearchMode>("text");
  const [structureMode, setStructureMode] = useState<StructureMode>("substructure");
  const [structureQuery, setStructureQuery] = useState("");
  // Debounced value that actually fires RDKit (avoids per-keystroke wasm calls).
  const [debouncedStructureQuery, setDebouncedStructureQuery] = useState("");
  const [structureSearching, setStructureSearching] = useState(false);
  const [structureError, setStructureError] = useState<string | null>(null);
  // Substructure results: ids that contain the query.
  const [substructHitIds, setSubstructHitIds] = useState<Set<string>>(new Set());
  // Similarity results: ranked list with scores.
  const [similarityResults, setSimilarityResults] = useState<SimilarityResult[]>([]);

  const shell = useSplitShell(LIST_WIDTH_KEY);

  const {
    data: molecules = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["molecules"],
    queryFn: () => moleculesApi.list(),
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects", "for-chemistry"],
    queryFn: () => projectsApi.list(),
  });

  // Warm the heavy engines in the background once the workbench has settled, so
  // the first interaction is near-instant instead of blocking on a cold load:
  //   - RDKit (~6.6 MB wasm) backs every thumbnail + the identity readout, so a
  //     cold load otherwise stalls the first molecule render. getRdkit() is a
  //     memoized singleton, so the later real call reuses this warmed instance.
  //   - Ketcher: importing the canvas chunk preloads the editor code AND spawns
  //     the shared Indigo worker; warmKetcher() then compiles its wasm ahead of
  //     time. The worker is reused by the Editor on open (ketcher-standalone
  //     shares one module-level worker), so the open skips chunk load + compile.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      // RDKit's wasm loads via a runtime script tag, so this only kicks off the
      // download/compile; nothing heavy is pulled into the page bundle.
      void getRdkit().catch(() => {});
      void import("./KetcherCanvas")
        .then((m) => {
          // The user may have left /chemistry while the chunk loaded; do not warm
          // (spawn the worker for) a page that is gone.
          if (!cancelled) return m.warmKetcher();
        })
        .catch(() => {});
    };
    const ric = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
      }
    ).requestIdleCallback;
    let idleId: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (ric) idleId = ric(warm, { timeout: 4000 });
    else timer = setTimeout(warm, 1500);
    return () => {
      cancelled = true;
      const cic = (
        window as unknown as { cancelIdleCallback?: (id: number) => void }
      ).cancelIdleCallback;
      if (idleId != null && cic) cic(idleId);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Deep link: /chemistry?molecule=<id> selects that molecule in the rail (from a
  // note chip or a project Molecules row). Read the URL directly to avoid the
  // useSearchParams Suspense boundary, and strip the param after.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const mol = params.get("molecule");
    if (mol) {
      setSelectedId(mol);
      setMainView("auto");
      params.delete("molecule");
      const qs = params.toString();
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (qs ? `?${qs}` : ""),
      );
    }
  }, []);

  // A just-imported molecule: select it and show its detail. Keyed on the nonce
  // so re-importing the same id still re-fires.
  const selectNonce = selectSignal?.nonce;
  useEffect(() => {
    if (selectSignal?.id) {
      setSelectedId(selectSignal.id);
      setMainView("auto");
      shell.setCollapsed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectNonce]);

  const projectName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(String(p.id), p.name);
    return map;
  }, [projects]);

  const unfiledCount = useMemo(
    () => molecules.filter((m) => m.project_ids.length === 0).length,
    [molecules],
  );
  const projectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of molecules)
      for (const pid of m.project_ids)
        counts.set(pid, (counts.get(pid) ?? 0) + 1);
    return counts;
  }, [molecules]);

  const inCollection = useMemo(() => {
    if (collection === "all") return molecules;
    if (collection === "unfiled")
      return molecules.filter((m) => m.project_ids.length === 0);
    return molecules.filter((m) => m.project_ids.includes(collection));
  }, [molecules, collection]);

  // Debounce the structure query so we do not fire RDKit on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedStructureQuery(structureQuery), 300);
    return () => clearTimeout(id);
  }, [structureQuery]);

  // Run the structure search whenever the debounced query, mode, or collection
  // changes. Clears results on mode switch or empty query.
  useEffect(() => {
    const q = debouncedStructureQuery.trim();
    if (searchMode !== "structure" || !q) {
      setSubstructHitIds(new Set());
      setSimilarityResults([]);
      setStructureError(null);
      setStructureSearching(false);
      return;
    }

    const targets = inCollection
      .filter((m) => m.smiles)
      .map((m) => ({ id: m.id, structure: m.smiles ?? "" }));

    setStructureSearching(true);
    setStructureError(null);

    let cancelled = false;

    const run = async () => {
      try {
        if (structureMode === "substructure") {
          const hits = await substructureMatches(q, targets);
          if (!cancelled) {
            setSubstructHitIds(hits);
            setSimilarityResults([]);
          }
        } else {
          const ranked = await similarityRank(q, targets);
          if (!cancelled) {
            setSimilarityResults(ranked);
            setSubstructHitIds(new Set());
          }
        }
      } catch (err) {
        if (!cancelled) {
          setStructureError(
            err instanceof Error ? err.message : "Structure search failed",
          );
          setSubstructHitIds(new Set());
          setSimilarityResults([]);
        }
      } finally {
        if (!cancelled) setStructureSearching(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedStructureQuery, structureMode, searchMode, inCollection]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? inCollection.filter(
          (m) =>
            m.name.toLowerCase().includes(q) ||
            (m.formula ?? "").toLowerCase().includes(q) ||
            (m.smiles ?? "").toLowerCase().includes(q),
        )
      : inCollection.slice();
    filtered.sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : Number(b.id) - Number(a.id),
    );
    return filtered;
  }, [inCollection, query, sort]);

  // Structure mode result lists. These replace `shown` while searchMode is
  // "structure" and a debounced query is present.
  const SIMILARITY_CAP = 50;

  const structureSubstructShown = useMemo(() => {
    if (searchMode !== "structure" || structureMode !== "substructure") return null;
    if (!debouncedStructureQuery.trim()) return null;
    return inCollection.filter((m) => substructHitIds.has(m.id));
  }, [searchMode, structureMode, debouncedStructureQuery, inCollection, substructHitIds]);

  const structureSimilarShown = useMemo(() => {
    if (searchMode !== "structure" || structureMode !== "similar") return null;
    if (!debouncedStructureQuery.trim()) return null;
    const scoreMap = new Map<string, number>(
      similarityResults.map((r) => [r.id, r.score]),
    );
    return inCollection
      .filter((m) => {
        const s = scoreMap.get(m.id);
        return s != null && s > 0;
      })
      .sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0))
      .slice(0, SIMILARITY_CAP);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchMode, structureMode, debouncedStructureQuery, inCollection, similarityResults]);

  const selected = useMemo(
    () => molecules.find((m) => m.id === selectedId) ?? null,
    [molecules, selectedId],
  );

  // Publish the selected molecule to the BeakerBot context bridge so the model
  // can resolve "this", "this molecule", or "this compound" to what the user has
  // open in the rail. Mirrors the Data Hub publisher: rebuilt when the selection
  // changes, cleared on deselect and on unmount so the model never inherits a
  // stale selection.
  useEffect(() => {
    if (!selected) {
      setBeakerContext(null);
      return;
    }
    setBeakerContext({
      route: "/chemistry",
      pageLabel: "Chemistry",
      selection: {
        type: "molecule",
        id: selected.id,
        name: selected.name || "Untitled molecule",
      },
    });
    return () => {
      setBeakerContext(null);
    };
  }, [selected]);

  // -- Bulk selection ------------------------------------------------------
  // Keep the checked set consistent with the live data: drop ids that have
  // left the library (deleted), but DO NOT clear on a search/collection change
  // so a user can refine the view mid-selection (mirrors the sequences rule).
  useEffect(() => {
    setCheckedIds((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(molecules.map((m) => m.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (live.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [molecules]);

  // The "active list" -- what is actually displayed in the rail at the moment.
  // In structure mode with a live query, this is the structure results; otherwise
  // it is the text-filtered `shown` list. Checked-state operations (select all,
  // count) all key off this.
  const activeList = useMemo(() => {
    if (searchMode === "structure" && debouncedStructureQuery.trim()) {
      if (structureMode === "substructure" && structureSubstructShown)
        return structureSubstructShown;
      if (structureMode === "similar" && structureSimilarShown)
        return structureSimilarShown;
      return [];
    }
    return shown;
  }, [
    searchMode,
    debouncedStructureQuery,
    structureMode,
    structureSubstructShown,
    structureSimilarShown,
    shown,
  ]);

  const visibleCheckedCount = useMemo(
    () => activeList.reduce((n, m) => n + (checkedIds.has(m.id) ? 1 : 0), 0),
    [activeList, checkedIds],
  );
  const allVisibleChecked = activeList.length > 0 && visibleCheckedCount === activeList.length;
  const someVisibleChecked = visibleCheckedCount > 0 && !allVisibleChecked;

  const toggleChecked = useCallback((id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAllVisible = useCallback(() => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      const everyVisible =
        activeList.length > 0 && activeList.every((m) => next.has(m.id));
      if (everyVisible) for (const m of activeList) next.delete(m.id);
      else for (const m of activeList) next.add(m.id);
      return next;
    });
  }, [activeList]);

  const clearSelection = useCallback(() => setCheckedIds(new Set()), []);

  const handleBulkDelete = useCallback(async () => {
    const ids = Array.from(checkedIds);
    if (ids.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      const deleted: string[] = [];
      for (const id of ids) {
        try {
          if (await moleculesApi.remove(id)) deleted.push(id);
        } catch (err) {
          console.warn("[chemistry] bulk delete failed for", id, err);
        }
      }
      if (deleted.includes(selectedId ?? "")) setSelectedId(null);
      setCheckedIds(new Set());
      await queryClient.invalidateQueries({ queryKey: ["molecules"] });
      await queryClient.invalidateQueries({ queryKey: ["project-molecules"] });
      if (deleted.length > 0) {
        emitMoleculeDeleted({
          ids: deleted,
          label:
            deleted.length === 1
              ? "1 molecule"
              : `${deleted.length} molecules`,
          onRestored: () => {
            void queryClient.invalidateQueries({ queryKey: ["molecules"] });
            void queryClient.invalidateQueries({ queryKey: ["project-molecules"] });
          },
        });
      }
    } finally {
      setBulkBusy(false);
    }
  }, [checkedIds, bulkBusy, selectedId, queryClient]);

  const handleBulkAddToProject = useCallback(
    async (projectId: string) => {
      const ids = Array.from(checkedIds);
      if (ids.length === 0 || bulkBusy || !projectId) return;
      setBulkBusy(true);
      try {
        for (const id of ids) {
          const mol = molecules.find((m) => m.id === id);
          if (!mol || mol.project_ids.includes(projectId)) continue;
          try {
            await moleculesApi.update(id, {
              project_ids: [...mol.project_ids, projectId],
            });
          } catch (err) {
            console.warn("[chemistry] bulk link failed for", id, err);
          }
        }
        await queryClient.invalidateQueries({ queryKey: ["molecules"] });
        await queryClient.invalidateQueries({ queryKey: ["project-molecules"] });
      } finally {
        setBulkBusy(false);
      }
    },
    [checkedIds, bulkBusy, molecules, queryClient],
  );

  // Right-click quick actions for a single molecule. The infra is the same
  // website-wide context-menu framework the sequences library uses; the items
  // mirror it (minus Share, which molecules do not have). Rename + Duplicate are
  // the genuinely new affordances (neither exists in the detail pane today).
  const invalidateMolecules = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["molecules"] });
    await queryClient.invalidateQueries({ queryKey: ["project-molecules"] });
  }, [queryClient]);

  const handleRenameConfirm = useCallback(
    async (next: string) => {
      const target = renameTarget;
      setRenameTarget(null);
      const trimmed = next.trim();
      if (!target || !trimmed || trimmed === target.name) return;
      await moleculesApi.update(target.id, { name: trimmed });
      await invalidateMolecules();
    },
    [renameTarget, invalidateMolecules],
  );

  const handleDuplicate = useCallback(
    async (m: Molecule) => {
      // Duplicate needs the source Molfile (create re-derives identity from it),
      // so fetch the full record first. The copy lands in the same collections.
      const detail = await moleculesApi.get(m.id);
      if (!detail) return;
      const copy = await moleculesApi.create(detail.molfile, {
        name: `${m.name} copy`,
        project_ids: m.project_ids,
        source: m.source,
      });
      await invalidateMolecules();
      setSelectedId(copy.meta.id);
      setMainView("auto");
    },
    [invalidateMolecules],
  );

  const handleCopyReference = useCallback((m: Molecule) => {
    void navigator.clipboard
      ?.writeText(referenceClipboardText("molecule", m.id, m.name))
      .catch(() => {});
  }, []);

  const handleDeleteOne = useCallback(
    async (m: Molecule) => {
      const ok = await moleculesApi.remove(m.id);
      if (!ok) return;
      if (selectedId === m.id) setSelectedId(null);
      await invalidateMolecules();
      emitMoleculeDeleted({
        ids: [m.id],
        label: "1 molecule",
        onRestored: () => {
          void invalidateMolecules();
        },
      });
    },
    [selectedId, invalidateMolecules],
  );

  const buildMoleculeMenu = useCallback(
    (m: Molecule): EditMenuItem[] => [
      {
        id: "edit",
        label: "Edit structure",
        enabled: true,
        onRun: () => onOpenMolecule(m.id),
      },
      {
        id: "rename",
        label: "Rename",
        enabled: true,
        onRun: () => setRenameTarget(m),
      },
      {
        id: "duplicate",
        label: "Duplicate",
        enabled: true,
        onRun: () => void handleDuplicate(m),
      },
      {
        id: "copy-reference",
        label: "Copy reference for a note",
        enabled: true,
        group: true,
        onRun: () => handleCopyReference(m),
      },
      {
        id: "send",
        label: "Send to a note, experiment, or method",
        enabled: true,
        onRun: () => setSendMolecule(m),
      },
      {
        id: "delete",
        label: "Delete",
        enabled: true,
        destructive: true,
        group: true,
        onRun: () => void handleDeleteOne(m),
      },
    ],
    [onOpenMolecule, handleDuplicate, handleCopyReference, handleDeleteOne],
  );

  return (
    <div
      ref={shell.containerRef}
      className="relative flex h-full min-h-0 px-4 pb-4 gap-0"
    >
      {/* Re-open pill, shown only when the rail is collapsed. */}
      {shell.collapsed ? (
        <RailReopenButton
          onClick={() => shell.setCollapsed(false)}
          label="Show the molecule list"
        />
      ) : null}
      {/* LEFT RAIL */}
      <aside
        className={`flex shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-surface-raised transition-[width] duration-200 ${
          shell.collapsed ? "pointer-events-none border-0" : ""
        }`}
        style={{ width: shell.collapsed ? 0 : shell.width }}
        aria-hidden={shell.collapsed}
      >
        {/* header + actions */}
        <div className="border-b border-border px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-title font-bold text-foreground">Chemistry</h1>
            <div className="flex items-center gap-2">
              <span className="text-meta text-foreground-muted">
                {molecules.length} molecule{molecules.length === 1 ? "" : "s"}
              </span>
              <Tooltip label="Hide the list">
                <button
                  type="button"
                  onClick={() => shell.setCollapsed(true)}
                  aria-label="Hide the molecule list"
                  className="shrink-0 rounded-md p-1 text-foreground-muted hover:text-foreground hover:bg-surface-sunken"
                >
                  <Icon name="chevronLeft" className="w-4 h-4" />
                </button>
              </Tooltip>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            <RailAction icon="pencil" label="New" onClick={onNewStructure} primary />
            <RailAction icon="search" label="PubChem" onClick={onSearchPubchem} />
            <RailAction icon="download" label="Import" onClick={onImportFile} />
            <RailAction
              icon="book"
              label="Literature"
              onClick={() => {
                setSelectedId(null);
                setMainView("literature");
              }}
              active={mainView === "literature"}
            />
          </div>
        </div>

        {/* collection selector */}
        <div className="border-b border-border px-3 py-2">
          <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-foreground-muted">
            Collection
          </label>
          <select
            aria-label="Filter molecules by collection"
            value={collection}
            onChange={(e) => setCollection(e.target.value)}
            className="w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground outline-none focus:border-brand-action"
          >
            <option value="all">All molecules ({molecules.length})</option>
            <option value="unfiled">Unfiled ({unfiledCount})</option>
            {projects.length > 0 ? (
              <optgroup label="Projects">
                {projects.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name} ({projectCounts.get(String(p.id)) ?? 0})
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </div>

        {/* Library filter + structure search. Both act ONLY on your own
            molecules. Finding NEW compounds is the PubChem action above, this
            box never reaches outside your library. The default is a plain
            filter so it does not read like a global chemical search. */}
        <div className="border-b border-border px-3 py-2 space-y-2">
          {searchMode === "text" ? (
            <>
              {/* Filter the molecules you already have */}
              <div className="relative">
                <Icon
                  name="search"
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-muted"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter your molecules"
                  aria-label="Filter your molecules by name, formula, or SMILES"
                  className="w-full min-w-0 rounded-md border border-border bg-surface-raised pl-8 pr-2.5 py-1.5 text-body text-foreground placeholder:text-foreground-muted outline-none focus:border-brand-action"
                />
              </div>
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setSearchMode("structure")}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-meta font-semibold text-brand-action hover:bg-accent-soft"
                >
                  <Icon name="moleculeLinear" className="h-3.5 w-3.5" />
                  Search by structure
                </button>
                <Tooltip label={`Sort by ${sort === "recent" ? "name" : "recent"}`}>
                  <button
                    type="button"
                    onClick={() => setSort((s) => (s === "recent" ? "name" : "recent"))}
                    aria-label="Toggle sort order"
                    className="shrink-0 rounded-md border border-border px-2 py-1 text-meta font-semibold text-foreground-muted hover:text-foreground"
                  >
                    {sort === "recent" ? "Recent" : "Name"}
                  </button>
                </Tooltip>
              </div>
            </>
          ) : (
            /* Structure search, still over your own library */
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-meta font-semibold text-foreground">
                  Search your library by structure
                </span>
                <button
                  type="button"
                  onClick={() => setSearchMode("text")}
                  className="inline-flex items-center gap-0.5 text-meta font-semibold text-foreground-muted hover:text-foreground"
                >
                  <Icon name="chevronLeft" className="h-3.5 w-3.5" />
                  Filter
                </button>
              </div>
              {/* Substructure / Similar sub-toggle */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setStructureMode("substructure")}
                  className={`rounded-md px-2.5 py-1 text-meta font-semibold transition-colors ${
                    structureMode === "substructure"
                      ? "bg-accent-soft text-brand-action"
                      : "text-foreground-muted hover:text-foreground hover:bg-surface-sunken"
                  }`}
                >
                  Substructure
                </button>
                <button
                  type="button"
                  onClick={() => setStructureMode("similar")}
                  className={`rounded-md px-2.5 py-1 text-meta font-semibold transition-colors ${
                    structureMode === "similar"
                      ? "bg-accent-soft text-brand-action"
                      : "text-foreground-muted hover:text-foreground hover:bg-surface-sunken"
                  }`}
                >
                  Similar
                </button>
              </div>
              {/* SMILES / SMARTS input */}
              <input
                type="text"
                data-testid="chem-structure-query-input"
                value={structureQuery}
                onChange={(e) => setStructureQuery(e.target.value)}
                placeholder={
                  structureMode === "substructure"
                    ? "SMILES or SMARTS, e.g. c1ccccc1"
                    : "SMILES query, e.g. CC(=O)O"
                }
                className="w-full min-w-0 rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-body font-mono text-foreground placeholder:text-foreground-muted outline-none focus:border-brand-action"
              />
            </div>
          )}
        </div>

        {/* select all (only when there are rows to select) */}
        {!isLoading && !isError && activeList.length > 0 ? (
          <div
            className="flex items-center gap-2 border-b border-border px-3 py-1.5"
            // Stop clicks on this row from bubbling to any ancestor that might
            // interpret them as a molecule-row activation, preventing the
            // select-all checkbox from inadvertently opening the editor.
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={allVisibleChecked}
              ref={(el) => {
                if (el) el.indeterminate = someVisibleChecked;
              }}
              onChange={toggleAllVisible}
              // Also stop the native click event on the input itself so it
              // never reaches a parent molecule-row handler.
              onClick={(e) => e.stopPropagation()}
              aria-label="Select all shown molecules"
              className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-border text-accent focus:ring-sky-400"
            />
            <span className="text-meta text-foreground-muted">
              {checkedIds.size > 0 ? `${checkedIds.size} selected` : "Select all"}
            </span>
          </div>
        ) : null}

        {/* list */}
        <div className="min-h-0 flex-1 overflow-y-auto [overscroll-behavior:contain]">
          {isError ? (
            <p className="px-3 py-6 text-meta text-red-600 dark:text-red-300">
              Could not read your library. Check your data folder is connected.
            </p>
          ) : isLoading ? (
            <p className="px-3 py-6 text-meta text-foreground-muted">Loading...</p>
          ) : searchMode === "structure" && debouncedStructureQuery.trim() ? (
            /* -- Structure search results. Only render these once a query is
               actually entered. A blank structure box falls through to the full
               library below, so switching into structure mode never blanks the
               list (an empty filter shows everything, not nothing). -- */
            structureSearching ? (
              <p className="px-3 py-6 text-meta text-foreground-muted">
                Searching structures...
              </p>
            ) : structureError ? (
              <p className="px-3 py-6 text-meta text-red-600 dark:text-red-300">
                {structureError}
              </p>
            ) : structureMode === "substructure" &&
              structureSubstructShown !== null ? (
              structureSubstructShown.length === 0 ? (
                <p className="px-3 py-6 text-meta text-foreground-muted">
                  No molecules contain this substructure.
                </p>
              ) : (
                <>
                  <p className="px-3 pt-2 pb-1 text-meta text-foreground-muted">
                    <span className="font-semibold text-foreground">
                      {structureSubstructShown.length}
                    </span>{" "}
                    {structureSubstructShown.length === 1
                      ? "molecule contains"
                      : "molecules contain"}{" "}
                    this substructure
                  </p>
                  <ul>
                    {structureSubstructShown.map((m) => (
                      <MoleculeRow
                        key={m.id}
                        molecule={m}
                        projectName={projectName}
                        selected={selectedId === m.id}
                        checked={checkedIds.has(m.id)}
                        onToggleCheck={() => toggleChecked(m.id)}
                        onContextMenu={(e) => openMenu(e, buildMoleculeMenu(m))}
                        onClick={() => {
                          setSelectedId(m.id);
                          setMainView("auto");
                        }}
                      />
                    ))}
                  </ul>
                </>
              )
            ) : structureMode === "similar" && structureSimilarShown !== null ? (
              structureSimilarShown.length === 0 ? (
                <p className="px-3 py-6 text-meta text-foreground-muted">
                  No similar molecules found in this collection.
                </p>
              ) : (
                <>
                  <p className="px-3 pt-2 pb-1 text-meta text-foreground-muted">
                    Ranked by Tanimoto similarity
                  </p>
                  <ul>
                    {structureSimilarShown.map((m) => {
                      const score = similarityResults.find((r) => r.id === m.id)?.score ?? 0;
                      return (
                        <MoleculeRow
                          key={m.id}
                          molecule={m}
                          projectName={projectName}
                          selected={selectedId === m.id}
                          checked={checkedIds.has(m.id)}
                          onToggleCheck={() => toggleChecked(m.id)}
                        onContextMenu={(e) => openMenu(e, buildMoleculeMenu(m))}
                          onClick={() => {
                            setSelectedId(m.id);
                            setMainView("auto");
                          }}
                          similarityScore={score}
                        />
                      );
                    })}
                  </ul>
                </>
              )
            ) : null
          ) : shown.length === 0 ? (
            <p className="px-3 py-6 text-meta text-foreground-muted">
              {molecules.length === 0
                ? "No molecules yet. Draw one, search PubChem, or import a file."
                : query.trim()
                  ? `No molecules match "${query}".`
                  : "No molecules in this collection."}
            </p>
          ) : (
            <ul>
              {shown.map((m) => (
                <MoleculeRow
                  key={m.id}
                  molecule={m}
                  projectName={projectName}
                  selected={selectedId === m.id}
                  checked={checkedIds.has(m.id)}
                  onToggleCheck={() => toggleChecked(m.id)}
                  onContextMenu={(e) => openMenu(e, buildMoleculeMenu(m))}
                  onClick={() => {
                    setSelectedId(m.id);
                    setMainView("auto");
                  }}
                />
              ))}
            </ul>
          )}
        </div>

        {/* bulk action bar */}
        {checkedIds.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface-sunken px-3 py-2">
            <span className="text-meta font-semibold text-foreground">
              {checkedIds.size} selected
            </span>
            {projects.length > 0 ? (
              <select
                aria-label="Add selected molecules to a project"
                value=""
                disabled={bulkBusy}
                onChange={(e) => {
                  if (e.target.value) {
                    void handleBulkAddToProject(e.target.value);
                    e.target.value = "";
                  }
                }}
                className="rounded-md border border-border bg-surface-raised px-2 py-1 text-meta text-foreground outline-none focus:border-brand-action disabled:opacity-60"
              >
                <option value="">Add to project...</option>
                {projects.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : null}
            <button
              type="button"
              onClick={() => void handleBulkDelete()}
              disabled={bulkBusy}
              className="ml-auto rounded-md px-2.5 py-1 text-meta font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-500/10"
            >
              {bulkBusy ? "Deleting..." : "Delete"}
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="rounded-md px-2 py-1 text-meta text-foreground-muted hover:text-foreground"
            >
              Clear
            </button>
          </div>
        ) : null}
      </aside>

      {/* DIVIDER (hidden when the rail is collapsed) */}
      <SplitDivider shell={shell} label="Resize the molecule list" />

      {/* MAIN PANE */}
      <section className="flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-surface-raised overflow-hidden">
        {mainView === "literature" ? (
          <div className="min-h-0 flex-1 overflow-y-auto [overscroll-behavior:contain] px-6 py-6">
            <button
              type="button"
              onClick={() => setMainView("auto")}
              className="inline-flex items-center gap-1.5 mb-4 text-meta font-semibold text-foreground-muted hover:text-foreground"
            >
              <Icon name="chevronLeft" className="w-4 h-4" />
              Back to the library
            </button>
            <LiteratureSearch />
          </div>
        ) : selected ? (
          <MoleculeDetail
            key={selected.id}
            molecule={selected}
            projects={projects}
            onEdit={onOpenMolecule}
            onDeleted={() => setSelectedId(null)}
          />
        ) : selectedId && !isLoading ? (
          // A selected molecule that is not in the library (a deep link to a
          // deleted / missing id). Tell the user instead of a silent launcher.
          <div className="min-h-0 flex-1 grid place-items-center px-6 py-10 text-center">
            <div>
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-surface-sunken text-foreground-muted grid place-items-center">
                <Icon name="vial" className="w-6 h-6" />
              </div>
              <h2 className="text-title font-bold text-foreground mb-1">
                That molecule is not in this library
              </h2>
              <p className="text-meta text-foreground-muted max-w-prose mb-4">
                It may have been deleted, or the link points at a different data
                folder.
              </p>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="inline-flex items-center gap-2 px-4 py-2 text-body font-semibold text-foreground bg-surface-raised border border-border rounded-lg hover:border-brand-action"
              >
                Back to the library
              </button>
            </div>
          </div>
        ) : (
          <Launcher
            empty={molecules.length === 0}
            onNewStructure={onNewStructure}
            onSearchPubchem={onSearchPubchem}
            onImportFile={onImportFile}
            onLiterature={() => {
              setSelectedId(null);
              setMainView("literature");
            }}
          />
        )}
      </section>

      {/* Right-click quick-action modals. */}
      {renameTarget && (
        <MoleculeRenameModal
          current={renameTarget.name}
          onCancel={() => setRenameTarget(null)}
          onConfirm={(name) => void handleRenameConfirm(name)}
        />
      )}
      {sendMolecule && (
        <SendReferencePicker
          referenceMarkdown={objectReferenceMarkdown(
            "molecule",
            sendMolecule.id,
            sendMolecule.name,
          )}
          sourceLabel={sendMolecule.name}
          onClose={() => setSendMolecule(null)}
          onResult={(message) => {
            setSendNotice(message);
            if (sendNoticeTimer.current) clearTimeout(sendNoticeTimer.current);
            sendNoticeTimer.current = setTimeout(() => setSendNotice(null), 2600);
          }}
        />
      )}
      {sendNotice && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-foreground text-surface text-meta font-medium shadow-2xl"
        >
          {sendNotice}
        </div>
      )}
    </div>
  );
}

/** Small rename modal for a molecule, reached from the right-click menu. Mirrors
 *  the sequences rename affordance: a prefilled input, Enter to save, Escape to
 *  cancel. */
function MoleculeRenameModal({
  current,
  onCancel,
  onConfirm,
}: {
  current: string;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const [value, setValue] = useState(current);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-black/20"
      onMouseDown={onCancel}
    >
      <div
        className="w-full max-w-sm bg-surface-raised border border-border rounded-xl ros-popup-card-shadow p-4"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-body font-semibold text-foreground mb-2">Rename molecule</h3>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onConfirm(value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          className="w-full px-3 py-2 text-body text-foreground bg-surface border border-border rounded-lg outline-none focus:border-brand-action"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-meta font-medium text-foreground-muted hover:text-foreground rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(value)}
            className="ros-btn-raise px-3 py-1.5 text-meta font-semibold text-white bg-brand-action rounded-lg hover:opacity-90 transition-opacity"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function RailAction({
  icon,
  label,
  onClick,
  primary,
  active,
}: {
  icon: "pencil" | "search" | "download" | "book";
  label: string;
  onClick: () => void;
  primary?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={`chem-rail-${label.toLowerCase().replace(/\s+/g, "-")}`}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-meta font-semibold transition-colors ${
        primary
          ? "text-white bg-brand-action transition-colors hover:bg-brand-action/90"
          : active
            ? "bg-accent-soft text-brand-action border border-brand-action"
            : "text-foreground-muted border border-border hover:text-foreground hover:bg-surface-sunken"
      }`}
    >
      <Icon name={icon} className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

function MoleculeRow({
  molecule,
  projectName,
  selected,
  checked,
  onToggleCheck,
  onClick,
  onContextMenu,
  similarityScore,
}: {
  molecule: Molecule;
  projectName: Map<string, string>;
  selected: boolean;
  checked: boolean;
  onToggleCheck: () => void;
  onClick: () => void;
  /** Right-click handler, wired by the hub to open the molecule quick-actions
   *  menu (Edit / Rename / Duplicate / Copy reference / Send to / Delete). */
  onContextMenu?: (e: React.MouseEvent) => void;
  /** When defined, a Tanimoto similarity score in [0,1] is shown as a badge. */
  similarityScore?: number;
}) {
  const mw =
    molecule.mol_weight != null ? `${molecule.mol_weight.toFixed(2)}` : "";
  const meta = [molecule.formula, mw && `${mw} g/mol`].filter(Boolean).join(" · ");
  const pct =
    similarityScore != null
      ? `${Math.round(similarityScore * 100)}%`
      : null;
  return (
    <li
      onContextMenu={onContextMenu}
      className={`flex items-center border-b border-border ${
        selected ? "bg-accent-soft" : ""
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggleCheck}
        // Stop the click from bubbling to the row <button> so ticking the
        // checkbox never also fires the molecule-open handler.
        onClick={(e) => e.stopPropagation()}
        aria-label={`Select ${molecule.name}`}
        className="ml-3 mr-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-border text-accent focus:ring-sky-400"
      />
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full items-center gap-2.5 px-2 py-2 text-left transition-colors ${
          selected ? "" : "hover:bg-surface-sunken"
        }`}
      >
        <span className="w-10 h-10 flex-shrink-0 bg-white rounded-md border border-border grid place-items-center overflow-hidden">
          <MoleculeThumbnail structure={molecule.smiles ?? ""} width={40} height={40} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium text-foreground">
            {molecule.name}
          </span>
          {meta ? (
            <span className="block truncate text-meta text-foreground-muted font-mono">
              {meta}
            </span>
          ) : null}
        </span>
        {pct != null ? (
          <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-sky-50 dark:bg-sky-500/15 text-sky-600 dark:text-sky-300">
            {pct}
          </span>
        ) : molecule.project_ids[0] ? (
          <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-50 dark:bg-purple-500/15 text-purple-600 dark:text-purple-300 max-w-[80px] truncate">
            {projectName.get(molecule.project_ids[0]) ?? "Project"}
          </span>
        ) : null}
      </button>
    </li>
  );
}

function Launcher({
  empty,
  onNewStructure,
  onSearchPubchem,
  onImportFile,
  onLiterature,
}: {
  empty: boolean;
  onNewStructure: () => void;
  onSearchPubchem: () => void;
  onImportFile: () => void;
  onLiterature: () => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto [overscroll-behavior:contain]">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="w-12 h-12 mb-3 rounded-xl bg-accent-soft text-brand-action grid place-items-center">
          <Icon name="vial" className="w-6 h-6" />
        </div>
        <h2 className="text-heading font-bold text-foreground mb-1">
          {empty ? "Your library is empty" : "Pick a molecule, or start one"}
        </h2>
        <p className="text-body text-foreground-muted max-w-prose mb-6">
          {empty
            ? "Draw a structure, pull one from PubChem, or import a file. It lands in your library with its formula and weight computed, all in your data folder."
            : "Select a molecule from the list to see its structure, identity, linked projects, and literature. Or start a new one below."}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ActionCard
            icon="pencil"
            tone="action"
            title="New structure"
            body="Open a blank canvas and draw a molecule."
            onClick={onNewStructure}
          />
          <ActionCard
            icon="search"
            tone="purple"
            title="Search PubChem"
            body="Pull any of 100M+ compounds with full metadata."
            onClick={onSearchPubchem}
          />
          <ActionCard
            icon="download"
            tone="green"
            title="Import file"
            body="Drop a .mol, .sdf, .smi, or .smiles file."
            onClick={onImportFile}
          />
          <ActionCard
            icon="book"
            tone="action"
            title="Find in literature"
            body="Papers and patents for a compound or fragment."
            onClick={onLiterature}
          />
        </div>
      </div>
    </div>
  );
}

function ActionCard({
  icon,
  tone,
  title,
  body,
  onClick,
}: {
  icon: "pencil" | "search" | "download" | "book";
  tone: "action" | "purple" | "green";
  title: string;
  body: string;
  onClick: () => void;
}) {
  const toneClass =
    tone === "action"
      ? "bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-300"
      : tone === "purple"
        ? "bg-purple-50 dark:bg-purple-500/15 text-purple-600 dark:text-purple-300"
        : "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-300";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex gap-3 items-start text-left bg-surface-raised border border-border rounded-xl p-4 shadow-sm transition-colors cursor-pointer hover:border-brand-action"
    >
      <span
        className={`w-9 h-9 flex-shrink-0 rounded-lg grid place-items-center ${toneClass}`}
      >
        <Icon name={icon} className="w-5 h-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-body font-bold text-foreground">{title}</span>
        <span className="block text-meta text-foreground-muted leading-snug mt-0.5">
          {body}
        </span>
      </span>
    </button>
  );
}
