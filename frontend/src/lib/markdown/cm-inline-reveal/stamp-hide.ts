/**
 * stamp-hide.ts: hide the provenance stamp block in the CM6 inline editor.
 *
 * Every notes / results / method markdown file ships with a provenance stamp at
 * the very top (see lib/stamp-utils.ts):
 *
 *     <!-- stamp:start -->
 *     2026-02-15
 *     12:07 PM
 *     experiment: Western Blot Analysis
 *     project folder: Protein Research
 *     <!-- stamp:end -->
 *     ___
 *
 * The stamp is machine provenance, not user prose: it MUST survive byte-for-byte
 * in the saved .md and in every export (PDF / HTML / markdown), but it clutters
 * the editor, so this extension HIDES it visually while LEAVING THE TEXT IN THE
 * DOCUMENT. It is a VIEW-ONLY decoration: it never dispatches a doc-changing
 * transaction, so view.state.doc.toString() still equals the on-disk file
 * byte-for-byte (the round-trip gate the inline-reveal layer also honors).
 *
 * Unlike the Typora reveal layer, the stamp is hidden UNCONDITIONALLY (it is not
 * editable content, so there is no reveal-on-caret behavior). The hidden span is
 * fed into EditorView.atomicRanges so the caret skips it (Home / arrow-up land on
 * the first line of real content, not inside the invisible stamp).
 *
 * Old files may also carry the retired journaling lines right after the stamp:
 * a `[last-access]: # (ISO)` link-reference definition and / or
 * `*Reopened on …*` rules. We extend the hidden range to swallow those leftover
 * lines too so the editor is clean even before such a file is re-saved.
 *
 * Block decorations (a hidden span can cover whole lines) MUST come from a
 * StateField in CM6 (it rejects block decorations from a ViewPlugin), so this is
 * a StateField, mirroring blockWidgetField in inline-reveal.ts.
 *
 * House style: no em-dashes, no emojis.
 */

import { RangeSetBuilder, StateField } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

/**
 * The replacement widget for a hidden stamp block: a zero-size, non-editable,
 * presentation-hidden span. block:true Decoration.replace removes the source
 * lines from layout; the widget renders nothing visible.
 */
class HiddenStampWidget extends WidgetType {
  eq(other: WidgetType): boolean {
    return other instanceof HiddenStampWidget;
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span");
    // Belt-and-suspenders: the block:true replace already collapses the source,
    // but mark the widget hidden + non-editable so nothing leaks visually and the
    // caret cannot land inside it.
    el.className = "cm-stamp-hidden";
    el.setAttribute("aria-hidden", "true");
    el.contentEditable = "false";
    return el;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

const HIDDEN_STAMP = Decoration.replace({
  widget: new HiddenStampWidget(),
  block: true,
});

/** Does this CommentBlock node hold the `<!-- stamp:start -->` marker? */
function isStampStart(state: EditorState, from: number, to: number): boolean {
  return /<!--\s*stamp:start\s*-->/.test(state.sliceDoc(from, to));
}

/** Does this CommentBlock node hold the `<!-- stamp:end -->` marker? */
function isStampEnd(state: EditorState, from: number, to: number): boolean {
  return /<!--\s*stamp:end\s*-->/.test(state.sliceDoc(from, to));
}

/** Is this LinkReference node a retired `[last-access]: # (...)` line? */
function isLastAccessRef(state: EditorState, from: number, to: number): boolean {
  return /^\s*\[last-access\]\s*:/.test(state.sliceDoc(from, to));
}

/**
 * Compute the [from, to] span of the provenance stamp block (plus the trailing
 * `___` separator and any leftover legacy last-access line). Returns null when no
 * canonical (HTML-comment) stamp is present, so legacy-only files or
 * stampless documents are left fully editable.
 *
 * We only recognize the canonical `<!-- stamp:start --> … <!-- stamp:end -->`
 * form here: legacy formats are lazy-normalized to canonical on save by
 * lib/stamp-utils.normalizeStampFormat, so hiding the canonical form is enough.
 */
function findStampSpan(state: EditorState): { from: number; to: number } | null {
  const tree = syntaxTree(state);
  let startFrom = -1;
  let endTo = -1;

  // The stamp lives at the very top of the file. Walk top-level blocks in order:
  // find the start comment, then the matching end comment, then extend over the
  // trailing `___` rule + any stray last-access ref directly after it.
  const cursor = tree.cursor();
  if (cursor.firstChild()) {
    do {
      const { name, from, to } = cursor;
      if (startFrom === -1) {
        if (name === "CommentBlock" && isStampStart(state, from, to)) {
          startFrom = from;
        }
        // A non-comment block before any stamp-start means there is no leading
        // stamp; stop looking (the stamp is always first when present).
        else if (name !== "CommentBlock") {
          break;
        }
        continue;
      }

      // After the start: look for the matching end comment.
      if (endTo === -1) {
        if (name === "CommentBlock" && isStampEnd(state, from, to)) {
          endTo = to;
        }
        continue;
      }

      // After the end comment: swallow the trailing `___` separator and any
      // leftover legacy `[last-access]` line, then stop.
      if (name === "HorizontalRule") {
        endTo = to;
        continue;
      }
      if (name === "LinkReference" && isLastAccessRef(state, from, to)) {
        endTo = to;
        continue;
      }
      break;
    } while (cursor.nextSibling());
  }

  if (startFrom === -1 || endTo === -1 || endTo <= startFrom) return null;

  // Extend to the end of the line so the trailing newline collapses with the
  // block, leaving no blank gap where the stamp used to be.
  const endLine = state.doc.lineAt(endTo);
  const to = Math.min(endLine.to + 1, state.doc.length);
  return { from: startFrom, to };
}

/** The decoration set + atomic (caret-skip) set for the hidden stamp. */
interface StampHideState {
  decorations: DecorationSet;
  atomic: DecorationSet;
}

function build(state: EditorState): StampHideState {
  const span = findStampSpan(state);
  if (!span) {
    return { decorations: Decoration.none, atomic: Decoration.none };
  }
  const builder = new RangeSetBuilder<Decoration>();
  builder.add(span.from, span.to, HIDDEN_STAMP);
  const set = builder.finish();
  return { decorations: set, atomic: set };
}

/**
 * stampHideField: a StateField that hides the provenance stamp block. The stamp
 * only moves when the document changes (it is fixed at the top and not user
 * prose), so this recomputes on docChanged or when lezer's parse tree identity
 * changes (an async / incremental parse finished a tick after an edit). It is
 * independent of the caret, so selection changes are ignored.
 */
const stampHideField = StateField.define<StampHideState>({
  create(state) {
    return build(state);
  },
  update(value, tr) {
    const treeMoved = syntaxTree(tr.startState) !== syntaxTree(tr.state);
    if (!tr.docChanged && !treeMoved) return value;
    return build(tr.state);
  },
  provide: (field) => [
    EditorView.decorations.from(field, (v) => v.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).atomic),
  ],
});

/** Theme: keep the hidden widget zero-size with no visual footprint. */
const stampHideTheme = EditorView.theme({
  ".cm-stamp-hidden": {
    display: "none",
  },
});

/**
 * The single extension to spread into the inline editor. Combined into
 * inlineRevealExtension so every inline-editor mount gets it for free.
 */
export const stampHideExtension: Extension = [stampHideField, stampHideTheme];

// Exported for unit tests.
export { findStampSpan };
