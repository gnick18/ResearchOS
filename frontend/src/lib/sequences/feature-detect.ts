// feature detect bot — COMMON-FEATURE DETECTOR + closest-known-protein.
//
// Given a DNA sequence and a library of reference PROTEINS (the bundled
// feature DB), find which well-known protein elements the DNA encodes:
// fluorescent proteins, resistance markers, fusion tags, and short epitope
// tags. The DNA is searched by TRANSLATION, not by raw nucleotide matching, so
// a codon-optimized GFP still flags even though its DNA diverged heavily from
// any one reference's DNA. We translate each open reading frame on both strands
// and align the reference protein against those translations with the project's
// own BLOSUM62 protein aligner (lib/align). High-scoring hits are mapped back to
// DNA coordinates and proposed as features.
//
// Pure, deterministic, strict TS. NO React, NO disk, NO fetch. The caller
// supplies the reference list (loaded from /feature-db/protein-features.json by
// the UI) so this module stays testable with synthetic fixtures.
//
// ---------------------------------------------------------------------------
// COORDINATE MODEL
// ---------------------------------------------------------------------------
// All DNA coordinates are 0-based, half-open [dnaStart, dnaEnd), in FORWARD
// sequence coordinates (same convention as edit-model / feature-edit / orf.ts).
// A hit on the reverse strand still reports forward coordinates, with
// strand = -1, exactly like findOrfs maps reverse ORFs back to forward coords.
//
// PROTEIN -> DNA mapping. An ORF spans forward DNA [orf.start, orf.end). Its
// translation drops the trailing stop codon, so amino-acid index `aa` of a
// forward ORF occupies forward DNA bases [orf.start + aa*3, orf.start + aa*3+3).
// For a reverse ORF, the protein is read 3'->5' along the forward strand, so
// amino-acid index `aa` (from the protein's N-terminus) occupies forward DNA
// bases [orf.end - (aa+1)*3, orf.end - aa*3). We map the aligned protein span
// [aaStart, aaEnd) through these rules to a forward DNA [dnaStart, dnaEnd).
//
// ---------------------------------------------------------------------------
// THRESHOLDS
// ---------------------------------------------------------------------------
// FULL proteins (fluorescent_protein, resistance_marker, fusion_tag): a hit
// must clear BOTH an identity gate (default 0.6 over the aligned residues) AND
// a coverage gate (default 0.5 of the reference length), so a partial or
// diverged homolog still flags but noise does not. Identity here is strict
// residue identity over the aligned columns, NOT the BLOSUM sign.
//
// EPITOPE tags (short peptides, ~6-22 aa) are NOT run through loose local
// alignment: a 6-residue His tag would match almost anywhere. Instead we slide
// the tag along each ORF translation and require a NEAR-EXACT window match
// (exact, or >= 90% identity over the FULL tag length, default). Tags usually
// sit at an ORF N- or C-terminus but we scan the whole ORF so internal tags
// (e.g. a linker-embedded tag) are not missed.

import { alignLocal, proteinScoring } from "../align";
import type { AlignmentResult } from "../align";
import { findOrfs } from "./orf";
import { translate } from "@/vendor/seqviz/sequence";

/** A reference protein element, the subset of the bundled DB this module needs.
 *  Extra DB fields (id, sourceUrl, accession, note) are ignored here. */
export interface ReferenceProtein {
  name: string;
  category: string;
  /** Amino-acid sequence (single-letter). */
  seq: string;
  source?: string;
  license?: string;
}

/** A detected feature proposal, in FORWARD DNA coordinates (0-based half-open). */
export interface DetectedFeature {
  name: string;
  category: string;
  /** 0-based inclusive start on the forward sequence. */
  dnaStart: number;
  /** 0-based EXCLUSIVE end on the forward sequence. */
  dnaEnd: number;
  /** 1 forward, -1 reverse. */
  strand: 1 | -1;
  /** Strict residue identity over the aligned span, in [0, 1]. */
  identity: number;
  /** Fraction of the reference length that was covered by the alignment, [0, 1]. */
  coverage: number;
  /** "full" for whole-protein homology, "tag" for a near-exact epitope match. */
  kind: "full" | "tag";
  source?: string;
  license?: string;
}

/** The single best reference match for one ORF, even when below the gate.
 *  Informational only (drives the "closest known protein" hint), never an
 *  auto-proposal. */
export interface ClosestMatch {
  /** Forward DNA span of the ORF this describes. */
  orfStart: number;
  orfEnd: number;
  strand: 1 | -1;
  /** Length of the ORF's translated protein (aa, excluding the stop). */
  orfAaLength: number;
  /** Name of the closest reference, or null when nothing scored above 0. */
  name: string | null;
  category: string | null;
  /** Strict residue identity of that best match over its aligned span, [0, 1]. */
  identity: number;
}

export interface DetectResult {
  features: DetectedFeature[];
  closest: ClosestMatch[];
}

export interface DetectOptions {
  /** Minimum residue identity for a FULL-protein hit. Default 0.6. */
  fullIdentity?: number;
  /** Minimum reference coverage for a FULL-protein hit. Default 0.5. */
  fullCoverage?: number;
  /** Minimum residue identity for an EPITOPE-tag window. Default 0.9. */
  tagIdentity?: number;
  /** Shortest ORF (in aa) to consider, passed to findOrfs. Default 20. */
  minOrfAa?: number;
  /** A "substantial" ORF for closest-match reporting must be at least this many
   *  aa long. Default 40. Keeps the closest-match list focused on real CDSs. */
  closestMinAa?: number;
}

export const DEFAULT_FULL_IDENTITY = 0.6;
export const DEFAULT_FULL_COVERAGE = 0.5;
export const DEFAULT_TAG_IDENTITY = 0.9;
export const DEFAULT_MIN_ORF_AA = 20;
export const DEFAULT_CLOSEST_MIN_AA = 40;

/** Epitope tags are short peptides; this is the upper aa length we treat as a
 *  "tag" (scan-for-near-exact) rather than a full protein (loose align). */
const MAX_TAG_AA = 22;
/** Below this we never even try to align as a full protein (too short to gate). */
const MIN_FULL_REF_AA = 25;

const protScore = proteinScoring();

/** One ORF plus its translated protein and a per-amino-acid -> forward-DNA-start
 *  map, so any aligned aa span maps straight back to forward DNA coordinates. */
interface OrfFrame {
  start: number;
  end: number;
  strand: 1 | -1;
  /** Translated protein (stop codon already dropped by the slicing below). */
  protein: string;
}

/**
 * Translate one ORF's coding bases (start codon through the residue before the
 * stop) into a protein. For a reverse ORF the coding bases are the reverse
 * complement of the forward span. `findOrfs` returns [start, end) where `end`
 * is just past the stop codon, so we drop the final 3 bases before translating.
 */
function frameFromOrf(seq: string, orf: { start: number; end: number; strand: 1 | -1 }): OrfFrame {
  const span = seq.slice(orf.start, orf.end);
  // Coding bases exclude the trailing stop codon.
  const codingForward = span.length >= 3 ? span.slice(0, span.length - 3) : "";
  const coding = orf.strand === 1 ? codingForward : revComp(span).slice(0, Math.max(0, span.length - 3));
  const protein = translate(coding, "dna");
  return { start: orf.start, end: orf.end, strand: orf.strand, protein };
}

/** Local IUPAC-free reverse complement (DNA only). orf.ts and align both have
 *  one, but keeping a tiny local copy avoids an extra import surface and is
 *  exact-base only, which is all an ORF's own bases need. */
function revComp(seq: string): string {
  const map: Record<string, string> = { A: "T", T: "A", G: "C", C: "G", U: "A", N: "N" };
  let out = "";
  for (let i = seq.length - 1; i >= 0; i--) out += map[seq[i].toUpperCase()] ?? "N";
  return out;
}

/**
 * Map an aligned protein span [aaStart, aaEnd) (0-based half-open, indices into
 * the ORF's translation from its N-terminus) back to forward DNA [start, end).
 * Forward ORF: aa i -> bases [orf.start + i*3, ...). Reverse ORF: the protein is
 * read from orf.end backward, so aa i -> forward bases [orf.end - (i+1)*3, ...).
 */
function aaSpanToDna(frame: OrfFrame, aaStart: number, aaEnd: number): { dnaStart: number; dnaEnd: number } {
  if (frame.strand === 1) {
    return { dnaStart: frame.start + aaStart * 3, dnaEnd: frame.start + aaEnd * 3 };
  }
  // Reverse: aa range [aaStart, aaEnd) maps to forward bases
  // [orf.end - aaEnd*3, orf.end - aaStart*3).
  return { dnaStart: frame.end - aaEnd * 3, dnaEnd: frame.end - aaStart * 3 };
}

/** Strict residue identity over an alignment's columns: count of positions where
 *  the two aligned residues are byte-identical (case-insensitive) divided by the
 *  alignment length. This is independent of BLOSUM sign (a conservative
 *  substitution scores positive but is NOT identity). */
function strictIdentity(result: AlignmentResult): number {
  const a = result.alignedA;
  const b = result.alignedB;
  if (a.length === 0) return 0;
  let same = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== "-" && a[i].toUpperCase() === b[i].toUpperCase()) same += 1;
  }
  return same / a.length;
}

/** Walk the alignment ops to find the [aaStart, aaEnd) span of the ORF protein
 *  (sequence `a`) that actually aligned, ignoring leading/trailing gaps. The
 *  aligner reports aStart/aEnd directly, so this just returns those. */
function alignedProteinSpan(result: AlignmentResult): { aaStart: number; aaEnd: number } {
  return { aaStart: result.aStart, aaEnd: result.aEnd };
}

/**
 * Try to detect a FULL protein reference within one ORF frame. Aligns the
 * reference (as `b`, the query) against the ORF translation (as `a`, the target)
 * with local alignment, then gates on strict identity and reference coverage.
 * Returns a DetectedFeature on success, or null.
 */
function detectFullInFrame(
  frame: OrfFrame,
  ref: ReferenceProtein,
  fullIdentity: number,
  fullCoverage: number,
): DetectedFeature | null {
  if (frame.protein.length === 0 || ref.seq.length < MIN_FULL_REF_AA) return null;
  // a = ORF protein (target), b = reference (query). Local mode finds the best
  // matching sub-region, which is what "the ORF contains this protein" needs.
  const result = alignLocal(frame.protein, ref.seq, { scoring: protScore });
  const identity = strictIdentity(result);
  // Coverage = aligned span of the REFERENCE (b) over the reference length.
  const coverage = ref.seq.length > 0 ? (result.bEnd - result.bStart) / ref.seq.length : 0;
  if (identity < fullIdentity || coverage < fullCoverage) return null;
  const { aaStart, aaEnd } = alignedProteinSpan(result);
  const { dnaStart, dnaEnd } = aaSpanToDna(frame, aaStart, aaEnd);
  return {
    name: ref.name,
    category: ref.category,
    dnaStart,
    dnaEnd,
    strand: frame.strand,
    identity,
    coverage,
    kind: "full",
  };
}

/**
 * Try to detect a short EPITOPE tag within one ORF frame. Slides a window the
 * length of the tag along the ORF translation and keeps the best window whose
 * strict identity clears `tagIdentity`. No gaps: tags are short and indels in a
 * tag are rare, so a fixed-width window is both faster and avoids the
 * everywhere-matches problem of loose local alignment.
 */
function detectTagInFrame(
  frame: OrfFrame,
  ref: ReferenceProtein,
  tagIdentity: number,
): DetectedFeature | null {
  const tag = ref.seq.toUpperCase();
  const prot = frame.protein.toUpperCase();
  const L = tag.length;
  if (L === 0 || prot.length < L) return null;
  let bestStart = -1;
  let bestIdentity = 0;
  for (let off = 0; off + L <= prot.length; off++) {
    let same = 0;
    for (let k = 0; k < L; k++) {
      if (prot[off + k] === tag[k]) same += 1;
    }
    const id = same / L;
    if (id > bestIdentity) {
      bestIdentity = id;
      bestStart = off;
    }
  }
  if (bestStart < 0 || bestIdentity < tagIdentity) return null;
  const { dnaStart, dnaEnd } = aaSpanToDna(frame, bestStart, bestStart + L);
  return {
    name: ref.name,
    category: ref.category,
    dnaStart,
    dnaEnd,
    strand: frame.strand,
    identity: bestIdentity,
    coverage: 1,
    kind: "tag",
  };
}

/** Is this reference category a short epitope tag (scan near-exact) vs a full
 *  protein (loose align)? Length is the real discriminator so a mislabeled DB
 *  row still routes correctly. */
function isTag(ref: ReferenceProtein): boolean {
  return ref.category === "epitope_tag" || ref.seq.length <= MAX_TAG_AA;
}

/** Overlap (in forward DNA) between two detected features, regardless of strand. */
function overlaps(a: DetectedFeature, b: DetectedFeature): boolean {
  return a.dnaStart < b.dnaEnd && b.dnaStart < a.dnaEnd;
}

/**
 * De-dupe overlapping hits so one DNA region is not double-proposed. Keep the
 * better hit per overlap: higher identity wins; ties break toward the longer
 * span (the more complete annotation), then toward a full protein over a tag.
 * O(n^2) is fine at the dozens-of-hits scale this produces.
 */
function dedupe(hits: DetectedFeature[]): DetectedFeature[] {
  // Sort best-first so a simple greedy keep-if-no-better-overlap works.
  const score = (h: DetectedFeature) =>
    h.identity * 1000 + (h.dnaEnd - h.dnaStart) + (h.kind === "full" ? 0.5 : 0);
  const sorted = [...hits].sort((x, y) => score(y) - score(x));
  const kept: DetectedFeature[] = [];
  for (const h of sorted) {
    if (kept.some((k) => overlaps(k, h) && k.strand === h.strand)) continue;
    kept.push(h);
  }
  // Return in a stable, readable order: by start, then strand.
  return kept.sort((x, y) => x.dnaStart - y.dnaStart || x.strand - y.strand);
}

/**
 * Detect common protein features encoded by a DNA sequence.
 *
 * @param seq      the DNA bases (forward strand)
 * @param features the reference protein library (bundled feature DB entries)
 * @param options  thresholds and ORF length floors (see DetectOptions)
 */
export function detectFeatures(
  seq: string,
  features: ReferenceProtein[],
  options: DetectOptions = {},
): DetectResult {
  const fullIdentity = options.fullIdentity ?? DEFAULT_FULL_IDENTITY;
  const fullCoverage = options.fullCoverage ?? DEFAULT_FULL_COVERAGE;
  const tagIdentity = options.tagIdentity ?? DEFAULT_TAG_IDENTITY;
  const minOrfAa = options.minOrfAa ?? DEFAULT_MIN_ORF_AA;
  const closestMinAa = options.closestMinAa ?? DEFAULT_CLOSEST_MIN_AA;

  const dna = (seq || "").toUpperCase();
  if (!dna || features.length === 0) return { features: [], closest: [] };

  // 1. ORFs on both strands -> translated frames.
  const orfs = findOrfs(dna, minOrfAa);
  const frames = orfs.map((o) => frameFromOrf(dna, o)).filter((f) => f.protein.length > 0);

  const fullRefs = features.filter((r) => !isTag(r));
  const tagRefs = features.filter((r) => isTag(r));

  const rawHits: DetectedFeature[] = [];
  const closest: ClosestMatch[] = [];

  for (const frame of frames) {
    // 2. FULL-protein homology in this frame.
    let bestRefName: string | null = null;
    let bestRefCategory: string | null = null;
    let bestRefIdentity = 0;
    for (const ref of fullRefs) {
      if (ref.seq.length < MIN_FULL_REF_AA) continue;
      const result = alignLocal(frame.protein, ref.seq, { scoring: protScore });
      const identity = strictIdentity(result);
      const coverage = ref.seq.length > 0 ? (result.bEnd - result.bStart) / ref.seq.length : 0;
      // Closest-match tracking (informational): best identity seen, regardless
      // of the gate, but require a non-trivial coverage so a 3-residue chance
      // hit does not win the "closest" label.
      if (identity > bestRefIdentity && coverage >= 0.25) {
        bestRefIdentity = identity;
        bestRefName = ref.name;
        bestRefCategory = ref.category;
      }
      if (identity >= fullIdentity && coverage >= fullCoverage) {
        const { aaStart, aaEnd } = alignedProteinSpan(result);
        const { dnaStart, dnaEnd } = aaSpanToDna(frame, aaStart, aaEnd);
        rawHits.push({
          name: ref.name,
          category: ref.category,
          dnaStart,
          dnaEnd,
          strand: frame.strand,
          identity,
          coverage,
          kind: "full",
          source: ref.source,
          license: ref.license,
        });
      }
    }

    // 3. EPITOPE tags (near-exact window) in this frame.
    for (const ref of tagRefs) {
      const hit = detectTagInFrame(frame, ref, tagIdentity);
      if (hit) {
        hit.source = ref.source;
        hit.license = ref.license;
        rawHits.push(hit);
      }
    }

    // 4. Closest-known-protein, for substantial ORFs only.
    if (frame.protein.length >= closestMinAa) {
      closest.push({
        orfStart: frame.start,
        orfEnd: frame.end,
        strand: frame.strand,
        orfAaLength: frame.protein.length,
        name: bestRefName,
        category: bestRefCategory,
        identity: bestRefIdentity,
      });
    }
  }

  return {
    features: dedupe(rawHits),
    closest: closest.sort((a, b) => a.orfStart - b.orfStart || a.strand - b.strand),
  };
}

// Keep the per-frame full helper referenced; the inline loop above is the hot
// path (it folds closest-match tracking into the same alignment pass), but the
// standalone helper is exported-shaped for unit testing one ref against one
// frame and documents the gate in isolation.
export const __internal = { detectFullInFrame, frameFromOrf, aaSpanToDna, strictIdentity };
