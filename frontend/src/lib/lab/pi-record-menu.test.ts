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
    expect(isPiViewingMemberRecord("lab_head", "mira", "alex")).toBe(true);
  });
  it("false for a member", () => {
    expect(isPiViewingMemberRecord("member", "mira", "alex")).toBe(false);
  });
  it("false for a lab head on their OWN record", () => {
    expect(isPiViewingMemberRecord("lab_head", "mira", "mira")).toBe(false);
  });
  it("false when account type unknown / loading", () => {
    expect(isPiViewingMemberRecord(undefined, "mira", "alex")).toBe(false);
    expect(isPiViewingMemberRecord(null, "mira", "alex")).toBe(false);
  });
  it("false when no viewer or no owner", () => {
    expect(isPiViewingMemberRecord("lab_head", null, "alex")).toBe(false);
    expect(isPiViewingMemberRecord("lab_head", "mira", null)).toBe(false);
  });
});

describe("buildPiRecordMenuItems gating", () => {
  it("returns [] for a non-PI viewer", () => {
    const items = buildPiRecordMenuItems({
      recordType: "task",
      record: { owner: "alex", id: 1, flagged: false },
      viewerUsername: "mira",
      accountType: "member",
      callbacks: callbacks(),
    });
    expect(items).toEqual([]);
  });

  it("returns [] for a lab head on their OWN record", () => {
    const items = buildPiRecordMenuItems({
      recordType: "note",
      record: { owner: "mira", id: 1, flagged: false },
      viewerUsername: "mira",
      accountType: "lab_head",
      callbacks: callbacks(),
    });
    expect(items).toEqual([]);
  });
});

describe("buildPiRecordMenuItems task items", () => {
  const base = {
    recordType: "task" as const,
    viewerUsername: "mira",
    accountType: "lab_head" as const,
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
    accountType: "lab_head" as const,
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
      accountType: "lab_head",
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
      accountType: "lab_head",
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
    accountType: "lab_head" as const,
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
  it("leaves task and note unchanged (already consistent)", () => {
    expect(auditRecordTypeFor("task")).toBe("task");
    expect(auditRecordTypeFor("note")).toBe("note");
  });
});

describe("buildPiRecordMenuItems View audit trail", () => {
  const base = {
    viewerUsername: "mira",
    accountType: "lab_head" as const,
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
        accountType: "member",
        callbacks: callbacks(),
      }),
    ).toEqual([]);
    expect(
      buildPiRecordMenuItems({
        recordType: "task",
        record: { owner: "mira", id: 7, flagged: false },
        viewerUsername: "mira",
        accountType: "lab_head",
        callbacks: callbacks(),
      }),
    ).toEqual([]);
  });
});
