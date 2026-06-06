// seq editops bot — pure logic for the SnapGene-style "Edit menu" operations
// surfaced in the sequence editor (context menu + keyboard shortcuts + the
// "Edit" toolbar dropdown). NO React, NO disk, NO DOM. The correctness core,
// sibling to clipboard.ts / coordinate-shift.ts and unit-tested in
// edit-ops.test.ts.
//
// These build on the existing molecular clipboard (MolecularClip), the editable
// document model (SeqDocument), and the vendored seqviz sequence utilities
// (reverseComplement / translate). The React component layer (SequenceEditView +
// SequenceEditMenu) wires them to selection state, the undo stack, and the OS
// clipboard.

import { complement, reverseComplement, translate } from "@/vendor/seqviz/sequence";
import type { SeqType as ViewerSeqType } from "@/vendor/seqviz/elements";
import type { SeqType } from "../types";
import type { SeqDocument } from "./edit-model";
import type { MolecularClip } from "./clipboard";

/** Map our document SeqType ("protein") to the viewer's SeqType ("aa"), which is
 *  what the vendored reverseComplement / translate expect. */
export function toViewerSeqType(seqType: SeqType): ViewerSeqType {
  return seqType === "protein" ? "aa" : seqType;
}

/**
 * COPY BOTTOM STRAND: the reverse complement of the selected bases, 5'->3' on the
 * bottom strand. For a selection of the top strand reading 5'->3', the bottom
 * strand read 5'->3' is the reverse complement. For protein/aa there is no
 * complement, so we return the bases unchanged (the viewer util filters them out
 * otherwise); callers gate this op to DNA/RNA anyway.
 */
export function copyBottomStrand(bases: string, seqType: SeqType): string {
  const vt = toViewerSeqType(seqType);
  if (vt === "aa") return bases;
  return reverseComplement(bases, vt);
}

/**
 * COPY BOTTOM STRAND 3' to 5': the complement of the selected top strand bases in
 * the SAME left-to-right order (no reversal). This is the bottom strand drawn
 * directly under the top strand, which therefore reads 3' to 5' from left to
 * right. For protein/aa there is no complement, so we return the bases unchanged
 * (mirroring copyBottomStrand); callers gate this op to DNA/RNA anyway.
 */
export function copyBottomStrand3to5(bases: string, seqType: SeqType): string {
  const vt = toViewerSeqType(seqType);
  if (vt === "aa") return bases;
  return complement(bases, vt).compSeq;
}

/**
 * COPY AMINO ACIDS: translate the selected bases in reading frame 1 (the first
 * base of the selection is codon position 1). Trailing 1-2 bases that don't form
 * a full codon are dropped, matching the vendored translate().
 */
export function copyAminoAcids(bases: string, seqType: SeqType): string {
  return translate(bases, toViewerSeqType(seqType));
}

/** 1-letter to 3-letter amino acid codes. Stop ("*") maps to "Ter". */
const AA_ONE_TO_THREE: Record<string, string> = {
  A: "Ala",
  R: "Arg",
  N: "Asn",
  D: "Asp",
  C: "Cys",
  Q: "Gln",
  E: "Glu",
  G: "Gly",
  H: "His",
  I: "Ile",
  L: "Leu",
  K: "Lys",
  M: "Met",
  F: "Phe",
  P: "Pro",
  S: "Ser",
  T: "Thr",
  W: "Trp",
  Y: "Tyr",
  V: "Val",
  "*": "Ter",
};

/**
 * COPY AMINO ACIDS (3-letter): the same frame-1 translation as copyAminoAcids,
 * rendered as space-separated 3-letter codes (Met Val Ser ...). A stop codon
 * renders as "Ter". Reuses copyAminoAcids so the 1-letter and 3-letter variants
 * never disagree on residues. Any unrecognized residue is passed through as-is.
 */
export function copyAminoAcids3Letter(bases: string, seqType: SeqType): string {
  const oneLetter = copyAminoAcids(bases, seqType);
  if (!oneLetter) return "";
  return oneLetter
    .split("")
    .map((aa) => AA_ONE_TO_THREE[aa] ?? aa)
    .join(" ");
}

/**
 * Reverse-complement a MolecularClip for "Paste Reverse Complement": the bases
 * become their reverse complement, and every carried feature is re-based onto the
 * flipped coordinate frame (a feature at [s, e) over a clip of length L lands at
 * [L-e, L-s)) with its strand flipped. Multi-segment locations are flipped the
 * same way and re-sorted ascending. Protein clips have no complement, so the
 * bases are returned reversed without complementing (callers gate to DNA/RNA).
 */
export function reverseComplementClip(clip: MolecularClip): MolecularClip {
  const vt = toViewerSeqType(clip.seqType);
  const L = clip.seq.length;
  const seq = vt === "aa" ? clip.seq.split("").reverse().join("") : reverseComplement(clip.seq, vt);

  const features = clip.features.map((f) => {
    const flip = (s: number, e: number) => ({ start: L - e, end: L - s });
    const main = flip(f.start, f.end);
    const locations = Array.isArray(f.locations)
      ? f.locations
          .map((loc) => flip(loc.start, loc.end))
          .sort((a, b) => a.start - b.start)
      : undefined;
    return {
      ...f,
      start: main.start,
      end: main.end,
      strand: (f.strand === -1 ? 1 : -1) as 1 | -1,
      forward: f.strand === -1,
      locations,
    };
  });

  return { ...clip, seq, features };
}

/**
 * INVERT SELECTION: given the current selection [lo, hi) over a sequence of
 * length `len`, return the complementary span(s). A selection in the middle
 * splits the complement into two pieces ([0, lo) and [hi, len)); since the editor
 * carries a single contiguous selection, we return the LARGER of the two pieces
 * (the most useful single span), plus the full list for callers that can use it.
 * If nothing is selected, the inverse is the whole sequence. If everything is
 * selected, there is no inverse (returns null span / empty list).
 */
export function invertSelection(
  lo: number,
  hi: number,
  len: number,
): { span: { start: number; end: number } | null; pieces: { start: number; end: number }[] } {
  const a = Math.max(0, Math.min(lo, hi));
  const b = Math.min(len, Math.max(lo, hi));
  // No range selected -> invert to the whole sequence.
  if (b <= a) {
    return len > 0
      ? { span: { start: 0, end: len }, pieces: [{ start: 0, end: len }] }
      : { span: null, pieces: [] };
  }
  const pieces: { start: number; end: number }[] = [];
  if (a > 0) pieces.push({ start: 0, end: a });
  if (b < len) pieces.push({ start: b, end: len });
  if (pieces.length === 0) return { span: null, pieces: [] };
  // Pick the larger piece as the single contiguous selection.
  const span = pieces.reduce((best, p) => (p.end - p.start > best.end - best.start ? p : best), pieces[0]);
  return { span, pieces };
}

/**
 * Parse a "Select Range" user input into a half-open [start, end) span over a
 * sequence of length `len`. Accepts 1-based, inclusive user coordinates in the
 * forms "start..end", "start-end", "start end", or "start, end" (SnapGene-style),
 * or a single position "n" (selects that one base). Returns null on unparseable
 * or out-of-range input. The result is clamped to [0, len] and normalized so
 * start <= end.
 */
export function parseSelectRange(
  input: string,
  len: number,
): { start: number; end: number } | null {
  if (!input) return null;
  const nums = input
    .trim()
    .split(/\s*(?:\.\.|[-,\s])\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (nums.length === 0 || nums.length > 2) return null;
  const parsed = nums.map((s) => Number.parseInt(s, 10));
  if (parsed.some((n) => !Number.isFinite(n))) return null;

  let oneStart: number;
  let oneEnd: number;
  if (parsed.length === 1) {
    oneStart = parsed[0];
    oneEnd = parsed[0];
  } else {
    oneStart = Math.min(parsed[0], parsed[1]);
    oneEnd = Math.max(parsed[0], parsed[1]);
  }
  // 1-based inclusive -> 0-based half-open.
  if (oneStart < 1 || oneEnd < 1) return null;
  if (oneStart > len) return null;
  const start = Math.max(0, oneStart - 1);
  const end = Math.min(len, oneEnd);
  if (end <= start) return null;
  return { start, end };
}

/**
 * Parse a "Go To" coordinate (1-based) into a 0-based base index in [0, len-1].
 * Returns null on unparseable / out-of-range input.
 */
export function parseGoTo(input: string, len: number): number | null {
  if (!input) return null;
  const n = Number.parseInt(input.trim(), 10);
  if (!Number.isFinite(n)) return null;
  if (n < 1 || n > len) return null;
  return n - 1;
}

/**
 * CASE TRANSFORM the bases of a document over the half-open range [lo, hi) to
 * upper or lower case, returning a NEW document (features unchanged — only the
 * letter case of the bases changes, no coordinate shift). Used by Make
 * Uppercase / Make Lowercase. NOTE: this is the one edit path that intentionally
 * does NOT force-uppercase (unlike insertBases/replaceBases), so lowercase
 * survives in the in-editor document; it is normalized back on GenBank save.
 */
export function caseTransform(
  doc: SeqDocument,
  lo: number,
  hi: number,
  to: "upper" | "lower",
): SeqDocument {
  const a = Math.max(0, Math.min(lo, hi));
  const b = Math.min(doc.seq.length, Math.max(lo, hi));
  if (b <= a) return doc;
  const slice = doc.seq.slice(a, b);
  const transformed = to === "upper" ? slice.toUpperCase() : slice.toLowerCase();
  if (transformed === slice) return doc;
  const seq = doc.seq.slice(0, a) + transformed + doc.seq.slice(b);
  return { ...doc, seq };
}

/**
 * REVERSE-COMPLEMENT IN PLACE the bases of a document over the half-open range
 * [lo, hi), returning a NEW document. The slice is replaced with its reverse
 * complement of the SAME length, so there is no coordinate shift and the features
 * keep their positions (their bases just read the opposite strand now). This is
 * the "Reverse complement in place" selection action, a single undoable edit.
 *
 * For a protein/aa document there is no complement, so the slice is reversed
 * without complementing (callers gate this to DNA/RNA anyway). An empty or
 * degenerate range returns the document unchanged.
 */
export function reverseComplementRange(
  doc: SeqDocument,
  lo: number,
  hi: number,
): SeqDocument {
  const a = Math.max(0, Math.min(lo, hi));
  const b = Math.min(doc.seq.length, Math.max(lo, hi));
  if (b <= a) return doc;
  const slice = doc.seq.slice(a, b);
  const vt = toViewerSeqType(doc.seqType);
  const flipped =
    vt === "aa" ? slice.split("").reverse().join("") : reverseComplement(slice, vt);
  if (flipped === slice) return doc;
  const seq = doc.seq.slice(0, a) + flipped + doc.seq.slice(b);
  return { ...doc, seq };
}
