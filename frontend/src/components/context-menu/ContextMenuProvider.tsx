"use client";

// sequence editor master. The website-wide smart right-click framework.
//
// Grant's ask. Any right-click detects what is under the cursor. If a component
// registered a menu for that thing, open it. Otherwise show a small circle-with-
// a-slash glyph at the pointer that fades, so a bare right-click still feels
// responsive but signals "no menu here." Editable text (inputs, textareas,
// contenteditable, the CodeMirror note editor) keeps the browser's NATIVE menu
// so copy / paste / spellcheck / look-up still work.
//
// The model.
//   - ONE provider, mounted once high in the tree (lib/providers.tsx, above every
//     route). It owns the open-menu state and the glyph state, renders ONE shared
//     menu plus the glyph via a portal-free fixed layer, and binds ONE document-
//     level `contextmenu` listener in the BUBBLE phase (so it runs AFTER any
//     element handler).
//   - useContextMenu() gives a component `openMenu(event, items)`. openMenu calls
//     preventDefault on the event (so the global fallback sees it as handled) and
//     opens the shared menu at the cursor with the given items. An empty items
//     array, or simply not calling openMenu, lets the click fall through to the
//     glyph.
//   - THE GLOBAL FALLBACK (the document listener). For a right-click that is NOT
//     already defaultPrevented (no registered handler claimed it): if the target
//     is editable text, do nothing so the native menu shows; otherwise prevent
//     default and trigger the glyph at the pointer.
//
// Voice. No em-dashes, no emojis, no mid-sentence colons (line-start labels
// fine). Inline SVG only. The glyph never intercepts clicks.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  SequenceContextMenu,
  type EditMenuItem,
} from "@/components/sequences/SequenceEditMenu";
import { NoMenuGlyph } from "./NoMenuGlyph";

/** The developer-facing API. A component calls `openMenu(event, items)` from an
 *  onContextMenu handler. The items use the shared EditMenuItem shape (label,
 *  enabled, onRun, group divider, destructive, optional color dot, optional
 *  swatch row), so any registered menu gets the editor menu's full vocabulary. */
export interface ContextMenuApi {
  /** Open the shared menu at the event's pointer with the given items. Prevents
   *  default on the event (so the global fallback treats the click as handled)
   *  and stops propagation (so an outer registered zone does not double-open).
   *  Passing an empty array opens nothing and lets the glyph take over. */
  openMenu: (
    event: { preventDefault: () => void; stopPropagation: () => void; clientX: number; clientY: number },
    items: EditMenuItem[],
  ) => void;
  /** Close the shared menu programmatically (rarely needed; dismissal is
   *  automatic on Escape / outside-click / item-run). */
  closeMenu: () => void;
}

const ContextMenuContext = createContext<ContextMenuApi | null>(null);

/** Hook for any component that wants a right-click menu. Must be used under
 *  <ContextMenuProvider> (mounted app-wide in lib/providers.tsx). */
export function useContextMenu(): ContextMenuApi {
  const ctx = useContext(ContextMenuContext);
  if (!ctx) {
    throw new Error("useContextMenu must be used within a ContextMenuProvider");
  }
  return ctx;
}

/** True when a right-click on `target` should keep the browser's native menu.
 *  Covers form fields, any contenteditable surface (so `isContentEditable` plus
 *  a defensive closest check), and the CodeMirror note editor root (whose content
 *  div is contenteditable, so the contenteditable checks already catch it; the
 *  `.cm-editor` closest is extra insurance for clicks on its gutter / chrome). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  const el = target as Element;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  // Defensive. A click on a child of an editable region (text node wrappers,
  // CodeMirror line spans) where the immediate target is not itself flagged.
  if (el.closest("[contenteditable=''], [contenteditable='true'], .cm-editor")) {
    return true;
  }
  return false;
}

interface OpenMenuState {
  items: EditMenuItem[];
  x: number;
  y: number;
}
interface GlyphState {
  x: number;
  y: number;
  key: number;
}

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<OpenMenuState | null>(null);
  const [glyph, setGlyph] = useState<GlyphState | null>(null);
  // Monotonic key so each glyph trigger restarts the CSS animation, even on
  // rapid repeat right-clicks at (nearly) the same point.
  const glyphKey = useRef(0);

  const closeMenu = useCallback(() => setMenu(null), []);

  const openMenu = useCallback<ContextMenuApi["openMenu"]>((event, items) => {
    // Prevent default so the global fallback below sees the event as handled and
    // shows neither the native menu nor the glyph. Stop propagation so an outer
    // registered zone (nested onContextMenu) does not also open.
    event.preventDefault();
    event.stopPropagation();
    // An empty list is a no-op open. The component decided there is nothing to
    // show here; do not pop an empty menu. (The click was still preventDefault-ed
    // above, so the native menu stays suppressed; nothing else fires.)
    if (!items || items.length === 0) {
      setMenu(null);
      return;
    }
    setMenu({ items, x: event.clientX, y: event.clientY });
    setGlyph(null);
  }, []);

  // THE GLOBAL FALLBACK. One document-level contextmenu listener in the BUBBLE
  // phase, so element handlers (and openMenu's preventDefault) run first.
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      // A registered handler already claimed this right-click (openMenu, or any
      // component that called preventDefault itself). Leave it alone.
      if (e.defaultPrevented) return;
      // Editable text keeps the NATIVE menu. Bail BEFORE preventing default.
      if (isEditableTarget(e.target)) return;
      // A bare, unhandled, non-text right-click. Acknowledge it with the glyph.
      e.preventDefault();
      glyphKey.current += 1;
      setGlyph({ x: e.clientX, y: e.clientY, key: glyphKey.current });
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);

  const api = useMemo<ContextMenuApi>(() => ({ openMenu, closeMenu }), [openMenu, closeMenu]);

  return (
    <ContextMenuContext.Provider value={api}>
      {children}
      {/* ONE shared cursor-anchored menu for every registered consumer. Reuses
          the editor's menu surface, so dividers, destructive styling, the leading
          color dot, the swatch row, Escape / outside-click / item-click dismissal,
          and viewport clamping all carry over unchanged. */}
      <SequenceContextMenu
        at={menu ? { x: menu.x, y: menu.y } : null}
        items={menu ? menu.items : []}
        onClose={closeMenu}
      />
      {/* The no-menu glyph. Keyed so each trigger restarts the animation. */}
      {glyph ? (
        <NoMenuGlyph
          key={glyph.key}
          x={glyph.x}
          y={glyph.y}
          onDone={() => setGlyph(null)}
        />
      ) : null}
    </ContextMenuContext.Provider>
  );
}
