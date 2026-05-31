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

import { RangeSetBuilder } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";
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
  isMarkerNode,
} from "./marker-taxonomy";
import { selectionTouchesNode } from "./selection-touches";
import { inlineRevealTheme } from "./theme";

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

  const combinedRanges: CollectedRange[] = [];
  const atomicRanges: CollectedRange[] = [];

  // Stack of container reveal states, innermost last.
  const revealStack: boolean[] = [];

  for (const { from: visFrom, to: visTo } of view.visibleRanges) {
    tree.iterate({
      from: visFrom,
      to: visTo,
      enter: (node) => {
        const name = node.name;

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

/**
 * The single extension to spread into the editor: the plugin plus its theme.
 */
export const inlineRevealExtension = [inlineReveal, inlineRevealTheme];
