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
import {
  apEinfoColorNotes,
  readApEinfoColor,
  resolveFeatureColor,
} from "./feature-colors";

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
  // `primersAsFeatures: true` keeps primer_bind features INSIDE `features`
  // rather than being split out into a separate top-level `primers` array
  // (the bio-parsers default). The editable model treats primers as ordinary
  // features (the Primers view layer + the feature list both derive from
  // `doc.features`), so without this flag a saved primer_bind would vanish from
  // the document on the next load. See SEQUENCE_EDITOR_PROPOSAL primer design.
  const parsed = genbankToJson(detail.genbank, { primersAsFeatures: true }).find(
    (r) => r.success && r.parsedSequence,
  );
  if (parsed?.parsedSequence) {
    const p = parsed.parsedSequence;
    return {
      name: p.name || detail.display_name,
      seq: (p.sequence || detail.seq || "").toUpperCase(),
      seqType: detail.seq_type,
      circular: !!p.circular,
      features: (p.features || []).map((f) => {
        const strand = (f.strand === -1 ? -1 : 1) as 1 | -1;
        const notes = (f.notes as Record<string, unknown>) || undefined;
        // bio-parsers promotes a `/color=` qualifier to `f.color` but NOT the
        // SnapGene/ApE `/ApEinfo_fwdcolor`/`/ApEinfo_revcolor` qualifiers, so
        // pick those up here (our on-disk files use ApEinfo).
        const color = f.color || readApEinfoColor(notes, strand);
        return {
          name: f.name || "Untitled",
          start: f.start,
          end: f.end,
          strand,
          forward: f.strand !== -1,
          type: f.type,
          color,
          notes,
          locations: Array.isArray((f as unknown as { locations?: unknown }).locations)
            ? ((f as unknown as { locations: { start: number; end: number }[] }).locations)
            : undefined,
        };
      }),
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

/** Project the document's features down to the SeqViz `annotations` shape.
 *
 *  primer style bot — `primer_bind` features are EXCLUDED from the annotation
 *  layer on purpose. Primers get their own dedicated, lightweight renderer (the
 *  SeqViz `primers` prop / vendored Primers layer drawing a thin SnapGene-style
 *  annealing bracket), so projecting them here too would double-draw each primer
 *  as a filled feature block-arrow ("mini gene"). They still live in
 *  `doc.features`, so they remain in the Features list, the Primers list, and
 *  serialize back to GenBank — only this on-map annotation projection drops them.
 */
export function documentToAnnotations(doc: SeqDocument): SequenceAnnotation[] {
  const seqLen = doc.seq.length;
  return doc.features
    .filter((f) => (f.type || "").toLowerCase() !== "primer_bind")
    .map((f) => {
      // Defensive render-boundary clamp: an out-of-range coordinate stored on
      // disk (e.g. from a bug, import, or legacy file) must never reach the
      // SeqViz renderer. Coordinates outside [0, seqLen] cause infinite loops
      // or NaN geometry in the SVG/canvas layout code. We clamp silently here;
      // the editor dialog's submit path already blocks the bad value from being
      // written through validateAllSegments.
      const start = Math.max(0, Math.min(f.start, seqLen));
      const end = Math.max(start, Math.min(f.end, seqLen));
      // Also clamp any explicit multi-segment locations so a join() with a bad
      // exon coordinate does not reach the renderer either.
      const rawLocations = f.locations && f.locations.length > 1 ? f.locations : undefined;
      const safeLocations = rawLocations
        ? rawLocations
            .map((l) => ({
              start: Math.max(0, Math.min(l.start, seqLen)),
              end: Math.max(0, Math.min(l.end, seqLen)),
            }))
            .filter((l) => l.end > l.start)
        : undefined;
      return {
        name: f.name,
        start,
        end,
        direction: (f.strand === -1 ? -1 : 1) as -1 | 0 | 1,
        type: f.type,
        // Resolve to a concrete color (explicit color, else the per-type default)
        // so the viewer + features list always render a consistent swatch.
        color: resolveFeatureColor(f),
        // seq introns bot — carry exon spans for multi-segment (join) features so
        // the viewer can draw exon boxes + dashed intron connectors and splice the
        // translation. Single-span features omit this and render exactly as before.
        ...(safeLocations && safeLocations.length > 1 ? { segments: safeLocations } : {}),
      };
    });
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
      features: doc.features.map((f) => {
        // Persist color via the ApEinfo qualifiers so it survives save+reload
        // and round-trips with SnapGene / ApE. Merge into (not replace) any
        // existing notes, overwriting only the two ApEinfo color keys.
        const baseNotes = (f.notes as Record<string, unknown>) || undefined;
        const notes = f.color
          ? { ...(baseNotes || {}), ...apEinfoColorNotes(f.color) }
          : baseNotes;
        return {
          name: f.name,
          start: f.start,
          end: f.end,
          strand: f.strand === -1 ? -1 : 1,
          type: f.type,
          color: f.color,
          notes,
          ...(f.locations && f.locations.length > 1 ? { locations: f.locations } : {}),
        };
      }),
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
