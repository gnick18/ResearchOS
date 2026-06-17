import { describe, expect, it } from "vitest";

import {
  byoLabFragment,
  contentTypeForPath,
  emptyByoManifest,
  isBenignSkippableEntry,
  labSlugFromHost,
  parseByoManifest,
  resolveByoServePath,
  sanitizeZipEntryPath,
  serializeByoManifest,
  validateByoEntries,
  BYO_DEFAULT_CONTENT_TYPE,
  BYO_INDEX_FILE,
} from "../lab-byo";

const u8 = (n = 4) => new Uint8Array(n);

describe("sanitizeZipEntryPath (zip-slip defense)", () => {
  it("keeps clean relative paths", () => {
    expect(sanitizeZipEntryPath("index.html")).toBe("index.html");
    expect(sanitizeZipEntryPath("assets/app.js")).toBe("assets/app.js");
  });
  it("strips a leading slash + collapses . and empty segments", () => {
    expect(sanitizeZipEntryPath("/index.html")).toBe("index.html");
    expect(sanitizeZipEntryPath("a//./b.css")).toBe("a/b.css");
  });
  it("folds backslashes then rejects traversal", () => {
    expect(sanitizeZipEntryPath("..\\..\\etc")).toBeNull();
    expect(sanitizeZipEntryPath("../../etc/passwd")).toBeNull();
    expect(sanitizeZipEntryPath("a/../../b")).toBeNull();
  });
  it("rejects drive-letter, NUL, directory, and empty entries", () => {
    expect(sanitizeZipEntryPath("C:/x")).toBeNull();
    expect(sanitizeZipEntryPath("a\0b")).toBeNull();
    expect(sanitizeZipEntryPath("dir/")).toBeNull();
    expect(sanitizeZipEntryPath("")).toBeNull();
  });
});

describe("contentTypeForPath", () => {
  it("maps known extensions; unknown -> octet-stream (never executable)", () => {
    expect(contentTypeForPath("index.html")).toContain("text/html");
    expect(contentTypeForPath("a.js")).toContain("text/javascript");
    expect(contentTypeForPath("a.png")).toBe("image/png");
    expect(contentTypeForPath("weird.xyz")).toBe(BYO_DEFAULT_CONTENT_TYPE);
    expect(contentTypeForPath("noext")).toBe(BYO_DEFAULT_CONTENT_TYPE);
  });
});

describe("resolveByoServePath", () => {
  it("roots / directory requests to index.html", () => {
    expect(resolveByoServePath("")).toBe(BYO_INDEX_FILE);
    expect(resolveByoServePath("/")).toBe(BYO_INDEX_FILE);
    expect(resolveByoServePath("/about/")).toBe(`about/${BYO_INDEX_FILE}`);
  });
  it("passes through a file path; rejects traversal", () => {
    expect(resolveByoServePath("assets/app.js")).toBe("assets/app.js");
    expect(resolveByoServePath("/../secret")).toBeNull();
  });
});

describe("labSlugFromHost", () => {
  it("parses a single-label subdomain of the assets domain", () => {
    expect(labSlugFromHost("smithlab.research-os.com")).toBe("smithlab");
    expect(labSlugFromHost("smithlab.research-os.com:443")).toBe("smithlab");
  });
  it("rejects the bare apex, multi-label, the app host, and junk", () => {
    expect(labSlugFromHost("research-os.com")).toBeNull();
    expect(labSlugFromHost("a.b.research-os.com")).toBeNull();
    expect(labSlugFromHost("smithlab.research-os.app")).toBeNull();
    expect(labSlugFromHost(null)).toBeNull();
  });
});

describe("validateByoEntries", () => {
  it("accepts a set with a root index.html, skipping archive noise", () => {
    const r = validateByoEntries([
      { rawPath: "index.html", bytes: u8() },
      { rawPath: "assets/app.js", bytes: u8() },
      { rawPath: "__MACOSX/x", bytes: u8() },
      { rawPath: ".DS_Store", bytes: u8() },
      { rawPath: "sub/", bytes: u8(0) },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.files.map((f) => f.path).sort()).toEqual(["assets/app.js", "index.html"]);
      expect(r.manifest.indexPath).toBe("index.html");
    }
  });
  it("hard-fails the whole upload on a traversal entry", () => {
    const r = validateByoEntries([
      { rawPath: "index.html", bytes: u8() },
      { rawPath: "../evil.js", bytes: u8() },
    ]);
    expect(r).toEqual({ ok: false, error: "bad-entry" });
  });
  it("requires an index.html, and rejects empty", () => {
    expect(validateByoEntries([{ rawPath: "a.js", bytes: u8() }])).toEqual({
      ok: false,
      error: "no-index",
    });
    expect(validateByoEntries([]).ok).toBe(false);
  });
});

describe("isBenignSkippableEntry", () => {
  it("skips dir entries + mac noise, NOT traversal", () => {
    expect(isBenignSkippableEntry("dir/")).toBe(true);
    expect(isBenignSkippableEntry("__MACOSX/x")).toBe(true);
    expect(isBenignSkippableEntry(".DS_Store")).toBe(true);
    expect(isBenignSkippableEntry("../evil")).toBe(false);
  });
});

describe("byoLabFragment + manifest round-trip", () => {
  it("derives a stable safe fragment", () => {
    expect(byoLabFragment("Owner_KEY!!")).toMatch(/^[a-z0-9-]{1,16}$/);
    expect(byoLabFragment("")).toBe("lab");
  });
  it("serializes non-empty, returns null empty, parses defensively", () => {
    expect(serializeByoManifest(emptyByoManifest())).toBeNull();
    const m = { version: 1 as const, indexPath: "index.html", files: [{ path: "index.html", bytes: 10 }], totalBytes: 10 };
    const json = serializeByoManifest(m);
    expect(json).not.toBeNull();
    expect(parseByoManifest(json).files).toHaveLength(1);
    expect(parseByoManifest("{bad").files).toHaveLength(0);
    expect(parseByoManifest({ version: 2 }).files).toHaveLength(0);
  });
  it("drops a manifest entry whose path fails the sanitizer", () => {
    const out = parseByoManifest({ version: 1, indexPath: "index.html", files: [{ path: "../x", bytes: 5 }] });
    expect(out.files).toHaveLength(0);
  });
});
