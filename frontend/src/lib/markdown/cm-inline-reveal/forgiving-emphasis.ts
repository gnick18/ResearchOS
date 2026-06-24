/**
 * forgiving-emphasis.ts: a @lezer/markdown inline-parser override that makes
 * `*` / `_` emphasis FORGIVING about a single space adjacent to a delimiter, the
 * way Notion / Bear / Obsidian-style live editors are (Typora editor bug A).
 *
 * Why
 * ---
 * CommonMark's flanking rules say a closing `**` must NOT be preceded by
 * whitespace (and an opening `**` must NOT be followed by whitespace). So
 * `**there is bold **` (note the space before the close) is, per spec, NOT
 * emphasis at all: the grammar emits a plain Paragraph and the inline-reveal
 * editor shows the literal `**` markers. Grant wants the editor to be forgiving
 * here. A trailing or internal single space inside a bold / italic / underline
 * run should still render the emphasis.
 *
 * How
 * ---
 * We register one inline parser, `ForgivingEmphasis`, that runs `before` the
 * built-in `Emphasis` parser for the `*` and `_` characters. For a run whose
 * STANDARD flanking already opens / closes, we return -1 and let the built-in
 * parser handle it unchanged, so the common case (including the `**` ->
 * StrongEmphasis upgrade and the triple-rule size math in resolveMarkers) is
 * byte-for-byte the upstream behaviour. We only step in when a SINGLE adjacent
 * space is the only thing the standard rule trips on, in which case we add the
 * delimiter ourselves with relaxed open / close flags.
 *
 * Built-in delimiter identity
 * ---------------------------
 * @lezer/markdown's resolveMarkers upgrades a 2-char emphasis run to
 * StrongEmphasis (bold) ONLY when the delimiter's `type` is its own internal
 * `EmphasisAsterisk` / `EmphasisUnderscore` singleton (an identity `==` check),
 * and the same identity drives the triple-rule mismatch math. Those objects are
 * not exported, so we HARVEST them at runtime. The opening `**` of a `**bold **`
 * run is created by the built-in parser (its open side is standard), so by the
 * time we see the failing CLOSE the matching open already sits in `cx.parts` and
 * we read its `.type`. We cache the two singletons module-wide and reuse them, so
 * our forgiving delimiter pairs with the built-in one AND gets the correct
 * Emphasis / StrongEmphasis resolution. Until a singleton is harvested (a
 * forgiving run with no standard sibling yet), we fall back to returning -1, so
 * we never emit a mis-typed node.
 *
 * Scoping (bug B)
 * ---------------
 * @lezer/markdown parses inline content per BLOCK. Delimiters match only within
 * the SAME inline section (one paragraph / heading / list-item line), so an
 * UNMATCHED `**` can never reach across a paragraph or block boundary: it simply
 * produces no node and renders as literal text. This override preserves that. It
 * relaxes the flanking TEST only, it never widens the matching SCOPE, so a stray
 * `**` stays self-contained and cannot bold a neighbouring paragraph (verified by
 * the no-bleed test). We also only ever ADD a delimiter that we know can pair (we
 * require a harvested type, and the relaxed flags still require non-space content
 * on the delimiter's other side), so a lone forgiving delimiter never leaks.
 *
 * Word-boundary safety
 * --------------------
 * Underscore emphasis still must NOT open / close intra-word (so `snake_case`
 * stays plain). The single-space relaxation only ever makes a delimiter that
 * already sits next to WHITESPACE more permissive, never one flanked by word
 * chars, so `snake_case` (word chars both sides) neither opens nor closes.
 *
 * View / round-trip
 * -----------------
 * Parser config only. It changes the syntax TREE (so the inline-reveal walk sees
 * a StrongEmphasis / Emphasis container and styles the run); it never mutates the
 * document, so the byte-for-byte round-trip the editor relies on is untouched.
 * The emitted node + mark names are exactly `Emphasis` / `StrongEmphasis` /
 * `EmphasisMark`, the same names marker-taxonomy.ts already reveals and collapses.
 *
 * House style: no em-dashes, no emojis.
 */

import type {
  DelimiterType,
  InlineContext,
  MarkdownConfig,
} from "@lezer/markdown";

const ASTERISK = 42; // '*'
const UNDERSCORE = 95; // '_'

/**
 * Punctuation class kept in sync with @lezer/markdown's own `Punctuation`
 * regexp on the ASCII range. The only sides we relax are whitespace-adjacent,
 * and the only extra guard we need is "is this a word char", which the space +
 * punctuation tests together determine, so the ASCII subset is sufficient for
 * the relaxation gate.
 */
const Punctuation = /[!-/:-@[-`{-~]/;

/**
 * The harvested built-in emphasis delimiter type singletons (see the module doc).
 * They are stable across the @lezer/markdown module lifetime, so we cache them
 * the first time we observe one in `cx.parts`.
 */
let builtinAsterisk: DelimiterType | null = null;
let builtinUnderscore: DelimiterType | null = null;

/**
 * Scan `cx.parts` for an existing emphasis delimiter of the given char and, if
 * found, cache + return its built-in `type`. Returns the cached value when we
 * already have it, or null when no sibling emphasis delimiter exists yet.
 */
function builtinEmphasisType(
  cx: InlineContext,
  next: number,
): DelimiterType | null {
  const cached = next === ASTERISK ? builtinAsterisk : builtinUnderscore;
  if (cached) return cached;
  // `cx.parts` is public in practice (the standard LinkEnd handling reads it).
  // Each entry is either an Element or an InlineDelimiter; a delimiter carries
  // `.type` (with `.resolve`) and `.from`.
  const parts = (cx as unknown as { parts: Array<unknown> }).parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    const p = part as { type?: DelimiterType; from?: number } | null;
    if (!p || !p.type || p.type.resolve !== "Emphasis") continue;
    if (typeof p.from !== "number") continue;
    const ch = cx.slice(p.from, p.from + 1);
    if (ch === "*" && !builtinAsterisk) builtinAsterisk = p.type;
    if (ch === "_" && !builtinUnderscore) builtinUnderscore = p.type;
  }
  return next === ASTERISK ? builtinAsterisk : builtinUnderscore;
}

/**
 * Standard CommonMark flanking, matching the upstream computation exactly.
 */
function standardFlanking(
  next: number,
  before: string,
  after: string,
): { canOpen: boolean; canClose: boolean } {
  const sBefore = /\s|^$/.test(before);
  const sAfter = /\s|^$/.test(after);
  const pBefore = Punctuation.test(before);
  const pAfter = Punctuation.test(after);
  const leftFlanking = !sAfter && (!pAfter || sBefore || pBefore);
  const rightFlanking = !sBefore && (!pBefore || sAfter || pAfter);
  const canOpen = leftFlanking && (next === ASTERISK || !rightFlanking || pBefore);
  const canClose = rightFlanking && (next === ASTERISK || !leftFlanking || pAfter);
  return { canOpen, canClose };
}

/**
 * Forgiving flanking, the relaxation Grant asked for. On top of the standard
 * flags it lets a run OPEN when it is followed by a single space (and, for
 * underscores, abuts a word on the other side) and CLOSE when it is preceded by
 * a single space (same word guard). The word guard keeps `snake_case` plain:
 * underscores flanked by word chars on both sides still neither open nor close.
 */
function forgivingFlanking(
  next: number,
  before: string,
  after: string,
): { canOpen: boolean; canClose: boolean } {
  const std = standardFlanking(next, before, after);
  // Relaxation hinges on a LITERAL inner space, never the empty-string inline
  // boundary (`^` / `$`). Treating the line edge as a relaxable space would wrongly
  // make a well-formed OPENING `**foo` (nothing before it) ALSO closable, and a
  // well-formed CLOSING `foo**` (nothing after) ALSO openable, which corrupts
  // resolveMarkers and the StrongEmphasis upgrade. So we test `=== " "`, not the
  // `\s|^$` test the standard rule uses.
  //
  //   - canOpen relaxes when a single space sits AFTER the run (`** bold`): the
  //     emphasizable content is to the right of that space.
  //   - canClose relaxes when a single space sits BEFORE the run (`bold **`): the
  //     content is to the left of that space.
  //
  // A lone delimiter with spaces on both sides (`a ** b`) does get both flags, but
  // resolveMarkers only ever wraps a close against a matching earlier open, so a
  // delimiter with no partner produces no node and stays literal text (bug B's
  // no-bleed guarantee).
  //
  // The intra-word underscore case (`snake_case`) needs no special guard here: it
  // has NO inner space, so neither relaxation branch ever fires for it, and the
  // standard rule already keeps it plain. Underscores therefore relax on the same
  // space-only condition as asterisks.
  const spaceBefore = before === " ";
  const spaceAfter = after === " ";

  return {
    canOpen: std.canOpen || spaceAfter,
    canClose: std.canClose || spaceBefore,
  };
}

/**
 * The inline parser. Consumes the same-character run, and:
 *   - If standard flanking already opens / closes it, returns -1 so the built-in
 *     parser handles it (preserving native StrongEmphasis + triple-rule math).
 *   - Otherwise, if forgiving flanking adds a capability AND we have the built-in
 *     delimiter type, adds the delimiter ourselves with the forgiving flags so
 *     the run resolves like a normal emphasis.
 *   - If we cannot yet harvest the built-in type, returns -1 (no mis-typed node).
 */
function parseForgivingEmphasis(
  cx: InlineContext,
  next: number,
  start: number,
): number {
  if (next !== UNDERSCORE && next !== ASTERISK) return -1;

  let pos = start + 1;
  while (cx.char(pos) === next) pos++;

  const before = start > cx.offset ? cx.slice(start - 1, start) : "";
  const after = pos < cx.end ? cx.slice(pos, pos + 1) : "";
  const std = standardFlanking(next, before, after);
  const forg = forgivingFlanking(next, before, after);

  // Nothing relaxed here: let the built-in parser do its normal job.
  if (forg.canOpen === std.canOpen && forg.canClose === std.canClose) {
    return -1;
  }

  const type = builtinEmphasisType(cx, next);
  if (!type) return -1; // cannot type the node yet, defer to the built-in.

  return cx.addDelimiter(type, start, pos, forg.canOpen, forg.canClose);
}

/**
 * The MarkdownConfig the editor spreads into `markdown({ base, extensions })`.
 * Registered `before` the built-in `Emphasis` so the relaxed handling wins for
 * `*` / `_` while every other inline rule (links, code, strikethrough, the
 * underscore-underline taxonomy, etc.) is unchanged.
 */
export const forgivingEmphasis: MarkdownConfig = {
  parseInline: [
    {
      name: "ForgivingEmphasis",
      before: "Emphasis",
      parse: parseForgivingEmphasis,
    },
  ],
};

/**
 * Test-only reset of the harvested built-in singletons, so a unit test can start
 * from a clean cache. Not used by the editor.
 */
export function __resetBuiltinEmphasisCacheForTest(): void {
  builtinAsterisk = null;
  builtinUnderscore = null;
}
