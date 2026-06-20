// Tests for lib/file-system/folder-lab-label.ts
//
// folderLabLabel turns a remembered folder's CACHED lab identity into the short
// switcher label: "Solo" / "<labName> - head" / "<labName> - member", with a
// "Lab" fallback when the name is unknown and "Solo" for legacy rows that carry
// no cached role (the flag-off-safe default).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import {
  folderLabLabel,
  discoveredLabSublabel,
  folderKindIcon,
} from "../folder-lab-label";

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

  // Class Mode (CM-P1): the class / student roles render with no per-role
  // branching, and the reader does not gate on any flag, so a class row authored
  // elsewhere with class mode OFF still labels cleanly (the H7 reader-tolerance
  // invariant).
  it("labels a class folder as '<name> - class'", () => {
    expect(folderLabLabel({ labRole: "class", labName: "Bio 101" })).toBe(
      "Bio 101 - class",
    );
  });

  it("labels a student folder as '<name> - student'", () => {
    expect(folderLabLabel({ labRole: "student", labName: "Bio 101" })).toBe(
      "Bio 101 - student",
    );
  });

  it("falls back to 'Lab' when a class/student folder has no cached name", () => {
    expect(folderLabLabel({ labRole: "class" })).toBe("Lab - class");
    expect(folderLabLabel({ labRole: "student", labName: "  " })).toBe(
      "Lab - student",
    );
  });

  it("defaults an unknown future role cleanly to the '<name> - <role>' form (no throw)", () => {
    // The reader must tolerate a role it does not recognize rather than throw, so
    // a row written under a later flag still renders. Cast through unknown because
    // the type union does not include this synthetic value by design.
    const unknown = { labRole: "ta", labName: "Bio 101" } as unknown as Parameters<
      typeof folderLabLabel
    >[0];
    expect(folderLabLabel(unknown)).toBe("Bio 101 - ta");
  });
});

// Class Mode (CM-P2A): the discovered-lab sublabel in the folder switcher. A
// class folder reads "Student" (the joiner role in a class); a research-lab
// membership or an absent role reads "Member". Pure, flag-free reader.
describe("discoveredLabSublabel", () => {
  it("labels a research-lab membership as Member", () => {
    expect(discoveredLabSublabel("member")).toBe("Member");
  });

  it("labels an absent role as Member (a new research-lab membership)", () => {
    expect(discoveredLabSublabel(undefined)).toBe("Member");
  });

  it("labels a class role as Student", () => {
    expect(discoveredLabSublabel("class")).toBe("Student");
  });

  it("labels a student role as Student", () => {
    expect(discoveredLabSublabel("student")).toBe("Student");
  });

  it("falls back to Member for an unknown role", () => {
    expect(discoveredLabSublabel("ta")).toBe("Member");
  });
});

describe("folderKindIcon", () => {
  it("uses the crown for a lab head", () => {
    expect(folderKindIcon({ labRole: "head" })).toBe("crown");
  });

  it("uses the people group for a lab member", () => {
    expect(folderKindIcon({ labRole: "member" })).toBe("users");
  });

  it("uses the mortarboard for a class and a student", () => {
    expect(folderKindIcon({ labRole: "class" })).toBe("mortarboard");
    expect(folderKindIcon({ labRole: "student" })).toBe("mortarboard");
  });

  it("uses the single user for solo and for a legacy row with no role", () => {
    expect(folderKindIcon({ labRole: "solo" })).toBe("user");
    expect(folderKindIcon({})).toBe("user");
  });
});
