"use client";

// seq nav bot — the PRIMERS tab panel. Primers persist as standard GenBank
// primer_bind features (see the editor's `primers` memo), so this panel derives
// its list directly from those features: name, binding position, strand, and the
// primer's own 5'->3' sequence (stored as a /note "primer <SEQ>" qualifier).
//
// It REUSES the existing primer biology (lib/sequences/primer.ts for GC/Tm) and
// the existing PrimerDialog for design (opened via onDesignPrimer); it adds no
// new persistence. Clicking a row selects/zooms the primer on the map; a per-row
// delete removes the primer_bind feature. Inline SVG only (no emoji); icon-only
// buttons are labelled; no em-dashes.

import { useMemo } from "react";
import Tooltip from "@/components/Tooltip";
import type { EditFeature } from "@/lib/sequences/edit-model";
import { gcContent, predictTm } from "@/lib/sequences/primer";

function IconPlus({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function IconTrash({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

/** Pull the primer's own 5'->3' sequence out of its /note "primer <SEQ>" flag. */
function primerSeqOf(f: EditFeature): string {
  const note = f.notes?.note;
  const text = Array.isArray(note) ? note.join(" ") : typeof note === "string" ? note : "";
  const m = text.match(/primer\s+([ACGTUacgtu]+)/);
  return m ? m[1].toUpperCase() : "";
}

export interface SequencePrimersPanelProps {
  features: EditFeature[];
  /** Click a primer row => select/zoom its binding site. Receives the doc index. */
  onSelectPrimer: (index: number) => void;
  selectedIndex: number | null;
  /** Open the existing PrimerDialog to design + add a primer. */
  onDesignPrimer: () => void;
  /** Delete the primer_bind feature at the given doc index. */
  onDeletePrimer: (index: number) => void;
  readOnly?: boolean;
}

export default function SequencePrimersPanel({
  features,
  onSelectPrimer,
  selectedIndex,
  onDesignPrimer,
  onDeletePrimer,
  readOnly = false,
}: SequencePrimersPanelProps) {
  // Derive the primer rows, carrying the ORIGINAL doc index for callbacks.
  const primers = useMemo(
    () =>
      features
        .map((f, index) => ({ f, index }))
        .filter(({ f }) => (f.type || "").toLowerCase() === "primer_bind"),
    [features],
  );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Primers
        </span>
        {!readOnly ? (
          <Tooltip label="Design a primer (Tm, GC, binding site, alignment)">
            <button
              type="button"
              onClick={onDesignPrimer}
              className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-sky-700"
            >
              <IconPlus className="h-3.5 w-3.5" />
              Design primer
            </button>
          </Tooltip>
        ) : null}
      </div>

      {primers.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <p className="text-sm text-gray-500">No primers yet.</p>
          <p className="mt-1 text-xs text-gray-400">
            {readOnly
              ? "Primers added to this sequence will appear here."
              : "Design a primer to add it to the map and this list."}
          </p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto py-1">
          {primers.map(({ f, index }) => {
            const seq = primerSeqOf(f);
            const len = seq.length || f.end - f.start;
            const gc = seq ? Math.round(gcContent(seq)) : null;
            const tm = seq ? Math.round(predictTm(seq)) : null;
            const selected = selectedIndex === index;
            return (
              <li key={`${f.name}-${f.start}-${index}`}>
                <div
                  className={`group flex items-center gap-2 px-3 py-1.5 ${
                    selected ? "bg-sky-50" : "hover:bg-gray-50"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectPrimer(index)}
                    className="flex min-w-0 flex-1 flex-col items-start text-left"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-gray-800">
                        {f.name || "primer"}
                      </span>
                      <span className="rounded bg-gray-100 px-1 text-[10px] font-medium text-gray-500">
                        {f.strand === -1 ? "reverse" : "forward"}
                      </span>
                    </span>
                    <span className="font-mono text-[11px] text-gray-400">
                      {(f.start + 1).toLocaleString()} .. {f.end.toLocaleString()} · {len} nt
                      {gc !== null ? ` · ${gc}% GC` : ""}
                      {tm !== null ? ` · Tm ${tm} C` : ""}
                    </span>
                    {seq ? (
                      <span className="truncate font-mono text-[11px] text-gray-500">
                        {`5'-${seq}-3'`}
                      </span>
                    ) : null}
                  </button>
                  {!readOnly ? (
                    <Tooltip label="Delete primer">
                      <button
                        type="button"
                        onClick={() => onDeletePrimer(index)}
                        aria-label={`Delete primer ${f.name}`}
                        className="rounded p-1 text-gray-300 opacity-0 transition-opacity hover:bg-gray-100 hover:text-red-500 group-hover:opacity-100"
                      >
                        <IconTrash className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
