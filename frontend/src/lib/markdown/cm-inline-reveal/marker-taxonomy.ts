/**
 * Marker-node taxonomy for the CM6 inline-reveal layer (Typora editor chip 2a).
 *
 * The @lezer/markdown grammar emits the syntactic *delimiters* of an inline
 * token as their own child nodes inside a container node. For example the
 * source `**bold**` parses to:
 *
 *   StrongEmphasis
 *     EmphasisMark   "**"   (leading)
 *     <content>      "bold"
 *     EmphasisMark   "**"   (trailing)
 *
 * The inline-reveal feel is: when the caret is NOT inside a container, collapse
 * its marker children to zero width (Decoration.replace) and style the content
 * (Decoration.mark) so it reads as rendered text; when the caret touches the
 * container, emit no replace so the raw `**` delimiters show as source.
 *
 * This module is pure data plus tiny pure helpers: the set of container node
 * names we reveal, the set of marker child node names we collapse, the
 * container -> content CSS class mapping, and the underscore-vs-asterisk
 * Emphasis disambiguator (ResearchOS renders single-underscore emphasis as
 * underline, not italic, matching remark-underline.ts). NO CM6 view imports
 * live here so the taxonomy is trivially unit-testable.
 *
 * SCOPE (chip 2a core): inline tokens only. Block widgets for Table / FencedCode
 * and the keymap are the follow-up chip; here Table / FencedCode simply render
 * as plain source text (no widget), which is acceptable.
 *
 * House style: no em-dashes, no emojis.
 */

/**
 * The @lezer/markdown marker child node names whose ranges we collapse to zero
 * width when the containing token is not revealed. These are disjoint within a
 * container (a `**` open mark never overlaps the `**` close mark), so collapsing
 * them never conflicts with the content Decoration.mark.
 */
export const MARKER_NODE_NAMES = [
  "EmphasisMark", // ** / __ / * / _ for StrongEmphasis + Emphasis
  "HeaderMark", // the leading # run (and any trailing #) of an ATX heading
  "LinkMark", // [ ] ( ) brackets of a Link / Image
  "CodeMark", // backtick run of InlineCode (also FencedCode fences)
  "QuoteMark", // the > of a Blockquote line
  "StrikethroughMark", // ~~ of a GFM Strikethrough
] as const;

export type MarkerNodeName = (typeof MARKER_NODE_NAMES)[number];

/**
 * Fast membership test for marker child nodes during the tree walk.
 */
const MARKER_NODE_SET: ReadonlySet<string> = new Set(MARKER_NODE_NAMES);

export function isMarkerNode(name: string): boolean {
  return MARKER_NODE_SET.has(name);
}

/**
 * The container node names whose presence under the selection toggles reveal.
 * Each container owns its own marker children; when the caret touches the
 * container the markers show as source, otherwise they collapse.
 *
 * Table / FencedCode are intentionally absent: per the chip 2a scope they have
 * no inline-reveal behavior and render as plain source (their block widgets are
 * the follow-up chip).
 */
export const CONTAINER_NODE_NAMES = [
  "StrongEmphasis",
  "Emphasis",
  "Strikethrough",
  "InlineCode",
  "Link",
  "Image",
  "Blockquote",
  "ATXHeading1",
  "ATXHeading2",
  "ATXHeading3",
  "ATXHeading4",
  "ATXHeading5",
  "ATXHeading6",
] as const;

export type ContainerNodeName = (typeof CONTAINER_NODE_NAMES)[number];

const CONTAINER_NODE_SET: ReadonlySet<string> = new Set(CONTAINER_NODE_NAMES);

export function isContainerNode(name: string): boolean {
  return CONTAINER_NODE_SET.has(name);
}

/**
 * The CSS class applied (via Decoration.mark) to a container's CONTENT so it
 * keeps its rendered look whether or not the markers are revealed. Heading
 * content gets cm-h1..h6; the inline tokens get their own classes. Emphasis is
 * resolved at decoration time (see emphasisContentClass) because the underscore
 * form means underline, not italic.
 */
const CONTAINER_CONTENT_CLASS: Readonly<Record<ContainerNodeName, string>> = {
  StrongEmphasis: "cm-strong",
  Emphasis: "cm-em", // overridden to cm-underline for the underscore form
  Strikethrough: "cm-strike",
  InlineCode: "cm-inline-code",
  Link: "cm-link",
  Image: "cm-link",
  Blockquote: "cm-quote",
  ATXHeading1: "cm-h1",
  ATXHeading2: "cm-h2",
  ATXHeading3: "cm-h3",
  ATXHeading4: "cm-h4",
  ATXHeading5: "cm-h5",
  ATXHeading6: "cm-h6",
};

/**
 * The content CSS class for a container, or null if the container is unknown.
 * For Emphasis this returns the asterisk default (cm-em); the underscore-form
 * override is applied by the caller via emphasisContentClass once it has the
 * delimiter char from the document.
 */
export function contentClassFor(name: string): string | null {
  if (!isContainerNode(name)) return null;
  return CONTAINER_CONTENT_CLASS[name as ContainerNodeName];
}

/**
 * Underscore-vs-asterisk Emphasis disambiguator.
 *
 * ResearchOS overrides single-underscore emphasis to mean UNDERLINE (matching
 * remark-underline.ts and the v4 tour italic=`*` / underline=`_` shortcut
 * pair), while single-asterisk emphasis stays italic. The grammar emits both as
 * an `Emphasis` node, so we tell them apart by reading the FIRST delimiter char
 * straight from the document: `_` -> underline, anything else -> italic.
 *
 * This is decoration-only: NO grammar change, NO document mutation, so the
 * byte-for-byte round-trip is preserved.
 *
 * @param firstDelimiterChar the single character at the Emphasis node start
 *   offset, i.e. sliceDoc(node.from, node.from + 1).
 */
export function emphasisContentClass(firstDelimiterChar: string): string {
  return firstDelimiterChar === "_" ? "cm-underline" : "cm-em";
}
