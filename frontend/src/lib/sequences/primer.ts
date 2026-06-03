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

/** GC% (0-100) of a primer/oligo string. Counts G/C/S over the unambiguous +
 *  S/W bases; non-base characters are excluded from the denominator. Mirrors the
 *  convention in edit-model.gcPercent so the two never disagree. */
export function gcContent(seq: string): number {
  const s = seq.toUpperCase();
  let gc = 0;
  let counted = 0;
  for (const ch of s) {
    if (ch === "A" || ch === "T" || ch === "U" || ch === "G" || ch === "C" || ch === "S" || ch === "W") {
      counted += 1;
      if (ch === "G" || ch === "C" || ch === "S") gc += 1;
    }
  }
  if (counted === 0) return 0;
  return (gc / counted) * 100;
}

/** Keep only A/C/G/T/U (uppercased), dropping whitespace/numbers/other. Used to
 *  sanitize a typed/pasted primer before any biology runs on it. */
export function sanitizePrimer(raw: string): string {
  return raw.toUpperCase().replace(/[^ACGTU]/g, "");
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
 * Returns NaN for an empty/degenerate oligo.
 */
export function tmBasic(seq: string): number {
  const s = sanitizePrimer(seq);
  const n = s.length;
  if (n === 0) return NaN;
  let gc = 0;
  for (const ch of s) if (ch === "G" || ch === "C") gc += 1;
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
 * Falls back to the basic formula for oligos < 8 nt or with non-ACGT bases (the
 * NN model and its dinucleotide table only cover unambiguous DNA >= 2 nt; we cap
 * the fallback at < 8 nt so short oligos keep their familiar Wallace estimate).
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
  /** True when the ENTIRE primer anneals (full-length match); false = 3'-anchored
   *  partial (the primer has a non-annealing 5' tail, e.g. a cloning overhang). */
  fullMatch: boolean;
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
 * Sites are de-duplicated and sorted by start, full matches before partials.
 */
export function findBindingSites(
  primer: string,
  template: string,
  opts: { allowPartial?: boolean; minAnneal?: number } = {},
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
