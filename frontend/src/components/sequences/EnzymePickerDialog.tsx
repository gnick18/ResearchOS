"use client";

// sequence Phase 2d bot — the RESTRICTION-ENZYME picker (SnapGene's "Choose
// Enzymes" dialog, our calm house style). Lets the user pick which enzymes are
// active from the bundled SeqViz dataset, with filters (hide noncutters, cut
// count, recognition length, palindromic, overhang) plus a few BUILT-IN
// COMPUTED presets. The chosen set applies to the map LIVE. A small digest
// summary (cut sites + fragment sizes) sits alongside.
//
// SCOPE GUARD: nothing here is persisted to disk. The active selection lives in
// the editor's in-session state only; persistent user-named saved sets are a
// follow-up. All cut search reuses the vendored digest via enzyme-filters.ts;
// no enzyme data or recognition-site logic is reimplemented here. Inline SVG
// icons only (no emoji), <Tooltip> for icon-only buttons, no em-dashes.

import { useEffect, useMemo, useState } from "react";
import Tooltip from "@/components/Tooltip";
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
}: EnzymePickerProps) {
  const [filter, setFilter] = useState<EnzymeFilterState>(DEFAULT_FILTER_STATE);
  // Scope the digest to the current selection vs. the whole sequence.
  const [inSelection, setInSelection] = useState(false);
  // Working copy of the active set, applied live as it changes.
  const [selected, setSelected] = useState<Set<string>>(new Set(active));

  // Re-seed the working set whenever the dialog (re)opens.
  useEffect(() => {
    if (open) setSelected(new Set(active));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      data-testid="enzyme-picker-dialog"
      data-tour-popup-occluding="enzyme-picker"
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-[80vh] max-h-[640px] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-3.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-sky-50 text-sky-600">
            <IconScissors className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">Choose enzymes</h2>
            <p className="text-xs text-gray-500">
              Pick which restriction enzymes show on the map. Changes apply live.
            </p>
          </div>
          <Tooltip label="Close">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <IconClose className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>

        {/* Presets row */}
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-5 py-2.5">
          <span className="text-xs font-medium text-gray-500">Presets:</span>
          {ENZYME_PRESETS.map((p) => (
            <Tooltip key={p.id} label={p.description}>
              <button
                type="button"
                onClick={() => applyPreset(p.id)}
                className="rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700"
              >
                {p.label}
              </button>
            </Tooltip>
          ))}
          <button
            type="button"
            onClick={clearAll}
            className="ml-auto rounded-full px-2.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            Clear
          </button>
        </div>

        {/* Body: filters | list | summary */}
        <div className="flex min-h-0 flex-1">
          {/* Filters column */}
          <div className="w-52 shrink-0 space-y-3 overflow-y-auto border-r border-gray-100 px-4 py-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-500">Search</span>
              <input
                value={filter.search}
                onChange={(e) => patch({ search: e.target.value })}
                placeholder="Enzyme name"
                className="w-full rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-800 focus:border-sky-400 focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-500">Cut count</span>
              <select
                value={filter.cutCount}
                onChange={(e) => patch({ cutCount: e.target.value as CutCountFilter })}
                className="w-full rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-800 focus:border-sky-400 focus:outline-none"
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
                <span className="mb-1 block text-xs font-medium text-gray-500">Exactly N cuts</span>
                <input
                  type="number"
                  min={0}
                  value={filter.nCuts}
                  onChange={(e) => patch({ nCuts: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-full rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-800 focus:border-sky-400 focus:outline-none"
                />
              </label>
            )}

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-500">Min recognition length</span>
              <select
                value={filter.minRecognitionLength}
                onChange={(e) => patch({ minRecognitionLength: Number(e.target.value) })}
                className="w-full rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-800 focus:border-sky-400 focus:outline-none"
              >
                {[0, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "Any" : `${n}+ bp`}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-500">Overhang</span>
              <select
                value={filter.overhang}
                onChange={(e) => patch({ overhang: e.target.value as Overhang | "any" })}
                className="w-full rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-800 focus:border-sky-400 focus:outline-none"
              >
                {OVERHANG_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={filter.hideNoncutters}
                onChange={(e) => patch({ hideNoncutters: e.target.checked })}
                className="h-3.5 w-3.5 rounded border-gray-300 text-sky-600 focus:ring-sky-400"
              />
              Hide noncutters
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={filter.palindromicOnly}
                onChange={(e) => patch({ palindromicOnly: e.target.checked })}
                className="h-3.5 w-3.5 rounded border-gray-300 text-sky-600 focus:ring-sky-400"
              />
              Palindromic only
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={filter.nondegenerateOnly}
                onChange={(e) => patch({ nondegenerateOnly: e.target.checked })}
                className="h-3.5 w-3.5 rounded border-gray-300 text-sky-600 focus:ring-sky-400"
              />
              Nondegenerate only
            </label>

            <div className="my-1 h-px w-full bg-gray-100" />

            <Tooltip
              label={
                hasSelection
                  ? "Count cuts inside the current selection only"
                  : "Make a selection on the map to enable"
              }
            >
              <label
                className={`flex items-center gap-2 text-xs ${hasSelection ? "text-gray-700" : "text-gray-300"}`}
              >
                <input
                  type="checkbox"
                  checked={inSelection && hasSelection}
                  disabled={!hasSelection}
                  onChange={(e) => setInSelection(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-sky-600 focus:ring-sky-400 disabled:opacity-40"
                />
                Inside selection only
              </label>
            </Tooltip>
          </div>

          {/* Enzyme list */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2 text-xs text-gray-500">
              <span>
                {visible.length} enzyme{visible.length === 1 ? "" : "s"}
                {scope ? " (in selection)" : ""}
              </span>
              <button
                type="button"
                onClick={selectVisible}
                className="rounded px-2 py-0.5 font-medium text-sky-600 hover:bg-sky-50"
              >
                Select all shown
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5" data-testid="enzyme-list">
              {visible.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-gray-400">
                  No enzymes match these filters.
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {visible.map((d) => {
                    const checked = selected.has(d.info.key);
                    return (
                      <li key={d.info.key}>
                        <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm hover:bg-gray-50">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(d.info.key)}
                            className="h-3.5 w-3.5 rounded border-gray-300 text-sky-600 focus:ring-sky-400"
                          />
                          <span className="w-24 shrink-0 font-medium text-gray-800">{d.info.name}</span>
                          <span className="w-28 shrink-0 font-mono text-xs text-gray-400">{d.info.rseq}</span>
                          <span className="flex-1 text-right text-xs text-gray-500">
                            {d.cutCount === 0 ? (
                              <span className="text-gray-300">no cut</span>
                            ) : (
                              <span className={d.cutCount === 1 ? "text-emerald-600" : ""}>
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
          <div className="w-56 shrink-0 overflow-y-auto border-l border-gray-100 bg-gray-50 px-4 py-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Digest</h3>
            <p className="mt-1 text-xs text-gray-500">
              {summary.chosen.length} enzyme{summary.chosen.length === 1 ? "" : "s"} active,{" "}
              {summary.totalCuts} cut{summary.totalCuts === 1 ? "" : "s"}
            </p>

            {summary.chosen.length > 0 && (
              <>
                <h4 className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  Cut sites
                </h4>
                <ul className="mt-1 space-y-0.5 text-xs text-gray-600" data-testid="digest-cut-list">
                  {summary.chosen
                    .flatMap((d) => d.cuts.map((c) => ({ name: d.info.name, position: c.position })))
                    .sort((a, b) => a.position - b.position)
                    .map((c, i) => (
                      <li key={`${c.name}-${c.position}-${i}`} className="flex justify-between gap-2">
                        <span className="truncate">{c.name}</span>
                        <span className="shrink-0 font-mono text-gray-400">{c.position + 1}</span>
                      </li>
                    ))}
                </ul>

                <h4 className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  Fragments ({summary.sizes.length})
                </h4>
                <ul className="mt-1 flex flex-wrap gap-1 text-xs text-gray-600">
                  {summary.sizes.map((s, i) => (
                    <li key={i} className="rounded bg-white px-1.5 py-0.5 font-mono ring-1 ring-gray-200">
                      {s.toLocaleString()} bp
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-100 px-5 py-2.5 text-xs text-gray-400">
          <span>
            Active set is not saved to disk; it resets when you close the sequence.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
