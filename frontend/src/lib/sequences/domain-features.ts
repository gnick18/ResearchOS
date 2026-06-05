// sequence editor master. DOMAIN HIT -> EDITABLE FEATURE mapping (pure).
//
// An InterProScan DomainHit is a span of PROTEIN residues. To draw it on the map
// and round-trip it to GenBank we map that residue span back onto the CDS's DNA,
// honoring strand AND exon joins exactly the way translateFeature read the
// protein in the first place (exons concatenated left-to-right in transcript
// order, reverse-complemented when on the minus strand). The result is a
// FeatureDraft with the custom `domain` type, a join() when the domain crosses an
// intron, and the standard GenBank db_xref / note qualifiers so it survives a
// round-trip to SnapGene / ApE (design decision 5: BOTH a distinct type and the
// standard qualifiers).
//
// This is the CDS analogue of feature-detect's aaSpanToDna, which maps an aa span
// onto a single contiguous ORF. A CDS can be exon-joined, so we walk the same
// transcript-coordinate model translateFeature uses, then split the genomic span
// at every exon boundary.
//
// Pure + deterministic. No React, no fetch, no disk. Voice in comments, no
// em-dashes, no emojis, no mid-sentence colons.

import type { EditFeature } from "./edit-model";
import type { FeatureDraft, QualifierRow } from "./feature-edit";
import type { DomainHit } from "./interproscan";

/** The custom feature type all domain hits get, so they form one unified,
 *  filterable group in the view-rail feature-type flyout. Lowercase to match the
 *  flyout's typeKey() and the color-table key. */
export const DOMAIN_FEATURE_TYPE = "domain";

/** The exon spans of a feature in TRANSCRIPT order (the order translateFeature
 *  concatenates them in before any reverse-complement). For a single-span
 *  feature this is one entry; for a join() it is the locations sorted by start.
 *  Coordinates are 0-based half-open [start, end) on the forward strand. */
function transcriptExons(f: { start: number; end: number; locations?: { start: number; end: number }[] }): {
  start: number;
  end: number;
}[] {
  const spans =
    f.locations && f.locations.length > 1
      ? [...f.locations].sort((a, b) => a.start - b.start)
      : [{ start: f.start, end: f.end }];
  return spans.map((s) => ({
    start: Math.min(s.start, s.end),
    end: Math.max(s.start, s.end),
  }));
}

/**
 * Map a half-open TRANSCRIPT-coordinate span [tStart, tEnd) (offsets into the
 * spliced coding sequence the protein was read from) back to one or more FORWARD
 * genomic spans, honoring exon joins and strand.
 *
 * The transcript is the exons concatenated left-to-right (forward order), then
 * reverse-complemented if the feature is on the minus strand. So:
 *   - forward strand: transcript offset t maps directly into the exons read
 *     left-to-right.
 *   - reverse strand: the protein's N-terminus is the 3' (high-coordinate) end,
 *     so transcript offset t counts from the RIGHT end of the concatenated exons.
 *     We flip the span to forward-exon offsets before walking the exons.
 *
 * Returns the genomic sub-spans (0-based half-open, forward), one per exon the
 * domain touches, sorted by start. A domain inside one exon yields one span; a
 * domain crossing an intron yields a join().
 */
export function transcriptSpanToDna(
  exons: { start: number; end: number }[],
  strand: 1 | -1,
  tStart: number,
  tEnd: number,
): { start: number; end: number }[] {
  const total = exons.reduce((n, e) => n + (e.end - e.start), 0);
  // Clamp into the coding length so a domain end past the protein (rare, e.g. a
  // trailing-stop off-by-one) does not run off the transcript.
  let lo = Math.max(0, Math.min(tStart, tEnd));
  let hi = Math.min(total, Math.max(tStart, tEnd));
  if (hi <= lo) return [];

  // On the minus strand the transcript is the reverse complement of the forward-
  // ordered exons, so offset t from the protein's N-terminus is offset (total-t)
  // from the LEFT of the forward exons. Flip the [lo, hi) window accordingly.
  if (strand === -1) {
    const flippedLo = total - hi;
    const flippedHi = total - lo;
    lo = flippedLo;
    hi = flippedHi;
  }

  // Walk the forward-ordered exons, carving out [lo, hi) in transcript space.
  const out: { start: number; end: number }[] = [];
  let cursor = 0; // transcript offset at the start of the current exon
  for (const e of exons) {
    const exonLen = e.end - e.start;
    const exonTStart = cursor;
    const exonTEnd = cursor + exonLen;
    cursor = exonTEnd;
    // Overlap of [lo, hi) with this exon's transcript range.
    const ovStart = Math.max(lo, exonTStart);
    const ovEnd = Math.min(hi, exonTEnd);
    if (ovEnd <= ovStart) continue;
    // Convert the overlapping transcript offsets to genomic forward coordinates.
    const gStart = e.start + (ovStart - exonTStart);
    const gEnd = e.start + (ovEnd - exonTStart);
    out.push({ start: gStart, end: gEnd });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Format an E-value / score note line for the feature, omitting absent values. */
function scoreNote(hit: DomainHit): string | null {
  const parts: string[] = [];
  if (hit.evalue !== undefined) parts.push(`E-value ${hit.evalue.toExponential(1)}`);
  if (hit.score !== undefined) parts.push(`bit score ${hit.score}`);
  return parts.length ? parts.join(", ") : null;
}

/**
 * Convert one DomainHit into a FeatureDraft positioned on `cdsFeature`'s DNA.
 *
 * The hit's residues are 1-based inclusive [start, end]; residue r (1-based)
 * occupies transcript (coding) bases [(r-1)*3, r*3). We map that transcript span
 * onto the CDS genomic coordinates via transcriptSpanToDna (strand + exon joins),
 * producing a single span or a join() when the domain crosses an intron.
 *
 * The draft carries:
 *   - type = "domain" (the unified, filterable group),
 *   - name = the family name (e.g. "Pkinase"),
 *   - strand = the CDS's strand,
 *   - /db_xref = "Pfam:PF00069" (round-trips to SnapGene / ApE),
 *   - /note = the family description,
 *   - /note = the E-value / score,
 *   - /note = the source database (so per-source filtering survives a round-trip).
 *
 * Returns null when the hit cannot be placed (empty span / out of range).
 *
 * `seqLength` is accepted for parity with the other detect-to-draft mappers and
 * to clamp defensively; the exon walk already clamps to the coding length.
 */
export function domainHitToFeature(
  hit: DomainHit,
  cdsFeature: EditFeature,
  seqLength: number,
): FeatureDraft | null {
  const exons = transcriptExons(cdsFeature);
  const strand: 1 | -1 = cdsFeature.strand === -1 ? -1 : 1;
  // 1-based inclusive residues -> half-open transcript bases.
  const tStart = (Math.max(1, hit.start) - 1) * 3;
  const tEnd = hit.end * 3;
  const spans = transcriptSpanToDna(exons, strand, tStart, tEnd)
    // Final clamp into the molecule, paranoia against a malformed feature.
    .map((s) => ({ start: Math.max(0, s.start), end: Math.min(seqLength, s.end) }))
    .filter((s) => s.end > s.start);
  if (spans.length === 0) return null;

  const overallStart = spans[0].start;
  const overallEnd = spans[spans.length - 1].end;

  const qualifiers: QualifierRow[] = [
    { key: "db_xref", value: `${hit.db}:${hit.accession}` },
  ];
  if (hit.description) qualifiers.push({ key: "note", value: hit.description });
  const score = scoreNote(hit);
  if (score) qualifiers.push({ key: "note", value: score });
  // Carry the source database so a future per-source filter survives a GenBank
  // round-trip (decision 4). A dedicated qualifier, not the visible note text.
  qualifiers.push({ key: "note", value: `Domain database ${hit.db}` });

  return {
    name: hit.name || hit.accession,
    type: DOMAIN_FEATURE_TYPE,
    strand,
    start: overallStart,
    end: overallEnd,
    // Multi-span (intron-crossing) domains persist as a GenBank join().
    segments: spans.length > 1 ? spans.map((s) => ({ start: s.start, end: s.end })) : undefined,
    qualifiers,
  };
}
