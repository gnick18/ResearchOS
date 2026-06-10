// By-grant purchase audit export (PURCHASE_DOCS_AND_ROUTING.md phase 1b).
//
// Builds a CSV manifest of every purchase grouped by its funding account
// (grant), with the attached document references, so a PI can hand a grant
// auditor a complete itemized record. The actual PDF bytes are retained
// separately (locally + via the lab archive); this is the index that proves
// what was bought, on which grant, and which document backs it.
//
// Pure + unit-testable: no I/O, no React. The page wires the download.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import type { FundingAccount, PurchaseItem } from "@/lib/types";
import { attachmentKindLabel } from "./attachments";

const NO_GRANT = "(no grant assigned)";

/** Resolve a purchase's grant label: the funding account name (with award
 *  number when present), else the denormalized funding_string, else a marker. */
function grantLabelFor(
  item: PurchaseItem,
  accountsById: Map<number, FundingAccount>,
): string {
  if (item.funding_account_id != null) {
    const acct = accountsById.get(item.funding_account_id);
    if (acct) {
      return acct.award_number
        ? `${acct.name} (${acct.award_number})`
        : acct.name;
    }
  }
  return item.funding_string?.trim() || NO_GRANT;
}

/** Render a purchase's attachments as a single cell, "Invoice: a.pdf; Receipt: b.pdf". */
function documentsCell(item: PurchaseItem): string {
  const atts = item.attachments ?? [];
  if (atts.length === 0) return "";
  return atts
    .map((a) => `${attachmentKindLabel(a.kind)}: ${a.filename}`)
    .join("; ");
}

/** CSV-escape one field (wrap in quotes when it holds a comma, quote, or newline). */
function csvCell(value: string | number): string {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const HEADER = [
  "Grant",
  "Item",
  "Vendor",
  "Catalog #",
  "Quantity",
  "Unit price",
  "Shipping",
  "Total",
  "Order status",
  "Documents",
  "Document count",
];

/**
 * Build the audit CSV from all purchases + the funding accounts. Rows are sorted
 * by grant label, then by item name, so each grant's purchases are contiguous.
 * A trailing column flags how many documents back each line, so missing receipts
 * are obvious to an auditor (a 0).
 */
export function buildPurchaseAuditCsv(
  purchases: PurchaseItem[],
  fundingAccounts: FundingAccount[],
): string {
  const accountsById = new Map(fundingAccounts.map((a) => [a.id, a]));

  const rows = purchases
    .map((item) => {
      const atts = item.attachments ?? [];
      return {
        grant: grantLabelFor(item, accountsById),
        item: item.item_name,
        cells: [
          item.item_name,
          item.vendor ?? "",
          item.catalog_number ?? "",
          item.quantity,
          item.price_per_unit ?? 0,
          item.shipping_fees ?? 0,
          item.total_price ?? 0,
          item.order_status ?? "needs_ordering",
          documentsCell(item),
          atts.length,
        ],
      };
    })
    .sort(
      (a, b) =>
        a.grant.localeCompare(b.grant) || a.item.localeCompare(b.item),
    );

  const lines = [HEADER.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push([csvCell(row.grant), ...row.cells.map(csvCell)].join(","));
  }
  return lines.join("\n");
}

/** Count purchases with no document attached (the audit gap), for a summary. */
export function countPurchasesMissingDocuments(
  purchases: PurchaseItem[],
): number {
  return purchases.filter((p) => !(p.attachments?.length)).length;
}
