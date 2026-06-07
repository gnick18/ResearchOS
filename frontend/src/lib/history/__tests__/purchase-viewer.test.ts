/**
 * Tests for the purchase EntityViewerAdapter (purchase-loro chunk 4).
 *
 * Covers projectBody (canonical JSON -> renderable body) and summarize
 * (field-level change label), the two methods the generic
 * EntityVersionHistorySidebar consumes.
 */

import { describe, it, expect } from "vitest";
import {
  projectPurchaseState,
  summarizePurchaseChange,
  purchaseAdapter,
} from "../purchase-viewer";

function canonicalOf(fields: Record<string, unknown>): string {
  return JSON.stringify(fields, null, 2) + "\n";
}

describe("projectPurchaseState", () => {
  it("renders a Label: value body for non-empty fields", () => {
    const canonical = canonicalOf({
      item_name: "Tris buffer",
      vendor: "Sigma",
      price_per_unit: 30,
      notes: null,
    });
    const p = projectPurchaseState(canonical);
    expect(p.body).toContain("Item: Tris buffer");
    expect(p.body).toContain("Vendor: Sigma");
    expect(p.body).toContain("Price per unit: 30");
    // null fields are omitted from the body.
    expect(p.body).not.toContain("Notes:");
    expect(p.fields.item_name).toBe("Tris buffer");
  });

  it("renders booleans and the flagged object stably", () => {
    const canonical = canonicalOf({
      approved: true,
      flagged: { reason: "over budget" },
    });
    const p = projectPurchaseState(canonical);
    expect(p.body).toContain("Approved: yes");
    expect(p.body).toContain("Flagged: {");
  });

  it("degrades to empty on malformed / empty input", () => {
    expect(projectPurchaseState("").body).toBe("");
    expect(projectPurchaseState("not json").body).toBe("");
    expect(projectPurchaseState(null).body).toBe("");
  });
});

describe("summarizePurchaseChange", () => {
  it("labels the first version created item", () => {
    const after = projectPurchaseState(canonicalOf({ item_name: "X" }));
    expect(summarizePurchaseChange(null, after)).toBe("created item");
  });

  it("lists the changed fields", () => {
    const before = projectPurchaseState(
      canonicalOf({ item_name: "X", vendor: "Sigma", price_per_unit: 30 }),
    );
    const after = projectPurchaseState(
      canonicalOf({ item_name: "X", vendor: "Fisher", price_per_unit: 42 }),
    );
    expect(summarizePurchaseChange(before, after)).toBe(
      "changed price_per_unit, vendor",
    );
  });

  it("labels a restore row distinctly via kind", () => {
    const before = projectPurchaseState(canonicalOf({ vendor: "Fisher" }));
    const after = projectPurchaseState(canonicalOf({ vendor: "Sigma" }));
    expect(summarizePurchaseChange(before, after, "revert")).toBe(
      "Restored an earlier version",
    );
  });

  it("falls back to edited item when nothing detectable changed", () => {
    const same = projectPurchaseState(canonicalOf({ vendor: "Sigma" }));
    expect(summarizePurchaseChange(same, same)).toBe("edited item");
  });
});

describe("purchaseAdapter wiring", () => {
  it("exposes projectBody + summarize", () => {
    expect(typeof purchaseAdapter.projectBody).toBe("function");
    expect(typeof purchaseAdapter.summarize).toBe("function");
  });
});
