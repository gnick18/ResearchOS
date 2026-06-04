"use client";

// enhanced find bot — the inline Find box for the sequence editor, upgraded into
// the SnapGene-style search family. Anchored top-right of the viewer.
//
// Three modes (priority order): FIND DNA (exact both-strand IUPAC substring,
// with an automatic CLOSEST-MATCH fallback via the alignment engine when there
// is no exact hit), FIND NAME (features / primers / restriction-enzyme sites by
// name), FIND PROTEIN (translate the forward + reverse frames, exact AA
// substring; protein close-match is deferred). The box owns the mode + query,
// runs the pure search functions in lib/sequences/find.ts, and reports the
// resulting match list upward; the parent keeps prev/next + highlighting.
//
// Calm by convention: inline SVG only (no emojis), no em-dashes, the Tooltip
// component for icon-only controls, semantic type tokens.

import { useEffect, useMemo, useRef, useState } from "react";
import Tooltip from "@/components/Tooltip";
import type { EditFeature } from "@/lib/sequences/edit-model";
import {
  findExactDna,
  findCloseDna,
  findByName,
  findProtein,
  isDnaQuery,
  isProteinQuery,
  type FindMode,
  type FindMatch,
  type CloseDnaMatch,
} from "@/lib/sequences/find";

function IconSearch({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
function IconClose({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
function IconUp({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}
function IconDown({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/** The three modes, in the order they appear in the segmented control. */
const MODES: { mode: FindMode; label: string; hint: string; placeholder: string }[] = [
  { mode: "dna", label: "DNA", hint: "Find bases on both strands (with closest-match fallback)", placeholder: "Find bases" },
  { mode: "name", label: "Name", hint: "Find a feature, primer, or enzyme by name", placeholder: "Find by name" },
  { mode: "protein", label: "Protein", hint: "Find an amino-acid sequence in any reading frame", placeholder: "Find protein (AA)" },
];

export interface FindResult {
  matches: FindMatch[];
  /** When the DNA exact search came up empty and we fell back to close-match. */
  isCloseMatch: boolean;
}

export function SequenceFindBox({
  seq,
  features,
  circular,
  matchCount,
  activeIndex,
  onResults,
  onPrev,
  onNext,
  onClose,
}: {
  /** The forward-strand sequence to search. */
  seq: string;
  /** Document features (for name search; primers included as primer_bind). */
  features: EditFeature[];
  /** Whether the molecule is circular (origin-wrapping search). */
  circular: boolean;
  /** Match count, fed back by the parent from the reported result list. */
  matchCount: number;
  /** 0-based active match index, or -1 when there is none. */
  activeIndex: number;
  /** Report the computed matches (+ whether they are close-matches) upward. */
  onResults: (result: FindResult) => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<FindMode>("dna");
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  // Run the search for the current mode + query. Pure + memoized: the box is the
  // single source of truth for the match list, reported up via onResults.
  const { matches, isCloseMatch, note, invalid } = useMemo(() => {
    const q = query.trim();
    if (q.length < 1) {
      return { matches: [] as FindMatch[], isCloseMatch: false, note: "", invalid: false };
    }
    if (mode === "name") {
      const m = findByName(q, seq, features, circular);
      return { matches: m as FindMatch[], isCloseMatch: false, note: "", invalid: false };
    }
    if (mode === "protein") {
      if (!isProteinQuery(q)) {
        return { matches: [] as FindMatch[], isCloseMatch: false, note: "Enter amino acids", invalid: true };
      }
      const m = findProtein(q, seq);
      return { matches: m, isCloseMatch: false, note: "", invalid: false };
    }
    // mode === "dna"
    if (!isDnaQuery(q)) {
      return { matches: [] as FindMatch[], isCloseMatch: false, note: "Enter DNA bases", invalid: true };
    }
    const exact = findExactDna(q, seq, circular);
    if (exact.length > 0) {
      return { matches: exact, isCloseMatch: false, note: "", invalid: false };
    }
    // No exact hit — automatically surface the closest approximate site(s),
    // clearly labeled, rather than reporting a bare "0 / 0".
    const close = findCloseDna(q, seq, { circular });
    if (close.length > 0) {
      const best = close[0] as CloseDnaMatch;
      return {
        matches: close,
        isCloseMatch: true,
        note: best.label ?? "closest match",
        invalid: false,
      };
    }
    return { matches: [] as FindMatch[], isCloseMatch: false, note: "", invalid: false };
  }, [mode, query, seq, features, circular]);

  // Report results upward whenever they change. Effect (not render) so the
  // parent's state update never runs during this component's render.
  const reportRef = useRef(onResults);
  reportRef.current = onResults;
  useEffect(() => {
    reportRef.current({ matches, isCloseMatch });
  }, [matches, isCloseMatch]);

  const activeMode = MODES.find((m) => m.mode === mode) ?? MODES[0];
  const showCount = query.trim().length >= 1 && !invalid;

  return (
    <div
      data-testid="sequence-find-box"
      className="absolute right-3 top-3 z-40 flex flex-col gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 shadow-lg"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1">
        {/* Mode segmented control. */}
        <div
          role="radiogroup"
          aria-label="Find mode"
          className="mr-1 flex items-center rounded-md bg-gray-100 p-0.5"
        >
          {MODES.map((m) => (
            <Tooltip key={m.mode} label={m.hint} placement="bottom">
              <button
                type="button"
                role="radio"
                aria-checked={mode === m.mode}
                onClick={() => setMode(m.mode)}
                className={`rounded px-2 py-0.5 text-meta font-medium transition-colors ${
                  mode === m.mode
                    ? "bg-white text-gray-800 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {m.label}
              </button>
            </Tooltip>
          ))}
        </div>

        <IconSearch className="h-4 w-4 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder={activeMode.placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (e.shiftKey) onPrev();
              else onNext();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          className="w-40 bg-transparent text-body outline-none placeholder:text-gray-400"
        />
        <span className="min-w-[3.5rem] text-right text-meta tabular-nums text-gray-400">
          {!showCount ? "" : matchCount === 0 ? "0 / 0" : `${activeIndex + 1} / ${matchCount}`}
        </span>
        <Tooltip label="Previous match (Shift+Enter)" placement="bottom">
          <button
            type="button"
            onClick={onPrev}
            disabled={matchCount === 0}
            aria-label="Previous match"
            className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-100 disabled:opacity-30"
          >
            <IconUp className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Tooltip label="Next match (Enter)" placement="bottom">
          <button
            type="button"
            onClick={onNext}
            disabled={matchCount === 0}
            aria-label="Next match"
            className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-100 disabled:opacity-30"
          >
            <IconDown className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Tooltip label="Close (Esc)" placement="bottom">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close find"
            className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-100"
          >
            <IconClose className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>

      {/* Status line: the closest-match readout (DNA fallback), a "no match"
          hint, or the protein close-match deferral note. Only shows when there
          is something to say, so the box stays calm when results are exact. */}
      {note ? (
        <div
          data-testid="sequence-find-note"
          className={`px-1 text-meta ${
            isCloseMatch ? "text-amber-600" : invalid ? "text-gray-400" : "text-gray-500"
          }`}
        >
          {note}
        </div>
      ) : null}

      {/* When DNA has no exact hit AND no close match either, say so plainly. */}
      {mode === "dna" && !invalid && query.trim().length >= 2 && matchCount === 0 && !note ? (
        <div className="px-1 text-meta text-gray-400">No match (exact or close)</div>
      ) : null}

      {/* Protein close-match is deferred — be honest about it on a zero-hit AA
          search rather than silently finding nothing. */}
      {mode === "protein" && !invalid && query.trim().length >= 1 && matchCount === 0 ? (
        <div className="px-1 text-meta text-gray-400">
          No exact frame match (protein close-match not available yet)
        </div>
      ) : null}
    </div>
  );
}

export default SequenceFindBox;
