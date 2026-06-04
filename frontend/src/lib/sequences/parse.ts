// sequence Phase 1 bot — bridge between the vendored bio-parsers and the
// app-facing Sequence types. Parses a GenBank string into the summary
// (SequenceRecord) and full (SequenceDetail) shapes, and derives the molecule
// kind for new records.

import { genbankToJson } from "@/vendor/bio-parsers";
import { readApEinfoColor } from "./feature-colors";
import type {
  SeqType,
  SequenceAnnotation,
  SequenceMeta,
  SequenceRecord,
  SequenceDetail,
} from "../types";

/** Derive a SeqType from a parsed sequence's flags + bases. */
export function deriveSeqType(parsed: {
  type?: string;
  sequence: string;
}): SeqType {
  const t = (parsed.type || "").toUpperCase();
  if (t === "PROTEIN" || t === "AA") return "protein";
  if (t === "RNA") return "rna";
  // Fall back to a base-composition guess: any U (and no T) ⇒ RNA.
  const s = (parsed.sequence || "").toUpperCase();
  if (s.includes("U") && !s.includes("T")) return "rna";
  return "dna";
}

function toDirection(strand: unknown): -1 | 0 | 1 {
  if (strand === -1 || strand === "-1") return -1;
  if (strand === 1 || strand === "1") return 1;
  return 0;
}

/**
 * Parse a GenBank string into a SequenceDetail, combining it with the sidecar
 * metadata. Returns null if the GenBank could not be parsed into any record.
 */
export function genbankToDetail(
  genbank: string,
  meta: SequenceMeta,
): SequenceDetail | null {
  const results = genbankToJson(genbank, {});
  const first = results.find((r) => r.success && r.parsedSequence);
  if (!first || !first.parsedSequence) return null;
  const p = first.parsedSequence;
  const seq = (p.sequence || "").toUpperCase();
  const annotations: SequenceAnnotation[] = (p.features || []).map((f) => {
    const dir = toDirection(f.strand);
    // bio-parsers reads `/color=` but not the SnapGene/ApE ApEinfo color
    // qualifiers; promote those here so the read view + library show colors.
    const color =
      f.color ??
      readApEinfoColor(
        f.notes as Record<string, unknown> | undefined,
        dir === -1 ? -1 : 1,
      );
    return {
      name: f.name || "Untitled",
      start: f.start,
      end: f.end,
      direction: dir,
      type: f.type,
      color,
    };
  });
  return {
    id: meta.id,
    display_name: meta.display_name,
    project_ids: meta.project_ids,
    added_at: meta.added_at,
    seq_type: meta.seq_type,
    length: seq.length,
    circular: !!p.circular,
    feature_count: annotations.length,
    // Cross-boundary provenance, carried through from the sidecar (undefined on
    // a native sequence so the ReceivedFromBadge self-hides).
    received_from: meta.received_from,
    received_from_fingerprint: meta.received_from_fingerprint,
    received_at: meta.received_at,
    // restore audit bot: deleted/restored provenance, carried from the sidecar
    // (undefined on a never-trashed sequence so the RestoredBadge self-hides).
    _restore_audit: meta._restore_audit,
    genbank,
    seq,
    annotations,
    locus_name: p.name || meta.display_name,
  };
}

/** Parse a GenBank string into the light SequenceRecord summary. */
export function genbankToRecord(
  genbank: string,
  meta: SequenceMeta,
): SequenceRecord {
  const detail = genbankToDetail(genbank, meta);
  if (detail) {
    // Strip the heavy fields for the summary shape.
    const { genbank: _g, seq: _s, annotations: _a, locus_name: _l, ...record } =
      detail;
    return record;
  }
  // Unparseable GenBank: surface a degraded record rather than dropping it, so
  // the library still lists the file and the user can investigate.
  return {
    id: meta.id,
    display_name: meta.display_name,
    project_ids: meta.project_ids,
    added_at: meta.added_at,
    seq_type: meta.seq_type,
    length: 0,
    circular: false,
    feature_count: 0,
    received_from: meta.received_from,
    received_from_fingerprint: meta.received_from_fingerprint,
    received_at: meta.received_at,
    _restore_audit: meta._restore_audit,
  };
}
