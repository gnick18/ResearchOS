"use client";

// datahub/bigtable/explainer-dismissal.ts
//
// Per-dataset one-time dismissal of the large-dataset explainer card (mockup
// change 1, spec section 7). The explainer shows once per dataset, then collapses
// to the quiet status chip. Dismissal is persisted in localStorage keyed by
// dataset id, so it stays dismissed across reloads without touching the data
// folder (it is a UI preference, not research data).
//
// No em-dashes, no emojis, no mid-sentence colons.

const STORAGE_KEY = "ros-datahub-bigtable-explainer-dismissed-v1";

/** Read the set of dismissed dataset ids from localStorage (best effort). */
function readDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

/** Has the explainer for this dataset already been dismissed once? */
export function isExplainerDismissed(datasetId: string): boolean {
  return readDismissed().has(datasetId);
}

/** Mark this dataset's explainer as dismissed (idempotent, best effort). */
export function dismissExplainer(datasetId: string): void {
  if (typeof window === "undefined") return;
  try {
    const set = readDismissed();
    set.add(datasetId);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // best effort; a full / blocked localStorage just re-shows the explainer
  }
}
