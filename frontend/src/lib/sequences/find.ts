/**
 * Pure search logic behind the sequence-editor Find box (the SnapGene-style
 * search family). No DOM, no React. Everything here is deterministic and
 * unit-testable; the box UI and SequenceEditView wiring only call into these
 * functions and render the results.
 *
 * Modes:
 *  - "dna"     : exact substring on BOTH strands, IUPAC-degeneracy-aware. When
 *                an exact search yields zero hits, {@link findCloseDna} runs the
 *                alignment engine (seed-and-extend) to surface the closest
 *                approximate site(s), each with a percent identity + mismatch
 *                count for the "closest match" readout.
 *  - "name"    : substring match over feature names (incl. primers) and bundled
 *                restriction-enzyme names; jumps to where each named thing sits
 *                on the sequence.
 *  - "protein" : translate the 3 forward frames (optionally 3 reverse frames)
 *                and substring-search the amino-acid query, mapping AA hits back
 *                to nucleotide coordinates. Exact only for now (close-match for
 *                protein is deferred, see findProtein doc).
 *
 * Coordinates are 0-based half-open `[start, end)` in FORWARD-strand sequence
 * space, matching SeqViz's Range. `direction` is +1 for a forward-strand hit,
 * -1 for a reverse-strand hit, mirroring SeqViz's convention so a hit can be fed
 * straight into the viewer's match list.
 */
import { seedAndExtend, reverseComplement, iupacCompatible } from "@/lib/align";
import { translateFrame1 } from "./export";
import { allEnzymeInfos } from "./enzyme-filters";
import type { EditFeature } from "./edit-model";

/** The Find box modes, in the priority order the UI presents them. */
export type FindMode = "dna" | "name" | "protein";

/** A single search hit, render-ready for the viewer's match list. */
export interface FindMatch {
  /** 0-based half-open start in forward-strand coordinates. */
  start: number;
  /** 0-based half-open end in forward-strand coordinates. */
  end: number;
  /** +1 forward-strand hit, -1 reverse-strand hit. */
  direction: 1 | -1;
  /** Human label for the hit (the matched name, or a "closest match" note). */
  label?: string;
}

/** Result of a close (approximate) DNA search: the best hit(s) plus a readout. */
export interface CloseDnaMatch extends FindMatch {
  /** Percent identity in [0, 100], rounded for display. */
  identityPct: number;
  /** Number of mismatching columns (substitutions) in the alignment. */
  mismatches: number;
  /** Number of gap columns (insertions + deletions) in the alignment. */
  gaps: number;
}

const DNA_QUERY = /[^ACGTURYSWKMBDHVN]/i;

/** True when `q` is a usable DNA / IUPAC query (non-empty, only valid codes). */
export function isDnaQuery(q: string): boolean {
  const t = q.trim();
  return t.length > 0 && !DNA_QUERY.test(t);
}

/**
 * Exact DNA substring search on BOTH strands, IUPAC-degeneracy-aware.
 *
 * The query is matched as written (forward, direction +1) and as its reverse
 * complement (reverse strand, direction -1). A position counts as a match when
 * every query base is IUPAC-compatible with the corresponding target base, so a
 * query of "N" matches any base and a target "R" matches a query "A". For a
 * circular sequence, matches that wrap past the end are found by scanning a
 * doubled window; only wraps that start within the original length are kept.
 *
 * Returns forward-coordinate hits sorted by start, forward strand before
 * reverse at the same position. Reverse hits report the forward span the query's
 * reverse complement occupies (so highlighting lands on the right bases).
 */
export function findExactDna(
  query: string,
  seq: string,
  circular = false,
): FindMatch[] {
  const q = query.trim().toUpperCase();
  if (q.length === 0) return [];
  const target = seq.toUpperCase();
  if (target.length === 0) return [];

  const matches: FindMatch[] = [];
  const rc = reverseComplement(q);

  scanStrand(q, target, 1, circular, matches);
  // Skip the reverse pass for a palindrome to avoid duplicate spans.
  if (rc !== q) scanStrand(rc, target, -1, circular, matches);

  matches.sort((a, b) => a.start - b.start || b.direction - a.direction);
  return matches;
}

function scanStrand(
  pattern: string,
  target: string,
  direction: 1 | -1,
  circular: boolean,
  out: FindMatch[],
): void {
  const n = target.length;
  const m = pattern.length;
  if (m === 0 || m > (circular ? n : n)) return;
  // A doubled window lets a circular search find wraps; a linear search uses the
  // plain target. We only emit hits whose start is within [0, n).
  const haystack = circular ? target + target : target;
  const lastStart = circular ? n - 1 : n - m;
  for (let i = 0; i <= lastStart; i++) {
    if (i + m > haystack.length) break;
    let ok = true;
    for (let j = 0; j < m; j++) {
      if (!iupacCompatible(pattern[j], haystack[i + j])) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const end = i + m;
    out.push({
      start: i,
      // A circular wrap keeps an end > n so callers can detect/normalize it; for
      // linear it is always <= n.
      end: circular && end > n ? end - n : end,
      direction,
    });
  }
}

/** Options for the close (approximate) DNA search. */
export interface CloseDnaOptions {
  /** Treat the target as circular (search wraps the origin). Default false. */
  circular?: boolean;
  /** Max hits to return (best first). Default 3. */
  maxHits?: number;
  /**
   * Floor on identity to surface a hit at all, in [0, 1]. Below this the result
   * is "no close match either" rather than a misleading low-identity hit.
   * Default 0.6.
   */
  minIdentity?: number;
}

/**
 * Approximate ("closest") DNA search via the alignment engine. Used as the
 * fallback when {@link findExactDna} returns nothing. Runs seed-and-extend
 * (semi-global, both strands) so the WHOLE query is placed against the target,
 * then reports the best-scoring site(s) with a percent identity, a substitution
 * count, and a gap count for the "closest match: X% identity, N mismatches"
 * readout.
 *
 * Circular targets are handled by aligning against a doubled target and folding
 * coordinates back; hits whose start lands past the original length are dropped
 * (they are duplicates of an early-origin hit).
 */
export function findCloseDna(
  query: string,
  seq: string,
  options: CloseDnaOptions = {},
): CloseDnaMatch[] {
  const q = query.trim().toUpperCase();
  if (q.length < 2) return [];
  const base = seq.toUpperCase();
  if (base.length === 0) return [];

  const circular = options.circular ?? false;
  const maxHits = options.maxHits ?? 3;
  const minIdentity = options.minIdentity ?? 0.6;
  const target = circular ? base + base : base;

  const hits = seedAndExtend(q, target, {
    mode: "semiGlobal",
    bothStrands: true,
    maxHits: maxHits * 3,
  });

  const out: CloseDnaMatch[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    if (h.alignment.identity < minIdentity) continue;
    let start = h.targetStart;
    let end = h.targetEnd;
    if (circular) {
      if (start >= base.length) continue; // duplicate of an early-origin hit
      if (end > base.length) end = end - base.length;
    }
    const key = `${start}:${h.strand}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let mismatches = 0;
    let gaps = 0;
    for (const op of h.alignment.ops) {
      if (op === "X") mismatches++;
      else if (op === "I" || op === "D") gaps++;
    }
    const identityPct = Math.round(h.alignment.identity * 100);
    out.push({
      start,
      end,
      direction: h.strand,
      identityPct,
      mismatches,
      gaps,
      label: `closest match: ${identityPct}% identity, ${mismatches} mismatch${
        mismatches === 1 ? "" : "es"
      }${gaps > 0 ? `, ${gaps} gap${gaps === 1 ? "" : "s"}` : ""}`,
    });
    if (out.length >= maxHits) break;
  }
  return out;
}

/** A by-name hit: where a named feature / primer / enzyme site sits. */
export interface NameMatch extends FindMatch {
  /** What kind of thing matched, for grouping / labels. */
  kind: "feature" | "primer" | "enzyme";
  /** The display name of the matched feature / primer / enzyme. */
  name: string;
}

/**
 * Find features, primers, and restriction-enzyme sites whose NAME contains the
 * query (case-insensitive substring). Features and primers come from the
 * document; their coordinates are taken straight from the feature span. Enzymes
 * are matched by name against the bundled enzyme set, then their recognition
 * sites are located on the sequence (both strands, IUPAC-aware) so each cut site
 * becomes a jumpable hit.
 *
 * `primer_bind` features are reported as kind "primer"; all other feature types
 * as kind "feature". Results are ordered features/primers first (in document
 * order), then enzyme sites by position.
 */
export function findByName(
  query: string,
  seq: string,
  features: EditFeature[],
  circular = false,
): NameMatch[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];
  const out: NameMatch[] = [];

  for (const f of features) {
    if (!f.name || !f.name.toLowerCase().includes(q)) continue;
    const isPrimer = (f.type || "").toLowerCase() === "primer_bind";
    out.push({
      start: Math.min(f.start, f.end),
      end: Math.max(f.start, f.end),
      direction: f.strand === -1 || f.forward === false ? -1 : 1,
      kind: isPrimer ? "primer" : "feature",
      name: f.name,
    });
  }

  // Enzyme sites: match the enzyme NAME, then locate every recognition site.
  const target = seq.toUpperCase();
  if (target.length > 0) {
    for (const info of allEnzymeInfos()) {
      if (!info.name.toLowerCase().includes(q)) continue;
      if (!info.rseq) continue;
      const sites = findExactDna(info.rseq, target, circular);
      for (const s of sites) {
        out.push({
          start: s.start,
          end: s.end,
          direction: s.direction,
          kind: "enzyme",
          name: info.name,
        });
      }
    }
  }

  return out;
}

const PROTEIN_QUERY = /^[ACDEFGHIKLMNPQRSTVWY*]+$/i;

/** True when `q` looks like an amino-acid query (only the 20 AAs + stop). */
export function isProteinQuery(q: string): boolean {
  const t = q.trim();
  return t.length > 0 && PROTEIN_QUERY.test(t);
}

/** Options for the protein-frame search. */
export interface FindProteinOptions {
  /** Also translate + search the 3 reverse frames. Default true. */
  bothStrands?: boolean;
}

/**
 * Translate the 3 forward reading frames (and, by default, the 3 reverse frames)
 * and substring-search the amino-acid `query`. Each AA hit is mapped back to the
 * nucleotide span it covers (3 bases per residue), in forward-strand coordinates,
 * tagged with the strand it was found on.
 *
 * Exact AA substring only. Protein CLOSE-MATCH (approximate, BLOSUM-scored) is
 * deferred: the alignment engine's scoring seam is DNA-only today (dnaScoring),
 * so an honest protein approximate search needs a protein substitution matrix
 * that isn't wired yet. The box surfaces "no protein close-match yet" rather than
 * faking one. See SEQUENCE_EDITOR_PROPOSAL for the BLOSUM62 follow-up.
 */
export function findProtein(
  query: string,
  seq: string,
  options: FindProteinOptions = {},
): FindMatch[] {
  const q = query.trim().toUpperCase();
  if (q.length === 0) return [];
  const bothStrands = options.bothStrands ?? true;
  const fwd = seq.toUpperCase();
  const n = fwd.length;
  if (n === 0) return [];

  const out: FindMatch[] = [];

  const search = (strand: 1 | -1, strandSeq: string) => {
    for (let frame = 0; frame < 3; frame++) {
      const aa = translateFrame1(strandSeq.slice(frame));
      let from = 0;
      for (;;) {
        const idx = aa.indexOf(q, from);
        if (idx < 0) break;
        // AA index idx -> nucleotide offset (within strandSeq) = frame + idx*3.
        const ntStart = frame + idx * 3;
        const ntEnd = ntStart + q.length * 3;
        if (strand === 1) {
          out.push({ start: ntStart, end: ntEnd, direction: 1 });
        } else {
          // Map a reverse-strand span back to forward coordinates: the reverse
          // sequence index i corresponds to forward index (n - 1 - i), so a
          // [ntStart, ntEnd) span on the reverse strand covers forward
          // [n - ntEnd, n - ntStart).
          out.push({ start: n - ntEnd, end: n - ntStart, direction: -1 });
        }
        from = idx + 1;
      }
    }
  };

  search(1, fwd);
  if (bothStrands) search(-1, reverseComplement(fwd));

  out.sort((a, b) => a.start - b.start || b.direction - a.direction);
  return out;
}
