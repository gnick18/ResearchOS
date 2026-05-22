// frontend/src/lib/file-system/user-color-collisions.test.ts
//
// Unit tests for the cross-user color-combination collision rules. These
// drive the Settings → Profile picker: a user can't pick a solid that
// another user already has as solid, and a gradient pair is taken iff
// any other user has the same unordered pair.

import { describe, it, expect } from "vitest";
import {
  isCombinationTaken,
  ownerOfCombination,
  otherUsersOnly,
  takenSecondariesFor,
  takenSolidPrimaries,
} from "./user-color-collisions";
import type { UserMetadataEntry } from "./user-metadata";

function entry(
  color: string,
  color_secondary: string | null = null,
  extra: Partial<UserMetadataEntry> = {},
): UserMetadataEntry {
  return {
    color,
    color_secondary,
    created_at: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

describe("isCombinationTaken — solid (no secondary)", () => {
  it("is taken when another user has the same color as their solid", () => {
    const others = { alice: entry("#3b82f6") };
    expect(
      isCombinationTaken({ primary: "#3b82f6", secondary: null }, others),
    ).toBe(true);
  });

  it("is NOT taken when another user has the same primary but ALSO a secondary (their gradient frees up the solid)", () => {
    const others = { alice: entry("#3b82f6", "#ef4444") };
    expect(
      isCombinationTaken({ primary: "#3b82f6", secondary: null }, others),
    ).toBe(false);
  });

  it("is NOT taken when nobody has the color at all", () => {
    const others = { alice: entry("#ef4444") };
    expect(
      isCombinationTaken({ primary: "#3b82f6", secondary: null }, others),
    ).toBe(false);
  });

  it("is case-insensitive on hex strings", () => {
    const others = { alice: entry("#3B82F6") };
    expect(
      isCombinationTaken({ primary: "#3b82f6", secondary: null }, others),
    ).toBe(true);
  });
});

describe("isCombinationTaken — gradient (with secondary)", () => {
  it("is taken when another user has the same unordered pair", () => {
    const others = { alice: entry("#3b82f6", "#10b981") };
    expect(
      isCombinationTaken(
        { primary: "#3b82f6", secondary: "#10b981" },
        others,
      ),
    ).toBe(true);
  });

  it("is taken regardless of direction (blue→green collides with green→blue)", () => {
    const others = { alice: entry("#10b981", "#3b82f6") };
    expect(
      isCombinationTaken(
        { primary: "#3b82f6", secondary: "#10b981" },
        others,
      ),
    ).toBe(true);
  });

  it("is NOT taken when no other user has a gradient (even if primary collides)", () => {
    // Alice has solid blue. Bob wants blue→green. The solid blocks Bob's
    // solid choice but not his gradient — different surfaces don't fight
    // for the same identity.
    const others = { alice: entry("#3b82f6") };
    expect(
      isCombinationTaken(
        { primary: "#3b82f6", secondary: "#10b981" },
        others,
      ),
    ).toBe(false);
  });

  it("is NOT taken when another user has a gradient with one matching color but a different second", () => {
    const others = { alice: entry("#3b82f6", "#ef4444") };
    expect(
      isCombinationTaken(
        { primary: "#3b82f6", secondary: "#10b981" },
        others,
      ),
    ).toBe(false);
  });

  it("is case-insensitive on both stops", () => {
    const others = { alice: entry("#3B82F6", "#10B981") };
    expect(
      isCombinationTaken(
        { primary: "#3b82f6", secondary: "#10b981" },
        others,
      ),
    ).toBe(true);
  });
});

describe("ownerOfCombination", () => {
  it("returns the username when a solid is taken", () => {
    const others = { morgan: entry("#3b82f6") };
    expect(
      ownerOfCombination(
        { primary: "#3b82f6", secondary: null },
        others,
      ),
    ).toBe("morgan");
  });

  it("returns the username when a gradient is taken (direction-insensitive)", () => {
    const others = { morgan: entry("#10b981", "#3b82f6") };
    expect(
      ownerOfCombination(
        { primary: "#3b82f6", secondary: "#10b981" },
        others,
      ),
    ).toBe("morgan");
  });

  it("returns null when no one owns the combination", () => {
    const others = { alice: entry("#ef4444") };
    expect(
      ownerOfCombination(
        { primary: "#3b82f6", secondary: null },
        others,
      ),
    ).toBeNull();
  });
});

describe("takenSolidPrimaries", () => {
  it("collects every other user's solid primary", () => {
    const others = {
      alice: entry("#3b82f6"),
      morgan: entry("#10b981"),
      bob: entry("#ef4444", "#f59e0b"), // gradient — should NOT be in the solid set
    };
    const taken = takenSolidPrimaries(others);
    expect(taken.has("#3b82f6")).toBe(true);
    expect(taken.has("#10b981")).toBe(true);
    expect(taken.has("#ef4444")).toBe(false);
  });

  it("returns an empty set when no users are solid", () => {
    const others = { bob: entry("#ef4444", "#f59e0b") };
    expect(takenSolidPrimaries(others).size).toBe(0);
  });
});

describe("takenSecondariesFor", () => {
  it("includes the OTHER stop of any gradient that has my currentPrimary as one of its stops", () => {
    const others = {
      // Alice has blue→green. If my currentPrimary is blue, picking green
      // as a secondary would re-create Alice's combo.
      alice: entry("#3b82f6", "#10b981"),
      // Bob has red→orange. Doesn't intersect with my blue primary, so
      // neither stop is blocked.
      bob: entry("#ef4444", "#f59e0b"),
    };
    const taken = takenSecondariesFor("#3b82f6", others);
    expect(taken.has("#10b981")).toBe(true);
    expect(taken.has("#ef4444")).toBe(false);
    expect(taken.has("#f59e0b")).toBe(false);
  });

  it("works when my primary is the SECOND stop of someone else's gradient", () => {
    const others = { alice: entry("#10b981", "#3b82f6") };
    const taken = takenSecondariesFor("#3b82f6", others);
    expect(taken.has("#10b981")).toBe(true);
  });

  it("skips solid-only users (their primary doesn't block a gradient)", () => {
    const others = { alice: entry("#10b981") };
    const taken = takenSecondariesFor("#3b82f6", others);
    expect(taken.size).toBe(0);
  });
});

describe("otherUsersOnly", () => {
  it("filters out the current user and tombstoned users", () => {
    const all = {
      me: entry("#3b82f6"),
      alice: entry("#10b981"),
      kritika: entry("#ef4444", null, { deleted_at: "2026-05-15T12:00:00.000Z" }),
    };
    const others = otherUsersOnly(all, "me");
    expect(Object.keys(others).sort()).toEqual(["alice"]);
  });

  it("keeps everyone else when current user has no entry yet", () => {
    const all = { alice: entry("#10b981") };
    const others = otherUsersOnly(all, "newcomer");
    expect(Object.keys(others)).toEqual(["alice"]);
  });
});
