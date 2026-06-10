// Tests for the department-routing draft builder (PURCHASE_DOCS_AND_ROUTING.md).

import { describe, it, expect } from "vitest";
import type { PurchaseItem } from "@/lib/types";
import {
  fillRoutingTemplate,
  buildMailto,
  buildDepartmentMailto,
} from "../routing";

const VARS = {
  item: "Taq polymerase",
  grant: "Smith Lab R01",
  vendor: "NEB",
  total: "$120.50",
  me: "Grant Nickles",
};

function item(over: Partial<PurchaseItem> = {}): PurchaseItem {
  return {
    id: 1,
    task_id: 1,
    item_name: "Taq polymerase",
    quantity: 1,
    link: null,
    cas: null,
    price_per_unit: 120.5,
    shipping_fees: 0,
    total_price: 120.5,
    notes: null,
    funding_account_id: null,
    funding_string: null,
    vendor: "NEB",
    catalog_number: null,
    category: null,
    ...over,
  };
}

describe("fillRoutingTemplate", () => {
  it("substitutes known placeholders and leaves unknown ones", () => {
    expect(
      fillRoutingTemplate("{item} on {grant} from {vendor}, {total} — {oops}", VARS),
    ).toBe("Taq polymerase on Smith Lab R01 from NEB, $120.50 — {oops}");
  });
});

describe("buildMailto", () => {
  it("encodes recipient, subject, and body with %20 spaces", () => {
    const url = buildMailto("hr@uni.edu", "Order for R01", "Item: Taq\nThanks");
    expect(url.startsWith("mailto:hr%40uni.edu?")).toBe(true);
    expect(url).toContain("subject=Order%20for%20R01");
    expect(url).toContain("body=Item%3A%20Taq%0AThanks");
    expect(url).not.toContain("+");
  });

  it("omits the query when there is no subject or body", () => {
    expect(buildMailto("a@b.com", "", "")).toBe("mailto:a%40b.com");
  });
});

describe("buildDepartmentMailto", () => {
  it("fills templates and produces a mailto", () => {
    const url = buildDepartmentMailto(
      "hr@uni.edu",
      item(),
      {
        subjectTemplate: "Purchase for {grant}: {item}",
        bodyTemplate: "Item: {item}\nVendor: {vendor}\nTotal: {total}\n{me}",
      },
      VARS,
    );
    expect(url).toContain("subject=Purchase%20for%20Smith%20Lab%20R01%3A%20Taq%20polymerase");
    expect(url).toContain("Vendor%3A%20NEB");
    expect(url).toContain("Grant%20Nickles");
  });
});
