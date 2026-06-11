// checkDestructive unit tests (ai click tests bot, 2026-06-11).
//
// Pins the destructive-heuristic safety net. The heuristic is string-only and
// pure, no DOM needed. Tests cover:
//   - each major destructive/outward/financial/commit term trips the check;
//   - case-insensitivity (DELETE, dElEtE, etc.);
//   - word boundaries guard against accidental substrings ("complete" must NOT
//     trip on "delete", "New Method" is safe, "Revoke" trips);
//   - multi-word terms ("clear all", "empty trash", "confirm delete") match;
//   - empty, whitespace-only, and undefined names are treated as non-destructive;
//   - matched returns the term that fired (lowercase), matched is empty on safe;
//   - the _role param is accepted without affecting the outcome (future hook).
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { checkDestructive } from "../destructive-heuristic";

describe("checkDestructive", () => {
  // ---- destructive data-loss terms ----

  it("trips on 'Delete' (capital)", () => {
    const r = checkDestructive("Delete experiment");
    expect(r.destructive).toBe(true);
    expect(r.matched).toBe("delete");
  });

  it("trips on 'delete' lowercase", () => {
    const r = checkDestructive("delete this file");
    expect(r.destructive).toBe(true);
  });

  it("trips on 'DELETE' all-caps", () => {
    const r = checkDestructive("DELETE");
    expect(r.destructive).toBe(true);
    expect(r.matched).toBe("delete");
  });

  it("trips on 'Remove'", () => {
    const r = checkDestructive("Remove from project");
    expect(r.destructive).toBe(true);
    expect(r.matched).toBe("remove");
  });

  it("trips on 'Erase'", () => {
    const r = checkDestructive("Erase notebook");
    expect(r.destructive).toBe(true);
  });

  it("trips on 'Discard'", () => {
    const r = checkDestructive("Discard changes");
    expect(r.destructive).toBe(true);
  });

  it("trips on 'Trash'", () => {
    const r = checkDestructive("Trash this item");
    expect(r.destructive).toBe(true);
  });

  it("trips on 'Destroy'", () => {
    const r = checkDestructive("Destroy session");
    expect(r.destructive).toBe(true);
  });

  it("trips on 'Wipe'", () => {
    const r = checkDestructive("Wipe folder");
    expect(r.destructive).toBe(true);
  });

  it("trips on the multi-word term 'clear all'", () => {
    const r = checkDestructive("Clear all data");
    expect(r.destructive).toBe(true);
    expect(r.matched).toBe("clear all");
  });

  it("trips on the multi-word term 'empty trash'", () => {
    const r = checkDestructive("Empty trash now");
    expect(r.destructive).toBe(true);
    expect(r.matched).toBe("empty trash");
  });

  it("trips on 'Reset'", () => {
    const r = checkDestructive("Reset to defaults");
    expect(r.destructive).toBe(true);
  });

  it("trips on 'Revoke'", () => {
    const r = checkDestructive("Revoke access");
    expect(r.destructive).toBe(true);
  });

  it("trips on 'Unshare'", () => {
    const r = checkDestructive("Unshare project");
    expect(r.destructive).toBe(true);
  });

  // ---- outward-facing terms ----

  it("trips on 'Send'", () => {
    const r = checkDestructive("Send to collaborator");
    expect(r.destructive).toBe(true);
    expect(r.matched).toBe("send");
  });

  it("trips on 'Share'", () => {
    const r = checkDestructive("Share with lab");
    expect(r.destructive).toBe(true);
    expect(r.matched).toBe("share");
  });

  it("trips on 'Export'", () => {
    const r = checkDestructive("Export to CSV");
    expect(r.destructive).toBe(true);
    expect(r.matched).toBe("export");
  });

  it("trips on 'Publish'", () => {
    const r = checkDestructive("Publish dataset");
    expect(r.destructive).toBe(true);
  });

  it("trips on 'Deposit'", () => {
    const r = checkDestructive("Deposit to Zenodo");
    expect(r.destructive).toBe(true);
  });

  it("trips on 'Email'", () => {
    const r = checkDestructive("Email PI");
    expect(r.destructive).toBe(true);
  });

  it("trips on 'Invite'", () => {
    const r = checkDestructive("Invite member");
    expect(r.destructive).toBe(true);
  });

  it("trips on 'Upload'", () => {
    const r = checkDestructive("Upload files");
    expect(r.destructive).toBe(true);
  });

  // ---- financial terms ----

  it("trips on 'Pay'", () => {
    const r = checkDestructive("Pay now");
    expect(r.destructive).toBe(true);
    expect(r.matched).toBe("pay");
  });

  it("trips on 'Purchase'", () => {
    const r = checkDestructive("Purchase reagent");
    expect(r.destructive).toBe(true);
  });

  it("trips on 'Buy'", () => {
    const r = checkDestructive("Buy subscription");
    expect(r.destructive).toBe(true);
  });

  it("trips on 'Checkout'", () => {
    const r = checkDestructive("Checkout");
    expect(r.destructive).toBe(true);
  });

  it("trips on 'Subscribe'", () => {
    const r = checkDestructive("Subscribe to plan");
    expect(r.destructive).toBe(true);
  });

  // ---- irreversible-commit terms ----

  it("trips on 'Submit'", () => {
    const r = checkDestructive("Submit to journal");
    expect(r.destructive).toBe(true);
    expect(r.matched).toBe("submit");
  });

  it("trips on 'confirm delete' (multi-word)", () => {
    const r = checkDestructive("Confirm delete");
    expect(r.destructive).toBe(true);
    expect(r.matched).toBe("confirm delete");
  });

  it("trips on 'Permanently'", () => {
    const r = checkDestructive("Permanently remove");
    expect(r.destructive).toBe(true);
  });

  // ---- word-boundary guards: benign labels that must NOT trip ----

  it("does NOT trip on 'Complete' (contains 'delete' as a non-word substring)", () => {
    // The word boundary anchors 'delete' as a whole word, so the substring
    // inside 'complete' (c-o-m-p-l-ete vs del-ete) does not match. Extra
    // paranoia: also ensure 'Complete experiment' is safe.
    const r1 = checkDestructive("Complete");
    const r2 = checkDestructive("Complete experiment");
    expect(r1.destructive).toBe(false);
    expect(r2.destructive).toBe(false);
  });

  it("does NOT trip on 'New Method'", () => {
    const r = checkDestructive("New Method");
    expect(r.destructive).toBe(false);
    expect(r.matched).toBe("");
  });

  it("does NOT trip on 'Save changes'", () => {
    expect(checkDestructive("Save changes").destructive).toBe(false);
  });

  it("does NOT trip on 'Run analysis'", () => {
    expect(checkDestructive("Run analysis").destructive).toBe(false);
  });

  it("does NOT trip on 'Open notebook'", () => {
    expect(checkDestructive("Open notebook").destructive).toBe(false);
  });

  it("does NOT trip on 'Add experiment'", () => {
    expect(checkDestructive("Add experiment").destructive).toBe(false);
  });

  it("does NOT trip on 'View results'", () => {
    expect(checkDestructive("View results").destructive).toBe(false);
  });

  // ---- empty / missing input ----

  it("is non-destructive for an empty string", () => {
    const r = checkDestructive("");
    expect(r.destructive).toBe(false);
    expect(r.matched).toBe("");
  });

  it("is non-destructive for a whitespace-only string", () => {
    const r = checkDestructive("   ");
    expect(r.destructive).toBe(false);
  });

  it("is non-destructive for undefined", () => {
    const r = checkDestructive(undefined);
    expect(r.destructive).toBe(false);
    expect(r.matched).toBe("");
  });

  // ---- return shape ----

  it("returns matched as lowercase of the term that fired", () => {
    const r = checkDestructive("SEND data");
    expect(r.matched).toBe("send");
  });

  it("matched is empty string when non-destructive", () => {
    const r = checkDestructive("Open");
    expect(r.matched).toBe("");
  });

  // ---- _role param is accepted without effect ----

  it("accepts a role string and still evaluates the name", () => {
    const r = checkDestructive("Delete item", "button");
    expect(r.destructive).toBe(true);
  });

  it("accepts a role string on a safe name and stays safe", () => {
    const r = checkDestructive("New method", "button");
    expect(r.destructive).toBe(false);
  });
});
