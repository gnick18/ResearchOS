import { describe, expect, it } from "vitest";

import {
  normalizePagePath,
  resolvePublicPage,
  PAGE_DEPTH_MAX,
  type ResolvableSlugRow,
} from "../lab-site";

describe("normalizePagePath", () => {
  it("treats undefined / empty as the home page", () => {
    expect(normalizePagePath(undefined)).toBe("");
    expect(normalizePagePath("")).toBe("");
    expect(normalizePagePath([])).toBe("");
  });

  it("keeps a clean slash-joined path", () => {
    expect(normalizePagePath("a/b/c")).toBe("a/b/c");
    expect(normalizePagePath(["a", "b"])).toBe("a/b");
  });

  it("lowercases and dashes non-alphanumerics", () => {
    expect(normalizePagePath("Foo/Bar Baz!")).toBe("foo/bar-baz");
  });

  it("collapses duplicate slashes and strays", () => {
    expect(normalizePagePath("//a//b/")).toBe("a/b");
  });

  it("neutralizes path traversal (dot segments drop out)", () => {
    expect(normalizePagePath(["..", "x"])).toBe("x");
    expect(normalizePagePath("../../etc")).toBe("etc");
    expect(normalizePagePath(["."])).toBe("");
  });

  it("caps depth at PAGE_DEPTH_MAX", () => {
    const deep = Array.from({ length: PAGE_DEPTH_MAX + 5 }, (_, i) => `s${i}`);
    expect(normalizePagePath(deep).split("/")).toHaveLength(PAGE_DEPTH_MAX);
  });

  it("truncates an over-long segment", () => {
    const seg = "a".repeat(120);
    expect(normalizePagePath(seg).length).toBeLessThanOrEqual(64);
  });
});

describe("resolvePublicPage", () => {
  const labSlug: ResolvableSlugRow = {
    slug: "smithlab",
    kind: "lab",
    ownerKey: "owner-1",
  };
  const published = { status: "published" as const };

  it("renders only when flag on + lab slug + site + published page", () => {
    expect(
      resolvePublicPage({
        flagEnabled: true,
        slugRow: labSlug,
        hasSite: true,
        page: published,
      }),
    ).toEqual({ kind: "render" });
  });

  it("404s when the flag is off (inert)", () => {
    expect(
      resolvePublicPage({
        flagEnabled: false,
        slugRow: labSlug,
        hasSite: true,
        page: published,
      }),
    ).toEqual({ kind: "not-found", reason: "flag-off" });
  });

  it("404s when the slug is not in the registry", () => {
    expect(
      resolvePublicPage({
        flagEnabled: true,
        slugRow: null,
        hasSite: false,
        page: null,
      }),
    ).toEqual({ kind: "not-found", reason: "slug-missing" });
  });

  it("404s when the slug exists but is not a lab", () => {
    for (const kind of ["handle", "institution", "reserved"] as const) {
      expect(
        resolvePublicPage({
          flagEnabled: true,
          slugRow: { slug: "x", kind, ownerKey: null },
          hasSite: true,
          page: published,
        }),
      ).toEqual({ kind: "not-found", reason: "slug-not-lab" });
    }
  });

  it("404s when there is no site row for the slug", () => {
    expect(
      resolvePublicPage({
        flagEnabled: true,
        slugRow: labSlug,
        hasSite: false,
        page: null,
      }),
    ).toEqual({ kind: "not-found", reason: "no-site" });
  });

  it("404s when the page does not exist", () => {
    expect(
      resolvePublicPage({
        flagEnabled: true,
        slugRow: labSlug,
        hasSite: true,
        page: null,
      }),
    ).toEqual({ kind: "not-found", reason: "page-missing" });
  });

  it("404s when the page is a draft (only published is public)", () => {
    expect(
      resolvePublicPage({
        flagEnabled: true,
        slugRow: labSlug,
        hasSite: true,
        page: { status: "draft" },
      }),
    ).toEqual({ kind: "not-found", reason: "page-not-published" });
  });
});
