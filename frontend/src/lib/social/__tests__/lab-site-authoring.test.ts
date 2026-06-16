import { describe, expect, it } from "vitest";

import {
  authorizeWrite,
  parseCreateSiteBody,
  parsePublishPageBody,
  parseUpsertPageBody,
  PAGE_BODY_MAX,
  PAGE_TITLE_MAX,
} from "../lab-site-authoring";

describe("authorizeWrite", () => {
  const OWNER = "owner-abc";

  it("allows an entitled owner writing to their own lab", () => {
    expect(
      authorizeWrite({
        callerOwnerKey: OWNER,
        targetOwnerKey: OWNER,
        entitled: true,
      }),
    ).toEqual({ kind: "allow" });
  });

  it("401s when not signed in (no caller key), before any other check", () => {
    expect(
      authorizeWrite({
        callerOwnerKey: null,
        targetOwnerKey: OWNER,
        entitled: true,
      }),
    ).toEqual({
      kind: "deny",
      status: 401,
      error: "unauthorized",
      reason: "not-signed-in",
    });
  });

  it("403s when targeting another lab (owner mismatch), before entitlement leak", () => {
    expect(
      authorizeWrite({
        callerOwnerKey: OWNER,
        targetOwnerKey: "someone-else",
        entitled: true,
      }),
    ).toEqual({
      kind: "deny",
      status: 403,
      error: "forbidden",
      reason: "not-owner",
    });
  });

  it("403s a signed-in owner who is not entitled", () => {
    expect(
      authorizeWrite({
        callerOwnerKey: OWNER,
        targetOwnerKey: OWNER,
        entitled: false,
      }),
    ).toEqual({
      kind: "deny",
      status: 403,
      error: "forbidden",
      reason: "not-entitled",
    });
  });

  it("checks owner BEFORE entitlement (no billing-state leak about another lab)", () => {
    // Wrong lab + not entitled => the reason must be not-owner, never not-entitled.
    expect(
      authorizeWrite({
        callerOwnerKey: OWNER,
        targetOwnerKey: "other",
        entitled: false,
      }).kind === "deny" &&
        authorizeWrite({
          callerOwnerKey: OWNER,
          targetOwnerKey: "other",
          entitled: false,
        }),
    ).toMatchObject({ reason: "not-owner" });
  });
});

describe("parseCreateSiteBody", () => {
  it("accepts a slug and trims optional institution hints", () => {
    expect(
      parseCreateSiteBody({
        slug: "smithlab",
        institutionShortName: " UW ",
        institutionDomain: " wisc.edu ",
      }),
    ).toEqual({
      slug: "smithlab",
      institutionShortName: "UW",
      institutionDomain: "wisc.edu",
    });
  });

  it("rejects a missing / empty / non-string slug", () => {
    expect(parseCreateSiteBody({})).toBeNull();
    expect(parseCreateSiteBody({ slug: "  " })).toBeNull();
    expect(parseCreateSiteBody({ slug: 5 })).toBeNull();
    expect(parseCreateSiteBody(null)).toBeNull();
    expect(parseCreateSiteBody("smithlab")).toBeNull();
  });
});

describe("parseUpsertPageBody", () => {
  it("accepts a valid body incl the empty home path", () => {
    expect(parseUpsertPageBody({ path: "", title: "Home", bodyMd: "# hi" })).toEqual(
      { path: "", title: "Home", bodyMd: "# hi" },
    );
  });

  it("rejects wrong types and over-cap title / body", () => {
    expect(parseUpsertPageBody({ path: 1, title: "t", bodyMd: "b" })).toBeNull();
    expect(
      parseUpsertPageBody({ path: "p", title: "x".repeat(PAGE_TITLE_MAX + 1), bodyMd: "b" }),
    ).toBeNull();
    expect(
      parseUpsertPageBody({ path: "p", title: "t", bodyMd: "x".repeat(PAGE_BODY_MAX + 1) }),
    ).toBeNull();
  });
});

describe("parsePublishPageBody", () => {
  it("accepts a path (incl empty) and rejects non-strings", () => {
    expect(parsePublishPageBody({ path: "" })).toEqual({ path: "" });
    expect(parsePublishPageBody({ path: "a/b" })).toEqual({ path: "a/b" });
    expect(parsePublishPageBody({})).toBeNull();
    expect(parsePublishPageBody({ path: 3 })).toBeNull();
  });
});
