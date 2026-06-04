// SDM primer bot — PURE site-directed mutagenesis (SDM) primer design.
//
// Given a template (forward strand), a target position/region, and a desired
// CHANGE, design ONE mutagenic primer that carries the change CENTERED between
// two flanking HOMOLOGY ARMS that match the template. The arms anchor the primer
// to the template on each side of the edit so the polymerase can extend; the
// changed bases sit in the middle and are the INTENDED mismatch the viz paints.
//
// Three change types (MVP):
//   - "substitution": replace base(s) at [position, position+oldLen) with newBases
//     (the classic point/multi-base substitution; oldLen may differ from
//     newBases.length, e.g. swap 1 base for 1, or 1 for 3).
//   - "insertion": insert newBases between position-1 and position (no template
//     base removed); the inserted bases have no template partner.
//   - "deletion": remove the template range [position, position+length); the
//     primer joins the left arm directly to the right arm across the gap.
//
// FLANK / Tm HEURISTIC (QuikChange-style, documented):
//   Each homology arm grows outward from the edit one base at a time until BOTH
//   (a) the arm is at least `minArmLength` matching bases (default 12, inside the
//   classic 10-15 nt QuikChange flank window), AND (b) the WHOLE primer's
//   nearest-neighbor annealing Tm (computed over the bases that pair with the
//   template, i.e. excluding inserted/mismatched-only contribution is NOT done —
//   we use the standard practice of scoring the full primer oligo Tm) reaches
//   `targetTm` (default 60 C). Arms stop growing when they hit the template edge.
//   Growth alternates left/right so the change stays as centered as the template
//   allows. The result is a single primer (NOT a complementary QuikChange pair and
//   NOT around-the-horn strategy selection — see LIMITATIONS below).
//
// The Tm reported is the SAME SantaLucia 1998 nearest-neighbor model the editor
// and the Scientific calculator use (via primer.ts -> tm-nn.ts), so the number
// matches everywhere. Pure + deterministic: same inputs -> same primer.
//
// LIMITATIONS (explicit, MVP):
//   - Single mutagenic primer only. We do NOT design the complementary reverse
//     primer of a QuikChange pair, and we do NOT pick between QuikChange vs
//     around-the-horn / Gibson strategies. Those are follow-ups.
//   - The annealing Tm is scored over the full primer oligo. For a large insertion
//     or substitution the central non-matching block inflates the oligo Tm vs the
//     true arm-annealing Tm; we surface the arm lengths so the user can judge.

import {
  reverseComplement,
  gcContent,
  sanitizePrimer,
  tmNearestNeighbor,
} from "./primer";

/** The kind of edit a mutagenic primer encodes. */
export type MutationType = "substitution" | "insertion" | "deletion";

/** The requested change against the template (forward, 0-based coordinates). */
export type MutationSpec =
  | {
      type: "substitution";
      /** 0-based start of the template bases being replaced. */
      position: number;
      /** The new bases to put there (5'->3', forward strand). Sanitized to ACGT. */
      newBases: string;
      /** How many template bases to replace. Default = newBases.length (a same-
       *  length swap, e.g. a point mutation when newBases is 1 nt). */
      replaceLength?: number;
    }
  | {
      type: "insertion";
      /** Insert BEFORE this 0-based template position (0 = before the first base,
       *  template.length = after the last base). */
      position: number;
      /** The bases to insert (5'->3', forward strand). Sanitized to ACGT. */
      newBases: string;
    }
  | {
      type: "deletion";
      /** 0-based start of the template range to remove. */
      position: number;
      /** How many template bases to remove (>= 1). */
      length: number;
    };

/** Tuning for the flank/Tm growth. Defaults are QuikChange-style. */
export interface MutagenesisOptions {
  /** Minimum matching bases per homology arm. Default 12 (classic 10-15 window). */
  minArmLength?: number;
  /** Grow arms until the whole-primer NN Tm reaches this (C). Default 60. */
  targetTm?: number;
  /** Hard cap on each arm so a low-Tm/short template never loops forever.
   *  Default 30. */
  maxArmLength?: number;
  /** Reaction conditions for Tm (mirror the editor / calculator defaults). */
  naMillimolar?: number;
  oligoNanomolar?: number;
}

/** One column of the primer aligned against the original template, for the viz.
 *  `template` is "-" where the primer base has no template partner (an inserted
 *  base); `match` is true only for a base that pairs with the template. */
export interface MutPrimerColumn {
  /** The primer base at this column ("-" never appears in the primer row). */
  primer: string;
  /** The original template base under this column, or "-" for an inserted base. */
  template: string;
  /** True when primer base === template base (a homology-arm match). */
  match: boolean;
  /** True when this column is part of the intended edit (the mismatch to paint). */
  edited: boolean;
}

/** The designed mutagenic primer. */
export interface MutagenicPrimer {
  /** The primer's own 5'->3' sequence (ACGT). */
  primer: string;
  length: number;
  /** Percent GC (0-100) of the whole primer. */
  gc: number;
  /** Whole-primer nearest-neighbor Tm (C). */
  tm: number;
  /** Length of the matching homology arm 5' of the edit (bases). */
  leftArm: number;
  /** Length of the matching homology arm 3' of the edit (bases). */
  rightArm: number;
  /** The change type that produced this primer. */
  mutationType: MutationType;
  /** The edited region INSIDE the primer, as a 0-based [start, end) range of
   *  primer indices. For a deletion the range is empty (start === end) and marks
   *  the join point; for substitution/insertion it spans the new bases. */
  mutationPrimerStart: number;
  mutationPrimerEnd: number;
  /** The template span (forward coords, 0-based [start, end)) the primer footprint
   *  covers — what to persist as the primer_bind binding site. For an insertion
   *  this is the two arms (the inserted bases add no template span); for a deletion
   *  it spans both arms AND the removed range (the primer footprint straddles it). */
  templateStart: number;
  templateEnd: number;
  /** Per-column primer-over-original-template alignment for the mismatch viz. */
  columns: MutPrimerColumn[];
  /** Forward-strand template positions inside the edit (for the mismatch display).
   *  Empty for a pure insertion (no template base is changed). */
  mismatchTemplatePositions: number[];
}

const DEFAULTS: Required<MutagenesisOptions> = {
  minArmLength: 12,
  targetTm: 60,
  maxArmLength: 30,
  naMillimolar: 50,
  oligoNanomolar: 250,
};

/** Clamp an integer into [lo, hi]. */
function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/**
 * Design a single mutagenic primer for `spec` against `template` (forward strand).
 *
 * The primer is built as  leftArm + editBlock + rightArm  where:
 *   - editBlock is the new bases (substitution / insertion) or empty (deletion).
 *   - leftArm matches template bases immediately 5' of the edit.
 *   - rightArm matches template bases immediately 3' of the edit (for a deletion,
 *     3' of the REMOVED range; the primer joins the arms across the gap).
 *
 * Arms grow outward (alternating left/right for centering) until each reaches
 * `minArmLength` AND the whole-primer NN Tm reaches `targetTm`, capped by
 * `maxArmLength` and the template edges.
 *
 * Throws on a structurally invalid spec (out-of-range position, empty edit, etc.)
 * so callers can surface a clear message. Pure + deterministic.
 */
export function designMutagenicPrimer(
  template: string,
  spec: MutationSpec,
  options: MutagenesisOptions = {},
): MutagenicPrimer {
  const opts = { ...DEFAULTS, ...options };
  const t = template.toUpperCase();
  const n = t.length;
  if (n === 0) throw new Error("Template is empty.");

  // Resolve the edit into a forward template "core" [coreStart, coreEnd) that the
  // edit replaces, plus the new bases that go in its place.
  let coreStart: number;
  let coreEnd: number; // exclusive; the right arm starts here
  let editBlock: string; // bases inserted in place of the core (5'->3')
  const mutationType: MutationType = spec.type;

  if (spec.type === "substitution") {
    const newBases = sanitizePrimer(spec.newBases);
    if (newBases.length === 0) throw new Error("Substitution needs at least one new base.");
    const replaceLength = spec.replaceLength ?? newBases.length;
    if (replaceLength < 1) throw new Error("Substitution must replace at least one base.");
    coreStart = clampInt(spec.position, 0, n);
    coreEnd = clampInt(spec.position + replaceLength, coreStart, n);
    if (coreEnd <= coreStart) throw new Error("Substitution range is out of the template.");
    editBlock = newBases;
  } else if (spec.type === "insertion") {
    const newBases = sanitizePrimer(spec.newBases);
    if (newBases.length === 0) throw new Error("Insertion needs at least one base.");
    coreStart = clampInt(spec.position, 0, n);
    coreEnd = coreStart; // nothing removed
    editBlock = newBases;
  } else {
    // deletion
    if (spec.length < 1) throw new Error("Deletion length must be at least one base.");
    coreStart = clampInt(spec.position, 0, n);
    coreEnd = clampInt(spec.position + spec.length, coreStart, n);
    if (coreEnd <= coreStart) throw new Error("Deletion range is out of the template.");
    editBlock = "";
  }

  // Available matching bases on each side (template edges cap arm growth).
  const maxLeft = Math.min(opts.maxArmLength, coreStart);
  const maxRight = Math.min(opts.maxArmLength, n - coreEnd);

  // Grow the arms. Start at the minimum (capped by available bases), then extend
  // alternately L/R until the whole-primer Tm hits the target or we run out of
  // template / hit the cap.
  let leftArm = Math.min(opts.minArmLength, maxLeft);
  let rightArm = Math.min(opts.minArmLength, maxRight);

  const buildPrimer = (l: number, r: number): string =>
    t.slice(coreStart - l, coreStart) + editBlock + t.slice(coreEnd, coreEnd + r);

  const tmOf = (seq: string): number =>
    tmNearestNeighbor(seq, opts.oligoNanomolar * 1e-9, opts.naMillimolar * 1e-3);

  // Alternating outward growth, left first, until Tm target met or both capped.
  let growLeft = true;
  // Guard against an unreachable Tm: cap iterations at the total room available.
  const maxIters = (maxLeft - leftArm) + (maxRight - rightArm);
  for (let i = 0; i < maxIters; i += 1) {
    if (tmOf(buildPrimer(leftArm, rightArm)) >= opts.targetTm) break;
    const canLeft = leftArm < maxLeft;
    const canRight = rightArm < maxRight;
    if (!canLeft && !canRight) break;
    if (growLeft && canLeft) leftArm += 1;
    else if (!growLeft && canRight) rightArm += 1;
    else if (canLeft) leftArm += 1;
    else if (canRight) rightArm += 1;
    growLeft = !growLeft;
  }

  const primer = buildPrimer(leftArm, rightArm);

  // Edited region inside the primer: it sits right after the left arm and spans
  // editBlock.length bases (0 for a deletion -> an empty range marking the join).
  const mutationPrimerStart = leftArm;
  const mutationPrimerEnd = leftArm + editBlock.length;

  // Template footprint the primer covers (forward coords). The left arm starts at
  // coreStart - leftArm; the right arm ends at coreEnd + rightArm. This straddles
  // the removed range for a deletion, and equals the two arms for an insertion.
  const templateStart = coreStart - leftArm;
  const templateEnd = coreEnd + rightArm;

  // Per-column alignment of the primer against the ORIGINAL template footprint, so
  // the viz can paint the homology arms (match) and the intended edit (mismatch).
  const columns: MutPrimerColumn[] = [];
  const mismatchTemplatePositions: number[] = [];

  // Left arm columns (all matches against template[coreStart-leftArm .. coreStart)).
  for (let k = 0; k < leftArm; k += 1) {
    const tIdx = coreStart - leftArm + k;
    const pb = t[tIdx];
    columns.push({ primer: pb, template: pb, match: true, edited: false });
  }

  if (mutationType === "deletion") {
    // No edit bases in the primer; the removed template range has no primer column.
    // We DON'T emit "-" primer columns for the deleted bases (the primer simply
    // skips them); the deletion is visible as the arms joining. Record the removed
    // template positions as the (template-side) change for the report.
    for (let p = coreStart; p < coreEnd; p += 1) mismatchTemplatePositions.push(p);
  } else if (mutationType === "insertion") {
    // Inserted bases: primer base present, template partner is "-" (a mismatch).
    for (let k = 0; k < editBlock.length; k += 1) {
      columns.push({ primer: editBlock[k], template: "-", match: false, edited: true });
    }
    // No template position changes (pure insertion).
  } else {
    // Substitution: line the new bases up over the replaced template bases. The
    // ranges can differ in length; pad the shorter side with "-".
    const replaced = t.slice(coreStart, coreEnd);
    const span = Math.max(editBlock.length, replaced.length);
    for (let k = 0; k < span; k += 1) {
      const pb = editBlock[k] ?? "-";
      const tb = replaced[k] ?? "-";
      const match = pb !== "-" && tb !== "-" && pb === tb;
      columns.push({ primer: pb === "-" ? "-" : pb, template: tb, match, edited: true });
      if (k < replaced.length) mismatchTemplatePositions.push(coreStart + k);
    }
  }

  // Right arm columns (all matches against template[coreEnd .. coreEnd+rightArm)).
  for (let k = 0; k < rightArm; k += 1) {
    const tIdx = coreEnd + k;
    const pb = t[tIdx];
    columns.push({ primer: pb, template: pb, match: true, edited: false });
  }

  return {
    primer,
    length: primer.length,
    gc: gcContent(primer),
    tm: tmOf(primer),
    leftArm,
    rightArm,
    mutationType,
    mutationPrimerStart,
    mutationPrimerEnd,
    templateStart,
    templateEnd,
    columns,
    mismatchTemplatePositions,
  };
}
