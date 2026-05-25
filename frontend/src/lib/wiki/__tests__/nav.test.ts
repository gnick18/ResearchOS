// frontend/src/lib/wiki/__tests__/nav.test.ts
//
// Regression net for the wiki nav map. Two concerns:
//
//   1. Every value in `APP_ROUTE_TO_WIKI` must point at a real wiki
//      page (an `app/wiki/.../page.tsx` file on disk). The next wiki
//      shuffle that renames or deletes a page would silently break
//      the `?` help icon without this; the test catches it.
//
//   2. `getWikiForRouteWithPrefix` must resolve dynamic routes like
//      `/workbench/projects/<id>` to their documented parent rather
//      than null-coalescing to the wiki landing.
//
// Both run under the node-env vitest project (see vitest.config.mts),
// so the Node `fs` import works directly.

import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  APP_ROUTE_TO_WIKI,
  HELP_HREF,
  appRouteToWikiRoute,
  getWikiForRoute,
  getWikiForRouteWithPrefix,
} from "../nav";

// Resolve a wiki href (e.g. "/wiki/features/projects") to the absolute
// page.tsx path that Next.js would render for it. Tests run from the
// frontend project root, so `process.cwd()` lands at .../frontend.
function wikiHrefToPageFile(href: string): string {
  const rel = href.replace(/^\//, ""); // drop leading slash
  return path.join(process.cwd(), "src", "app", rel, "page.tsx");
}

describe("APP_ROUTE_TO_WIKI", () => {
  it("every mapped wiki target resolves to an existing page.tsx file", () => {
    const missing: Array<{ appRoute: string; wikiTarget: string; file: string }> = [];
    for (const [appRoute, wikiTarget] of Object.entries(APP_ROUTE_TO_WIKI)) {
      const file = wikiHrefToPageFile(wikiTarget);
      if (!existsSync(file)) {
        missing.push({ appRoute, wikiTarget, file });
      }
    }
    expect(missing, `Missing wiki pages for map entries: ${JSON.stringify(missing, null, 2)}`).toEqual([]);
  });

  it("contains the Project Surface prefix entry (Bug 1 fix)", () => {
    expect(APP_ROUTE_TO_WIKI["/workbench/projects"]).toBe("/wiki/features/projects");
  });

  it("does NOT contain the dead /experiments entry (Bug 2 fix)", () => {
    // The /experiments route is a `router.replace("/workbench")` stub
    // with no AppShell; the entry was unreachable.
    expect(APP_ROUTE_TO_WIKI["/experiments"]).toBeUndefined();
  });

  it("still maps /workbench to the Workbench wiki page", () => {
    expect(APP_ROUTE_TO_WIKI["/workbench"]).toBe("/wiki/features/experiments");
  });
});

describe("getWikiForRouteWithPrefix", () => {
  it("returns exact match when present", () => {
    expect(getWikiForRouteWithPrefix("/gantt")).toBe("/wiki/features/gantt");
    expect(getWikiForRouteWithPrefix("/workbench")).toBe("/wiki/features/experiments");
  });

  it("resolves dynamic /workbench/projects/<id> to /wiki/features/projects", () => {
    expect(getWikiForRouteWithPrefix("/workbench/projects/42")).toBe("/wiki/features/projects");
    expect(getWikiForRouteWithPrefix("/workbench/projects/abc-def-123")).toBe("/wiki/features/projects");
  });

  it("falls back through path prefixes to /workbench when the deeper segment is unknown", () => {
    expect(getWikiForRouteWithPrefix("/workbench/unknown-tab")).toBe("/wiki/features/experiments");
  });

  it("resolves to the / (home) entry for unknown top-level routes that have a / mapping", () => {
    // The "/" entry exists and maps to /wiki/features/home, so any
    // top-level walk back will eventually hit it.
    expect(getWikiForRouteWithPrefix("/")).toBe("/wiki/features/home");
  });

  it("returns null when no prefix matches and no / entry would catch it", () => {
    // Pathnames without a leading slash short-circuit cleanly.
    expect(getWikiForRouteWithPrefix("")).toBeNull();
  });
});

describe("appRouteToWikiRoute", () => {
  it("returns the wiki landing for completely unmapped pathnames", () => {
    // Empty string has no prefix to walk; landing fallback kicks in.
    expect(appRouteToWikiRoute("")).toBe(HELP_HREF);
  });

  it("uses prefix-match before falling back to the wiki landing", () => {
    expect(appRouteToWikiRoute("/workbench/projects/42")).toBe("/wiki/features/projects");
  });

  it("returns exact matches unchanged", () => {
    expect(appRouteToWikiRoute("/settings")).toBe("/wiki/features/settings");
  });
});

describe("getWikiForRoute (strict)", () => {
  it("stays exact-match: does NOT prefix-resolve dynamic routes", () => {
    // This is intentional. The demo-mode "Read the docs" button uses
    // this variant and prefers to hide rather than land on a possibly-
    // wrong parent page.
    expect(getWikiForRoute("/workbench/projects/42")).toBeNull();
  });

  it("returns the mapped target for exact matches", () => {
    expect(getWikiForRoute("/workbench/projects")).toBe("/wiki/features/projects");
    expect(getWikiForRoute("/gantt")).toBe("/wiki/features/gantt");
  });
});
