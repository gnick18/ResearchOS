// degenerate-codon bot — shared IUPAC degenerate-codon resolution for the two
// DNA/RNA -> protein translation paths (seqviz `translate` and `translateFrame1`).
//
// Both translators carry only the 64 EXACT codons. A codon that contains any
// IUPAC ambiguity base (N, R, Y, ...) is not a key in those tables, so before
// this module it gapped out. NEW behavior (matching Biopython Seq.translate /
// EMBOSS): expand the ambiguous codon to every concrete codon it represents,
// translate each through the SAME 64-codon table, and:
//   - if every concrete codon yields the SAME single residue, emit that residue
//     (GGN -> all four are Gly -> "G"; CTN -> Leu -> "L"; YTR -> Leu -> "L"),
//   - otherwise emit the gap glyph "X" (GAN -> Asp+Glu -> "X";
//     MGN -> Arg+Ser -> "X").
//
// This is parameterized by the caller's codon map so each translation path
// keeps its own exact table; the resolution logic is shared so the two paths
// stay consistent. Pure, no React, no UI.

/** The single untranslatable / ambiguous-residue glyph, unified across paths. */
export const GAP_GLYPH = "X";

// IUPAC nucleotide codes -> the concrete bases (A/C/G/T) each represents.
// DNA alphabet (U is normalized to T by callers before resolution).
const IUPAC_BASES: Record<string, string[]> = {
  A: ["A"],
  C: ["C"],
  G: ["G"],
  T: ["T"],
  R: ["A", "G"],
  Y: ["C", "T"],
  S: ["G", "C"],
  W: ["A", "T"],
  K: ["G", "T"],
  M: ["A", "C"],
  B: ["C", "G", "T"],
  D: ["A", "G", "T"],
  H: ["A", "C", "T"],
  V: ["A", "C", "G"],
  N: ["A", "C", "G", "T"],
};

// Memoize per-codon resolution. The codon space is tiny (<= 15^3) and the same
// map object is reused, so a per-map cache keyed by the codon string is cheap
// and keeps the hot translate loop allocation-free after warmup.
const resolveCache = new WeakMap<Record<string, string>, Map<string, string>>();

/**
 * Resolve a single 3-letter codon (already uppercased, U->T normalized) to one
 * amino-acid character using `codonMap` (a 64-exact-codon table whose values
 * are single residues or "*" for stop).
 *
 * Returns:
 *   - the exact residue when the codon is already one of the 64,
 *   - the resolved residue when every IUPAC expansion agrees on one residue,
 *   - GAP_GLYPH ("X") when expansions disagree or any base is unrecognized.
 *
 * Stop "*" is treated as any other residue: a codon resolving uniformly to a
 * stop yields "*"; a codon mixing stop with a coding residue yields "X".
 */
export function resolveCodon(codon: string, codonMap: Record<string, string>): string {
  // Fast path: an exact codon already in the table.
  const exact = codonMap[codon];
  if (exact !== undefined) {
    return exact;
  }

  let cache = resolveCache.get(codonMap);
  if (!cache) {
    cache = new Map<string, string>();
    resolveCache.set(codonMap, cache);
  }
  const cached = cache.get(codon);
  if (cached !== undefined) {
    return cached;
  }

  const result = computeResolution(codon, codonMap);
  cache.set(codon, result);
  return result;
}

function computeResolution(codon: string, codonMap: Record<string, string>): string {
  if (codon.length !== 3) {
    return GAP_GLYPH;
  }

  const p0 = IUPAC_BASES[codon[0]];
  const p1 = IUPAC_BASES[codon[1]];
  const p2 = IUPAC_BASES[codon[2]];
  // Any unrecognized character (gap ".", space, off-alphabet) -> gap.
  if (!p0 || !p1 || !p2) {
    return GAP_GLYPH;
  }

  let residue: string | null = null;
  for (const a of p0) {
    for (const b of p1) {
      for (const c of p2) {
        const aa = codonMap[a + b + c];
        // A concrete codon missing from the table should never happen for a
        // complete 64-codon map, but guard anyway: treat as a disagreement.
        if (aa === undefined) {
          return GAP_GLYPH;
        }
        if (residue === null) {
          residue = aa;
        } else if (residue !== aa) {
          return GAP_GLYPH;
        }
      }
    }
  }
  return residue ?? GAP_GLYPH;
}
