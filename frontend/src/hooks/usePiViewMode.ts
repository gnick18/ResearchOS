"use client";

// PI view mode (NAV-1/2/3): a lab head defaults to the lab-wide lens and can
// flip to "My work" (their personal researcher view) and back. The mode is
// remembered per device (localStorage), not synced, so it is a pure UI
// preference with no data-shape change. Only meaningful for a lab head; a member
// is always in their own researcher view.
//
// Reactive via useSyncExternalStore so the header toggle and the nav re-render
// together the instant the mode flips. The `storage` event keeps two tabs in
// sync.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useSyncExternalStore } from "react";

export type PiViewMode = "lab" | "my-work";

const STORAGE_KEY = "researchos:pi-view-mode";
const listeners = new Set<() => void>();

/** Read the persisted mode, defaulting to the lab lens. Never throws. */
export function getPiViewMode(): PiViewMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === "my-work" ? "my-work" : "lab";
  } catch {
    return "lab";
  }
}

/** Persist the mode and notify every subscriber (this tab) + other tabs. */
export function setPiViewMode(mode: PiViewMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Private mode / storage disabled: the in-memory listeners still fire so the
    // current tab updates; it just will not persist across reloads.
  }
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (typeof window !== "undefined") window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined") window.removeEventListener("storage", cb);
  };
}

/**
 * The current PI view mode + a setter. SSR / first paint resolves to "lab" (the
 * default lens) so the server and client agree before hydration.
 */
export function usePiViewMode(): {
  mode: PiViewMode;
  setMode: (mode: PiViewMode) => void;
} {
  const mode = useSyncExternalStore(
    subscribe,
    getPiViewMode,
    () => "lab" as PiViewMode,
  );
  return { mode, setMode: setPiViewMode };
}
