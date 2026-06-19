// Tests for the research-os.com lab-origin router (lab-domains .com cutover).
//
// resolveLabHostRequest is the pure decision behind proxy.ts middleware. It must
// route a lab subdomain's PUBLIC surface (native pages, the BYO bundle under
// /_site, the one public dataset-stream API) and BLOCK every other route there so
// no cookie-setting app/auth route is ever reachable on the cookie-isolated
// origin. On the app origin (and while the flag is off) it is a no-op.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveLabHostRequest } from "./lab-byo";
import { normalizePagePath } from "./lab-site";

const HOST = "fakeyeast-lab.research-os.com";

describe("resolveLabHostRequest", () => {
  it("passes through when the cutover is disabled, even on a lab host", () => {
    expect(
      resolveLabHostRequest({ host: HOST, pathname: "/", enabled: false }),
    ).toEqual({ kind: "passthrough" });
  });

  it("passes through on the app origin (not a lab subdomain)", () => {
    for (const host of [
      "research-os.app",
      "www.research-os.app",
      "localhost:3000",
      "research-os.com",
      "a.b.research-os.com",
    ]) {
      expect(
        resolveLabHostRequest({ host, pathname: "/network", enabled: true }),
      ).toEqual({ kind: "passthrough" });
    }
  });

  it("excludes reserved subdomains (assets, www, api, app)", () => {
    for (const label of ["assets", "www", "api", "app"]) {
      expect(
        resolveLabHostRequest({
          host: `${label}.research-os.com`,
          pathname: "/",
          enabled: true,
        }),
      ).toEqual({ kind: "passthrough" });
    }
  });

  it("rewrites the subdomain root to the native lab home", () => {
    expect(
      resolveLabHostRequest({ host: HOST, pathname: "/", enabled: true }),
    ).toEqual({ kind: "rewrite-native", slug: "fakeyeast-lab", path: "/" });
  });

  it("rewrites a nested native page path", () => {
    expect(
      resolveLabHostRequest({ host: HOST, pathname: "/people", enabled: true }),
    ).toEqual({ kind: "rewrite-native", slug: "fakeyeast-lab", path: "/people" });
  });

  it("routes the /_site bundle index and nested files to BYO serve", () => {
    expect(
      resolveLabHostRequest({ host: HOST, pathname: "/_site", enabled: true }),
    ).toEqual({ kind: "rewrite-byo", slug: "fakeyeast-lab", path: "" });
    expect(
      resolveLabHostRequest({
        host: HOST,
        pathname: "/_site/assets/app.js",
        enabled: true,
      }),
    ).toEqual({
      kind: "rewrite-byo",
      slug: "fakeyeast-lab",
      path: "assets/app.js",
    });
  });

  it("allows ONLY the public dataset-stream API on the lab origin", () => {
    expect(
      resolveLabHostRequest({
        host: HOST,
        pathname: "/api/social/lab-site/asset/read",
        enabled: true,
      }),
    ).toEqual({ kind: "allow-api" });
  });

  it("blocks every other API on the cookie-isolated lab origin", () => {
    for (const pathname of [
      "/api/auth/session",
      "/api/auth/callback/google",
      "/api/admin/operator-login",
      "/api/social/lab-site/byo/route",
      "/api",
    ]) {
      expect(
        resolveLabHostRequest({ host: HOST, pathname, enabled: true }),
      ).toEqual({ kind: "block" });
    }
  });
});

describe("native vs BYO reserved-path carve-out", () => {
  it("normalizePagePath can never produce the reserved /_site prefix", () => {
    // The carve relies on the normalizer stripping leading underscores, so a
    // native page path can never collide with the BYO prefix.
    expect(normalizePagePath("_site")).toBe("site");
    expect(normalizePagePath("_site/assets")).toBe("site/assets");
    expect(normalizePagePath("_site")).not.toBe("_site");
  });
});

describe("cookie-isolation guard", () => {
  // The .com origin isolation also relies on no app cookie carrying a parent
  // Domain= attribute. NextAuth must stay host-only (no cookies.*.domain) and the
  // operator cookie must not set Domain=. These string guards fail CI if a future
  // change broadens cookie scope across registrable domains.
  const here = dirname(fileURLToPath(import.meta.url));
  const read = (rel: string) => readFileSync(join(here, rel), "utf8");

  it("NextAuth config defines no cookies override (so the session cookie stays host-only)", () => {
    // A parent-domain session cookie could only be introduced via a `cookies:`
    // config block. Asserting none exists keeps the cookie host-only by default.
    const auth = read("../sharing/auth.ts");
    expect(auth).not.toMatch(/\bcookies\s*:/);
  });

  it("the operator-login cookie sets no Domain= attribute", () => {
    const route = read("../../app/api/admin/operator-login/route.ts");
    expect(route.toLowerCase()).not.toContain("domain=");
  });
});
