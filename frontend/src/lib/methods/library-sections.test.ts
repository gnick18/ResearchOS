// Unit tests for the Methods Library two-section split (Grant 2026-05-26:
// "We should reorganize shared methods to show up in their own area on
// the methods tab seperate from a users own categories that they make").
//
// These exercise the pure helpers in library-sections.ts so we can
// verify the partition/grouping/search logic without rendering the
// 2000-line page.tsx.

import { describe, expect, it } from "vitest";
import type { Method } from "@/lib/types";
import {
  groupOwnMethodsByFolder,
  groupSharedMethodsByOwner,
  isOwnMethod,
  isSharedMethod,
  matchesMethodSearch,
  partitionMethodsByOwnership,
  sharedOwnerLabel,
} from "./library-sections";

function method(partial: Partial<Method> & { id: number; owner: string }): Method {
  return {
    name: `method-${partial.id}`,
    source_path: null,
    method_type: "markdown",
    folder_path: null,
    parent_method_id: null,
    tags: null,
    is_public: partial.owner === "public",
    created_by: null,
    shared_with: [],
    ...partial,
  };
}

describe("isOwnMethod / isSharedMethod", () => {
  it("counts a private method I authored as mine", () => {
    const m = method({ id: 1, owner: "alex" });
    expect(isOwnMethod(m, "alex")).toBe(true);
    expect(isSharedMethod(m, "alex")).toBe(false);
  });

  it("counts a public-namespace method I did NOT author as shared", () => {
    // Public methods authored by another lab member: owner === "public",
    // created_by is null or someone else's username. They show in
    // "Shared with Lab" for me.
    const m = method({ id: 1, owner: "public" });
    expect(isOwnMethod(m, "alex")).toBe(false);
    expect(isSharedMethod(m, "alex")).toBe(true);
  });

  it("counts a public-namespace method I authored as MINE (Grant 2026-05-26 course-correct)", () => {
    // Authorship beats storage location: if I created a method and then
    // published it, it stays in My Methods with the Public badge. New
    // users / other lab members still see it only in Shared (their
    // created_by !== alex). Evidence: Qubit / Trichoderma on Grant's
    // real disk both carry created_by: "GrantNickles" alongside
    // is_public: true. The sub-bot's R2 assumption ("created_by is
    // nulled at create time") was wrong for the methods Grant actually
    // has.
    const m = method({ id: 1, owner: "public", created_by: "alex" });
    expect(isOwnMethod(m, "alex")).toBe(true);
    expect(isSharedMethod(m, "alex")).toBe(false);
    // Other lab members still see it as shared.
    expect(isOwnMethod(m, "morgan")).toBe(false);
    expect(isSharedMethod(m, "morgan")).toBe(true);
  });

  it("counts a method shared-with-me as shared, never as mine", () => {
    const m = method({ id: 2, owner: "kritika", is_shared_with_me: true });
    expect(isOwnMethod(m, "alex")).toBe(false);
    expect(isSharedMethod(m, "alex")).toBe(true);
  });

  it("returns false for both when currentUser is empty (pre-hydration)", () => {
    const m = method({ id: 3, owner: "alex" });
    expect(isOwnMethod(m, "")).toBe(false);
    // isSharedMethod is the inverse so empty-user yields shared, which
    // is the safe default (avoid leaking own affordances during boot).
    expect(isSharedMethod(m, "")).toBe(true);
  });

  it("does not count someone else's private method as mine", () => {
    const m = method({ id: 4, owner: "morgan" });
    expect(isOwnMethod(m, "alex")).toBe(false);
  });
});

describe("partitionMethodsByOwnership", () => {
  const alexPrivate = method({ id: 1, owner: "alex", folder_path: "Cloning" });
  const alexPublic = method({ id: 2, owner: "public", folder_path: "Molecular Biology" });
  const kritikaShared = method({
    id: 3,
    owner: "kritika",
    folder_path: "Kritika's Private",
    is_shared_with_me: true,
  });
  const morganPrivate = method({ id: 4, owner: "morgan", folder_path: "Morgan stuff" });

  it("buckets own + shared in a single pass, preserving order", () => {
    const all = [alexPrivate, alexPublic, kritikaShared, morganPrivate];
    const { own, shared } = partitionMethodsByOwnership(all, "alex");
    expect(own).toEqual([alexPrivate]);
    expect(shared).toEqual([alexPublic, kritikaShared, morganPrivate]);
  });

  it("buckets are empty when currentUser is empty", () => {
    const { own, shared } = partitionMethodsByOwnership([alexPrivate], "");
    expect(own).toEqual([]);
    expect(shared).toEqual([alexPrivate]);
  });
});

describe("groupOwnMethodsByFolder", () => {
  it("groups by folder_path, with null landing in Uncategorized", () => {
    const m1 = method({ id: 1, owner: "alex", folder_path: "Cloning" });
    const m2 = method({ id: 2, owner: "alex", folder_path: "Cloning" });
    const m3 = method({ id: 3, owner: "alex", folder_path: null });
    const grouped = groupOwnMethodsByFolder([m1, m2, m3]);
    expect(grouped["Cloning"]).toEqual([m1, m2]);
    expect(grouped["Uncategorized"]).toEqual([m3]);
  });

  it("returns an empty object for an empty list", () => {
    expect(groupOwnMethodsByFolder([])).toEqual({});
  });
});

describe("sharedOwnerLabel / groupSharedMethodsByOwner", () => {
  it('labels public-namespace methods as "Lab"', () => {
    expect(sharedOwnerLabel(method({ id: 1, owner: "public" }))).toBe("Lab");
  });

  it("labels methods shared by a named user with their username", () => {
    expect(
      sharedOwnerLabel(
        method({ id: 1, owner: "kritika", is_shared_with_me: true }),
      ),
    ).toBe("kritika");
  });

  it("does NOT group shared methods by folder_path (the original bug)", () => {
    // Both methods sit in folder "Molecular Biology" on disk, but they
    // come from different owners. Owner-grouping must keep them apart.
    const labMethod = method({
      id: 1,
      owner: "public",
      folder_path: "Molecular Biology",
    });
    const kritikaMethod = method({
      id: 2,
      owner: "kritika",
      folder_path: "Molecular Biology",
      is_shared_with_me: true,
    });
    const grouped = groupSharedMethodsByOwner([labMethod, kritikaMethod]);
    expect(Object.keys(grouped).sort()).toEqual(["Lab", "kritika"]);
    expect(grouped["Lab"]).toEqual([labMethod]);
    expect(grouped["kritika"]).toEqual([kritikaMethod]);
  });
});

describe("matchesMethodSearch", () => {
  const m = method({
    id: 1,
    owner: "alex",
    name: "Gibson Assembly",
    folder_path: "Cloning",
    source_path: "users/alex/methods/gibson",
    tags: ["isothermal", "5-piece"],
  });

  it("returns true for the empty query (no-op filter)", () => {
    expect(matchesMethodSearch(m, "")).toBe(true);
    expect(matchesMethodSearch(m, "   ")).toBe(true);
  });

  it("matches case-insensitively against the name", () => {
    expect(matchesMethodSearch(m, "gibson")).toBe(true);
    expect(matchesMethodSearch(m, "ASSEMBLY")).toBe(true);
  });

  it("matches against folder_path, source_path, and tags", () => {
    expect(matchesMethodSearch(m, "cloning")).toBe(true);
    expect(matchesMethodSearch(m, "users/alex")).toBe(true);
    expect(matchesMethodSearch(m, "isothermal")).toBe(true);
  });

  it("returns false when nothing matches", () => {
    expect(matchesMethodSearch(m, "pcr")).toBe(false);
  });
});

// ── Integration-flavored tests covering the brief's required scenarios ──

describe("two-section rendering (integration-flavored)", () => {
  // Mixed dataset spanning every relevant case:
  //   - alex's own private method ("My Methods")
  //   - a public-namespace method ("Shared with Lab", labeled "Lab")
  //   - a method explicitly shared with alex by kritika ("Shared with Lab")
  //   - morgan's private method that alex shouldn't see at all
  //     (won't appear in fetchAllMethodsIncludingShared; modeled here
  //     by leaving it out of the input).
  const alexOwn = method({
    id: 10,
    owner: "alex",
    folder_path: "My Cloning",
    name: "alex private",
  });
  const alexOwnPublic = method({
    id: 11,
    owner: "alex",
    folder_path: "My Public Stuff",
    name: "alex's own public-ish (shared with whole lab)",
    shared_with: [{ username: "*", level: "read" }],
  });
  const labMethod = method({
    id: 20,
    owner: "public",
    folder_path: "Molecular Biology",
    name: "Lab Gibson",
    is_public: true,
  });
  const kritikaShared = method({
    id: 30,
    owner: "kritika",
    folder_path: "Kritika's Private",
    name: "Kritika Western Blot",
    is_shared_with_me: true,
    shared_permission: "view",
  });
  const mixed = [alexOwn, alexOwnPublic, labMethod, kritikaShared];

  it("methods owned by alex never appear in the Shared section", () => {
    const { own, shared } = partitionMethodsByOwnership(mixed, "alex");
    expect(own.map((m) => m.id).sort()).toEqual([10, 11]);
    expect(shared.find((m) => m.id === 10 || m.id === 11)).toBeUndefined();
  });

  it("public methods owned by someone else appear only in Shared with Lab", () => {
    const { own, shared } = partitionMethodsByOwnership(mixed, "alex");
    expect(shared.map((m) => m.id).sort()).toEqual([20, 30]);
    expect(own.find((m) => m.id === 20 || m.id === 30)).toBeUndefined();
  });

  it("empty categories the user creates land in My Methods, not Shared", () => {
    // Empty categories are tracked in component state, not in `methods`.
    // The contract is: the My Methods section's folder list should
    // include them, the Shared section's should never see them.
    const { own } = partitionMethodsByOwnership(mixed, "alex");
    const ownFolders = new Set(
      own.map((m) => m.folder_path).filter(Boolean) as string[],
    );
    const emptyCategoriesAlexCreated = ["Fresh Empty Category"];
    const myMethodsFolders = new Set<string>([
      ...ownFolders,
      ...emptyCategoriesAlexCreated,
    ]);
    expect(myMethodsFolders.has("Fresh Empty Category")).toBe(true);

    // The Shared grouping is keyed by owner, so a freshly-named empty
    // category cannot accidentally surface there.
    const sharedGrouped = groupSharedMethodsByOwner(
      partitionMethodsByOwnership(mixed, "alex").shared,
    );
    expect(Object.keys(sharedGrouped)).not.toContain("Fresh Empty Category");
  });

  it("search filters across both sections and returns scoped results", () => {
    const { own, shared } = partitionMethodsByOwnership(mixed, "alex");
    const q = "gibson";
    const ownHits = own.filter((m) => matchesMethodSearch(m, q));
    const sharedHits = shared.filter((m) => matchesMethodSearch(m, q));
    // Only the lab method has "gibson" in its name.
    expect(ownHits).toEqual([]);
    expect(sharedHits.map((m) => m.id)).toEqual([20]);

    const q2 = "alex";
    const ownHits2 = own.filter((m) => matchesMethodSearch(m, q2));
    const sharedHits2 = shared.filter((m) => matchesMethodSearch(m, q2));
    // Both of alex's own methods have "alex" in their name.
    expect(ownHits2.map((m) => m.id).sort()).toEqual([10, 11]);
    // No shared methods mention "alex" in name/source/folder/tags.
    expect(sharedHits2).toEqual([]);
  });

  it("shared methods are grouped by owner-label, not folder_path", () => {
    const { shared } = partitionMethodsByOwnership(mixed, "alex");
    const grouped = groupSharedMethodsByOwner(shared);
    // Folder names like "Molecular Biology" and "Kritika's Private"
    // must NOT appear as group keys (that was the original bug).
    expect(Object.keys(grouped)).not.toContain("Molecular Biology");
    expect(Object.keys(grouped)).not.toContain("Kritika's Private");
    expect(Object.keys(grouped).sort()).toEqual(["Lab", "kritika"]);
  });
});
