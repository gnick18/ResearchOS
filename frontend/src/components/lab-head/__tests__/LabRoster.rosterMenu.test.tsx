import { describe, expect, it, vi } from "vitest";

/**
 * PI capability revamp Phase 2 pass 2 (sharing + collaboration manager,
 * 2026-06-07): the Lab Roster row right-click menu builder. These are
 * MEMBER-scoped actions (archive / restore), shown only for a lab head on
 * ANOTHER member's row. A non-lab-head, or a lab head on their own row, gets [].
 * The Archive / Restore item is chosen by the row's archived state.
 */

// LabRoster pulls UserAvatar, which reaches identity sidecars at render time.
// The builder under test is pure and does not touch any of that, but importing
// the module evaluates UserAvatar's imports, so stub it to keep the import light.
vi.mock("@/components/UserAvatar", () => ({ default: () => null }));

import { buildRosterRowMenuItems } from "@/components/lab-head/LabRoster";

type Row = Parameters<typeof buildRosterRowMenuItems>[0]["row"];

function row(overrides: Partial<Row> = {}): Row {
  return {
    username: "alex",
    displayName: "Alex",
    account_type: "member",
    lab_manager: false,
    archived: false,
    archived_at: null,
    archived_by: null,
    hasSharingIdentity: false,
    idpExists: false,
    idpUpdatedAt: null,
    ...overrides,
  };
}

describe("buildRosterRowMenuItems", () => {
  it("returns [] for a non-lab-head viewer", () => {
    const items = buildRosterRowMenuItems({
      row: row(),
      isLabHead: false,
      currentUser: "mira",
      onArchive: vi.fn(),
      onRestore: vi.fn(),
    });
    expect(items).toEqual([]);
  });

  it("returns [] for a lab head on their OWN row (no self-archive)", () => {
    const items = buildRosterRowMenuItems({
      row: row({ username: "mira" }),
      isLabHead: true,
      currentUser: "mira",
      onArchive: vi.fn(),
      onRestore: vi.fn(),
    });
    expect(items).toEqual([]);
  });

  it("shows Archive member for a lab head on an active member's row", () => {
    const onArchive = vi.fn();
    const items = buildRosterRowMenuItems({
      row: row({ archived: false }),
      isLabHead: true,
      currentUser: "mira",
      onArchive,
      onRestore: vi.fn(),
    });
    expect(items.map((i) => i.id)).toEqual(["roster-archive-member"]);
    expect(items[0].label).toBe("Archive member");
    items[0].onRun();
    expect(onArchive).toHaveBeenCalledOnce();
  });

  it("shows Restore member for a lab head on an archived member's row", () => {
    const onRestore = vi.fn();
    const items = buildRosterRowMenuItems({
      row: row({ archived: true }),
      isLabHead: true,
      currentUser: "mira",
      onArchive: vi.fn(),
      onRestore,
    });
    expect(items.map((i) => i.id)).toEqual(["roster-restore-member"]);
    expect(items[0].label).toBe("Restore member");
    items[0].onRun();
    expect(onRestore).toHaveBeenCalledOnce();
  });
});
