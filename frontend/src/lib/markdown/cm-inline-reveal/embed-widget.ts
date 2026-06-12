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
 * View-only: the widget renders a slice of the unchanged document, it never
 * dispatches a transaction, so the byte-for-byte round-trip holds.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { WidgetType } from "@codemirror/view";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import ObjectEmbed from "@/components/embeds/ObjectEmbed";
import { parseObjectEmbed, type EmbedDescriptor } from "@/lib/references";

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

  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-inline-block cm-object-embed";
    // The widget is a rendered artifact, not editable text. The caret reaches
    // the source by entering the (atomic) range, not by editing inside.
    wrap.contentEditable = "false";
    try {
      this.root = createRoot(wrap);
      this.root.render(
        createElement(ObjectEmbed, {
          descriptor: this.descriptor,
          caption: this.caption,
          basePath: this.basePath,
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
