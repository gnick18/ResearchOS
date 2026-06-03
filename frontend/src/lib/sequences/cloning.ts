// cloning bot — PURE in-silico OVERLAP ASSEMBLY engine (Gibson / NEBuilder HiFi).
//
// This is the correctness core of the cloning workspace: a wrong assembled
// construct is a real molecular-biology bug, so EVERYTHING here is pure,
// deterministic, DOM-free, and heavily unit-tested (cloning.test.ts). No React,
// no SeqViz, no disk. The UI layer calls `assembleGibson` and renders the
// result; it never re-derives the biology.
//
// THE BIOLOGY (Gibson / NEBuilder HiFi overlap assembly)
// ------------------------------------------------------
// Gibson assembly joins an ORDERED set of double-stranded fragments that share
// short homologous ends. In a real prep you PCR each fragment with primers whose
// 5' ends carry a homology TAIL matching the neighbouring fragment; the exonuclease
// chews back, the homologous single strands anneal, and the fragments fuse
// seamlessly with the homology present EXACTLY ONCE at each junction.
//
// In silico the job is two things:
//   1. Compute the ASSEMBLED PRODUCT sequence. Because the homology that joins
//      Fi to Fi+1 is *added by the primer tails* (it is a copy of the end of the
//      adjacent fragment, not pre-existing duplicated sequence in the inputs),
//      the seamless product is simply the fragment bodies concatenated in order,
//      with the homology appearing once. For a LINEAR product that is
//      F0 + F1 + ... + Fn-1. For a CIRCULAR product the last fragment also joins
//      back to the first, closing the loop (the string is the same concatenation,
//      flagged circular; the wrap-around junction is the last one).
//   2. Design the PER-JUNCTION PCR PRIMERS. For each fragment we emit a forward
//      and a reverse primer. Each primer = an ANNEALING region (the fragment's
//      own terminal bases, sized to a target Tm ~60 C using our SantaLucia Tm)
//      PLUS a 5' HOMOLOGY TAIL that is a copy of the adjacent fragment's abutting
//      end, so the PCR product carries the overlap. The tail length is the chosen
//      overlap (by fixed length, default ~25 bp, or by target Tm).
//
//        Junction Fi | Fi+1, overlap length h:
//          - Fi's REVERSE primer gets a 5' tail = revcomp of Fi+1's first h bases
//            (so Fi's PCR product gains Fi+1's leading homology on its bottom
//            strand 3' end). Actually we add the homology so the amplicon's right
//            end matches Fi+1's left end.
//          - Fi+1's FORWARD primer gets a 5' tail = Fi's last h bases (so Fi+1's
//            amplicon left end matches Fi's right end).
//        The two amplicons then share the h-bp homology and anneal.
//
//      We follow the SnapGene / ApE convention: the homology that bridges a
//      junction is placed on the primers of BOTH flanking fragments (one as the
//      forward tail of the downstream fragment, one as the reverse tail of the
//      upstream fragment), so either amplicon alone carries the full overlap.
//
// ORIENTATION ASSUMPTION
// ----------------------
// Fragments are taken in the orientation the user supplies them (top strand,
// 5'->3', left-to-right). We do NOT auto-revcomp a fragment to find a better
// junction; the user orders + orients the fragments (this matches APE/SnapGene's
// default and keeps the engine deterministic). A fragment whose end cannot reach
// the overlap target (too short, or non-ACGT) is reported as a warning.
//
// COORDINATES
// -----------
// Internally fragment features use 0-based, end-EXCLUSIVE half-open intervals
// [start, end). The bio-parsers GenBank model uses 0-based INCLUSIVE end; the
// adapter at the workspace boundary converts (inclusive end = exclusive end - 1).
// Feature rebasing across junctions is a pure additive shift of each fragment's
// features by that fragment's offset in the product (see `rebaseFeatures`).

import {
  reverseComplement,
  tmNearestNeighbor,
  gcContent,
} from "./primer";

// --- TYPES ------------------------------------------------------------------

/** A feature carried on a fragment / product. 0-based, end-EXCLUSIVE [start,end)
 *  on the fragment's own forward strand. `strand` 1 = forward, -1 = reverse. */
export interface CloneFeature {
  name: string;
  start: number;
  end: number;
  strand: 1 | -1;
  type?: string;
  color?: string;
}

/** One input fragment to the assembly. */
export interface Fragment {
  /** Display name (carries into the junction list + product). */
  name: string;
  /** Top-strand sequence, 5'->3', as the user ordered/oriented it. */
  seq: string;
  /** Features to carry into the product (rebased by the fragment's offset). */
  features?: CloneFeature[];
}

/** How the user sizes the homology overlap. */
export type OverlapMode =
  | { kind: "length"; bp: number }
  | { kind: "tm"; targetTm: number; minBp?: number; maxBp?: number };

export interface AssembleOptions {
  /** Product topology: a closed plasmid (circular) or a linear construct. */
  circular: boolean;
  /** Overlap sizing. Default: fixed 25 bp. */
  overlap?: OverlapMode;
  /** Target annealing Tm for the primer's binding region (C). Default 60. */
  annealTargetTm?: number;
  /** Min / max annealing-region length (bp). Defaults 18 / 36. */
  annealMinBp?: number;
  annealMaxBp?: number;
  /** Reaction conditions for Tm (mirror the editor / calculator defaults). */
  naMillimolar?: number;
  oligoNanomolar?: number;
}

/** A designed PCR primer (forward or reverse) for one fragment. */
export interface DesignedPrimer {
  /** 5'->3' oligo sequence: 5' homology tail (if any) + 3' annealing region. */
  sequence: string;
  /** The 3' annealing region only (binds the fragment template). */
  anneal: string;
  /** The 5' homology tail only (adds the overlap; "" if none, e.g. linear ends). */
  tail: string;
  /** Annealing-region Tm (C, SantaLucia NN). */
  annealTm: number;
  /** Full-oligo length (tail + anneal). */
  length: number;
}

/** Per-junction report (the junction at the 3' end of fragment `fragmentIndex`,
 *  joining it to the next fragment in the product order). */
export interface Junction {
  /** Index of the UPSTREAM fragment of this junction. */
  fragmentIndex: number;
  /** Index of the DOWNSTREAM fragment (wraps to 0 for the closing junction). */
  nextFragmentIndex: number;
  /** Realized overlap length (bp). */
  overlapBp: number;
  /** The overlap sequence (top strand, 5'->3'). */
  overlapSeq: string;
  /** Tm of the overlap homology (C, SantaLucia NN). */
  overlapTm: number;
  /** Non-fatal note about this junction (overlap below target, etc.). */
  warning?: string;
}

/** A fragment's full primer pair, labelled to its fragment. */
export interface FragmentPrimers {
  fragmentIndex: number;
  fragmentName: string;
  forward: DesignedPrimer;
  reverse: DesignedPrimer;
}

export interface AssembledProduct {
  /** The assembled construct sequence (top strand, 5'->3'). */
  seq: string;
  circular: boolean;
  /** Features carried from every fragment, rebased to product coordinates. */
  features: CloneFeature[];
}

export interface AssemblyResult {
  product: AssembledProduct;
  junctions: Junction[];
  primers: FragmentPrimers[];
  /** Assembly-level warnings (too few fragments, infeasible junctions, ...). */
  warnings: string[];
}

// --- DEFAULTS ---------------------------------------------------------------

export const DEFAULT_OVERLAP_BP = 25;
export const DEFAULT_ANNEAL_TM = 60;
export const DEFAULT_ANNEAL_MIN = 18;
export const DEFAULT_ANNEAL_MAX = 36;
const DEFAULT_NA_MM = 50;
const DEFAULT_OLIGO_NM = 250;
/** When sizing the overlap by Tm, never let it grow past this (sanity cap). */
const TM_OVERLAP_MAX_DEFAULT = 60;
const TM_OVERLAP_MIN_DEFAULT = 15;

// --- SMALL PURE HELPERS -----------------------------------------------------

/** Keep only A/C/G/T (uppercased). Anything else (incl. ambiguity codes) is the
 *  caller's problem — overlap homology must be unambiguous to anneal cleanly. */
function cleanDna(seq: string): string {
  return seq.toUpperCase().replace(/[^ACGT]/g, "");
}

/** Tm of a homology / annealing stretch under the assembly's salt conditions. */
function tmOf(seq: string, naMm: number, oligoNm: number): number {
  if (seq.length === 0) return NaN;
  return tmNearestNeighbor(seq, oligoNm * 1e-9, naMm * 1e-3);
}

/**
 * Choose an annealing-region length for one fragment END so its Tm reaches the
 * target. Grows the region from the fragment terminus inward until Tm >= target
 * (or the max length); returns the chosen substring (5'->3' on the template
 * strand, i.e. the bases that anneal). `fromStart` true = the fragment's 5' end
 * (forward primer); false = the 3' end (reverse primer's template span).
 */
function sizeAnneal(
  body: string,
  fromStart: boolean,
  targetTm: number,
  minBp: number,
  maxBp: number,
  naMm: number,
  oligoNm: number,
): string {
  const n = body.length;
  const hardMax = Math.min(maxBp, n);
  let chosen = Math.min(minBp, hardMax);
  for (let len = Math.min(minBp, hardMax); len <= hardMax; len += 1) {
    const span = fromStart ? body.slice(0, len) : body.slice(n - len);
    chosen = len;
    if (tmOf(span, naMm, oligoNm) >= targetTm) break;
  }
  return fromStart ? body.slice(0, chosen) : body.slice(n - chosen);
}

/**
 * Decide the homology overlap LENGTH for a junction from the overlap mode.
 * For "length" it is the fixed bp (capped by the shorter of the two abutting
 * fragments). For "tm" it grows the upstream fragment's 3' bases until the
 * homology Tm reaches the target.
 */
function sizeOverlap(
  upstreamBody: string,
  downstreamBody: string,
  mode: OverlapMode,
  naMm: number,
  oligoNm: number,
): number {
  const cap = Math.min(upstreamBody.length, downstreamBody.length);
  if (mode.kind === "length") {
    return Math.max(0, Math.min(mode.bp, cap));
  }
  // Tm mode: the homology is the upstream fragment's 3'-terminal bases (which
  // equal the downstream fragment's 5' start after assembly — but the homology
  // SEQUENCE used to gauge Tm is the upstream 3' end since that is what one
  // amplicon presents). Grow until Tm >= target.
  const minBp = Math.max(1, mode.minBp ?? TM_OVERLAP_MIN_DEFAULT);
  const maxBp = Math.min(mode.maxBp ?? TM_OVERLAP_MAX_DEFAULT, cap);
  let chosen = Math.min(minBp, maxBp);
  for (let len = Math.min(minBp, maxBp); len <= maxBp; len += 1) {
    chosen = len;
    const span = upstreamBody.slice(upstreamBody.length - len);
    if (tmOf(span, naMm, oligoNm) >= mode.targetTm) break;
  }
  return chosen;
}

// --- FEATURE REBASING -------------------------------------------------------

/**
 * Rebase a fragment's features into product coordinates by adding the fragment's
 * `offset` (its start index in the concatenated product). Pure additive shift on
 * the half-open [start, end) intervals — the analogue of coordinate-shift's
 * position mapping for the simple concatenation case (an insert of `offset` bases
 * before every coordinate). Returns NEW feature objects; inputs are untouched.
 */
export function rebaseFeatures(features: CloneFeature[], offset: number): CloneFeature[] {
  return features.map((f) => ({
    ...f,
    start: f.start + offset,
    end: f.end + offset,
  }));
}

// --- THE ENGINE -------------------------------------------------------------

/**
 * Assemble an ordered list of fragments by overlap (Gibson / NEBuilder HiFi).
 *
 * Returns the assembled product sequence (concatenation, homology shared once),
 * the per-junction overlaps, the per-fragment PCR primers (annealing region +
 * homology tail), and any warnings. PURE and DETERMINISTIC.
 */
export function assembleGibson(
  fragments: Fragment[],
  options: AssembleOptions,
): AssemblyResult {
  const warnings: string[] = [];
  const naMm = options.naMillimolar ?? DEFAULT_NA_MM;
  const oligoNm = options.oligoNanomolar ?? DEFAULT_OLIGO_NM;
  const annealTargetTm = options.annealTargetTm ?? DEFAULT_ANNEAL_TM;
  const annealMin = options.annealMinBp ?? DEFAULT_ANNEAL_MIN;
  const annealMax = options.annealMaxBp ?? DEFAULT_ANNEAL_MAX;
  const overlapMode: OverlapMode = options.overlap ?? { kind: "length", bp: DEFAULT_OVERLAP_BP };
  const circular = options.circular;

  // Normalize fragment bodies to clean unambiguous DNA. Flag any that lost bases.
  const bodies: string[] = [];
  fragments.forEach((f, i) => {
    const clean = cleanDna(f.seq);
    if (clean.length !== cleanDna(f.seq.toUpperCase()).length) {
      // (cleanDna already removed non-ACGT; this branch is unreachable but kept
      // explicit.) Real ambiguity-base warning is below.
    }
    if (clean.length < f.seq.replace(/\s/g, "").length) {
      warnings.push(
        `Fragment ${i + 1} ("${f.name}") had non-ACGT characters dropped before assembly.`,
      );
    }
    bodies.push(clean);
  });

  if (fragments.length < 2) {
    warnings.push("Overlap assembly needs at least two fragments.");
  }
  bodies.forEach((b, i) => {
    if (b.length === 0) warnings.push(`Fragment ${i + 1} ("${fragments[i]?.name ?? "?"}") is empty.`);
  });

  // PRODUCT SEQUENCE: the seamless construct is the fragment bodies concatenated
  // in order. The homology that joins each pair is contributed by the primer
  // tails and is therefore NOT duplicated in the product — it lives once, as the
  // boundary between two bodies. For circular, the same string is flagged
  // circular (the closing junction is the wrap from the last body back to the
  // first); for linear it is the open concatenation.
  const productSeq = bodies.join("");

  // FEATURES: rebase each fragment's features by its offset (cumulative body
  // length to its left).
  const features: CloneFeature[] = [];
  let offset = 0;
  bodies.forEach((b, i) => {
    const feats = fragments[i]?.features ?? [];
    // Clamp features to the cleaned body length (cleanDna may have shortened it).
    for (const f of feats) {
      const start = Math.max(0, Math.min(f.start, b.length));
      const end = Math.max(start, Math.min(f.end, b.length));
      if (end > start) {
        features.push({ ...f, start: start + offset, end: end + offset });
      }
    }
    offset += b.length;
  });

  // JUNCTIONS + PRIMERS.
  // The set of junctions: for a LINEAR product of n fragments there are n-1
  // internal junctions (between i and i+1). For a CIRCULAR product there is also
  // the closing junction (last -> first), so n junctions total.
  const junctions: Junction[] = [];
  const lastJunctionIndex = circular ? bodies.length - 1 : bodies.length - 2;

  // Per-fragment overlap tails. tailFor[i].left = the 5' homology tail to prepend
  // to fragment i's FORWARD primer (homology to the UPSTREAM neighbour's 3' end);
  // tailFor[i].right = the 5' homology tail to prepend to fragment i's REVERSE
  // primer (homology to the DOWNSTREAM neighbour's 5' end, revcomp'd).
  const leftTail: string[] = bodies.map(() => "");
  const rightTail: string[] = bodies.map(() => "");

  for (let i = 0; i <= lastJunctionIndex; i += 1) {
    const j = (i + 1) % bodies.length; // downstream fragment (wraps for circular)
    const up = bodies[i];
    const down = bodies[j];
    if (up.length === 0 || down.length === 0) {
      junctions.push({
        fragmentIndex: i,
        nextFragmentIndex: j,
        overlapBp: 0,
        overlapSeq: "",
        overlapTm: NaN,
        warning: "One side of this junction is empty; no overlap can form.",
      });
      continue;
    }
    const h = sizeOverlap(up, down, overlapMode, naMm, oligoNm);
    // The homology that bridges this junction. In the seamless product, fragment
    // i's 3' end abuts fragment j's 5' start. The homology added to the amplicons
    // is: fragment j's FORWARD primer carries a 5' tail = up's last h bases; and
    // fragment i's REVERSE primer carries a 5' tail = revcomp(down's first h
    // bases). We surface the junction's overlap as the seam: up's last h bases
    // followed by down's first h bases would be the two halves the homology spans;
    // the realized in-product overlap region (the homology) is up's last h bases
    // (== what both amplicons share once annealed and the seam is sealed).
    const overlapSeq = up.slice(up.length - h);
    const overlapTm = tmOf(overlapSeq, naMm, oligoNm);

    let warning: string | undefined;
    if (h === 0) {
      warning = "No feasible overlap: a fragment is too short for any homology.";
    } else if (overlapMode.kind === "length" && h < overlapMode.bp) {
      warning = `Overlap shortened to ${h} bp (a flanking fragment is only ${Math.min(up.length, down.length)} bp).`;
    } else if (overlapMode.kind === "tm" && overlapTm < overlapMode.targetTm) {
      warning = `Overlap Tm ${overlapTm.toFixed(1)} C is below the ${overlapMode.targetTm} C target even at ${h} bp.`;
    }

    junctions.push({
      fragmentIndex: i,
      nextFragmentIndex: j,
      overlapBp: h,
      overlapSeq,
      overlapTm,
      warning,
    });

    // Assign the homology tails. Junction i|j contributes:
    //   - to fragment j's FORWARD primer: a 5' tail = up's last h bases.
    //   - to fragment i's REVERSE primer: a 5' tail = revcomp(down's first h bases).
    leftTail[j] = up.slice(up.length - h);
    rightTail[i] = reverseComplement(down.slice(0, h));
  }

  // PRIMERS. For every fragment, design a forward + reverse primer.
  //   forward = [leftTail[i]] + annealing region at the fragment's 5' end.
  //   reverse = [rightTail[i]] + revcomp(annealing region at the fragment's 3' end).
  const primers: FragmentPrimers[] = bodies.map((body, i) => {
    const fwdAnneal = body.length
      ? sizeAnneal(body, true, annealTargetTm, annealMin, annealMax, naMm, oligoNm)
      : "";
    const revAnnealTemplate = body.length
      ? sizeAnneal(body, false, annealTargetTm, annealMin, annealMax, naMm, oligoNm)
      : "";
    const revAnneal = reverseComplement(revAnnealTemplate);

    const fwd: DesignedPrimer = {
      anneal: fwdAnneal,
      tail: leftTail[i],
      sequence: leftTail[i] + fwdAnneal,
      annealTm: tmOf(fwdAnneal, naMm, oligoNm),
      length: leftTail[i].length + fwdAnneal.length,
    };
    const rev: DesignedPrimer = {
      anneal: revAnneal,
      tail: rightTail[i],
      sequence: rightTail[i] + revAnneal,
      // The annealing Tm reflects the region that binds the template (3' portion).
      annealTm: tmOf(revAnnealTemplate, naMm, oligoNm),
      length: rightTail[i].length + revAnneal.length,
    };
    return {
      fragmentIndex: i,
      fragmentName: fragments[i]?.name ?? `Fragment ${i + 1}`,
      forward: fwd,
      reverse: rev,
    };
  });

  // Cross-fragment ambiguity check: identical adjacent fragment bodies (or an
  // overlap that also matches elsewhere) make the assembly ambiguous. Cheap check:
  // duplicate junction overlaps.
  const seenOverlaps = new Map<string, number>();
  for (const jn of junctions) {
    if (jn.overlapBp > 0) {
      const prev = seenOverlaps.get(jn.overlapSeq);
      if (prev !== undefined) {
        warnings.push(
          `Junctions after fragment ${prev + 1} and fragment ${jn.fragmentIndex + 1} share the same overlap sequence; the assembly may be ambiguous.`,
        );
      }
      seenOverlaps.set(jn.overlapSeq, jn.fragmentIndex);
    }
  }

  return {
    product: { seq: productSeq, circular, features },
    junctions,
    primers,
    warnings,
  };
}

/** GC% convenience re-export so the UI can show product GC without re-importing. */
export function productGc(seq: string): number {
  return gcContent(seq);
}
