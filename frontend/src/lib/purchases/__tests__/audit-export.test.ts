// Tests for the by-grant purchase audit CSV (PURCHASE_DOCS_AND_ROUTING.md 1b).

import { describe, it, expect } from "vitest";
import type { FundingAccount, PurchaseItem } from "@/lib/types";
import {
  buildPurchaseAuditCsv,
  countPurchasesMissingDocuments,
} from "../audit-export";

function item(over: Partial<PurchaseItem>): PurchaseItem {
  return {
    id: 1,
    task_id: 1,
    item_name: "Item",
    quantity: 1,
    link: null,
    cas: null,
    price_per_unit: 0,
    shipping_fees: 0,
    total_price: 0,
    notes: null,
    funding_account_id: null,
    funding_string: null,
    vendor: null,
    catalog_number: null,
    category: null,
    ...over,
  };
}

const account: FundingAccount = {
  id: 5,
  name: "Smith Lab R01",
  description: null,
  total_budget: 100000,
  award_number: "R01-ABC-123",
};

describe("buildPurchaseAuditCsv", () => {
  it("groups by grant, sorts, and lists documents with a count", () => {
    const csv = buildPurchaseAuditCsv(
      [
        item({
          id: 1,
          item_name: "Taq",
          vendor: "NEB",
          funding_account_id: 5,
          total_price: 120,
          order_status: "received",
          attachments: [
            {
              id: "a1",
              filename: "invoice.pdf",
              path: "p1",
              kind: "invoice",
              uploaded_at: "2026-06-10T00:00:00Z",
              file_size: 1,
            },
          ],
        }),
        item({
          id: 2,
          item_name: "Pipette tips",
          vendor: "Rainin",
          funding_string: "Discretionary",
          total_price: 50,
        }),
      ],
      [account],
    );

    const lines = csv.split("\n");
    expect(lines[0]).toContain("Grant");
    expect(lines[0]).toContain("Documents");
    // Discretionary sorts before Smith Lab, so Pipette tips comes first.
    expect(lines[1]).toContain("Discretionary");
    expect(lines[1]).toContain("Pipette tips");
    // The grant with an award number renders "name (award)".
    expect(lines[2]).toContain("Smith Lab R01 (R01-ABC-123)");
    expect(lines[2]).toContain("Invoice: invoice.pdf");
    // Document counts: 0 for tips, 1 for Taq.
    expect(lines[1].endsWith(",0")).toBe(true);
    expect(lines[2].endsWith(",1")).toBe(true);
  });

  it("escapes commas and quotes in cells", () => {
    const csv = buildPurchaseAuditCsv(
      [item({ item_name: 'Buffer, 10x "stock"', funding_string: "Grant A" })],
      [],
    );
    expect(csv).toContain('"Buffer, 10x ""stock"""');
  });

  it("falls back to a marker when no grant is set", () => {
    const csv = buildPurchaseAuditCsv([item({})], []);
    expect(csv).toContain("(no grant assigned)");
  });

  it("counts purchases missing documents", () => {
    expect(
      countPurchasesMissingDocuments([
        item({ id: 1, attachments: [] }),
        item({
          id: 2,
          attachments: [
            {
              id: "a",
              filename: "f.pdf",
              path: "p",
              kind: "other",
              uploaded_at: "x",
              file_size: 1,
            },
          ],
        }),
        item({ id: 3 }),
      ]),
    ).toBe(2);
  });
});
