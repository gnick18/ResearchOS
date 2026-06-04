"use client";

// compare align bot — the Compare / align-two-sequences dialog. Pick two
// sequences from the library, choose an alignment mode (global end-to-end vs
// local best-region) and DNA scoring (IUPAC-aware by default), then run the
// pure alignment engine (lib/align) and render the result: a stacked, wrapped
// monospace alignment with a match/mismatch midline + coordinate ticks, a
// header identity stat, and an optional k-mer dotplot. All alignment math lives
// in lib/align + lib/sequences/compare-format + compare-dotplot (pure, tested);
// this file is the presentational shell + the run wiring. Mirrors the calm
// modal shell of SequenceConfirmDialog. No emojis (inline SVG only), no em-dash.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { sequencesApi } from "@/lib/local-api";
import { alignGlobal, alignLocal, dnaScoring, proteinScoring } from "@/lib/align";
import type { AlignmentResult } from "@/lib/align";
import {
  buildCompareModel,
  formatSummaryLine,
  type CompareModel,
  type AlignmentSummary,
} from "@/lib/sequences/compare-format";
import { computeDotplot, dotplotWordSize } from "@/lib/sequences/compare-dotplot";
import type { SequenceRecord } from "@/lib/types";

// Above this many bases on EITHER side we refuse the full DP (O(m*n) memory and
// time would hang the tab). Plasmid-scale (a few tens of kb) is comfortable.
const MAX_ALIGN_BASES = 60_000;
// Cap the rendered alignment columns so a long full-genome-ish pair can still be
// summarized without painting hundreds of thousands of monospace cells.
const MAX_RENDER_COLUMNS = 6_000;
const ROW_WIDTH = 60;
// Rendered square size of the dotplot. Sized to read as a real plot in its own
// section under the alignment, not a cramped corner thumbnail. The grid sampled
// by computeDotplot is independent (DOTPLOT_GRID); the SVG scales it to fit.
const DOTPLOT_PX = 340;
const DOTPLOT_GRID = 160;

type AlignMode = "global" | "local";
// Which substitution scheme drives the alignment. "dna" is IUPAC-aware DNA
// (the default); "protein" uses the BLOSUM62 amino-acid matrix.
type ScoreScheme = "dna" | "protein";

// Letters that are valid DNA / IUPAC codes. A sequence made only of these reads
// as nucleotide; anything else (E, F, I, L, P, Q, etc.) means amino acids.
const DNA_LETTERS = /^[ACGTURYSWKMBDHVN]+$/i;

/**
 * Decide whether a pair of sequences looks like protein rather than DNA. A
 * sequence is "protein-ish" when, ignoring gaps and whitespace, it contains a
 * letter that is not a DNA / IUPAC code (E, F, I, L, P, Q, ...). Both sequences
 * are checked; either one looking like protein flips the auto-detection so a
 * protein-vs-DNA mismatch still scores on BLOSUM rather than silently using DNA.
 */
function looksLikeProtein(a: string, b: string): boolean {
  const clean = (s: string) => s.replace(/[\s-]/g, "");
  const ca = clean(a);
  const cb = clean(b);
  const isProtein = (s: string) => s.length > 0 && !DNA_LETTERS.test(s);
  return isProtein(ca) || isProtein(cb);
}

/**
 * Recompute the summary stats using TRUE residue identity (exact same letter)
 * instead of the engine's op-based matches. For BLOSUM62-scored protein
 * alignments the engine marks conservative substitutions (positive score) as
 * "match" ops, so its identity overstates real identity; comparing the aligned
 * characters directly gives the biology-standard percent identity. Mismatch and
 * gap counts come from the same column walk. Used only in protein mode; DNA mode
 * keeps the engine summary unchanged.
 */
function trueIdentitySummary(
  result: AlignmentResult,
  base: AlignmentSummary,
): AlignmentSummary {
  let matches = 0;
  let mismatches = 0;
  let gaps = 0;
  const { alignedA, alignedB } = result;
  for (let i = 0; i < alignedA.length; i++) {
    const ca = alignedA[i];
    const cb = alignedB[i];
    if (ca === "-" || cb === "-") gaps += 1;
    else if (ca.toUpperCase() === cb.toUpperCase()) matches += 1;
    else mismatches += 1;
  }
  const columns = alignedA.length;
  const identity = columns === 0 ? 0 : matches / columns;
  return {
    ...base,
    columns,
    matches,
    mismatches,
    gaps,
    identity,
    identityPct: Math.round(identity * 100),
  };
}

function CompareIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="4" y1="8" x2="20" y2="8" />
      <line x1="4" y1="16" x2="20" y2="16" />
      <line x1="9" y1="5" x2="9" y2="11" />
      <line x1="15" y1="13" x2="15" y2="19" />
    </svg>
  );
}
function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

/** A sequence picker: a labelled <select> over the library summaries. */
function SequencePicker({
  label,
  value,
  onChange,
  sequences,
}: {
  label: string;
  value: number | null;
  onChange: (id: number | null) => void;
  sequences: SequenceRecord[];
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-meta font-medium uppercase tracking-wide text-gray-400">
        {label}
      </span>
      <select
        value={value == null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-body text-gray-700 focus:border-sky-400 focus:outline-none"
      >
        <option value="">Select a sequence…</option>
        {sequences.map((s) => (
          <option key={s.id} value={String(s.id)}>
            {s.display_name} ({s.length.toLocaleString()} bp)
          </option>
        ))}
      </select>
    </label>
  );
}

/** The wrapped, color-coded alignment body. */
function AlignmentView({ model }: { model: CompareModel }) {
  return (
    <div className="space-y-3 font-mono text-[12px] leading-[1.35]">
      {model.blocks.map((block) => (
        <div key={block.colStart} className="whitespace-pre">
          {/* A row with leading coordinate */}
          <div className="flex gap-3">
            <span className="w-12 shrink-0 select-none text-right text-gray-400">
              {block.aStart ?? ""}
            </span>
            <span>
              {block.aRow.split("").map((ch, i) => (
                <span
                  key={i}
                  className={
                    block.kinds[i] === "mismatch"
                      ? "bg-rose-100 text-rose-700"
                      : block.kinds[i] === "gap"
                        ? "text-gray-300"
                        : "text-gray-800"
                  }
                >
                  {ch}
                </span>
              ))}
            </span>
            <span className="w-12 shrink-0 select-none text-left text-gray-400">
              {block.aEnd ?? ""}
            </span>
          </div>
          {/* Midline */}
          <div className="flex gap-3">
            <span className="w-12 shrink-0" />
            <span className="text-gray-400">{block.midline}</span>
          </div>
          {/* B row with leading coordinate */}
          <div className="flex gap-3">
            <span className="w-12 shrink-0 select-none text-right text-gray-400">
              {block.bStart ?? ""}
            </span>
            <span>
              {block.bRow.split("").map((ch, i) => (
                <span
                  key={i}
                  className={
                    block.kinds[i] === "mismatch"
                      ? "bg-rose-100 text-rose-700"
                      : block.kinds[i] === "gap"
                        ? "text-gray-300"
                        : "text-gray-800"
                  }
                >
                  {ch}
                </span>
              ))}
            </span>
            <span className="w-12 shrink-0 select-none text-left text-gray-400">
              {block.bEnd ?? ""}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** An SVG dotplot of shared k-mers (down-sampled grid). Rendered as a readable
 *  square with labelled axes in its own result section. */
function DotplotView({ a, b }: { a: string; b: string }) {
  const autoK = useMemo(() => dotplotWordSize(Math.min(a.length, b.length)), [a, b]);
  // The user can override the word size to reveal weaker local similarity: a
  // smaller k marks shorter exact runs, so divergent sequences (few long exact
  // matches) light up more. Null = auto.
  const [kOverride, setKOverride] = useState<number | null>(null);
  const k = kOverride ?? autoK;
  const plot = useMemo(() => computeDotplot(a, b, DOTPLOT_GRID, k), [a, b, k]);

  const g = plot.size;
  const cell = DOTPLOT_PX / g;
  const dots: { x: number; y: number }[] = [];
  for (let row = 0; row < g; row++) {
    for (let col = 0; col < g; col++) {
      if (plot.cells[row * g + col]) dots.push({ x: col * cell, y: row * cell });
    }
  }
  const sparse = dots.length < 5;

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex w-full items-center gap-3">
        <span className="text-meta font-medium uppercase tracking-wide text-gray-400">
          Dotplot (k = {plot.k})
        </span>
        <label className="ml-auto flex items-center gap-1.5 text-meta text-gray-500">
          <span>Word size</span>
          <select
            value={kOverride ?? "auto"}
            onChange={(e) =>
              setKOverride(e.target.value === "auto" ? null : Number(e.target.value))
            }
            className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-meta focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            <option value="auto">Auto ({autoK})</option>
            {[6, 8, 10, 12, 14].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      {/* axis labels frame the square: A runs along the top, B down the left */}
      <div className="flex flex-col gap-1">
        <span className="text-meta text-gray-400">A &rarr;</span>
        <div className="flex items-stretch gap-1">
          <span
            className="flex items-center text-meta text-gray-400"
            style={{ writingMode: "vertical-rl" }}
          >
            B &darr;
          </span>
          <svg
            width={DOTPLOT_PX}
            height={DOTPLOT_PX}
            viewBox={`0 0 ${DOTPLOT_PX} ${DOTPLOT_PX}`}
            className="rounded-md border border-gray-200 bg-white"
            role="img"
            aria-label="Dotplot of shared k-mers between the two sequences"
          >
            {dots.map((d, i) => (
              <rect
                key={i}
                x={d.x}
                y={d.y}
                width={Math.max(1, cell)}
                height={Math.max(1, cell)}
                className="fill-sky-500"
              />
            ))}
            {dots.length === 0 && (
              <text
                x={DOTPLOT_PX / 2}
                y={DOTPLOT_PX / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={11}
                className="fill-gray-400"
              >
                No runs of {k} identical bases
              </text>
            )}
          </svg>
        </div>
      </div>
      {sparse && (
        <p className="max-w-[340px] text-meta text-gray-400">
          {dots.length === 0 ? "No" : "Few"} exact {k} bp matches, so these
          sequences share little local identity at this word size. Lower the word
          size to reveal weaker similarity.
        </p>
      )}
    </div>
  );
}

export default function CompareSequencesDialog({
  open,
  onClose,
  defaultAId,
}: {
  open: boolean;
  onClose: () => void;
  /** Pre-select sequence A (e.g. the currently selected library item). */
  defaultAId?: number | null;
}) {
  const [aId, setAId] = useState<number | null>(null);
  const [bId, setBId] = useState<number | null>(null);
  const [mode, setMode] = useState<AlignMode>("global");
  // "auto" sniffs DNA vs protein from the input; "dna" / "protein" force it.
  const [scheme, setScheme] = useState<"auto" | ScoreScheme>("auto");
  const [iupac, setIupac] = useState(true);
  const [showDotplot, setShowDotplot] = useState(true);
  // Which scheme actually scored the last run, for the result readout.
  const [usedScheme, setUsedScheme] = useState<ScoreScheme>("dna");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AlignmentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bases of the two sequences actually aligned, kept for the dotplot.
  const lastBasesRef = useRef<{ a: string; b: string } | null>(null);

  const { data: sequences = [] } = useQuery({
    queryKey: ["sequences"],
    queryFn: () => sequencesApi.list(),
    enabled: open,
  });

  // Seed A from the caller's selection when the dialog opens.
  useEffect(() => {
    if (open) {
      setAId(defaultAId ?? null);
      setBId(null);
      setResult(null);
      setError(null);
    }
  }, [open, defaultAId]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  const runCompare = useCallback(async () => {
    if (aId == null || bId == null) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const [a, b] = await Promise.all([
        sequencesApi.get(aId),
        sequencesApi.get(bId),
      ]);
      if (!a || !b) {
        setError("Could not load one of the sequences.");
        return;
      }
      const aSeq = a.seq;
      const bSeq = b.seq;
      if (aSeq.length > MAX_ALIGN_BASES || bSeq.length > MAX_ALIGN_BASES) {
        setError(
          `These sequences are too large to align in the browser (${aSeq.length.toLocaleString()} bp and ${bSeq.length.toLocaleString()} bp; limit ${MAX_ALIGN_BASES.toLocaleString()} bp each). Compare a smaller region instead.`,
        );
        return;
      }
      // Resolve the scoring scheme: "auto" sniffs the input, otherwise honor the
      // explicit choice. Protein uses BLOSUM62; DNA uses the IUPAC-aware scheme.
      const resolved: ScoreScheme =
        scheme === "auto" ? (looksLikeProtein(aSeq, bSeq) ? "protein" : "dna") : scheme;
      const scoring = resolved === "protein" ? proteinScoring() : dnaScoring({ iupac });
      // Yield a frame so the "Aligning…" state can paint before the DP blocks
      // the thread on a large pair.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const res = mode === "global"
        ? alignGlobal(aSeq, bSeq, { scoring })
        : alignLocal(aSeq, bSeq, { scoring });
      lastBasesRef.current = { a: aSeq, b: bSeq };
      setUsedScheme(resolved);
      setResult(res);
    } catch {
      setError("Alignment failed. Try a different pair or a smaller region.");
    } finally {
      setRunning(false);
    }
  }, [aId, bId, mode, iupac, scheme]);

  // The render model (wrapped blocks + summary), capped for huge alignments. In
  // protein mode the engine summary's "identity" counts conservative BLOSUM
  // substitutions as matches, so we swap in a true-identity summary (exact
  // residue equality) for the header readout while leaving the colored blocks
  // (similar vs not) as the engine produced them.
  const model = useMemo<CompareModel | null>(() => {
    if (!result) return null;
    const m = buildCompareModel(result, ROW_WIDTH);
    if (usedScheme === "protein") {
      return { blocks: m.blocks, summary: trueIdentitySummary(result, m.summary) };
    }
    return m;
  }, [result, usedScheme]);

  const truncated = !!result && result.ops.length > MAX_RENDER_COLUMNS;
  const visibleModel = useMemo<CompareModel | null>(() => {
    if (!result || !model) return null;
    if (!truncated) return model;
    // Re-slice only the first MAX_RENDER_COLUMNS columns for rendering, keeping
    // the full-alignment summary intact.
    const clipped: AlignmentResult = {
      ...result,
      alignedA: result.alignedA.slice(0, MAX_RENDER_COLUMNS),
      alignedB: result.alignedB.slice(0, MAX_RENDER_COLUMNS),
      ops: result.ops.slice(0, MAX_RENDER_COLUMNS),
    };
    return { blocks: buildCompareModel(clipped, ROW_WIDTH).blocks, summary: model.summary };
  }, [result, model, truncated]);

  const canRun = aId != null && bId != null && !running;
  const sameSeq = aId != null && aId === bId;

  if (!open) return null;

  const aName = sequences.find((s) => s.id === aId)?.display_name;
  const bName = sequences.find((s) => s.id === bId)?.display_name;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      data-testid="compare-sequences-dialog"
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100">
            <CompareIcon className="h-5 w-5 text-sky-600" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-title font-semibold text-gray-900">Compare sequences</h2>
            <p className="text-meta text-gray-500">
              Align two sequences and see their identity, mismatches, and gaps.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Controls */}
        <div className="border-b border-gray-100 px-5 py-4">
          <div className="flex flex-wrap items-end gap-3">
            <SequencePicker label="Sequence A" value={aId} onChange={setAId} sequences={sequences} />
            <SequencePicker label="Sequence B" value={bId} onChange={setBId} sequences={sequences} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            <label className="flex flex-col gap-1">
              <span className="text-meta font-medium uppercase tracking-wide text-gray-400">
                Mode
              </span>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as AlignMode)}
                className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-body text-gray-700 focus:border-sky-400 focus:outline-none"
              >
                <option value="global">Global (end to end)</option>
                <option value="local">Local (best region)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-meta font-medium uppercase tracking-wide text-gray-400">
                Scoring
              </span>
              <select
                value={scheme}
                onChange={(e) => setScheme(e.target.value as "auto" | ScoreScheme)}
                className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-body text-gray-700 focus:border-sky-400 focus:outline-none"
              >
                <option value="auto">Auto-detect</option>
                <option value="dna">DNA (IUPAC)</option>
                <option value="protein">Protein (BLOSUM62)</option>
              </select>
            </label>
            <label className="flex items-center gap-2 self-end pb-1.5 text-body text-gray-700">
              <input
                type="checkbox"
                checked={iupac}
                disabled={scheme === "protein"}
                onChange={(e) => setIupac(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-400 disabled:opacity-50"
              />
              <span className={scheme === "protein" ? "text-gray-400" : undefined}>
                IUPAC-aware scoring
              </span>
            </label>
            <label className="flex items-center gap-2 self-end pb-1.5 text-body text-gray-700">
              <input
                type="checkbox"
                checked={showDotplot}
                onChange={(e) => setShowDotplot(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-400"
              />
              Show dotplot
            </label>
            <button
              type="button"
              onClick={runCompare}
              disabled={!canRun}
              className="ml-auto self-end rounded-md bg-sky-600 px-4 py-2 text-body font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
            >
              {running ? "Aligning…" : "Align"}
            </button>
          </div>
          {sameSeq ? (
            <p className="mt-2 text-meta text-amber-600">
              Sequence A and B are the same; the alignment will be a perfect self-match.
            </p>
          ) : null}
        </div>

        {/* Result body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <div className="rounded-lg bg-rose-50 px-4 py-3 text-body text-rose-700">{error}</div>
          ) : !result ? (
            <div className="flex h-40 items-center justify-center text-body text-gray-400">
              {running ? "Aligning…" : "Pick two sequences and select Align."}
            </div>
          ) : result.ops.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-body text-gray-400">
              No aligned region found (the local alignment is empty). Try Global mode.
            </div>
          ) : visibleModel ? (
            <div className="space-y-4">
              {/* Summary stat line */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="rounded-md bg-sky-50 px-2.5 py-1 text-body font-medium text-sky-700">
                  {formatSummaryLine(visibleModel.summary)}
                </span>
                <span className="rounded-md bg-gray-100 px-2 py-0.5 text-meta font-medium text-gray-600">
                  {usedScheme === "protein" ? "BLOSUM62" : "DNA / IUPAC"}
                </span>
                <span className="text-meta text-gray-500">
                  {visibleModel.summary.matches.toLocaleString()} match ·{" "}
                  {visibleModel.summary.mismatches.toLocaleString()} mismatch ·{" "}
                  {visibleModel.summary.gaps.toLocaleString()} gap
                </span>
                {aName && bName ? (
                  <span className="text-meta text-gray-400">
                    A: {aName} · B: {bName}
                  </span>
                ) : null}
              </div>

              {truncated ? (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-meta text-amber-700">
                  Showing the first {MAX_RENDER_COLUMNS.toLocaleString()} of{" "}
                  {result.ops.length.toLocaleString()} alignment columns. The identity
                  stat above covers the full alignment.
                </p>
              ) : null}

              {/* The alignment is the primary readout; the dotplot sits in its
                  own section below it (a readable square, not a corner thumbnail)
                  so neither crowds the other. The dotplot stays toggleable. */}
              <div className="min-w-0">
                <AlignmentView model={visibleModel} />
              </div>
              {showDotplot && lastBasesRef.current ? (
                <div className="border-t border-gray-100 pt-4">
                  <DotplotView a={lastBasesRef.current.a} b={lastBasesRef.current.b} />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
