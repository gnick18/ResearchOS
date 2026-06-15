// Markdown editor focus-behavior prefs (UNIFIED_EDITOR_SURFACE_DESIGN.md §3A,
// U5 toggles). Two per-user, default-OFF writing-comfort behaviors that engage
// only at the fullscreen (expanded) scale:
//
//   - Typewriter scroll  — the active line is held at ~42% of the viewport so
//     the caret stops chasing down the page.
//   - Focus dimming      — every line except the active paragraph dims to ~30%
//     opacity, ONLY while the editor is focused (a `.writing` state); the
//     resting (unfocused) note is never washed out.
//
// This module mirrors `editor-width-preset.ts` exactly: it is the SINGLE SOURCE
// OF TRUTH for the synchronous localStorage read/write the editor uses for an
// immediate first-paint decision. The durable, per-account, cross-device record
// lives in users/<u>/settings.json (`editorTypewriterScroll` /
// `editorFocusDimming`); these localStorage keys are the fast local mirror the
// editor reads at mount without an async settings round-trip.
//
// Both default false (the design's "amber decision"): these touch the SHARED
// CM6 editor, so they must be opt-in and never alter the docked editor or the
// BeakerBotCanvas surface, which is exactly what default-off guarantees.

/** The ratio of the viewport height at which typewriter scroll pins the active
 *  line. ~42% keeps the caret a touch above center so the line you are writing
 *  sits in the natural reading zone (design §3A). */
export const TYPEWRITER_SCROLL_RATIO = 0.42;

/** The opacity non-active lines fade to while writing with focus dimming on
 *  (~30%, design §3A). Surfaced here so the CM extension and any test agree on
 *  one number. */
export const FOCUS_DIMMING_OPACITY = 0.3;

// localStorage keys for the synchronous first-paint reads. One key per behavior,
// shared across every editor instance on this browser (the design doc's
// per-editor preference pattern is localStorage-based, like spell-check's
// `ros.spellcheck.enabled`). The durable per-account records are
// `editorTypewriterScroll` / `editorFocusDimming` in users/<u>/settings.json.
const TYPEWRITER_KEY = "ros.editor.typewriter";
const DIMMING_KEY = "ros.editor.dimming";

/** Synchronously read whether typewriter scroll is enabled. Returns false (the
 *  default) when unset, in a non-browser context, or on any access error
 *  (private-mode quota, disabled storage). Never throws. */
export function readStoredTypewriterScroll(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TYPEWRITER_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist the typewriter-scroll pref to localStorage. Best-effort; swallows
 *  quota / disabled-storage errors so a toggle never breaks the editor. */
export function writeStoredTypewriterScroll(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TYPEWRITER_KEY, enabled ? "1" : "0");
  } catch {
    // private mode / disabled storage: the in-memory state still holds for this
    // session; we just lose cross-session persistence on this browser.
  }
}

/** Synchronously read whether focus dimming is enabled. Default false; never
 *  throws (see readStoredTypewriterScroll). */
export function readStoredFocusDimming(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DIMMING_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist the focus-dimming pref to localStorage. Best-effort (see
 *  writeStoredTypewriterScroll). */
export function writeStoredFocusDimming(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DIMMING_KEY, enabled ? "1" : "0");
  } catch {
    // private mode / disabled storage: in-memory state holds for this session.
  }
}
