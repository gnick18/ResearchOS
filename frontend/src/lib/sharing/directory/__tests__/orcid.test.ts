// Tests for the ORCID hybrid login backend (section 18.7):
//   - linkOrcid / getEmailHashByOrcid round-trip in db.ts
//   - resolveEmailHash helper in the profile route

import { describe, expect, it, vi } from "vitest";

// Module-level mock for @neondatabase/serverless. vitest hoists vi.mock calls
// to the top of the file regardless of where they appear in source, so the
// mock is in effect for all imports below, including the re-imported db module.
//
// The neon() factory returns a vi.fn() tag. Individual tests that need to
// control the return value can call the factory and override the mock on the
// shared tag via mockResolvedValueOnce.
vi.mock("@neondatabase/serverless", () => {
  const tag = vi.fn().mockResolvedValue([]);
  return { neon: () => tag };
});

// Mock auth so the route module imports without a real NextAuth setup.
vi.mock("@/lib/sharing/auth", () => ({
  auth: vi.fn().mockResolvedValue(null),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: {},
}));

// Stub out the guard utilities the profile route uses.
vi.mock("@/lib/sharing/directory/guard", () => ({
  getPepper: () => "test-pepper-exactly-32bytes-here!",
  isSharingEnabled: () => true,
  extractClientIp: () => "127.0.0.1",
  json: (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status }),
}));

vi.mock("@/lib/sharing/directory/ratelimit", () => ({
  getIpLimiter: () => ({ limit: async () => ({ success: true }) }),
  getSearchLimiter: () => ({ limit: async () => ({ success: true }) }),
}));

// ---------------------------------------------------------------------------
// DB round-trip tests: linkOrcid / getEmailHashByOrcid
// ---------------------------------------------------------------------------

import {
  linkOrcid,
  getEmailHashByOrcid,
} from "../db";
import { neon } from "@neondatabase/serverless";

// The module-level mock created a shared tag function; grab it.
const sharedTag = neon("ignored");

// Helper that temporarily sets DATABASE_URL so getSql() does not throw.
async function withDb<T>(fn: () => Promise<T>): Promise<T> {
  const original = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://test";
  try {
    return await fn();
  } finally {
    process.env.DATABASE_URL = original;
  }
}

describe("linkOrcid", () => {
  it("resolves without throwing when sql is mocked (new insert)", async () => {
    await withDb(async () => {
      await expect(
        linkOrcid("0000-0002-1825-0097", "abc123hash"),
      ).resolves.toBeUndefined();
    });
  });

  it("resolves without throwing for a second call (upsert path)", async () => {
    await withDb(async () => {
      await expect(
        linkOrcid("0000-0002-1825-0097", "differenthash"),
      ).resolves.toBeUndefined();
    });
  });
});

describe("getEmailHashByOrcid", () => {
  it("returns null when sql returns an empty array (no link found)", async () => {
    (sharedTag as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    await withDb(async () => {
      const result = await getEmailHashByOrcid("0000-0002-1825-0097");
      expect(result).toBeNull();
    });
  });

  it("returns the email_hash when sql returns a matching row", async () => {
    (sharedTag as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { email_hash: "peppered-hash-xyz" },
    ]);
    await withDb(async () => {
      const result = await getEmailHashByOrcid("0000-0002-1825-0097");
      expect(result).toBe("peppered-hash-xyz");
    });
  });
});

// ---------------------------------------------------------------------------
// resolveEmailHash helper tests (pure logic, real db module with neon mocked)
//
// We import resolveEmailHash from the profile route. It is exported as a named
// export specifically to enable unit testing.
// ---------------------------------------------------------------------------

import { resolveEmailHash } from "@/app/api/directory/profile/route";
import type { Session } from "next-auth";

function makeEmailSession(email: string): Session {
  return {
    user: { email, name: null, image: null },
    expires: "2099-01-01T00:00:00.000Z",
  };
}

function makeOrcidSession(orcidId: string): Session {
  return {
    user: { email: null, name: null, image: null },
    expires: "2099-01-01T00:00:00.000Z",
    orcidId,
  };
}

describe("resolveEmailHash", () => {
  it("returns a non-null hash string for an email session", async () => {
    const result = await resolveEmailHash(makeEmailSession("alice@wisc.edu"));
    expect(result).not.toBeNull();
    expect(typeof result).toBe("string");
    expect(result!.length).toBeGreaterThan(0);
  });

  it("returns different hashes for different emails (pepper + HMAC)", async () => {
    const h1 = await resolveEmailHash(makeEmailSession("alice@wisc.edu"));
    const h2 = await resolveEmailHash(makeEmailSession("bob@mit.edu"));
    expect(h1).not.toBe(h2);
  });

  it("returns the ORCID-resolved hash for an ORCID session", async () => {
    // resolveEmailHash calls ensureOrcidSchema (3 sql calls: CREATE TABLE +
    // CREATE INDEX + ALTER TABLE ADD COLUMN email_enc) then getEmailHashByOrcid
    // (1 sql call). Queue 4 responses: the first three are consumed by
    // ensureOrcidSchema, the fourth is the row.
    const tag = sharedTag as unknown as ReturnType<typeof vi.fn>;
    tag.mockResolvedValueOnce([]); // CREATE TABLE
    tag.mockResolvedValueOnce([]); // CREATE INDEX
    tag.mockResolvedValueOnce([]); // ALTER TABLE ADD COLUMN email_enc
    tag.mockResolvedValueOnce([{ email_hash: "orcid-resolved-hash" }]);
    await withDb(async () => {
      const result = await resolveEmailHash(
        makeOrcidSession("0000-0002-1825-0097"),
      );
      expect(result).toBe("orcid-resolved-hash");
    });
  });

  it("returns null when the ORCID session has no matching link", async () => {
    // Same 4-call sequence; the SELECT returns empty (no link found).
    const tag = sharedTag as unknown as ReturnType<typeof vi.fn>;
    tag.mockResolvedValueOnce([]); // CREATE TABLE
    tag.mockResolvedValueOnce([]); // CREATE INDEX
    tag.mockResolvedValueOnce([]); // ALTER TABLE ADD COLUMN email_enc
    tag.mockResolvedValueOnce([]); // SELECT — empty
    await withDb(async () => {
      const result = await resolveEmailHash(
        makeOrcidSession("0000-0000-0000-0000"),
      );
      expect(result).toBeNull();
    });
  });

  it("returns null when the session has neither email nor orcidId", async () => {
    const session: Session = {
      user: { email: null, name: null, image: null },
      expires: "2099-01-01T00:00:00.000Z",
    };
    const result = await resolveEmailHash(session);
    expect(result).toBeNull();
  });

  it("returns null for a null session", async () => {
    const result = await resolveEmailHash(null);
    expect(result).toBeNull();
  });
});
