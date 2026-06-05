/**
 * Peritext-style inline mark helpers for the Loro CRDT.
 *
 * WHY marks instead of markdown control characters in the Text:
 * Storing `**bold**` as literal asterisks inside a Loro LoroText is safe for
 * single-user editing but breaks under concurrent edits: if two users insert
 * text near the `**` delimiters in parallel, the CRDT merges the text
 * character-by-character, and the asterisk positions become unpredictable.
 * The Peritext model (Litt et al. 2021) solves this by attaching formatting
 * to CHARACTER IDENTITIES (the CRDT's internal op ids), not to position
 * offsets.  Loro implements Peritext natively via text.mark().  So we strip
 * the control characters out of the stored string and store bold/italic/link
 * as Loro marks anchored to the surrounding plain-text characters.
 *
 * WHY round-trip-or-leave-literal:
 * For any construct we cannot cleanly round-trip (e.g. nested bold+link,
 * underscore-style italic), we leave the original markdown UNCHANGED in the
 * Text layer rather than attempt a lossy transformation.  A slightly-fatter
 * text store is far better than silently corrupting user content.
 *
 * Supported inline marks (Phase 1 scope):
 *   bold  --  **text**
 *   italic -- *text*  (single asterisk; NOT _text_ underscore form)
 *   link  --  [label](url)
 *
 * Explicitly NOT lifted into marks (stays as plain text):
 *   Headings (#), lists (-, 1.), code fences (```), blockquotes (>),
 *   underscore italic (_text_), bold+italic (***), nested marks (bold link),
 *   autolinks (<url>).
 *
 * API surface used from Loro 1.12.3:
 *   text.mark({ start, end }, key, value)
 *     key "bold"   -> value true
 *     key "italic" -> value true
 *     key "link"   -> value <url string>
 *   text.toDelta() -> Delta<string>[]
 *     Each Delta item is { insert: string, attributes?: { [key]: Value } }
 *     Bold segment:   { insert: "word", attributes: { bold: true } }
 *     Italic segment: { insert: "word", attributes: { italic: true } }
 *     Link segment:   { insert: "label", attributes: { link: "url" } }
 *   doc.configTextStyle({ bold: {expand:"after"}, italic: {expand:"after"}, link: {expand:"none"} })
 *     Must be called once per doc before any mark() call.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type MarkType = "bold" | "italic" | "link";

export interface InlineMark {
  start: number;
  end: number;
  type: MarkType;
  /** Present only when type === "link". */
  url?: string;
}

// ---------------------------------------------------------------------------
// splitMarkdownInline
// ---------------------------------------------------------------------------

/**
 * Parse a markdown string, strip inline control characters for the three
 * supported marks, and return the plain text plus sorted mark descriptors.
 *
 * Block-level markdown (headings, lists, code fences, blockquotes) is left
 * UNTOUCHED in the returned text; only the three inline marks are extracted.
 *
 * Deterministic: for any fixed input the output is always identical.
 * Marks are sorted by (start asc, then type asc) to guarantee the same
 * mark() call order in seed.ts, which keeps the op log byte-identical.
 *
 * Round-trip-or-leave-literal rule: if a construct cannot be cleanly
 * round-tripped (e.g. nested marks, ambiguous asterisk), it is left as
 * literal markdown text in `text` and no mark is emitted for it.
 */
export function splitMarkdownInline(
  md: string,
): { text: string; marks: InlineMark[] } {
  // We scan the markdown line by line. Block-level constructs are never
  // transformed; only inline spans within a paragraph line are scanned.
  //
  // Implementation strategy: single-pass scanner that recognises the three
  // constructs via deterministic lookahead. We do NOT use a full markdown AST
  // (simpler + more deterministic). We process each character in order;
  // whenever we recognise a complete inline span that can be cleanly
  // round-tripped, we emit it; otherwise we leave the characters verbatim.

  const outputChars: string[] = [];
  const marks: InlineMark[] = [];

  let i = 0;
  const len = md.length;

  while (i < len) {
    // -------------------------------------------------------------------------
    // Attempt: link  [label](url)
    // -------------------------------------------------------------------------
    // We try link first because the '[' character is not used by bold/italic,
    // so there is no ambiguity.
    if (md[i] === "[") {
      const linkResult = tryLink(md, i, outputChars.length);
      if (linkResult !== null) {
        // Insert the plain label text into output.
        for (const ch of linkResult.label) outputChars.push(ch);
        marks.push({
          start: linkResult.markStart,
          end: linkResult.markStart + linkResult.label.length,
          type: "link",
          url: linkResult.url,
        });
        i = linkResult.nextIndex;
        continue;
      }
      // Not a valid link -- fall through to literal.
    }

    // -------------------------------------------------------------------------
    // Attempt: bold  **text**
    // Must be tried before italic (** is two asterisks).
    // -------------------------------------------------------------------------
    if (md[i] === "*" && md[i + 1] === "*") {
      const boldResult = tryDelimited(md, i, "**", outputChars.length);
      if (boldResult !== null) {
        for (const ch of boldResult.inner) outputChars.push(ch);
        marks.push({
          start: boldResult.markStart,
          end: boldResult.markStart + boldResult.inner.length,
          type: "bold",
        });
        i = boldResult.nextIndex;
        continue;
      }
      // Not a cleanly delimited bold -- fall through to literal.
      // We output one '*' literally so we do not consume the second unnecessarily.
      outputChars.push(md[i]);
      i++;
      continue;
    }

    // -------------------------------------------------------------------------
    // Attempt: italic  *text*  (single asterisk)
    // Only triggered when we have a single '*' (the double case was handled above).
    // -------------------------------------------------------------------------
    if (md[i] === "*") {
      const italicResult = tryDelimited(md, i, "*", outputChars.length);
      if (italicResult !== null) {
        for (const ch of italicResult.inner) outputChars.push(ch);
        marks.push({
          start: italicResult.markStart,
          end: italicResult.markStart + italicResult.inner.length,
          type: "italic",
        });
        i = italicResult.nextIndex;
        continue;
      }
      // Literal asterisk.
    }

    // -------------------------------------------------------------------------
    // Literal character -- copy verbatim.
    // -------------------------------------------------------------------------
    outputChars.push(md[i]);
    i++;
  }

  // Sort marks: primary key start (asc), secondary key type (asc, string order).
  marks.sort((a, b) =>
    a.start !== b.start ? a.start - b.start : a.type < b.type ? -1 : a.type > b.type ? 1 : 0,
  );

  return { text: outputChars.join(""), marks };
}

// ---------------------------------------------------------------------------
// Internal scanner helpers
// ---------------------------------------------------------------------------

interface DelimitedResult {
  inner: string;
  markStart: number;
  nextIndex: number;
}

/**
 * Try to consume a symmetric delimiter-enclosed span starting at `pos`.
 *
 * delimiter is "**" or "*".
 * markStart is the current length of the output buffer (the position in the
 * plain output text where the inner content will begin).
 *
 * Returns null if:
 *   - The closing delimiter is not found before end-of-string or newline.
 *   - The inner content is empty.
 *   - The inner content itself contains the same delimiter (nested marks).
 *
 * The newline boundary rule keeps bold/italic spans line-local; a markdown
 * paragraph break always terminates the span search so we never lift a span
 * that straddles a paragraph boundary (which would corrupt block structure).
 */
function tryDelimited(
  md: string,
  pos: number,
  delimiter: string,
  markStart: number,
): DelimitedResult | null {
  const dlen = delimiter.length;
  const start = pos + dlen; // first char after the opening delimiter

  // Find the closing delimiter on the SAME line (no newline crossing).
  let j = start;
  while (j < md.length) {
    if (md[j] === "\n") return null; // crossed a newline -- leave literal
    if (md.slice(j, j + dlen) === delimiter) {
      // Verify this is a proper close: if delimiter is "*", make sure it is
      // not "**" (i.e., the char after is not also "*").
      if (dlen === 1 && md[j + 1] === "*") {
        // This would be "**" which belongs to bold, not italic close.
        j++;
        continue;
      }
      break;
    }
    j++;
  }

  if (j >= md.length) return null; // no closing delimiter found

  const inner = md.slice(start, j);

  if (inner.length === 0) return null; // empty span
  if (inner.includes(delimiter)) return null; // nested same-delimiter -- leave literal

  return {
    inner,
    markStart,
    nextIndex: j + dlen,
  };
}

interface LinkResult {
  label: string;
  url: string;
  markStart: number;
  nextIndex: number;
}

/**
 * Try to consume a [label](url) link starting at `pos` (which must be '[').
 *
 * Returns null if the syntax is not a complete inline link.
 *
 * Constraints for a "clean" link (round-trip-or-leave-literal rule):
 *   - Label contains no '[' or ']' characters (no nested brackets).
 *   - Label is non-empty.
 *   - URL is non-empty and contains no ')' characters (simple URLs only).
 *   - The label does not contain bold or italic delimiters (no nested marks).
 *   - Everything stays on a single line (no newline crossing).
 */
function tryLink(
  md: string,
  pos: number,
  markStart: number,
): LinkResult | null {
  // Find the closing ']'.
  let j = pos + 1;
  while (j < md.length && md[j] !== "]" && md[j] !== "\n") j++;

  if (j >= md.length || md[j] !== "]") return null;

  const label = md.slice(pos + 1, j);
  if (label.length === 0) return null;
  if (label.includes("[") || label.includes("*")) return null; // no nested marks

  // Expect '(' immediately after ']'.
  if (md[j + 1] !== "(") return null;

  // Find the closing ')'.
  let k = j + 2;
  while (k < md.length && md[k] !== ")" && md[k] !== "\n") k++;

  if (k >= md.length || md[k] !== ")") return null;

  const url = md.slice(j + 2, k);
  if (url.length === 0) return null;

  return {
    label,
    url,
    markStart,
    nextIndex: k + 1,
  };
}

// ---------------------------------------------------------------------------
// renderMarkdownInline
// ---------------------------------------------------------------------------

/**
 * Inverse of splitMarkdownInline: re-insert markdown control characters so
 * the output matches the original markdown for supported constructs.
 *
 * Marks must be sorted by start (as splitMarkdownInline guarantees), and must
 * not overlap. Overlapping or out-of-order marks are silently ignored (the
 * round-trip-or-leave-literal safety net; callers that construct marks
 * manually must validate them).
 *
 * The function handles ADJACENT and NESTED marks by processing them as a
 * flat sorted list; it does not attempt to reconstruct nested markdown syntax.
 * Phase 1 explicitly excludes nested marks.
 */
export function renderMarkdownInline(
  text: string,
  marks: InlineMark[],
): string {
  if (marks.length === 0) return text;

  // Filter out any marks with invalid ranges.
  const valid = marks.filter(
    (m) =>
      m.start >= 0 &&
      m.end > m.start &&
      m.end <= text.length,
  );

  if (valid.length === 0) return text;

  // Build output by walking through the plain text and inserting delimiters
  // around each mark span. Marks must not overlap; if they do we skip the
  // later one (the earlier mark "wins").
  const out: string[] = [];
  let cursor = 0;
  let highWater = -1; // furthest end position of any mark we have emitted

  for (const mark of valid) {
    if (mark.start < cursor) continue; // overlap with a previous mark -- skip
    if (mark.start <= highWater) continue; // overlaps with already-emitted span

    // Emit plain text up to the mark start.
    out.push(text.slice(cursor, mark.start));

    // Emit the delimited span.
    const inner = text.slice(mark.start, mark.end);
    if (mark.type === "bold") {
      out.push("**", inner, "**");
    } else if (mark.type === "italic") {
      out.push("*", inner, "*");
    } else if (mark.type === "link") {
      out.push("[", inner, "](", mark.url ?? "", ")");
    }

    cursor = mark.end;
    highWater = mark.end;
  }

  // Emit remaining plain text.
  out.push(text.slice(cursor));

  return out.join("");
}

// ---------------------------------------------------------------------------
// configureTextStyles
// ---------------------------------------------------------------------------

/**
 * Register the three mark types with a LoroDoc before any mark() call.
 *
 * Loro requires doc.configTextStyle() before mark() for any named style.
 * Expand semantics chosen per Peritext convention:
 *   bold   "after"  -- bold expands to include text typed immediately after the span
 *   italic "after"  -- same
 *   link   "none"   -- links do not auto-expand (a new character after a link is NOT linked)
 *
 * Call this once per LoroDoc that will ever use marks. It is idempotent.
 */
export function configureTextStyles(doc: {
  configTextStyle(styles: {
    [key: string]: { expand: "before" | "after" | "none" | "both" };
  }): void;
}): void {
  doc.configTextStyle({
    bold:   { expand: "after" },
    italic: { expand: "after" },
    link:   { expand: "none" },
  });
}
