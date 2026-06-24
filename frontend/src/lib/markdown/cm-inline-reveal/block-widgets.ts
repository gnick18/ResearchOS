/**
 * block-widgets.ts: Table + FencedCode block widgets for the CM6 inline-reveal
 * layer (Typora editor chip 2b).
 *
 * When the caret is NOT inside a Table or FencedCode block, that block is
 * collapsed into a single block:true Decoration.replace({ widget }) over its full
 * node range, and the widget renders the block as the LiveMarkdownEditor preview
 * would (table -> <table>, fenced code -> highlighted <pre><code>). The replace
 * range is also fed into the atomicRanges set (in inline-reveal.ts) so the caret
 * cannot land inside the collapsed source: a click / arrow into the range lands
 * on the boundary, the next selectionSet rebuild sees the block touched, emits NO
 * widget, and the raw source shows as editable text. This is the SAME
 * selectionSet trigger that drives the inline markers.
 *
 * Memoization: each widget caches its rendered DOM keyed by source, and eq()
 * returns true when the source is byte-identical, so CM6 reuses the existing DOM
 * across rebuilds (caret moves elsewhere in the doc) instead of re-rendering the
 * markdown pipeline on every keystroke. updateDOM short-circuits the same way.
 *
 * View-only: the widget renders a slice of the unchanged document. It never
 * dispatches a transaction, so the byte-for-byte round-trip holds.
 *
 * House style: no em-dashes, no emojis. HTML is produced by render-html.ts, which
 * routes through markdownSanitizeSchema (allowComments:true); no fresh schema.
 */

import { WidgetType } from "@codemirror/view";

import { renderTableHtml, renderFencedCodeHtml } from "./render-html";

/**
 * Base for the two block widgets. Holds the source slice and renders it to
 * sanitized HTML. Memoization is by source via eq(): when the next build's
 * widget eq()s the painted one (byte-identical source), CM6 keeps the existing
 * DOM and never re-runs toDOM, so the markdown pipeline does not re-fire on every
 * unrelated keystroke. A differing source is not eq, so CM6 redraws via toDOM,
 * which is the correct behavior for changed content.
 */
abstract class BlockWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }

  /** Render the source fragment to a sanitized HTML string. */
  protected abstract renderHtml(source: string): string;

  /** The wrapper class so the theme can scope block-widget styling. */
  protected abstract wrapperClass(): string;

  /**
   * Same concrete widget class + byte-identical source -> identical widget, so
   * CM6 reuses the existing DOM. CM6 only ever passes an instance of the same
   * type, but the declared param is WidgetType (TS cannot express the narrowing),
   * so we guard the constructor before reading `source`.
   */
  eq(other: WidgetType): boolean {
    return (
      other instanceof BlockWidget &&
      other.constructor === this.constructor &&
      other.source === this.source
    );
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = this.wrapperClass();
    // contentEditable=false: the widget is a rendered artifact, not editable
    // text. The caret reaches the source by entering the (atomic) range, not by
    // editing inside the widget DOM.
    wrap.contentEditable = "false";
    wrap.innerHTML = this.renderHtml(this.source);
    return wrap;
  }

  /** Block widgets are not part of the editable text run. */
  ignoreEvent(): boolean {
    return false;
  }
}

/** A GFM table rendered as a real <table>. */
export class TableWidget extends BlockWidget {
  protected renderHtml(source: string): string {
    return renderTableHtml(source);
  }
  protected wrapperClass(): string {
    return "cm-inline-block cm-inline-table";
  }
}

/** A fenced code block rendered as a highlighted <pre><code>. */
export class FencedCodeWidget extends BlockWidget {
  protected renderHtml(source: string): string {
    return renderFencedCodeHtml(source);
  }
  protected wrapperClass(): string {
    return "cm-inline-block cm-inline-fenced";
  }
}

/**
 * A thematic break (`___` / `---` / `***` on its own line) rendered as a real
 * full-width <hr>, matching the Preview view (bug C). The @lezer/markdown grammar
 * already parses a standalone delimiter line into a HorizontalRule node, but
 * without a widget it renders as the raw `___` source text in the inline editor.
 * When the caret is not on the rule line this widget collapses it to an <hr>; the
 * caret entering the (atomic) range reveals the raw source for editing, the same
 * reveal contract as the table / fenced-code widgets.
 *
 * This widget renders NO markdown HTML (it is a single static <hr>), so it does
 * not extend BlockWidget; its DOM never depends on the source beyond the
 * memoization key, which is constant.
 */
export class HrWidget extends WidgetType {
  eq(other: WidgetType): boolean {
    return other instanceof HrWidget;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-inline-block cm-inline-hr";
    wrap.contentEditable = "false";
    wrap.appendChild(document.createElement("hr"));
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}
