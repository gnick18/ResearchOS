/**
 * Wiki search: pure ranking + snippet helpers.
 *
 * The index itself is built at prebuild time by
 * `scripts/build-wiki-search-index.mjs` and served from
 * `/wiki-search-index.json`. This module just consumes the index and
 * produces a ranked, grouped result list for the search UI.
 *
 *   Title match   →  highest score
 *   Heading match →  medium
 *   Body match    →  lowest
 *
 * Scoring is deliberately simple: substring case-insensitive matching with a
 * small word-boundary bonus and an early-position bonus. The whole point is
 * "users type 2-4 chars and see the right page" — a richer BM25 model would
 * be over-engineering for ~50 pages with curated copy.
 */

export interface WikiSearchEntry {
  href: string;
  title: string;
  breadcrumbs: string[];
  categoryId: string;
  headings: string[];
  bodySnippets: string[];
}

export interface WikiSearchCategory {
  id: string;
  label: string;
}

export interface WikiSearchIndex {
  generatedAt: string;
  pageCount: number;
  categories: WikiSearchCategory[];
  entries: WikiSearchEntry[];
}

export interface WikiSearchHit {
  entry: WikiSearchEntry;
  /** Final composite score (higher = better). */
  score: number;
  /** Reason for the match — drives the snippet rendered in the dropdown. */
  match: {
    kind: "title" | "heading" | "body";
    /** The exact heading / body string that matched. Null for title-only matches. */
    text: string | null;
    /** Index of the matched substring inside `text` (or 0 for title matches). */
    offset: number;
    /** Length of the matched substring (the query length at match time). */
    length: number;
  };
}

export interface WikiSearchGroup {
  category: WikiSearchCategory;
  hits: WikiSearchHit[];
}

const TITLE_SCORE = 1000;
const HEADING_SCORE = 100;
const BODY_SCORE = 10;
const WORD_BOUNDARY_BONUS = 50;
const EARLY_POSITION_BONUS = 10;
const PHRASE_BONUS_MULTIPLIER = 1.5;

/** Case-insensitive substring search. Returns index of first match, or -1.
 *  We use this rather than `.toLowerCase().indexOf()` so the original casing
 *  is preserved for snippet rendering. */
function ciIndexOf(haystack: string, needle: string): number {
  if (!needle) return -1;
  return haystack.toLowerCase().indexOf(needle.toLowerCase());
}

/** True if the match position sits at a word boundary (start of string, or
 *  preceded by whitespace / punctuation). Mid-word matches still count but
 *  rank lower. */
function isWordBoundary(haystack: string, offset: number): boolean {
  if (offset === 0) return true;
  const prev = haystack[offset - 1];
  return /[\s\-_/.,;:()[\]{}'"]/.test(prev);
}

function scoreOne(
  haystack: string,
  needle: string,
  baseScore: number,
): { score: number; offset: number } | null {
  const offset = ciIndexOf(haystack, needle);
  if (offset === -1) return null;
  let score = baseScore;
  if (isWordBoundary(haystack, offset)) score += WORD_BOUNDARY_BONUS;
  // Early-position bonus: an exact match at the start outranks a deep match.
  if (offset < 16) score += EARLY_POSITION_BONUS;
  return { score, offset };
}

/** Tokenize a query into search terms. Multi-word queries match any term
 *  but rank higher when ALL terms hit the same field (handled in matchEntry). */
function tokenize(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** Score a single entry against the query. Returns the best matching field
 *  (title > heading > body), with combined score for multi-word queries. */
function matchEntry(entry: WikiSearchEntry, query: string): WikiSearchHit | null {
  const tokens = tokenize(query);
  if (tokens.length === 0) return null;
  const full = query.trim();

  // Try title first.
  {
    const phrase = scoreOne(entry.title, full, TITLE_SCORE);
    if (phrase) {
      const allTokensHit = tokens.every((t) => ciIndexOf(entry.title, t) !== -1);
      const score = allTokensHit ? phrase.score * PHRASE_BONUS_MULTIPLIER : phrase.score;
      return {
        entry,
        score,
        match: { kind: "title", text: null, offset: phrase.offset, length: full.length },
      };
    }
    // Token-level title fallback: every token appears in the title.
    if (tokens.every((t) => ciIndexOf(entry.title, t) !== -1)) {
      // Use the first token's length so the highlight isn't zero-width.
      return {
        entry,
        score: TITLE_SCORE * 0.9,
        match: { kind: "title", text: null, offset: 0, length: tokens[0].length },
      };
    }
  }

  // Then headings.
  let bestHeading: WikiSearchHit | null = null;
  for (const heading of entry.headings) {
    const phrase = scoreOne(heading, full, HEADING_SCORE);
    if (phrase) {
      const allTokensHit = tokens.every((t) => ciIndexOf(heading, t) !== -1);
      const score = allTokensHit ? phrase.score * PHRASE_BONUS_MULTIPLIER : phrase.score;
      if (!bestHeading || score > bestHeading.score) {
        bestHeading = {
          entry,
          score,
          match: { kind: "heading", text: heading, offset: phrase.offset, length: full.length },
        };
      }
    } else if (tokens.every((t) => ciIndexOf(heading, t) !== -1)) {
      // Token-level heading fallback: anchor the highlight on the first
      // matching token's location so the snippet windows around something
      // useful.
      const firstHit = tokens
        .map((t) => ({ t, off: ciIndexOf(heading, t) }))
        .find((x) => x.off !== -1);
      const score = HEADING_SCORE * 0.9;
      if (!bestHeading || score > bestHeading.score) {
        bestHeading = {
          entry,
          score,
          match: {
            kind: "heading",
            text: heading,
            offset: firstHit?.off ?? 0,
            length: firstHit?.t.length ?? tokens[0].length,
          },
        };
      }
    }
  }
  if (bestHeading) return bestHeading;

  // Then body snippets.
  let bestBody: WikiSearchHit | null = null;
  for (const body of entry.bodySnippets) {
    const phrase = scoreOne(body, full, BODY_SCORE);
    if (phrase) {
      const allTokensHit = tokens.every((t) => ciIndexOf(body, t) !== -1);
      const score = allTokensHit ? phrase.score * PHRASE_BONUS_MULTIPLIER : phrase.score;
      if (!bestBody || score > bestBody.score) {
        bestBody = {
          entry,
          score,
          match: { kind: "body", text: body, offset: phrase.offset, length: full.length },
        };
      }
    } else if (tokens.every((t) => ciIndexOf(body, t) !== -1)) {
      const firstHit = tokens
        .map((t) => ({ t, off: ciIndexOf(body, t) }))
        .find((x) => x.off !== -1);
      const score = BODY_SCORE * 0.9;
      if (!bestBody || score > bestBody.score) {
        bestBody = {
          entry,
          score,
          match: {
            kind: "body",
            text: body,
            offset: firstHit?.off ?? 0,
            length: firstHit?.t.length ?? tokens[0].length,
          },
        };
      }
    }
  }
  return bestBody;
}

/** Run a search over the loaded index, returning grouped, ranked hits. */
export function searchWikiIndex(
  index: WikiSearchIndex,
  query: string,
  maxResults = 25,
): WikiSearchGroup[] {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const hits: WikiSearchHit[] = [];
  for (const entry of index.entries) {
    const hit = matchEntry(entry, trimmed);
    if (hit) hits.push(hit);
  }
  hits.sort((a, b) => b.score - a.score);
  const capped = hits.slice(0, maxResults);

  // Group by category, preserving category order from the index.
  const byCategory = new Map<string, WikiSearchHit[]>();
  for (const cat of index.categories) byCategory.set(cat.id, []);
  for (const hit of capped) {
    const bucket = byCategory.get(hit.entry.categoryId);
    if (bucket) bucket.push(hit);
    else byCategory.set(hit.entry.categoryId, [hit]);
  }

  const groups: WikiSearchGroup[] = [];
  for (const cat of index.categories) {
    const bucketHits = byCategory.get(cat.id) ?? [];
    if (bucketHits.length === 0) continue;
    groups.push({ category: cat, hits: bucketHits });
  }
  // Handle any orphan category ids the index didn't pre-register.
  for (const [id, bucketHits] of byCategory) {
    if (bucketHits.length === 0) continue;
    if (groups.find((g) => g.category.id === id)) continue;
    groups.push({ category: { id, label: id }, hits: bucketHits });
  }
  return groups;
}

/** Build a short snippet around the match for display. Returns the snippet
 *  plus the offset of the match within the snippet (for highlight rendering).
 *  For title matches, the title itself is the "snippet". */
export function buildSnippet(
  hit: WikiSearchHit,
  contextChars = 60,
): { text: string; offset: number; matchLength: number } {
  const sourceText =
    hit.match.kind === "title" ? hit.entry.title : hit.match.text ?? "";
  const offset = hit.match.offset;
  const matchLength = Math.max(
    1,
    Math.min(hit.match.length, sourceText.length - offset),
  );
  if (hit.match.kind === "title") {
    // Title snippets show the entire title.
    return { text: sourceText, offset, matchLength };
  }
  // For headings + body, surround the match with `contextChars` on each side.
  const start = Math.max(0, offset - contextChars);
  const end = Math.min(sourceText.length, offset + matchLength + contextChars);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < sourceText.length ? "..." : "";
  const text = prefix + sourceText.slice(start, end) + suffix;
  // New offset accounts for the leading "..." (3 chars) and the truncation.
  const adjustedOffset = (start > 0 ? 3 : 0) + (offset - start);
  return { text, offset: adjustedOffset, matchLength };
}
