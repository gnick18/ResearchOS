/**
 * render-html.ts: shared markdown-to-HTML render for the CM6 block widgets
 * (Typora editor chip 2b).
 *
 * The inline-reveal layer collapses Table and FencedCode blocks (when the caret
 * is not inside them) into a single block widget whose DOM is rendered markdown.
 * CM6 widgets are imperative DOM (no React), so we render to an HTML STRING via
 * the unified pipeline and set it with innerHTML. The pipeline mirrors the
 * LiveMarkdownEditor preview stack exactly:
 *
 *   remark-parse -> remark-gfm -> remark-rehype (allowDangerousHtml) ->
 *   rehype-raw -> rehype-highlight (fenced code only) ->
 *   [rehype-sanitize, markdownSanitizeSchema] -> rehype-stringify
 *
 * The sanitize step reuses markdownSanitizeSchema (allowComments:true) from
 * @/lib/markdown/sanitize-schema. We do NOT construct a fresh schema and do NOT
 * drop allowComments, so the widget DOM cannot carry script / on* handlers and
 * the rendered output matches the preview surface a user already trusts.
 *
 * This module renders a STRING from a STRING. It never touches the CM6 document,
 * so the byte-for-byte round-trip contract is untouched: the widget is a view
 * artifact whose source is the unchanged document slice.
 *
 * House style: no em-dashes, no emojis.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";

import { markdownSanitizeSchema } from "@/lib/markdown/sanitize-schema";

/**
 * Render a markdown source fragment to a sanitized HTML string. Used for the
 * Table block widget (GFM table -> <table>) and as the base for the fenced-code
 * widget. `highlight` toggles rehype-highlight so fenced code gets token spans;
 * tables do not need it (and skipping it is marginally cheaper).
 */
function renderMarkdownToHtml(source: string, highlight: boolean): string {
  let processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw);
  if (highlight) {
    // rehype-highlight v7 no longer throws on an unknown / absent info string:
    // an unregistered language just renders as plain <pre><code>, so no options
    // are needed (the old ignoreMissing flag was removed upstream).
    processor = processor.use(rehypeHighlight);
  }
  const file = processor
    .use(rehypeSanitize, markdownSanitizeSchema)
    .use(rehypeStringify)
    .processSync(source);
  // Trim leading / trailing whitespace. The remark-gfm -> remark-rehype ->
  // rehype-raw round-trip emits a run of newline text nodes BEFORE the rendered
  // block (a GFM table picks up roughly one newline per row). Those newlines are
  // harmless in normal HTML flow, but a CM6 block widget renders this string with
  // innerHTML inside a wrapper that inherits `white-space: break-spaces` from
  // `.cm-content`, so each stray newline became a visible blank LINE. The result
  // was a one-row table rendered as a ~700px-tall mostly-empty widget that pushed
  // the actual <table> below the fold, reading to the user as "the table stopped
  // rendering" the moment the caret left it. Trimming the outer whitespace fixes
  // that without touching newlines INSIDE the block (e.g. a fenced code body),
  // which sit within <pre><code> and are unaffected by an outer trim.
  return String(file).trim();
}

/** Render a GFM table source block to a sanitized <table> HTML string. */
export function renderTableHtml(source: string): string {
  return renderMarkdownToHtml(source, false);
}

/**
 * Render a fenced code block to a sanitized, syntax-highlighted HTML string.
 * The source must be the full fence (``` ... ```), so remark parses it as a
 * code block and rehype-highlight tokenizes the body by the info string.
 */
export function renderFencedCodeHtml(source: string): string {
  return renderMarkdownToHtml(source, true);
}

/**
 * Render a markdown image fragment ( ![alt](src) or a literal <img> ) to a
 * sanitized HTML string. Routing through markdownSanitizeSchema validates the
 * alt / width / src scheme before the caller adopts the <img>; LOCAL paths are
 * then re-pointed at a blob URL imperatively by the image widget (blob: is not
 * an allowed src scheme, exactly as the LiveMarkdownEditor <img> renderer does).
 */
export function renderImageHtml(source: string): string {
  return renderMarkdownToHtml(source, false);
}
