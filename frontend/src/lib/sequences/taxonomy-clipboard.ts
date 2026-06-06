// sequence editor master. The APP-SCOPED taxonomy clipboard store.
//
// Holds ONE copied taxonomy { organism, tax_id, tax_lineage, copiedFromName },
// SEPARATE from the OS clipboard and the molecular (bases) clipboard, so copying
// a sequence's taxonomy and pasting it onto another never involves a full
// sequence copy. It mirrors the molecular-clipboard module-singleton pattern (a
// tiny pub/sub read via useSyncExternalStore) so the Paste action enables /
// disables reactively, but ADDS localStorage persistence so a copy survives
// navigation and a page reload. SSR-safe: there is no localStorage on the
// server, so reads / writes are guarded and the server snapshot is null.
//
// Calm by convention: no emojis, no em-dashes, no mid-sentence colons in copy.

import { useSyncExternalStore } from "react";
import type { SequenceTaxonomy } from "./apply-taxonomy";

/** The copied taxonomy plus a label for the paste confirm / toast. */
export interface CopiedTaxonomy extends SequenceTaxonomy {
  /** The organism name this was copied from, shown in the paste confirm. */
  copiedFromName?: string;
}

const STORAGE_KEY = "researchos.sequences.taxonomyClipboard.v1";

let current: CopiedTaxonomy | null = null;
let hydrated = false;
const listeners = new Set<() => void>();

function hasStorage(): boolean {
  // Guarded read: on the server there is no window, and in a locked-down browser
  // accessing localStorage can throw, so treat any failure as "no storage".
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

/** Read the persisted copy on first access (lazy hydration), so a copy made in a
 *  prior visit is available after reload without a top-level side effect. */
function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  if (!hasStorage()) return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as CopiedTaxonomy;
    if (parsed && typeof parsed.organism === "string" && parsed.organism.trim()) {
      current = parsed;
    }
  } catch {
    // A corrupt / unreadable entry just leaves the clipboard empty.
  }
}

function persist(): void {
  if (!hasStorage()) return;
  try {
    if (current === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    }
  } catch {
    // A full / blocked localStorage just keeps the in-memory copy.
  }
}

function emit(): void {
  for (const l of listeners) l();
}

/** Replace the taxonomy clipboard payload (a Copy). Persists to localStorage. */
export function copyTaxonomy(tax: CopiedTaxonomy): void {
  hydrate();
  current = tax;
  persist();
  emit();
}

/** Read the current copied taxonomy (null if empty). For non-React call sites. */
export function getCopiedTaxonomy(): CopiedTaxonomy | null {
  hydrate();
  return current;
}

/** Clear the taxonomy clipboard. Persists the clear to localStorage. */
export function clearTaxonomy(): void {
  hydrate();
  if (current === null) return;
  current = null;
  persist();
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook: the current copied taxonomy plus the copy / clear actions,
 *  re-rendering on change. SSR-safe (the server snapshot is always null). */
export function useTaxonomyClipboard(): {
  copied: CopiedTaxonomy | null;
  copyTaxonomy: (tax: CopiedTaxonomy) => void;
  clearTaxonomy: () => void;
} {
  const copied = useSyncExternalStore(
    subscribe,
    getCopiedTaxonomy,
    () => null, // server snapshot — there is no clipboard during SSR
  );
  return { copied, copyTaxonomy, clearTaxonomy };
}
