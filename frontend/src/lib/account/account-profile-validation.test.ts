// Unit coverage for the pure profile validators (bio + typed links).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, expect, it } from "vitest";
import {
  validateBio,
  normalizeLinks,
  validateAvatar,
  BIO_MAX_CHARS,
  EMPTY_LINKS,
} from "./account-profile-validation";

describe("validateBio", () => {
  it("accepts null, undefined, and short text", () => {
    expect(validateBio(null)).toBeNull();
    expect(validateBio(undefined)).toBeNull();
    expect(validateBio("Yeast geneticist.")).toBeNull();
  });

  it("accepts exactly the cap and rejects over it", () => {
    expect(validateBio("a".repeat(BIO_MAX_CHARS))).toBeNull();
    expect(validateBio("a".repeat(BIO_MAX_CHARS + 1))).toMatch(/under/);
  });

  it("measures after trim", () => {
    expect(validateBio(`  ${"a".repeat(BIO_MAX_CHARS)}  `)).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(validateBio(42)).toMatch(/text/);
  });
});

describe("normalizeLinks", () => {
  it("returns empty links for null/undefined", () => {
    expect(normalizeLinks(null)).toEqual({ ok: true, links: EMPTY_LINKS });
    expect(normalizeLinks(undefined)).toEqual({ ok: true, links: EMPTY_LINKS });
  });

  it("accepts a bare ORCID and uppercases the trailing X", () => {
    const r = normalizeLinks({ orcid: "0000-0002-1825-009x" });
    expect(r).toEqual({
      ok: true,
      links: { orcid: "0000-0002-1825-009X", researchgate: null, website: null },
    });
  });

  it("reduces an orcid.org URL to the bare id", () => {
    const r = normalizeLinks({ orcid: "https://orcid.org/0000-0002-1825-0097/" });
    expect(r.ok && r.links.orcid).toBe("0000-0002-1825-0097");
  });

  it("rejects a malformed ORCID", () => {
    const r = normalizeLinks({ orcid: "not-an-orcid" });
    expect(r.ok).toBe(false);
  });

  it("accepts https URLs for researchgate and website, coercing blanks to null", () => {
    const r = normalizeLinks({
      researchgate: "https://www.researchgate.net/profile/Jane",
      website: "  ",
    });
    expect(r).toEqual({
      ok: true,
      links: {
        orcid: null,
        researchgate: "https://www.researchgate.net/profile/Jane",
        website: null,
      },
    });
  });

  it("rejects a non-URL website", () => {
    const r = normalizeLinks({ website: "yourlab.edu" });
    expect(r.ok).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(normalizeLinks("nope").ok).toBe(false);
  });
});

describe("validateAvatar", () => {
  it("accepts null and an in-cap png data URL", () => {
    expect(validateAvatar(null)).toBeNull();
    expect(validateAvatar("data:image/png;base64,AAAA")).toBeNull();
  });

  it("rejects a non-image data URL", () => {
    expect(validateAvatar("data:text/plain;base64,AAAA")).toMatch(/PNG|JPEG|WEBP/);
  });
});
