// frontend/src/lib/notes/__tests__/restore-permission.test.ts
//
// VC Phase 2 (restore-a-version sub-bot of HR, 2026-05-30). Pins the three-way
// PI gate behind BOTH the sidebar "Restore this version" footer and the popup
// header "Undo restore" button. NoteDetailPopup reads `canRestoreNoteVersion`
// once and feeds both affordances, so this predicate IS the render gate.

import { describe, expect, it } from "vitest";
import { canRestoreNoteVersion } from "../restore-permission";

describe("canRestoreNoteVersion (three-way PI gate)", () => {
  it("grants restore to the note owner", () => {
    expect(
      canRestoreNoteVersion({
        readOnly: false,
        currentUser: "alex",
        noteOwner: "alex",
        labHeadUnlocked: false,
      }),
    ).toBe(true);
  });

  it("grants restore to a PI with an unlocked Phase 5 edit session (cross-owner)", () => {
    expect(
      canRestoreNoteVersion({
        readOnly: false,
        currentUser: "pi-jordan",
        noteOwner: "alex",
        labHeadUnlocked: true,
      }),
    ).toBe(true);
  });

  it("denies restore to a non-owner with no PI unlock (read-only shared viewer)", () => {
    expect(
      canRestoreNoteVersion({
        readOnly: false,
        currentUser: "morgan",
        noteOwner: "alex",
        labHeadUnlocked: false,
      }),
    ).toBe(false);
  });

  it("denies restore whenever the popup is read-only, even for the owner", () => {
    expect(
      canRestoreNoteVersion({
        readOnly: true,
        currentUser: "alex",
        noteOwner: "alex",
        labHeadUnlocked: false,
      }),
    ).toBe(false);
    // read-only also suppresses the PI-unlock path.
    expect(
      canRestoreNoteVersion({
        readOnly: true,
        currentUser: "pi-jordan",
        noteOwner: "alex",
        labHeadUnlocked: true,
      }),
    ).toBe(false);
  });

  it("denies restore with no current user, and does not match null === null as ownership", () => {
    expect(
      canRestoreNoteVersion({
        readOnly: false,
        currentUser: null,
        noteOwner: "alex",
        labHeadUnlocked: false,
      }),
    ).toBe(false);
    expect(
      canRestoreNoteVersion({
        readOnly: false,
        currentUser: null,
        noteOwner: null,
        labHeadUnlocked: false,
      }),
    ).toBe(false);
  });
});
