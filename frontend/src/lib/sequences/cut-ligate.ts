// cloning bot — PURE in-silico CUT-AND-LIGATE engine (restriction-ligation +
// Golden Gate / Type IIS assembly).
//
// This is the second correctness core of the cloning workspace, alongside the
// overlap (Gibson) engine in cloning.ts. A wrong ligation product is a real
// molecular-biology bug, so EVERYTHING here is pure, deterministic, DOM-free,
// and cross-validated against the independent pydna simulator
// (frontend/scripts/gen-cloning-golden.py -> cut-ligate.golden.test.ts).
//
// THE BIOLOGY
// ===========
// A restriction enzyme cuts double-stranded DNA at a defined position on each
// strand. When the top-strand cut and bottom-strand cut are offset, the cut
// leaves a single-stranded OVERHANG ("sticky end"); when they coincide it is a
// BLUNT end. Two fragment ends LIGATE only if their overhangs are COMPLEMENTARY
// and the same length (blunt ligates to blunt). DNA ligase then seals both
// strands and the overhang sequence appears EXACTLY ONCE in the product, as the
// seam between the two fragments.
//
// We model an end as one of:
//   - blunt:            no overhang.
//   - 5' overhang:      the recessed 3' strand; the protruding 5' single strand
//                       is read 5'->3' on the TOP strand of the downstream piece.
//   - 3' overhang:      the protruding 3' single strand.
// Two ends are LIGATABLE when their overhang types are opposite-facing and the
// overhang sequences are reverse-complementary (i.e. they base-pair). We encode
// each end by a canonical "sticky key" so that two ligatable ends share a key.
//
// CUT GEOMETRY (reuses the vendored SeqViz dataset convention)
// ------------------------------------------------------------
// Each enzyme stores `rseq` (recognition), `fcut` (TOP-strand cut offset, bases
// left of the bond, from the recognition-site start) and `rcut` (BOTTOM-strand
// cut offset, from the recognition-site start, measured on the top-strand
// coordinate of the bottom-strand bond). For a site starting at 0-based index i:
//     topCut    = i + fcut          (bond on the top strand, bases-left count)
//     bottomCut = i + rcut          (bond on the bottom strand, top coordinate)
// The region [min(topCut,bottomCut), max(topCut,bottomCut)) is the single-stranded
// overhang. If topCut < bottomCut the downstream piece bears a 5' overhang; if
// topCut > bottomCut it bears a 3' overhang; equal => blunt. This is precisely
// SeqViz's digest.ts convention, verified against pydna's Bio.Restriction cut
// positions in the golden generator.
//
// TYPE IIS / GOLDEN GATE
// ----------------------
// Type IIS enzymes (BsaI GGTCTC(1/5), BsmBI/Esp3I CGTCTC(1/5), BbsI GAAGAC(2/6),
// SapI GCTCTTC(1/4)) cut OUTSIDE and DOWNSTREAM of their recognition site, so the
// recognition sequence ends up on a flanking piece that is DISCARDED, and the
// central part keeps two custom 4-nt (or 3-nt for SapI) overhangs with NO scar.
// Golden Gate assembly = digest every part with one Type IIS enzyme, drop the
// recognition-bearing flanks, and ligate the central parts by their unique
// overhangs into a seamless circle. Our engine treats this as the same
// cut-then-ligate pipeline as restriction-ligation; the only difference is which
// pieces are kept (we keep the pieces that do NOT contain the recognition site).
//
// ORIENTATION + AMBIGUITY
// -----------------------
// A piece can ligate in EITHER orientation (it can flip, presenting its
// reverse-complement). A symmetric pair of identical overhangs (e.g. an EcoRI
// fragment with AATT on both ends) is therefore genuinely orientation-ambiguous
// and yields MORE THAN ONE product -- exactly what pydna reports. We enumerate all
// distinct circular (or linear) products, deduplicated up to circular rotation
// and strand, and return them sorted by a canonical key for determinism.
//
// FEATURE REBASING
// ----------------
// Each LigateFragment may carry CloneFeature[] annotations in the same 0-based,
// end-EXCLUSIVE [start, end) convention as the Gibson engine. When a fragment is
// digested, each resulting DsPiece records the 0-based start of its top-strand
// extent within the original fragment (sourceStart) so that features can be
// clipped and rebased into the assembled product after ligation.
//
// For a FORWARD (non-flipped) piece the feature clip window is
//   [sourceStart, sourceStart + piece.seq.length)
// and features are shifted by (productOffset - sourceStart).
//
// For a FLIPPED (reverse-complement) piece the same clip window applies to the
// source fragment (the physical DNA being flipped is the same bases), then
// coordinates are mirrored inside the window and strand is inverted before
// shifting by productOffset.

import { reverseComplement } from "./primer";
import type { CloneFeature, FragmentSpan } from "./cloning";
import enzymes from "../../vendor/seqviz/enzymes";
import type { Enzyme } from "../../vendor/seqviz/elements";

// --- TYPES ------------------------------------------------------------------

/** One input fragment (linear or circular) to a cut-ligate assembly. */
export interface LigateFragment {
  name: string;
  /** Top-strand sequence, 5'->3'. */
  seq: string;
  /** True if this input is a circular molecule (e.g. a plasmid to be cut open). */
  circular?: boolean;
  /** Feature annotations to carry into the assembled product. 0-based,
   *  end-EXCLUSIVE [start, end) on the fragment's own top strand. */
  features?: CloneFeature[];
}

/** End geometry of a double-stranded piece. */
export type EndKind = "blunt" | "5overhang" | "3overhang";

/** One end of a digested piece. */
export interface PieceEnd {
  kind: EndKind;
  /** Overhang bases, 5'->3' on the strand that bears the overhang. "" if blunt. */
  overhang: string;
  /** True if this is an ORIGINAL terminus of the input molecule (a linear input's
   *  outer end), NOT an enzyme-generated end. pydna's restriction-ligation rule:
   *  an original end may not ligate to an enzyme-generated end, and it cannot
   *  participate in a circular product. We forbid ligation on original ends
   *  entirely (they may only be the open ends of a LINEAR product), which matches
   *  pydna's "will NOT combine an existing end with an end generated by the same
   *  enzyme" + partial-digest filtering for the standard cloning cases. */
  original?: boolean;
}

/** A double-stranded piece after digestion, with both terminal ends typed. */
export interface DsPiece {
  /** Top-strand sequence of the DUPLEX core (including any overhang bases,
   *  written as the full top strand 5'->3'). */
  seq: string;
  /** Left (5') end of the top strand. */
  left: PieceEnd;
  /** Right (3') end of the top strand. */
  right: PieceEnd;
  /** True if this piece carried a recognition site (Type IIS flank to discard). */
  hasSite: boolean;
  /** Source fragment name, for reporting. */
  sourceName: string;
  /** 0-based start of this piece's top-strand sequence within the original
   *  (cleaned) fragment's top strand. Used to clip and rebase features. */
  sourceStart: number;
}

export interface CutLigateOptions {
  /** Enzyme names (dataset keys, case-insensitive) to digest with. */
  enzymeNames: string[];
  /** "golden-gate" keeps only the central (non-recognition) pieces and ligates
   *  by their custom overhangs; "restriction" keeps every piece. */
  mode: "restriction" | "golden-gate";
  /** Only return circular products (the usual cloning goal). Default true. */
  circularOnly?: boolean;
  /** Permit blunt-end ligation (blunt ligates to any blunt). Default true. */
  allowBlunt?: boolean;
}

/** One sealed junction in an assembled product, with the seam geometry the
 *  sticky-end ladder hero draws. `overhang` is the canonical seal (same value
 *  as the matching `junctionOverhangs[i]`); `kind` is the overhang geometry of
 *  the upstream piece's end at this seam ("blunt" | "5'" | "3'"). The data comes
 *  off the `PieceEnd`s inside the ligation chain; this is purely a convenience
 *  surfacing of it (in-memory only, no on-disk shape). */
export interface ProductJunction {
  /** Canonical sealed overhang (top strand 5'->3'), "" if blunt. */
  overhang: string;
  /** Overhang geometry of this seam. */
  kind: "blunt" | "5'" | "3'";
}

export interface LigationProduct {
  /** Assembled product top strand, 5'->3' (canonical rotation if circular). */
  seq: string;
  circular: boolean;
  /** The ordered junction overhangs sealed to make this product (5'->3'). */
  junctionOverhangs: string[];
  /** Per-junction seam geometry (overhang + 5'/3'/blunt kind), index-aligned
   *  with `junctionOverhangs`. Additive; surfaced for the sticky-end hero. */
  junctions: ProductJunction[];
  /** Features from the input fragments, rebased into product coordinates.
   *  0-based, end-EXCLUSIVE [start, end) on the product top strand. */
  features: CloneFeature[];
  /** Where each piece used in THIS product landed, in product coordinates.
   *  One span per piece (a fragment cut into several pieces yields several
   *  spans, each a distinct contiguous run). Same coordinate frame as
   *  `features`. strand -1 means the piece went in reverse-complemented. */
  fragmentSpans: FragmentSpan[];
}

export interface CutLigateResult {
  products: LigationProduct[];
  /** Pieces kept for ligation (after Type IIS flank discard, if any). */
  pieces: DsPiece[];
  warnings: string[];
}

// --- SMALL PURE HELPERS -----------------------------------------------------

function cleanDna(seq: string): string {
  return seq.toUpperCase().replace(/[^ACGT]/g, "");
}

/** Resolve an enzyme name (case-insensitive) to the vendored dataset entry. */
function resolveEnzyme(name: string): Enzyme | undefined {
  return (enzymes as Record<string, Enzyme>)[name.toLowerCase()];
}

/**
 * The concrete recognition site of a named enzyme, for use as a 5' primer
 * overhang (a restriction-site tail so the amplicon can be cut and cloned). The
 * site bases come from the SAME vendored dataset the digest engine cuts with,
 * never from a caller, so a primer overhang can never carry an invented site.
 * Returns the canonical enzyme name plus its uppercase recognition sequence, or
 * null when the enzyme is unknown OR its recognition sequence carries ambiguity
 * codes (anything other than A / C / G / T). An ambiguous site (for example
 * "RAATTY") cannot be written as concrete primer bases, so it is refused rather
 * than guessed. Pure.
 */
export function enzymeSiteForPrimer(
  name: string,
): { name: string; site: string } | null {
  const e = resolveEnzyme(name);
  if (!e) return null;
  const site = e.rseq.toUpperCase();
  if (!/^[ACGT]+$/.test(site)) return null;
  return { name: e.name, site };
}

/**
 * Canonical rotation of a circular top-strand sequence: the lexicographically
 * smallest rotation among ALL rotations of the sequence AND of its reverse
 * complement. This makes two circular molecules that are equal up to
 * rotation/strand compare EQUAL. Documented and reused by the golden test.
 */
export function canonicalCircular(seq: string): string {
  const s = seq.toUpperCase();
  if (s.length === 0) return "";
  const rc = reverseComplement(s);
  let best: string | null = null;
  for (const base of [s, rc]) {
    const doubled = base + base;
    for (let i = 0; i < base.length; i += 1) {
      const rot = doubled.slice(i, i + base.length);
      if (best === null || rot < best) best = rot;
    }
  }
  return best as string;
}

/**
 * Canonical form of a LINEAR top-strand sequence up to strand choice: the
 * lexicographically smaller of the sequence and its reverse complement.
 */
export function canonicalLinear(seq: string): string {
  const s = seq.toUpperCase();
  const rc = reverseComplement(s);
  return s <= rc ? s : rc;
}

// --- DIGESTION --------------------------------------------------------------

/** A single double-stranded cut on a (possibly circular) sequence. */
interface Cut {
  /** Top-strand bond position (bases-left count), 0..len. */
  topCut: number;
  /** Bottom-strand bond position in top-strand coordinates, 0..len. */
  bottomCut: number;
  /** True if the recognition site lies UPSTREAM of the cut on the kept piece
   *  (used to flag Type IIS flanks). We instead flag per-piece site presence by
   *  scanning, so this carries the recognition span for reference. */
  siteStart: number;
  siteEnd: number;
}

/**
 * Find every double-stranded cut an enzyme set makes on a linear top strand.
 * Mirrors the vendored digest.ts geometry (fcut/rcut), but returns the paired
 * top+bottom bonds so we can reconstruct overhangs. Both strands are searched
 * (forward recognition and reverse-complement recognition).
 */
function findCuts(seq: string, enzymeList: Enzyme[]): Cut[] {
  const cuts: Cut[] = [];
  const n = seq.length;
  for (const enz of enzymeList) {
    const rseq = enz.rseq.toUpperCase();
    const rlen = rseq.length;
    const fwdRe = recognitionRegex(rseq);
    const rcRe = recognitionRegex(reverseComplement(rseq));
    const palindrome = rseq === reverseComplement(rseq);

    // Forward-strand recognition.
    for (let m = fwdRe.exec(seq); m; m = fwdRe.exec(seq)) {
      const i = m.index;
      const topCut = i + enz.fcut;
      const bottomCut = i + enz.rcut;
      if (topCut <= n && bottomCut <= n && topCut >= 0 && bottomCut >= 0) {
        cuts.push({ topCut, bottomCut, siteStart: i, siteEnd: i + rlen });
      }
      fwdRe.lastIndex = i + 1; // allow overlapping matches
    }
    if (palindrome) continue;
    // Reverse-strand recognition: the site sits on the bottom strand. The cut
    // bonds mirror around the site (same algebra as digest.ts):
    //   topCut    = i + rlen - rcut
    //   bottomCut = i + rlen - fcut
    for (let m = rcRe.exec(seq); m; m = rcRe.exec(seq)) {
      const i = m.index;
      const topCut = i + rlen - enz.rcut;
      const bottomCut = i + rlen - enz.fcut;
      if (topCut <= n && bottomCut <= n && topCut >= 0 && bottomCut >= 0) {
        cuts.push({ topCut, bottomCut, siteStart: i, siteEnd: i + rlen });
      }
      rcRe.lastIndex = i + 1;
    }
  }
  // Sort by the leftmost bond, dedupe identical cuts.
  const key = (c: Cut) => `${c.topCut}:${c.bottomCut}`;
  const seen = new Set<string>();
  return cuts
    .filter((c) => {
      const k = key(c);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => Math.min(a.topCut, a.bottomCut) - Math.min(b.topCut, b.bottomCut));
}

/** Build a global regex for an ambiguity-free recognition site (we only support
 *  ACGT recognition sites here; degenerate Type IIS sites are not in scope). */
function recognitionRegex(rseq: string): RegExp {
  // Translate IUPAC codes to character classes so AcuI-style sites still match,
  // though our cut-ligate enzymes (BsaI/BsmBI/BbsI/SapI/EcoRI/BamHI/...) are plain.
  const map: Record<string, string> = {
    A: "A", C: "C", G: "G", T: "T",
    R: "[AG]", Y: "[CT]", S: "[GC]", W: "[AT]", K: "[GT]", M: "[AC]",
    B: "[CGT]", D: "[AGT]", H: "[ACT]", V: "[ACG]", N: "[ACGT]",
  };
  const pattern = rseq
    .toUpperCase()
    .split("")
    .map((c) => map[c] ?? c)
    .join("");
  return new RegExp(pattern, "g");
}

/**
 * Digest one fragment into double-stranded pieces with typed ends.
 *
 * THE PIECE MODEL (one consistent rule, used for linear AND circular)
 * -------------------------------------------------------------------
 * Each double-stranded cut has a top-strand bond `topCut` and bottom-strand bond
 * `bottomCut`. Let `L=min(topCut,bottomCut)`, `R=max(topCut,bottomCut)`. The
 * single-stranded overhang of the cut is the duplex region [L, R); the kind is:
 *   - blunt        if topCut == bottomCut
 *   - 5' overhang  if topCut <  bottomCut   (downstream piece protrudes 5')
 *   - 3' overhang  if topCut >  bottomCut   (upstream piece protrudes 3')
 *
 * We define every piece's TOP STRAND to span the FULL duplex extent from the
 * opening cut's L to the next cut's R, i.e. [L_i, R_{i+1}). This includes BOTH
 * the piece's left overhang [L_i, R_i) at its 5' start AND its right overhang
 * [L_{i+1}, R_{i+1}) at its 3' end. Two ADJACENT pieces therefore physically
 * share the seam region (the downstream piece's left overhang bases equal the
 * upstream piece's right overhang region), so on join we strip the downstream
 * piece's leading `left.overhang.length` bases to keep the seam present once.
 *
 * This full-extent representation is FLIP-SYMMETRIC: the reverse complement of
 * [L_i, R_{i+1}) still carries an overhang at each end, so a flipped piece obeys
 * the same "seq includes both overhangs" invariant. Each piece carries:
 *   - left end  = the overhang of the cut that opens it (leading [L_i, R_i)).
 *   - right end = the overhang of the next cut (trailing [L_{i+1}, R_{i+1})).
 * Because a 5' overhang's protruding strand is the top strand on the downstream
 * side and the bottom strand on the upstream side, the upstream piece's right-end
 * overhang is recorded as the reverse complement of those bases (see `pairEnds`).
 *
 * sourceStart records the 0-based offset of this piece within the original
 * (cleaned) fragment sequence. Pieces from digestFragment are always in the
 * fragment's forward orientation; flipping happens later in the oriented-piece
 * layer via flip().
 */
export function digestFragment(
  frag: LigateFragment,
  enzymeList: Enzyme[],
): DsPiece[] {
  const seq = cleanDna(frag.seq);
  const n = seq.length;
  const circular = !!frag.circular;
  const cuts = findCuts(seq, enzymeList);

  if (cuts.length === 0) {
    // Uncut linear fragment = a single blunt piece. (An uncut circular molecule
    // cannot be opened, so it is returned as one blunt piece too; callers treat
    // a circular-no-site input as a no-op contributor.)
    return [
      {
        seq,
        left: { kind: "blunt", overhang: "" },
        right: { kind: "blunt", overhang: "" },
        hasSite: false,
        sourceName: frag.name,
        sourceStart: 0,
      },
    ];
  }

  // Normalise every cut to (L, R, kind), sorted by L.
  const sites = cuts
    .map((c) => ({
      L: Math.min(c.topCut, c.bottomCut),
      R: Math.max(c.topCut, c.bottomCut),
      fivePrime: c.topCut < c.bottomCut,
      blunt: c.topCut === c.bottomCut,
    }))
    .sort((a, b) => a.L - b.L);

  const overhang = (s: { L: number; R: number }) => seq.slice(s.L, s.R);
  const pieces: DsPiece[] = [];

  if (!circular) {
    // Linear: the two outer ends are blunt "original" ends with no overhang.
    // The piece top strand spans [leftCut.L, rightCut.R), so it carries each
    // sticky overhang once; outer ends start/stop at 0 / n.
    // piece 0:        [0, sites[0].R),               blunt left,  right = sites[0]
    // piece k (1..m-1): [sites[k-1].L, sites[k].R),  left = sites[k-1], right = sites[k]
    // piece m:        [sites[m-1].L, n),             left = sites[m-1], blunt right
    const m = sites.length;
    for (let k = 0; k <= m; k += 1) {
      const leftCut = k > 0 ? sites[k - 1] : null;
      const rightCut = k < m ? sites[k] : null;
      const start = leftCut ? leftCut.L : 0;
      const stop = rightCut ? rightCut.R : n;
      const body = seq.slice(start, stop);
      pieces.push({
        seq: body,
        left: leftCut
          ? pairEnds(leftCut, overhang(leftCut)).downstream
          : { kind: "blunt", overhang: "", original: true },
        right: rightCut
          ? pairEnds(rightCut, overhang(rightCut)).upstream
          : { kind: "blunt", overhang: "", original: true },
        hasSite: false,
        sourceName: frag.name,
        sourceStart: start,
      });
    }
  } else {
    // Circular: m cuts => m pieces, each spanning [sites[k].L, sites[k+1].R)
    // (wrapping the origin for the last). Every piece has a sticky end on both
    // sides; no blunt original ends exist.
    const m = sites.length;
    for (let k = 0; k < m; k += 1) {
      const cur = sites[k];
      const nxt = sites[(k + 1) % m];
      // Extent cur.L .. nxt.R on the circle (top strand). nxt.R may wrap past n.
      let body: string;
      let start: number;
      if (nxt.R <= cur.L) {
        // wrap: cur.L .. n .. nxt.R
        body = seq.slice(cur.L) + seq.slice(0, nxt.R);
        start = cur.L;
      } else if (cur.L < nxt.L) {
        body = seq.slice(cur.L, nxt.R);
        start = cur.L;
      } else {
        // single-cut circle (m === 1): the whole molecule re-linearised at the cut.
        body = seq.slice(cur.L) + seq.slice(0, nxt.R);
        start = cur.L;
      }
      pieces.push({
        seq: body,
        left: pairEnds(cur, overhang(cur)).downstream,
        right: pairEnds(nxt, overhang(nxt)).upstream,
        hasSite: false,
        sourceName: frag.name,
        sourceStart: start,
      });
    }
  }

  // Flag pieces that still contain a recognition site (Type IIS flanks to drop).
  for (const p of pieces) {
    p.hasSite = enzymeList.some((enz) => {
      const rs = enz.rseq.toUpperCase();
      return recognitionRegex(rs).test(p.seq) || recognitionRegex(reverseComplement(rs)).test(p.seq);
    });
  }
  return pieces.filter((p) => p.seq.length > 0 || p.left.overhang || p.right.overhang);
}

/**
 * Given a cut (L,R,kind) and the duplex overhang bases [L,R) (top strand 5'->3'),
 * produce the two PieceEnd objects this cut creates:
 *   - `downstream`: the LEFT end of the piece to the right of the cut.
 *   - `upstream`:   the RIGHT end of the piece to the left of the cut.
 * Overhang sequences are recorded as the single-stranded bases read 5'->3' on the
 * protruding strand, so two ends that base-pair are reverse complements.
 */
function pairEnds(
  cut: { fivePrime: boolean; blunt: boolean },
  ohBases: string,
): { downstream: PieceEnd; upstream: PieceEnd } {
  if (cut.blunt) {
    return { downstream: { kind: "blunt", overhang: "" }, upstream: { kind: "blunt", overhang: "" } };
  }
  if (cut.fivePrime) {
    // 5' overhang. The protruding strand on the DOWNSTREAM piece is the TOP strand
    // [L,R) read 5'->3' = ohBases. On the UPSTREAM piece the protruding strand is
    // the BOTTOM strand of [L,R), read 5'->3' = revcomp(ohBases).
    return {
      downstream: { kind: "5overhang", overhang: ohBases },
      upstream: { kind: "5overhang", overhang: reverseComplement(ohBases) },
    };
  }
  // 3' overhang. The protruding 3' strand on the UPSTREAM piece is the TOP strand
  // [L,R) read 5'->3' = ohBases (it dangles off the 3' end). The DOWNSTREAM piece
  // protrudes its bottom strand = revcomp(ohBases).
  return {
    upstream: { kind: "3overhang", overhang: ohBases },
    downstream: { kind: "3overhang", overhang: reverseComplement(ohBases) },
  };
}

// --- LIGATION ---------------------------------------------------------------

/**
 * Two ends ligate when their overhangs base-pair: a 5' overhang ligates to a 5'
 * overhang whose sequence is the reverse complement (the protruding strands
 * anneal); same for 3' overhangs; blunt ligates to blunt (if allowed). Returns
 * the sealed overhang (the top-strand seam, 5'->3') if ligatable, else null.
 */
function ligationSeam(a: PieceEnd, b: PieceEnd, allowBlunt: boolean): string | null {
  // An ORIGINAL terminus (uncut input end) is not enzyme-generated and never
  // ligates (pydna convention); it may only be an open end of a LINEAR product.
  if (a.original || b.original) return null;
  if (a.kind === "blunt" && b.kind === "blunt") return allowBlunt ? "" : null;
  if (a.kind !== b.kind) return null;
  if (a.overhang.length === 0 || a.overhang.length !== b.overhang.length) return null;
  // The two protruding single strands anneal iff one is the reverse complement
  // of the other.
  if (reverseComplement(a.overhang) === b.overhang) {
    // The sealed seam (top strand) is `a.overhang` for a 5' overhang on a's right
    // end meeting b's left end; we return it normalised to a.overhang.
    return a.kind === "5overhang" ? a.overhang : reverseComplement(a.overhang);
  }
  return null;
}

/** A piece in a chosen orientation: top strand + its two ends (left/right). */
interface OrientedPiece {
  seq: string;
  left: PieceEnd;
  right: PieceEnd;
  pieceIndex: number;
  flipped: boolean;
}

/** Flip a piece to present its reverse complement (ends swap + revcomp). */
function flip(p: DsPiece, idx: number): OrientedPiece {
  return {
    seq: reverseComplement(p.seq),
    left: flipEnd(p.right),
    right: flipEnd(p.left),
    pieceIndex: idx,
    flipped: true,
  };
}
function forward(p: DsPiece, idx: number): OrientedPiece {
  return { seq: p.seq, left: p.left, right: p.right, pieceIndex: idx, flipped: false };
}
/** When a piece flips, each end keeps its overhang kind but the overhang string
 *  is read on the other strand => reverse complement; 5'/3' kind is preserved
 *  because flipping the duplex turns a 5' overhang at one end into a 5' overhang
 *  at the other end (the protruding strand stays 5'). */
function flipEnd(e: PieceEnd): PieceEnd {
  if (e.kind === "blunt") return { kind: "blunt", overhang: "", original: e.original };
  return { kind: e.kind, overhang: reverseComplement(e.overhang), original: e.original };
}

/**
 * Clip and rebase features from a source piece into product coordinates.
 *
 * sourceStart and pieceLen define the piece's extent in the original fragment
 * (always in the forward/unflipped orientation; the DsPiece.seq.length).
 * productOffset is where the first base of the DsPiece.seq maps to in the
 * pre-canonical product string (for the circular case this may be negative for
 * piece 0, reflecting the rotation strip).
 *
 * Forward piece: product_pos = sourceCoord - sourceStart + productOffset.
 * Flipped piece: mirror within the window, flip strand, then add productOffset.
 */
function rebasePieceFeatures(
  srcFeatures: CloneFeature[],
  sourceStart: number,
  pieceLen: number,
  productOffset: number,
  flipped: boolean,
): CloneFeature[] {
  const windowStart = sourceStart;
  const windowEnd = sourceStart + pieceLen;
  const out: CloneFeature[] = [];
  for (const f of srcFeatures) {
    const clStart = Math.max(f.start, windowStart);
    const clEnd = Math.min(f.end, windowEnd);
    if (clEnd <= clStart) continue;
    if (!flipped) {
      // Shift so that windowStart maps to productOffset.
      out.push({
        ...f,
        start: clStart - windowStart + productOffset,
        end: clEnd - windowStart + productOffset,
      });
    } else {
      // Mirror within the window (windowEnd - coord) and flip strand.
      const mirStart = windowEnd - clEnd;
      const mirEnd = windowEnd - clStart;
      out.push({
        ...f,
        start: mirStart + productOffset,
        end: mirEnd + productOffset,
        strand: f.strand === 1 ? -1 : 1,
      });
    }
  }
  return out;
}

/**
 * Assemble pieces by ligation. Enumerates orderings/orientations of the pieces
 * that form a consistent chain (each adjacent pair ligatable) and, for circular
 * products, also close the loop. Deduplicates products up to rotation/strand.
 *
 * Combinatorial but bounded: cloning assemblies use a handful of pieces. We cap
 * the piece count to keep this deterministic and fast.
 *
 * fragmentFeatureMap maps sourceName -> CloneFeature[] for rebasing annotations
 * from the input fragments into the assembled product.
 */
export function ligate(
  pieces: DsPiece[],
  opts: { circularOnly: boolean; allowBlunt: boolean },
  fragmentFeatureMap?: Map<string, CloneFeature[]>,
): LigationProduct[] {
  const MAX_PIECES = 8;
  if (pieces.length === 0 || pieces.length > MAX_PIECES) return [];

  const featureMap = fragmentFeatureMap ?? new Map<string, CloneFeature[]>();
  const products = new Map<string, LigationProduct>();

  // Build the product top strand from an ordered chain of oriented pieces. Each
  // piece `seq` spans its FULL duplex extent and so includes BOTH its left and
  // right overhang bases. Two adjacent pieces physically share the seam region
  // (the upstream piece's trailing overhang == the downstream piece's leading
  // overhang), so on each join we strip the downstream piece's leading
  // `left.overhang.length` bases to keep the seam present exactly once. For a
  // circular product the closing seam likewise duplicates the first piece's lead,
  // which we strip from the front after the loop.
  function joinChain(chain: OrientedPiece[], circular: boolean): LigationProduct | null {
    const seams: string[] = [];
    for (let i = 0; i < chain.length - 1; i += 1) {
      const seam = ligationSeam(chain[i].right, chain[i + 1].left, opts.allowBlunt);
      if (seam === null) return null;
      seams.push(seam);
    }
    let closeSeam = "";
    if (circular) {
      const seam = ligationSeam(chain[chain.length - 1].right, chain[0].left, opts.allowBlunt);
      if (seam === null) return null;
      closeSeam = seam;
    }
    let out = chain[0].seq;
    for (let i = 1; i < chain.length; i += 1) {
      const lead = chain[i].left.overhang.length;
      out += chain[i].seq.slice(lead);
    }
    if (circular) {
      const lead = chain[0].left.overhang.length;
      out = out.slice(lead);
    }

    // Rebase features from each piece into product coordinates.
    // For a circular product, `out` has already had the first piece's leading
    // overhang (circularLeadStrip bases) removed from its front. The product
    // offset of piece i's DsPiece.seq[0] in `out` is:
    //   sum of previous contributions - circularLeadStrip.
    // Each piece contributes (seq.length - leadOverhang) NEW bases after its
    // leading overhang (which was already in the previous piece's tail).
    const circularLeadStrip = circular ? chain[0].left.overhang.length : 0;
    const allFeatures: CloneFeature[] = [];
    // One span per piece (its contiguous run in the product, same coordinate
    // frame as the rebased features). The shared seam overhang is attributed to
    // the UPSTREAM piece so the spans tile without overlapping.
    const spans: FragmentSpan[] = [];
    let runningOffset = 0; // position of piece[i].seq[0] in the pre-strip concat
    for (let i = 0; i < chain.length; i += 1) {
      const op = chain[i];
      const srcPiece = pieces[op.pieceIndex];
      const leadOverhang = i === 0 ? 0 : op.left.overhang.length;
      // productOffset: where srcPiece.seq[0] maps in the final `out` string.
      // For piece 0: runningOffset (=0) - circularLeadStrip.
      // For piece i>0: runningOffset is already past the leading overhangs of
      // earlier pieces; subtract circularLeadStrip for the circular strip.
      const productOffset = runningOffset - circularLeadStrip;
      const srcFeatures = featureMap.get(srcPiece.sourceName) ?? [];
      if (srcFeatures.length > 0) {
        const rebased = rebasePieceFeatures(
          srcFeatures,
          srcPiece.sourceStart,
          srcPiece.seq.length,
          productOffset,
          op.flipped,
        );
        allFeatures.push(...rebased);
      }
      // The piece's NEW bases start after its shared leading overhang.
      spans.push({
        name: srcPiece.sourceName,
        start: productOffset + leadOverhang,
        end: productOffset + op.seq.length,
        strand: op.flipped ? -1 : 1,
      });
      // Advance: piece i contributes its full seq.length to runningOffset.
      // The next piece will strip its own leadOverhang.
      runningOffset += op.seq.length - leadOverhang;
    }

    // A sticky overhang's sequence is strand-relative (the seam can be read on
    // either strand depending on which way the chain was anchored). To report a
    // junction overhang DETERMINISTICALLY -- independent of chain anchoring /
    // orientation -- we canonicalize each non-blunt seam to its strand-canonical
    // form (the smaller of the overhang and its reverse complement), matching how
    // `canonicalCircular` treats the product itself. Blunt seams stay "".
    const rawSeams = circular ? [...seams, closeSeam] : seams;
    const junctionOverhangs = rawSeams.map((s) => (s === "" ? "" : canonicalLinear(s)));

    // Per-junction seam geometry, index-aligned with rawSeams. Internal seam i is
    // the join chain[i].right -> chain[i+1].left, so its overhang KIND is the
    // upstream piece's right-end kind. The closing seam (circular) is
    // chain[last].right -> chain[0].left. Additive surfacing of PieceEnd.kind.
    const seamKind = (k: EndKind): "blunt" | "5'" | "3'" =>
      k === "blunt" ? "blunt" : k === "5overhang" ? "5'" : "3'";
    const rawKinds: EndKind[] = [];
    for (let i = 0; i < chain.length - 1; i += 1) rawKinds.push(chain[i].right.kind);
    if (circular) rawKinds.push(chain[chain.length - 1].right.kind);
    const junctions: ProductJunction[] = junctionOverhangs.map((oh, i) => ({
      overhang: oh,
      kind: seamKind(rawKinds[i] ?? "blunt"),
    }));
    const canon = circular ? canonicalCircular(out) : canonicalLinear(out);

    // Clamp features to [0, productLen) and drop zero-width windows.
    const productLen = canon.length;
    const validFeatures: CloneFeature[] = [];
    for (const f of allFeatures) {
      const s = Math.max(0, Math.min(f.start, productLen));
      const e = Math.max(s, Math.min(f.end, productLen));
      if (e > s) validFeatures.push({ ...f, start: s, end: e });
    }

    // Clamp spans the same way; drop any that collapse to zero width.
    const validSpans: FragmentSpan[] = [];
    for (const sp of spans) {
      const s = Math.max(0, Math.min(sp.start, productLen));
      const e = Math.max(s, Math.min(sp.end, productLen));
      if (e > s) validSpans.push({ ...sp, start: s, end: e });
    }

    return {
      seq: canon,
      circular,
      junctionOverhangs,
      junctions,
      features: validFeatures,
      fragmentSpans: validSpans,
    };
  }

  // SUBSET assembly (matching pydna's graph model): a product may use ANY subset
  // of the available pieces, each at most once, whose overhangs form a consistent
  // ligation chain. A circular product additionally closes the chain end-to-end.
  // We therefore emit a candidate product at EVERY chain length >= 1 (linear) and
  // attempt a circular close at every length, not only when all pieces are used.
  //
  // To bound the search and de-duplicate circular rotations we ANCHOR each chain
  // on its lowest piece index `anchor` in FORWARD orientation, and only extend
  // with pieces of index > anchor's set already in the chain is not required --
  // rotation/strand dedup is handled by canonicalCircular. The anchor's forward
  // orientation is sufficient for circular products (a flipped whole circle is
  // the reverse-complement rotation, collapsed by canonicalCircular); for linear
  // products both strands collapse via canonicalLinear.
  function extend(chain: OrientedPiece[], inChain: Set<number>) {
    // Emit products for the current chain (length >= 1).
    if (chain.length >= 1) {
      if (!opts.circularOnly) {
        const lin = joinChain(chain, false);
        if (lin) products.set(`L:${lin.seq}`, lin);
      }
      // A single blunt-blunt piece self-circularises only with allowBlunt; a
      // single sticky piece self-circularises if its own two ends are compatible.
      const circ = joinChain(chain, true);
      if (circ) products.set(`C:${circ.seq}`, circ);
    }
    for (let pick = 0; pick < pieces.length; pick += 1) {
      if (inChain.has(pick)) continue;
      // Anchor rule: never add a piece whose index is below the chain's anchor;
      // this keeps each circular subset enumerated from its lowest index once.
      if (pick < chain[0].pieceIndex) continue;
      for (const oriented of [forward(pieces[pick], pick), flip(pieces[pick], pick)]) {
        const seam = ligationSeam(chain[chain.length - 1].right, oriented.left, opts.allowBlunt);
        if (seam === null) continue;
        const next = new Set(inChain);
        next.add(pick);
        extend([...chain, oriented], next);
      }
    }
  }

  for (let anchor = 0; anchor < pieces.length; anchor += 1) {
    // Anchor in forward orientation only (rotation/strand dedup covers the rest).
    extend([forward(pieces[anchor], anchor)], new Set([anchor]));
  }

  return [...products.values()].sort((a, b) =>
    a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0,
  );
}

// --- TOP-LEVEL ENGINE -------------------------------------------------------

/**
 * Cut a set of fragments with the chosen enzyme(s) and ligate the resulting
 * pieces into assembled products. `mode` "golden-gate" discards the pieces that
 * still carry a recognition site (the Type IIS flanks); "restriction" keeps all
 * pieces. PURE + DETERMINISTIC.
 *
 * Feature annotations from each LigateFragment are rebased into the assembled
 * product using each piece's sourceStart and the oriented-piece's flip flag,
 * matching the behavior of assembleGibson in cloning.ts.
 */
export function cutAndLigate(
  fragments: LigateFragment[],
  options: CutLigateOptions,
): CutLigateResult {
  const warnings: string[] = [];
  const circularOnly = options.circularOnly ?? true;
  const allowBlunt = options.allowBlunt ?? true;

  const enzymeList: Enzyme[] = [];
  for (const name of options.enzymeNames) {
    const e = resolveEnzyme(name);
    if (!e) {
      warnings.push(`Unknown enzyme "${name}" — not in the dataset.`);
      continue;
    }
    enzymeList.push(e);
  }
  if (enzymeList.length === 0) {
    warnings.push("No valid enzymes supplied; nothing to digest.");
    return { products: [], pieces: [], warnings };
  }

  // Build a map from fragment name to features for use during ligation.
  const fragmentFeatureMap = new Map<string, CloneFeature[]>();
  for (const frag of fragments) {
    if (frag.features && frag.features.length > 0) {
      fragmentFeatureMap.set(frag.name, frag.features);
    }
  }

  // Digest every fragment.
  let pieces: DsPiece[] = [];
  for (const frag of fragments) {
    const cut = digestFragment(frag, enzymeList);
    pieces = pieces.concat(cut);
  }

  // Golden Gate: drop the recognition-bearing flanks. Restriction: keep all.
  let kept = pieces;
  if (options.mode === "golden-gate") {
    kept = pieces.filter((p) => !p.hasSite);
    if (kept.length < pieces.length) {
      // expected -- flanks discarded
    }
    // In Golden Gate the kept pieces must have two sticky ends (no original blunt
    // ends), else the design is wrong. Warn if any kept piece has a blunt end.
    for (const p of kept) {
      if (p.left.kind === "blunt" || p.right.kind === "blunt") {
        warnings.push(
          `Golden Gate piece from "${p.sourceName}" has a blunt end; a part may lack a flanking Type IIS site.`,
        );
      }
    }
  }

  if (kept.length === 0) {
    warnings.push("No ligatable pieces remained after digestion.");
    return { products: [], pieces: kept, warnings };
  }

  const products = ligate(kept, { circularOnly, allowBlunt }, fragmentFeatureMap);
  if (products.length === 0) {
    warnings.push("No assembled product: the piece overhangs do not form a consistent ligation.");
  } else if (products.length > 1 && circularOnly) {
    warnings.push(
      `${products.length} distinct circular products are possible (orientation-ambiguous overhangs).`,
    );
  }

  return { products, pieces: kept, warnings };
}
