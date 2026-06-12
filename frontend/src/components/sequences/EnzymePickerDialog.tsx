"use client";

// sequence Phase 2d bot — the RESTRICTION-ENZYME picker (SnapGene's "Choose
// Enzymes" dialog, our calm house style). Lets the user pick which enzymes are
// active from the bundled SeqViz dataset, with filters (hide noncutters, cut
// count, recognition length, palindromic, overhang) plus a few BUILT-IN
// COMPUTED presets. The chosen set applies to the map LIVE. A small digest
// summary (cut sites + fragment sizes) sits alongside.
//
// enzyme sets bot — PERSISTENT user-named "Saved sets" (SnapGene's "Save…" /
// named "Chosen Enzymes" sets). The "Saved sets" control near the chosen-set
// area loads / saves / renames / deletes USER-level sets that persist across
// sequences via `lib/sequences/enzyme-sets.ts`. The BUILT-IN computed presets
// (above) stay separate from these user-saved sets. Loading a set then editing
// the selection leaves it as an "unsaved" modification until re-saved.
//
// SCOPE GUARD: the only persistence here is the saved-sets sidecar (its own
// user-level JSON). The active selection still lives in the editor's in-session
// state. All cut search reuses the vendored digest via enzyme-filters.ts; no
// enzyme data or recognition-site logic is reimplemented here. Inline SVG icons
// only (no emoji), <Tooltip> for icon-only buttons, no em-dashes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Tooltip from "@/components/Tooltip";
import LivingPopup from "@/components/ui/LivingPopup";
import type { SeqType } from "@/vendor/seqviz/elements";
import {
  allEnzymeInfos,
  digestEnzymes,
  filterDigests,
  fragmentSizes,
  ENZYME_PRESETS,
  DEFAULT_FILTER_STATE,
  type EnzymeDigest,
  type EnzymeFilterState,
  type CutCountFilter,
  type Overhang,
} from "@/lib/sequences/enzyme-filters";
import {
  listEnzymeSets,
  saveEnzymeSet,
  renameEnzymeSet,
  deleteEnzymeSet,
  type EnzymeSet,
} from "@/lib/sequences/enzyme-sets";

// ── icons (inline SVG only) ───────────────────────────────────────────────────
function IconClose({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
function IconScissors({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4L8.12 15.88" />
      <path d="M14.47 14.48L20 20" />
      <path d="M8.12 8.12L12 12" />
    </svg>
  );
}
function IconBookmark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function IconPencil({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" />
    </svg>
  );
}
function IconTrash({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
function IconCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

const CUT_COUNT_OPTIONS: { value: CutCountFilter; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "unique", label: "Unique (1)" },
  { value: "n-cutters", label: "N cutters" },
  { value: "noncutters", label: "Noncutters (0)" },
];

const OVERHANG_OPTIONS: { value: Overhang | "any"; label: string }[] = [
  { value: "any", label: "Any overhang" },
  { value: "blunt", label: "Blunt" },
  { value: "5'", label: "5' overhang" },
  { value: "3'", label: "3' overhang" },
];

export interface EnzymePickerProps {
  open: boolean;
  seq: string;
  seqType: SeqType;
  circular: boolean;
  /** the currently-active enzyme keys (lowercase). */
  active: string[];
  /** the current selection range, if any, for the in-selection scope option. */
  selection: { start: number; end: number } | null;
  /** live-apply the chosen enzyme keys to the map. */
  onApply: (keys: string[]) => void;
  onClose: () => void;
  /** the current user's folder name — the owner of the saved-sets sidecar.
   *  Saved sets are USER-level and reusable across every sequence. When blank
   *  (no connected user) the Saved-sets control is hidden. */
  username?: string;
}

/** Order-independent equality of two enzyme-key collections. */
function sameKeys(a: Iterable<string>, b: Iterable<string>): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const k of sa) if (!sb.has(k)) return false;
  return true;
}

export default function EnzymePickerDialog({
  open,
  seq,
  seqType,
  circular,
  active,
  selection,
  onApply,
  onClose,
  username,
}: EnzymePickerProps) {
  const [filter, setFilter] = useState<EnzymeFilterState>(DEFAULT_FILTER_STATE);
  // Scope the digest to the current selection vs. the whole sequence.
  const [inSelection, setInSelection] = useState(false);
  // Working copy of the active set, applied live as it changes.
  const [selected, setSelected] = useState<Set<string>>(new Set(active));

  // ── Saved sets (user-level, persistent) ──────────────────────────────────
  const canSaveSets = !!username && username.trim().length > 0;
  const [savedSets, setSavedSets] = useState<EnzymeSet[]>([]);
  // The id of the saved set currently LOADED (so we can show its name +
  // detect unsaved edits). null = the active set is not tied to a saved set.
  const [loadedSetId, setLoadedSetId] = useState<string | null>(null);
  // The key-list snapshot of the loaded set, to detect "unsaved modifications".
  const loadedKeysRef = useRef<string[] | null>(null);
  // Inline "Save as…" / rename editor state.
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [setsBusy, setSetsBusy] = useState(false);

  const refreshSets = useCallback(async () => {
    if (!canSaveSets || !username) return;
    try {
      const list = await listEnzymeSets(username);
      setSavedSets(list);
    } catch (err) {
      console.warn("[enzyme-sets] failed to list sets", err);
    }
  }, [canSaveSets, username]);

  // Re-seed the working set whenever the dialog (re)opens, and (re)load the
  // saved-set library. Opening does NOT auto-bind to any saved set.
  useEffect(() => {
    if (open) {
      setSelected(new Set(active));
      setLoadedSetId(null);
      loadedKeysRef.current = null;
      setSavePromptOpen(false);
      setRenamingId(null);
      void refreshSets();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The loaded set has unsaved edits when the live selection diverges from the
  // snapshot we loaded. Pure derived value (no extra state to drift).
  const loadedSet = savedSets.find((s) => s.id === loadedSetId) ?? null;
  const hasUnsavedChanges =
    loadedSet != null &&
    loadedKeysRef.current != null &&
    !sameKeys(selected, loadedKeysRef.current);

  const hasSelection = !!selection && selection.end > selection.start;
  const scope = inSelection && hasSelection ? selection : null;

  // FULL per-enzyme digest of the current sequence (scoped). This is the single
  // source the list, the filters, the presets and the summary all read from.
  // Reuses the vendored digest via enzyme-filters.digestEnzymes.
  const allDigests: EnzymeDigest[] = useMemo(() => {
    const keys = allEnzymeInfos().map((i) => i.key);
    return digestEnzymes(seq, seqType, keys, scope);
  }, [seq, seqType, scope]);

  const visible = useMemo(() => filterDigests(allDigests, filter), [allDigests, filter]);

  // The digest summary for the currently-SELECTED enzymes (what the map shows).
  const summary = useMemo(() => {
    const chosen = allDigests.filter((d) => selected.has(d.info.key) && d.cutCount > 0);
    const allCuts = chosen.flatMap((d) => d.cuts.map((c) => c.position));
    const sizes = fragmentSizes(allCuts, seq.length, circular);
    return { chosen, totalCuts: allCuts.length, sizes };
  }, [allDigests, selected, seq.length, circular]);

  // Apply live on every selection change.
  const apply = (next: Set<string>) => {
    setSelected(next);
    onApply(Array.from(next));
  };

  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    apply(next);
  };

  const applyPreset = (presetId: string) => {
    const preset = ENZYME_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    apply(new Set(preset.select(allDigests)));
  };

  const clearAll = () => apply(new Set());
  // "Select all visible" adds every currently-filtered enzyme to the set.
  const selectVisible = () => {
    const next = new Set(selected);
    for (const d of visible) next.add(d.info.key);
    apply(next);
  };

  const patch = (p: Partial<EnzymeFilterState>) => setFilter((f) => ({ ...f, ...p }));

  // ── Saved-set actions ─────────────────────────────────────────────────────
  // Loading a set applies its enzymes live, binds the loaded id, and snapshots
  // its keys so later edits register as "unsaved".
  const loadSet = (set: EnzymeSet) => {
    apply(new Set(set.enzymeKeys));
    setLoadedSetId(set.id);
    loadedKeysRef.current = [...set.enzymeKeys];
    setSavePromptOpen(false);
    setRenamingId(null);
  };

  const beginSaveAs = () => {
    setSaveName(loadedSet ? loadedSet.name : "");
    setSavePromptOpen(true);
    setRenamingId(null);
  };

  const commitSaveAs = async () => {
    const name = saveName.trim();
    if (!name || !username) return;
    setSetsBusy(true);
    try {
      const saved = await saveEnzymeSet(username, {
        name,
        enzymeKeys: Array.from(selected),
      });
      await refreshSets();
      setLoadedSetId(saved.id);
      loadedKeysRef.current = [...saved.enzymeKeys];
      setSavePromptOpen(false);
      setSaveName("");
    } catch (err) {
      console.warn("[enzyme-sets] save failed", err);
    } finally {
      setSetsBusy(false);
    }
  };

  // "Update" overwrites the currently-loaded set with the live selection.
  const updateLoadedSet = async () => {
    if (!username || !loadedSet) return;
    setSetsBusy(true);
    try {
      const saved = await saveEnzymeSet(username, {
        id: loadedSet.id,
        name: loadedSet.name,
        enzymeKeys: Array.from(selected),
      });
      await refreshSets();
      loadedKeysRef.current = [...saved.enzymeKeys];
    } catch (err) {
      console.warn("[enzyme-sets] update failed", err);
    } finally {
      setSetsBusy(false);
    }
  };

  const beginRename = (set: EnzymeSet) => {
    setRenamingId(set.id);
    setRenameValue(set.name);
    setSavePromptOpen(false);
  };

  const commitRename = async () => {
    const name = renameValue.trim();
    if (!name || !username || !renamingId) {
      setRenamingId(null);
      return;
    }
    setSetsBusy(true);
    try {
      await renameEnzymeSet(username, renamingId, name);
      await refreshSets();
    } catch (err) {
      console.warn("[enzyme-sets] rename failed", err);
    } finally {
      setRenamingId(null);
      setSetsBusy(false);
    }
  };

  const removeSet = async (set: EnzymeSet) => {
    if (!username) return;
    setSetsBusy(true);
    try {
      await deleteEnzymeSet(username, set.id);
      await refreshSets();
      if (loadedSetId === set.id) {
        setLoadedSetId(null);
        loadedKeysRef.current = null;
      }
    } catch (err) {
      console.warn("[enzyme-sets] delete failed", err);
    } finally {
      setSetsBusy(false);
    }
  };

  if (!open) return null;

  return (
    <LivingPopup open onClose={onClose} label="Choose enzymes" selfSize showClose={false}>
      <div
        className="pointer-events-auto relative flex h-[80vh] max-h-[640px] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-surface-raised shadow-2xl"
        data-testid="enzyme-picker-dialog"
        data-tour-popup-occluding="enzyme-picker"
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-sky-50 dark:bg-sky-500/15 text-sky-600 dark:text-sky-300">
            <IconScissors className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-title font-semibold text-foreground">Choose enzymes</h2>
            <p className="text-meta text-foreground-muted">
              Pick which restriction enzymes show on the map. Changes apply live.
            </p>
          </div>
          <Tooltip label="Close">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-sunken hover:text-foreground-muted"
            >
              <IconClose className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>

        {/* Presets row */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-2.5">
          <span className="text-meta font-medium text-foreground-muted">Presets:</span>
          {ENZYME_PRESETS.map((p) => (
            <Tooltip key={p.id} label={p.description}>
              <button
                type="button"
                onClick={() => applyPreset(p.id)}
                className="rounded-full border border-border px-2.5 py-1 text-meta font-medium text-foreground-muted transition-colors hover:border-sky-200 hover:bg-sky-50 dark:hover:bg-sky-500/20 hover:text-sky-700"
              >
                {p.label}
              </button>
            </Tooltip>
          ))}
          <button
            type="button"
            onClick={clearAll}
            className="ml-auto rounded-full px-2.5 py-1 text-meta font-medium text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
          >
            Clear
          </button>
        </div>

        {/* Saved sets row (enzyme sets bot) — USER-level, persistent, reusable
            across every sequence. Distinct from the computed presets above. */}
        {canSaveSets && (
          <div
            className="flex flex-wrap items-center gap-2 border-b border-border bg-sky-50/40 dark:bg-sky-500/15 px-5 py-2.5"
            data-testid="enzyme-saved-sets"
          >
            <span className="flex items-center gap-1.5 text-meta font-medium text-foreground-muted">
              <IconBookmark className="h-3.5 w-3.5 text-sky-500" />
              Saved sets:
            </span>

            {savedSets.length === 0 && !savePromptOpen && (
              <span className="text-meta text-foreground-muted">
                None yet. Save the current selection as a reusable set.
              </span>
            )}

            {/* The saved-set chips: click to load. Rename / delete inline. */}
            {savedSets.map((set) => {
              const isLoaded = set.id === loadedSetId;
              if (renamingId === set.id) {
                return (
                  <span
                    key={set.id}
                    className="flex items-center gap-1 rounded-full border border-sky-300 dark:border-sky-500/30 bg-surface-raised px-1.5 py-0.5"
                  >
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void commitRename();
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      className="w-28 rounded px-1 py-0.5 text-meta text-foreground focus:outline-none"
                      aria-label="New set name"
                    />
                    <Tooltip label="Save name">
                      <button
                        type="button"
                        onClick={() => void commitRename()}
                        disabled={setsBusy || !renameValue.trim()}
                        className="flex h-5 w-5 items-center justify-center rounded text-emerald-600 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/20 disabled:opacity-40"
                        aria-label="Save name"
                      >
                        <IconCheck className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                  </span>
                );
              }
              return (
                <span
                  key={set.id}
                  className={`group flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-meta transition-colors ${
                    isLoaded
                      ? "border-sky-300 dark:border-sky-500/30 bg-sky-100 dark:bg-sky-500/15 text-sky-800 dark:text-sky-300"
                      : "border-border bg-surface-raised text-foreground-muted hover:border-sky-200 hover:bg-sky-50 dark:hover:bg-sky-500/20 hover:text-sky-700"
                  }`}
                  data-testid="enzyme-saved-set-chip"
                >
                  <Tooltip
                    label={`Load "${set.name}" (${set.enzymeKeys.length} enzyme${set.enzymeKeys.length === 1 ? "" : "s"})`}
                  >
                    <button
                      type="button"
                      onClick={() => loadSet(set)}
                      className="max-w-[10rem] truncate font-medium"
                    >
                      {set.name}
                      {isLoaded && hasUnsavedChanges ? (
                        <span className="ml-1 text-meta font-normal text-sky-500">
                          (edited)
                        </span>
                      ) : null}
                    </button>
                  </Tooltip>
                  <Tooltip label="Rename set">
                    <button
                      type="button"
                      onClick={() => beginRename(set)}
                      className="flex h-5 w-5 items-center justify-center rounded text-foreground-muted hover:bg-surface-raised hover:text-foreground-muted"
                      aria-label={`Rename ${set.name}`}
                    >
                      <IconPencil className="h-3 w-3" />
                    </button>
                  </Tooltip>
                  <Tooltip label="Delete set">
                    <button
                      type="button"
                      onClick={() => void removeSet(set)}
                      disabled={setsBusy}
                      className="flex h-5 w-5 items-center justify-center rounded text-foreground-muted hover:bg-surface-raised hover:text-rose-600 disabled:opacity-40"
                      aria-label={`Delete ${set.name}`}
                    >
                      <IconTrash className="h-3 w-3" />
                    </button>
                  </Tooltip>
                </span>
              );
            })}

            {/* Update-loaded shortcut, shown only when the loaded set has edits. */}
            {loadedSet && hasUnsavedChanges && (
              <Tooltip label={`Overwrite "${loadedSet.name}" with the current selection`}>
                <button
                  type="button"
                  onClick={() => void updateLoadedSet()}
                  disabled={setsBusy}
                  className="rounded-full border border-sky-300 dark:border-sky-500/30 bg-surface-raised px-2.5 py-1 text-meta font-medium text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-500/20 disabled:opacity-40"
                >
                  Update
                </button>
              </Tooltip>
            )}

            {/* Save as… inline name prompt, or the button that opens it. */}
            {savePromptOpen ? (
              <span className="ml-auto flex items-center gap-1 rounded-full border border-sky-300 dark:border-sky-500/30 bg-surface-raised px-1.5 py-0.5">
                <input
                  autoFocus
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitSaveAs();
                    if (e.key === "Escape") setSavePromptOpen(false);
                  }}
                  placeholder="Name this set"
                  className="w-36 rounded px-1.5 py-0.5 text-meta text-foreground focus:outline-none"
                  aria-label="Name this enzyme set"
                />
                <Tooltip label="Save set">
                  <button
                    type="button"
                    onClick={() => void commitSaveAs()}
                    disabled={setsBusy || !saveName.trim()}
                    className="flex h-5 w-5 items-center justify-center rounded text-emerald-600 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/20 disabled:opacity-40"
                    aria-label="Save set"
                  >
                    <IconCheck className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
                <Tooltip label="Cancel">
                  <button
                    type="button"
                    onClick={() => setSavePromptOpen(false)}
                    className="flex h-5 w-5 items-center justify-center rounded text-foreground-muted hover:bg-surface-sunken hover:text-foreground-muted"
                    aria-label="Cancel"
                  >
                    <IconClose className="h-3 w-3" />
                  </button>
                </Tooltip>
              </span>
            ) : (
              <Tooltip label="Save the current selection as a reusable named set">
                <button
                  type="button"
                  onClick={beginSaveAs}
                  disabled={selected.size === 0}
                  className="ml-auto flex items-center gap-1 rounded-full border border-border bg-surface-raised px-2.5 py-1 text-meta font-medium text-foreground-muted transition-colors hover:border-sky-200 hover:bg-sky-50 dark:hover:bg-sky-500/20 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-40"
                  data-testid="enzyme-save-set-button"
                >
                  <IconBookmark className="h-3.5 w-3.5" />
                  Save…
                </button>
              </Tooltip>
            )}
          </div>
        )}

        {/* Body: filters | list | summary */}
        <div className="flex min-h-0 flex-1">
          {/* Filters column */}
          <div className="w-52 shrink-0 space-y-3 overflow-y-auto border-r border-border px-4 py-3">
            <label className="block">
              <span className="mb-1 block text-meta font-medium text-foreground-muted">Search</span>
              <input
                value={filter.search}
                onChange={(e) => patch({ search: e.target.value })}
                placeholder="Enzyme name"
                className="w-full rounded-md border border-border px-2 py-1 text-body text-foreground focus:border-sky-400 focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-meta font-medium text-foreground-muted">Cut count</span>
              <select
                value={filter.cutCount}
                onChange={(e) => patch({ cutCount: e.target.value as CutCountFilter })}
                className="w-full rounded-md border border-border px-2 py-1 text-body text-foreground focus:border-sky-400 focus:outline-none"
              >
                {CUT_COUNT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            {filter.cutCount === "n-cutters" && (
              <label className="block">
                <span className="mb-1 block text-meta font-medium text-foreground-muted">Exactly N cuts</span>
                <input
                  type="number"
                  min={0}
                  value={filter.nCuts}
                  onChange={(e) => patch({ nCuts: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-full rounded-md border border-border px-2 py-1 text-body text-foreground focus:border-sky-400 focus:outline-none"
                />
              </label>
            )}

            <label className="block">
              <span className="mb-1 block text-meta font-medium text-foreground-muted">Min recognition length</span>
              <select
                value={filter.minRecognitionLength}
                onChange={(e) => patch({ minRecognitionLength: Number(e.target.value) })}
                className="w-full rounded-md border border-border px-2 py-1 text-body text-foreground focus:border-sky-400 focus:outline-none"
              >
                {[0, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "Any" : `${n}+ bp`}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-meta font-medium text-foreground-muted">Overhang</span>
              <select
                value={filter.overhang}
                onChange={(e) => patch({ overhang: e.target.value as Overhang | "any" })}
                className="w-full rounded-md border border-border px-2 py-1 text-body text-foreground focus:border-sky-400 focus:outline-none"
              >
                {OVERHANG_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 text-meta text-foreground">
              <input
                type="checkbox"
                checked={filter.hideNoncutters}
                onChange={(e) => patch({ hideNoncutters: e.target.checked })}
                className="h-3.5 w-3.5 rounded border-border text-sky-600 dark:text-sky-300 focus:ring-sky-400"
              />
              Hide noncutters
            </label>
            <label className="flex items-center gap-2 text-meta text-foreground">
              <input
                type="checkbox"
                checked={filter.palindromicOnly}
                onChange={(e) => patch({ palindromicOnly: e.target.checked })}
                className="h-3.5 w-3.5 rounded border-border text-sky-600 dark:text-sky-300 focus:ring-sky-400"
              />
              Palindromic only
            </label>
            <label className="flex items-center gap-2 text-meta text-foreground">
              <input
                type="checkbox"
                checked={filter.nondegenerateOnly}
                onChange={(e) => patch({ nondegenerateOnly: e.target.checked })}
                className="h-3.5 w-3.5 rounded border-border text-sky-600 dark:text-sky-300 focus:ring-sky-400"
              />
              Nondegenerate only
            </label>

            <div className="my-1 h-px w-full bg-surface-sunken" />

            <Tooltip
              label={
                hasSelection
                  ? "Count cuts inside the current selection only"
                  : "Make a selection on the map to enable"
              }
            >
              <label
                className={`flex items-center gap-2 text-meta ${hasSelection ? "text-foreground" : "text-foreground-muted"}`}
              >
                <input
                  type="checkbox"
                  checked={inSelection && hasSelection}
                  disabled={!hasSelection}
                  onChange={(e) => setInSelection(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border text-sky-600 dark:text-sky-300 focus:ring-sky-400 disabled:opacity-40"
                />
                Inside selection only
              </label>
            </Tooltip>
          </div>

          {/* Enzyme list */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-border px-4 py-2 text-meta text-foreground-muted">
              <span>
                {visible.length} enzyme{visible.length === 1 ? "" : "s"}
                {scope ? " (in selection)" : ""}
              </span>
              <button
                type="button"
                onClick={selectVisible}
                className="rounded px-2 py-0.5 font-medium text-sky-600 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-500/20"
              >
                Select all shown
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5" data-testid="enzyme-list">
              {visible.length === 0 ? (
                <p className="px-3 py-6 text-center text-body text-foreground-muted">
                  No enzymes match these filters.
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {visible.map((d) => {
                    const checked = selected.has(d.info.key);
                    return (
                      <li key={d.info.key}>
                        <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-body hover:bg-surface-sunken">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(d.info.key)}
                            className="h-3.5 w-3.5 rounded border-border text-sky-600 dark:text-sky-300 focus:ring-sky-400"
                          />
                          <span className="w-24 shrink-0 font-medium text-foreground">{d.info.name}</span>
                          <span className="min-w-0 flex-1 break-all font-mono text-meta text-foreground-muted">{d.info.rseq}</span>
                          <span className="shrink-0 whitespace-nowrap text-right text-meta text-foreground-muted">
                            {d.cutCount === 0 ? (
                              <span className="text-foreground-muted">no cut</span>
                            ) : (
                              <span className={d.cutCount === 1 ? "text-emerald-600 dark:text-emerald-300" : ""}>
                                {d.cutCount} cut{d.cutCount === 1 ? "" : "s"}
                              </span>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* Digest summary */}
          <div className="w-56 shrink-0 overflow-y-auto border-l border-border bg-surface-sunken px-4 py-3">
            <h3 className="text-meta font-semibold uppercase tracking-wide text-foreground-muted">Digest</h3>
            <p className="mt-1 text-meta text-foreground-muted">
              {summary.chosen.length} enzyme{summary.chosen.length === 1 ? "" : "s"} active,{" "}
              {summary.totalCuts} cut{summary.totalCuts === 1 ? "" : "s"}
            </p>

            {summary.chosen.length > 0 && (
              <>
                <h4 className="mt-3 text-meta font-semibold uppercase tracking-wide text-foreground-muted">
                  Cut sites
                </h4>
                <ul className="mt-1 space-y-0.5 text-meta text-foreground-muted" data-testid="digest-cut-list">
                  {summary.chosen
                    .flatMap((d) => d.cuts.map((c) => ({ name: d.info.name, position: c.position })))
                    .sort((a, b) => a.position - b.position)
                    .map((c, i) => (
                      <li key={`${c.name}-${c.position}-${i}`} className="flex justify-between gap-2">
                        <span className="truncate">{c.name}</span>
                        <span className="shrink-0 font-mono text-foreground-muted">{c.position + 1}</span>
                      </li>
                    ))}
                </ul>

                <h4 className="mt-3 text-meta font-semibold uppercase tracking-wide text-foreground-muted">
                  Fragments ({summary.sizes.length})
                </h4>
                <ul className="mt-1 flex flex-wrap gap-1 text-meta text-foreground-muted">
                  {summary.sizes.map((s, i) => (
                    <li key={i} className="rounded bg-surface-raised px-1.5 py-0.5 font-mono ring-1 ring-border">
                      {s.toLocaleString()} bp
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-5 py-2.5 text-meta text-foreground-muted">
          <span>
            {canSaveSets
              ? loadedSet
                ? hasUnsavedChanges
                  ? `Editing "${loadedSet.name}" (unsaved changes). Use Save… to keep them.`
                  : `Loaded "${loadedSet.name}". The active set applies live to the map.`
                : "Save the active selection as a named set to reuse it across sequences."
              : "Active set is not saved to disk; it resets when you close the sequence."}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-brand-action px-3 py-1.5 text-body font-medium text-white hover:bg-brand-action/90"
          >
            Done
          </button>
        </div>
      </div>
    </LivingPopup>
  );
}
