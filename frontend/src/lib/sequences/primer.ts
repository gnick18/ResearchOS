// sequence Phase 2e bot — PURE primer biology (SnapGene "Add Primer" parity).
//
// Self-contained string/complement math. The NEAREST-NEIGHBOR Tm is NOT a second
// implementation: it delegates to the lab-calculators arc's rigorous
// Biopython-Tm_NN-parity model (lib/calculators/tm-nn.ts) so the editor and the
// Scientific calculator report the SAME number for the same oligo. See the
// `tmNearestNeighbor` doc-comment for the default conditions and the short-oligo
// fallback. Only the basic (Wallace / salt-adjusted GC) Tm is local, kept as the
// fallback for oligos the NN model cannot score (< 8 nt or degenerate bases).
//
// Coordinates: a binding SITE is reported as 0-based [start, end) on the FORWARD
// (top) strand, regardless of which strand the primer anneals to. `direction`
// records the strand the primer's 3' end extends along (1 = forward, -1 = reverse),
// which is what SeqViz's `primers` prop wants and what a primer_bind feature's
// strand encodes.

import { nearestNeighborTm } from "@/lib/calculators/tm-nn";
import { seedAndExtend, dnaScoring } from "@/lib/align";

/** Complement of a single IUPAC base (uppercased). Unknown chars map to "N". */
const COMPLEMENT: Record<string, string> = {
  A: "T", T: "A", U: "A", G: "C", C: "G",
  R: "Y", Y: "R", S: "S", W: "W", K: "M", M: "K",
  B: "V", V: "B", D: "H", H: "D", N: "N",
};

/** Reverse-complement of a nucleotide string (T/U handled, ambiguity codes kept). */
export function reverseComplement(seq: string): string {
  const s = seq.toUpperCase();
  let out = "";
  for (let i = s.length - 1; i >= 0; i -= 1) {
    out += COMPLEMENT[s[i]] ?? "N";
  }
  return out;
}

/** IUPAC GC contribution per base (fractional; absent bases count as 0 and are
 *  excluded from the denominator). Standard table:
 *    definite GC: 1.0  |  definite AT/U: 0.0  |  S(=GC): 1.0  |  W(=AT): 0.0
 *    M(=AC): 0.5  |  K(=GT): 0.5  |  R(=AG): 0.5  |  Y(=CT): 0.5
 *    B(=CGT): 2/3 |  D(=AGT): 1/3 |  H(=ACT): 1/3 |  V(=ACG): 2/3
 *    N(=ACGT): 0.5
 * A base is included in the denominator when it has a known contribution. */
const IUPAC_GC_CONTRIBUTION: Record<string, number> = {
  G: 1, C: 1, S: 1,
  A: 0, T: 0, U: 0, W: 0,
  M: 0.5, K: 0.5, R: 0.5, Y: 0.5,
  B: 2 / 3, D: 1 / 3, H: 1 / 3, V: 2 / 3,
  N: 0.5,
};

/** GC% (0-100) of a primer/oligo string. Handles all standard IUPAC ambiguity
 *  codes using fractional contributions so degenerate primers report a meaningful
 *  GC estimate without silently truncating the sequence. Non-nucleotide characters
 *  are excluded from the denominator. */
export function gcContent(seq: string): number {
  const s = seq.toUpperCase();
  let gc = 0;
  let counted = 0;
  for (const ch of s) {
    const contrib = IUPAC_GC_CONTRIBUTION[ch];
    if (contrib !== undefined) {
      gc += contrib;
      counted += 1;
    }
  }
  if (counted === 0) return 0;
  return (gc / counted) * 100;
}

/** Keep only IUPAC nucleotide characters (uppercased), dropping whitespace,
 *  numbers, and other non-base characters. Preserves all ambiguity codes
 *  (R Y W S K M B D H V N) so degenerate primers are not silently truncated. */
export function sanitizePrimer(raw: string): string {
  return raw.toUpperCase().replace(/[^ACGTUSRYWKMBDHVN]/g, "");
}

// --- Tm ---------------------------------------------------------------------

/** Tm METHODS we expose. "basic" = the salt-adjusted Wallace-style formula;
 *  "nn" = nearest-neighbor (SantaLucia 1998 unified parameters). */
export type TmMethod = "basic" | "nn";

/**
 * BASIC salt-adjusted Tm. For oligos < 14 nt uses the Wallace rule
 * (2*(A+T) + 4*(G+C)); for >= 14 nt uses the common salt-adjusted GC formula
 *   Tm = 64.9 + 41*(G+C - 16.4) / (A+T+G+C)
 * (a standard textbook approximation; salt-independent at default 50 mM Na+).
 * Returns NaN for an empty oligo.
 *
 * For primers with IUPAC ambiguity codes, uses the full primer length (n) and
 * counts GC using the same fractional IUPAC contributions as gcContent so
 * degenerate primers get a reasonable basic Tm without silent truncation.
 */
export function tmBasic(seq: string): number {
  const s = sanitizePrimer(seq);
  const n = s.length;
  if (n === 0) return NaN;
  let gc = 0;
  for (const ch of s) {
    const contrib = IUPAC_GC_CONTRIBUTION[ch];
    if (contrib !== undefined) gc += contrib;
  }
  const at = n - gc;
  if (n < 14) {
    return 2 * at + 4 * gc;
  }
  return 64.9 + (41 * (gc - 16.4)) / n;
}

/**
 * The default reaction conditions the editor's NN-Tm assumes when the caller
 * gives no explicit values. These MUST match the Scientific calculator's
 * primer-Tm defaults (CalculatorsButton.tsx) so the editor and the calculator
 * report the SAME Tm for the same oligo: 50 mM monovalent salt, 0.25 uM (250 nM)
 * total oligo, no Mg2+ / dNTPs.
 */
const EDITOR_TM_NA_MM = 50;
const EDITOR_TM_OLIGO_NM = 250;

/** Below this length the NN model is least reliable and the calculator's table
 *  still works but the editor historically fell back to the Wallace rule; we
 *  keep that fallback boundary so a short oligo's Tm is the basic 2-4 estimate. */
const NN_MIN_LENGTH = 8;

/**
 * NEAREST-NEIGHBOR Tm in °C — the SINGLE SOURCE OF TRUTH delegated to the lab-
 * calculators arc's `nearestNeighborTm` (Biopython Tm_NN parity: DNA_NN3, Allawi
 * & SantaLucia 1997, SantaLucia 1998 salt correction). Because both the editor's
 * primer dialog and the Scientific calculator compute through the same function
 * with the same default conditions, they report identical numbers.
 *
 * @param seq          primer sequence (T/U accepted; U folded to T)
 * @param oligoMolarity total strand concentration in mol/L (default 0.25 uM;
 *                       converted to nM for the calculator call)
 * @param naMolarity    monovalent cation in mol/L (default 50 mM; converted to mM)
 *
 * Falls back to the basic formula for oligos < 8 nt or with IUPAC ambiguity
 * codes (the NN dinucleotide table covers only unambiguous ACGT pairs). The
 * basic formula uses the full primer length and fractional IUPAC GC contributions
 * so degenerate oligos get a meaningful estimate without silent truncation.
 */
export function tmNearestNeighbor(
  seq: string,
  oligoMolarity = EDITOR_TM_OLIGO_NM * 1e-9,
  naMolarity = EDITOR_TM_NA_MM * 1e-3,
): number {
  const s = sanitizePrimer(seq).replace(/U/g, "T");
  const n = s.length;
  if (n < NN_MIN_LENGTH || /[^ACGT]/.test(s)) return tmBasic(seq);

  const result = nearestNeighborTm(s, {
    na: naMolarity * 1e3, // mol/L -> mM
    oligoNanomolar: oligoMolarity * 1e9, // mol/L -> nM
  });
  // nearestNeighborTm returns null only for inputs we've already excluded above
  // (< 2 nt / non-positive salt); fall back to basic to stay total.
  return result ? result.tm : tmBasic(seq);
}

/** Default Tm used by the dialog: nearest-neighbor when applicable, else basic.
 *  Routes through `tmNearestNeighbor`, i.e. the calculator's model, so the editor
 *  and the Scientific calculator agree on the same oligo. */
export function predictTm(seq: string): number {
  return tmNearestNeighbor(seq);
}

// --- BINDING-SITE SEARCH ----------------------------------------------------

/** A place a primer anneals on the template. */
export interface BindingSite {
  /** 0-based [start, end) on the FORWARD strand covering the annealed region. */
  start: number;
  end: number;
  /** Strand the primer's 3' end extends along: 1 = forward (top), -1 = reverse. */
  direction: 1 | -1;
  /** How many of the primer's 3'-most bases actually anneal (= end - start). */
  annealedLength: number;
  /** True when the ENTIRE primer anneals with ZERO mismatches/indels (a clean,
   *  full-length match); false = a 3'-anchored partial (the primer has a
   *  non-annealing 5' tail, e.g. a cloning overhang) OR an imperfect match found
   *  by the aligner (internal mismatches / a small indel). */
  fullMatch: boolean;
  // --- OPTIONAL aligner-derived detail (present on mismatch-tolerant hits) -----
  /** Template positions (forward coords) where the primer base does NOT pair with
   *  the template base in the annealed region. Empty/absent for a clean hit. */
  mismatches?: number[];
  /** Fraction of aligned columns that match, 0..1, over the annealed alignment.
   *  Absent for the exact / 3'-anchored fast path (those are 1.0 by construction). */
  identity?: number;
  /** The primer's annealed region as a gapped alignment string (5'->3' in the
   *  primer's own reading frame; '-' marks a base the template inserts). Present
   *  only on aligner hits, for the dialog's mismatch visualization. */
  alignedPrimer?: string;
  /** The template bases the primer pairs with, as a gapped alignment string lined
   *  up column-for-column with `alignedPrimer` (already oriented so identical
   *  characters are a match). Present only on aligner hits. */
  alignedTemplate?: string;
}

/** Tuning for the mismatch-tolerant aligner path in {@link findBindingSites}. */
export interface MismatchBindingOptions {
  /** Turn the aligner path on. Default true. When false, only the exact /
   *  3'-anchored fast path runs (byte-identical to the pre-aligner behaviour). */
  mismatchTolerant?: boolean;
  /** Minimum fraction of matching columns (0..1) for an aligner hit to be kept,
   *  so a junk primer does not spuriously bind. Default 0.75. */
  minIdentity?: number;
  /** Minimum annealed length (aligned columns) for an aligner hit. Default is the
   *  same adaptive floor the exact partial path uses. */
  minAlignedLength?: number;
}

/** Two IUPAC bases are compatible if their allowed-base sets overlap. We only
 *  need exact unambiguous matching for the common case, but allowing N/etc keeps
 *  ambiguity-coded templates from silently failing. */
const IUPAC_SETS: Record<string, string> = {
  A: "A", C: "C", G: "G", T: "T", U: "T",
  R: "AG", Y: "CT", S: "GC", W: "AT", K: "GT", M: "AC",
  B: "CGT", D: "AGT", H: "ACT", V: "ACG", N: "ACGT",
};
function basesMatch(a: string, b: string): boolean {
  const sa = IUPAC_SETS[a];
  const sb = IUPAC_SETS[b];
  if (!sa || !sb) return false;
  for (const ch of sa) if (sb.includes(ch)) return true;
  return false;
}

/** Count how many of the 3'-most bases of `primer` match `template` starting at
 *  template position `pos` (forward orientation, both 5'->3'). The 3' end is the
 *  primer's last base; we anchor there and walk back toward the 5' end, so a
 *  primer with a 5' tail still reports the contiguous 3' anneal length. */
function anneal3PrimeRun(primer: string, template: string, pos: number): number {
  // Align the primer's 3' end at template[pos + primer.length - 1].
  let run = 0;
  for (let k = primer.length - 1; k >= 0; k -= 1) {
    const tIdx = pos + k;
    if (tIdx < 0 || tIdx >= template.length) break;
    if (!basesMatch(primer[k], template[tIdx])) break;
    run += 1;
  }
  return run;
}

/**
 * Find where `primer` anneals on `template`, on BOTH strands.
 *
 * Forward strand: the primer sequence (5'->3') matches the template top strand
 * directly. Reverse strand: the primer matches the reverse-complement of the
 * template (i.e. it anneals to the bottom strand and extends right-to-left), so
 * we search the primer against revcomp(template) and map the hit back to forward
 * coordinates.
 *
 * Returns full-length exact matches when they exist; when `allowPartial` is set
 * and there is no full match at a position, a 3'-anchored partial match of at
 * least `minAnneal` bases is reported (this is the cloning-tail case).
 *
 * MISMATCH TOLERANCE (additive). After the exact / 3'-anchored fast path runs, an
 * aligner pass (lib/align seed-and-extend, IUPAC DNA scoring, both strands) finds
 * primers that bind with INTERNAL MISMATCHES or a small indel, reporting the
 * mismatch positions and the identity. The fast path is unchanged, so a CLEAN
 * primer's sites are byte-identical to before; aligner hits that merely re-derive
 * a site the fast path already found are dropped (no double-reporting). Weak
 * aligner hits are gated by `minIdentity` / `minAlignedLength` so junk does not
 * flood. Pass `mismatchTolerant: false` to disable the aligner pass entirely.
 *
 * Sites are de-duplicated and sorted by start, full matches before partials.
 */
export function findBindingSites(
  primer: string,
  template: string,
  opts: { allowPartial?: boolean; minAnneal?: number } & MismatchBindingOptions = {},
): BindingSite[] {
  const allowPartial = opts.allowPartial ?? true;
  const minAnneal = opts.minAnneal ?? Math.min(12, Math.max(6, Math.floor(primer.length * 0.6)));
  const p = sanitizePrimer(primer);
  const t = template.toUpperCase();
  const sites: BindingSite[] = [];
  if (p.length === 0 || t.length === 0) return sites;
  const L = p.length;

  // Scan `haystack` for the primer (3'-anchored), reporting hits via `mapBack`,
  // which converts a (window-position, annealed-length) in the haystack frame
  // into FORWARD-strand [start, end) coordinates.
  const scan = (
    haystack: string,
    mapBack: (pos: number, len: number) => { start: number; end: number },
    direction: 1 | -1,
  ) => {
    // The primer's 5' tail can hang off the haystack's left edge (a cloning
    // overhang), so the window start may be negative; anneal3PrimeRun anchors on
    // the 3' end and stops at the edge, so only in-bounds bases count.
    for (let pos = -(L - 1); pos + L <= haystack.length; pos += 1) {
      const run = anneal3PrimeRun(p, haystack, pos);
      if (run === L) {
        const { start, end } = mapBack(pos, L);
        sites.push({ start, end, direction, annealedLength: L, fullMatch: true });
      } else if (allowPartial && run >= minAnneal) {
        // 3'-anchored partial: only the 3'-most `run` bases anneal. The annealed
        // region begins `L - run` bases into the window.
        const annealStartInWindow = L - run;
        const { start, end } = mapBack(pos + annealStartInWindow, run);
        sites.push({ start, end, direction, annealedLength: run, fullMatch: false });
      }
    }
  };

  // FORWARD: primer matches template top strand directly; window position is
  // already a forward coordinate.
  scan(t, (pos: number, len: number) => ({ start: pos, end: pos + len }), 1);

  // REVERSE: the primer anneals to the bottom strand. Its sequence equals
  // revcomp(template[start..end)), so it appears as a forward substring of
  // revcomp(template). A hit covering revcomp positions [pos, pos+len) maps to
  // forward coordinates [t.length-(pos+len), t.length-pos).
  const rcT = reverseComplement(t);
  scan(
    rcT,
    (pos: number, len: number) => ({
      start: t.length - (pos + len),
      end: t.length - pos,
    }),
    -1,
  );

  // --- MISMATCH-TOLERANT aligner pass (additive) ----------------------------
  // Everything above is the exact / 3'-anchored fast path and is left untouched.
  // Now run the alignment engine to recover primers that bind with internal
  // mismatches or a small indel. Aligner hits that merely re-cover a span the
  // fast path already reported on the same strand are discarded so a site is
  // never double-reported, and the fast path's BindingSite objects win (they
  // carry no aligner fields, preserving clean-primer parity).
  const mismatchTolerant = opts.mismatchTolerant ?? true;
  if (mismatchTolerant) {
    const minIdentity = opts.minIdentity ?? 0.75;
    const minAlignedLength = opts.minAlignedLength ?? minAnneal;
    const fastHits = sites.slice(); // snapshot of the clean fast-path hits
    for (const a of alignerSites(p, t, minIdentity, minAlignedLength)) {
      const overlapsClean = fastHits.some(
        (f) => f.direction === a.direction && a.start < f.end && f.start < a.end,
      );
      if (!overlapsClean) sites.push(a);
    }
  }

  // De-dup (a palindromic primer can hit both strands at the same span).
  const seen = new Set<string>();
  const unique = sites.filter((s) => {
    const key = `${s.start}:${s.end}:${s.direction}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort(
    (a, b) => a.start - b.start || (a.fullMatch === b.fullMatch ? 0 : a.fullMatch ? -1 : 1),
  );
  return unique;
}

// IUPAC-aware DNA scoring shared with the alignment engine. A clean primer never
// reaches this pass (the fast path handles it), so the cost is only paid for
// primers the fast path could not place exactly.
const PRIMER_ALIGN_SCORING = dnaScoring({ iupac: true });

/**
 * Run the alignment engine and turn each {@link import("@/lib/align").SeedHit}
 * into a {@link BindingSite}, reporting mismatch positions (forward template
 * coords) and identity. Both strands; gated by `minIdentity` and
 * `minAlignedLength` so weak/junk hits are dropped. Forward-strand convention:
 *  - For a forward hit the aligner's query is the primer (5'->3') and `alignedA`
 *    is the forward template, so identical alignment columns are matches.
 *  - For a reverse hit the query is revcomp(primer), which reads 5'->3' in the
 *    primer's own frame and pairs base-for-base with the forward template the
 *    engine aligned it to, so the same column-equality rule gives matches and the
 *    displayed strings are already lined up.
 */
function alignerSites(
  primer: string,
  template: string,
  minIdentity: number,
  minAlignedLength: number,
): BindingSite[] {
  if (primer.length === 0 || template.length === 0) return [];
  const hits = seedAndExtend(primer, template, {
    scoring: PRIMER_ALIGN_SCORING,
    mode: "semiGlobal",
    bothStrands: true,
  });
  const out: BindingSite[] = [];
  for (const hit of hits) {
    const { alignment } = hit;
    const alignedPrimer = alignment.alignedB; // query in the primer's 5'->3' frame
    const alignedTemplate = alignment.alignedA; // forward template under it
    const alignedLength = alignment.ops.length;
    if (alignedLength < minAlignedLength) continue;
    if (alignment.identity < minIdentity) continue;

    // Walk the alignment columns to map mismatches to FORWARD template positions.
    // 'M' = match, 'X' = mismatch, 'I' = base in template not in primer (the
    // template column advances, primer does not), 'D' = base in primer not in
    // template (primer column advances, template does not). targetStart is the
    // forward template coordinate of the first aligned template base.
    const mismatches: number[] = [];
    let tPos = hit.targetStart;
    for (const op of alignment.ops) {
      if (op === "X") {
        mismatches.push(tPos);
        tPos += 1;
      } else if (op === "M") {
        tPos += 1;
      } else if (op === "I") {
        // template base with no primer base aligned: a deletion in the primer.
        mismatches.push(tPos);
        tPos += 1;
      } // 'D': primer base with a template gap; no forward template position moves.
    }

    const annealedLength = hit.targetEnd - hit.targetStart;
    out.push({
      start: hit.targetStart,
      end: hit.targetEnd,
      direction: hit.strand,
      annealedLength,
      // Aligner hits are imperfect by definition here (the fast path already took
      // every clean span), so fullMatch stays false. mismatches/indels live in
      // the optional fields.
      fullMatch: false,
      mismatches,
      identity: alignment.identity,
      alignedPrimer,
      alignedTemplate,
    });
  }
  return out;
}
