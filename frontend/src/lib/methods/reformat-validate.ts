// Verbatim faithful-subset validator for the method phone-projection reformatter
// (method phone projection reformatter, Phase 2, 2026-06-14).
//
// A protocol is safety-critical: a wrong volume, temperature, time, or reagent is
// a ruined experiment or a hazard. The LLM reformatter is allowed ONLY to
// re-STRUCTURE a method body (number the steps, add phase headings, classify a
// list as reagents vs prose). It is never allowed to add, drop, merge, or
// paraphrase a VALUE. This module enforces that deterministically, BEFORE the
// reformatted markdown is ever cached or shown, so the model's freedom is
// bounded by code, not by trust.
//
// The check is a faithful-subset check over two token classes:
//   1. NUMERICS  - every distinct number in the output must appear in the source.
//      This is the hard gate: an invented or changed quantity (5 mL -> 15 mL) is
//      exactly the failure mode we cannot ship.
//   2. WORDS     - every content word in the output must appear in the source
//      (minus a tiny allowlist of structural scaffolding the reformatter is
//      explicitly permitted to introduce, e.g. "Step", "Materials"). This stops
//      the model inventing a reagent name or an instruction the source never had.
// Plus a COVERAGE floor: the output must retain most of the source's numbers, so
// a reformat that silently drops half the steps is rejected too.
//
// On any failure the caller discards the LLM output and falls back to the
// deterministic parse (or the raw body). Erring strict is correct here: a
// rejected-but-faithful reformat just means a slightly less pretty reader, while
// a passed-but-unfaithful one means a wrong number at the bench. So this mirrors
// the project-wide rule (summary suite, vendor-verbatim): the deterministic layer
// is the source of truth, the model only formats.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

/** Structural scaffolding words the reformatter MAY introduce even when the
 *  source did not use them. Kept deliberately tiny: only words that carry pure
 *  structure / classification, never a word that could change protocol meaning.
 *  All compared lowercase. */
const STRUCTURAL_WORDS = new Set([
  "step",
  "steps",
  "of",
  "materials",
  "material",
  "reagents",
  "reagent",
  "notes",
  "note",
  "figure",
  "figures",
]);

/** Default fraction of the source's distinct numbers the output must retain.
 *  Below this we treat the reformat as having dropped too much (e.g. swallowed
 *  whole steps) and reject it. 0.85 tolerates the model legitimately shedding a
 *  little numeric noise (a stray page or figure number) without letting a real
 *  step vanish silently. */
export const DEFAULT_COVERAGE_FLOOR = 0.85;

export type ReformatValidation = {
  /** True when the output is a faithful structural reformat of the source. */
  ok: boolean;
  /** Distinct numbers present in the output but NOT in the source (the hard
   *  failure: invented or changed quantities). Empty on success. */
  inventedNumerics: string[];
  /** Distinct content words present in the output but not in the source and not
   *  in the structural allowlist (invented reagents / instructions). Empty on
   *  success. */
  inventedWords: string[];
  /** Fraction of the source's distinct numbers that survived into the output. */
  coverage: number;
  /** Whether coverage fell below the floor (a step-dropping reformat). */
  coverageShort: boolean;
};

/** Strip the leading markdown STRUCTURE markers from one line so a list index or
 *  heading hash the reformatter adds is never mistaken for a protocol value.
 *  Removes an ordered-list marker ("1." / "2)"), a bullet ("-" / "*" / "+"), and
 *  heading hashes. Crucially the ordered-list regex requires whitespace AFTER the
 *  dot, so a real decimal like "1.5 mL" is left fully intact. */
function stripLeadingMarkers(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s+/, "") // heading
    .replace(/^\s*\d+[.)]\s+/, "") // ordered-list index
    .replace(/^\s*[-*+]\s+/, "") // bullet
    .replace(/^\s*\|/, "") // leading table pipe
    .replace(/\|/g, " "); // remaining table pipes -> spaces
}

/** Normalize text for tokenizing: NFKC fold (so unicode digits/letters and full
 *  width forms collapse), lowercase, and map the unicode multiply sign to ASCII
 *  so "5 x 10" and "5 * 10" tokenize identically. */
function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[×✕]/g, "*");
}

/** Distinct numeric tokens in a block of text. A numeric token is a run of
 *  digits with an optional single decimal point ("37", "1.5", "0.7"). Scientific
 *  notation like "5*10^6" yields its component numbers (5, 10, 6), which is fine:
 *  the subset check only cares that every output number also exists in the
 *  source. List indices and heading hashes are stripped first so they never
 *  count as values. */
export function extractNumerics(text: string): Set<string> {
  const out = new Set<string>();
  for (const rawLine of normalize(text).split("\n")) {
    const line = stripLeadingMarkers(rawLine);
    const matches = line.match(/\d+(?:\.\d+)?/g);
    if (matches) for (const m of matches) out.add(m);
  }
  return out;
}

/** Distinct content words in a block of text. A word is a letter-led run of
 *  letters/digits with internal hyphens or apostrophes ("tris-hcl", "37c",
 *  "5'"). Markdown emphasis and list markers fall away because we split on
 *  non-word punctuation. Pure numbers are handled by extractNumerics, so a
 *  bare number is not a "word". */
export function extractWords(text: string): Set<string> {
  const out = new Set<string>();
  // \p{L} ensures unicode letters (e.g. greek mu) are kept; a word must contain
  // at least one letter so "37" alone is not a word but "37c" is.
  const re = /[\p{L}][\p{L}\p{N}]*(?:[-'][\p{L}\p{N}]+)*/gu;
  const m = normalize(text).match(re);
  if (m) for (const w of m) out.add(w);
  return out;
}

/**
 * Validate that `output` is a faithful structural reformat of `source`. Pure and
 * deterministic. See the module header for the contract.
 */
export function validateReformat(
  source: string,
  output: string,
  opts: { coverageFloor?: number } = {},
): ReformatValidation {
  const coverageFloor = opts.coverageFloor ?? DEFAULT_COVERAGE_FLOOR;

  const srcNums = extractNumerics(source);
  const outNums = extractNumerics(output);
  const srcWords = extractWords(source);
  const outWords = extractWords(output);

  const inventedNumerics = [...outNums].filter((n) => !srcNums.has(n));
  const inventedWords = [...outWords].filter(
    (w) => !srcWords.has(w) && !STRUCTURAL_WORDS.has(w),
  );

  // Coverage over the source's numbers: how many survived into the output. With
  // no numbers in the source, coverage is vacuously full.
  const retained = [...srcNums].filter((n) => outNums.has(n)).length;
  const coverage = srcNums.size === 0 ? 1 : retained / srcNums.size;
  const coverageShort = coverage < coverageFloor;

  const ok =
    inventedNumerics.length === 0 &&
    inventedWords.length === 0 &&
    !coverageShort;

  return { ok, inventedNumerics, inventedWords, coverage, coverageShort };
}
