// datahub/bigtable/view-mode-pref.ts
//
// Per-table localStorage preference for which view mode to restore when a table
// is reopened after navigation (part of the large-dataset lane, DataHub-largetables
// lane). When an editable table is converted to a dataset, the page remembers
// that the user was last looking at the dataset view and restores it on nav-back.
// Switching back to the editable grid clears the preference so the grid reopens
// next time.
//
// Storage shapes:
//   ros-datahub-view-mode-v1  ->  Record<compositeKey, "editable" | "dataset">
//   ros-datahub-table-dataset-v1 -> Record<compositeKey, datasetId>
//
// Keys are scoped to owner+tableId so two users on the same browser never share a
// preference, and the preference is independent of the dataset id (which may differ
// between folders).
//
// No em-dashes, no emojis, no mid-sentence colons.

export type ViewMode = "editable" | "dataset";

const MODE_KEY = "ros-datahub-view-mode-v1";
const LINK_KEY = "ros-datahub-table-dataset-v1";

function compositeKey(owner: string, tableId: string): string {
  return `${owner}:${tableId}`;
}

// ---------------------------------------------------------------------------
// View mode preference
// ---------------------------------------------------------------------------

function readModeMap(): Record<string, ViewMode> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MODE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, ViewMode>) : {};
  } catch {
    return {};
  }
}

function writeModeMap(map: Record<string, ViewMode>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MODE_KEY, JSON.stringify(map));
  } catch {
    // best effort; a full / blocked localStorage just re-defaults to editable
  }
}

/**
 * Read the last-viewed mode for this owner+table. Returns null when no preference
 * has been stored (caller should default to "editable").
 */
export function getViewModePref(owner: string, tableId: string): ViewMode | null {
  const map = readModeMap();
  return map[compositeKey(owner, tableId)] ?? null;
}

/**
 * Persist the view mode for this owner+table (idempotent, best effort).
 * Call with "dataset" when the user converts or opens the dataset view.
 * Call with "editable" when the user explicitly switches back to the editable grid.
 */
export function setViewModePref(owner: string, tableId: string, mode: ViewMode): void {
  const map = readModeMap();
  map[compositeKey(owner, tableId)] = mode;
  writeModeMap(map);
}

// ---------------------------------------------------------------------------
// Table -> dataset link
// ---------------------------------------------------------------------------

function readLinkMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LINK_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeLinkMap(map: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LINK_KEY, JSON.stringify(map));
  } catch {
    // best effort
  }
}

/**
 * Read which datasetId was produced when this editable table was converted.
 * Returns null when the table has not been converted in this browser session.
 */
export function getLinkedDatasetId(owner: string, tableId: string): string | null {
  return readLinkMap()[compositeKey(owner, tableId)] ?? null;
}

/**
 * Record that converting `tableId` produced `datasetId` for this owner.
 * Called immediately after the ingest completes so nav-back can restore the link.
 */
export function setLinkedDatasetId(
  owner: string,
  tableId: string,
  datasetId: string,
): void {
  const map = readLinkMap();
  map[compositeKey(owner, tableId)] = datasetId;
  writeLinkMap(map);
}
