// sequence editor master — SHARED feature-to-protein translation path.
//
// Both doors into the protein-properties engine (the Analyze > Protein
// properties dialog AND the right-docked properties drawer that opens when a
// coding feature is selected) translate a feature the SAME way, so the readout
// never drifts between them. This module is that one path: which feature types
// count as coding, how a feature's bases become an amino-acid chain (honoring
// strand + exon joins), a trailing-stop trim, and a 1-based location label for
// the drawer header.
//
// No protein math lives here; analyzeProtein (lib/calculators/protein) owns
// that. This is only the DNA -> peptide step plus the small display helpers.
//
// Voice in comments, no em-dashes, no emojis, no mid-sentence colons.

import { translateFrame1 } from "./export";
import { reverseComplement } from "./primer";
import type { EditFeature } from "./edit-model";

/** The feature types we treat as protein-coding (lowercased compare). */
export const CODING_TYPES = new Set(["cds", "gene", "mat_peptide", "sig_peptide"]);

/** True when a feature's type is one we translate to protein. */
export function isCodingFeature(f: { type?: string }): boolean {
  return CODING_TYPES.has((f.type || "").trim().toLowerCase());
}

/**
 * Translate one feature to amino acids, honoring strand and exon joins. For a
 * multi-exon (join) feature the exon bases are concatenated left to right
 * first; a reverse-strand feature reverse-complements before reading frame 1.
 * Uses the editor's degenerate-codon-aware translateFrame1 util.
 */
export function translateFeature(seq: string, f: EditFeature): string {
  const spans =
    f.locations && f.locations.length > 1
      ? [...f.locations].sort((a, b) => a.start - b.start)
      : [{ start: f.start, end: f.end }];
  let bases = "";
  for (const s of spans) {
    const lo = Math.max(0, Math.min(s.start, s.end));
    const hi = Math.min(seq.length, Math.max(s.start, s.end));
    bases += seq.slice(lo, hi);
  }
  if (f.strand === -1) bases = reverseComplement(bases);
  return translateFrame1(bases);
}

/** Trim exactly one trailing stop, the common "CDS includes its stop" case. */
export function trimTrailingStop(aa: string): string {
  return aa.endsWith("*") ? aa.slice(0, -1) : aa;
}

/** Number of exon segments a feature spans (1 for a plain single-span feature). */
export function segmentCount(f: EditFeature): number {
  return f.locations && f.locations.length > 1 ? f.locations.length : 1;
}

/**
 * A GenBank-style 1-based location label for the drawer header, e.g.
 * "258..956" or, on the reverse strand, "complement(258..956)". A multi-segment
 * (join) feature reads "join(1..50,120..300)" wrapped in complement() when on
 * the minus strand. The model stores 0-based half-open [start, end); we show
 * 1-based inclusive coordinates the way a biologist reads them.
 */
export function featureLocationLabel(f: EditFeature): string {
  const segs =
    f.locations && f.locations.length > 1
      ? [...f.locations].sort((a, b) => a.start - b.start)
      : [{ start: f.start, end: f.end }];
  const parts = segs.map((s) => {
    const lo = Math.min(s.start, s.end);
    const hi = Math.max(s.start, s.end);
    return `${lo + 1}..${hi}`;
  });
  const inner = parts.length > 1 ? `join(${parts.join(",")})` : parts[0];
  return f.strand === -1 ? `complement(${inner})` : inner;
}
