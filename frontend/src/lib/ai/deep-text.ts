// Shared deterministic deep-text engine for BeakerBot (ai summary-robustness bot,
// 2026-06-14).
//
// The "grep, do not feed the LLM the corpus" primitive. These pure functions scan
// a record's full body text for a string or regex and return only the match
// position, an accurate total count, and a short snippet, so the search tools hand
// the model the HITS, never the millions of lines they were found in. No I/O, fully
// unit-tested, reused by search_full_text across every text-bearing object type.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

/** A compiled matcher: a case-insensitive substring (default) or a regex. Building
 *  it once per query, instead of per record, keeps a big scan cheap. Returns null
 *  when an isRegex query fails to compile, so the caller can report it cleanly. */
export function compileMatcher(
  query: string,
  isRegex: boolean,
): { regex: RegExp } | { needle: string } | null {
  if (!query) return null;
  if (isRegex) {
    try {
      // Global + case-insensitive so countMatches can walk every hit.
      return { regex: new RegExp(query, "gi") };
    } catch {
      return null;
    }
  }
  return { needle: query.toLowerCase() };
}

/** Find the first match of a query in a body. Returns the match index + length, or
 *  null. A regex query that fails to compile falls back to a literal substring
 *  (belt-and-suspenders; callers validate up front). Pure. */
export function findFirst(
  body: string,
  query: string,
  isRegex: boolean,
): { index: number; length: number } | null {
  if (!query) return null;
  if (isRegex) {
    try {
      const m = new RegExp(query, "i").exec(body);
      if (m) return { index: m.index, length: m[0].length || 1 };
      return null;
    } catch {
      // Fall through to a literal search on a bad pattern.
    }
  }
  const idx = body.toLowerCase().indexOf(query.toLowerCase());
  return idx >= 0 ? { index: idx, length: query.length } : null;
}

const MAX_COUNT_ITERATIONS = 100_000;

/** Count non-overlapping matches of a query in a body. Used for an ACCURATE total
 *  ("how many notes mention X") that does not depend on the capped results list. A
 *  zero-length regex match is stepped past so the loop can never spin; the
 *  iteration cap is a final pathological-input backstop. Pure. */
export function countMatches(body: string, query: string, isRegex: boolean): number {
  const matcher = compileMatcher(query, isRegex);
  if (!matcher || !body) return 0;
  let count = 0;
  if ("regex" in matcher) {
    const re = matcher.regex;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let iterations = 0;
    while ((m = re.exec(body)) !== null) {
      count += 1;
      if (m.index === re.lastIndex) re.lastIndex += 1; // step past a zero-width match
      if (++iterations > MAX_COUNT_ITERATIONS) break;
    }
    return count;
  }
  const hay = body.toLowerCase();
  const needle = matcher.needle;
  let from = 0;
  let idx = hay.indexOf(needle, from);
  while (idx !== -1) {
    count += 1;
    from = idx + needle.length;
    idx = hay.indexOf(needle, from);
  }
  return count;
}

/** Build a compact snippet (~120 chars) centered on the match index, whitespace
 *  collapsed, with ellipses when the body extends past the window. Pure. */
export function snippetAround(text: string, matchIndex: number, matchLen: number): string {
  const pad = 60;
  const start = Math.max(0, matchIndex - pad);
  const end = Math.min(text.length, matchIndex + matchLen + pad);
  const core = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "..." : ""}${core}${end < text.length ? "..." : ""}`;
}
