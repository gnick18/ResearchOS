// Deterministic fuzzy matcher for BeakerBot name resolvers (ai summary-robustness
// bot, 2026-06-14).
//
// The name resolvers (project names -> ids, member names -> usernames) need to
// turn what the USER typed into a real record key, tolerating case, extra/missing
// words, and small typos, WITHOUT asking the LLM to guess. This module is the
// shared deterministic layer: pure functions, no I/O, fully unit-tested, so a
// near-miss like "Kritka" resolves to "kritika" and "cyp51" resolves to the
// "cyp51A knockout" project instead of silently returning nothing.
//
// Tiered match, strongest first, so an exact hit always beats a fuzzy one:
//   1. exact (normalized) equality
//   2. token / prefix containment (first-name or partial, e.g. "kritika" in
//      "kritika nguyen", or "cyp51" as a prefix of "cyp51a knockout")
//   3. small edit distance (Levenshtein within a length-relative threshold)
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

/** Lowercase, trim, and collapse internal whitespace, so matching ignores case
 *  and spacing noise. Pure. */
export function normalizeForMatch(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

/** Damerau-Levenshtein edit distance (optimal string alignment): insert, delete,
 *  substitute, AND adjacent transposition all cost 1, so a common swap typo
 *  ("teh" -> "the", "grnat" -> "grant") counts as one edit, not two. Full DP
 *  matrix because the transposition rule needs row i-2; names are short so this is
 *  cheap. Pure. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1, // deletion
        d[i][j - 1] + 1, // insertion
        d[i - 1][j - 1] + cost, // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // adjacent transposition
      }
    }
  }
  return d[m][n];
}

/** The default edit-distance budget for a key of length n: ~30%, at least 1, but
 *  never so loose that two short unrelated words collide (capped at 3). So a
 *  6-char name tolerates 1 typo, a 12-char name tolerates 3. Pure. */
export function distanceBudget(length: number): number {
  return Math.min(3, Math.max(1, Math.floor(length * 0.3)));
}

/**
 * Resolve a user-typed reference to the single best matching key from a list,
 * or null when nothing matches well enough. Deterministic and order-stable: on a
 * tie the earliest candidate wins. The returned string is the ORIGINAL key (not
 * the normalized form), so the caller can map it straight back to a record.
 *
 * `maxDistance` overrides the per-key edit-distance budget when given.
 */
export function fuzzyResolve(
  ref: string,
  keys: readonly string[],
  opts: { maxDistance?: number } = {},
): string | null {
  const q = normalizeForMatch(ref);
  if (!q) return null;

  // Tier 1: exact normalized equality.
  for (const key of keys) {
    if (normalizeForMatch(key) === q) return key;
  }

  // Tier 2: containment as a whole token or a prefix, either direction. Catches
  // first names ("kritika" -> "kritika nguyen") and partials ("cyp51" ->
  // "cyp51a knockout"). Prefer the shortest matching key so the tightest fit wins.
  let bestContain: string | null = null;
  let bestContainLen = Infinity;
  for (const key of keys) {
    const k = normalizeForMatch(key);
    const tokens = k.split(" ");
    const hit = k.startsWith(q) || q.startsWith(k) || tokens.includes(q);
    if (hit && k.length < bestContainLen) {
      bestContain = key;
      bestContainLen = k.length;
    }
  }
  if (bestContain) return bestContain;

  // Tier 3: smallest edit distance within the budget. Compare against the whole
  // key AND its individual tokens, so a typo in one word of a multi-word name
  // still resolves ("kritka" -> the "kritika" token of "kritika nguyen").
  let bestKey: string | null = null;
  let bestDist = Infinity;
  for (const key of keys) {
    const k = normalizeForMatch(key);
    const candidates = [k, ...k.split(" ")];
    for (const c of candidates) {
      const budget = opts.maxDistance ?? distanceBudget(c.length);
      const d = editDistance(q, c);
      if (d <= budget && d < bestDist) {
        bestDist = d;
        bestKey = key;
      }
    }
  }
  return bestKey;
}
