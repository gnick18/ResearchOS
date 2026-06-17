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
import type { AlignmentResult, AlignOp, Hsp, SharedRegionResult } from "@/lib/align";
import { useAlignWorker, WORKER_THRESHOLD } from "@/lib/align/useAlignWorker";
import {
  buildCompareModel,
  formatSummaryLine,
  summarizeAlignment,
  type CompareModel,
  type AlignmentSummary,
} from "@/lib/sequences/compare-format";
import { computeDotplot, dotplotWordSize } from "@/lib/sequences/compare-dotplot";
import type { SequenceRecord } from "@/lib/types";
import type { AlignmentArtifactResult } from "@/lib/sequences/artifacts";
import LivingPopup from "@/components/ui/LivingPopup";

// MAX_ALIGN_BASES is imported as WORKER_THRESHOLD from useAlignWorker (single
// source of truth). This alias exists only to keep the render-side warning
// message readable; do NOT add a separate constant here.
// Plasmid-scale (a few tens of kb) is comfortable for the full DP.
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

function AlignIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <line x1="8" y1="7" x2="8" y2="17" strokeDasharray="1.5 2.5" />
      <line x1="12" y1="7" x2="12" y2="17" strokeDasharray="1.5 2.5" />
      <line x1="16" y1="7" x2="16" y2="17" strokeDasharray="1.5 2.5" />
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
      <span className="text-meta font-medium uppercase tracking-wide text-foreground-muted">
        {label}
      </span>
      <select
        value={value == null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
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
            <span className="w-12 shrink-0 select-none text-right text-foreground-muted">
              {block.aStart ?? ""}
            </span>
            <span>
              {block.aRow.split("").map((ch, i) => (
                <span
                  key={i}
                  className={
                    block.kinds[i] === "mismatch"
                      ? "bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300"
                      : block.kinds[i] === "gap"
                        ? "text-foreground-muted"
                        : "text-foreground"
                  }
                >
                  {ch}
                </span>
              ))}
            </span>
            <span className="w-12 shrink-0 select-none text-left text-foreground-muted">
              {block.aEnd ?? ""}
            </span>
          </div>
          {/* Midline */}
          <div className="flex gap-3">
            <span className="w-12 shrink-0" />
            <span className="text-foreground-muted">{block.midline}</span>
          </div>
          {/* B row with leading coordinate */}
          <div className="flex gap-3">
            <span className="w-12 shrink-0 select-none text-right text-foreground-muted">
              {block.bStart ?? ""}
            </span>
            <span>
              {block.bRow.split("").map((ch, i) => (
                <span
                  key={i}
                  className={
                    block.kinds[i] === "mismatch"
                      ? "bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300"
                      : block.kinds[i] === "gap"
                        ? "text-foreground-muted"
                        : "text-foreground"
                  }
                >
                  {ch}
                </span>
              ))}
            </span>
            <span className="w-12 shrink-0 select-none text-left text-foreground-muted">
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
        <span className="text-meta font-medium uppercase tracking-wide text-foreground-muted">
          Dotplot (k = {plot.k})
        </span>
        <label className="ml-auto flex items-center gap-1.5 text-meta text-foreground-muted">
          <span>Word size</span>
          <select
            value={kOverride ?? "auto"}
            onChange={(e) =>
              setKOverride(e.target.value === "auto" ? null : Number(e.target.value))
            }
            className="rounded border border-border bg-surface-raised px-1.5 py-0.5 text-meta focus:outline-none focus:ring-2 focus:ring-blue-400"
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
        <span className="text-meta text-foreground-muted">A &rarr;</span>
        <div className="flex items-stretch gap-1">
          <span
            className="flex items-center text-meta text-foreground-muted"
            style={{ writingMode: "vertical-rl" }}
          >
            B &darr;
          </span>
          <svg
            width={DOTPLOT_PX}
            height={DOTPLOT_PX}
            viewBox={`0 0 ${DOTPLOT_PX} ${DOTPLOT_PX}`}
            className="rounded-md border border-border bg-surface-raised"
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
        <p className="max-w-[340px] text-meta text-foreground-muted">
          {dots.length === 0 ? "No" : "Few"} exact {k} bp matches, so these
          sequences share little local identity at this word size. Lower the word
          size to reveal weaker similarity.
        </p>
      )}
    </div>
  );
}

/**
 * Build a render model directly from an HSP's aligned strings so the same
 * monospace block view (used for the normal alignment) renders each shared
 * region. The HSP carries `aStart`/`bStart` (0-based, forward coordinates) so
 * the coordinate ticks read in real sequence positions. For a reverse-strand
 * HSP `alignedB` is already the reverse-complemented B segment, and `bStart` is
 * the forward-B start of the spanned region; we still tick B forward from there,
 * which keeps the ticks monotonic across the displayed (revcomp) segment.
 */
function hspToCompareModel(hsp: Hsp): CompareModel {
  const ops: AlignOp[] = [];
  for (let i = 0; i < hsp.alignedA.length; i++) {
    const ca = hsp.alignedA[i];
    const cb = hsp.alignedB[i];
    if (ca === "-" || cb === "-") ops.push("D");
    else ops.push(ca.toUpperCase() === cb.toUpperCase() ? "M" : "X");
  }
  const synthetic: AlignmentResult = {
    score: hsp.score,
    aStart: hsp.aStart,
    aEnd: hsp.aEnd,
    bStart: hsp.bStart,
    bEnd: hsp.bEnd,
    identity: hsp.identity,
    alignedA: hsp.alignedA,
    alignedB: hsp.alignedB,
    ops,
    cigar: "",
  };
  return buildCompareModel(synthetic, ROW_WIDTH);
}

/** One expandable shared-region (HSP) card. */
function HspCard({ hsp, rank }: { hsp: Hsp; rank: number }) {
  const [open, setOpen] = useState(false);
  const model = useMemo(() => hspToCompareModel(hsp), [hsp]);
  const idPct = Math.round(hsp.identity * 100);
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left transition-colors hover:bg-surface-sunken"
      >
        <span className="text-meta font-semibold text-foreground-muted">#{rank}</span>
        <span className="rounded bg-sky-50 dark:bg-sky-500/15 px-1.5 py-0.5 text-meta font-medium text-sky-700 dark:text-sky-300">
          {idPct}% identity
        </span>
        <span
          className={
            hsp.strand === 1
              ? "rounded bg-emerald-50 dark:bg-emerald-500/15 px-1.5 py-0.5 text-meta font-medium text-emerald-700 dark:text-emerald-300"
              : "rounded bg-violet-50 dark:bg-violet-500/15 px-1.5 py-0.5 text-meta font-medium text-violet-700 dark:text-violet-300"
          }
        >
          {hsp.strand === 1 ? "+ strand" : "- strand"}
        </span>
        <span className="text-meta text-foreground-muted">
          A {(hsp.aStart + 1).toLocaleString()}&ndash;{hsp.aEnd.toLocaleString()}{" "}
          ({hsp.aLength.toLocaleString()} bp)
        </span>
        <span className="text-meta text-foreground-muted">
          B {(hsp.bStart + 1).toLocaleString()}&ndash;{hsp.bEnd.toLocaleString()}{" "}
          ({hsp.bLength.toLocaleString()} bp)
        </span>
        <span className="ml-auto text-meta text-foreground-muted">
          {open ? "Hide alignment" : "Show alignment"}
        </span>
      </button>
      {open ? (
        <div className="overflow-x-auto border-t border-border px-3 py-3">
          <AlignmentView model={model} />
        </div>
      ) : null}
    </div>
  );
}

/** The ranked shared-region (local homology) list for the large-sequence path. */
function SharedRegionsView({ result }: { result: SharedRegionResult }) {
  if (result.hsps.length === 0) {
    return (
      <p className="rounded-lg bg-surface-sunken px-4 py-3 text-body text-foreground-muted">
        No shared regions of {result.k} or more identical bases were found
        between these sequences on either strand. They share little local
        homology. Lower the dotplot word size to look for weaker similarity.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-meta font-medium uppercase tracking-wide text-foreground-muted">
          Shared regions (local homology)
        </span>
        <span className="text-meta text-foreground-muted">
          {result.truncated
            ? `Top ${result.hsps.length} of ${result.totalHsps.toLocaleString()} regions, ranked by score (seed word ${result.k}).`
            : `${result.hsps.length.toLocaleString()} ${result.hsps.length === 1 ? "region" : "regions"}, ranked by score (seed word ${result.k}).`}
        </span>
      </div>
      <div className="space-y-2">
        {result.hsps.map((hsp, i) => (
          <HspCard key={`${hsp.strand}:${hsp.aStart}:${hsp.bStart}`} hsp={hsp} rank={i + 1} />
        ))}
      </div>
    </div>
  );
}

export default function CompareSequencesDialog({
  open,
  onClose,
  defaultAId,
  onResult,
  seeded,
}: {
  open: boolean;
  onClose: () => void;
  /** Pre-select sequence A (e.g. the currently selected library item). */
  defaultAId?: number | null;
  /**
   * Phase 5 (results as artifacts). Fired when a comparison COMPLETES, carrying
   * the self-contained payload so the editor can persist it as an artifact. A
   * SEEDED open (re-rendering a saved result) does NOT fire this. Best-effort:
   * the dialog never awaits it.
   */
  onResult?: (result: AlignmentArtifactResult) => void;
  /**
   * Phase 5. When set, the dialog opens in a READ view rendering this stored
   * result without recomputing (re-opening a saved alignment artifact). The
   * controls still work, so the user can re-run the live alignment from here.
   */
  seeded?: AlignmentArtifactResult | null;
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
  // Set instead of `result` when the pair is too large for full DP: the ranked
  // shared-region (local homology) list plus the always-on dotplot.
  const [largeResult, setLargeResult] = useState<SharedRegionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bases of the two sequences actually aligned, kept for the dotplot.
  const lastBasesRef = useRef<{ a: string; b: string } | null>(null);

  // Off-main-thread alignment for large sequence pairs. The hook manages the
  // worker lifecycle; terminate() is called on dialog close so nothing leaks.
  const alignWorker = useAlignWorker();

  const { data: sequences = [] } = useQuery({
    queryKey: ["sequences"],
    queryFn: () => sequencesApi.list(),
    enabled: open,
  });

  // Terminate any running worker when the dialog closes so nothing leaks.
  useEffect(() => {
    if (!open) alignWorker.terminate();
  }, [open, alignWorker]);

  // Seed A from the caller's selection when the dialog opens. When a SEEDED
  // result is supplied (re-opening a saved alignment artifact), replay its
  // ids/params/result into a read view instead of clearing, so the stored
  // alignment renders without recomputing.
  useEffect(() => {
    if (!open) return;
    if (seeded) {
      setAId(seeded.aId);
      setBId(seeded.bId);
      setMode(seeded.mode);
      setScheme(seeded.scheme);
      setIupac(seeded.iupac);
      setUsedScheme(seeded.scheme);
      setResult(seeded.alignment);
      setLargeResult(seeded.large);
      lastBasesRef.current = seeded.bases;
      setError(null);
      return;
    }
    setAId(defaultAId ?? null);
    setBId(null);
    setResult(null);
    setLargeResult(null);
    lastBasesRef.current = null;
    setError(null);
  }, [open, defaultAId, seeded]);

  const runCompare = useCallback(async () => {
    if (aId == null || bId == null) return;
    // Terminate any in-flight worker before starting a new run.
    alignWorker.terminate();
    setRunning(true);
    setError(null);
    setResult(null);
    setLargeResult(null);
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
      // Resolve the scoring scheme: "auto" sniffs the input, otherwise honor the
      // explicit choice. Protein uses BLOSUM62; DNA uses the IUPAC-aware scheme.
      const resolved: ScoreScheme =
        scheme === "auto" ? (looksLikeProtein(aSeq, bSeq) ? "protein" : "dna") : scheme;
      const scoringDesc =
        resolved === "protein"
          ? ({ type: "protein" } as const)
          : ({ type: "dna", iupac } as const);

      lastBasesRef.current = { a: aSeq, b: bSeq };
      setUsedScheme(resolved);
      const aName = a.display_name ?? null;
      const bName = b.display_name ?? null;

      // Run the alignment (off-thread for large pairs, synchronous for small
      // ones). The worker hook handles the threshold check internally; we
      // still pass `large` to the hook as a hint via the job size detection.
      const aligned = await alignWorker.run({
        aSeq,
        bSeq,
        mode,
        scoring: scoringDesc,
      });

      if (aligned.large) {
        setLargeResult(aligned.large);
        // Phase 5: persist the large-sequence result as an artifact. The summary
        // is a zeroed alignment summary (no single base-level alignment exists);
        // the row label leans on the shared-region count instead.
        onResult?.({
          aId,
          bId,
          aName,
          bName,
          mode,
          scheme: resolved,
          iupac,
          summary: summarizeAlignment({
            score: 0,
            aStart: 0,
            aEnd: 0,
            bStart: 0,
            bEnd: 0,
            identity: 0,
            alignedA: "",
            alignedB: "",
            ops: [],
            cigar: "",
          }),
          alignment: null,
          large: aligned.large,
          bases: { a: aSeq, b: bSeq },
        });
      } else if (aligned.alignment) {
        const res = aligned.alignment;
        setResult(res);
        // Phase 5: persist the base-level alignment as an artifact. In protein
        // mode swap in the true-residue-identity summary so the saved summary
        // matches what the dialog shows.
        const baseSummary = summarizeAlignment(res);
        const summary =
          resolved === "protein" ? trueIdentitySummary(res, baseSummary) : baseSummary;
        onResult?.({
          aId,
          bId,
          aName,
          bName,
          mode,
          scheme: resolved,
          iupac,
          summary,
          alignment: res,
          large: null,
          bases: { a: aSeq, b: bSeq },
        });
      }
    } catch {
      setError("Alignment failed. Try a different pair or a smaller region.");
    } finally {
      setRunning(false);
    }
  }, [aId, bId, mode, iupac, scheme, onResult, alignWorker]);

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

  // Prefer the live library name, falling back to a seeded artifact's stored
  // name so a re-opened result still labels its pair even if a sequence was
  // since renamed or removed from the list.
  const aName =
    sequences.find((s) => s.id === aId)?.display_name ?? seeded?.aName ?? undefined;
  const bName =
    sequences.find((s) => s.id === bId)?.display_name ?? seeded?.bName ?? undefined;

  return (
    <LivingPopup open onClose={onClose} label="Align sequences" selfSize showClose={false}>
      <div
        className="pointer-events-auto relative flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-surface-raised ros-popup-card-shadow"
        data-testid="compare-sequences-dialog"
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-500/15">
            <AlignIcon className="h-5 w-5 text-sky-600 dark:text-sky-300" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-title font-semibold text-foreground">Align sequences</h2>
            <p className="text-meta text-foreground-muted">
              Align two sequences and see their identity, mismatches, and gaps.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground-muted"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Controls */}
        <div className="border-b border-border px-5 py-4">
          <div className="flex flex-wrap items-end gap-3">
            <SequencePicker label="Sequence A" value={aId} onChange={setAId} sequences={sequences} />
            <SequencePicker label="Sequence B" value={bId} onChange={setBId} sequences={sequences} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            <label className="flex flex-col gap-1">
              <span className="text-meta font-medium uppercase tracking-wide text-foreground-muted">
                Mode
              </span>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as AlignMode)}
                className="rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
              >
                <option value="global">Global (end to end)</option>
                <option value="local">Local (best region)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-meta font-medium uppercase tracking-wide text-foreground-muted">
                Scoring
              </span>
              <select
                value={scheme}
                onChange={(e) => setScheme(e.target.value as "auto" | ScoreScheme)}
                className="rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
              >
                <option value="auto">Auto-detect</option>
                <option value="dna">DNA (IUPAC)</option>
                <option value="protein">Protein (BLOSUM62)</option>
              </select>
            </label>
            <label className="flex items-center gap-2 self-end pb-1.5 text-body text-foreground">
              <input
                type="checkbox"
                checked={iupac}
                disabled={scheme === "protein"}
                onChange={(e) => setIupac(e.target.checked)}
                className="h-4 w-4 rounded border-border text-sky-600 dark:text-sky-300 focus:ring-sky-400 disabled:opacity-50"
              />
              <span className={scheme === "protein" ? "text-foreground-muted" : undefined}>
                IUPAC-aware scoring
              </span>
            </label>
            <label className="flex items-center gap-2 self-end pb-1.5 text-body text-foreground">
              <input
                type="checkbox"
                checked={showDotplot}
                onChange={(e) => setShowDotplot(e.target.checked)}
                className="h-4 w-4 rounded border-border text-sky-600 dark:text-sky-300 focus:ring-sky-400"
              />
              Show dotplot
            </label>
            <button
              type="button"
              onClick={runCompare}
              disabled={!canRun}
              className="ros-btn-raise ml-auto self-end rounded-md bg-brand-action px-4 py-2 text-body font-medium text-white transition-colors hover:bg-brand-action/90 disabled:opacity-50"
            >
              {running ? "Aligning…" : "Align"}
            </button>
          </div>
          {sameSeq ? (
            <p className="mt-2 text-meta text-amber-600 dark:text-amber-300">
              Sequence A and B are the same; the alignment will be a perfect self-match.
            </p>
          ) : null}
        </div>

        {/* Result body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <div className="rounded-lg bg-rose-50 dark:bg-rose-500/15 px-4 py-3 text-body text-rose-700 dark:text-rose-300">{error}</div>
          ) : largeResult && lastBasesRef.current ? (
            <div className="space-y-4">
              <div className="rounded-md bg-amber-50 dark:bg-amber-500/15 px-3 py-2 text-meta text-amber-700 dark:text-amber-300">
                These sequences are too large for a full base-level alignment
                ({lastBasesRef.current.a.length.toLocaleString()} bp and{" "}
                {lastBasesRef.current.b.length.toLocaleString()} bp; the exact
                alignment is capped at {WORKER_THRESHOLD.toLocaleString()} bp each).
                Showing the shared regions (local homology) and the dotplot
                instead. The shared-region list is a fast heuristic, not a single
                guaranteed-optimal global alignment.
              </div>
              {aName && bName ? (
                <span className="text-meta text-foreground-muted">A: {aName} · B: {bName}</span>
              ) : null}
              <SharedRegionsView result={largeResult} />
              <div className="border-t border-border pt-4">
                <DotplotView
                  a={lastBasesRef.current.a}
                  b={lastBasesRef.current.b}
                />
              </div>
            </div>
          ) : !result ? (
            <div className="flex h-40 flex-col items-center justify-center gap-3 text-body text-foreground-muted">
              {running ? (
                <>
                  <div
                    className="h-6 w-6 animate-spin rounded-full border-2 border-sky-200 border-t-sky-500"
                    aria-hidden="true"
                  />
                  <span>Aligning sequences&hellip;</span>
                </>
              ) : (
                "Pick two sequences and select Align."
              )}
            </div>
          ) : result.ops.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-body text-foreground-muted">
              No aligned region found (the local alignment is empty). Try Global mode.
            </div>
          ) : visibleModel ? (
            <div className="space-y-4">
              {/* Summary stat line */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="rounded-md bg-sky-50 dark:bg-sky-500/15 px-2.5 py-1 text-body font-medium text-sky-700 dark:text-sky-300">
                  {formatSummaryLine(visibleModel.summary)}
                </span>
                <span className="rounded-md bg-surface-sunken px-2 py-0.5 text-meta font-medium text-foreground-muted">
                  {usedScheme === "protein" ? "BLOSUM62" : "DNA / IUPAC"}
                </span>
                <span className="text-meta text-foreground-muted">
                  {visibleModel.summary.matches.toLocaleString()} match ·{" "}
                  {visibleModel.summary.mismatches.toLocaleString()} mismatch ·{" "}
                  {visibleModel.summary.gaps.toLocaleString()} gap
                </span>
                {aName && bName ? (
                  <span className="text-meta text-foreground-muted">
                    A: {aName} · B: {bName}
                  </span>
                ) : null}
              </div>

              {truncated ? (
                <p className="rounded-md bg-amber-50 dark:bg-amber-500/15 px-3 py-2 text-meta text-amber-700 dark:text-amber-300">
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
                <div className="border-t border-border pt-4">
                  <DotplotView a={lastBasesRef.current.a} b={lastBasesRef.current.b} />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </LivingPopup>
  );
}
