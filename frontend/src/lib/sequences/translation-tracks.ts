// Which features get an amino-acid translation track in the sequence viewer.
//
// The naive rule ("translate every CDS/gene") double-paints the SAME protein
// when a locus carries overlapping annotations of different central-dogma
// stages: a `gene` + its `mRNA` isoforms + the `CDS` all overlap, so the
// reader shows the identical translation 3-5 times (the CIP2 case).
//
// We dedupe by CENTRAL-DOGMA PRIORITY: when translatable features OVERLAP on
// the same strand, keep only the one furthest down the dogma (closest to the
// protein) and suppress the rest:
//
//     CDS / mat_peptide  (3)   >   mRNA  (2)   >   gene  (1)
//
// So gene + mRNA + CDS at one locus -> just the CDS. A file that has ONLY mRNA
// (no CDS) still translates the mRNA; only-gene translates the gene. Distinct,
// non-overlapping CDSs elsewhere are all kept (the dedupe is per-locus, by
// overlap). Two identical CDS annotations of the same span collapse to one.
//
// Pure + unit-tested; the component maps the survivors to SeqViz translation
// props.

export interface TranslatableFeature {
  start: number;
  end: number;
  strand?: number;
  type?: string;
  name?: string;
}

const RANK: Record<string, number> = {
  cds: 3,
  mat_peptide: 3,
  mrna: 2,
  gene: 1,
};

/** Central-dogma rank for a feature type; 0 = not auto-translatable. */
export function translationRank(type?: string): number {
  return RANK[(type || "").trim().toLowerCase()] ?? 0;
}

/** A feature type the global "Show translation" toggle considers. */
export function isTranslatableType(type?: string): boolean {
  return translationRank(type) > 0;
}

function normStrand(s?: number): 1 | -1 {
  return s === -1 ? -1 : 1;
}

/** Fraction of the SHORTER feature that the two spans share (half-open). */
function overlapFraction(a: TranslatableFeature, b: TranslatableFeature): number {
  const lo = Math.max(a.start, b.start);
  const hi = Math.min(a.end, b.end);
  const overlap = Math.max(0, hi - lo);
  if (overlap <= 0) return 0;
  const shorter = Math.max(1, Math.min(a.end - a.start, b.end - b.start));
  return overlap / shorter;
}

/** The reading frame a feature translates in, on its own strand. Forward reads
 *  from `start`, reverse reads from `end` (the 3' boundary), so the frame is the
 *  respective boundary mod 3. Good enough for the dedup heuristic. */
function frameOf(f: TranslatableFeature): number {
  return (((normStrand(f.strand) === -1 ? f.end : f.start) % 3) + 3) % 3;
}

/** Two features describe "the same product" worth deduping: same strand and a
 *  substantial overlap of the shorter span. gene over mRNA over CDS (DIFFERENT
 *  dogma ranks) collapse to the CDS. But two features of the SAME rank (e.g. two
 *  CDS) are the same protein only when they also share a reading frame,
 *  overlapping CDS in DIFFERENT frames are distinct proteins and each keeps its
 *  own translation track. */
function sameProduct(a: TranslatableFeature, b: TranslatableFeature): boolean {
  if (normStrand(a.strand) !== normStrand(b.strand)) return false;
  if (overlapFraction(a, b) < 0.5) return false;
  if (translationRank(a.type) === translationRank(b.type)) {
    return frameOf(a) === frameOf(b);
  }
  return true;
}

/**
 * Choose which features get a translation track.
 *
 * - `isExplicit(f)` features (per-feature "translate this one" opt-ins) are
 *   ALWAYS included — the user chose them — and they pre-seed the accepted set
 *   so a global candidate overlapping an explicit one is not also drawn.
 * - When `globalOn`, every translatable-type feature is a candidate; candidates
 *   are accepted greedily highest-rank-first, and a candidate that shares a
 *   product (same strand + substantial overlap) with an already-accepted track
 *   is suppressed.
 *
 * Returns the surviving feature objects, in input order, with no duplicates.
 */
export function selectTranslationFeatures<T extends TranslatableFeature>(
  features: readonly T[],
  opts: { globalOn: boolean; isExplicit?: (f: T) => boolean },
): T[] {
  const isExplicit = opts.isExplicit ?? (() => false);
  const explicit = features.filter((f) => isExplicit(f));
  const accepted: T[] = [...explicit];

  if (opts.globalOn) {
    const candidates = features
      .filter((f) => isTranslatableType(f.type) && !isExplicit(f))
      // highest dogma rank first; within a rank, longer span first, then by
      // start — deterministic so identical-span duplicates collapse stably.
      .slice()
      .sort((a, b) => {
        const r = translationRank(b.type) - translationRank(a.type);
        if (r !== 0) return r;
        const lenDiff = b.end - b.start - (a.end - a.start);
        if (lenDiff !== 0) return lenDiff;
        return a.start - b.start;
      });
    for (const f of candidates) {
      if (accepted.some((g) => sameProduct(f, g))) continue;
      accepted.push(f);
    }
  }

  // Return in original input order, de-duplicated by identity.
  const keep = new Set(accepted);
  return features.filter((f) => keep.has(f));
}

/**
 * The feature annotation bars to draw, given which features are translated and
 * whether a CIRCULAR viewer is on screen.
 *
 * In the LINEAR viewer a translated feature renders as its own feature-colored
 * translation HANDLE (the amino-acid row sits on it), so we drop the duplicate
 * annotation bar to avoid painting the same feature twice. But the CIRCULAR map
 * has NO translation layer, so dropping the bar there makes the feature vanish
 * entirely the moment "Show translation" is enabled (the reported arc-hiding
 * bug). So we only suppress translated bars when NO circular viewer is present;
 * whenever a ring is showing (the standalone Map or the side-by-side "both"
 * view) we keep every feature arc, and translation simply ADDS its layer on top.
 */
export function annotationBarsToDraw<T>(
  annotations: readonly T[],
  isTranslated: (a: T) => boolean,
  hasCircularViewer: boolean,
): T[] {
  if (hasCircularViewer) return [...annotations];
  return annotations.filter((a) => !isTranslated(a));
}
