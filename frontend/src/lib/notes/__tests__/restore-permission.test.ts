// frontend/src/lib/notes/__tests__/restore-permission.test.ts
//
// VC Phase 2 (restore-a-version sub-bot of HR, 2026-05-30). Pins the three-way
// PI gate behind BOTH the sidebar "Restore this version" footer and the popup
// header "Undo restore" button. NoteDetailPopup reads `canRestoreNoteVersion`
// once and feeds both affordances, so this predicate IS the render gate.

import { describe, expect, it } from "vitest";
import {
  canRestoreNoteVersion,
  isNoteOwnedByCurrentUser,
} from "../restore-permission";

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

  // VC Phase 2 (vc-entry-history sub-bot of HR, 2026-05-30): Bug 2 fix. A note
  // created before the author-stamp fix carries `username: ""`, which made
  // `currentUser === ""` false and hid the Restore footer on the owner's OWN
  // note. An empty / null owner now resolves to the current user.
  it("grants restore on an OWN note whose owner is an empty string (legacy create)", () => {
    expect(
      canRestoreNoteVersion({
        readOnly: false,
        currentUser: "alex",
        noteOwner: "",
        labHeadUnlocked: false,
      }),
    ).toBe(true);
  });

  it("grants restore on an OWN note whose owner is null/undefined", () => {
    expect(
      canRestoreNoteVersion({
        readOnly: false,
        currentUser: "alex",
        noteOwner: null,
        labHeadUnlocked: false,
      }),
    ).toBe(true);
    expect(
      canRestoreNoteVersion({
        readOnly: false,
        currentUser: "alex",
        noteOwner: undefined,
        labHeadUnlocked: false,
      }),
    ).toBe(true);
  });

  it("still DENIES a PI viewing a member note with no unlock (empty-owner fix does not weaken the PI gate)", () => {
    // The PI cross-owner view always carries the member's NON-EMPTY username as
    // noteOwner, so the empty-owner fallback never applies here.
    expect(
      canRestoreNoteVersion({
        readOnly: false,
        currentUser: "pi-jordan",
        noteOwner: "alex",
        labHeadUnlocked: false,
      }),
    ).toBe(false);
  });
});

describe("isNoteOwnedByCurrentUser (empty-owner resolution)", () => {
  it("treats an empty-string owner as owned by the signed-in user", () => {
    expect(isNoteOwnedByCurrentUser("alex", "")).toBe(true);
  });

  it("treats a null/undefined owner as owned by the signed-in user", () => {
    expect(isNoteOwnedByCurrentUser("alex", null)).toBe(true);
    expect(isNoteOwnedByCurrentUser("alex", undefined)).toBe(true);
  });

  it("matches an explicit owner equal to the current user", () => {
    expect(isNoteOwnedByCurrentUser("alex", "alex")).toBe(true);
  });

  it("rejects a different explicit owner (PI viewing a member note)", () => {
    expect(isNoteOwnedByCurrentUser("pi-jordan", "alex")).toBe(false);
  });

  it("requires a signed-in user, even for an empty owner", () => {
    expect(isNoteOwnedByCurrentUser(null, "")).toBe(false);
    expect(isNoteOwnedByCurrentUser(undefined, null)).toBe(false);
    expect(isNoteOwnedByCurrentUser("", "")).toBe(false);
  });
});
