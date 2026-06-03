// sequence Phase 2a bot — the EDITABLE DOCUMENT MODEL.
//
// The editor's source of truth while editing is a plain object we own: the bases
// string plus a feature list (each feature carries the bio-parsers fields we need
// to round-trip back to GenBank: name/type/strand/color/notes/locations). We feed
// `seq` + `annotations` derived from this to SeqViz, and on Save we serialize the
// model back to GenBank text via the vendored jsonToGenbank.
//
// Editing is three primitives — insert, delete, replace — each of which both
// splices the bases string AND remaps every feature interval via the pure
// coordinate-shift module. Those are the only ways the model changes.

import { genbankToJson, jsonToGenbank } from "@/vendor/bio-parsers";
import type { SeqType, SequenceDetail, SequenceAnnotation } from "../types";
import {
  shiftFeaturesOnDelete,
  shiftFeaturesOnInsert,
  type Interval,
} from "./coordinate-shift";

/** A feature in the editable model. Superset of what SeqViz renders + what
 *  jsonToGenbank needs to write the feature back out. */
export interface EditFeature extends Interval {
  name: string;
  start: number;
  end: number;
  strand?: 1 | -1;
  forward?: boolean;
  type?: string;
  color?: string;
  notes?: Record<string, unknown>;
  locations?: { start: number; end: number }[];
}

/** The editable document: bases + features + the metadata needed to re-serialize. */
export interface SeqDocument {
  name: string;
  seq: string;
  seqType: SeqType;
  circular: boolean;
  features: EditFeature[];
}

/** Build the editable document from a loaded SequenceDetail.
 *
 *  We re-parse the raw GenBank (not the lossy SequenceAnnotation summary) so the
 *  document keeps every feature field (strand/notes/locations/color) for a clean
 *  Save round-trip. Falls back to the SequenceDetail fields if the parse fails.
 */
export function documentFromDetail(detail: SequenceDetail): SeqDocument {
  const parsed = genbankToJson(detail.genbank, {}).find(
    (r) => r.success && r.parsedSequence,
  );
  if (parsed?.parsedSequence) {
    const p = parsed.parsedSequence;
    return {
      name: p.name || detail.display_name,
      seq: (p.sequence || detail.seq || "").toUpperCase(),
      seqType: detail.seq_type,
      circular: !!p.circular,
      features: (p.features || []).map((f) => ({
        name: f.name || "Untitled",
        start: f.start,
        end: f.end,
        strand: (f.strand === -1 ? -1 : 1) as 1 | -1,
        forward: f.strand !== -1,
        type: f.type,
        color: f.color,
        notes: (f.notes as Record<string, unknown>) || undefined,
        locations: Array.isArray((f as unknown as { locations?: unknown }).locations)
          ? ((f as unknown as { locations: { start: number; end: number }[] }).locations)
          : undefined,
      })),
    };
  }
  // Degraded fallback: use the already-parsed detail fields.
  return {
    name: detail.display_name,
    seq: detail.seq.toUpperCase(),
    seqType: detail.seq_type,
    circular: detail.circular,
    features: detail.annotations.map((a) => ({
      name: a.name,
      start: a.start,
      end: a.end,
      strand: (a.direction === -1 ? -1 : 1) as 1 | -1,
      forward: a.direction !== -1,
      type: a.type,
      color: a.color,
    })),
  };
}

/** Project the document's features down to the SeqViz `annotations` shape. */
export function documentToAnnotations(doc: SeqDocument): SequenceAnnotation[] {
  return doc.features.map((f) => ({
    name: f.name,
    start: f.start,
    end: f.end,
    direction: (f.strand === -1 ? -1 : 1) as -1 | 0 | 1,
    type: f.type,
    color: f.color,
  }));
}

/** Normalize/clamp a caret or selection index into [0, seq.length]. */
function clampIndex(i: number, len: number): number {
  if (i < 0) return 0;
  if (i > len) return len;
  return i;
}

/**
 * INSERT `text` at index `at` (caret position). Returns a NEW document; the
 * input is untouched. Bases are uppercased to match the store convention.
 */
export function insertBases(doc: SeqDocument, at: number, text: string): SeqDocument {
  if (!text) return doc;
  const bases = text.toUpperCase();
  const i = clampIndex(at, doc.seq.length);
  const seq = doc.seq.slice(0, i) + bases + doc.seq.slice(i);
  const features = shiftFeaturesOnInsert(doc.features, i, bases.length);
  return { ...doc, seq, features };
}

/**
 * DELETE the half-open range [from, from+count). Returns a NEW document.
 * Features fully inside the deleted span are dropped.
 */
export function deleteBases(doc: SeqDocument, from: number, count: number): SeqDocument {
  if (count <= 0) return doc;
  const start = clampIndex(from, doc.seq.length);
  const len = Math.min(count, doc.seq.length - start);
  if (len <= 0) return doc;
  const seq = doc.seq.slice(0, start) + doc.seq.slice(start + len);
  const features = shiftFeaturesOnDelete(doc.features, start, len, {
    dropCollapsed: true,
  });
  return { ...doc, seq, features };
}

/**
 * REPLACE the selected range [from, to) with `text`: delete then insert. This
 * is the "selection + type" path. `to` is exclusive.
 */
export function replaceBases(
  doc: SeqDocument,
  from: number,
  to: number,
  text: string,
): SeqDocument {
  const lo = clampIndex(Math.min(from, to), doc.seq.length);
  const hi = clampIndex(Math.max(from, to), doc.seq.length);
  const afterDelete = deleteBases(doc, lo, hi - lo);
  return insertBases(afterDelete, lo, text);
}

/**
 * Serialize the document back to GenBank text for the on-disk `.gb`. Returns
 * null if the writer fails (so callers can refuse to Save a corrupt round-trip).
 */
export function documentToGenbank(doc: SeqDocument): string | null {
  const out = jsonToGenbank(
    {
      name: doc.name || "Untitled",
      sequence: doc.seq,
      circular: doc.circular,
      type: doc.seqType === "protein" ? "PROTEIN" : doc.seqType === "rna" ? "RNA" : "DNA",
      features: doc.features.map((f) => ({
        name: f.name,
        start: f.start,
        end: f.end,
        strand: f.strand === -1 ? -1 : 1,
        type: f.type,
        color: f.color,
        notes: f.notes,
        ...(f.locations && f.locations.length > 1 ? { locations: f.locations } : {}),
      })),
    },
    {},
  );
  return typeof out === "string" ? out : null;
}

/** GC content of a sub-range [start, end) of the sequence, as a percentage
 *  (0-100). Counts G/C/S (strong) bases over A/C/G/T/U/S/W. Non-base chars are
 *  ignored in the denominator so ambiguity codes don't skew it wildly. */
export function gcPercent(seq: string, start = 0, end = seq.length): number {
  const sub = seq.slice(Math.max(0, start), Math.max(0, end)).toUpperCase();
  let gc = 0;
  let counted = 0;
  for (const ch of sub) {
    if (ch === "A" || ch === "T" || ch === "U" || ch === "G" || ch === "C" || ch === "S" || ch === "W") {
      counted += 1;
      if (ch === "G" || ch === "C" || ch === "S") gc += 1;
    }
  }
  if (counted === 0) return 0;
  return (gc / counted) * 100;
}
