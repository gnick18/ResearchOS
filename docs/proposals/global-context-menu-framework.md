# Website-wide smart right-click framework

Author: sequence editor master, 2026-06-05. Status: DESIGN DRAFT. Grant: make the
editor's smart right-click website-wide. Any right-click detects what is under the
cursor; if we registered a context menu for that thing, open it; otherwise show a
small circle-with-a-slash that fades, so it still feels responsive but signals "no
right-click menu here." Generalizes the editor's context-aware menu (feature vs
DNA).

## Decisions (Grant, 2026-06-05)

- EDITABLE TEXT keeps the browser's NATIVE right-click menu (inputs, textareas,
  contenteditable, the note editor), so copy / paste / spellcheck / look-up still
  work. Our system applies everywhere else.
- NO-MENU FEEDBACK: a small circle-with-a-slash appears at the pointer, briefly
  pulses, and fades + shrinks out in ~350ms. Subtle, acknowledges the click, gone.

## The model

A single app-level provider owns the open menu, the no-menu glyph, and one global
`contextmenu` listener. Components that want a right-click menu opt in with a hook;
everything else falls through to the glyph (or native, in text fields).

- `ContextMenuProvider` (mounted once at the app root / shell): renders ONE menu
  instance and the no-menu glyph via a portal, and binds a document-level
  `contextmenu` listener in the BUBBLE phase (so it runs AFTER any element handler).
- `useContextMenu()` -> `{ openMenu(event, items) }` (and/or a convenience
  `contextMenuProps(getItems)` returning an `onContextMenu`). A component's handler
  computes its items (it can inspect the event target to pick a variant, e.g. the
  editor's feature-vs-DNA), calls `openMenu(event, items)`, which `preventDefault`s
  and opens the shared menu at the cursor. Because it prevents default, the global
  fallback below sees the event as handled and does nothing.
- THE GLOBAL FALLBACK (the provider's document listener): for an UNHANDLED
  right-click (the event is not already `defaultPrevented`):
  - If the target is within editable text (`input`, `textarea`,
    `[contenteditable]`, or the rich editor root) -> do nothing, let the NATIVE
    menu show.
  - Otherwise -> `preventDefault()` and show the NO-MENU GLYPH at the pointer.
  So every non-text right-click is acknowledged, with our menu where registered and
  the glyph where not.

## Registration API (the developer-facing shape)

A small hook so any component can add a menu in a few lines, returning items in the
existing `EditMenuItem`-style shape (label, onRun, enabled, group divider,
destructive, an optional leading color, an optional swatch row). Example:

```
const { openMenu } = useContextMenu();
<button onContextMenu={(e) => openMenu(e, [
  { id: "rename", label: "Rename...", onRun: rename },
  { id: "delete", label: "Delete", destructive: true, onRun: del },
])}>...</button>
```

The items can be computed lazily from the event (so a single zone can branch on
what was hit, like the editor's feature-vs-DNA). Returning an empty array (or not
calling openMenu) lets the click fall through to the glyph.

## The menu component

Generalize the existing context-menu renderer (the editor's `SequenceContextMenu` /
`SequenceEditMenu` context path, or `ContextMenu.tsx`) into ONE shared cursor-
anchored menu the provider renders. It must keep the features already used by the
editor menu: dividers (`group`), destructive styling, a leading color dot
(`color`), the swatch row (`swatches`), keyboard + outside-click + Escape dismissal,
and viewport clamping so it never runs off screen.

## The no-menu glyph

A small inline-SVG circle with a diagonal bar (the universal "no" mark), rendered
fixed at the pointer via the provider, `pointer-events: none`, animated with CSS to
fade in, pulse slightly, then shrink + fade out over ~350ms, then unmount. A key
bump per trigger so rapid repeats restart the animation. Calm, low-contrast, not
alarming.

## Migration (prove it on real consumers)

- THE EDITOR smart menu (feature vs DNA, just shipped) becomes the first consumer:
  its `onContextMenu` computes the feature-or-bases items (reuse the existing
  `featureIndexFromEventTarget` + `chooseContextMenuKind`) and calls `openMenu`,
  replacing its local `contextMenuAt` + `SequenceContextMenu` instance. Same menus,
  now through the framework.
- THE LIST ROW menu (Copy / Paste taxonomy, from the taxonomy work) likewise moves
  to `openMenu`.
- Other surfaces register incrementally over time; nothing is forced. The default
  everywhere becomes "glyph on a bare right-click," which is the new baseline feel.

## Edge cases

- Native text menu: detect editable targets robustly (input/textarea/select,
  `isContentEditable`, and the note editor root) and bail BEFORE preventing default.
- A registered menu inside an editable region (rare) still works because the
  element handler runs first and prevents default; the global listener never sees
  it.
- Nested zones: the innermost element's handler wins (it runs first in bubble and
  prevents default); outer zones do not double-open.
- Touch / long-press: out of scope for v1 (desktop right-click first); the hook can
  grow a long-press later.
- The glyph must never block clicks (`pointer-events: none`) and must clean up on
  unmount / route change.

## Files (anticipated)

- ADD `components/context-menu/ContextMenuProvider.tsx` (provider + global listener
  + the menu + glyph render) and `useContextMenu()` hook, plus a `NoMenuGlyph`.
- GENERALIZE the shared menu renderer (from `SequenceEditMenu` / `ContextMenu`).
- MOUNT the provider in the app shell / root layout.
- MIGRATE the editor smart menu + the list row menu to `openMenu`.
- Tests: the editable-text bail, the handled-vs-unhandled fallback (defaultPrevented
  gating), the glyph trigger, and the editor still routing feature vs bases through
  the new openMenu.

## Risks

- OVERRIDING NATIVE RIGHT-CLICK app-wide is a real behavior change; the editable-
  text carve-out protects the common need (copy/paste while typing). If users miss
  native elsewhere, a later modifier (e.g. hold a key for native) can be added.
- Global listener correctness: it must reliably distinguish handled (a registered
  menu) from unhandled via `defaultPrevented`, and must not fight a component that
  legitimately wants native. Covered by the editable bail + the prevent-default
  contract of `openMenu`.
- Performance: one document listener, no per-element binding, so it is cheap.

## Open questions for Grant

1. The glyph on EVERY bare right-click (including page chrome, empty areas) vs only
   inside the app content. Recommend everywhere non-text, since that is the "always
   responsive" feel asked for.
2. A future escape hatch to reach the native menu where we override (e.g. hold a
   modifier). Recommend deferring until someone asks.
