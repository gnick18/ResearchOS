/**
 * Method Picker FLAG B (excerpt-field sub-bot of HR, approved by Grant):
 * derive a short plain-text preview from a method's markdown body so the
 * picker card hero renders without a per-card file read.
 *
 * The excerpt is stamped on `Method.excerpt` at every body-write site
 * (markdown create + markdown source-body edit), then read back by
 * `MethodCard`. Records written before this field existed render the lazy
 * file-read fallback until their next save (lazy backfill, no migration).
 *
 * Derivation contract:
 *   1. Strip the auto-stamp scaffold (date / time / experiment / project
 *      block + last-access markers + reopened stamps) via `extractUserContent`,
 *      so the preview starts at the user's real prose, not the stamp.
 *   2. Strip the leading H1 the scaffold injects ("# <method name>") plus any
 *      remaining markdown syntax (headings, list bullets, emphasis, links,
 *      inline code, blockquotes, images).
 *   3. Collapse all whitespace to single spaces.
 *   4. Truncate to <= MAX_EXCERPT_LEN chars on a word boundary, adding an
 *      ellipsis when the body was longer.
 *
 * Kept deliberately small + dependency-light (it reuses the existing
 * `extractUserContent` stamp stripper) so create + edit stamp identically.
 */

import { extractUserContent } from "@/lib/stamp-utils";
import {
  getMethodTypeMeta,
  type MethodTypeId,
} from "@/lib/methods/method-type-registry";

/** Hard cap on the stamped excerpt length (chars), per the FLAG B brief. */
export const MAX_EXCERPT_LEN = 140;

/**
 * Stamped excerpt for a structured method type: the type-registry one-line
 * summary, word-boundary truncated to the same hard cap as markdown excerpts.
 * Used by the structured create branches (pcr / lc_gradient / plate /
 * cell_culture / mass_spec / coding_workflow / qpcr_analysis) so a structured
 * card hero reads the persisted field instead of re-deriving the description.
 * PDF / compound deliberately do not stamp (their card shows the glyph / type
 * description fallback), so they are not passed here.
 */
export function excerptForStructuredType(type: MethodTypeId): string {
  const meta = getMethodTypeMeta(type);
  const desc = meta.description ?? "";
  return truncateOnWordBoundary(desc.replace(/\s+/g, " ").trim(), MAX_EXCERPT_LEN);
}

/**
 * Strip a single line of common inline + leading markdown syntax down to its
 * plain-text content. Conservative on purpose: it targets the constructs that
 * actually show up in lab-recipe method bodies (headings, bullets, numbered
 * lists, blockquotes, bold/italic, inline code, links, images) and leaves
 * anything exotic as-is rather than risk mangling the preview.
 */
function stripMarkdownInline(line: string): string {
  let out = line;
  // Images: ![alt](url) -> alt
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Links: [text](url) -> text
  out = out.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Leading heading hashes, blockquote markers, list bullets, numbered list.
  out = out.replace(/^\s{0,3}#{1,6}\s+/, "");
  out = out.replace(/^\s{0,3}>\s?/, "");
  out = out.replace(/^\s{0,3}[-*+]\s+/, "");
  out = out.replace(/^\s{0,3}\d+[.)]\s+/, "");
  // Inline code fences/spans: `code` -> code
  out = out.replace(/`+([^`]*)`+/g, "$1");
  // Bold / italic / strikethrough emphasis markers (leave the inner text).
  out = out.replace(/(\*\*|__|\*|_|~~)(.*?)\1/g, "$2");
  // Any stray leftover emphasis / fence characters.
  out = out.replace(/[*_`~]/g, "");
  return out;
}

/**
 * Truncate `text` to at most `max` characters on a word boundary, appending an
 * ellipsis when the input was longer. Falls back to a hard slice when there is
 * no space to break on (a single very long token).
 */
function truncateOnWordBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  // Only honor the word boundary when it leaves a reasonable chunk of text;
  // otherwise hard-cut so a leading mega-token still gets truncated.
  const cut = lastSpace > max * 0.5 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

/**
 * Derive the stamped excerpt from a method's markdown body. Returns "" for an
 * empty / scaffold-only body so callers can omit the field (the card then
 * falls back to the type-registry description).
 */
export function deriveExcerptFromMarkdown(body: string | null | undefined): string {
  if (!body) return "";
  // 1. Drop the stamp scaffold (date/time/experiment/project + last-access +
  //    reopened markers), leaving just the user-authored body.
  let userBody = extractUserContent(body);
  if (!userBody) return "";

  // 1b. Drop the leading H1 the create scaffold injects ("# <method name>").
  //     The card already shows the method name as its title, so a
  //     scaffold-only method (no real prose) yields an empty excerpt and the
  //     card falls back to the type-registry description rather than echoing
  //     its own name. Only the FIRST line, and only when it is an H1, is
  //     dropped, so a body whose real first line happens to be a sub-heading
  //     still contributes.
  const firstBreak = userBody.indexOf("\n");
  const firstLine = (firstBreak === -1 ? userBody : userBody.slice(0, firstBreak)).trim();
  if (/^#\s+\S/.test(firstLine)) {
    userBody = firstBreak === -1 ? "" : userBody.slice(firstBreak + 1);
  }

  // 2/3. Strip markdown syntax line by line, drop blank lines + horizontal
  //      rules, then collapse to single-spaced plain text.
  const plain = userBody
    .split(/\r?\n/)
    .map((line) => stripMarkdownInline(line).trim())
    .filter((line) => line.length > 0 && !/^[-=*_]{3,}$/.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "";

  // 4. Word-boundary truncate to the hard cap.
  return truncateOnWordBoundary(plain, MAX_EXCERPT_LEN);
}
