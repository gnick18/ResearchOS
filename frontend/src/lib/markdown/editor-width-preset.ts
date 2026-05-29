// Markdown editor writing-surface width presets
// (MARKDOWN_EDITOR_TYPORA_DESIGN.md Phase 1, editor-fluid-width bot
// 2026-05-29).
//
// Grant's repeated pain point: "it is a markdown file, so why lock the
// editing space to a constant size?" The fix is a FLUID, content/viewport-
// driven measure expressed in `ch` units (text-relative, not a constant
// pixel box). Below the cap the surface is 100% fluid; above it the text
// stops growing but the surrounding surface keeps breathing. The user picks
// one of four presets in Focus Mode; the choice persists per user.
//
// This module is the SINGLE SOURCE OF TRUTH for:
//   - the legal preset values (re-exported from user-settings so the type
//     lives with the rest of the settings schema),
//   - the preset -> Tailwind measure-class mapping (full static class
//     strings so Tailwind v4's scanner sees them as literals (never build
//     a class name by string concatenation here),
//   - the synchronous localStorage read/write the editor uses for an
//     immediate first-paint width (the durable per-user record lives in
//     users/<u>/settings.json via `editorWidthPreset`).

import type { EditorWidthPreset } from "../settings/user-settings";

export type { EditorWidthPreset };

/** The default measure when the user hasn't chosen one. ~72ch centered, a
 *  comfortable prose measure (Typora's default body is in this range, and a
 *  touch wider than the original Focus Mode design's max-w-3xl because Focus
 *  Mode is the dedicated writing surface). */
export const DEFAULT_EDITOR_WIDTH_PRESET: EditorWidthPreset = "comfortable";

/** Ordered for the segmented control: narrowest measure first, Full-bleed
 *  last. */
export const EDITOR_WIDTH_PRESETS: readonly EditorWidthPreset[] = [
  "narrow",
  "comfortable",
  "wide",
  "full",
] as const;

/** Short human label for the segmented control / tooltip. */
export const EDITOR_WIDTH_PRESET_LABELS: Record<EditorWidthPreset, string> = {
  narrow: "Narrow",
  comfortable: "Comfortable",
  wide: "Wide",
  full: "Full-bleed",
};

/** One-line description surfaced in the control's tooltip. */
export const EDITOR_WIDTH_PRESET_DESCRIPTIONS: Record<EditorWidthPreset, string> = {
  narrow: "Narrow measure (~60ch)",
  comfortable: "Comfortable measure (~72ch)",
  wide: "Wide measure (~96ch)",
  full: "Full-bleed (use the available width)",
};

// The measure class for each preset. STATIC, COMPLETE class strings (no
// concatenation) so Tailwind v4 picks them up. Every preset is a centered,
// fluid column: `w-full mx-auto` keeps it 100% fluid below the cap; the
// `max-w-[Nch]` cap stops the TEXT growing past a readable line length while
// the surrounding surface keeps breathing. "full" drops the cap with an
// explicit `max-w-none` so it ALSO overrides the `prose` plugin's built-in
// ~65ch default when this class is applied to the Preview render. Without
// it, Full-bleed prose would still be capped at 65ch.
const PRESET_MEASURE_CLASS: Record<EditorWidthPreset, string> = {
  narrow: "w-full max-w-[60ch] mx-auto",
  comfortable: "w-full max-w-[72ch] mx-auto",
  wide: "w-full max-w-[96ch] mx-auto",
  full: "w-full max-w-none mx-auto",
};

/**
 * The measure (max-width + centering) class string for a preset. Used by the
 * shared measure wrapper around the block list, the preview render, and the
 * Focus Mode column.
 */
export function editorWidthMeasureClass(preset: EditorWidthPreset): string {
  return PRESET_MEASURE_CLASS[preset] ?? PRESET_MEASURE_CLASS.comfortable;
}

/** Narrow a possibly-unknown value to a legal preset, falling back to the
 *  default. Used at every read boundary (localStorage, settings, props). */
export function coerceEditorWidthPreset(
  value: unknown,
): EditorWidthPreset {
  return value === "narrow" ||
    value === "comfortable" ||
    value === "wide" ||
    value === "full"
    ? value
    : DEFAULT_EDITOR_WIDTH_PRESET;
}

// localStorage key for the synchronous first-paint read. Single key shared
// across every editor instance on this browser (the design doc's "per-editor
// preference pattern" is localStorage-based). The durable, per-account,
// cross-device record is `editorWidthPreset` in users/<u>/settings.json; this
// is the fast local mirror.
const STORAGE_KEY = "research-os-editor-width-preset";

/** Synchronously read the persisted preset from localStorage. Returns the
 *  default when unset, in a non-browser context, or on any access error
 *  (private-mode quota, disabled storage). Never throws. */
export function readStoredEditorWidthPreset(): EditorWidthPreset {
  if (typeof window === "undefined") return DEFAULT_EDITOR_WIDTH_PRESET;
  try {
    return coerceEditorWidthPreset(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_EDITOR_WIDTH_PRESET;
  }
}

/** Persist the preset to localStorage. Best-effort; swallows quota / disabled
 *  -storage errors so a width change never breaks the editor. */
export function writeStoredEditorWidthPreset(preset: EditorWidthPreset): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, preset);
  } catch {
    // private mode / disabled storage: the in-memory state still holds for
    // this session; we just lose cross-session persistence on this browser.
  }
}
