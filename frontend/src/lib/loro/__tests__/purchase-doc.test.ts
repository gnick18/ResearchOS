// Tests for the purchase-item field-map Loro model (purchase-loro chunk 1).

import { describe, it, expect } from "vitest";
import { LoroDoc } from "loro-crdt";
import type { PurchaseItem } from "@/lib/types";
import {
  seedPurchaseDoc,
  getPurchaseFields,
  setPurchaseField,
  setPurchaseFlagged,
  setPurchaseAttachments,
  applyPurchaseUpdate,
  getPurchaseMeta,
  PURCHASE_FIELDS_CONTAINER,
  PURCHASE_META_CONTAINER,
} from "../purchase-doc";

function makeItem(over: Partial<PurchaseItem> = {}): PurchaseItem {
  return {
    id: 42,
    task_id: 7,
    item_name: "Taq polymerase",
    quantity: 3,
    link: "https://vendor.example/taq",
    cas: "9012-90-2",
    price_per_unit: 120.5,
    shipping_fees: 15,
    total_price: 376.5,
    notes: "rush order",
    funding_account_id: 5,
    funding_string: "NIH R01 ABC",
    vendor: "NEB",
    catalog_number: "M0491S",
    category: "reagents",
    assigned_to: "alex",
    order_status: "needs_ordering",
    approved: true,
    approved_by: "mira",
    approved_at: "2026-06-07T10:00:00Z",
    flagged: { by: "mira", at: "2026-06-07T09:00:00Z", reason: "check funding" },
    declined_at: null,
    declined_by: null,
    last_edited_by: "alex",
    last_edited_at: "2026-06-07T11:00:00Z",
    attachments: [],
    ...over,
  };
}

function importSeed(item: PurchaseItem): LoroDoc {
  const doc = new LoroDoc();
  doc.import(seedPurchaseDoc(item));
  return doc;
}

describe("purchase-doc model", () => {
  it("round-trips a full PurchaseItem through a snapshot", () => {
    const item = makeItem();
    const doc = importSeed(item);
    expect(getPurchaseFields(doc)).toEqual(item);
  });

  it("normalizes optional/undefined fields to seeded defaults", () => {
    // A minimal record omits most optional fields.
    const minimal = { id: 1, task_id: 2, item_name: "tips" } as PurchaseItem;
    const doc = importSeed(minimal);
    const projected = getPurchaseFields(doc);
    expect(projected.id).toBe(1);
    expect(projected.task_id).toBe(2);
    expect(projected.item_name).toBe("tips");
    expect(projected.quantity).toBe(0);
    expect(projected.price_per_unit).toBe(0);
    expect(projected.link).toBeNull();
    expect(projected.approved).toBe(false);
    expect(projected.flagged).toBeNull();
    expect(projected.order_status).toBeUndefined();
    expect(projected.last_edited_by).toBeUndefined();
    expect(projected.attachments).toEqual([]);
  });

  it("stores flagged as a serialized object that round-trips", () => {
    const flag = { by: "pi", at: "2026-06-07T00:00:00Z", reason: null };
    const doc = importSeed(makeItem({ flagged: flag }));
    expect(getPurchaseFields(doc).flagged).toEqual(flag);
  });

  it("stores attachments as a serialized array that round-trips", () => {
    const attachments = [
      {
        id: "att-1",
        filename: "invoice.pdf",
        path: "users/alex/purchase_items/42/invoice.pdf",
        kind: "invoice" as const,
        uploaded_at: "2026-06-10T00:00:00Z",
        file_size: 12345,
      },
      {
        id: "att-2",
        filename: "order.pdf",
        path: "users/alex/purchase_items/42/order.pdf",
        kind: "order_form" as const,
        uploaded_at: "2026-06-10T01:00:00Z",
        file_size: 6789,
      },
    ];
    const doc = importSeed(makeItem({ attachments }));
    expect(getPurchaseFields(doc).attachments).toEqual(attachments);
  });

  it("replaces attachments via setPurchaseAttachments and applyPurchaseUpdate", () => {
    const doc = importSeed(makeItem());
    const next = [
      {
        id: "att-x",
        filename: "receipt.pdf",
        path: "users/alex/purchase_items/42/receipt.pdf",
        kind: "receipt" as const,
        uploaded_at: "2026-06-10T02:00:00Z",
        file_size: 4096,
      },
    ];
    setPurchaseAttachments(doc, next);
    doc.commit();
    expect(getPurchaseFields(doc).attachments).toEqual(next);

    // The partial-update path serializes attachments like flagged.
    applyPurchaseUpdate(doc, { attachments: [] });
    doc.commit();
    expect(getPurchaseFields(doc).attachments).toEqual([]);
  });

  it("is deterministic: two seeds of the same item are byte-equal", () => {
    const item = makeItem();
    const a = seedPurchaseDoc(item);
    const b = seedPurchaseDoc(item);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("reflects a single field update", () => {
    const doc = importSeed(makeItem());
    setPurchaseField(doc, "vendor", "Sigma");
    setPurchaseField(doc, "quantity", 9);
    doc.commit();
    const projected = getPurchaseFields(doc);
    expect(projected.vendor).toBe("Sigma");
    expect(projected.quantity).toBe(9);
  });

  it("rejects edits to immutable identity fields", () => {
    const doc = importSeed(makeItem());
    expect(() => setPurchaseField(doc, "id", 999)).toThrow(/immutable/);
    expect(() => setPurchaseField(doc, "task_id", 999)).toThrow(/immutable/);
  });

  it("setPurchaseFlagged updates and clears the flag", () => {
    const doc = importSeed(makeItem({ flagged: null }));
    const flag = { by: "pi", at: "2026-06-07T01:00:00Z" };
    setPurchaseFlagged(doc, flag);
    doc.commit();
    expect(getPurchaseFields(doc).flagged).toEqual(flag);
    setPurchaseFlagged(doc, null);
    doc.commit();
    expect(getPurchaseFields(doc).flagged).toBeNull();
  });

  it("applyPurchaseUpdate writes present fields, skips identity + undefined", () => {
    const doc = importSeed(makeItem());
    applyPurchaseUpdate(doc, {
      id: 999, // ignored (immutable)
      vendor: "Thermo",
      notes: undefined, // skipped
      approved: false,
      flagged: { by: "x", at: "y" },
    });
    doc.commit();
    const projected = getPurchaseFields(doc);
    expect(projected.id).toBe(42); // unchanged
    expect(projected.vendor).toBe("Thermo");
    expect(projected.notes).toBe("rush order"); // unchanged (undefined skipped)
    expect(projected.approved).toBe(false);
    expect(projected.flagged).toEqual({ by: "x", at: "y" });
  });

  it("concurrent edits to DIFFERENT fields merge (LWW per key)", () => {
    const item = makeItem();
    const a = importSeed(item);
    const b = importSeed(item);
    a.setPeerId(BigInt(11));
    b.setPeerId(BigInt(22));

    setPurchaseField(a, "vendor", "Sigma");
    a.commit();
    setPurchaseField(b, "quantity", 50);
    b.commit();

    // Merge both ways; both fields survive.
    a.import(b.export({ mode: "update" }));
    b.import(a.export({ mode: "update" }));

    expect(getPurchaseFields(a).vendor).toBe("Sigma");
    expect(getPurchaseFields(a).quantity).toBe(50);
    expect(getPurchaseFields(b)).toEqual(getPurchaseFields(a));
  });

  it("exposes the locked container names + empty meta", () => {
    expect(PURCHASE_FIELDS_CONTAINER).toBe("fields");
    expect(PURCHASE_META_CONTAINER).toBe("meta");
    const doc = importSeed(makeItem());
    // The seed never writes collab_doc_id (minted later on the shared context).
    expect(getPurchaseMeta(doc).get("collab_doc_id")).toBeUndefined();
  });
});
