// cloning coworker (BeakerAI). PURE region-extraction engine.
//
// The ONE small new biology helper the cloning tool suite needs: pull a REGION
// out of an existing sequence as a new standalone sequence. A wrong slice or a
// wrong strand is a real molecular-biology bug, so this is pure, deterministic,
// DOM-free, and unit-tested (extract-region.test.ts). The tool layer wraps it;
// it never re-derives the slice itself.
//
// WHAT IT DOES
// ------------
// Given a parsed sequence (its bases + annotations) and a target, return:
//   - the sub-sequence bases, reverse-complemented when the target is on the
//     minus strand (so the returned bases read 5'->3' on the extracted molecule),
//   - the annotations that OVERLAP the region, clipped to the window and rebased
//     to the new molecule's 0-based coordinates (mirrored + strand-flipped on a
//     minus-strand extraction).
//
// COORDINATES
// -----------
// SequenceAnnotation uses the app's 0-based, end-INCLUSIVE convention (the
// bio-parsers default, same as cloning-io.ts annotationsToCloneFeatures). The
// COORDINATE target the caller passes is a half-open [start, end) on the source
// forward strand (matching the rest of the BeakerBot sequence tools, e.g.
// design_primers regionStart / regionEnd). We translate at the boundary: a
// feature target's inclusive end becomes exclusive (end + 1) for the window math,
// and every output annotation is converted back to an inclusive end so it feeds
// the library round-trip cleanly. A by-feature-name target resolves to that
// feature's own span and inherits its direction as the extraction strand (so
// "pull the CDS" gives the CDS oriented 5'->3').
//
// Voice in comments, no em-dashes, no emojis, no mid-sentence colons.

import { reverseComplement } from "./primer";
import type { SequenceAnnotation, SequenceDetail } from "../types";

/** How the caller picks the region to extract. */
export type ExtractTarget =
  | {
      /** A feature name to match against the source annotations (case-insensitive,
       *  first match wins). The matched feature's span AND direction are used. */
      featureName: string;
    }
  | {
      /** 0-based inclusive start on the source forward strand. */
      start: number;
      /** 0-based exclusive end on the source forward strand. */
      end: number;
      /** Extraction strand: 1 forward (default), -1 reverse-complement. */
      strand?: 1 | -1;
    };

/** What extractRegion returns: the new bases plus rebased annotations and the
 *  resolved source window (so the tool can describe what it cut). */
export interface ExtractedRegion {
  /** The extracted bases, 5'->3' on the new molecule (revcomp'd when strand -1). */
  seq: string;
  /** Annotations overlapping the window, clipped + rebased to the new molecule. */
  annotations: SequenceAnnotation[];
  /** The resolved source window [start, end) on the source forward strand. */
  sourceStart: number;
  sourceEnd: number;
  /** The strand the region was read on (1 forward, -1 reverse-complement). */
  strand: 1 | -1;
  /** When the target was a feature name, the name that matched (for the card). */
  featureName?: string;
}

/** A resolved-or-errored extraction window. */
type ResolvedTarget =
  | { ok: true; start: number; end: number; strand: 1 | -1; featureName?: string }
  | { ok: false; error: string };

/** Resolve an ExtractTarget against a source detail to a concrete window. Pure. */
function resolveTarget(
  detail: SequenceDetail,
  target: ExtractTarget,
): ResolvedTarget {
  const len = detail.seq.length;

  if ("featureName" in target) {
    const want = target.featureName.trim().toLowerCase();
    if (!want) {
      return { ok: false, error: "Provide a feature name to extract." };
    }
    const feat = detail.annotations.find(
      (a) => (a.name || "").trim().toLowerCase() === want,
    );
    if (!feat) {
      return {
        ok: false,
        error: `No feature named "${target.featureName}" was found on this sequence.`,
      };
    }
    // A minus-strand feature extracts as its reverse complement so the result
    // reads 5'->3' as the gene; direction 0 is treated as forward. The feature's
    // end is INCLUSIVE, so the half-open window end is feat.end + 1.
    const strand: 1 | -1 = feat.direction === -1 ? -1 : 1;
    return {
      ok: true,
      start: feat.start,
      end: Math.min(feat.end + 1, len),
      strand,
      featureName: feat.name || target.featureName,
    };
  }

  const start = Math.round(target.start);
  const end = Math.round(target.end);
  const strand: 1 | -1 = target.strand === -1 ? -1 : 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > len || start >= end) {
    return {
      ok: false,
      error: `Region [${start}, ${end}) is invalid for a sequence of length ${len}.`,
    };
  }
  return { ok: true, start, end, strand };
}

/**
 * Extract a region from a parsed sequence as a new standalone sequence.
 *
 * Returns the sub-sequence bases (reverse-complemented when strand is -1) and the
 * overlapping annotations clipped to the window and rebased to the new molecule's
 * 0-based coordinates. PURE and DETERMINISTIC. Returns an `{ error }` instead of
 * throwing when the target cannot be resolved (unknown feature, bad coordinates).
 */
export function extractRegion(
  detail: SequenceDetail,
  target: ExtractTarget,
): ExtractedRegion | { error: string } {
  const resolved = resolveTarget(detail, target);
  if (!resolved.ok) return { error: resolved.error };

  const { start, end, strand } = resolved;
  const windowLen = end - start;
  const forwardSlice = detail.seq.slice(start, end).toUpperCase();
  const seq = strand === -1 ? reverseComplement(forwardSlice) : forwardSlice;

  // Clip each overlapping annotation to the half-open window [start, end), then
  // rebase to the new molecule. Annotation ends are INCLUSIVE on input, so we
  // work in a half-open frame (exEnd = a.end + 1) and convert the rebased span
  // back to an inclusive end (out.end = exclusiveEnd - 1) on output. For a
  // forward extraction the coordinate shift is -start. For a reverse extraction
  // the window is mirrored (windowLen - offset) and the direction is flipped, so
  // a feature on the source minus strand reads forward on the extracted molecule.
  const annotations: SequenceAnnotation[] = [];
  for (const a of detail.annotations) {
    const aExEnd = a.end + 1; // inclusive -> exclusive
    const clStart = Math.max(a.start, start);
    const clEnd = Math.min(aExEnd, end);
    if (clEnd <= clStart) continue; // No overlap with the window.
    if (strand === 1) {
      const newStart = clStart - start;
      const newExEnd = clEnd - start;
      annotations.push({
        ...a,
        start: newStart,
        end: newExEnd - 1, // exclusive -> inclusive
        // segments are dropped on a clip; the slice is a single contiguous span.
        segments: undefined,
      });
    } else {
      const mirStart = windowLen - (clEnd - start);
      const mirExEnd = windowLen - (clStart - start);
      const dir: -1 | 0 | 1 =
        a.direction === 0 ? 0 : a.direction === 1 ? -1 : 1;
      annotations.push({
        ...a,
        start: mirStart,
        end: mirExEnd - 1, // exclusive -> inclusive
        direction: dir,
        segments: undefined,
      });
    }
  }

  return {
    seq,
    annotations,
    sourceStart: start,
    sourceEnd: end,
    strand,
    featureName: resolved.featureName,
  };
}
