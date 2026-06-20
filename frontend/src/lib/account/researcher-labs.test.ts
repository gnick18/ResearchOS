// Unit tests for getResearcherPublicLabs.
//
// The helper is pure server-side DB code. We mock the Neon driver so no real
// database is needed. Each test wires up the mock sql() call responses to verify
// the correct join / privacy filtering logic.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We intercept the neon() call with a module-level mock (hoisted by vitest).
// The mock factory captures `mockSql` by reference so per-test mockResolvedValueOnce
// calls are visible to the module under test.
const mockSql = vi.fn();

vi.mock("@neondatabase/serverless", () => ({
  neon: () => mockSql,
}));

// DATABASE_URL must be a non-empty string so getSql() doesn't throw before
// calling neon() (the url check happens before the neon() call). The neon
// driver itself is mocked above, so the string never reaches a real connection.
const ORIG_DB_URL = process.env.DATABASE_URL;

beforeEach(() => {
  process.env.DATABASE_URL = "postgres://test/test";
  mockSql.mockReset();
  vi.resetModules();
});

afterEach(() => {
  process.env.DATABASE_URL = ORIG_DB_URL;
});

async function importHelper() {
  const mod = await import("./researcher-labs");
  return mod.getResearcherPublicLabs;
}

describe("getResearcherPublicLabs", () => {
  it("returns empty array for an empty handle", async () => {
    const fn = await importHelper();
    expect(await fn("")).toEqual([]);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("returns empty array when handle not found in account_profiles", async () => {
    // First call: owner_key lookup -> empty
    mockSql.mockResolvedValueOnce([]);

    const fn = await importHelper();
    const result = await fn("unknown");
    expect(result).toEqual([]);
    // Only one SQL call (the owner_key lookup); the join query is never reached
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it("returns empty array when researcher has no listed lab memberships", async () => {
    // owner_key lookup returns a key
    mockSql.mockResolvedValueOnce([{ owner_key: "key_alice" }]);
    // joined query returns no rows (no active memberships or all unlisted)
    mockSql.mockResolvedValueOnce([]);

    const fn = await importHelper();
    const result = await fn("alice");
    expect(result).toEqual([]);
  });

  it("returns a member lab (isPi false) when researcher has an active billing membership", async () => {
    mockSql.mockResolvedValueOnce([{ owner_key: "key_member" }]);
    mockSql.mockResolvedValueOnce([
      {
        name: "Fungal Genomics Lab",
        institution: "UW-Madison",
        slug: "fungal-genomics",
        pi_key: "key_pi",
        researcher_key: "key_member",
      },
    ]);

    const fn = await importHelper();
    const result = await fn("member_user");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "Fungal Genomics Lab",
      institution: "UW-Madison",
      slug: "fungal-genomics",
      isPi: false,
    });
  });

  it("returns a PI lab (isPi true) when researcher owns the listed lab", async () => {
    const piKey = "key_pi_owner";
    mockSql.mockResolvedValueOnce([{ owner_key: piKey }]);
    mockSql.mockResolvedValueOnce([
      {
        name: "Plant Pathology Lab",
        institution: "UW-Madison",
        slug: "plant-path",
        pi_key: piKey,
        researcher_key: piKey,
      },
    ]);

    const fn = await importHelper();
    const result = await fn("pi_user");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "Plant Pathology Lab",
      institution: "UW-Madison",
      slug: "plant-path",
      isPi: true,
    });
  });

  it("sets slug to null when the lab has no companion site", async () => {
    mockSql.mockResolvedValueOnce([{ owner_key: "key_x" }]);
    mockSql.mockResolvedValueOnce([
      {
        name: "No-Site Lab",
        institution: null,
        slug: null,
        pi_key: "key_pi2",
        researcher_key: "key_x",
      },
    ]);

    const fn = await importHelper();
    const result = await fn("user_x");
    expect(result).toHaveLength(1);
    expect(result[0].slug).toBeNull();
    expect(result[0].name).toBe("No-Site Lab");
  });

  it("returns multiple labs sorted by name", async () => {
    mockSql.mockResolvedValueOnce([{ owner_key: "key_multi" }]);
    mockSql.mockResolvedValueOnce([
      {
        name: "Alpha Lab",
        institution: null,
        slug: "alpha-lab",
        pi_key: "key_pi_a",
        researcher_key: "key_multi",
      },
      {
        name: "Beta Lab",
        institution: "MIT",
        slug: null,
        pi_key: "key_pi_b",
        researcher_key: "key_multi",
      },
    ]);

    const fn = await importHelper();
    const result = await fn("multi_user");
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Alpha Lab");
    expect(result[1].name).toBe("Beta Lab");
    expect(result[0].isPi).toBe(false);
    expect(result[1].isPi).toBe(false);
  });

  it("normalizes handles (strips @ and lowercases)", async () => {
    // Expect the SQL to be called with the normalized handle 'alice'
    mockSql.mockResolvedValueOnce([{ owner_key: "key_alice" }]);
    mockSql.mockResolvedValueOnce([]);

    const fn = await importHelper();
    await fn("@Alice");

    // Tagged template literal: args[0] is the strings array, args[1..] are interpolated values.
    // The handle value is the second argument (index 1).
    const firstCallArgs = mockSql.mock.calls[0];
    expect(firstCallArgs[1]).toBe("alice");
  });
});
