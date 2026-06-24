/**
 * inline-reveal.ts: the core CM6 inline-reveal layer (Typora editor chip 2a).
 *
 * This module produces the Typora "markers hide until the caret touches the
 * token" feel for the opt-in inline editor, entirely as VIEW DECORATIONS over
 * the existing CodeMirror document. It NEVER dispatches a doc-changing
 * transaction, so view.state.doc.toString() always equals the user keystrokes
 * byte-for-byte (the round-trip gate). Single-underscore underline is handled
 * decoration-only by reading the delimiter char from the doc: NO grammar change,
 * NO document mutation.
 *
 * What is here (chip 2a core):
 *   - buildDeco(view): viewport-scoped tree walk producing a combined
 *     DecorationSet (replace + mark) plus a replace-only set for atomicRanges.
 *   - inlineReveal: the ViewPlugin (4-trigger update + dual decorations /
 *     atomicRanges provide).
 *   - inlineRevealExtension: plugin + theme, the single extension the editor
 *     spreads in.
 *
 * What is NOT here (the follow-up chip): block widgets for Table / FencedCode,
 * the image inline widget, and the markdown keymap. Tables and fenced code
 * render as plain source text in this chip, which is acceptable.
 *
 * House style: no em-dashes, no emojis. Any future HTML-rendering widget must
 * reuse markdownSanitizeSchema (allowComments:true); this chip renders no HTML.
 */

import { Facet, RangeSetBuilder, StateField } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
} from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

import {
  contentClassFor,
  emphasisContentClass,
  isContainerNode,
  isCloseUnderlineTag,
  isMarkerNode,
  isOpenUnderlineTag,
} from "./marker-taxonomy";
import { selectionTouchesNode } from "./selection-touches";
import { inlineRevealTheme } from "./theme";
import { TableWidget, FencedCodeWidget, HrWidget } from "./block-widgets";
import { ImageWidget } from "./image-widget";
import { EmbedWidget, parseLoneEmbedLink } from "./embed-widget";
import type { EmbedPinContext } from "@/components/embeds/ObjectEmbed";
import { ObjectChipWidget, parseObjectLink } from "./object-chip-widget";
import { markdownKeymap } from "./markdown-keymap";
import { stampHideExtension } from "./stamp-hide";

// Re-export the forgiving-emphasis MarkdownConfig so the editor can spread it
// into markdown({ base, extensions }) from the same dynamic-import chunk as the
// inline-reveal layer (bug A: a single space adjacent to a `*` / `_` delimiter
// still renders emphasis). It is a parser config, not a view extension, so it is
// passed to markdown() rather than added to inlineRevealExtension.
export { forgivingEmphasis } from "./forgiving-emphasis";

/**
 * The image base path used by the inline image widget to resolve relative srcs
 * (Images/...) to blob URLs, matching the LiveMarkdownEditor preview. The editor
 * supplies it via imageBasePathExt(basePath); when unset, the resolver falls
 * back to the data root (the same fallback the wrapper uses). Facet.combine
 * takes the first configured value (single producer in practice).
 */
export const imageBasePathFacet = Facet.define<string | undefined, string | undefined>({
  combine: (values) => (values.length > 0 ? values[0] : undefined),
});

/** Wrap a base path as the extension the editor spreads in to configure it. */
export function imageBasePathExt(basePath: string | undefined) {
  return imageBasePathFacet.of(basePath);
}

/**
 * The doc-level embed-pin context (markdown embed hybrid P7-1a). When configured,
 * an embed block widget resolves its frozen snapshot from the sidecar and offers a
 * Pin / Unpin control. When unset (the default), embeds render live with no pin
 * control, so the byte-for-byte round-trip is untouched. Facet.combine takes the
 * first configured value (single producer in practice, the editor host).
 */
export const embedPinContextFacet = Facet.define<
  EmbedPinContext | undefined,
  EmbedPinContext | undefined
>({
  combine: (values) => (values.length > 0 ? values[0] : undefined),
});

/** Wrap a pin context as the extension the editor spreads in to configure it. */
export function embedPinContextExt(context: EmbedPinContext | undefined) {
  return embedPinContextFacet.of(context);
}

/**
 * A single decoration range collected during the walk. We collect into plain
 * arrays first, then sort + build, because replace ranges and mark ranges
 * interleave and a RangeSetBuilder requires strictly increasing start offsets.
 */
interface CollectedRange {
  from: number;
  to: number;
  deco: Decoration;
}

/** A zero-width replace: collapses the marker delimiter to nothing. */
const REPLACE_MARKER = Decoration.replace({});

/** Cache of content-mark decorations by class so we reuse instances. */
const markCache = new Map<string, Decoration>();
function markFor(className: string): Decoration {
  let d = markCache.get(className);
  if (!d) {
    d = Decoration.mark({ class: className });
    markCache.set(className, d);
  }
  return d;
}

/**
 * The result of a walk: the combined set (replace + mark) for
 * EditorView.decorations, and the replace-only set for EditorView.atomicRanges
 * so the caret jumps over hidden markers instead of landing inside them.
 */
export interface InlineRevealDecorations {
  combined: DecorationSet;
  atomic: DecorationSet;
}

/**
 * buildDeco: walk the syntax tree over the editor visible ranges ONLY and emit
 * the inline-reveal decorations.
 *
 * Algorithm (single tree.iterate with a container stack):
 *   - On entering a CONTAINER node: compute revealed = selectionTouchesNode over
 *     the container range (closed interval, so a caret at either boundary
 *     reveals). Push {revealed} onto the stack. Emit a content Decoration.mark
 *     over the container range (Emphasis resolves cm-em vs cm-underline from the
 *     delimiter char). Markers are disjoint from the container content edges, so
 *     marking the whole container range is safe and keeps the content styled.
 *   - On entering a MARKER node: if the innermost container on the stack is NOT
 *     revealed, emit Decoration.replace({}) over the marker (collapse to zero
 *     width). If revealed, emit nothing so the raw delimiter shows as source.
 *   - On leaving a CONTAINER node: pop the stack.
 *
 * Nesting works because the stack tracks the innermost container, and the marker
 * node names are container-specific (EmphasisMark only inside Emphasis /
 * StrongEmphasis, HeaderMark only inside ATXHeading, etc.), so each marker is
 * governed by the correct container reveal state.
 */
export function buildDeco(view: EditorView): InlineRevealDecorations {
  const { state } = view;
  const sel = state.selection;
  const tree = syntaxTree(state);
  const imageBasePath = state.facet(imageBasePathFacet);

  const combinedRanges: CollectedRange[] = [];
  const atomicRanges: CollectedRange[] = [];

  // Stack of container reveal states, innermost last.
  const revealStack: boolean[] = [];

  // Open `<u>` HTMLTag nodes awaiting their matching `</u>`. The @lezer/markdown
  // grammar emits `<u>` and `</u>` as two independent HTMLTag LEAF nodes (NOT a
  // container wrapping the text), so the literal-underline span has to be paired
  // here instead of riding the container/marker path above. Innermost open tag
  // last (LIFO) so nested `<u>` pairs match correctly.
  const openUnderlineTags: Array<{ from: number; to: number }> = [];

  for (const { from: visFrom, to: visTo } of view.visibleRanges) {
    tree.iterate({
      from: visFrom,
      to: visTo,
      enter: (node) => {
        const name = node.name;

        // OBJECT EMBED. A paragraph that is a lone object-embed link is rendered
        // as a block widget by the StateField (buildBlockDeco). When it is not
        // caret-touched, skip its children here so the inline walk does not emit
        // Link / URL decorations underneath the block widget. A touched one falls
        // through so the raw link source shows + styles normally.
        if (name === "Paragraph") {
          const touched = selectionTouchesNode(sel, node.from, node.to);
          if (!touched && parseLoneEmbedLink(state.sliceDoc(node.from, node.to))) {
            return false;
          }
          return undefined;
        }

        // BLOCK WIDGETS (Table / FencedCode) are NOT emitted here. CM6 forbids
        // block decorations from a ViewPlugin.decorations provider ("Block
        // decorations may not be specified via plugins"), so they live in a
        // StateField (buildBlockDeco / blockWidgetField below). We still skip
        // descending into an UNTOUCHED block here, so this walk never emits inner
        // marker decorations that would sit underneath the block widget; a
        // TOUCHED block is descended so its (rare) inline children still style.
        if (name === "Table" || name === "FencedCode") {
          const touched = selectionTouchesNode(sel, node.from, node.to);
          return touched ? undefined : false;
        }

        // IMAGE inline widget. An untouched Image renders as the resolved <img>
        // (inline replace + atomic); a touched Image falls through to the normal
        // container path so the raw ![alt](src) source shows. Skip children when
        // we emit the widget so the LinkMark / URL collapse does not also fire.
        if (name === "Image") {
          const touched = selectionTouchesNode(sel, node.from, node.to);
          if (!touched && node.to > node.from) {
            const source = state.sliceDoc(node.from, node.to);
            const deco = Decoration.replace({
              widget: new ImageWidget(source, imageBasePath),
            });
            combinedRanges.push({ from: node.from, to: node.to, deco });
            atomicRanges.push({ from: node.from, to: node.to, deco });
            return false;
          }
          // Touched: fall through to container handling below (source shows).
        }

        // OBJECT MENTION chip. A Link whose URL is an in-app object route renders
        // as a calm inline chip when the caret is not on it (inline replace +
        // atomic), so a mention reads the same in the editor as in Preview. A
        // touched link, or a normal external link, falls through to the standard
        // link reveal. A lone embed link on its own line is already consumed by
        // the Paragraph branch above, so it never reaches here.
        if (name === "Link") {
          const touched = selectionTouchesNode(sel, node.from, node.to);
          if (!touched && node.to > node.from) {
            const parsed = parseObjectLink(state.sliceDoc(node.from, node.to));
            if (parsed) {
              const deco = Decoration.replace({
                widget: new ObjectChipWidget(parsed.label, parsed.type),
              });
              combinedRanges.push({ from: node.from, to: node.to, deco });
              atomicRanges.push({ from: node.from, to: node.to, deco });
              return false;
            }
          }
          // Touched, or not an object link: fall through to normal handling.
        }

        // LITERAL `<u>...</u>` underline. The grammar gives us two HTMLTag leaf
        // nodes; pair them here. On an opening `<u>` push its range. On the
        // matching `</u>`, pop the innermost open tag and, if the selection does
        // NOT touch the whole `[openFrom, closeTo]` span, collapse both tag
        // ranges (Decoration.replace, mirroring the bold/italic marker hide) and
        // mark the enclosed content with cm-underline. When the caret IS on the
        // span the tags stay as raw source, exactly like the `**` delimiters of
        // a touched bold token. An unclosed `<u>` (no matching close) simply
        // stays on the stack and is dropped at walk end, so it renders as plain
        // source text. Other HTMLTag nodes (<img>, <br>, ...) are left untouched
        // and continue to render as raw source in inline mode.
        if (name === "HTMLTag" && node.to > node.from) {
          const tagSource = state.sliceDoc(node.from, node.to);
          if (isOpenUnderlineTag(tagSource)) {
            openUnderlineTags.push({ from: node.from, to: node.to });
            return;
          }
          if (isCloseUnderlineTag(tagSource)) {
            const open = openUnderlineTags.pop();
            if (open) {
              const revealed = selectionTouchesNode(sel, open.from, node.to);
              if (!revealed) {
                // Collapse the opening + closing tags (replace + atomic) so the
                // caret skips them, and underline the content between them.
                combinedRanges.push({
                  from: open.from,
                  to: open.to,
                  deco: REPLACE_MARKER,
                });
                atomicRanges.push({
                  from: open.from,
                  to: open.to,
                  deco: REPLACE_MARKER,
                });
                combinedRanges.push({
                  from: node.from,
                  to: node.to,
                  deco: REPLACE_MARKER,
                });
                atomicRanges.push({
                  from: node.from,
                  to: node.to,
                  deco: REPLACE_MARKER,
                });
                if (node.from > open.to) {
                  combinedRanges.push({
                    from: open.to,
                    to: node.from,
                    deco: markFor("cm-underline"),
                  });
                }
              }
            }
            return;
          }
          // A non-underline HTMLTag (e.g. <img>, <br>): leave as source.
          return;
        }

        if (isContainerNode(name)) {
          const revealed = selectionTouchesNode(sel, node.from, node.to);
          revealStack.push(revealed);

          // Content mark over the whole container range. For Emphasis, read the
          // first delimiter char from the doc to pick cm-em vs cm-underline.
          let cls = contentClassFor(name);
          if (cls === "cm-em") {
            const firstChar = state.sliceDoc(node.from, node.from + 1);
            cls = emphasisContentClass(firstChar);
          }
          if (cls && node.to > node.from) {
            combinedRanges.push({
              from: node.from,
              to: node.to,
              deco: markFor(cls),
            });
          }
          return;
        }

        if (isMarkerNode(name)) {
          const innerRevealed =
            revealStack.length > 0
              ? revealStack[revealStack.length - 1]
              : false;
          // Only collapse markers that sit inside a known container. A marker
          // with no container on the stack (should not happen for our node set)
          // is left as source.
          if (!innerRevealed && revealStack.length > 0 && node.to > node.from) {
            combinedRanges.push({
              from: node.from,
              to: node.to,
              deco: REPLACE_MARKER,
            });
            atomicRanges.push({
              from: node.from,
              to: node.to,
              deco: REPLACE_MARKER,
            });
          }
          return;
        }
      },
      leave: (node) => {
        if (isContainerNode(node.name)) {
          revealStack.pop();
        }
      },
    });
  }

  return {
    combined: toSet(combinedRanges),
    atomic: toSet(atomicRanges),
  };
}

/**
 * Sort collected ranges and build a DecorationSet. We sort by `from`, then put
 * zero-length-affecting replace decorations before marks at the same start so
 * the set is well-formed, then feed a RangeSetBuilder (which requires
 * non-decreasing start offsets). Decoration.set could sort for us, but building
 * explicitly keeps the contract obvious and avoids re-sorting an already-ordered
 * stream twice.
 */
function toSet(ranges: CollectedRange[]): DecorationSet {
  if (ranges.length === 0) return Decoration.none;
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const r of ranges) {
    builder.add(r.from, r.to, r.deco);
  }
  return builder.finish();
}

/**
 * buildBlockDeco: the BLOCK-widget pass (Table / FencedCode), kept separate from
 * the inline buildDeco walk because CM6 only accepts block decorations from a
 * StateField, not a ViewPlugin. This walks the whole document (a StateField has
 * no viewport), but the walk only enters top-level blocks and returns false from
 * every Table / FencedCode so it never descends into their (large) bodies, so it
 * stays cheap. A block the selection does NOT touch becomes a single block:true
 * Decoration.replace({ widget }) over its full range, fed into BOTH the combined
 * set (so it renders) and the atomic set (so the caret cannot land inside the
 * collapsed source). A block the selection touches emits no widget, so the raw
 * source shows as editable text, on the same selectionSet trigger as the inline
 * markers.
 */
export function buildBlockDeco(state: EditorState): InlineRevealDecorations {
  const sel = state.selection;
  const tree = syntaxTree(state);
  const imageBasePath = state.facet(imageBasePathFacet);
  const pinContext = state.facet(embedPinContextFacet);
  const blockRanges: CollectedRange[] = [];
  const atomicRanges: CollectedRange[] = [];

  tree.iterate({
    enter: (node) => {
      const name = node.name;

      // OBJECT EMBED. An untouched paragraph that is a lone object-embed link
      // collapses into a block widget rendering the React ObjectEmbed; a touched
      // one emits nothing so the raw link source shows as editable text.
      if (name === "Paragraph") {
        if (node.to <= node.from) return undefined;
        if (selectionTouchesNode(sel, node.from, node.to)) return undefined;
        const lone = parseLoneEmbedLink(state.sliceDoc(node.from, node.to));
        if (!lone) return undefined;
        const deco = Decoration.replace({
          widget: new EmbedWidget(lone.descriptor, lone.caption, imageBasePath, pinContext),
          block: true,
        });
        blockRanges.push({ from: node.from, to: node.to, deco });
        atomicRanges.push({ from: node.from, to: node.to, deco });
        return false;
      }

      // HorizontalRule: a standalone `___` / `---` / `***` line. The grammar
      // already parses it into a HorizontalRule node; without a widget it shows
      // as raw source. When the caret is not on the rule line, collapse it into a
      // full-width <hr> (bug C). A touched rule reveals the raw source for editing,
      // the same reveal contract as the table / fenced-code widgets. Inline
      // `__underline__` is unaffected: it parses inside a Paragraph as Emphasis,
      // never as a HorizontalRule, so this branch never fires for it.
      if (name === "HorizontalRule") {
        const touchedHr = selectionTouchesNode(sel, node.from, node.to);
        if (touchedHr || node.to <= node.from) return false;
        const deco = Decoration.replace({ widget: new HrWidget(), block: true });
        blockRanges.push({ from: node.from, to: node.to, deco });
        atomicRanges.push({ from: node.from, to: node.to, deco });
        return false;
      }

      if (name !== "Table" && name !== "FencedCode") return undefined;
      // Do not descend into the block body either way (return false below).
      const touched = selectionTouchesNode(sel, node.from, node.to);
      if (touched || node.to <= node.from) return false;
      const source = state.sliceDoc(node.from, node.to);
      const widget =
        name === "Table"
          ? new TableWidget(source)
          : new FencedCodeWidget(source);
      const deco = Decoration.replace({ widget, block: true });
      blockRanges.push({ from: node.from, to: node.to, deco });
      atomicRanges.push({ from: node.from, to: node.to, deco });
      return false;
    },
  });

  return {
    combined: toSet(blockRanges),
    atomic: toSet(atomicRanges),
  };
}

/**
 * The inline-reveal ViewPlugin. Holds the combined decoration set and the
 * replace-only atomic set, rebuilding on any of the four triggers:
 *   - docChanged: edits change token ranges.
 *   - viewportChanged: scrolling brings new visible ranges into scope.
 *   - selectionSet: the caret moved (the Typora reveal trigger).
 *   - syntaxTree identity changed: lezer finished an incremental / async parse a
 *     tick after the edit, so the tree we walked is now stale.
 */
class InlineRevealPlugin {
  decorations: DecorationSet;
  atomic: DecorationSet;

  constructor(view: EditorView) {
    const built = buildDeco(view);
    this.decorations = built.combined;
    this.atomic = built.atomic;
  }

  update(update: ViewUpdate) {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.selectionSet ||
      treeChanged(update.startState, update.state)
    ) {
      const built = buildDeco(update.view);
      this.decorations = built.combined;
      this.atomic = built.atomic;
    }
  }
}

/** Has the parsed syntax tree identity changed between two states? */
function treeChanged(a: EditorState, b: EditorState): boolean {
  return syntaxTree(a) !== syntaxTree(b);
}

/**
 * The ViewPlugin instance with the dual provide: EditorView.decorations from the
 * combined set, and EditorView.atomicRanges from the replace-only set so the
 * caret skips over collapsed markers rather than landing inside them.
 */
export const inlineReveal = ViewPlugin.fromClass(InlineRevealPlugin, {
  decorations: (plugin) => plugin.decorations,
  provide: (plugin) =>
    EditorView.atomicRanges.of((view) => {
      const value = view.plugin(plugin);
      return value ? value.atomic : Decoration.none;
    }),
});

/** The block-widget field value: the render set + the atomic (replace) set. */
interface BlockDecoState {
  decorations: DecorationSet;
  atomic: DecorationSet;
}

/**
 * blockWidgetField: a StateField holding the Table / FencedCode block widgets.
 * Block decorations MUST come from a StateField (CM6 rejects them from a
 * ViewPlugin), so this is the block counterpart to the inlineReveal plugin. It
 * recomputes when the document changes, the selection changes (the reveal
 * trigger), or the parsed tree identity changes (lezer finished an incremental /
 * async parse a tick after an edit). It provides BOTH EditorView.decorations
 * (the block widgets) and EditorView.atomicRanges (so the caret skips the
 * collapsed block source).
 */
const blockWidgetField = StateField.define<BlockDecoState>({
  create(state) {
    const built = buildBlockDeco(state);
    return { decorations: built.combined, atomic: built.atomic };
  },
  update(value, tr) {
    const treeMoved = syntaxTree(tr.startState) !== syntaxTree(tr.state);
    if (!tr.docChanged && !tr.selection && !treeMoved) return value;
    const built = buildBlockDeco(tr.state);
    return { decorations: built.combined, atomic: built.atomic };
  },
  provide: (field) => [
    EditorView.decorations.from(field, (v) => v.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).atomic),
  ],
});

/**
 * The single extension to spread into the editor:
 *   - inlineReveal: the ViewPlugin for inline marks + inline replaces + the
 *     inline image widget (viewport-scoped, selection-driven).
 *   - blockWidgetField: the StateField for the Table / FencedCode block widgets
 *     (block decorations cannot come from a plugin).
 *   - stampHideExtension: the StateField that hides the provenance stamp block
 *     (and any leftover legacy last-access / reopened lines) while leaving the
 *     text in the document, so the saved .md + every export still carry it.
 *   - inlineRevealTheme: inline-mark + block-widget + image styling.
 *   - markdownKeymap: the hybrid-parity shortcuts at Prec.high, so they win over
 *     the markdown language + default keymaps regardless of order; the editor
 *     still spreads this AFTER the language extension.
 *
 * The reveal plugin + block field + stamp-hide field stay VIEW-ONLY (decorations
 * + widgets, no doc mutation); markdownKeymap is the ONLY member that dispatches
 * doc changes, and only on a user keypress. The byte-for-byte round-trip is
 * therefore preserved.
 */
export const inlineRevealExtension: Extension = [
  inlineReveal,
  blockWidgetField,
  stampHideExtension,
  inlineRevealTheme,
  markdownKeymap,
];
