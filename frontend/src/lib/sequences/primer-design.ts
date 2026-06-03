// primer panel bot — PURE primer DESIGN scan/scoring + the CHECK trust checks.
//
// This is an APE-style "Find Primers" first-pass filter, NOT full Primer3
// thermodynamic parity. We scan a selected region for forward/reverse candidate
// oligos whose length / Tm / %GC fall inside Primer3's default windows, require
// a 3' GC clamp, reject obvious junk (poly-X runs, self-/3'-dimers, hairpins),
// then SCORE each candidate by closeness to the optimum (Tm 60 C, length 20 bp)
// so the best primers float to the top of a short ranked list.
//
// What we deliberately DO NOT do (and say so in the UI):
//  - We do not compute the full Primer3 secondary-structure free energies; the
//    dimer / hairpin checks are simple complementary-run heuristics that flag a
//    primer worth a second look, not a calibrated dG.
//  - We do not check specificity (genome-wide off-targets). The local-library
//    scan and the NCBI Primer-BLAST handoff are a SEPARATE later item; a clean
//    seam is left for them (see designPrimers options / analyzePrimer output).
//
// The Tm is the SAME SantaLucia 1998 nearest-neighbor model the calculator uses
// (via primer.ts -> tm-nn.ts), so our numbers match Primer3 / Primer-BLAST.

import {
  reverseComplement,
  gcContent,
  sanitizePrimer,
  tmNearestNeighbor,
  findBindingSites,
  type BindingSite,
} from "./primer";

// --- DEFAULT PARAMETERS (Primer3's no-input defaults) -----------------------

/** The design windows. These are Primer3's ship-ready defaults; the user never
 *  has to touch them (they live behind the panel's collapsed Advanced section). */
export interface PrimerDesignParams {
  /** Oligo length window (bp). */
  lengthMin: number;
  lengthOpt: number;
  lengthMax: number;
  /** Melting-temperature window (C, nearest-neighbor / SantaLucia). */
  tmMin: number;
  tmOpt: number;
  tmMax: number;
  /** Percent-GC acceptance window (0-100). */
  gcMin: number;
  gcMax: number;
  /** Require at least one G/C in the last `clampLength` 3' bases (the GC clamp). */
  requireGcClamp: boolean;
  clampLength: number;
  /** Reject a candidate with a homopolymer run >= this many identical bases. */
  maxPolyX: number;
  /** Reaction conditions for Tm (mirror the editor / calculator defaults). */
  naMillimolar: number;
  oligoNanomolar: number;
}

/** Primer3's documented no-input defaults (Primer3 manual / Primer3Plus). */
export const DEFAULT_DESIGN_PARAMS: PrimerDesignParams = {
  lengthMin: 18,
  lengthOpt: 20,
  lengthMax: 27,
  tmMin: 57,
  tmOpt: 60,
  tmMax: 63,
  gcMin: 30,
  gcMax: 70,
  requireGcClamp: true,
  clampLength: 1,
  maxPolyX: 5, // Primer3 PRIMER_MAX_POLY_X default
  naMillimolar: 50,
  oligoNanomolar: 250,
};

// --- TRUST CHECKS (the CHECK mode + per-candidate badges) -------------------

/** A single trust check's verdict. "ok" = green, "warn" = amber. We never block
 *  on these; they are read-outs, not inputs. */
export type CheckLevel = "ok" | "warn";

export interface PrimerCheck {
  level: CheckLevel;
  /** Short label for the badge, e.g. "GC clamp". */
  label: string;
  /** A one-line human explanation for the tooltip / detail. */
  detail: string;
}

/** The full read-out for the CHECK mode (and reused for a candidate's badges). */
export interface PrimerAnalysis {
  primer: string;
  length: number;
  /** Nearest-neighbor (SantaLucia) Tm in C. */
  tm: number;
  /** Percent GC (0-100). */
  gc: number;
  /** Whether the 3' end carries a G/C clamp. */
  gcClamp: boolean;
  /** Longest homopolymer run (e.g. 4 for AAAA). */
  longestPolyX: number;
  /** Length of the worst self-complementary run (any-frame self-anneal). */
  selfDimerRun: number;
  /** Length of the worst 3'-end self-anneal run (primer-dimer risk). */
  threePrimeDimerRun: number;
  /** Stem length of the strongest detected hairpin (0 = none). */
  hairpinStem: number;
  /** The badges, derived from the raw numbers above. */
  checks: PrimerCheck[];
}

// Heuristic thresholds for the warn/ok split. These are deliberately simple
// (APE-level): they FLAG an oligo for a second look, they are not a calibrated
// thermodynamic dG. Tuned so a clean ~20-mer is all-green and the classic
// pathological oligos (self-dimer / hairpin / poly-X / no clamp) go amber.
const SELF_DIMER_WARN = 8; // >= 8 self-complementary bases (cf Primer3 self-any) = worth a look
const THREE_PRIME_DIMER_WARN = 4; // >= 4 complementary 3' bases = dimer risk
const HAIRPIN_STEM_WARN = 4; // >= 4 bp stem (with >=3 nt loop) = hairpin risk
const POLY_X_WARN = 5; // >= 5 identical in a row

/** Longest run of one identical base (homopolymer). "AATTTTG" -> 4. */
export function longestHomopolymer(seq: string): number {
  const s = sanitizePrimer(seq);
  let best = 0;
  let run = 0;
  let prev = "";
  for (const ch of s) {
    run = ch === prev ? run + 1 : 1;
    prev = ch;
    if (run > best) best = run;
  }
  return best;
}

/** True if the 3'-most `clampLength` bases contain at least one G or C. */
export function hasGcClamp(seq: string, clampLength = 1): boolean {
  const s = sanitizePrimer(seq);
  if (s.length === 0) return false;
  const tail = s.slice(Math.max(0, s.length - clampLength));
  return /[GC]/.test(tail);
}

/** Two bases are Watson-Crick complementary (DNA, U folds to A's complement). */
function complementary(a: string, b: string): boolean {
  return (
    (a === "A" && (b === "T" || b === "U")) ||
    ((a === "T" || a === "U") && b === "A") ||
    (a === "G" && b === "C") ||
    (a === "C" && b === "G")
  );
}

/**
 * Worst self-complementary run: slide the primer against its own reverse
 * complement over every offset and report the longest CONTIGUOUS complementary
 * stretch. This is the simple self-dimer heuristic (APE-level), not a dG.
 */
export function selfComplementarityRun(seq: string): number {
  const s = sanitizePrimer(seq).replace(/U/g, "T");
  const n = s.length;
  if (n < 2) return 0;
  const rc = reverseComplement(s);
  let best = 0;
  // Align s (5'->3') over rc (5'->3') at every offset; matching positions here
  // mean s pairs with itself antiparallel.
  for (let offset = -(n - 1); offset < n; offset += 1) {
    let run = 0;
    for (let i = 0; i < n; i += 1) {
      const j = i + offset;
      if (j < 0 || j >= n) {
        run = 0;
        continue;
      }
      // s[i] pairs with the base of the OTHER copy that sits opposite it. rc[j]
      // is the complement of s[n-1-j]; s[i] complementary to s[n-1-j] is exactly
      // s[i] === rc[j].
      if (s[i] === rc[j]) {
        run += 1;
        if (run > best) best = run;
      } else {
        run = 0;
      }
    }
  }
  return best;
}

/**
 * Worst 3'-END self-anneal run: how many of the primer's 3'-most bases are
 * complementary to some internal stretch of the same primer (or another copy).
 * A long complementary 3' end is the classic primer-dimer that extends. We take
 * the longest contiguous complementary run that INCLUDES the 3'-terminal base.
 */
export function threePrimeComplementarity(seq: string): number {
  const s = sanitizePrimer(seq).replace(/U/g, "T");
  const n = s.length;
  if (n < 2) return 0;
  let best = 0;
  // Anchor at the 3' end (index n-1) and try pairing it against every base k of
  // the same sequence, then extend toward the 5' end while bases stay
  // complementary (antiparallel walk).
  for (let k = 0; k < n; k += 1) {
    let run = 0;
    let i = n - 1; // walking back from the 3' end
    let j = k; // walking forward from position k
    while (i >= 0 && j < n && i > j && complementary(s[i], s[j])) {
      run += 1;
      i -= 1;
      j += 1;
    }
    if (run > best) best = run;
  }
  return best;
}

/**
 * Strongest hairpin stem: the longest self-complementary stem with a loop of at
 * least 3 nt between the paired arms. Simple stem detection (APE-level): for
 * each pair of positions (i forward, j backward) with a >=3 nt loop, extend a
 * complementary stem and report the longest. Not a calibrated fold dG.
 */
export function hairpinStem(seq: string, minLoop = 3): number {
  const s = sanitizePrimer(seq).replace(/U/g, "T");
  const n = s.length;
  if (n < 2 * 1 + minLoop + 2) return 0;
  let best = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = n - 1; j > i + minLoop; j -= 1) {
      // Try to grow a stem with i moving right and j moving left; the unpaired
      // gap between the inner ends must stay >= minLoop.
      let a = i;
      let b = j;
      let run = 0;
      while (a < b && b - a - 1 >= minLoop && complementary(s[a], s[b])) {
        run += 1;
        a += 1;
        b -= 1;
      }
      if (run > best) best = run;
    }
  }
  return best;
}

/**
 * Full CHECK analysis for a single oligo. Used by the panel's CHECK mode AND to
 * derive the small trust badges on each DESIGN candidate. Pure; no I/O.
 */
export function analyzePrimer(
  raw: string,
  params: PrimerDesignParams = DEFAULT_DESIGN_PARAMS,
): PrimerAnalysis {
  const primer = sanitizePrimer(raw);
  const length = primer.length;
  const tm = length > 0 ? tmNearestNeighbor(primer, params.oligoNanomolar * 1e-9, params.naMillimolar * 1e-3) : NaN;
  const gc = length > 0 ? gcContent(primer) : NaN;
  const gcClamp = hasGcClamp(primer, params.clampLength);
  const longestPolyX = longestHomopolymer(primer);
  const selfDimerRun = selfComplementarityRun(primer);
  const threePrimeDimerRun = threePrimeComplementarity(primer);
  const stem = hairpinStem(primer);

  const checks: PrimerCheck[] = [
    {
      level: gcClamp ? "ok" : "warn",
      label: "GC clamp",
      detail: gcClamp
        ? "A G or C anchors the 3' end (a GC clamp aids stable priming)."
        : "No G/C in the 3'-most base. A GC clamp helps the 3' end prime stably.",
    },
    {
      level: longestPolyX >= POLY_X_WARN ? "warn" : "ok",
      label: "Poly-X",
      detail:
        longestPolyX >= POLY_X_WARN
          ? `A run of ${longestPolyX} identical bases can cause slippage / mispriming.`
          : "No long single-base run.",
    },
    {
      level: selfDimerRun >= SELF_DIMER_WARN ? "warn" : "ok",
      label: "Self-dimer",
      detail:
        selfDimerRun >= SELF_DIMER_WARN
          ? `Up to ${selfDimerRun} self-complementary bases; the primer may fold or pair with a copy of itself.`
          : "Little self-complementarity.",
    },
    {
      level: threePrimeDimerRun >= THREE_PRIME_DIMER_WARN ? "warn" : "ok",
      label: "3' dimer",
      detail:
        threePrimeDimerRun >= THREE_PRIME_DIMER_WARN
          ? `${threePrimeDimerRun} complementary bases at the 3' end; a 3' dimer can extend and waste primer.`
          : "The 3' end is not strongly self-complementary.",
    },
    {
      level: stem >= HAIRPIN_STEM_WARN ? "warn" : "ok",
      label: "Hairpin",
      detail:
        stem >= HAIRPIN_STEM_WARN
          ? `A ${stem} bp self-folding stem could form a hairpin that hides the 3' end.`
          : "No significant hairpin stem.",
    },
  ];

  return {
    primer,
    length,
    tm,
    gc,
    gcClamp,
    longestPolyX,
    selfDimerRun,
    threePrimeDimerRun,
    hairpinStem: stem,
    checks,
  };
}

// --- DESIGN (candidate generation + ranking) --------------------------------

/** A single designed candidate primer. Coordinates are 0-based [start, end) on
 *  the FORWARD strand; `direction` is the strand its 3' end extends along. */
export interface PrimerCandidate {
  /** The primer's own 5'->3' sequence. */
  primer: string;
  /** Forward-strand binding span [start, end). */
  start: number;
  end: number;
  /** 1 = forward primer, -1 = reverse primer. */
  direction: 1 | -1;
  length: number;
  tm: number;
  gc: number;
  /** Lower is better (0 = perfectly at the optimum). */
  score: number;
  /** Full trust analysis (drives the row badges). */
  analysis: PrimerAnalysis;
}

export interface DesignResult {
  forward: PrimerCandidate[];
  reverse: PrimerCandidate[];
}

/**
 * Score a candidate by closeness to the optimum: Tm 60 C and length 20 bp are
 * the dominant terms (Primer3 weights Tm heavily), with a smaller %GC-centering
 * term and a penalty for an amber trust check. LOWER is better. This is a
 * first-pass ranking, not the Primer3 objective function.
 */
function scoreCandidate(
  tm: number,
  length: number,
  gc: number,
  analysis: PrimerAnalysis,
  params: PrimerDesignParams,
): number {
  const tmPenalty = Math.abs(tm - params.tmOpt) * 1.0;
  const lenPenalty = Math.abs(length - params.lengthOpt) * 0.5;
  const gcCenter = (params.gcMin + params.gcMax) / 2;
  const gcPenalty = (Math.abs(gc - gcCenter) / 10) * 0.5;
  const warnPenalty = analysis.checks.filter((c) => c.level === "warn").length * 2.0;
  return tmPenalty + lenPenalty + gcPenalty + warnPenalty;
}

/** True if a candidate passes the hard acceptance windows (length / Tm / GC /
 *  clamp). Trust checks are NOT hard filters; they only feed the score / badges. */
function passesWindows(tm: number, length: number, gc: number, clamp: boolean, params: PrimerDesignParams): boolean {
  if (length < params.lengthMin || length > params.lengthMax) return false;
  if (tm < params.tmMin || tm > params.tmMax) return false;
  if (gc < params.gcMin || gc > params.gcMax) return false;
  if (params.requireGcClamp && !clamp) return false;
  return true;
}

/**
 * Generate ranked forward and reverse candidate primers for the region
 * [regionStart, regionEnd) of `template` (0-based, end-exclusive, forward
 * coords).
 *
 * Strategy (APE "Find Primers" level):
 *  - FORWARD primers anchor their 5' end at the region's left edge and grow to
 *    the right, one candidate per accepted length. Their sequence is the top
 *    strand directly.
 *  - REVERSE primers anchor their 5' end at the region's right edge and grow to
 *    the left; their sequence is the reverse complement of that span.
 *  - We slide the anchor a little (a short window) so the scan finds the
 *    best-scoring primer near each end rather than forcing the exact edge.
 *
 * Each candidate is filtered by the length / Tm / GC / clamp windows, scored by
 * closeness to the optimum, and the top `limit` per direction are returned
 * sorted best-first.
 */
export function designPrimers(
  template: string,
  regionStart: number,
  regionEnd: number,
  params: PrimerDesignParams = DEFAULT_DESIGN_PARAMS,
  opts: { limit?: number; anchorWindow?: number } = {},
): DesignResult {
  const limit = opts.limit ?? 5;
  const anchorWindow = opts.anchorWindow ?? 10;
  const t = template.toUpperCase();
  const lo = Math.max(0, Math.min(regionStart, regionEnd));
  const hi = Math.min(t.length, Math.max(regionStart, regionEnd));

  const forward: PrimerCandidate[] = [];
  const reverse: PrimerCandidate[] = [];
  if (hi - lo < params.lengthMin) return { forward, reverse };

  // FORWARD: 5' end near the region's left edge, growing right.
  for (let offset = 0; offset <= anchorWindow; offset += 1) {
    const startPos = lo + offset;
    for (let len = params.lengthMin; len <= params.lengthMax; len += 1) {
      const endPos = startPos + len;
      if (endPos > hi) break;
      const primer = t.slice(startPos, endPos);
      if (/[^ACGT]/.test(primer)) continue;
      const analysis = analyzePrimer(primer, params);
      if (!passesWindows(analysis.tm, len, analysis.gc, analysis.gcClamp, params)) continue;
      forward.push({
        primer,
        start: startPos,
        end: endPos,
        direction: 1,
        length: len,
        tm: analysis.tm,
        gc: analysis.gc,
        score: scoreCandidate(analysis.tm, len, analysis.gc, analysis, params),
        analysis,
      });
    }
  }

  // REVERSE: 5' end near the region's right edge, growing left. The binding span
  // on the forward strand is [endPos-len, endPos); the primer's own 5'->3'
  // sequence is the reverse complement of that span.
  for (let offset = 0; offset <= anchorWindow; offset += 1) {
    const endPos = hi - offset;
    for (let len = params.lengthMin; len <= params.lengthMax; len += 1) {
      const startPos = endPos - len;
      if (startPos < lo) break;
      const span = t.slice(startPos, endPos);
      if (/[^ACGT]/.test(span)) continue;
      const primer = reverseComplement(span);
      const analysis = analyzePrimer(primer, params);
      if (!passesWindows(analysis.tm, len, analysis.gc, analysis.gcClamp, params)) continue;
      reverse.push({
        primer,
        start: startPos,
        end: endPos,
        direction: -1,
        length: len,
        tm: analysis.tm,
        gc: analysis.gc,
        score: scoreCandidate(analysis.tm, len, analysis.gc, analysis, params),
        analysis,
      });
    }
  }

  // De-duplicate identical oligos (different anchors can converge), keep best.
  const dedupe = (list: PrimerCandidate[]) => {
    const byKey = new Map<string, PrimerCandidate>();
    for (const c of list) {
      const key = `${c.primer}`;
      const prev = byKey.get(key);
      if (!prev || c.score < prev.score) byKey.set(key, c);
    }
    return [...byKey.values()].sort((a, b) => a.score - b.score).slice(0, limit);
  };

  return { forward: dedupe(forward), reverse: dedupe(reverse) };
}

// --- LOCAL BINDING (CHECK mode: where does this primer land?) ---------------

/** Where a checked primer binds the CURRENT sequence, with the intended primary
 *  site and any extra (possibly unintended) sites flagged. A clean seam for the
 *  future specificity work: this is the local, current-sequence-only scan. */
export interface BindingReport {
  sites: BindingSite[];
  /** True when more than one site was found (extra sites flagged in the UI). */
  hasExtraSites: boolean;
}

export function checkBinding(primer: string, template: string): BindingReport {
  const sites = findBindingSites(primer, template, { allowPartial: true });
  return { sites, hasExtraSites: sites.length > 1 };
}
