// annotate-from-reference bot — HOMOLOGY-BASED ANNOTATION TRANSFER.
//
// Given the open sequence plus a reference sequence and ITS features, align the
// two and carry every reference feature whose span maps cleanly onto the open
// sequence's coordinates. This is the "transfer features from a parent/backbone"
// flow: a derived construct (a sub-region, a re-annotated clone, a slightly-
// diverged variant) inherits the reference's annotations without re-drawing them
// by hand.
//
// Pure, deterministic, strict TS. NO React, NO disk, NO SeqViz. The alignment is
// done with the project's own engine (lib/align), which is IUPAC-aware and
// mismatch tolerant, so a parent that diverged by a few bases still transfers.
//
// COORDINATE MODEL
// ----------------
// Coordinates are the editor's 0-based, half-open [start, end) convention (same
// as edit-model / feature-edit). A feature span [s, e) on the REFERENCE maps to
// a span [s', e') on the OPEN sequence by walking the alignment column-by-column
// and building a position map from reference index -> open-sequence index.
//
// STRAND
// ------
// We align the open sequence against BOTH the reference as-given (forward) and
// its reverse complement, and keep whichever alignment scores higher. On the
// reverse-complement branch, a reference feature's coordinates and strand are
// flipped before mapping (a + feature on the parent becomes a - feature on a
// construct cloned in the opposite orientation, and vice versa).

import {
  alignLocal,
  alignSemiGlobal,
  reverseComplement,
  type AlignmentResult,
  type AlignOp,
} from "../align";

/** A reference feature, as it arrives from a parsed reference document. Only the
 *  fields the transfer needs; extra fields are ignored. Coordinates are the same
 *  0-based half-open [start, end) the editor uses. */
export interface ReferenceFeature {
  name: string;
  type?: string;
  strand?: 1 | -1;
  start: number;
  end: number;
  /** Optional multi-segment (join) ranges, same coordinate space as start/end. */
  segments?: { start: number; end: number }[];
  /** Carried through onto the proposal so the caller can preserve color. */
  color?: string;
  notes?: Record<string, unknown>;
}

/** A single transferred-feature proposal. Mapped coordinates are on the OPEN
 *  sequence (0-based half-open). */
export interface ProposedFeature {
  name: string;
  type?: string;
  /** Strand on the OPEN sequence (flipped when the reference mapped via its
   *  reverse complement). */
  strand: 1 | -1;
  /** Mapped span on the open sequence. `null` start/end when nothing mapped. */
  start: number;
  end: number;
  /** Mapped multi-segment ranges (open-sequence coords), present only when the
   *  source feature was multi-segment and mapped. */
  segments?: { start: number; end: number }[];
  color?: string;
  notes?: Record<string, unknown>;
  /** Fraction in [0, 1] of the MAPPED portion of the feature that matched
   *  (identical / IUPAC-compatible) rather than mismatched. This is the quality
   *  of the homology over the bases that actually aligned; completeness is the
   *  separate `coverage` field. A half-present-but-perfect feature has identity
   *  1 and coverage 0.5. */
  identity: number;
  /** Fraction in [0, 1] of the feature's reference span that mapped to ANY
   *  open-sequence position (match or mismatch, but not a gap / off the aligned
   *  region). 1 => the whole span is covered; < 1 => partial. */
  coverage: number;
  /** True when the feature could not be placed at all (coverage 0 or below the
   *  coverage floor): not offered for transfer. */
  unmapped: boolean;
  /** True when the feature mapped only partially (coverage below 1 but at or
   *  above the floor): offered, but flagged so the user knows it is clipped. */
  partial: boolean;
}

/** The full result of a transfer run: the strand the reference was read on and
 *  every feature's proposal (including the ones that did not map). */
export interface AnnotateResult {
  /** "forward" if the open sequence aligned best to the reference as-given,
   *  "reverse" if it aligned best to the reference's reverse complement. */
  referenceOrientation: "forward" | "reverse";
  /** Identity of the overall open-vs-reference alignment, in [0, 1]. */
  overallIdentity: number;
  /** One proposal per input reference feature, in input order. */
  proposals: ProposedFeature[];
}

export interface AnnotateOptions {
  /**
   * Minimum per-feature IDENTITY (matched bases / MAPPED bases) for a feature
   * to be offered for transfer. A feature below this is reported as `unmapped`.
   * Default 0.7 (the aligned portion must be at least ~70% identical to be
   * considered "the same feature"). Configurable for stricter / looser
   * transfer. Completeness is governed separately by `coverageFloor`.
   */
  identityThreshold?: number;
  /**
   * Minimum COVERAGE (mapped positions / span length) for a feature to be
   * offered at all. Below this the feature is `unmapped`; at or above it but
   * below 1 the feature is `partial`. Default 0.5.
   */
  coverageFloor?: number;
  /** Gap-open penalty passed to the aligner (magnitude). Default engine value. */
  gapOpen?: number;
  /** Gap-extend penalty passed to the aligner (magnitude). Default engine value. */
  gapExtend?: number;
  /**
   * Alignment mode. "local" (default) finds the single best matching sub-region
   * (right for "this construct contains a piece of the parent"). "semiGlobal"
   * aligns the whole reference end-to-end against the best region of the open
   * sequence (right for "this construct IS the parent, lightly edited").
   */
  mode?: "local" | "semiGlobal";
}

export const DEFAULT_IDENTITY_THRESHOLD = 0.7;
export const DEFAULT_COVERAGE_FLOOR = 0.5;

/**
 * A reference-index -> open-index position map plus a matched flag per reference
 * position. Built by walking the alignment ops once.
 *
 * `openAt[r]` is the open-sequence index aligned to reference index `r`, or -1
 * when reference index `r` aligns to a gap in the open sequence (a deletion
 * relative to the open seq) OR falls outside the aligned region.
 *
 * `matchAt[r]` is true when reference index `r` aligned to an open base via an
 * 'M' (compatible) column, false otherwise.
 */
interface PositionMap {
  openAt: Int32Array;
  matchAt: Uint8Array;
  refLen: number;
}

/**
 * Build the reference->open position map from one alignment. The aligner is
 * called as align(open, reference), so in the AlignOp convention 'I' is an
 * insertion in the OPEN sequence (advances open only) and 'D' is a deletion
 * relative to the open sequence (advances reference only). We walk both cursors
 * forward through the aligned span, starting at the alignment's start offsets.
 */
function buildPositionMap(
  refLen: number,
  result: AlignmentResult,
): PositionMap {
  const openAt = new Int32Array(refLen).fill(-1);
  const matchAt = new Uint8Array(refLen);
  let openIdx = result.aStart; // cursor in the OPEN sequence (a)
  let refIdx = result.bStart; // cursor in the REFERENCE (b)
  for (const op of result.ops as AlignOp[]) {
    switch (op) {
      case "M":
      case "X":
        if (refIdx >= 0 && refIdx < refLen) {
          openAt[refIdx] = openIdx;
          matchAt[refIdx] = op === "M" ? 1 : 0;
        }
        openIdx += 1;
        refIdx += 1;
        break;
      case "I": // base in open only (gap in reference): advance open
        openIdx += 1;
        break;
      case "D": // base in reference only (gap in open): advance reference
        refIdx += 1;
        break;
    }
  }
  return { openAt, matchAt, refLen };
}

/** Map a single reference span [s, e) through the position map, returning the
 *  open-sequence [start, end) plus the matched / covered counts over the span. */
function mapSpan(
  map: PositionMap,
  s: number,
  e: number,
): { start: number; end: number; matched: number; covered: number; len: number } | null {
  const lo = Math.max(0, Math.min(s, e));
  const hi = Math.min(map.refLen, Math.max(s, e));
  const len = hi - lo;
  if (len <= 0) return null;
  let minOpen = Number.POSITIVE_INFINITY;
  let maxOpen = Number.NEGATIVE_INFINITY;
  let matched = 0;
  let covered = 0;
  for (let r = lo; r < hi; r++) {
    const o = map.openAt[r];
    if (o < 0) continue;
    covered += 1;
    if (map.matchAt[r]) matched += 1;
    if (o < minOpen) minOpen = o;
    if (o > maxOpen) maxOpen = o;
  }
  if (covered === 0) {
    return { start: 0, end: 0, matched: 0, covered: 0, len };
  }
  // Half-open end is the max mapped index + 1 (the mapped positions are
  // inclusive indices in the open sequence).
  return { start: minOpen, end: maxOpen + 1, matched, covered, len };
}

/** Flip a reference span [s, e) and strand onto the reference's reverse
 *  complement coordinate frame (length `refLen`). On the revcomp, position `p`
 *  becomes `refLen - 1 - p`, so the half-open span [s, e) becomes
 *  [refLen - e, refLen - s). Strand flips sign. */
function flipFeatureForRevcomp(
  f: ReferenceFeature,
  refLen: number,
): ReferenceFeature {
  const flipSpan = (s: number, e: number) => {
    const lo = Math.max(0, Math.min(s, e));
    const hi = Math.min(refLen, Math.max(s, e));
    return { start: refLen - hi, end: refLen - lo };
  };
  const main = flipSpan(f.start, f.end);
  const segments = f.segments?.map((seg) => flipSpan(seg.start, seg.end));
  // Reverse the segment ORDER too so segment[0] is still the 5' segment in the
  // flipped frame (keeps multi-segment joins coherent).
  if (segments) segments.reverse();
  return {
    ...f,
    start: main.start,
    end: main.end,
    strand: f.strand === -1 ? 1 : -1,
    segments,
  };
}

/**
 * Transfer features from a reference sequence onto the open sequence by
 * alignment.
 *
 * @param openSeq   the open document's bases (the target the features land on)
 * @param refSeq    the reference's bases
 * @param refFeatures the reference's features (0-based half-open coords)
 * @param options   identity threshold + alignment knobs (see AnnotateOptions)
 */
export function annotateFromReference(
  openSeq: string,
  refSeq: string,
  refFeatures: ReferenceFeature[],
  options: AnnotateOptions = {},
): AnnotateResult {
  const identityThreshold = options.identityThreshold ?? DEFAULT_IDENTITY_THRESHOLD;
  const coverageFloor = options.coverageFloor ?? DEFAULT_COVERAGE_FLOOR;
  const mode = options.mode ?? "local";
  const alignOpts = { gapOpen: options.gapOpen, gapExtend: options.gapExtend };
  const open = openSeq.toUpperCase();
  const ref = refSeq.toUpperCase();

  const align = mode === "semiGlobal" ? alignSemiGlobal : alignLocal;

  // Empty inputs: nothing maps.
  if (!open || !ref || refFeatures.length === 0) {
    return {
      referenceOrientation: "forward",
      overallIdentity: 0,
      proposals: refFeatures.map((f) => emptyProposal(f)),
    };
  }

  // Align open against the reference both ways; keep the higher-scoring strand.
  const fwd = align(open, ref, alignOpts);
  const refRc = reverseComplement(ref);
  const rev = align(open, refRc, alignOpts);

  const useReverse = rev.score > fwd.score;
  const chosen = useReverse ? rev : fwd;
  const refLen = ref.length;

  // On the reverse branch the alignment is open-vs-revcomp(ref), so the position
  // map is keyed by revcomp-frame reference indices, and features must be flipped
  // into that same frame before mapping.
  const map = buildPositionMap(refLen, chosen);
  const features = useReverse
    ? refFeatures.map((f) => flipFeatureForRevcomp(f, refLen))
    : refFeatures;

  const proposals = features.map((f, i): ProposedFeature => {
    const original = refFeatures[i];
    // Multi-segment: map each segment, union for the overall span; aggregate
    // matched/covered across segments.
    const segs = f.segments && f.segments.length > 1 ? f.segments : null;

    let mappedSegments: { start: number; end: number }[] | undefined;
    let matched = 0;
    let covered = 0;
    let len = 0;
    let minStart = Number.POSITIVE_INFINITY;
    let maxEnd = Number.NEGATIVE_INFINITY;

    const accumulate = (
      m: { start: number; end: number; matched: number; covered: number; len: number } | null,
    ) => {
      if (!m) return null;
      matched += m.matched;
      covered += m.covered;
      len += m.len;
      if (m.covered > 0) {
        if (m.start < minStart) minStart = m.start;
        if (m.end > maxEnd) maxEnd = m.end;
      }
      return m;
    };

    if (segs) {
      const out: { start: number; end: number }[] = [];
      for (const seg of segs) {
        const m = accumulate(mapSpan(map, seg.start, seg.end));
        if (m && m.covered > 0) out.push({ start: m.start, end: m.end });
      }
      mappedSegments = out.length > 1 ? out : undefined;
    } else {
      accumulate(mapSpan(map, f.start, f.end));
    }

    // Identity = quality over what mapped (matched / covered); coverage =
    // completeness over the whole span (covered / span length). Splitting these
    // lets a half-present-but-perfect feature transfer (identity 1, coverage
    // 0.5, flagged partial) instead of being rejected for low whole-span
    // identity.
    const identity = covered > 0 ? matched / covered : 0;
    const coverage = len > 0 ? covered / len : 0;
    const strand: 1 | -1 = f.strand === -1 ? -1 : 1;

    const unmapped = coverage < coverageFloor || identity < identityThreshold;
    const partial = !unmapped && coverage < 1;

    return {
      name: original.name,
      type: original.type,
      strand,
      start: covered > 0 ? minStart : 0,
      end: covered > 0 ? maxEnd : 0,
      segments: mappedSegments,
      color: original.color,
      notes: original.notes,
      identity,
      coverage,
      unmapped,
      partial,
    };
  });

  return {
    referenceOrientation: useReverse ? "reverse" : "forward",
    overallIdentity: chosen.identity,
    proposals,
  };
}

function emptyProposal(f: ReferenceFeature): ProposedFeature {
  return {
    name: f.name,
    type: f.type,
    strand: f.strand === -1 ? -1 : 1,
    start: 0,
    end: 0,
    color: f.color,
    notes: f.notes,
    identity: 0,
    coverage: 0,
    unmapped: true,
    partial: false,
  };
}
