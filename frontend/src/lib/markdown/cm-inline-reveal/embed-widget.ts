/**
 * embed-widget.ts: the object-embed block widget for the CM6 inline-reveal layer
 * (markdown + ResearchOS embed hybrid, Phase 2).
 *
 * When the caret is NOT inside a paragraph that is a lone object-embed link
 * (a `[caption](/path#ros=view)` alone on its line), the paragraph is collapsed
 * into a block:true Decoration.replace({ widget }) that renders the SAME React
 * ObjectEmbed the Preview pane uses. Reveal-on-caret is the same selectionSet
 * trigger as the inline markers, caret in -> no widget -> the raw link source
 * shows as editable text.
 *
 * Unlike the table / image widgets (which render sanitized HTML), an embed needs
 * the React renderers (RDKit structure, live tables, lazy per-type modules), so
 * this widget mounts a React root into the widget DOM and unmounts it on destroy.
 * The root is mounted once per distinct embed (eq() memoizes by descriptor +
 * caption), so a caret move elsewhere reuses the existing DOM instead of
 * remounting.
 *
 * Mostly view-only: the widget renders a slice of the unchanged document. It
 * dispatches a transaction ONLY in response to an explicit user view-switch, and
 * that rewrite is a fragment-only swap (it replaces just the embed href's #ros
 * view) that preserves the rest of the line byte-for-byte. Every other path leaves
 * the document untouched, so the byte-for-byte round-trip holds.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { WidgetType, type EditorView } from "@codemirror/view";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import ObjectEmbed from "@/components/embeds/ObjectEmbed";
import { parseObjectEmbed, swapEmbedView, type EmbedDescriptor } from "@/lib/references";

/** A paragraph that is exactly one object-embed link. Caption is the link text
 *  (unescaped), descriptor is the parsed embed. Null for anything else. */
export function parseLoneEmbedLink(
  source: string,
): { descriptor: EmbedDescriptor; caption: string } | null {
  const trimmed = source.trim();
  // [caption](url) with nothing else. Greedy caption backtracks past inner
  // parens / brackets in the name, url is the non-space run before the final ).
  const m = /^\[(.*)\]\((\S+)\)$/.exec(trimmed);
  if (!m) return null;
  const descriptor = parseObjectEmbed(m[2]);
  if (!descriptor || !descriptor.isEmbed) return null;
  const caption = m[1].replace(/\\([[\]\\])/g, "$1");
  return { descriptor, caption };
}

/** A lone embed link with its href located inside the line. Returns the href and
 *  the [start, end) offsets of that href within `lineText` so a rewrite can swap
 *  ONLY the href and keep the caption, the brackets, and any surrounding
 *  whitespace exactly. Null when the line is not a lone embed link. */
function locateEmbedHref(
  lineText: string,
): { href: string; hrefStart: number; hrefEnd: number } | null {
  const lone = parseLoneEmbedLink(lineText);
  if (!lone) return null;
  // Re-find the href the same way parseLoneEmbedLink did (`(\S+)` before the final
  // `)`), but on the raw line so the offsets are real positions, not trimmed ones.
  const m = /\[(?:.*)\]\((\S+)\)\s*$/.exec(lineText);
  if (!m) return null;
  const href = m[1];
  // The href starts right after the "](" that introduces it. lastIndexOf is safe
  // because parseLoneEmbedLink already confirmed exactly one lone link.
  const open = lineText.lastIndexOf("](" + href + ")");
  if (open < 0) return null;
  const hrefStart = open + 2;
  return { href, hrefStart, hrefEnd: hrefStart + href.length };
}

/** Pure line rewrite: given a line that is a lone embed link, return the same line
 *  with only the embed view swapped (caption and whitespace preserved). Returns
 *  null when the line is not a lone embed link, or when the href does not parse as
 *  an embed (swapEmbedView would no-op). Exported for unit testing without an
 *  EditorView. */
export function rewriteLoneEmbedLine(lineText: string, newView: string): string | null {
  const loc = locateEmbedHref(lineText);
  if (!loc) return null;
  const swapped = swapEmbedView(loc.href, newView);
  if (swapped === loc.href) return null;
  return lineText.slice(0, loc.hrefStart) + swapped + lineText.slice(loc.hrefEnd);
}

/** Resolve the line at `pos`, swap its embed view, and dispatch the change. Best
 *  effort, if the line is no longer a lone embed link or the swap is a no-op,
 *  nothing happens (the document is never corrupted). Never throws. */
export function rewriteEmbedViewAtLine(
  view: EditorView,
  pos: number,
  newView: string,
): void {
  try {
    const line = view.state.doc.lineAt(pos);
    const next = rewriteLoneEmbedLine(line.text, newView);
    if (next == null || next === line.text) return;
    view.dispatch({ changes: { from: line.from, to: line.to, insert: next } });
  } catch {
    // posAtDOM gave a stale position, the re-parse failed, or the line moved.
    // Do nothing rather than risk corrupting the document.
  }
}

export class EmbedWidget extends WidgetType {
  private root: Root | null = null;

  constructor(
    readonly descriptor: EmbedDescriptor,
    readonly caption: string,
    readonly basePath: string | undefined,
  ) {
    super();
  }

  /** Same embed (type + id + view + opts) and caption -> identical widget, so CM6
   *  keeps the mounted React root instead of remounting on every rebuild. */
  eq(other: WidgetType): boolean {
    return (
      other instanceof EmbedWidget &&
      other.descriptor.type === this.descriptor.type &&
      other.descriptor.id === this.descriptor.id &&
      other.descriptor.view === this.descriptor.view &&
      other.caption === this.caption &&
      other.basePath === this.basePath &&
      JSON.stringify(other.descriptor.opts) === JSON.stringify(this.descriptor.opts)
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-inline-block cm-object-embed";
    // The widget is a rendered artifact, not editable text. The caret reaches
    // the source by entering the (atomic) range, not by editing inside.
    wrap.contentEditable = "false";
    // On a user view-switch, persist by rewriting only the #ros view in the source
    // line. The position is resolved fresh at click time via posAtDOM, never
    // cached, so a doc edit elsewhere cannot make us write to a stale offset. After
    // the dispatch the block deco rebuilds and a fresh widget renders the new view
    // (the EditorView is part of eq(), so the rebuild is forced).
    const onViewChange = (newView: string) => {
      try {
        const pos = view.posAtDOM(wrap);
        rewriteEmbedViewAtLine(view, pos, newView);
      } catch {
        // posAtDOM could not place the widget. Do nothing.
      }
    };
    try {
      this.root = createRoot(wrap);
      this.root.render(
        createElement(ObjectEmbed, {
          descriptor: this.descriptor,
          caption: this.caption,
          basePath: this.basePath,
          onViewChange,
        }),
      );
    } catch {
      // A render failure must never break the editor. Degrade to the caption
      // text, the raw link is still one caret-move away.
      this.root = null;
      wrap.textContent = this.caption || this.descriptor.id;
    }
    return wrap;
  }

  destroy(): void {
    // Unmount on a microtask, React forbids unmounting synchronously from inside
    // a render / commit, and CM6 may call destroy during one.
    const root = this.root;
    this.root = null;
    if (root) {
      Promise.resolve().then(() => root.unmount());
    }
  }

  ignoreEvent(): boolean {
    return false;
  }
}
