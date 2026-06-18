/**
 * block-insert-syntax — classify a click-to-insert Style Guide snippet as
 * block-level so the inline editor can give it its own line.
 *
 * Why this exists
 * ---------------
 * The Style Guide rail (MarkdownShortcutsSidebar) inserts snippets like
 * `## Heading 2`, `> quote text`, `- list item`, or `---` at the caret. A
 * block-level element only parses as that block when it BEGINS its own line,
 * so a snippet spliced into the middle of an existing line glues onto it:
 *
 *   a checkbox task## Heading 2
 *
 * CommonMark (and the Lezer parser the Edit decorator rides on) then read that
 * as ordinary paragraph text, so the rendered Preview shows the literal `## `
 * and joins the heading onto the following paragraph. Block embeds already get
 * their own line on insert; this helper extends the same rule to the other
 * block-level Style Guide snippets.
 *
 * Inline snippets (bold, italic, underline, strikethrough, link, image, inline
 * code) are intentionally NOT block-level: gluing them to the surrounding word
 * is correct. Code fences and block embeds have their own dedicated insert
 * paths, so they are out of scope here too.
 */

/**
 * True when `syntax` begins a block-level markdown element (heading,
 * blockquote, bullet / ordered / task list item, thematic break, or table
 * row). Only the first line is inspected, so multi-line snippets are judged by
 * their opening marker.
 */
export function isBlockLevelInsertSyntax(syntax: string): boolean {
  const firstLine = syntax.split("\n", 1)[0] ?? "";
  return (
    /^#{1,6}\s/.test(firstLine) || // ATX heading
    /^>\s?/.test(firstLine) || // blockquote
    /^[-*+]\s\[[ xX]\]\s/.test(firstLine) || // task list item
    /^[-*+]\s/.test(firstLine) || // bullet list item
    /^\d+\.\s/.test(firstLine) || // ordered list item
    /^-{3,}\s*$/.test(firstLine) || // thematic break
    /^\|.*\|/.test(firstLine) // table row
  );
}
