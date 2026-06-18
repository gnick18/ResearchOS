// sequence Phase 2b bot — ANNOTATED CLIPBOARD pure logic (copy clip/rebase +
// paste merge/shift). NO React, NO disk, NO SeqViz. The correctness core of the
// SnapGene-style copy/cut/paste, sibling to coordinate-shift.ts and heavily
// unit-tested (clipboard.test.ts).
//
// COORDINATE MODEL (matches edit-model + coordinate-shift)
// --------------------------------------------------------
// Features carry half-open [start, end) intervals over the bases string. A
// COPY of the selection [lo, hi) produces a payload whose bases are
// seq.slice(lo, hi) and whose features are every feature that OVERLAPS [lo, hi),
// CLIPPED to the selection and REBASED so the selection's lo becomes index 0.
// A PASTE at index `at` splices the payload bases into the document and shifts
// downstream coordinates via the existing coordinate-shift module, then adds the
// payload's features with `at` added back to their rebased coordinates.

import type { EditFeature, SeqDocument } from "./edit-model";
import { insertBases } from "./edit-model";
import { isValidResidue } from "./residue-alphabet";

/** A self-contained, app-scoped molecular clipboard payload. */
export interface MolecularClip {
  /** The copied bases (uppercase), rebased to 0. */
  seq: string;
  /** Features overlapping the selection, clipped to it and rebased to 0. */
  features: EditFeature[];
  /** Source sequence type, so paste can warn on a DNA-into-protein mismatch
   *  later if we want; carried for provenance, not currently enforced. */
  seqType: SeqDocument["seqType"];
  /** Display name of the source sequence (for the confirmation copy). */
  sourceName: string;
}

/** Describes how a single feature is affected by a delete/cut of a range. */
export interface AffectedFeature {
  name: string;
  /** "removed" = fully inside the cut (will disappear); "trimmed" = partially
   *  overlapping (survives, shorter). */
  effect: "removed" | "trimmed";
}

/**
 * CLIP + REBASE a selection [lo, hi) of a document into a molecular clip.
 *
 * A feature is included if it OVERLAPS the selection at all (its clipped span is
 * non-empty). Its start/end (and any multi-segment locations) are intersected
 * with [lo, hi) and then shifted left by `lo` so the clip is rebased to 0.
 * Features entirely outside the selection are dropped.
 */
export function clipSelection(doc: SeqDocument, lo: number, hi: number): MolecularClip {
  const a = Math.max(0, Math.min(lo, hi));
  const b = Math.min(doc.seq.length, Math.max(lo, hi));
  const seq = doc.seq.slice(a, b);

  const features: EditFeature[] = [];
  for (const f of doc.features) {
    const start = Math.max(f.start, a);
    const end = Math.min(f.end, b);
    if (end <= start) continue; // no overlap with the selection

    const clipped: EditFeature = {
      ...f,
      start: start - a,
      end: end - a,
    };
    if (Array.isArray(f.locations)) {
      const locs = f.locations
        .map((loc) => ({
          start: Math.max(loc.start, a) - a,
          end: Math.min(loc.end, b) - a,
        }))
        .filter((loc) => loc.end > loc.start);
      clipped.locations = locs.length > 0 ? locs : undefined;
    }
    features.push(clipped);
  }

  return { seq, features, seqType: doc.seqType, sourceName: doc.name };
}

/**
 * Which features a delete/cut of [lo, hi) touches, classified for the
 * confirmation dialog. A feature FULLY inside the cut is "removed"; one that
 * partially overlaps is "trimmed". Features outside the cut are not listed.
 */
export function affectedFeatures(doc: SeqDocument, lo: number, hi: number): AffectedFeature[] {
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  const out: AffectedFeature[] = [];
  for (const f of doc.features) {
    if (f.end <= a || f.start >= b) continue; // no overlap
    const fullyInside = f.start >= a && f.end <= b;
    out.push({ name: f.name, effect: fullyInside ? "removed" : "trimmed" });
  }
  return out;
}

/**
 * PASTE a molecular clip into the document at index `at`. Splices the clip's
 * bases (shifting downstream coordinates via the shared insert path) and then
 * adds the clip's features rebased FROM 0 back to the insertion point.
 *
 * Reuses `insertBases` (which itself reuses coordinate-shift) so existing
 * features shift identically to a typed insert; the carried features are simply
 * offset by `at`.
 */
export function pasteClip(doc: SeqDocument, at: number, clip: MolecularClip): SeqDocument {
  if (!clip.seq) return doc;
  const i = Math.max(0, Math.min(at, doc.seq.length));
  // Insert the bases first — this shifts every existing downstream feature.
  const withBases = insertBases(doc, i, clip.seq);
  // Offset the carried features back from rebased-0 to the insertion point.
  const carried: EditFeature[] = clip.features.map((f) => ({
    ...f,
    start: f.start + i,
    end: f.end + i,
    locations: Array.isArray(f.locations)
      ? f.locations.map((loc) => ({ start: loc.start + i, end: loc.end + i }))
      : undefined,
  }));
  return { ...withBases, features: [...withBases.features, ...carried] };
}

/**
 * Sanitize raw clipboard text into a paste-able base string for the document's
 * sequence type. Strips whitespace, uppercases, and KEEPS only valid base
 * letters (IUPAC nucleotide codes for DNA/RNA, amino-acid letters for protein).
 * Returns the cleaned bases plus how many characters were dropped, so the caller
 * can warn the user that the paste was filtered.
 */
export function sanitizeRawSequence(
  text: string,
  seqType: SeqDocument["seqType"],
): { bases: string; dropped: number } {
  const upper = text.toUpperCase();
  // The valid alphabet (IUPAC nucleotide codes incl. ambiguity + gap, or the
  // amino-acid letters incl. B/Z/X/U/O and the stop) lives in residue-alphabet
  // so the paste path and the keystroke path stay in lockstep.
  let bases = "";
  let dropped = 0;
  for (const ch of upper) {
    if (/\s/.test(ch)) continue; // whitespace is silently ignored, not "dropped"
    if (isValidResidue(ch, seqType)) bases += ch;
    else dropped += 1;
  }
  return { bases, dropped };
}
