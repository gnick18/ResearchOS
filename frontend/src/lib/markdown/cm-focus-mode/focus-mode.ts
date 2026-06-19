// CodeMirror 6 focus-behavior extensions (UNIFIED_EDITOR_SURFACE_DESIGN.md §3A,
// U5 toggles). Two self-contained, opt-in, fullscreen-only writing behaviors:
//
//   - typewriterScrollExtension() — on a caret move / doc edit, scrolls so the
//     active line sits at ~42% of the viewport height. Respects
//     prefers-reduced-motion (no forced smooth behavior). Engages on edit /
//     caret-move only, NOT on passive scroll, so reading away from the caret is
//     never yanked back.
//   - focusDimmingExtension() — dims every line except the active paragraph to
//     ~30% opacity via a CSS class, applied ONLY while the editor has focus.
//     On blur every decoration is dropped so the resting note is full-contrast.
//
// This module is imported DYNAMICALLY by InlineMarkdownEditor (alongside the
// spellcheck chunk) so it never lands in the main bundle. Both extensions are
// added behind a per-user pref AND the fullscreen gate (the InlineMarkdownEditor
// reconfigure compartment), so the docked editor / BeakerBotCanvas are unchanged
// when the prefs are off (the default).

import { RangeSetBuilder } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  TYPEWRITER_SCROLL_RATIO,
  FOCUS_DIMMING_OPACITY,
} from "../editor-focus-prefs";

/** Whether the OS has reduced-motion requested. Read at scroll time (not cached)
 *  so a mid-session preference flip is honored. Safe in non-browser contexts. */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Typewriter scroll: keep the active line at ~42% of the viewport.
 *
 * We only act when the selection's head MOVED or the document changed (an edit /
 * caret move), never on a passive `update.viewportChanged` from the user
 * scrolling away to read. That keeps the behavior from fighting manual scroll.
 *
 * The scroll is done with `view.dispatch({ effects: scrollIntoView(...) })`
 * using a yMargin that pushes the line to the target ratio. We compute the
 * margin from the scroller height so the line lands near 42% regardless of
 * viewport size. Reduced-motion: CM6 scrollIntoView itself does not animate, so
 * there is nothing to suppress in the dispatch; the guard exists so that if a
 * future smooth path is added it stays opt-out, and we keep the behavior
 * jump-cut (instant) which is what reduced-motion users expect.
 */
export function typewriterScrollExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      private lastHead = -1;
      private frame = 0;
      private readonly view: EditorView;

      constructor(view: EditorView) {
        this.view = view;
        this.lastHead = view.state.selection.main.head;
      }

      update(update: ViewUpdate) {
        const head = update.state.selection.main.head;
        const headMoved = head !== this.lastHead;
        this.lastHead = head;

        // Engage on a real edit or caret move only. A pure viewport change
        // (manual scroll) with no doc/selection change is left alone so reading
        // away from the caret is never snapped back.
        if (!update.docChanged && !headMoved) return;
        // Selection-set events that are not from the user (e.g. a programmatic
        // reconcile dispatch) still carry a head move; that is fine, we re-pin
        // the line on any genuine caret relocation.

        // CRITICAL: do NOT scroll synchronously here, and do NOT dispatch from a
        // requestMeasure callback. CM6 runs measure callbacks inside the update/
        // layout cycle, so calling view.dispatch() from one re-enters the update
        // and throws "Calls to EditorView.update are not allowed while an update
        // is in progress" (hit by clicking into the editor mid-update). Instead
        // defer the scroll to the next animation frame, which runs AFTER the
        // current update + layout settle, so the geometry is still correct.
        this.scheduleScroll();
      }

      private scheduleScroll() {
        if (this.frame) return; // already queued for this frame; coalesce edits
        this.frame = requestAnimationFrame(() => {
          this.frame = 0;
          const view = this.view;
          const scrollerHeight = view.scrollDOM.clientHeight;
          if (scrollerHeight <= 0) return;
          const head = view.state.selection.main.head;
          // Place the active line at TYPEWRITER_SCROLL_RATIO from the top: a top
          // margin of ratio*height keeps that much space above the line.
          const yMargin = Math.max(
            0,
            Math.round(scrollerHeight * TYPEWRITER_SCROLL_RATIO),
          );
          const reduced = prefersReducedMotion();
          view.dispatch({
            effects: EditorView.scrollIntoView(head, { y: "start", yMargin }),
            // No animation flag is set; CM6 scrollIntoView is an instant jump,
            // the correct (non-motion) behavior for reduced-motion users and
            // acceptable for everyone (the line just "stays put").
            scrollIntoView: false,
          });
          void reduced; // explicit: instant scroll already honors reduced-motion
        });
      }

      destroy() {
        // Cancel a pending scroll so we never dispatch into a destroyed view.
        if (this.frame) cancelAnimationFrame(this.frame);
      }
    },
  );
}

// ── Focus dimming ───────────────────────────────────────────────────────────

/** The dim line decoration. The opacity itself lives in globals.css
 *  (`.cm-ros-dimmed`) so the value is themeable and the decoration only carries
 *  a class (CM6 cannot inline a CSS var into a decoration attribute cleanly). */
const dimDecoration = Decoration.line({ class: "cm-ros-dimmed" });

/**
 * Build the dim decoration set for the current state: every LINE that does not
 * contain the selection head gets `.cm-ros-dimmed`. Only the active paragraph
 * (the line under the caret) stays full-contrast. We dim by line, which reads as
 * paragraph-level dimming for normal prose (blank lines separate paragraphs and
 * are themselves dimmed, which is invisible since they have no glyphs).
 */
function buildDimDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const head = view.state.selection.main.head;
  const activeLineFrom = view.state.doc.lineAt(head).from;
  // Only decorate visible ranges (CM6 best practice) so a long doc stays cheap.
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      if (line.from !== activeLineFrom) {
        builder.add(line.from, line.from, dimDecoration);
      }
      if (line.to + 1 > pos) {
        pos = line.to + 1;
      } else {
        break;
      }
    }
  }
  return builder.finish();
}

/**
 * Focus dimming: fade non-active lines to ~30% while the editor is FOCUSED.
 *
 * The decorations are produced only when `view.hasFocus` is true. On blur the
 * plugin clears the set (Decoration.none), so the resting / unfocused note is
 * always full-contrast — it must NEVER wash out a note the user is just reading.
 * We recompute on doc change, selection change, viewport change, and on focus /
 * blur (focusChanged), which keeps the active paragraph current as the caret
 * moves and tears the effect down the instant focus leaves.
 */
export function focusDimmingExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = view.hasFocus
          ? buildDimDecorations(view)
          : Decoration.none;
      }

      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          update.focusChanged
        ) {
          this.decorations = update.view.hasFocus
            ? buildDimDecorations(update.view)
            : Decoration.none;
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
}

// Re-export the dimming opacity so a consumer / test can assert the CSS rule and
// the JS agree on one number.
export { FOCUS_DIMMING_OPACITY };
