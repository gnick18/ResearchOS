// Near-miss tolerant icon search over the open-asset library. The plain
// substring filter (searchAssets) misses the cases that make a 14k-icon picker
// feel broken: a typo ("moose" for mouse), a synonym ("rodent"), or a domain
// term that is not literally in the title/tags ("cell death" -> apoptosis). This
// is a pure, unit-tested ranker that blends three signals into one score:
//   1. exact / prefix / substring token matches (keyword precision),
//   2. trigram (Dice) similarity for typo tolerance,
//   3. a curated science-synonym expansion for near-miss recall.
// It is the always-on baseline; a later embedding pass (client-side, lazy) can
// layer true semantics on top for the long tail. No model, no network, no deps.

import type { LibraryAsset } from "./asset-library";

/** An asset with its blended relevance score (0..1), for ranked display. */
export interface ScoredAsset {
  asset: LibraryAsset;
  score: number;
}

/** Lowercase, strip punctuation to spaces, collapse whitespace. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toTokens(s: string): string[] {
  const n = norm(s);
  return n ? n.split(" ").filter(Boolean) : [];
}

/** Character trigrams of a token (space-padded), for Dice similarity. */
function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Dice coefficient over character trigrams (0..1). Tolerant of small typos. */
export function trigramSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let inter = 0;
  for (const g of ta) if (tb.has(g)) inter += 1;
  return (2 * inter) / (ta.size + tb.size);
}

// Curated science-synonym groups: any term in a group expands a query to also
// match its group-mates. Kept lowercase + singular-ish; extend freely. This is
// the "near-miss recall" lever the embedding pass will eventually generalize.
const SYNONYM_GROUPS: string[][] = [
  ["mouse", "mice", "rat", "rodent", "mammal", "mus"],
  ["cell death", "apoptosis", "necrosis", "programmed cell death"],
  ["bacteria", "bacterium", "microbe", "prokaryote", "bacillus", "coccus", "microbiology"],
  ["virus", "viral", "virion", "phage", "bacteriophage"],
  ["dna", "nucleic acid", "genome", "double helix", "nucleotide", "gene", "genomics"],
  ["rna", "mrna", "transcript"],
  ["protein", "peptide", "amino acid", "enzyme", "polypeptide"],
  ["antibody", "immunoglobulin", "igg"],
  ["t cell", "lymphocyte", "immune cell"],
  ["neuron", "nerve", "neurone", "neural", "brain", "neuroscience"],
  ["heart", "cardiac", "cardiovascular"],
  ["lung", "pulmonary", "respiratory"],
  ["liver", "hepatic", "hepatocyte"],
  ["kidney", "renal", "nephron"],
  ["tumor", "tumour", "cancer", "oncology", "carcinoma", "neoplasm"],
  ["microscope", "microscopy", "imaging"],
  ["flask", "erlenmeyer", "beaker", "glassware"],
  ["tube", "eppendorf", "microcentrifuge", "vial"],
  ["pipette", "pipettor", "micropipette"],
  ["plant", "leaf", "flora", "algae"],
  ["fungus", "fungi", "mushroom", "yeast", "mold"],
  ["fish", "fishes", "zebrafish"],
  ["bird", "birds", "avian"],
  ["insect", "bug", "fly", "drosophila"],
  ["graph", "chart", "plot", "scientific graph"],
  ["sequencing", "ngs", "sequencer"],
  ["mitochondria", "mitochondrion", "organelle"],
  ["membrane", "lipid bilayer", "cell membrane"],
  ["syringe", "needle", "injection"],
  ["pill", "tablet", "drug", "medication", "capsule"],
  ["person", "people", "human", "scientist", "researcher"],
  ["molecule", "compound", "chemical", "chemistry"],
  ["receptor", "ion channel", "channel"],
];

/** token -> set of synonym terms (each term may itself be multi-word). */
const SYNONYM_INDEX: Map<string, Set<string>> = (() => {
  const m = new Map<string, Set<string>>();
  for (const group of SYNONYM_GROUPS) {
    for (const term of group) {
      const set = m.get(term) ?? new Set<string>();
      for (const other of group) if (other !== term) set.add(other);
      m.set(term, set);
    }
  }
  return m;
})();

/** Expand a normalized query into its terms plus any synonym terms. */
export function expandQuery(query: string): string[] {
  const q = norm(query);
  if (!q) return [];
  const terms = new Set<string>([q]);
  // Whole-query synonym (handles multi-word keys like "cell death").
  for (const syn of SYNONYM_INDEX.get(q) ?? []) terms.add(syn);
  // Per-token synonyms.
  for (const tok of q.split(" ")) {
    terms.add(tok);
    for (const syn of SYNONYM_INDEX.get(tok) ?? []) terms.add(syn);
  }
  return [...terms];
}

// Field weights: a hit in the title matters more than the category, more than a
// tag. Synonym-sourced hits are discounted so a literal match always outranks a
// synonym match of equal field.
const FIELD_WEIGHT = { title: 1.0, category: 0.9, tags: 0.72 } as const;
const SYNONYM_DISCOUNT = 0.78;
const TRIGRAM_FLOOR = 0.5; // below this, a fuzzy match is noise

/** Best 0..1 match of one query term against one haystack token. Direction
 *  matters: the query being a prefix/substring of a real asset word (the user
 *  typed a fragment) is a strong signal; an asset word merely sitting inside the
 *  query term ("rod" inside "rodent") is usually coincidental and discounted. */
function tokenMatch(term: string, hay: string): number {
  if (term === hay) return 1;
  // The user's term is the start of an asset word: "bacter" -> "bacteria".
  if (hay.startsWith(term) && term.length >= 2) return 0.9;
  // The user's term sits inside an asset word: "neuron" in "interneuron".
  if (hay.includes(term) && term.length >= 3) return 0.72;
  // An asset word sits inside the (longer) query term: coincidental unless the
  // asset word is substantial and covers most of the term (so "rod" no longer
  // hijacks "rodent", but "helix" still helps "double-helix").
  if (term.includes(hay) && hay.length >= 4 && hay.length / term.length >= 0.6) {
    return 0.6;
  }
  const sim = trigramSimilarity(term, hay);
  return sim >= TRIGRAM_FLOOR ? sim * 0.85 : 0;
}

/** Best match of one term across a field's tokens, scaled by field weight. */
function termVsField(term: string, fieldTokens: string[], weight: number): number {
  // Multi-word synonym terms (e.g. "cell death") match if all their words land.
  const parts = term.split(" ");
  let best = 0;
  if (parts.length > 1) {
    let sum = 0;
    for (const p of parts) {
      let b = 0;
      for (const h of fieldTokens) b = Math.max(b, tokenMatch(p, h));
      sum += b;
    }
    best = sum / parts.length;
  } else {
    for (const h of fieldTokens) best = Math.max(best, tokenMatch(term, h));
  }
  return best * weight;
}

/** Score one asset against an expanded query. The original (first) query term
 *  scores at full weight; synonym terms are discounted. */
function scoreAsset(asset: LibraryAsset, originalTerms: string[], synonymTerms: string[]): number {
  const fields: [string[], number][] = [
    [toTokens(asset.title), FIELD_WEIGHT.title],
    [toTokens(asset.category ?? ""), FIELD_WEIGHT.category],
    [toTokens(asset.tags.join(" ")), FIELD_WEIGHT.tags],
  ];
  // Every original query token must find *some* footing; we average their best
  // hits so a 2-word query needs both words represented, not just one.
  let originalScore = 0;
  for (const term of originalTerms) {
    let best = 0;
    for (const [tokens, w] of fields) best = Math.max(best, termVsField(term, tokens, w));
    originalScore += best;
  }
  originalScore = originalTerms.length ? originalScore / originalTerms.length : 0;

  // Synonyms only *raise* the score (best single synonym hit), discounted.
  let synScore = 0;
  for (const term of synonymTerms) {
    for (const [tokens, w] of fields) {
      synScore = Math.max(synScore, termVsField(term, tokens, w) * SYNONYM_DISCOUNT);
    }
  }
  return Math.max(originalScore, synScore);
}

/**
 * Rank assets by near-miss relevance to a free-text query. Returns scored
 * matches above `minScore`, best first, capped at `limit`. An empty query
 * returns [] (the caller shows the unfiltered/category view instead).
 */
export function rankAssets(
  assets: LibraryAsset[],
  query: string,
  opts: { minScore?: number; limit?: number } = {},
): ScoredAsset[] {
  const minScore = opts.minScore ?? 0.34;
  const limit = opts.limit ?? 240;
  const originalTerms = norm(query) ? norm(query).split(" ").filter(Boolean) : [];
  if (originalTerms.length === 0) return [];
  const expanded = expandQuery(query);
  const synonymTerms = expanded.filter((t) => !originalTerms.includes(t) && t !== norm(query));

  const scored: ScoredAsset[] = [];
  for (const asset of assets) {
    const score = scoreAsset(asset, originalTerms, synonymTerms);
    if (score >= minScore) scored.push({ asset, score });
  }
  // Highest score first; stable tiebreak on title so the order is deterministic.
  scored.sort((a, b) => b.score - a.score || a.asset.title.localeCompare(b.asset.title));
  return scored.slice(0, limit);
}
