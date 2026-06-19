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

import {
  resolveLabHostRequest,
  isLabPublicHost,
  resolveAppOriginLabRedirect,
} from "./lab-byo";
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

describe("isLabPublicHost (client gate bypass)", () => {
  // The app's global client gate (AppContent) skips the folder / welcome wall on a
  // lab origin off this predicate, so the server-rendered lab page is not overlaid
  // by WelcomePage after hydration. It must agree with resolveLabHostRequest about
  // what counts as a lab origin, and be inert when the cutover is off.
  it("is false when the cutover is disabled, even on a lab host", () => {
    expect(isLabPublicHost({ host: HOST, enabled: false })).toBe(false);
  });

  it("is true for a real lab subdomain when enabled", () => {
    expect(isLabPublicHost({ host: HOST, enabled: true })).toBe(true);
    expect(
      isLabPublicHost({ host: "smith-lab.research-os.com:443", enabled: true }),
    ).toBe(true);
  });

  it("is false on the app origin, the apex, and reserved subdomains", () => {
    for (const host of [
      "research-os.app",
      "research-os.com",
      "www.research-os.com",
      "assets.research-os.com",
      "api.research-os.com",
      "app.research-os.com",
      "a.b.research-os.com",
      null,
      undefined,
    ]) {
      expect(isLabPublicHost({ host, enabled: true })).toBe(false);
    }
  });

  it("agrees with resolveLabHostRequest on whether a host is a lab origin", () => {
    for (const host of [HOST, "research-os.app", "assets.research-os.com"]) {
      const action = resolveLabHostRequest({ host, pathname: "/", enabled: true });
      const isLabOrigin = action.kind !== "passthrough";
      expect(isLabPublicHost({ host, enabled: true })).toBe(isLabOrigin);
    }
  });
});

describe("resolveAppOriginLabRedirect (app-origin -> subdomain 308)", () => {
  const APP = "research-os.app";
  // The middleware uses this to 308 an old research-os.app/<slug> link to the
  // subdomain. It must redirect real lab slugs, never a reserved app route, and be
  // inert off-flag / on a subdomain.
  it("is null when the cutover is disabled", () => {
    expect(
      resolveAppOriginLabRedirect({ host: APP, pathname: "/smithlab", enabled: false }),
    ).toBeNull();
  });

  it("redirects a real lab slug on the app origin to its subdomain", () => {
    expect(
      resolveAppOriginLabRedirect({ host: APP, pathname: "/smithlab", enabled: true }),
    ).toBe("https://smithlab.research-os.com");
  });

  it("preserves the sub-path after the slug", () => {
    expect(
      resolveAppOriginLabRedirect({
        host: APP,
        pathname: "/smithlab/results/figure-2",
        enabled: true,
      }),
    ).toBe("https://smithlab.research-os.com/results/figure-2");
  });

  it("does NOT redirect a root STATIC FILE (the frappe-gantt.css regression)", () => {
    // The matcher excludes .svg/.png but not .css/.txt/.xml/.json, so these reach
    // the middleware. The first segment has a dot, so it must pass through. An
    // earlier normalizeSlug-first version turned "frappe-gantt.css" into the
    // slug-shaped "frappe-gantt-css" and 308ed it to a phantom subdomain, breaking
    // the Gantt stylesheet + robots/sitemap/manifest in prod.
    for (const p of [
      "/frappe-gantt.css",
      "/robots.txt",
      "/sitemap.xml",
      "/manifest.json",
      "/sw.js",
      "/something.map",
    ]) {
      expect(
        resolveAppOriginLabRedirect({ host: APP, pathname: p, enabled: true }),
      ).toBeNull();
    }
  });

  it("does NOT redirect a mixed-case / underscored path (not a real lab link)", () => {
    // A real lab citation link uses the stored, already-lowercase slug, so anything
    // needing normalization is not a lab link and must pass through (no rescue).
    for (const p of ["/Smith_Lab", "/SmithLab", "/lab_one"]) {
      expect(
        resolveAppOriginLabRedirect({ host: APP, pathname: p, enabled: true }),
      ).toBeNull();
    }
  });

  it("never redirects a reserved app route (so the app keeps working)", () => {
    for (const p of [
      "/",
      "/datahub",
      "/settings",
      "/api/whatever",
      "/network",
      "/figures",
      "/about",
      "/admin",
      "/demo",
      "/lab-overview",
    ]) {
      expect(
        resolveAppOriginLabRedirect({ host: APP, pathname: p, enabled: true }),
      ).toBeNull();
    }
  });

  it("is null on a lab subdomain (resolveLabHostRequest owns that)", () => {
    expect(
      resolveAppOriginLabRedirect({
        host: "smithlab.research-os.com",
        pathname: "/results",
        enabled: true,
      }),
    ).toBeNull();
  });

  it("agrees with RESERVED route handling: a reserved-vs-real split", () => {
    // A reserved segment passes through (null), a non-reserved slug redirects.
    expect(
      resolveAppOriginLabRedirect({ host: APP, pathname: "/inventory", enabled: true }),
    ).toBeNull();
    expect(
      resolveAppOriginLabRedirect({ host: APP, pathname: "/castellanos-lab", enabled: true }),
    ).toBe("https://castellanos-lab.research-os.com");
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
