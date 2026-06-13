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

import ObjectEmbed, { type EmbedPinContext } from "@/components/embeds/ObjectEmbed";
import {
  parseObjectEmbed,
  swapEmbedView,
  setEmbedOpt,
  type EmbedDescriptor,
} from "@/lib/references";

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

/** Pure line rewrite: given a line that is a lone embed link, return the same line
 *  with its `pin` opt set to `pinId` (add) or removed (pass null). Caption and
 *  whitespace are preserved, only the href changes. Returns null when the line is
 *  not a lone embed link or the rewrite is a no-op. Add-then-remove is byte-for-byte
 *  identical because setEmbedOpt rebuilds through the same builder. Exported for
 *  unit testing without an EditorView. */
export function rewriteEmbedPinLine(
  lineText: string,
  pinId: string | null,
): string | null {
  const loc = locateEmbedHref(lineText);
  if (!loc) return null;
  const rewritten = setEmbedOpt(loc.href, "pin", pinId);
  if (rewritten === loc.href) return null;
  return lineText.slice(0, loc.hrefStart) + rewritten + lineText.slice(loc.hrefEnd);
}

/** Resolve the line at `pos`, set / clear its `pin` opt, and dispatch the change.
 *  Best effort, a stale position or a non-embed line is a silent no-op (the
 *  document is never corrupted). Never throws. */
export function rewriteEmbedPinAtLine(
  view: EditorView,
  pos: number,
  pinId: string | null,
): void {
  try {
    const line = view.state.doc.lineAt(pos);
    const next = rewriteEmbedPinLine(line.text, pinId);
    if (next == null || next === line.text) return;
    view.dispatch({ changes: { from: line.from, to: line.to, insert: next } });
  } catch {
    // posAtDOM gave a stale position, or the line moved. Do nothing.
  }
}

export class EmbedWidget extends WidgetType {
  private root: Root | null = null;

  constructor(
    readonly descriptor: EmbedDescriptor,
    readonly caption: string,
    readonly basePath: string | undefined,
    /** Doc-level pin context (sidecar path + bake deps). Undefined when the host
     *  did not configure pinning, then the widget renders today's live embed with
     *  no Pin control. The onPin / onUnpin closures are built per-toDOM so they can
     *  resolve the live caret position. */
    readonly pinContext: EmbedPinContext | undefined,
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
      // The sidecar path is part of identity, a different doc sidecar resolves a
      // different frozen snapshot. The closures are rebuilt per-toDOM so they are
      // not compared.
      other.pinContext?.sidecarPath === this.pinContext?.sidecarPath &&
      JSON.stringify(other.descriptor.opts) === JSON.stringify(this.descriptor.opts)
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-inline-block cm-object-embed";
    // The widget is a rendered artifact, not editable text. The caret reaches
    // the source by entering the (atomic) range, not by editing inside.
    wrap.contentEditable = "false";
    // ignoreEvent stops CM6 from moving the caret on a click, but it does not
    // call preventDefault, so the browser's native contenteditable selection
    // still fires on a click inside the widget (e.g. on the molecule SVG, which
    // is not a button or link). CM6's DOM observer then reads that selection and
    // reveals the raw markdown. Prevent the default on a mousedown anywhere in
    // the body that is NOT an interactive control, so a body click never moves
    // the selection. Buttons and links still work: their click fires separately,
    // and link navigation happens on click, not mousedown.
    wrap.addEventListener("mousedown", (e) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("a, button, input, textarea, select")) return;
      e.preventDefault();
    });
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

    // Pin / Unpin closures (P7-1a). Only built when the host configured a pin
    // context. Pin freezes a snapshot into the sidecar, then rewrites the source
    // line to carry `&pin=s_xxx`. Unpin removes the sidecar entry, then drops the
    // `pin` opt. The caret position is resolved fresh at click time via posAtDOM,
    // never cached, so a doc edit elsewhere cannot make us write to a stale offset.
    const pinContext = this.pinContext;
    const pinHandlers: EmbedPinContext | undefined = pinContext?.sidecarPath
      ? {
          sidecarPath: pinContext.sidecarPath,
          deps: pinContext.deps,
          onPin: (descriptor, caption) => {
            void (async () => {
              try {
                const { buildPin, putPin } = await import("@/lib/embeds/embed-pins");
                const pin = await buildPin(descriptor, caption, pinContext.deps);
                const shortId = await putPin(pinContext.sidecarPath, pin);
                const pos = view.posAtDOM(wrap);
                rewriteEmbedPinAtLine(view, pos, shortId);
              } catch {
                // A bake / write / position failure leaves the embed live and
                // unpinned. Best effort, never throw into the editor.
              }
            })();
          },
          onUnpin: (descriptor) => {
            void (async () => {
              try {
                const { removePin } = await import("@/lib/embeds/embed-pins");
                const existing = descriptor.opts.pin;
                if (existing) {
                  await removePin(pinContext.sidecarPath, existing);
                }
                const pos = view.posAtDOM(wrap);
                rewriteEmbedPinAtLine(view, pos, null);
              } catch {
                // Leave the pin in place rather than corrupt the line.
              }
            })();
          },
        }
      : undefined;

    // Edit markdown. When clicked, resolve the embed's position fresh (posAtDOM)
    // and place the CM6 caret INTO the embed's source line. That selection update
    // triggers the existing reveal-on-caret path (selectionTouchesNode) so the raw
    // markdown source shows as editable text, exactly as if the user had navigated
    // there with arrow keys. posAtDOM is resolved at click time, never cached, so a
    // doc edit elsewhere cannot target a stale offset.
    const onEditMarkdown = () => {
      try {
        const pos = view.posAtDOM(wrap);
        const line = view.state.doc.lineAt(pos);
        // Place the caret at the start of the embed line. This satisfies
        // selectionTouchesNode for the paragraph (which checks >= from / <= to),
        // so the block widget collapses and the raw source appears.
        view.dispatch({
          selection: { anchor: line.from },
          scrollIntoView: true,
        });
        view.focus();
      } catch {
        // posAtDOM gave a stale position or the line moved. Do nothing.
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
          pinContext: pinHandlers,
          onEditMarkdown,
          // Stopgap: this is the CM6 EDITOR host. A live TransclusionEmbed mounted
          // here loops ("Maximum update depth"), so render transclusions as an inert
          // chip in the editor. Preview renders ObjectEmbed without this flag, so the
          // live section still shows there. Remove once the loop is fixed at source.
          inertTransclude: true,
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

  /** Return true for mouse events so CM6 does not move the caret on a click
   *  anywhere inside the widget. This prevents the accidental reveal-on-caret that
   *  happened when a user clicked the embed body. React onClick handlers STILL fire
   *  (ignoreEvent only suppresses CM6's own mouse handler, not the DOM event), so
   *  the view-switch, Freeze/Unfreeze, and Edit-markdown buttons all work normally.
   *  Keyboard caret navigation (arrow keys) is unaffected: keyboard events arrive
   *  via the editor's own key handler, not via ignoreEvent, so the caret can still
   *  land on the embed's line and trigger reveal. */
  ignoreEvent(event: Event): boolean {
    return event instanceof MouseEvent;
  }
}
