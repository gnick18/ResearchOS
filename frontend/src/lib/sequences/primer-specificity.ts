// specificity bot — PURE local-library specificity scan + the NCBI Primer-BLAST
// handoff payload builder. Build item 2 of the cloning/primer plan
// (docs/proposals/CLONING_PRIMER_PROPOSAL.md section 7).
//
// TWO independent pieces, neither needs a backend:
//
//  1. LOCAL-LIBRARY SPECIFICITY (always on, no network). Given a primer and a set
//     of the user's OWN connected sequences, find EVERY place the primer anneals
//     across that library and classify each hit as the INTENDED site (the primer's
//     designed binding site on its parent sequence) vs an EXTRA / off-target site.
//     This catches the most common real failure: a primer that also primes
//     elsewhere on the user's own construct or library. It reuses `findBindingSites`
//     (3'-anchored, both strands) so the math matches the rest of the editor. It
//     does NOT see genome-wide off-targets and the UI says so.
//
//  2. NCBI PRIMER-BLAST HANDOFF (on demand, genome-wide, external). Build the exact
//     hidden-form field map for an auto-submitting POST to Primer-BLAST. This module
//     only produces the {action, fields} payload (pure + testable); the component
//     creates the hidden <form>, submits it to a new tab, and shows the privacy
//     notice. Field names were verified against the LIVE form on 2026-06-03
//     (curl of https://www.ncbi.nlm.nih.gov/tools/primer-blast/ ->
//     name="INPUT_SEQUENCE", name="PRIMER_LEFT_INPUT", name="PRIMER_RIGHT_INPUT",
//     form action="./primertool.cgi" method="post"). If NCBI changes these names the
//     handoff degrades gracefully (see buildPrimerBlastHandoff): we still open
//     Primer-BLAST, just unfilled. The LOCAL check is the guaranteed baseline.

import { findBindingSites, type BindingSite } from "./primer";

// --- LOCAL-LIBRARY SPECIFICITY ----------------------------------------------

/** One sequence in the user's connected library, ready to scan. */
export interface LibrarySequence {
  /** Stable id (matches the on-disk `{id}.gb`). */
  id: number;
  /** User-facing name. */
  name: string;
  /** Forward-strand bases (uppercased). */
  seq: string;
  /** Whether the molecule is circular (plasmid). A circular template can anneal a
   *  primer across the origin; we note it but do not (yet) wrap the search. */
  circular?: boolean;
}

/** A single annealing hit found during the library scan. */
export interface SpecificityHit {
  /** Which library sequence this hit is on. */
  sequenceId: number;
  sequenceName: string;
  /** The binding site (forward-strand [start, end), strand, anneal length). */
  site: BindingSite;
  /** True when this is the primer's INTENDED designed site (its parent sequence,
   *  full-length match). Everything else is an extra / possibly-unintended site. */
  intended: boolean;
}

export interface SpecificityReport {
  /** The primer that was scanned (sanitized, 5'->3'). */
  primer: string;
  /** Every hit across the scanned library, intended first then by sequence/pos. */
  hits: SpecificityHit[];
  /** Hits flagged as extra / off-target (amber in the UI). */
  offTargets: SpecificityHit[];
  /** How many library sequences were actually scanned. */
  scanned: number;
  /** How many sequences were skipped because the cap was hit (0 = none). */
  skipped: number;
  /** The minimum annealed bp counted as a real hit (the off-target sensitivity). */
  minAnneal: number;
}

export interface ScanOptions {
  /** The library sequence the primer was DESIGNED against, so we can mark its
   *  binding site(s) as intended rather than off-target. Omit for a pasted primer
   *  with no known parent (then every site is reported as "extra"). */
  intendedSequenceId?: number;
  /** Only count a partial 3'-anchored hit if at least this many bases anneal. A
   *  longer minimum hides incidental short matches; a shorter one is more
   *  sensitive. Default 12 bp (a 3' tail of 12 complementary bases is enough to
   *  prime in practice and is the level Primer-BLAST flags). */
  minAnneal?: number;
  /** Cap the number of sequences scanned to keep the scan instant on a large
   *  library. When more sequences are supplied than the cap, the extras are
   *  skipped and reported via `skipped`. Default 200. */
  maxSequences?: number;
}

const DEFAULT_MIN_ANNEAL = 12;
const DEFAULT_MAX_SEQUENCES = 200;

/**
 * Scan `primer` against the user's connected `library` and report every annealing
 * site, classifying each as the intended designed site vs an extra/off-target one.
 *
 * Pure: no I/O. The caller (the panel) loads the library bases via `sequencesApi`
 * and passes them in. Reuses `findBindingSites` (full + 3'-anchored partial, both
 * strands) so the binding math matches the Check view's single-sequence scan.
 *
 * "Intended" = a FULL-LENGTH match on the primer's parent sequence
 * (`intendedSequenceId`). Designed primers anneal full-length to their template;
 * a partial 3'-anchored hit, or any hit on a DIFFERENT sequence, is an extra site.
 */
export function scanLibrarySpecificity(
  primer: string,
  library: LibrarySequence[],
  opts: ScanOptions = {},
): SpecificityReport {
  const minAnneal = opts.minAnneal ?? DEFAULT_MIN_ANNEAL;
  const maxSequences = opts.maxSequences ?? DEFAULT_MAX_SEQUENCES;

  // Scan the intended (parent) sequence first so its row sorts to the top, then
  // the rest. Cap the total scanned; report any overflow as skipped.
  const ordered = [...library].sort((a, b) => {
    if (a.id === opts.intendedSequenceId) return -1;
    if (b.id === opts.intendedSequenceId) return 1;
    return 0;
  });
  const toScan = ordered.slice(0, maxSequences);
  const skipped = Math.max(0, ordered.length - toScan.length);

  const hits: SpecificityHit[] = [];
  for (const lib of toScan) {
    if (!lib.seq) continue;
    const sites = findBindingSites(primer, lib.seq, {
      allowPartial: true,
      minAnneal,
    });
    for (const site of sites) {
      const isParent = lib.id === opts.intendedSequenceId;
      // The intended site is a full-length anneal on the parent sequence. A
      // partial hit on the parent (a 3' tail matching elsewhere) is still an
      // extra site worth flagging.
      const intended = isParent && site.fullMatch;
      hits.push({
        sequenceId: lib.id,
        sequenceName: lib.name,
        site,
        intended,
      });
    }
  }

  // If the primer was designed against a parent but multiple full-length matches
  // exist on that parent, only the first is the "intended" one; the others are
  // genuine extra sites on the same molecule.
  let intendedSeen = false;
  for (const h of hits) {
    if (h.intended) {
      if (intendedSeen) h.intended = false;
      else intendedSeen = true;
    }
  }

  // Sort: intended first, then by sequence name, then by position.
  hits.sort((a, b) => {
    if (a.intended !== b.intended) return a.intended ? -1 : 1;
    if (a.sequenceName !== b.sequenceName)
      return a.sequenceName.localeCompare(b.sequenceName);
    return a.site.start - b.site.start;
  });

  const offTargets = hits.filter((h) => !h.intended);

  return {
    primer: primer.toUpperCase().replace(/[^ACGTU]/g, ""),
    hits,
    offTargets,
    scanned: toScan.filter((l) => !!l.seq).length,
    skipped,
    minAnneal,
  };
}

// --- NCBI PRIMER-BLAST HANDOFF ----------------------------------------------

/** The exact Primer-BLAST CGI endpoint (verified live 2026-06-03). The form on
 *  /tools/primer-blast/ posts to the relative ./primertool.cgi; this is its
 *  absolute URL. */
export const PRIMER_BLAST_ENDPOINT =
  "https://www.ncbi.nlm.nih.gov/tools/primer-blast/primertool.cgi";

/** The base Primer-BLAST page, used as the graceful-degrade target (open the form
 *  UNFILLED) if we cannot build a confident payload. */
export const PRIMER_BLAST_BASE =
  "https://www.ncbi.nlm.nih.gov/tools/primer-blast/";

export interface PrimerBlastInput {
  /** The template / amplicon sequence (forward strand). Goes into INPUT_SEQUENCE.
   *  Optional: Primer-BLAST can check primers without a template too, but a
   *  template lets it report binding position. */
  template?: string;
  /** The forward primer (5'->3'). Goes into PRIMER_LEFT_INPUT. */
  forwardPrimer?: string;
  /** The reverse primer (5'->3'). Goes into PRIMER_RIGHT_INPUT. */
  reversePrimer?: string;
}

export interface PrimerBlastHandoff {
  /** Where the hidden form POSTs. */
  action: string;
  /** name -> value pairs to render as hidden <input>s. */
  fields: Record<string, string>;
  /** False when we had nothing useful to prefill (no primer and no template); the
   *  caller should then just open PRIMER_BLAST_BASE in a new tab unfilled. */
  prefilled: boolean;
}

const MAX_NCBI_SEQUENCE = 50_000; // keep the POST body sane; long templates are rare for primer checks

function cleanSeq(raw: string | undefined): string {
  if (!raw) return "";
  return raw.toUpperCase().replace(/[^ACGTU]/g, "").slice(0, MAX_NCBI_SEQUENCE);
}

/**
 * Build the auto-submitting POST payload for Primer-BLAST's "check user primers"
 * flow. The component renders these as hidden inputs in a
 * `<form method="POST" action={action} target="_blank">` and submits on click.
 *
 * Field names (verified against the live form, 2026-06-03):
 *   INPUT_SEQUENCE      — the template/amplicon
 *   PRIMER_LEFT_INPUT   — the forward primer to check
 *   PRIMER_RIGHT_INPUT  — the reverse primer to check
 *   SEARCHMODE=1        — "User guided" mode (check the supplied primers)
 *
 * GRACEFUL DEGRADE: if neither a primer nor a template is supplied we return
 * `prefilled: false` and an empty field map; the caller then opens the base
 * Primer-BLAST page unfilled rather than POSTing junk. The form-field names are
 * the one external fragility (NCBI does not document them); if NCBI renames a
 * field the extra inputs are simply ignored by their CGI and the page still opens,
 * so the handoff never hard-breaks. The local-library check is unaffected either
 * way.
 */
export function buildPrimerBlastHandoff(input: PrimerBlastInput): PrimerBlastHandoff {
  const template = cleanSeq(input.template);
  const fwd = cleanSeq(input.forwardPrimer);
  const rev = cleanSeq(input.reversePrimer);

  const fields: Record<string, string> = {};
  if (template) fields.INPUT_SEQUENCE = template;
  if (fwd) fields.PRIMER_LEFT_INPUT = fwd;
  if (rev) fields.PRIMER_RIGHT_INPUT = rev;

  const prefilled = Object.keys(fields).length > 0;
  // SEARCHMODE=1 = "User guided": check the user-supplied primers rather than
  // designing fresh ones. Only meaningful when we actually pass a primer.
  if (fwd || rev) fields.SEARCHMODE = "1";

  return {
    action: prefilled ? PRIMER_BLAST_ENDPOINT : PRIMER_BLAST_BASE,
    fields,
    prefilled,
  };
}
