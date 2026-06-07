// PI capability revamp Phase 2 (sharing + collaboration manager, 2026-06-07):
// coverage for the pure menu builder. The builder gates on PI-viewing-a-member
// and emits the right per-type items with correct flag / approval toggling,
// and each action item invokes the matching callback.

import { describe, expect, it, vi } from "vitest";
import {
  buildPiRecordMenuItems,
  isPiViewingMemberRecord,
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

describe("buildPiRecordMenuItems note items", () => {
  it("emits edit + flag only (no assign / approve / decline)", () => {
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
