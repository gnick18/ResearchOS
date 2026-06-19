// Tests for storeOrcidEmail / lookupEmailByOrcid in db.ts (section 18.7).
//
// storeOrcidEmail writes BOTH the peppered email_hash (preserved verbatim) and an
// encrypted email_enc (never the plaintext) in one upsert. lookupEmailByOrcid
// decrypts the stored email_enc back to plaintext, and returns null on a missing
// row, a hash-only (null email_enc) legacy row, or an undecryptable blob.
//
// neon is mocked. The store test captures the actual SQL template arguments so it
// can assert what was bound to email_hash and email_enc; the lookup test feeds a
// real ciphertext (produced by the crypto module) back through the SELECT mock to
// prove the full encrypt-then-decrypt path.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The neon() factory returns a single shared tag function. A tagged-template call
// `sql\`...\`` invokes the tag with (stringsArray, ...values), so the captured
// call args let a test read the bound values (the $1, $2, ... placeholders).
vi.mock("@neondatabase/serverless", () => {
  const tag = vi.fn().mockResolvedValue([]);
  return { neon: () => tag };
});

import { storeOrcidEmail, lookupEmailByOrcid } from "../db";
import { encryptOrcidEmail } from "../orcid-email-crypto";
import { neon } from "@neondatabase/serverless";

const sharedTag = neon("ignored") as unknown as ReturnType<typeof vi.fn>;

const KEY = "test-orcid-email-enc-key-at-least-16-chars-long";

async function withDb<T>(fn: () => Promise<T>): Promise<T> {
  const original = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://test";
  try {
    return await fn();
  } finally {
    process.env.DATABASE_URL = original;
  }
}

describe("storeOrcidEmail", () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.ORCID_EMAIL_ENC_KEY;
    process.env.ORCID_EMAIL_ENC_KEY = KEY;
    sharedTag.mockClear();
    sharedTag.mockResolvedValue([]);
  });

  afterEach(() => {
    process.env.ORCID_EMAIL_ENC_KEY = originalKey;
  });

  it("binds the email_hash verbatim and an encrypted (non-plaintext) email_enc", async () => {
    await withDb(async () => {
      await storeOrcidEmail("0000-0002-1825-0097", "alice@wisc.edu", "peppered-hash-abc");
    });

    // The upsert is the single sql call. Its bound values are the tag args after
    // the strings array: orcid_id, email_hash, email_enc.
    expect(sharedTag).toHaveBeenCalledTimes(1);
    const [, orcidId, emailHash, emailEnc] = sharedTag.mock.calls[0];

    expect(orcidId).toBe("0000-0002-1825-0097");
    // The hash is preserved exactly as passed (it is the directory/billing key).
    expect(emailHash).toBe("peppered-hash-abc");
    // The encrypted blob is the versioned form and contains NO plaintext email.
    expect(typeof emailEnc).toBe("string");
    expect(emailEnc).toMatch(/^v1\./);
    expect(emailEnc).not.toContain("alice");
    expect(emailEnc).not.toContain("wisc.edu");
  });
});

describe("lookupEmailByOrcid", () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.ORCID_EMAIL_ENC_KEY;
    process.env.ORCID_EMAIL_ENC_KEY = KEY;
    sharedTag.mockClear();
  });

  afterEach(() => {
    process.env.ORCID_EMAIL_ENC_KEY = originalKey;
  });

  it("decrypts a stored email_enc back to the plaintext email (round-trip)", async () => {
    const email = "alice@wisc.edu";
    const enc = encryptOrcidEmail(email);
    sharedTag.mockResolvedValueOnce([{ email_enc: enc }]);
    await withDb(async () => {
      const result = await lookupEmailByOrcid("0000-0002-1825-0097");
      expect(result).toBe(email);
    });
  });

  it("returns null when no link row exists", async () => {
    sharedTag.mockResolvedValueOnce([]);
    await withDb(async () => {
      const result = await lookupEmailByOrcid("0000-0000-0000-0000");
      expect(result).toBeNull();
    });
  });

  it("returns null for a hash-only legacy row (email_enc is null)", async () => {
    sharedTag.mockResolvedValueOnce([{ email_enc: null }]);
    await withDb(async () => {
      const result = await lookupEmailByOrcid("0000-0002-1825-0097");
      expect(result).toBeNull();
    });
  });

  it("returns null when the stored blob cannot be decrypted", async () => {
    sharedTag.mockResolvedValueOnce([{ email_enc: "v1.deadbeef.cafe.babe" }]);
    await withDb(async () => {
      const result = await lookupEmailByOrcid("0000-0002-1825-0097");
      expect(result).toBeNull();
    });
  });
});
