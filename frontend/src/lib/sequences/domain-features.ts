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

/** The `/note` prefix that carries a domain feature's PROTEIN residue range,
 *  1-based inclusive, e.g. `/note="aa_range:4..286"`. Stored at annotation time
 *  by domainHitToFeature so the protein domain bar reads the span directly. A
 *  domain feature lacking it falls back to inverting the DNA->aa mapping. */
export const AA_RANGE_NOTE_PREFIX = "aa_range:";

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
  // Persist the PROTEIN aa range (1-based inclusive) on the feature so the
  // protein domain bar reads the residue span directly, with no inverse DNA->aa
  // math. Additive `/note` that round-trips in GenBank; a feature lacking it (an
  // imported / pre-existing domain) falls back to inverting the DNA->aa mapping
  // (see aaRangeForDomainFeature). See AA_RANGE_NOTE_PREFIX.
  qualifiers.push({
    key: "note",
    value: `${AA_RANGE_NOTE_PREFIX}${Math.max(1, hit.start)}..${hit.end}`,
  });

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

// --- PROTEIN PROJECTION (DNA domain feature -> aa residue span) -------------
//
// The protein domain bar draws domains in PROTEIN coordinates. The cheap, exact
// path reads the aa_range note domainHitToFeature now stores. The fallback (an
// imported / pre-existing domain with no aa_range) INVERTS the forward DNA->aa
// mapping above so the bar still works. The inverse must agree with the forward
// transcriptSpanToDna exactly (strand + exon joins), which the unit tests pin.

/** A domain projected into the protein's aa coordinates, ready for the bar. */
export interface DomainBlock {
  /** Family / domain display name (e.g. "Pkinase"). */
  name: string;
  /** The family accession (e.g. "PF00069"); "" when unknown. */
  accession: string;
  /** 1-based inclusive residue start. */
  aaStart: number;
  /** 1-based inclusive residue end. */
  aaEnd: number;
  /** The per-family block color (deterministic, keyed on the accession). */
  color: string;
  /** Bit score, when the feature recorded one. */
  score?: number;
  /** E-value, when the feature recorded one. */
  evalue?: number;
  /** Index of the source feature in doc.features, for click-to-select. */
  featureIndex: number;
}

/** A feature whose aa range we can recover: its forward DNA geometry + strand +
 *  the parsed notes. Matches the EditFeature shape the editor holds. */
interface DomainFeatureLike {
  name?: string;
  type?: string;
  start: number;
  end: number;
  strand?: 1 | -1;
  locations?: { start: number; end: number }[];
  notes?: Record<string, unknown>;
}

/** Pull every string value out of a parsed note (bio-parsers stores notes as
 *  arrays of strings; be defensive about plain strings too). */
function noteStrings(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  if (typeof value === "string") return [value];
  return [];
}

/** Read the stored aa range (1-based inclusive) from a domain feature's notes,
 *  or null when no `aa_range:` note is present. */
export function readAaRangeNote(
  notes: Record<string, unknown> | undefined,
): { aaStart: number; aaEnd: number } | null {
  if (!notes) return null;
  for (const value of noteStrings(notes.note)) {
    const trimmed = value.trim();
    if (!trimmed.startsWith(AA_RANGE_NOTE_PREFIX)) continue;
    const m = trimmed.slice(AA_RANGE_NOTE_PREFIX.length).match(/^(\d+)\.\.(\d+)$/);
    if (!m) continue;
    const aaStart = parseInt(m[1], 10);
    const aaEnd = parseInt(m[2], 10);
    if (Number.isFinite(aaStart) && Number.isFinite(aaEnd) && aaEnd >= aaStart) {
      return { aaStart, aaEnd };
    }
  }
  return null;
}

/** Read the family accession from a feature's `/db_xref="Db:ACC"` note. Returns
 *  the bare accession (e.g. "PF00069"), or "" when absent. */
export function readAccessionNote(notes: Record<string, unknown> | undefined): string {
  if (!notes) return "";
  for (const value of noteStrings(notes.db_xref)) {
    const idx = value.indexOf(":");
    const acc = idx >= 0 ? value.slice(idx + 1) : value;
    if (acc.trim()) return acc.trim();
  }
  return "";
}

/** Read a stored E-value / bit score from the feature's score `/note` (the line
 *  domainHitToFeature writes, e.g. "E-value 3.8e-74, bit score 260.9"). */
function readScoreNote(notes: Record<string, unknown> | undefined): {
  score?: number;
  evalue?: number;
} {
  const out: { score?: number; evalue?: number } = {};
  if (!notes) return out;
  for (const value of noteStrings(notes.note)) {
    const e = value.match(/E-value\s+([0-9.eE+-]+)/);
    if (e) {
      const v = Number(e[1]);
      if (Number.isFinite(v)) out.evalue = v;
    }
    const s = value.match(/bit score\s+([0-9.eE+-]+)/);
    if (s) {
      const v = Number(s[1]);
      if (Number.isFinite(v)) out.score = v;
    }
  }
  return out;
}

/**
 * INVERSE of transcriptSpanToDna for a single contiguous FORWARD genomic span:
 * map a forward genomic position `g` (which must lie inside one of the exons) to
 * its TRANSCRIPT offset, honoring strand. On the forward strand the transcript
 * offset is the forward-exon offset; on the minus strand it is `total - that`.
 * Returns null when `g` falls outside every exon.
 */
function genomicToTranscriptOffset(
  exons: { start: number; end: number }[],
  strand: 1 | -1,
  total: number,
  g: number,
): number | null {
  let cursor = 0;
  for (const e of exons) {
    const len = e.end - e.start;
    if (g >= e.start && g <= e.end) {
      const fwdOffset = cursor + (g - e.start);
      return strand === -1 ? total - fwdOffset : fwdOffset;
    }
    cursor += len;
  }
  return null;
}

/**
 * Recover the PROTEIN aa range (1-based inclusive) a `domain` feature occupies on
 * `cdsFeature`, by inverting the DNA->aa mapping. We take the domain feature's
 * forward genomic span (its overall [start, end) or its join() segments), map the
 * span's two genomic endpoints back into transcript offsets through the CDS exons
 * (strand-aware), and convert the resulting half-open transcript window to
 * residues. Returns null when the domain does not overlap the CDS exons at all.
 *
 * This is the exact inverse of domainHitToFeature's forward path, so a freshly
 * annotated domain recovers its original hit.start..hit.end even without the
 * aa_range note (the note is just the fast path).
 */
export function inverseDomainAaRange(
  cdsFeature: DomainFeatureLike,
  domainFeature: DomainFeatureLike,
): { aaStart: number; aaEnd: number } | null {
  const exons = transcriptExons(cdsFeature);
  const strand: 1 | -1 = cdsFeature.strand === -1 ? -1 : 1;
  const total = exons.reduce((n, e) => n + (e.end - e.start), 0);
  if (total <= 0) return null;

  // The domain's forward genomic spans: its join() segments, else the overall
  // [start, end). Coordinates are 0-based half-open on the forward strand.
  const domainSpans =
    domainFeature.locations && domainFeature.locations.length > 1
      ? domainFeature.locations.map((s) => ({
          start: Math.min(s.start, s.end),
          end: Math.max(s.start, s.end),
        }))
      : [
          {
            start: Math.min(domainFeature.start, domainFeature.end),
            end: Math.max(domainFeature.start, domainFeature.end),
          },
        ];

  // Collect every transcript offset the domain's span endpoints map to. Each span
  // contributes its left genomic edge and its right genomic edge (half-open, so
  // the right edge is the exclusive end). We map both into transcript space and
  // take the overall [min, max) window.
  let tLo = Infinity;
  let tHi = -Infinity;
  for (const span of domainSpans) {
    // Clamp the genomic span into the CDS extent so an endpoint sitting exactly on
    // an intron boundary still resolves through genomicToTranscriptOffset.
    const left = genomicToTranscriptOffset(exons, strand, total, span.start);
    const right = genomicToTranscriptOffset(exons, strand, total, span.end);
    for (const t of [left, right]) {
      if (t === null) continue;
      if (t < tLo) tLo = t;
      if (t > tHi) tHi = t;
    }
  }
  if (!Number.isFinite(tLo) || !Number.isFinite(tHi) || tHi <= tLo) return null;

  // Half-open transcript window [tLo, tHi) -> 1-based inclusive residues. Residue
  // r occupies transcript bases [(r-1)*3, r*3), so the start residue is the codon
  // containing tLo and the end residue is the codon containing the last base
  // (tHi - 1).
  const aaStart = Math.floor(tLo / 3) + 1;
  const aaEnd = Math.floor((tHi - 1) / 3) + 1;
  if (aaEnd < aaStart) return null;
  return { aaStart, aaEnd };
}

/** Deterministic per-family hue for a domain block, keyed on the Pfam accession
 *  (so the same family always reads the same color, and different families read
 *  distinctly). Falls back to the feature name when there is no accession, and to
 *  a fixed index when both are blank. HSL chosen mid-saturation / mid-lightness so
 *  it reads in both light and dark mode (same intent as feature-colors). */
export function familyColor(accession: string, fallbackKey = ""): string {
  const key = (accession || fallbackKey || "domain").trim().toLowerCase();
  // FNV-1a, a small stable string hash, so the hue is deterministic across runs.
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hue = (h >>> 0) % 360;
  return `hsl(${hue}, 62%, 58%)`;
}

/** Is a feature a `domain`-type annotation? Case-insensitive on the type. */
function isDomainFeature(f: DomainFeatureLike): boolean {
  return (f.type || "").trim().toLowerCase() === DOMAIN_FEATURE_TYPE;
}

/** Does a domain feature's forward DNA span overlap the CDS's forward extent? A
 *  cheap pre-filter so we only project domains that belong to this CDS. */
function overlapsCds(cds: DomainFeatureLike, dom: DomainFeatureLike): boolean {
  const cLo = Math.min(cds.start, cds.end);
  const cHi = Math.max(cds.start, cds.end);
  const dLo = Math.min(dom.start, dom.end);
  const dHi = Math.max(dom.start, dom.end);
  return dHi > cLo && dLo < cHi;
}

/**
 * Project every `domain`-type feature overlapping `cdsFeature` into the protein's
 * aa coordinates, returning the display list the bar renders. The aa range comes
 * from the stored `aa_range` note when present (exact, no math), else from
 * inverting the DNA->aa mapping. Out-of-range residues are clamped into
 * [1, aaLength]; a domain that cannot be placed is dropped.
 *
 * `features` is the molecule's full feature list (so featureIndex is the real
 * doc.features index the click-to-select path needs).
 */
export function domainsForCds(
  cdsFeature: DomainFeatureLike,
  features: DomainFeatureLike[],
  aaLength: number,
): DomainBlock[] {
  const out: DomainBlock[] = [];
  features.forEach((f, featureIndex) => {
    if (!isDomainFeature(f)) return;
    if (!overlapsCds(cdsFeature, f)) return;
    const stored = readAaRangeNote(f.notes);
    const range = stored ?? inverseDomainAaRange(cdsFeature, f);
    if (!range) return;
    const aaStart = Math.max(1, Math.min(range.aaStart, aaLength));
    const aaEnd = Math.max(aaStart, Math.min(range.aaEnd, aaLength));
    const accession = readAccessionNote(f.notes);
    const { score, evalue } = readScoreNote(f.notes);
    out.push({
      name: f.name || accession || "domain",
      accession,
      aaStart,
      aaEnd,
      color: familyColor(accession, f.name || ""),
      score,
      evalue,
      featureIndex,
    });
  });
  // Stable order: by start, then end, then name, so the bar + tests are
  // deterministic regardless of feature-list order.
  out.sort(
    (a, b) =>
      a.aaStart - b.aaStart ||
      a.aaEnd - b.aaEnd ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  return out;
}
