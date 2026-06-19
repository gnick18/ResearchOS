// Tests for lib/file-system/folder-lab-label.ts
//
// folderLabLabel turns a remembered folder's CACHED lab identity into the short
// switcher label: "Solo" / "<labName> - head" / "<labName> - member", with a
// "Lab" fallback when the name is unknown and "Solo" for legacy rows that carry
// no cached role (the flag-off-safe default).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { folderLabLabel } from "../folder-lab-label";

describe("folderLabLabel", () => {
  it("labels a legacy row (no cached role) as Solo", () => {
    expect(folderLabLabel({})).toBe("Solo");
  });

  it("labels an explicit solo folder as Solo", () => {
    expect(folderLabLabel({ labRole: "solo" })).toBe("Solo");
  });

  it("labels a head folder as '<name> - head'", () => {
    expect(folderLabLabel({ labRole: "head", labName: "Fungal Lab" })).toBe(
      "Fungal Lab - head",
    );
  });

  it("labels a member folder as '<name> - member'", () => {
    expect(folderLabLabel({ labRole: "member", labName: "Gluck Lab" })).toBe(
      "Gluck Lab - member",
    );
  });

  it("falls back to 'Lab' when a head/member folder has no cached name", () => {
    expect(folderLabLabel({ labRole: "head" })).toBe("Lab - head");
    expect(folderLabLabel({ labRole: "member", labName: "   " })).toBe(
      "Lab - member",
    );
  });
});
