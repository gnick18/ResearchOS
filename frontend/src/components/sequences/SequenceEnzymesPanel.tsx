"use client";

// seq nav bot — the ENZYMES tab panel. An in-panel digest surface (not a modal):
// the currently-active restriction enzymes, each with its cut count + cut
// positions, plus the fragment-size summary for the whole digest. A "Choose
// enzymes" button opens the existing EnzymePickerDialog to change the active set.
//
// REUSE: all cut search + fragment math comes from lib/sequences/enzyme-filters
// (digestEnzymes / fragmentSizes), the same logic the picker uses. This panel
// reimplements no enzyme biology. Inline SVG only (no emoji); icon-only controls
// are labelled; no em-dashes.

import { useMemo } from "react";
import Tooltip from "@/components/Tooltip";
import type { SeqType } from "@/vendor/seqviz/elements";
import { digestEnzymes, fragmentSizes } from "@/lib/sequences/enzyme-filters";

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

export interface SequenceEnzymesPanelProps {
  seq: string;
  seqType: SeqType;
  circular: boolean;
  /** the currently-active enzyme keys (lowercase). */
  active: string[];
  /** open the EnzymePickerDialog to choose the active set. */
  onChooseEnzymes: () => void;
  /** click a cut site => select/zoom that position on the map. */
  onGoToPosition: (bp: number) => void;
}

export default function SequenceEnzymesPanel({
  seq,
  seqType,
  circular,
  active,
  onChooseEnzymes,
  onGoToPosition,
}: SequenceEnzymesPanelProps) {
  const digests = useMemo(
    () => digestEnzymes(seq, seqType, active).sort((a, b) => a.info.name.localeCompare(b.info.name)),
    [seq, seqType, active],
  );

  const allCutPositions = useMemo(() => {
    const out: number[] = [];
    for (const d of digests) for (const c of d.cuts) out.push(c.position);
    return out;
  }, [digests]);

  const fragments = useMemo(
    () => fragmentSizes(allCutPositions, seq.length, circular),
    [allCutPositions, seq.length, circular],
  );

  const totalCuts = allCutPositions.length;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Restriction enzymes
        </span>
        <Tooltip label="Choose which enzymes are active">
          <button
            type="button"
            onClick={onChooseEnzymes}
            className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-sky-700"
          >
            <IconScissors className="h-3.5 w-3.5" />
            Choose enzymes
          </button>
        </Tooltip>
      </div>

      {/* digest summary line */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-gray-100 bg-gray-50 px-4 py-1.5 text-[11px] text-gray-500">
        <span>{active.length} enzymes active</span>
        <span>{totalCuts.toLocaleString()} cut sites</span>
        <span>{fragments.length.toLocaleString()} fragments</span>
        {fragments.length > 0 ? (
          <span className="font-mono">
            sizes: {fragments.slice(0, 8).map((s) => s.toLocaleString()).join(", ")}
            {fragments.length > 8 ? " …" : ""} bp
          </span>
        ) : null}
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {digests.map((d) => (
          <li key={d.info.key} className="px-4 py-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-gray-800">{d.info.name}</span>
              <span className="text-[11px] text-gray-400">
                {d.cutCount === 0
                  ? "no cuts"
                  : `${d.cutCount} cut${d.cutCount === 1 ? "" : "s"}`}
              </span>
            </div>
            {d.cuts.length > 0 ? (
              <div className="mt-0.5 flex flex-wrap gap-1">
                {d.cuts.map((c, i) => (
                  <button
                    key={`${c.position}-${i}`}
                    type="button"
                    onClick={() => onGoToPosition(c.position)}
                    className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-600 transition-colors hover:bg-sky-100 hover:text-sky-700"
                  >
                    {(c.position + 1).toLocaleString()}
                  </button>
                ))}
              </div>
            ) : null}
          </li>
        ))}
        {digests.length === 0 ? (
          <li className="px-4 py-6 text-center text-xs text-gray-400">
            No enzymes selected. Choose enzymes to see cut sites.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
