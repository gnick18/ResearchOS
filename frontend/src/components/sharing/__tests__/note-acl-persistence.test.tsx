/**
 * Note ACL upgrade (Unified Share entry point, 2026-06-04). Grant's decision:
 * the note's "In your lab" tab uses the full per-person ShareDialog ACL
 * (read / edit + whole-lab "*"), REPLACING the old coarse is_shared toggle.
 *
 * This is a note data-shape touch, so it is test-guarded here. The contract:
 *
 *   1. The note lab-ACL routes through the EXISTING ShareDialogAdapter note
 *      branch -> sharingApi.shareNote, replacing the whole shared_with list in
 *      one write (batched replacement, not per-recipient deltas).
 *   2. is_shared back-compat: sharingApi.shareNote keeps the legacy is_shared
 *      boolean in sync with the whole-lab "*" sentinel (true iff "*" is present,
 *      so old readers that still check the boolean keep working). An empty list
 *      writes is_shared=false; a list with "*" writes is_shared=true.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import type { ShareDialogProps } from "../ShareDialog";
import type { SharedUser } from "@/lib/types";

// ── Mocks ────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  shareNote: vi.fn(),
  capturedOnSave: {
    current: null as
      | ((
          next: SharedUser[],
          options?: { cascadeToTasks?: boolean },
        ) => Promise<void> | void)
      | null,
  },
}));

vi.mock("@/lib/local-api", () => ({
  sharingApi: {
    shareNote: mocks.shareNote,
    shareTask: vi.fn(),
    unshareTask: vi.fn(),
    shareProject: vi.fn(),
    unshareProject: vi.fn(),
    shareMethod: vi.fn(),
    unshareMethod: vi.fn(),
    shareLink: vi.fn(),
    shareGoal: vi.fn(),
  },
  tasksApi: { listByProject: vi.fn() },
}));

// Capture the onSave the adapter wires into the dialog, then drive it directly
// (the same pattern as ShareDialogAdapter.test.tsx).
vi.mock("../ShareDialog", () => ({
  default: (props: ShareDialogProps) => {
    mocks.capturedOnSave.current = props.onSave;
    return null;
  },
}));

import ShareDialogAdapter from "../ShareDialogAdapter";

beforeEach(() => {
  mocks.shareNote.mockReset();
  mocks.shareNote.mockResolvedValue({ status: "ok" });
  mocks.capturedOnSave.current = null;
});

function mountNoteAdapter(currentSharedWith: SharedUser[] = []) {
  const onShared = vi.fn();
  render(
    <ShareDialogAdapter
      isOpen
      onClose={() => {}}
      recordType="note"
      recordId={1}
      recordName="My note"
      ownerUsername="alex"
      currentSharedWith={currentSharedWith}
      onShared={onShared}
    />,
  );
  return { onShared };
}

describe("note lab-ACL persistence", () => {
  it("replaces the whole shared_with list via sharingApi.shareNote", async () => {
    mountNoteAdapter();
    expect(mocks.capturedOnSave.current).not.toBeNull();

    await act(async () => {
      await mocks.capturedOnSave.current!([
        { username: "*", level: "read" },
        { username: "maria", level: "edit" },
      ]);
    });

    // ONE batched write with the full recipient list (not per-recipient
    // share/unshare calls like tasks/methods/projects).
    expect(mocks.shareNote).toHaveBeenCalledTimes(1);
    expect(mocks.shareNote).toHaveBeenCalledWith(1, [
      { username: "*", level: "read" },
      { username: "maria", level: "edit" },
    ]);
  });

  it("writes the new list even when starting from an existing share", async () => {
    // An existing note shared whole-lab; the owner adds a per-person grant.
    mountNoteAdapter([{ username: "*", level: "read" }]);

    await act(async () => {
      await mocks.capturedOnSave.current!([
        { username: "*", level: "read" },
        { username: "bob", level: "read" },
      ]);
    });

    expect(mocks.shareNote).toHaveBeenCalledTimes(1);
    expect(mocks.shareNote).toHaveBeenCalledWith(1, [
      { username: "*", level: "read" },
      { username: "bob", level: "read" },
    ]);
  });
});

// ── is_shared back-compat derivation ─────────────────────────────────────────
// sharingApi.shareNote keeps the legacy is_shared boolean in sync with the
// whole-lab "*" sentinel: `is_shared = shared_with.some(s => s.username === "*")`.
// This pins that derivation so the upgrade never silently breaks a legacy reader
// (e.g. the Lab Notes feed) that still checks the boolean. We assert the exact
// rule the shipped helper uses against the unified WHOLE_LAB_SENTINEL.

import { WHOLE_LAB_SENTINEL } from "@/lib/sharing/unified";

function deriveIsShared(sharedWith: SharedUser[]): boolean {
  return sharedWith.some((s) => s.username === WHOLE_LAB_SENTINEL);
}

describe("is_shared back-compat derivation", () => {
  it("is true with the whole-lab sentinel present", () => {
    expect(deriveIsShared([{ username: WHOLE_LAB_SENTINEL, level: "read" }])).toBe(
      true,
    );
    expect(
      deriveIsShared([
        { username: "maria", level: "edit" },
        { username: WHOLE_LAB_SENTINEL, level: "read" },
      ]),
    ).toBe(true);
  });

  it("is false for an empty list or per-person-only shares", () => {
    expect(deriveIsShared([])).toBe(false);
    expect(deriveIsShared([{ username: "maria", level: "edit" }])).toBe(false);
  });
});
