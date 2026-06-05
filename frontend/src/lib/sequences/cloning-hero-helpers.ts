// sequence editor master (Phase B). Pure, presentation-free helpers behind the
// four cloning hero modules. The heroes stay pure-presentational; the fiddly or
// safety-relevant logic (Tm grading, fusion-site uniqueness, sticky-end seam
// geometry, the internal-site proxy) lives here where it is unit-tested.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { LigationProduct, DsPiece } from "./cut-ligate";

// --- Overlap: Tm grading -----------------------------------------------------

export type TmGrade = "strong" | "marginal" | "weak";

/** Grade a Gibson overlap Tm against the reaction anneal temperature. Green at or
 *  above the anneal temp (the overlap holds at the reaction temperature), amber
 *  within 5 C below (marginal), red more than 5 C below (too weak to anneal
 *  reliably). NaN (no overlap formed) grades as weak. */
export function gradeOverlapTm(tm: number, annealTargetTm: number): TmGrade {
  if (!Number.isFinite(tm)) return "weak";
  if (tm >= annealTargetTm) return "strong";
  if (tm >= annealTargetTm - 5) return "marginal";
  return "weak";
}

// --- Golden Gate: fusion-site uniqueness -------------------------------------

/** A duplicate clash between two junctions that ended up with the same fusion
 *  overhang (the Golden Gate order is then ambiguous). 0-based junction indices,
 *  `a < b`. */
export interface OverhangClash {
  a: number;
  b: number;
  overhang: string;
}

export interface FusionUniqueness {
  /** True when every NON-BLUNT fusion overhang is distinct (after collapsing each
   *  to its strand-canonical form). Blunt seams ("") are ignored: they carry no
   *  programmed specificity, so they cannot disambiguate order and are not
   *  counted as clashes. */
  unique: boolean;
  /** Every pair of junctions that share an overhang. Empty when `unique`. */
  clashes: OverhangClash[];
}

/** Collapse an overhang to a strand-canonical key so a seam and its reverse
 *  complement count as the same fusion site. The engine already canonicalizes
 *  junctionOverhangs, but we re-canonicalize defensively so the check is correct
 *  on any overhang list (e.g. raw seams). */
function canonOverhang(oh: string): string {
  const up = oh.toUpperCase();
  const comp: Record<string, string> = { A: "T", T: "A", G: "C", C: "G" };
  let rc = "";
  for (let i = up.length - 1; i >= 0; i -= 1) rc += comp[up[i]] ?? up[i];
  return up <= rc ? up : rc;
}

/** Check that the set of fusion overhangs is unambiguous (all distinct). Pure;
 *  the defining Golden Gate concern, so it is unit-tested directly. */
export function checkFusionUniqueness(overhangs: string[]): FusionUniqueness {
  const clashes: OverhangClash[] = [];
  for (let i = 0; i < overhangs.length; i += 1) {
    const oi = overhangs[i];
    if (oi === "") continue; // blunt: no programmed specificity
    const ci = canonOverhang(oi);
    for (let j = i + 1; j < overhangs.length; j += 1) {
      const oj = overhangs[j];
      if (oj === "") continue;
      if (canonOverhang(oj) === ci) {
        clashes.push({ a: i, b: j, overhang: oi });
      }
    }
  }
  return { unique: clashes.length === 0, clashes };
}

// --- Restriction: internal-site proxy ----------------------------------------

/** A source fragment that yielded more pieces than a clean single linearization,
 *  the proxy for "the enzyme also cut INSIDE this fragment". For a circular input
 *  one expected cut linearizes it (1 piece); a second cut yields 2 pieces, so any
 *  fragment contributing more than the baseline is flagged. We report the raw
 *  piece count and let the hero phrase the warning. */
export interface InternalSiteFlag {
  sourceName: string;
  pieces: number;
}

/** Count pieces per source fragment from the kept-pieces list and flag any
 *  fragment that yielded more than one piece (the cheaper proxy for an internal
 *  cut, used until findCuts exposes positions). A fragment cut once (its single
 *  intended site) yields exactly one kept linear piece; two or more pieces mean
 *  the enzyme cut it more than once. Pure. */
export function internalSiteFlags(pieces: Pick<DsPiece, "sourceName">[]): InternalSiteFlag[] {
  const counts = new Map<string, number>();
  for (const p of pieces) {
    counts.set(p.sourceName, (counts.get(p.sourceName) ?? 0) + 1);
  }
  const flags: InternalSiteFlag[] = [];
  for (const [sourceName, n] of counts) {
    if (n > 1) flags.push({ sourceName, pieces: n });
  }
  return flags;
}

// --- Restriction: sticky-end seam geometry -----------------------------------

/** The two offset strands of one sticky-end seam, ready for monospace rendering.
 *  `top` and `bottom` are equal-length, position-aligned strings; a space marks a
 *  recessed (unpaired-gap) position and a base marks a protruding or paired
 *  position. The duplex flanks are drawn as paired "=" context on both strands so
 *  the seam reads as a duplex rather than a lone overhang. The single-stranded
 *  overhang sits where exactly one strand carries a base and the other a space. */
export interface StickyEndSeam {
  kind: "blunt" | "5'" | "3'";
  overhang: string;
  /** Top strand, written 5'->3'. */
  top: string;
  /** Bottom strand, written 3'->5' so it pairs column-for-column with `top`. */
  bottom: string;
}

const COMP: Record<string, string> = { A: "T", T: "A", G: "C", C: "G", N: "N" };
function complement(s: string): string {
  let out = "";
  for (const c of s.toUpperCase()) out += COMP[c] ?? c;
  return out;
}

/** Build the staggered top/bottom strands for one junction's overhang. The seam
 *  is drawn as: left duplex flank, the single-stranded overhang region, right
 *  duplex flank. For a 5' overhang the TOP strand carries the protruding bases
 *  (bottom is a gap there); for a 3' overhang the BOTTOM strand carries them (top
 *  is a gap there). Blunt seams render flush. `flank` paired bases of "=" context
 *  pad each side. Pure geometry; the only inputs are the overhang + its kind. */
export function stickyEndSeam(
  kind: "blunt" | "5'" | "3'",
  overhang: string,
  flank = 2,
): StickyEndSeam {
  const oh = overhang.toUpperCase();
  const pad = "=".repeat(Math.max(0, flank));
  if (kind === "blunt" || oh.length === 0) {
    return { kind: "blunt", overhang: "", top: `${pad}${pad}`, bottom: `${pad}${pad}` };
  }
  const gap = " ".repeat(oh.length);
  const ohComp = complement(oh);
  if (kind === "5'") {
    // 5' overhang: top strand protrudes (carries the bases); bottom is recessed.
    return {
      kind,
      overhang: oh,
      top: `${pad}${oh}${pad}`,
      bottom: `${pad}${gap}${pad}`,
    };
  }
  // 3' overhang: bottom strand carries the protruding bases (its complement);
  // the top strand is the recessed gap at the overhang region.
  return {
    kind,
    overhang: oh,
    top: `${pad}${gap}${pad}`,
    bottom: `${pad}${ohComp}${pad}`,
  };
}
