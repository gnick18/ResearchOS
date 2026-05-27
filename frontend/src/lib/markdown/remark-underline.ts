/**
 * remark-underline — render `_text_` as underline (ResearchOS convention).
 *
 * Standard CommonMark treats both `*text*` and `_text_` as italic emphasis.
 * ResearchOS overrides the underscore form: single underscores mean underline,
 * matching the v4 onboarding tour's hybrid-bold / hybrid-italic /
 * hybrid-underline trio and the in-app shortcut helper (`*`=italic,
 * `_`=underline).
 *
 * Approach
 * --------
 * Word-boundary detection (so `snake_case_word` stays untouched) is delegated
 * to the upstream micromark parser. CommonMark's left/right-flanking delimiter
 * rules already prevent intra-word `_` runs from opening an emphasis, so by
 * the time we see an `emphasis` mdast node we know the underscores were valid
 * flanking delimiters at word boundaries. We just inspect the original source
 * at the node's start and end offsets to tell underscore-flanked emphasis
 * apart from asterisk-flanked emphasis, and rewrite the former into an
 * underline element via `data.hName`.
 *
 * `__text__` is parsed as a `strong` node (not an emphasis), so this plugin
 * never affects it.
 *
 * Note on imports
 * ---------------
 * `unified`, `mdast`, and `unist-util-visit` are transitive deps of
 * `react-markdown` / `remark-gfm` in this repo (not listed in package.json).
 * To avoid coupling the build to type declarations that aren't hoisted by
 * pnpm's strict isolation, we declare minimal local interfaces here rather
 * than importing from those packages.
 */

interface Position {
  offset?: number;
}
interface NodePosition {
  start?: Position;
  end?: Position;
}
interface MdastNode {
  type: string;
  position?: NodePosition;
  data?: { hName?: string; [key: string]: unknown };
  children?: MdastNode[];
}
interface VFileLike {
  value: unknown;
}

/**
 * Recursive walker. We don't pull in `unist-util-visit` so the plugin has
 * zero external imports and works regardless of pnpm hoisting.
 */
function walk(node: MdastNode, visitor: (n: MdastNode) => void): void {
  visitor(node);
  if (node.children) {
    for (const child of node.children) {
      walk(child, visitor);
    }
  }
}

/**
 * remark plugin: convert underscore-flanked emphasis nodes into <u>.
 * Returns the standard unified transformer signature.
 */
export default function remarkUnderline() {
  return (tree: MdastNode, file: VFileLike): void => {
    const source = String(file.value ?? "");
    if (!source) return;

    walk(tree, (node) => {
      if (node.type !== "emphasis") return;
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      if (typeof start !== "number" || typeof end !== "number") return;
      if (end <= start || end > source.length) return;

      // CommonMark guarantees the first and last chars of an emphasis node's
      // source slice are the delimiters that opened/closed it. We only
      // rewrite when BOTH ends are underscores; asterisk emphasis stays as
      // standard italic.
      const openChar = source[start];
      const closeChar = source[end - 1];
      if (openChar !== "_" || closeChar !== "_") return;

      // Rewrite to a <u> element. mdast-util-to-hast honors `data.hName`
      // when converting to hast, so the children render unchanged inside a
      // <u>...</u> wrapper instead of an <em>...</em>.
      node.data = { ...(node.data ?? {}), hName: "u" };
    });
  };
}
