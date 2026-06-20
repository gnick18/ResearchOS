// Tests for section-17 profile backend: validation, domain extraction, and
// light DB-shape checks.

import { describe, expect, it, vi } from "vitest";

import {
  parseProfileBody,
  parseSearchQuery,
} from "../validation";
import { extractVerifiedDomain } from "../affiliationDomain";

// Module-level mock for @neondatabase/serverless. vitest hoists vi.mock calls
// to the top of the file regardless of where they appear in source, so the
// mock is in effect for all imports below, including the re-imported db module
// in the DB-shape tests.
vi.mock("@neondatabase/serverless", () => ({
  neon: () => {
    const tag = vi.fn().mockResolvedValue([]);
    return tag;
  },
}));

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const SIG_HEX = "a".repeat(128); // 128 lowercase hex chars = 64-byte sig
const ISSUED_AT = "2026-06-04T12:00:00.000Z";

function validProfileBody(overrides: Record<string, unknown> = {}) {
  return {
    displayName: "Alice Researcher",
    affiliation: "University of Wisconsin-Madison",
    orcid: "0000-0002-1825-0097",
    signature: SIG_HEX,
    issuedAt: ISSUED_AT,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseProfileBody
// ---------------------------------------------------------------------------

describe("parseProfileBody", () => {
  it("accepts a fully valid body", () => {
    const parsed = parseProfileBody(validProfileBody());
    expect(parsed).not.toBeNull();
    expect(parsed?.displayName).toBe("Alice Researcher");
    expect(parsed?.affiliation).toBe("University of Wisconsin-Madison");
    expect(parsed?.orcid).toBe("0000-0002-1825-0097");
    expect(parsed?.signature).toBe(SIG_HEX);
    expect(parsed?.issuedAt).toBe(ISSUED_AT);
  });

  it("accepts a body with no optional fields", () => {
    const parsed = parseProfileBody({
      displayName: "Bob",
      signature: SIG_HEX,
      issuedAt: ISSUED_AT,
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.affiliation).toBeNull();
    expect(parsed?.orcid).toBeNull();
  });

  it("coerces absent affiliation and orcid to null", () => {
    const parsed = parseProfileBody(
      validProfileBody({ affiliation: undefined, orcid: undefined }),
    );
    expect(parsed?.affiliation).toBeNull();
    expect(parsed?.orcid).toBeNull();
  });

  it("coerces explicit null affiliation and orcid to null", () => {
    const parsed = parseProfileBody(
      validProfileBody({ affiliation: null, orcid: null }),
    );
    expect(parsed?.affiliation).toBeNull();
    expect(parsed?.orcid).toBeNull();
  });

  it("trims displayName", () => {
    const parsed = parseProfileBody(
      validProfileBody({ displayName: "  Alice  " }),
    );
    expect(parsed?.displayName).toBe("Alice");
  });

  it("rejects a displayName that is too long (> 100 chars)", () => {
    expect(
      parseProfileBody(validProfileBody({ displayName: "A".repeat(101) })),
    ).toBeNull();
  });

  it("accepts a displayName at exactly 100 chars", () => {
    expect(
      parseProfileBody(validProfileBody({ displayName: "A".repeat(100) })),
    ).not.toBeNull();
  });

  it("rejects an empty displayName", () => {
    expect(parseProfileBody(validProfileBody({ displayName: "" }))).toBeNull();
    expect(parseProfileBody(validProfileBody({ displayName: "   " }))).toBeNull();
  });

  it("rejects a missing displayName", () => {
    expect(
      parseProfileBody(validProfileBody({ displayName: undefined })),
    ).toBeNull();
  });

  it("rejects an affiliation that is too long (> 200 chars)", () => {
    expect(
      parseProfileBody(
        validProfileBody({ affiliation: "A".repeat(201) }),
      ),
    ).toBeNull();
  });

  it("accepts an affiliation at exactly 200 chars", () => {
    expect(
      parseProfileBody(validProfileBody({ affiliation: "A".repeat(200) })),
    ).not.toBeNull();
  });

  it("rejects an empty-string affiliation (must be null or non-empty)", () => {
    expect(
      parseProfileBody(validProfileBody({ affiliation: "" })),
    ).toBeNull();
  });

  it("rejects a bad ORCID format", () => {
    // Wrong digit count
    expect(
      parseProfileBody(validProfileBody({ orcid: "0000-0002-1825-009" })),
    ).toBeNull();
    // With letters in wrong position
    expect(
      parseProfileBody(validProfileBody({ orcid: "0000-A002-1825-0097" })),
    ).toBeNull();
    // Too many groups
    expect(
      parseProfileBody(
        validProfileBody({ orcid: "0000-0002-1825-0097-0000" }),
      ),
    ).toBeNull();
  });

  it("accepts a valid ORCID ending with X (check digit)", () => {
    expect(
      parseProfileBody(validProfileBody({ orcid: "0000-0002-1825-009X" })),
    ).not.toBeNull();
  });

  it("rejects an empty-string orcid", () => {
    expect(parseProfileBody(validProfileBody({ orcid: "" }))).toBeNull();
  });

  it("rejects a signature that is not 128 hex chars", () => {
    // Too short
    expect(
      parseProfileBody(validProfileBody({ signature: "a".repeat(127) })),
    ).toBeNull();
    // Too long
    expect(
      parseProfileBody(validProfileBody({ signature: "a".repeat(129) })),
    ).toBeNull();
    // Non-hex
    expect(
      parseProfileBody(validProfileBody({ signature: "Z".repeat(128) })),
    ).toBeNull();
  });

  it("rejects a missing signature", () => {
    expect(
      parseProfileBody(validProfileBody({ signature: undefined })),
    ).toBeNull();
  });

  it("rejects a malformed issuedAt", () => {
    expect(
      parseProfileBody(validProfileBody({ issuedAt: "not-a-date" })),
    ).toBeNull();
    // Loose form that does not round-trip
    expect(
      parseProfileBody(validProfileBody({ issuedAt: "2026-06-04" })),
    ).toBeNull();
  });

  it("rejects a non-object body", () => {
    expect(parseProfileBody(null)).toBeNull();
    expect(parseProfileBody("string")).toBeNull();
    expect(parseProfileBody(42)).toBeNull();
  });

  it("accepts earnedBadgeIds and pinnedBadgeIds as string arrays", () => {
    const parsed = parseProfileBody(
      validProfileBody({
        earnedBadgeIds: ["founding-lab", "first-experiment"],
        pinnedBadgeIds: ["founding-lab"],
      }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.earnedBadgeIds).toEqual(["founding-lab", "first-experiment"]);
    expect(parsed?.pinnedBadgeIds).toEqual(["founding-lab"]);
  });

  it("defaults earnedBadgeIds and pinnedBadgeIds to [] when absent", () => {
    const parsed = parseProfileBody(validProfileBody());
    expect(parsed).not.toBeNull();
    expect(parsed?.earnedBadgeIds).toEqual([]);
    expect(parsed?.pinnedBadgeIds).toEqual([]);
  });

  it("silently drops invalid badge ids (non-slug strings) and defaults to []", () => {
    // An array with invalid entries (spaces, uppercase, special chars) is treated
    // as malformed and the whole field defaults to []. The intent is that the
    // server always stores only validated badge ids.
    const parsed = parseProfileBody(
      validProfileBody({ earnedBadgeIds: ["INVALID!", "has space"] }),
    );
    expect(parsed).not.toBeNull();
    // Invalid entries cause the whole array to be treated as unrecognised (falls
    // back to the "not every element is valid" path in parseProfileBody).
    expect(parsed?.earnedBadgeIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseSearchQuery
// ---------------------------------------------------------------------------

describe("parseSearchQuery", () => {
  it("accepts a valid query and trims whitespace", () => {
    expect(parseSearchQuery("  alice  ")).toBe("alice");
    expect(parseSearchQuery("University of Wisconsin")).toBe(
      "University of Wisconsin",
    );
  });

  it("accepts a query at the minimum length (2 chars)", () => {
    expect(parseSearchQuery("ab")).toBe("ab");
  });

  it("accepts a query at exactly 100 chars", () => {
    expect(parseSearchQuery("a".repeat(100))).toBe("a".repeat(100));
  });

  it("rejects a query shorter than 2 chars after trimming", () => {
    expect(parseSearchQuery("a")).toBeNull();
    expect(parseSearchQuery("  a  ")).toBeNull();
    expect(parseSearchQuery("")).toBeNull();
    expect(parseSearchQuery("  ")).toBeNull();
  });

  it("rejects a query longer than 100 chars", () => {
    expect(parseSearchQuery("a".repeat(101))).toBeNull();
  });

  it("rejects non-string values", () => {
    expect(parseSearchQuery(null)).toBeNull();
    expect(parseSearchQuery(42)).toBeNull();
    expect(parseSearchQuery(undefined)).toBeNull();
    expect(parseSearchQuery({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractVerifiedDomain
// ---------------------------------------------------------------------------

describe("extractVerifiedDomain", () => {
  it("returns the domain for an institutional email", () => {
    expect(extractVerifiedDomain("alice@wisc.edu")).toBe("wisc.edu");
    expect(extractVerifiedDomain("bob@nih.gov")).toBe("nih.gov");
    expect(extractVerifiedDomain("carol@ox.ac.uk")).toBe("ox.ac.uk");
    expect(extractVerifiedDomain("dave@mit.edu")).toBe("mit.edu");
  });

  it("returns null for consumer email providers", () => {
    expect(extractVerifiedDomain("alice@gmail.com")).toBeNull();
    expect(extractVerifiedDomain("alice@googlemail.com")).toBeNull();
    expect(extractVerifiedDomain("alice@outlook.com")).toBeNull();
    expect(extractVerifiedDomain("alice@hotmail.com")).toBeNull();
    expect(extractVerifiedDomain("alice@yahoo.com")).toBeNull();
    expect(extractVerifiedDomain("alice@icloud.com")).toBeNull();
    expect(extractVerifiedDomain("alice@proton.me")).toBeNull();
    expect(extractVerifiedDomain("alice@protonmail.com")).toBeNull();
    expect(extractVerifiedDomain("alice@live.com")).toBeNull();
    expect(extractVerifiedDomain("alice@msn.com")).toBeNull();
    expect(extractVerifiedDomain("alice@me.com")).toBeNull();
    expect(extractVerifiedDomain("alice@mac.com")).toBeNull();
    expect(extractVerifiedDomain("alice@aol.com")).toBeNull();
    expect(extractVerifiedDomain("alice@yandex.com")).toBeNull();
    expect(extractVerifiedDomain("alice@gmx.com")).toBeNull();
  });

  it("is case-insensitive for the domain part", () => {
    expect(extractVerifiedDomain("alice@GMAIL.COM")).toBeNull();
    expect(extractVerifiedDomain("alice@WISC.EDU")).toBe("wisc.edu");
  });

  it("returns null when there is no @ sign", () => {
    expect(extractVerifiedDomain("notanemail")).toBeNull();
  });

  it("uses the last @ as the domain split point", () => {
    // Unusual but valid: double @ in local part (quoted) — last @ wins.
    expect(extractVerifiedDomain("alice@foo@wisc.edu")).toBe("wisc.edu");
  });
});

// ---------------------------------------------------------------------------
// DB function shape tests (light mocks, no real Neon connection)
//
// The module-level vi.mock above stubs @neondatabase/serverless so these tests
// never attempt to open a real database connection.
// ---------------------------------------------------------------------------

import {
  upsertProfile,
  deleteProfile,
  getProfileByFingerprint,
} from "../db";

describe("upsertProfile / deleteProfile shape", () => {
  it("upsertProfile resolves without throwing (mocked sql)", async () => {
    // DATABASE_URL is not set in the test environment, but the neon() call is
    // mocked at the module level so getSql() returns the stub function.
    // Set a dummy env var so the getSql guard does not throw.
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://test";
    try {
      await expect(
        upsertProfile({
          fingerprint: "1a2b 3c4d 5e6f 7a8b",
          displayName: "Alice",
          affiliation: "UW-Madison",
          affiliationDomain: "wisc.edu",
          orcid: null,
          pinnedWorks: [],
          hiddenWorks: [],
          notifyOnCollabInvite: true,
          earnedBadgeIds: ["founding-lab"],
          pinnedBadgeIds: ["founding-lab"],
        }),
      ).resolves.toBeUndefined();
    } finally {
      process.env.DATABASE_URL = original;
    }
  });

  it("deleteProfile resolves without throwing (mocked sql)", async () => {
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://test";
    try {
      await expect(
        deleteProfile("1a2b 3c4d 5e6f 7a8b"),
      ).resolves.toBeUndefined();
    } finally {
      process.env.DATABASE_URL = original;
    }
  });

  it("getProfileByFingerprint returns null when sql returns empty (mocked)", async () => {
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://test";
    try {
      const result = await getProfileByFingerprint("unknown-fp");
      expect(result).toBeNull();
    } finally {
      process.env.DATABASE_URL = original;
    }
  });
});
