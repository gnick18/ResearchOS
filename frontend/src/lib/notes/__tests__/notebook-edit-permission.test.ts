// frontend/src/lib/notes/__tests__/notebook-edit-permission.test.ts
//
// notebook-note-edit sub-bot of HR, 2026-06-02. Pins the carve-out that makes
// a SHARED-NOTEBOOK note editable by BOTH members, bypassing the lab-head
// edit-session read-only gate. NoteDetailPopup reads `canEditNotebookNote`
// to relax `readOnly` for notebook notes the viewer can write, so this
// predicate IS that render gate.
//
// The two members of a 1:1 notebook each hold an explicit edit-level share
// (via `pairingSharedWith`). The KEY assertions:
//   - a member opening the OTHER member's notebook note CAN edit it.
//   - the predicate returns false for an ordinary (NON-notebook) shared note,
//     so the carve-out does not leak past notebook notes.

import { describe, expect, it } from "vitest";
import { canEditNotebookNote } from "../notebook-edit-permission";
import { pairingSharedWith } from "@/lib/sharing/unified";
import type { SharedUser } from "@/lib/types";

// Both notebook members at level "edit": the canonical notebook share shape.
const PAIR: SharedUser[] = pairingSharedWith("student", "pi");

describe("canEditNotebookNote (shared-notebook carve-out)", () => {
  it("lets the OTHER member edit a notebook note (the locked both-can-edit requirement)", () => {
    // The note is owned by `student`; `pi` (the other member) opens it.
    expect(
      canEditNotebookNote({
        notebookId: "nb-123",
        noteOwner: "student",
        currentUser: "pi",
        sharedWith: PAIR,
      }),
    ).toBe(true);
  });

  it("lets the OWNER edit their own notebook note", () => {
    expect(
      canEditNotebookNote({
        notebookId: "nb-123",
        noteOwner: "student",
        currentUser: "student",
        sharedWith: PAIR,
      }),
    ).toBe(true);
  });

  it("does NOT apply to an ordinary (non-notebook) shared note, even at edit level (no leak)", () => {
    // Same edit-level share, but NO notebook_id: the carve-out must not fire,
    // so this note keeps the lab-head edit-session / PI-unlock posture.
    expect(
      canEditNotebookNote({
        notebookId: undefined,
        noteOwner: "student",
        currentUser: "pi",
        sharedWith: [{ username: "pi", level: "edit" }],
      }),
    ).toBe(false);
    // An empty-string notebook_id is also treated as "not a notebook note".
    expect(
      canEditNotebookNote({
        notebookId: "",
        noteOwner: "student",
        currentUser: "pi",
        sharedWith: [{ username: "pi", level: "edit" }],
      }),
    ).toBe(false);
  });

  it("does NOT grant edit to a third user who is not in the notebook pair", () => {
    // `other` is not a notebook member; even with a notebook_id present the
    // pair-share grant excludes them, so the predicate is false.
    expect(
      canEditNotebookNote({
        notebookId: "nb-123",
        noteOwner: "student",
        currentUser: "other",
        sharedWith: PAIR,
      }),
    ).toBe(false);
  });

  it("does NOT grant edit on a read-level share, even with a notebook_id", () => {
    // The authorization is the explicit EDIT-level share. A read-only entry
    // must not pass (defensive: a notebook note is always both-at-edit, but a
    // malformed / downgraded share must not silently become editable).
    expect(
      canEditNotebookNote({
        notebookId: "nb-123",
        noteOwner: "student",
        currentUser: "pi",
        sharedWith: [{ username: "pi", level: "read" }],
      }),
    ).toBe(false);
  });

  it("does NOT use the PI passcode bypass (no lab-head override leaks in)", () => {
    // `canEditNotebookNote` calls `canWrite` with NEVER_UNLOCKED, so a PI who
    // is NOT a notebook member gets nothing here from their lab-head role:
    // they would need an explicit notebook share like everyone else.
    expect(
      canEditNotebookNote({
        notebookId: "nb-123",
        noteOwner: "student",
        currentUser: "pi-outsider",
        sharedWith: [{ username: "student", level: "edit" }],
      }),
    ).toBe(false);
  });

  it("requires a signed-in viewer", () => {
    expect(
      canEditNotebookNote({
        notebookId: "nb-123",
        noteOwner: "student",
        currentUser: null,
        sharedWith: PAIR,
      }),
    ).toBe(false);
    expect(
      canEditNotebookNote({
        notebookId: "nb-123",
        noteOwner: "student",
        currentUser: undefined,
        sharedWith: PAIR,
      }),
    ).toBe(false);
  });

  it("tolerates a missing shared_with for the owner's own notebook note", () => {
    // Owner always writes (canWrite owner short-circuit), so an absent
    // shared_with still resolves true for the owner.
    expect(
      canEditNotebookNote({
        notebookId: "nb-123",
        noteOwner: "student",
        currentUser: "student",
        sharedWith: null,
      }),
    ).toBe(true);
  });
});
