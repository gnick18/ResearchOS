// PI capability revamp Phase 2 (sharing + collaboration manager, 2026-06-07):
// coverage for the pure menu builder. The builder gates on PI-viewing-a-member
// and emits the right per-type items with correct flag / approval toggling,
// and each action item invokes the matching callback.

import { describe, expect, it, vi } from "vitest";
import {
  buildPiRecordMenuItems,
  isPiViewingMemberRecord,
  auditRecordTypeFor,
  type PiMenuCallbacks,
} from "./pi-record-menu";

function callbacks(overrides: Partial<PiMenuCallbacks> = {}): PiMenuCallbacks {
  return {
    onEditAsPi: vi.fn(),
    onFlag: vi.fn(),
    onClearFlag: vi.fn(),
    onAssign: vi.fn(),
    onApprove: vi.fn(),
    onDecline: vi.fn(),
    onViewAudit: vi.fn(),
    ...overrides,
  };
}

describe("isPiViewingMemberRecord", () => {
  it("true only for a lab head looking at someone else's record", () => {
    expect(isPiViewingMemberRecord(true, "mira", "alex")).toBe(true);
  });
  it("false for a member", () => {
    expect(isPiViewingMemberRecord(false, "mira", "alex")).toBe(false);
  });
  it("false for a lab head on their OWN record", () => {
    expect(isPiViewingMemberRecord(true, "mira", "mira")).toBe(false);
  });
  it("false when lab-head state unknown / loading", () => {
    expect(isPiViewingMemberRecord(undefined, "mira", "alex")).toBe(false);
    expect(isPiViewingMemberRecord(null, "mira", "alex")).toBe(false);
  });
  it("false when no viewer or no owner", () => {
    expect(isPiViewingMemberRecord(true, null, "alex")).toBe(false);
    expect(isPiViewingMemberRecord(true, "mira", null)).toBe(false);
  });
});

describe("buildPiRecordMenuItems gating", () => {
  it("returns [] for a non-PI viewer", () => {
    const items = buildPiRecordMenuItems({
      recordType: "task",
      record: { owner: "alex", id: 1, flagged: false },
      viewerUsername: "mira",
      isLabHead: false,
      callbacks: callbacks(),
    });
    expect(items).toEqual([]);
  });

  it("returns [] for a lab head on their OWN record", () => {
    const items = buildPiRecordMenuItems({
      recordType: "note",
      record: { owner: "mira", id: 1, flagged: false },
      viewerUsername: "mira",
      isLabHead: true,
      callbacks: callbacks(),
    });
    expect(items).toEqual([]);
  });
});

describe("buildPiRecordMenuItems task items", () => {
  const base = {
    recordType: "task" as const,
    viewerUsername: "mira",
    isLabHead: true,
  };

  it("emits edit + flag + assign when unflagged", () => {
    const items = buildPiRecordMenuItems({
      ...base,
      record: { owner: "alex", id: 7, flagged: false },
      callbacks: callbacks(),
    });
    expect(items.map((i) => i.id)).toEqual([
      "pi-edit-as-lab-head",
      "pi-flag-for-review",
      "pi-assign-to-member",
      "pi-view-audit-trail",
    ]);
  });

  it("shows Clear flag instead of Flag when already flagged", () => {
    const items = buildPiRecordMenuItems({
      ...base,
      record: { owner: "alex", id: 7, flagged: true },
      callbacks: callbacks(),
    });
    expect(items.map((i) => i.id)).toContain("pi-clear-flag");
    expect(items.map((i) => i.id)).not.toContain("pi-flag-for-review");
  });

  it("runs onAssign when the assign item is invoked", () => {
    const cbs = callbacks();
    const items = buildPiRecordMenuItems({
      ...base,
      record: { owner: "alex", id: 7, flagged: false },
      callbacks: cbs,
    });
    items.find((i) => i.id === "pi-assign-to-member")!.onRun();
    expect(cbs.onAssign).toHaveBeenCalledOnce();
  });

  it("runs onFlag / onClearFlag / onEditAsPi from the right items", () => {
    const cbs = callbacks();
    const unflagged = buildPiRecordMenuItems({
      ...base,
      record: { owner: "alex", id: 7, flagged: false },
      callbacks: cbs,
    });
    unflagged.find((i) => i.id === "pi-edit-as-lab-head")!.onRun();
    unflagged.find((i) => i.id === "pi-flag-for-review")!.onRun();
    expect(cbs.onEditAsPi).toHaveBeenCalledOnce();
    expect(cbs.onFlag).toHaveBeenCalledOnce();

    const flagged = buildPiRecordMenuItems({
      ...base,
      record: { owner: "alex", id: 7, flagged: true },
      callbacks: cbs,
    });
    flagged.find((i) => i.id === "pi-clear-flag")!.onRun();
    expect(cbs.onClearFlag).toHaveBeenCalledOnce();
  });
});

describe("buildPiRecordMenuItems includeEditAsPi", () => {
  const base = {
    recordType: "task" as const,
    viewerUsername: "mira",
    isLabHead: true,
    record: { owner: "alex", id: 7, flagged: false },
  };

  it("includes Edit as lab head by default (Pass 1 list rows unchanged)", () => {
    const items = buildPiRecordMenuItems({ ...base, callbacks: callbacks() });
    expect(items.map((i) => i.id)).toContain("pi-edit-as-lab-head");
  });

  it("drops Edit as lab head when includeEditAsPi is false but keeps the rest", () => {
    const items = buildPiRecordMenuItems({
      ...base,
      includeEditAsPi: false,
      callbacks: callbacks(),
    });
    const ids = items.map((i) => i.id);
    expect(ids).not.toContain("pi-edit-as-lab-head");
    // The role actions remain (flag toggle + task assign), then View audit.
    expect(ids).toEqual([
      "pi-flag-for-review",
      "pi-assign-to-member",
      "pi-view-audit-trail",
    ]);
  });

  it("includeEditAsPi=false on a purchase keeps flag + approve/decline only", () => {
    const items = buildPiRecordMenuItems({
      recordType: "purchase",
      viewerUsername: "mira",
      isLabHead: true,
      record: { owner: "alex", id: 5, flagged: false, approved: false },
      includeEditAsPi: false,
      callbacks: callbacks(),
    });
    const ids = items.map((i) => i.id);
    expect(ids).not.toContain("pi-edit-as-lab-head");
    expect(ids).toContain("pi-flag-for-review");
    expect(ids).toContain("pi-approve-purchase");
    expect(ids).toContain("pi-decline-purchase");
  });
});

describe("buildPiRecordMenuItems note items", () => {
  it("emits edit + flag + view-audit only (no assign / approve / decline)", () => {
    const items = buildPiRecordMenuItems({
      recordType: "note",
      record: { owner: "alex", id: 3, flagged: false },
      viewerUsername: "mira",
      isLabHead: true,
      callbacks: callbacks(),
    });
    expect(items.map((i) => i.id)).toEqual([
      "pi-edit-as-lab-head",
      "pi-flag-for-review",
      "pi-view-audit-trail",
    ]);
  });
});

describe("buildPiRecordMenuItems purchase items", () => {
  const base = {
    recordType: "purchase" as const,
    viewerUsername: "mira",
    isLabHead: true,
  };

  it("shows Approve + Decline when pending", () => {
    const items = buildPiRecordMenuItems({
      ...base,
      record: { owner: "alex", id: 5, flagged: false, approved: false },
      callbacks: callbacks(),
    });
    const ids = items.map((i) => i.id);
    expect(ids).toContain("pi-approve-purchase");
    expect(ids).toContain("pi-decline-purchase");
  });

  it("hides Approve when already approved (only Decline remains)", () => {
    const items = buildPiRecordMenuItems({
      ...base,
      record: { owner: "alex", id: 5, flagged: false, approved: true },
      callbacks: callbacks(),
    });
    const ids = items.map((i) => i.id);
    expect(ids).not.toContain("pi-approve-purchase");
    expect(ids).toContain("pi-decline-purchase");
  });

  it("decline is styled destructive", () => {
    const items = buildPiRecordMenuItems({
      ...base,
      record: { owner: "alex", id: 5, flagged: false, approved: false },
      callbacks: callbacks(),
    });
    expect(items.find((i) => i.id === "pi-decline-purchase")!.destructive).toBe(true);
  });

  it("runs onApprove / onDecline from the right items", () => {
    const cbs = callbacks();
    const items = buildPiRecordMenuItems({
      ...base,
      record: { owner: "alex", id: 5, flagged: false, approved: false },
      callbacks: cbs,
    });
    items.find((i) => i.id === "pi-approve-purchase")!.onRun();
    items.find((i) => i.id === "pi-decline-purchase")!.onRun();
    expect(cbs.onApprove).toHaveBeenCalledOnce();
    expect(cbs.onDecline).toHaveBeenCalledOnce();
  });
});

describe("auditRecordTypeFor", () => {
  it("maps purchase to the audit record_type purchase_item", () => {
    expect(auditRecordTypeFor("purchase")).toBe("purchase_item");
  });
  it("maps inventory_item to purchase_item (its linked line's history)", () => {
    expect(auditRecordTypeFor("inventory_item")).toBe("purchase_item");
  });
  it("leaves task and note unchanged (already consistent)", () => {
    expect(auditRecordTypeFor("task")).toBe("task");
    expect(auditRecordTypeFor("note")).toBe("note");
  });
});

// ── inventory_item (Supplies v2 chunk 6) ─────────────────────────────────────

describe("buildPiRecordMenuItems inventory_item (Supply row)", () => {
  function supplyCallbacks(
    overrides: Partial<PiMenuCallbacks> = {},
  ): PiMenuCallbacks {
    return {
      onEditAsPi: vi.fn(),
      onFlag: vi.fn(),
      onClearFlag: vi.fn(),
      onApprove: vi.fn(),
      onDecline: vi.fn(),
      onViewAudit: vi.fn(),
      onReorder: vi.fn(),
      onEditItem: vi.fn(),
      onSetStatus: vi.fn(),
      ...overrides,
    };
  }

  it("a member on their own editable supply gets reorder + edit + set-status only", () => {
    const items = buildPiRecordMenuItems({
      recordType: "inventory_item",
      record: { owner: "alex", id: 1, flagged: false, canEdit: true, linkedPurchase: null },
      viewerUsername: "alex",
      isLabHead: false,
      callbacks: supplyCallbacks(),
    });
    expect(items.map((i) => i.id)).toEqual([
      "supply-reorder",
      "supply-edit-item",
      "supply-set-status",
    ]);
  });

  it("a non-editable supply offers only reorder", () => {
    const items = buildPiRecordMenuItems({
      recordType: "inventory_item",
      record: { owner: "alex", id: 1, flagged: false, canEdit: false, linkedPurchase: null },
      viewerUsername: "alex",
      isLabHead: false,
      callbacks: supplyCallbacks(),
    });
    expect(items.map((i) => i.id)).toEqual(["supply-reorder"]);
  });

  it("a lab head viewing a member-owned supply with a pending line gets the full set", () => {
    const items = buildPiRecordMenuItems({
      recordType: "inventory_item",
      record: {
        owner: "alex",
        id: 1,
        flagged: false,
        canEdit: true,
        linkedPurchase: { owner: "alex", id: 7, approved: false, flagged: false },
      },
      viewerUsername: "mira",
      isLabHead: true,
      callbacks: supplyCallbacks(),
    });
    expect(items.map((i) => i.id)).toEqual([
      "supply-reorder",
      "supply-edit-item",
      "supply-set-status",
      "supply-approve-line",
      "supply-decline-line",
      "supply-flag-line",
      "supply-view-audit-trail",
    ]);
    expect(items.find((i) => i.id === "supply-decline-line")!.destructive).toBe(true);
  });

  it("hides Approve when the linked line is already approved", () => {
    const items = buildPiRecordMenuItems({
      recordType: "inventory_item",
      record: {
        owner: "alex",
        id: 1,
        flagged: false,
        canEdit: false,
        linkedPurchase: { owner: "alex", id: 7, approved: true, flagged: false },
      },
      viewerUsername: "mira",
      isLabHead: true,
      callbacks: supplyCallbacks(),
    });
    const ids = items.map((i) => i.id);
    expect(ids).not.toContain("supply-approve-line");
    expect(ids).toContain("supply-decline-line");
  });

  it("shows Clear flag instead of Flag when the linked line is flagged", () => {
    const items = buildPiRecordMenuItems({
      recordType: "inventory_item",
      record: {
        owner: "alex",
        id: 1,
        flagged: false,
        canEdit: false,
        linkedPurchase: { owner: "alex", id: 7, approved: false, flagged: true },
      },
      viewerUsername: "mira",
      isLabHead: true,
      callbacks: supplyCallbacks(),
    });
    const ids = items.map((i) => i.id);
    expect(ids).toContain("supply-clear-flag");
    expect(ids).not.toContain("supply-flag-line");
  });

  it("a lab head on their OWN linked line gets no PI layer (only the universal rows)", () => {
    const items = buildPiRecordMenuItems({
      recordType: "inventory_item",
      record: {
        owner: "mira",
        id: 1,
        flagged: false,
        canEdit: true,
        linkedPurchase: { owner: "mira", id: 7, approved: false, flagged: false },
      },
      viewerUsername: "mira",
      isLabHead: true,
      callbacks: supplyCallbacks(),
    });
    expect(items.map((i) => i.id)).toEqual([
      "supply-reorder",
      "supply-edit-item",
      "supply-set-status",
    ]);
  });

  it("omits the PI layer when there is no linked line (on-hand-only member supply)", () => {
    const items = buildPiRecordMenuItems({
      recordType: "inventory_item",
      record: { owner: "alex", id: 1, flagged: false, canEdit: false, linkedPurchase: null },
      viewerUsername: "mira",
      isLabHead: true,
      callbacks: supplyCallbacks(),
    });
    expect(items.map((i) => i.id)).toEqual(["supply-reorder"]);
  });

  it("runs the universal + PI callbacks from the right items", () => {
    const cbs = supplyCallbacks();
    const items = buildPiRecordMenuItems({
      recordType: "inventory_item",
      record: {
        owner: "alex",
        id: 1,
        flagged: false,
        canEdit: true,
        linkedPurchase: { owner: "alex", id: 7, approved: false, flagged: false },
      },
      viewerUsername: "mira",
      isLabHead: true,
      callbacks: cbs,
    });
    items.find((i) => i.id === "supply-reorder")!.onRun();
    items.find((i) => i.id === "supply-edit-item")!.onRun();
    items.find((i) => i.id === "supply-set-status")!.onRun();
    items.find((i) => i.id === "supply-approve-line")!.onRun();
    items.find((i) => i.id === "supply-decline-line")!.onRun();
    items.find((i) => i.id === "supply-flag-line")!.onRun();
    items.find((i) => i.id === "supply-view-audit-trail")!.onRun();
    expect(cbs.onReorder).toHaveBeenCalledOnce();
    expect(cbs.onEditItem).toHaveBeenCalledOnce();
    expect(cbs.onSetStatus).toHaveBeenCalledOnce();
    expect(cbs.onApprove).toHaveBeenCalledOnce();
    expect(cbs.onDecline).toHaveBeenCalledOnce();
    expect(cbs.onFlag).toHaveBeenCalledOnce();
    expect(cbs.onViewAudit).toHaveBeenCalledOnce();
  });

  it("omits reorder when no onReorder is supplied (already in cart)", () => {
    const items = buildPiRecordMenuItems({
      recordType: "inventory_item",
      record: { owner: "alex", id: 1, flagged: false, canEdit: true, linkedPurchase: null },
      viewerUsername: "alex",
      isLabHead: false,
      callbacks: supplyCallbacks({ onReorder: undefined }),
    });
    expect(items.map((i) => i.id)).not.toContain("supply-reorder");
  });
});

describe("buildPiRecordMenuItems View audit trail", () => {
  const base = {
    viewerUsername: "mira",
    isLabHead: true,
  };

  it("appends View audit trail last, in its own group, when onViewAudit is supplied", () => {
    const items = buildPiRecordMenuItems({
      ...base,
      recordType: "task",
      record: { owner: "alex", id: 7, flagged: false },
      callbacks: callbacks(),
    });
    const last = items[items.length - 1];
    expect(last.id).toBe("pi-view-audit-trail");
    expect(last.label).toBe("View audit trail");
    expect(last.group).toBe(true);
  });

  it("is offered for a note (independent of the per-type role actions)", () => {
    const items = buildPiRecordMenuItems({
      ...base,
      recordType: "note",
      record: { owner: "alex", id: 3, flagged: false },
      callbacks: callbacks(),
    });
    expect(items.map((i) => i.id)).toContain("pi-view-audit-trail");
  });

  it("is offered even with includeEditAsPi false (popup-header kebab)", () => {
    const items = buildPiRecordMenuItems({
      ...base,
      recordType: "purchase",
      record: { owner: "alex", id: 5, flagged: false, approved: false },
      includeEditAsPi: false,
      callbacks: callbacks(),
    });
    expect(items.map((i) => i.id)).toContain("pi-view-audit-trail");
  });

  it("runs onViewAudit when the item is invoked", () => {
    const cbs = callbacks();
    const items = buildPiRecordMenuItems({
      ...base,
      recordType: "task",
      record: { owner: "alex", id: 7, flagged: false },
      callbacks: cbs,
    });
    items.find((i) => i.id === "pi-view-audit-trail")!.onRun();
    expect(cbs.onViewAudit).toHaveBeenCalledOnce();
  });

  it("is omitted when onViewAudit is not supplied", () => {
    const items = buildPiRecordMenuItems({
      ...base,
      recordType: "task",
      record: { owner: "alex", id: 7, flagged: false },
      callbacks: callbacks({ onViewAudit: undefined }),
    });
    expect(items.map((i) => i.id)).not.toContain("pi-view-audit-trail");
  });

  it("is omitted for a non-PI / own record (whole menu is empty)", () => {
    expect(
      buildPiRecordMenuItems({
        recordType: "task",
        record: { owner: "alex", id: 7, flagged: false },
        viewerUsername: "mira",
        isLabHead: false,
        callbacks: callbacks(),
      }),
    ).toEqual([]);
    expect(
      buildPiRecordMenuItems({
        recordType: "task",
        record: { owner: "mira", id: 7, flagged: false },
        viewerUsername: "mira",
        isLabHead: true,
        callbacks: callbacks(),
      }),
    ).toEqual([]);
  });
});
