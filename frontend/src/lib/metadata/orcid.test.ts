// frontend/src/lib/metadata/orcid.test.ts
//
// Unit tests for the ORCID iD helpers (metadata implementation bot,
// 2026-05-28): the MOD 11-2 checksum validator, the check-digit computation
// (including the "X" = 10 case), and the paste-tolerant normalizer.

import { describe, expect, it } from "vitest";
import {
  extractOrcidCore,
  isValidOrcid,
  normalizeOrcid,
  orcidCheckDigit,
  orcidRecordUrl,
} from "./orcid";

describe("orcidCheckDigit - MOD 11-2", () => {
  it("computes the documented digit-result case", () => {
    // 0000-0002-1825-0097 → first 15 digits "000000021825009" → check "7".
    expect(orcidCheckDigit("000000021825009")).toBe("7");
  });

  it("computes the X (= 10) check digit", () => {
    // 0000-0002-1694-233X is a well-known valid ORCID whose check char is X.
    expect(orcidCheckDigit("000000021694233")).toBe("X");
  });
});

describe("isValidOrcid - checksum gate", () => {
  it("accepts a valid hyphenated iD", () => {
    expect(isValidOrcid("0000-0002-1825-0097")).toBe(true);
  });

  it("accepts a valid iD whose check digit is X", () => {
    expect(isValidOrcid("0000-0002-1694-233X")).toBe(true);
    // Lower-case x is tolerated (we upper-case before checking).
    expect(isValidOrcid("0000-0002-1694-233x")).toBe(true);
  });

  it("rejects an iD with a wrong check digit", () => {
    // Flip the last digit of a valid iD: 7 → 8.
    expect(isValidOrcid("0000-0002-1825-0098")).toBe(false);
  });

  it("rejects structurally malformed / empty input", () => {
    expect(isValidOrcid("")).toBe(false);
    expect(isValidOrcid("not-an-orcid")).toBe(false);
    expect(isValidOrcid("0000-0002-1825")).toBe(false); // too short
    expect(isValidOrcid(null)).toBe(false);
    expect(isValidOrcid(undefined)).toBe(false);
  });

  it("validates the checksum after extracting from a pasted URL", () => {
    expect(isValidOrcid("https://orcid.org/0000-0002-1825-0097")).toBe(true);
    expect(isValidOrcid("https://orcid.org/0000-0002-1825-0098")).toBe(false);
  });
});

describe("extractOrcidCore - paste extraction", () => {
  it("extracts from the bare hyphenated form", () => {
    expect(extractOrcidCore("0000-0002-1825-0097")).toBe("0000000218250097");
  });

  it("extracts from a no-hyphen run of 16 chars", () => {
    expect(extractOrcidCore("0000000218250097")).toBe("0000000218250097");
  });

  it("extracts from a full https URL", () => {
    expect(extractOrcidCore("https://orcid.org/0000-0002-1825-0097")).toBe(
      "0000000218250097",
    );
  });

  it("extracts from a scheme-less / www / trailing-slash URL", () => {
    expect(extractOrcidCore("orcid.org/0000-0002-1825-0097")).toBe(
      "0000000218250097",
    );
    expect(extractOrcidCore("https://www.orcid.org/0000-0002-1825-0097/")).toBe(
      "0000000218250097",
    );
  });

  it("preserves the trailing X check char (upper-cased)", () => {
    expect(extractOrcidCore("0000-0002-1694-233x")).toBe("000000021694233X");
  });

  it("returns null when the input has the wrong number of ORCID chars", () => {
    expect(extractOrcidCore("0000-0002-1825")).toBeNull(); // 12 chars
    expect(extractOrcidCore("00000002182500970")).toBeNull(); // 17 chars
    expect(extractOrcidCore("")).toBeNull();
    expect(extractOrcidCore(null)).toBeNull();
    expect(extractOrcidCore(undefined)).toBeNull();
  });

  it("rejects an X anywhere but the final position", () => {
    expect(extractOrcidCore("000X-0002-1825-0097")).toBeNull();
  });
});

describe("normalizeOrcid - canonical hyphenated form", () => {
  it("hyphenates a no-hyphen string", () => {
    expect(normalizeOrcid("0000000218250097")).toBe("0000-0002-1825-0097");
  });

  it("strips the orcid.org URL prefix and re-groups", () => {
    expect(normalizeOrcid("https://orcid.org/0000000218250097")).toBe(
      "0000-0002-1825-0097",
    );
  });

  it("is idempotent on the already-canonical form", () => {
    expect(normalizeOrcid("0000-0002-1825-0097")).toBe("0000-0002-1825-0097");
  });

  it("normalizes even when the check digit is wrong (no checksum gate)", () => {
    // The normalizer is structural only; the soft-warning lives in
    // isValidOrcid. A bad-checksum iD still normalizes so the UI can store
    // what the user typed alongside the warning.
    expect(normalizeOrcid("0000-0002-1825-0098")).toBe("0000-0002-1825-0098");
  });

  it("returns null for un-normalizable input", () => {
    expect(normalizeOrcid("garbage")).toBeNull();
    expect(normalizeOrcid("")).toBeNull();
    expect(normalizeOrcid(null)).toBeNull();
  });
});

describe("orcidRecordUrl", () => {
  it("builds the public record URL from any paste form", () => {
    expect(orcidRecordUrl("0000000218250097")).toBe(
      "https://orcid.org/0000-0002-1825-0097",
    );
    expect(orcidRecordUrl("0000-0002-1825-0097")).toBe(
      "https://orcid.org/0000-0002-1825-0097",
    );
  });

  it("returns null when the input can't be normalized", () => {
    expect(orcidRecordUrl("nope")).toBeNull();
    expect(orcidRecordUrl(null)).toBeNull();
  });
});
