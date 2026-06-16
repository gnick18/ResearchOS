import { describe, expect, it } from "vitest";

import {
  filterNoteOptions,
  isValidRecipientEmail,
  recipientLabel,
  recipientSubtitle,
  type ShareableNoteOption,
} from "@/lib/social/share-recipient";

describe("recipientLabel", () => {
  it("uses the display name when present", () => {
    expect(recipientLabel({ displayName: "Dr. Sarah Lee", hasPublishedKey: true })).toBe(
      "Dr. Sarah Lee",
    );
  });
  it("falls back to the handle, then a generic label", () => {
    expect(recipientLabel({ displayName: "", handle: "sarahlee", hasPublishedKey: false })).toBe(
      "@sarahlee",
    );
    expect(recipientLabel({ displayName: "  ", hasPublishedKey: false })).toBe(
      "this researcher",
    );
  });
});

describe("recipientSubtitle", () => {
  it("prefers the handle, then the fingerprint, else null", () => {
    expect(
      recipientSubtitle({ displayName: "X", handle: "sarahlee", hasPublishedKey: false }),
    ).toBe("@sarahlee");
    expect(
      recipientSubtitle({ displayName: "X", fingerprint: "abcd ef12", hasPublishedKey: true }),
    ).toBe("abcd ef12");
    expect(recipientSubtitle({ displayName: "X", hasPublishedKey: false })).toBeNull();
  });
});

describe("isValidRecipientEmail", () => {
  it("accepts a normal address and rejects junk", () => {
    expect(isValidRecipientEmail("them@university.edu")).toBe(true);
    expect(isValidRecipientEmail(" a@b.co ")).toBe(true);
    expect(isValidRecipientEmail("nope")).toBe(false);
    expect(isValidRecipientEmail("a@b")).toBe(false);
    expect(isValidRecipientEmail("")).toBe(false);
  });
});

describe("filterNoteOptions", () => {
  const opts: ShareableNoteOption[] = [
    { id: 1, title: "Cloning protocol", updatedAt: "2026-06-10T00:00:00Z" },
    { id: 2, title: "MIC assay", updatedAt: "2026-06-15T00:00:00Z" },
    { id: 3, title: "Old draft", updatedAt: "2026-06-01T00:00:00Z" },
  ];

  it("sorts by updatedAt newest first with no query", () => {
    expect(filterNoteOptions(opts, "").map((o) => o.id)).toEqual([2, 1, 3]);
  });

  it("filters by case-insensitive title substring", () => {
    expect(filterNoteOptions(opts, "mic").map((o) => o.id)).toEqual([2]);
    expect(filterNoteOptions(opts, "  CLON ").map((o) => o.id)).toEqual([1]);
  });

  it("returns empty when nothing matches", () => {
    expect(filterNoteOptions(opts, "zzz")).toEqual([]);
  });

  it("does not mutate the input order", () => {
    const copy = [...opts];
    filterNoteOptions(opts, "");
    expect(opts).toEqual(copy);
  });
});
