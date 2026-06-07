// frontend/src/lib/notes/__tests__/delete-permission.test.ts
//
// delete-affordances bot, 2026-05-29. Pins the gate behind BOTH the new
// header trash icon and the legacy footer "Delete Note" text button in
// NoteDetailPopup. The component reads `canDeleteNoteFromPopup` once and
// feeds the result to both affordances, so this predicate IS the render
// gate — when it returns true both Delete controls render; when false
// neither does.

import { describe, expect, it } from "vitest";
import { canDeleteNoteFromPopup } from "../delete-permission";

describe("canDeleteNoteFromPopup", () => {
  it("shows Delete to the note owner", () => {
    expect(
      canDeleteNoteFromPopup({
        readOnly: false,
        currentUser: "alex",
        noteOwner: "alex",
      }),
    ).toBe(true);
  });

  it("hides Delete from a non-owner (shared-edit receiver or lab head)", () => {
    // A shared-edit receiver or a lab head: not the owner. Can edit, not delete.
    // The old PI edit-session cross-owner delete path was removed.
    expect(
      canDeleteNoteFromPopup({
        readOnly: false,
        currentUser: "morgan",
        noteOwner: "alex",
      }),
    ).toBe(false);
  });

  it("hides Delete whenever the popup is read-only, even for the owner", () => {
    expect(
      canDeleteNoteFromPopup({
        readOnly: true,
        currentUser: "alex",
        noteOwner: "alex",
      }),
    ).toBe(false);
  });

  it("hides Delete when there is no current user", () => {
    expect(
      canDeleteNoteFromPopup({
        readOnly: false,
        currentUser: null,
        noteOwner: "alex",
      }),
    ).toBe(false);
  });

  it("does not treat a null/null owner+user match as ownership", () => {
    // Guard against `undefined === undefined`-style false ownership.
    expect(
      canDeleteNoteFromPopup({
        readOnly: false,
        currentUser: null,
        noteOwner: null,
      }),
    ).toBe(false);
  });

  // VC Phase 2 (vc-entry-history sub-bot of HR, 2026-05-30): the delete gate
  // shares isNoteOwnedByCurrentUser with restore, so a legacy own-note carrying
  // an empty username now shows Delete to its owner.
  it("shows Delete on an OWN note whose owner is an empty string (legacy create)", () => {
    expect(
      canDeleteNoteFromPopup({
        readOnly: false,
        currentUser: "alex",
        noteOwner: "",
      }),
    ).toBe(true);
  });
});
