// sequence Phase 2b bot — the APP-SCOPED molecular clipboard store.
//
// The molecular clip lives at MODULE scope (a tiny pub/sub singleton), NOT in a
// document or per-view state, so a copy in one open sequence survives switching
// to another open sequence and pasting there (the cross-document requirement).
// It is purely in-memory: it is NOT persisted to disk and NOT shared across
// browser tabs (cross-tab annotated paste is the deferred stretch). Plain-text
// interop with other tools goes through the OS clipboard separately.
//
// React reads it via the `useMolecularClipboard` hook (useSyncExternalStore), so
// the Paste button enables/disables reactively when a clip lands or is cleared.

import { useSyncExternalStore } from "react";
import type { MolecularClip } from "./clipboard";

let current: MolecularClip | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Replace the molecular clipboard payload (a Copy/Cut). */
export function setMolecularClip(clip: MolecularClip): void {
  current = clip;
  emit();
}

/** Read the current payload (null if empty). For non-React call sites. */
export function getMolecularClip(): MolecularClip | null {
  return current;
}

/** Clear the molecular clipboard. */
export function clearMolecularClip(): void {
  if (current === null) return;
  current = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook: the current molecular clip, re-rendering on change. */
export function useMolecularClipboard(): MolecularClip | null {
  return useSyncExternalStore(
    subscribe,
    getMolecularClip,
    () => null, // server snapshot — there is no clipboard during SSR
  );
}
