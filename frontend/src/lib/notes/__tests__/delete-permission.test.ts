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
        labHeadUnlocked: false,
      }),
    ).toBe(true);
  });

  it("hides Delete from a non-owner who has no PI unlock", () => {
    // A shared-edit receiver: not the owner, no PI session. Can edit, not delete.
    expect(
      canDeleteNoteFromPopup({
        readOnly: false,
        currentUser: "morgan",
        noteOwner: "alex",
        labHeadUnlocked: false,
      }),
    ).toBe(false);
  });

  it("shows Delete to a PI with an unlocked Phase 5 edit session (cross-owner)", () => {
    expect(
      canDeleteNoteFromPopup({
        readOnly: false,
        currentUser: "pi-jordan",
        noteOwner: "alex",
        labHeadUnlocked: true,
      }),
    ).toBe(true);
  });

  it("hides Delete whenever the popup is read-only, even for the owner", () => {
    expect(
      canDeleteNoteFromPopup({
        readOnly: true,
        currentUser: "alex",
        noteOwner: "alex",
        labHeadUnlocked: false,
      }),
    ).toBe(false);
    // read-only also suppresses the PI-unlock path.
    expect(
      canDeleteNoteFromPopup({
        readOnly: true,
        currentUser: "pi-jordan",
        noteOwner: "alex",
        labHeadUnlocked: true,
      }),
    ).toBe(false);
  });

  it("hides Delete when there is no current user", () => {
    expect(
      canDeleteNoteFromPopup({
        readOnly: false,
        currentUser: null,
        noteOwner: "alex",
        labHeadUnlocked: false,
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
        labHeadUnlocked: false,
      }),
    ).toBe(false);
  });

  // VC Phase 2 (vc-entry-history sub-bot of HR, 2026-05-30): the delete gate
  // shares isNoteOwnedByCurrentUser with restore, so a legacy own-note carrying
  // an empty username now shows Delete to its owner (and still hides it from a
  // PI viewing a member note, which carries the member's non-empty username).
  it("shows Delete on an OWN note whose owner is an empty string (legacy create)", () => {
    expect(
      canDeleteNoteFromPopup({
        readOnly: false,
        currentUser: "alex",
        noteOwner: "",
        labHeadUnlocked: false,
      }),
    ).toBe(true);
  });
});
