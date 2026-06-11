// user-palettes.ts
//
// Persistence for a researcher's own saved palettes (generated, imported from
// Coolors, or hand-built). Data Hub stores the FIGURE's palette id + overrides
// in the versioned doc, but a personal palette is a user preference that should
// follow the person across every figure and project, so it lives in
// localStorage rather than in any one document. The why: a lab's house palette
// is reused across many figures, and baking it into one doc would not share it.
//
// Browser-only and defensively guarded so the module imports under jsdom / SSR
// without throwing. No em-dashes, no emojis, no mid-sentence colons.

import type { Palette } from "@/lib/datahub/palettes";

const STORAGE_KEY = "datahub-user-palettes";

/** True when localStorage is reachable (a real browser, not SSR / a locked-down iframe). */
function storageAvailable(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

/** A stored palette is a normal Palette; we only persist user-created ones. */
function isPalette(v: unknown): v is Palette {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    Array.isArray(p.colors) &&
    p.colors.every((c) => typeof c === "string")
  );
}

/** Load the user's saved palettes, or an empty list when none / unavailable. */
export function loadUserPalettes(): Palette[] {
  if (!storageAvailable()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPalette);
  } catch {
    return [];
  }
}

/** Persist the full list of user palettes (replaces the stored set). */
export function saveUserPalettes(palettes: Palette[]): void {
  if (!storageAvailable()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(palettes));
  } catch {
    // A quota / privacy-mode failure is non-fatal; the palette still applies to
    // the open figure this session, it just is not remembered.
  }
}

/** A short stable id for a new personal palette (timestamp + random suffix). */
export function newUserPaletteId(): string {
  const rand = Math.random().toString(36).slice(2, 7);
  return `user-${Date.now().toString(36)}-${rand}`;
}

/** Add a palette to the saved set and return the new full list. */
export function addUserPalette(palette: Palette): Palette[] {
  const next = [...loadUserPalettes().filter((p) => p.id !== palette.id), palette];
  saveUserPalettes(next);
  return next;
}

/** Remove a saved palette by id and return the new full list. */
export function removeUserPalette(id: string): Palette[] {
  const next = loadUserPalettes().filter((p) => p.id !== id);
  saveUserPalettes(next);
  return next;
}

/** Rename a saved palette by id and return the new full list. */
export function renameUserPalette(id: string, name: string): Palette[] {
  const next = loadUserPalettes().map((p) =>
    p.id === id ? { ...p, name } : p,
  );
  saveUserPalettes(next);
  return next;
}
