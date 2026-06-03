// sequence Phase 2e bot — PURE primer biology (SnapGene "Add Primer" parity).
//
// Self-contained string/complement math + Tm. Nothing here imports SeqViz or
// lib/calculators/** (the lab-calculators arc owns its own NN-Tm and is in flux;
// see the report note about unifying later). The Tm here is OUR implementation.
//
// Coordinates: a binding SITE is reported as 0-based [start, end) on the FORWARD
// (top) strand, regardless of which strand the primer anneals to. `direction`
// records the strand the primer's 3' end extends along (1 = forward, -1 = reverse),
// which is what SeqViz's `primers` prop wants and what a primer_bind feature's
// strand encodes.

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

// SantaLucia 1998 unified nearest-neighbor parameters.
// dH in kcal/mol, dS in cal/(K·mol), keyed by the 5'->3' dinucleotide.
const NN_DH: Record<string, number> = {
  AA: -7.9, AT: -7.2, AC: -8.4, AG: -7.8,
  TA: -7.2, TT: -7.9, TC: -8.2, TG: -8.5,
  CA: -8.5, CT: -7.8, CC: -8.0, CG: -10.6,
  GA: -8.2, GT: -8.4, GC: -9.8, GG: -8.0,
};
const NN_DS: Record<string, number> = {
  AA: -22.2, AT: -20.4, AC: -22.4, AG: -21.0,
  TA: -21.3, TT: -22.2, TC: -22.2, TG: -22.7,
  CA: -22.7, CT: -21.0, CC: -19.9, CG: -27.2,
  GA: -22.2, GT: -22.4, GC: -24.4, GG: -19.9,
};

/**
 * NEAREST-NEIGHBOR Tm (SantaLucia 1998), salt-adjusted (Owczarzy-style simple
 * correction via the standard 16.6*log10([Na+]) term). Returns the Tm in °C.
 *
 * @param seq      primer sequence (T/U accepted; U treated as T)
 * @param oligoMolarity  total strand concentration in mol/L (default 0.25 µM, the
 *                       SnapGene-ish default for the lower-strand-in-excess case;
 *                       we use the symmetric CT/4 term)
 * @param naMolarity     monovalent cation in mol/L (default 50 mM)
 *
 * Falls back to the basic formula for oligos < 8 nt or with non-ACGT bases (the
 * NN tables only cover unambiguous DNA dinucleotides).
 */
export function tmNearestNeighbor(
  seq: string,
  oligoMolarity = 0.25e-6,
  naMolarity = 0.05,
): number {
  const s = sanitizePrimer(seq).replace(/U/g, "T");
  const n = s.length;
  if (n < 8 || /[^ACGT]/.test(s)) return tmBasic(seq);

  // Initiation terms (SantaLucia 1998 unified): a fixed initiation plus an
  // end-penalty for terminal A·T pairs (5' and 3').
  let dH = 0.2; // kcal/mol initiation (with terminal G·C handled below)
  let dS = -5.7; // cal/(K·mol) initiation
  // Terminal penalties: G·C init dH +0.2/dS -5.7 already applied; add A·T ends.
  const ends = [s[0], s[n - 1]];
  for (const e of ends) {
    if (e === "A" || e === "T") {
      dH += 2.2;
      dS += 6.9;
    }
  }

  for (let i = 0; i < n - 1; i += 1) {
    const pair = s.slice(i, i + 2);
    dH += NN_DH[pair];
    dS += NN_DS[pair];
  }

  const R = 1.987; // cal/(K·mol)
  // Symmetric duplex correction: CT/4 for non-self-complementary primers.
  const ct = oligoMolarity / 4;
  // Tm in Kelvin: dH*1000 / (dS + R*ln(CT/4)), then to Celsius.
  const tmK = (dH * 1000) / (dS + R * Math.log(ct));
  let tmC = tmK - 273.15;
  // Salt correction (SantaLucia 1998): +16.6 * log10([Na+] / 1.0) relative to 1 M.
  tmC += 16.6 * Math.log10(naMolarity);
  return tmC;
}

/** Default Tm used by the dialog: nearest-neighbor when applicable, else basic. */
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
