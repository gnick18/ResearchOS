// Unit tests for lab-site-edit-token.ts
//
// Covers: valid round-trip, tampered signature, expired token, wrong-slug
// binding, missing secret, and malformed input. Pure functions only, no
// network or DB. Runs in Node (node:crypto available).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";
import { mintEditToken, verifyEditToken } from "../lab-site-edit-token";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SLUG = "smithlab";
const OWNER_KEY = "abc123ownerkey";
const FAKE_SECRET = "test-secret-that-is-long-enough-for-tests";

function withSecret(fn: () => void): void {
  const original = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = FAKE_SECRET;
  try {
    fn();
  } finally {
    if (original === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = original;
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("mintEditToken", () => {
  it("returns null when AUTH_SECRET is absent", () => {
    const saved = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    try {
      expect(mintEditToken(SLUG, OWNER_KEY)).toBeNull();
    } finally {
      if (saved !== undefined) process.env.AUTH_SECRET = saved;
    }
  });

  it("returns null when AUTH_SECRET is too short", () => {
    const saved = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "short";
    try {
      expect(mintEditToken(SLUG, OWNER_KEY)).toBeNull();
    } finally {
      if (saved !== undefined) process.env.AUTH_SECRET = saved;
      else delete process.env.AUTH_SECRET;
    }
  });

  it("returns a non-empty string when the secret is configured", () => {
    withSecret(() => {
      const token = mintEditToken(SLUG, OWNER_KEY);
      expect(typeof token).toBe("string");
      expect((token ?? "").length).toBeGreaterThan(0);
    });
  });

  it("returns null for empty slug", () => {
    withSecret(() => {
      expect(mintEditToken("", OWNER_KEY)).toBeNull();
    });
  });

  it("returns null for empty ownerKey", () => {
    withSecret(() => {
      expect(mintEditToken(SLUG, "")).toBeNull();
    });
  });
});

describe("verifyEditToken - valid round-trip", () => {
  it("returns the ownerKey for a freshly minted token", () => {
    withSecret(() => {
      const token = mintEditToken(SLUG, OWNER_KEY);
      expect(token).not.toBeNull();
      const result = verifyEditToken(token, SLUG);
      expect(result).toBe(OWNER_KEY);
    });
  });
});

describe("verifyEditToken - tampered signature", () => {
  it("returns null when the signature portion is modified", () => {
    withSecret(() => {
      const token = mintEditToken(SLUG, OWNER_KEY)!;
      // Flip the last character of the signature.
      const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
      expect(verifyEditToken(tampered, SLUG)).toBeNull();
    });
  });

  it("returns null when the payload portion is modified", () => {
    withSecret(() => {
      const token = mintEditToken(SLUG, OWNER_KEY)!;
      // Change a character in the base64url payload (before the last dot).
      const lastDot = token.lastIndexOf(".");
      const payload = token.slice(0, lastDot);
      const sig = token.slice(lastDot + 1);
      const tamperedPayload =
        payload.slice(0, -1) + (payload.endsWith("a") ? "b" : "a");
      const tampered = `${tamperedPayload}.${sig}`;
      expect(verifyEditToken(tampered, SLUG)).toBeNull();
    });
  });
});

describe("verifyEditToken - expired token", () => {
  it("returns null when the token expiry is in the past", () => {
    withSecret(() => {
      // Freeze time so we can mint a token, then advance past expiry.
      const realDateNow = Date.now.bind(Date);
      // Mint with real time so the signature is valid.
      const token = mintEditToken(SLUG, OWNER_KEY)!;
      // Now advance time past the 10-minute TTL.
      const advancedNow = realDateNow() + 11 * 60 * 1000;
      vi.spyOn(Date, "now").mockReturnValue(advancedNow);
      try {
        expect(verifyEditToken(token, SLUG)).toBeNull();
      } finally {
        vi.restoreAllMocks();
      }
    });
  });
});

describe("verifyEditToken - wrong slug", () => {
  it("returns null when verified against a different slug", () => {
    withSecret(() => {
      const token = mintEditToken(SLUG, OWNER_KEY)!;
      expect(verifyEditToken(token, "otherlab")).toBeNull();
    });
  });
});

describe("verifyEditToken - malformed input", () => {
  it("returns null for null input", () => {
    withSecret(() => {
      expect(verifyEditToken(null, SLUG)).toBeNull();
    });
  });

  it("returns null for undefined input", () => {
    withSecret(() => {
      expect(verifyEditToken(undefined, SLUG)).toBeNull();
    });
  });

  it("returns null for an empty string", () => {
    withSecret(() => {
      expect(verifyEditToken("", SLUG)).toBeNull();
    });
  });

  it("returns null for a random garbage string", () => {
    withSecret(() => {
      expect(verifyEditToken("not.a.valid.token.at.all", SLUG)).toBeNull();
    });
  });

  it("returns null for a string with no dot separator", () => {
    withSecret(() => {
      expect(verifyEditToken("nodothere", SLUG)).toBeNull();
    });
  });
});
