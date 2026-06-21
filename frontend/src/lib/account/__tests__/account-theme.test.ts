// Unit tests for getAccountTheme / setAccountTheme in account-profile.ts.
//
// The Neon sql driver is mocked so these tests never hit the network.
// We verify: valid theme values pass through, invalid values are silently
// dropped (no-op), and the SQL issued has the right shape.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";

// The sql singleton is built lazily from DATABASE_URL. We mock the neon module
// so the module-level getSql() call returns a controllable spy instead.
const sqlSpy = vi.fn();
vi.mock("@neondatabase/serverless", () => ({
  neon: () => sqlSpy,
}));

// Provide a fake DATABASE_URL so getSql() does not throw.
process.env.DATABASE_URL = "postgres://test:test@localhost/test";

import { getAccountTheme, setAccountTheme } from "@/lib/account/account-profile";

beforeEach(() => {
  sqlSpy.mockReset();
  // Make sqlSpy behave as a tagged-template-literal function (the neon API).
  // Vitest's vi.fn() does not support that directly, so we delegate to the
  // same spy via a template-tag call shape.
  sqlSpy.mockResolvedValue([]);
});

describe("getAccountTheme", () => {
  it("returns null when no profile row exists", async () => {
    sqlSpy.mockResolvedValue([]);
    const result = await getAccountTheme("owner-key-1");
    expect(result).toBeNull();
  });

  it("returns null when the theme column is null", async () => {
    sqlSpy.mockResolvedValue([{ theme: null }]);
    const result = await getAccountTheme("owner-key-1");
    expect(result).toBeNull();
  });

  it("returns 'dark' when stored", async () => {
    sqlSpy.mockResolvedValue([{ theme: "dark" }]);
    const result = await getAccountTheme("owner-key-1");
    expect(result).toBe("dark");
  });

  it("returns 'light' when stored", async () => {
    sqlSpy.mockResolvedValue([{ theme: "light" }]);
    const result = await getAccountTheme("owner-key-1");
    expect(result).toBe("light");
  });

  it("returns 'system' when stored", async () => {
    sqlSpy.mockResolvedValue([{ theme: "system" }]);
    const result = await getAccountTheme("owner-key-1");
    expect(result).toBe("system");
  });

  it("guards against unknown stored values (future schema drift)", async () => {
    sqlSpy.mockResolvedValue([{ theme: "auto" }]);
    const result = await getAccountTheme("owner-key-1");
    expect(result).toBeNull(); // unknown value treated as not set
  });
});

describe("setAccountTheme", () => {
  // setAccountTheme runs the idempotent ensureAccountProfileSchema (a CREATE +
  // several ALTERs) before the UPDATE, so an exact call count is brittle. Assert
  // the meaningful write instead: the LAST query is the theme UPDATE and the
  // chosen value is the interpolated parameter.
  function lastUpdate() {
    const calls = sqlSpy.mock.calls;
    const last = calls[calls.length - 1];
    const query = (last[0] as readonly string[]).join("?");
    return { query, value: last[1] };
  }

  it("issues the theme UPDATE for a valid 'dark' theme", async () => {
    await setAccountTheme("owner-key-2", "dark");
    const { query, value } = lastUpdate();
    expect(query).toContain("UPDATE account_profiles");
    expect(query).toContain("theme");
    expect(value).toBe("dark");
  });

  it("issues the theme UPDATE for a valid 'light' theme", async () => {
    await setAccountTheme("owner-key-2", "light");
    const { query, value } = lastUpdate();
    expect(query).toContain("UPDATE account_profiles");
    expect(value).toBe("light");
  });

  it("issues the theme UPDATE for a valid 'system' theme", async () => {
    await setAccountTheme("owner-key-2", "system");
    const { value } = lastUpdate();
    expect(value).toBe("system");
  });

  it("silently no-ops for an invalid theme value", async () => {
    await setAccountTheme("owner-key-2", "rainbow");
    // SQL must NOT be called for an invalid theme.
    expect(sqlSpy).not.toHaveBeenCalled();
  });

  it("silently no-ops for an empty string", async () => {
    await setAccountTheme("owner-key-2", "");
    expect(sqlSpy).not.toHaveBeenCalled();
  });
});
