// Near-miss tolerant icon search over the open-asset library. The plain
// substring filter (searchAssets) misses the cases that make a 30k-icon picker
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
  // --- Lab equipment + techniques (common picker searches) ---
  ["centrifuge", "rotor", "ultracentrifuge", "spin"],
  ["incubator", "co2 incubator", "shaker"],
  ["petri dish", "agar plate", "culture dish", "culture plate"],
  ["microplate", "96 well", "well plate", "multiwell", "96-well"],
  ["gel", "electrophoresis", "agarose", "sds page", "western blot", "blot"],
  ["pcr", "thermocycler", "amplification", "qpcr", "rt-pcr"],
  ["spectrometer", "spectroscopy", "mass spec", "spectrophotometer", "mass spectrometry"],
  ["chromatography", "hplc", "fplc", "column chromatography"],
  ["crispr", "cas9", "gene editing", "guide rna"],
  ["vaccine", "immunization", "vaccination"],
  ["stem cell", "ipsc", "embryonic stem cell", "pluripotent"],
  ["scale", "balance", "weighing", "weigh"],
  ["safety", "goggles", "gloves", "lab coat", "ppe"],
  ["biohazard", "hazard", "warning", "caution"],
  ["thermometer", "temperature", "heat"],
  ["dropper", "dropper bottle", "reagent"],
  // --- Cell biology + molecular structures ---
  ["chromosome", "karyotype", "chromatin"],
  ["ribosome", "translation"],
  ["golgi", "golgi apparatus", "endoplasmic reticulum"],
  ["nucleus", "nuclear", "nucleolus"],
  ["mitosis", "cell division", "meiosis", "cell cycle"],
  ["vesicle", "exosome", "vacuole"],
  ["flagellum", "flagella", "cilia", "cilium"],
  ["antigen", "epitope"],
  // --- Anatomy + physiology ---
  ["blood", "red blood cell", "erythrocyte", "platelet", "plasma"],
  ["white blood cell", "leukocyte", "macrophage", "neutrophil"],
  ["bone", "skeleton", "skeletal", "osteo"],
  ["muscle", "muscular", "myocyte", "myosin"],
  ["skin", "dermis", "epidermis", "keratinocyte"],
  ["eye", "retina", "ocular", "vision"],
  ["stomach", "gastric", "intestine", "gut", "gastrointestinal"],
  ["hormone", "endocrine", "signaling molecule"],
  ["embryo", "fetus", "development", "embryonic"],
  ["egg", "ovum", "oocyte"],
  ["sperm", "spermatozoa"],
  // --- Model organisms + general ---
  ["worm", "c elegans", "nematode"],
  ["frog", "xenopus", "amphibian"],
  ["glucose", "sugar", "carbohydrate"],
  ["lipid", "fat", "fatty acid", "triglyceride"],
  ["water", "h2o", "droplet"],
  ["earth", "globe", "world", "planet"],
  ["arrow", "pointer", "direction"],
  ["clock", "time", "timer", "stopwatch"],
  // --- Electronics / circuit symbols (2026-06-19, the KiCad + chris-pikul +
  //     Wikimedia electronics expansion) ---
  ["resistor", "resistance", "potentiometer", "rheostat", "ohm"],
  ["capacitor", "capacitance", "cap"],
  ["inductor", "inductance", "coil", "choke", "solenoid"],
  ["transistor", "bjt", "mosfet", "jfet", "fet", "npn", "pnp"],
  ["diode", "led", "light emitting diode", "zener", "rectifier"],
  ["op-amp", "opamp", "operational amplifier"],
  ["logic gate", "and gate", "or gate", "nand", "nor", "xor", "inverter", "not gate", "buffer gate"],
  ["transformer", "primary winding", "secondary winding"],
  ["integrated circuit", "ic", "chip", "microchip", "microcontroller", "mcu"],
  ["connector", "header", "plug", "socket", "jack", "terminal"],
  ["battery", "power supply", "voltage source", "current source"],
  ["relay", "contactor", "solid state relay"],
  ["fuse", "circuit breaker", "varistor"],
  ["antenna", "aerial", "dipole"],
  ["ground", "gnd", "earth ground"],
  ["circuit", "schematic", "wiring diagram", "circuit diagram"],
  // --- Physics (the janosh + Wikimedia physics-diagram expansion) ---
  ["feynman diagram", "particle interaction", "scattering diagram"],
  ["optics", "lens", "refraction", "reflection", "prism", "ray diagram"],
  ["wave", "waveform", "wavelength", "amplitude", "oscillation"],
  ["pendulum", "harmonic motion", "simple harmonic", "oscillator"],
  ["force", "free body diagram", "vector field", "newton"],
  ["kinematics", "velocity", "acceleration", "trajectory", "projectile"],
  ["thermodynamics", "entropy", "carnot", "heat engine", "isotherm"],
  ["quantum", "qubit", "superposition", "wavefunction", "bloch sphere"],
  ["magnetic field", "magnet", "magnetism", "magnetic flux"],
  ["electric field", "electric charge", "coulomb", "field lines"],
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
// A query term prepared ONCE per search: its words + each word's trigram set,
// so we never recompute the query side inside the 30k-asset loop.
interface PreparedTerm {
  words: { text: string; tri: Set<string> }[];
  isSynonym: boolean;
}

/** Best 0..1 match of one prepared query word against one haystack token. The
 *  cheap string checks run always; the allocating trigram fuzzy path runs only
 *  when `fuzzy` is set (the sparse-results fallback), since it is the dominant
 *  cost and is only needed for typos. */
function wordMatch(word: string, tri: Set<string>, hay: string, fuzzy: boolean): number {
  if (word === hay) return 1;
  if (hay.startsWith(word) && word.length >= 2) return 0.9;
  if (hay.includes(word) && word.length >= 3) return 0.72;
  if (word.includes(hay) && hay.length >= 4 && hay.length / word.length >= 0.6) return 0.6;
  if (!fuzzy || Math.abs(word.length - hay.length) > 3) return 0;
  const hg = trigrams(hay);
  let inter = 0;
  for (const g of tri) if (hg.has(g)) inter += 1;
  const sim = (2 * inter) / (tri.size + hg.size);
  return sim >= TRIGRAM_FLOOR ? sim * 0.85 : 0;
}

/** Best match of one prepared term across a field's tokens, scaled by weight. */
function termVsTokens(term: PreparedTerm, tokens: string[], weight: number, fuzzy: boolean): number {
  if (term.words.length > 1) {
    let sum = 0;
    for (const w of term.words) {
      let b = 0;
      for (const h of tokens) b = Math.max(b, wordMatch(w.text, w.tri, h, fuzzy));
      sum += b;
    }
    return (sum / term.words.length) * weight;
  }
  const w = term.words[0];
  let best = 0;
  for (const h of tokens) best = Math.max(best, wordMatch(w.text, w.tri, h, fuzzy));
  return best * weight;
}

// ---------------------------------------------------------------------------
// Precomputed index. Tokenizing 30k assets on every keystroke is the dominant
// cost, so do it ONCE (buildSearchIndex) and rank against the cached tokens.
// ---------------------------------------------------------------------------

export interface SearchDoc {
  asset: LibraryAsset;
  titleTokens: string[];
  catTokens: string[];
  tagTokens: string[];
}

/** Tokenize a manifest once into searchable docs (memoize on the asset list). */
export function buildSearchIndex(assets: LibraryAsset[]): SearchDoc[] {
  return assets.map((asset) => ({
    asset,
    titleTokens: toTokens(asset.title),
    catTokens: toTokens(asset.category ?? ""),
    tagTokens: toTokens(asset.tags.join(" ")),
  }));
}

function prepareTerm(text: string, isSynonym: boolean): PreparedTerm {
  return {
    words: text.split(" ").map((w) => ({ text: w, tri: trigrams(w) })),
    isSynonym,
  };
}

/** Rank precomputed docs by near-miss relevance. The hot path: no per-asset
 *  tokenization, query trigrams computed once. */
export function rankDocs(
  docs: SearchDoc[],
  query: string,
  opts: { minScore?: number; limit?: number } = {},
): ScoredAsset[] {
  const minScore = opts.minScore ?? 0.34;
  const limit = opts.limit ?? 240;
  const q = norm(query);
  if (!q) return [];
  const originalWords = q.split(" ").filter(Boolean);
  const original: PreparedTerm[] = [prepareTerm(q, false)];
  const synonyms: PreparedTerm[] = expandQuery(query)
    .filter((t) => t !== q && !originalWords.includes(t))
    .map((t) => prepareTerm(t, true));

  const scoreOnce = (fuzzy: boolean): ScoredAsset[] => {
    const out: ScoredAsset[] = [];
    for (const doc of docs) {
      let best = 0;
      for (const term of original) {
        best = Math.max(
          best,
          termVsTokens(term, doc.titleTokens, FIELD_WEIGHT.title, fuzzy),
          termVsTokens(term, doc.catTokens, FIELD_WEIGHT.category, fuzzy),
          termVsTokens(term, doc.tagTokens, FIELD_WEIGHT.tags, fuzzy),
        );
      }
      let score = best;
      if (score < 0.999) {
        for (const term of synonyms) {
          const s =
            Math.max(
              termVsTokens(term, doc.titleTokens, FIELD_WEIGHT.title, fuzzy),
              termVsTokens(term, doc.catTokens, FIELD_WEIGHT.category, fuzzy),
              termVsTokens(term, doc.tagTokens, FIELD_WEIGHT.tags, fuzzy),
            ) * SYNONYM_DISCOUNT;
          if (s > score) score = s;
        }
      }
      if (score >= minScore) out.push({ asset: doc.asset, score });
    }
    return out;
  };

  // Cheap pass first (no trigram allocation). Only when literal + synonym hits
  // are sparse (a likely typo) do the expensive fuzzy pass.
  let scored = scoreOnce(false);
  if (scored.length < 12) scored = scoreOnce(true);
  scored.sort((a, b) => b.score - a.score || a.asset.title.localeCompare(b.asset.title));
  return scored.slice(0, limit);
}

/**
 * Rank assets by near-miss relevance (typo + synonym tolerant). Convenience
 * wrapper that builds the index inline; callers that re-search the same manifest
 * should buildSearchIndex once and call rankDocs to avoid re-tokenizing.
 */
export function rankAssets(
  assets: LibraryAsset[],
  query: string,
  opts: { minScore?: number; limit?: number } = {},
): ScoredAsset[] {
  return rankDocs(buildSearchIndex(assets), query, opts);
}
