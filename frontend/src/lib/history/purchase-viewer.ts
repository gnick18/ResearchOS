/**
 * purchase-viewer.ts
 *
 * The purchase-item EntityViewerAdapter, the structured-record analogue of
 * notesAdapter (notes-viewer.ts). The generic EntityVersionHistorySidebar
 * consumes projectBody(canonical) + summarize(before, after) to render the
 * in-place diff and the one-line per-version change label.
 *
 * A purchase item is a FLAT field map (no markdown entries), so the projection
 * is simple: parse the reconstructed canonical JSON, render the human-facing
 * fields as a stable "label: value" block (the diff BODY), and summarize a
 * change by listing which fields differ ("changed price_per_unit, vendor").
 *
 * The canonical string is produced by canonicalize() (the same function the
 * notes path uses), which already strips the volatile total_price /
 * last_edited_* stamps, so a recompute-only save projects an identical body and
 * summarizes as "no field changes".
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import type { EntityProjection, EntityViewerAdapter } from "./entity-viewer";
import type { HistoryEditKind } from "./types";

/**
 * The slice of a purchase item the viewer diffs + summarizes. `fields` is the
 * normalized human-facing field map; `body` is the rendered "label: value"
 * block the document column diffs in place.
 */
export interface PurchaseProjection extends EntityProjection {
  /** Normalized field values keyed by field name (volatile fields excluded). */
  fields: Record<string, string>;
  /** The diffable "Label: value" block (one field per line). */
  body: string;
}

/**
 * The fields we surface in the history diff + summary, in a fixed display order,
 * paired with the human label shown in the body. Identity fields (id / task_id)
 * and the volatile stamps (total_price / last_edited_*) are intentionally
 * omitted: identity never changes, and canonicalize() already strips the
 * volatile stamps before they ever reach this adapter.
 */
const DISPLAY_FIELDS: { key: string; label: string }[] = [
  { key: "item_name", label: "Item" },
  { key: "quantity", label: "Quantity" },
  { key: "price_per_unit", label: "Price per unit" },
  { key: "shipping_fees", label: "Shipping" },
  { key: "vendor", label: "Vendor" },
  { key: "category", label: "Category" },
  { key: "cas", label: "CAS" },
  { key: "link", label: "Link" },
  { key: "funding_string", label: "Funding" },
  { key: "notes", label: "Notes" },
  { key: "assigned_to", label: "Assigned to" },
  { key: "order_status", label: "Order status" },
  { key: "approved", label: "Approved" },
  { key: "approved_by", label: "Approved by" },
  { key: "declined_by", label: "Declined by" },
  { key: "flagged", label: "Flagged" },
];

/** Render any scalar / null value to a stable display string. */
function asDisplay(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") {
    // `flagged` is a small object in the live record. In the canonical it round
    // trips as an object; render a stable JSON form so a flag change diffs.
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value);
}

/**
 * Parse a reconstructed canonical state string into a PurchaseProjection.
 * Tolerant: a malformed / empty state projects to all-empty fields so the viewer
 * degrades to "no content" rather than throwing.
 */
export function projectPurchaseState(
  canonical: string | null | undefined,
): PurchaseProjection {
  const emptyFields: Record<string, string> = {};
  for (const { key } of DISPLAY_FIELDS) emptyFields[key] = "";

  if (!canonical || canonical.trim().length === 0) {
    return { fields: emptyFields, body: "" };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(canonical) as Record<string, unknown>;
  } catch {
    return { fields: emptyFields, body: "" };
  }

  const fields: Record<string, string> = {};
  for (const { key } of DISPLAY_FIELDS) {
    fields[key] = asDisplay(parsed[key]);
  }

  // The diff body is one "Label: value" line per non-empty display field, so a
  // single-field edit touches a single line and the line-diff stays localized.
  // Lines are joined with a markdown HARD break (two trailing spaces + newline)
  // rather than a bare newline: VersionDiffView renders unchanged runs through
  // ReactMarkdown, where bare single newlines soft-wrap into one run-on
  // paragraph. The hard break keeps each structured field on its own line when
  // rendered, while the line-differ (which splits on "\n") still sees one line
  // per field, so single-field edits stay localized.
  const lines: string[] = [];
  for (const { key, label } of DISPLAY_FIELDS) {
    const value = fields[key];
    if (value !== "") lines.push(`${label}: ${value}`);
  }
  const body = lines.join("  \n");

  return { fields, body };
}

/**
 * Derive a one-line change summary by comparing a version's projected fields
 * against its predecessor's. Pure (no Date.now, no engine calls).
 *
 * Summary precedence (most specific first):
 *   - restore row (kind "revert")       -> "Restored an earlier version"
 *   - undo row (kind "undo-revert")     -> "Undid a restore"
 *   - first version of the record       -> "created item"
 *   - one or more fields changed        -> "changed price_per_unit, vendor"
 *   - nothing detectable                -> "edited item"
 *
 * The restore / undo special-cases come FIRST so a restore reads as a restore in
 * the timeline rather than as a plain field edit (the same reasoning as the
 * notes adapter).
 */
export function summarizePurchaseChange(
  before: PurchaseProjection | null,
  after: PurchaseProjection,
  kind?: HistoryEditKind,
): string {
  if (kind === "revert") return "Restored an earlier version";
  if (kind === "undo-revert") return "Undid a restore";

  if (before === null) return "created item";

  const changed: string[] = [];
  for (const { key } of DISPLAY_FIELDS) {
    if ((before.fields[key] ?? "") !== (after.fields[key] ?? "")) {
      changed.push(key);
    }
  }

  if (changed.length === 0) return "edited item";
  return `changed ${changed.join(", ")}`;
}

/**
 * The purchase-item EntityViewerAdapter. Same ~adapter shape as notesAdapter:
 * projectBody + summarize, both pure wrappers over the projection above. Wired
 * into the generic EntityVersionHistorySidebar by PurchaseHistoryPopup.
 */
export const purchaseAdapter: EntityViewerAdapter<PurchaseProjection> = {
  projectBody: projectPurchaseState,
  summarize: summarizePurchaseChange,
};
