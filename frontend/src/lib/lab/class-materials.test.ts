import { describe, expect, it } from "vitest";
import {
  isOwnClassMaterial,
  filterOwnClassMaterials,
  type ClassMaterialCandidate,
} from "./class-materials";
import {
  WHOLE_LAB_SENTINEL,
  upsertSharedEntry,
  removeSharedEntry,
  isWholeLabShared,
  normalizeSharedWith,
} from "@/lib/sharing/unified";
import type { SharedUser } from "@/lib/types";

const INSTRUCTOR = "prof";

const mk = (
  owner: string,
  shared_with: SharedUser[] | null,
): ClassMaterialCandidate => ({ owner, shared_with });

describe("isOwnClassMaterial (CT-1 filter)", () => {
  it("is true for an own record shared to the whole class", () => {
    expect(
      isOwnClassMaterial(mk(INSTRUCTOR, [{ username: "*", level: "read" }]), INSTRUCTOR),
    ).toBe(true);
  });

  it("is false for an own record that is private (no * entry)", () => {
    expect(isOwnClassMaterial(mk(INSTRUCTOR, []), INSTRUCTOR)).toBe(false);
    expect(
      isOwnClassMaterial(
        mk(INSTRUCTOR, [{ username: "student1", level: "read" }]),
        INSTRUCTOR,
      ),
    ).toBe(false);
  });

  it("is false for a record owned by someone else even if shared to the class", () => {
    expect(
      isOwnClassMaterial(
        mk("student1", [{ username: "*", level: "read" }]),
        INSTRUCTOR,
      ),
    ).toBe(false);
  });

  it("tolerates null shared_with", () => {
    expect(isOwnClassMaterial(mk(INSTRUCTOR, null), INSTRUCTOR)).toBe(false);
  });
});

describe("filterOwnClassMaterials", () => {
  it("returns only the instructor's own whole-class-shared records", () => {
    const records: ClassMaterialCandidate[] = [
      mk(INSTRUCTOR, [{ username: "*", level: "read" }]), // keep
      mk(INSTRUCTOR, []), // own private, drop
      mk(INSTRUCTOR, [{ username: "s1", level: "edit" }]), // own per-person, drop
      mk("s1", [{ username: "*", level: "read" }]), // other owner whole-class, drop
      mk(INSTRUCTOR, [{ username: "*", level: "edit" }]), // keep (edit-level *)
    ];
    const out = filterOwnClassMaterials(records, INSTRUCTOR);
    expect(out).toHaveLength(2);
    for (const r of out) {
      expect(r.owner).toBe(INSTRUCTOR);
      expect(isWholeLabShared(r.shared_with ?? [])).toBe(true);
    }
  });

  it("preserves input order", () => {
    const a = mk(INSTRUCTOR, [{ username: "*", level: "read" }]);
    const b = mk(INSTRUCTOR, [{ username: "*", level: "read" }]);
    const out = filterOwnClassMaterials([a, mk(INSTRUCTOR, []), b], INSTRUCTOR);
    expect(out).toEqual([a, b]);
  });
});

describe("share / unshare toggle flips the * entry (CT-1 panel logic)", () => {
  // The panel computes the next shared_with by adding / removing the "*"
  // sentinel over the note's current list, then persists via sharingApi.shareNote.
  // This mirrors that pure step.

  it("share adds the * entry at read level, preserving per-person entries", () => {
    const current: SharedUser[] = [{ username: "s1", level: "edit" }];
    const next = upsertSharedEntry(current, WHOLE_LAB_SENTINEL, "read");
    expect(isWholeLabShared(next)).toBe(true);
    // per-person entry survives
    expect(next.some((s) => s.username === "s1" && s.level === "edit")).toBe(true);
    // * is read-level by default
    expect(next.find((s) => s.username === "*")?.level).toBe("read");
  });

  it("unshare removes the * entry, preserving per-person entries", () => {
    const current = normalizeSharedWith([
      { username: "*", level: "read" },
      { username: "s1", level: "edit" },
    ]);
    const next = removeSharedEntry(current, WHOLE_LAB_SENTINEL);
    expect(isWholeLabShared(next)).toBe(false);
    expect(next.some((s) => s.username === "s1" && s.level === "edit")).toBe(true);
  });

  it("share then unshare round-trips back to private", () => {
    const start: SharedUser[] = [];
    const shared = upsertSharedEntry(start, WHOLE_LAB_SENTINEL, "read");
    expect(isWholeLabShared(shared)).toBe(true);
    const unshared = removeSharedEntry(shared, WHOLE_LAB_SENTINEL);
    expect(isWholeLabShared(unshared)).toBe(false);
    expect(unshared).toHaveLength(0);
  });
});
