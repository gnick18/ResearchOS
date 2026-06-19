// Tests for the cross-origin redirector route (api/social/lab-site/goto).
//
// The [labSlug] Server Component page cannot issue a true cross-origin 308 (an
// external redirect() renders a 200 client-side fallback), so it hops same-origin
// here and this handler issues the real 308 to <slug>.research-os.com. These tests
// lock the status code, the Location target, the slug-charset guard, and the
// flag-off inertness.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NextRequest } from "next/server";

import { GET } from "@/app/api/social/lab-site/goto/route";

const ORIGINAL_ENV = { ...process.env };

function reqFor(query: string): NextRequest {
  return new NextRequest(`https://research-os.app/api/social/lab-site/goto${query}`);
}

describe("api/social/lab-site/goto", () => {
  beforeEach(() => {
    // Cutover ON (the handler ANDs the two flags via isLabSitesComOriginEnabled).
    process.env.LAB_SITES_ENABLED = "true";
    process.env.LAB_SITES_COM_ORIGIN = "true";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it("308-redirects a valid slug to the subdomain root", () => {
    const res = GET(reqFor("?slug=fakeyeast-lab"));
    expect(res.status).toBe(308);
    // NextResponse.redirect canonicalizes the bare origin with a trailing slash.
    expect(res.headers.get("location")).toBe(
      "https://fakeyeast-lab.research-os.com/",
    );
  });

  it("normalizes a messy-but-recoverable slug rather than rejecting it", () => {
    // normalizeSlug sanitizes (lowercases, maps non-alphanumerics to dashes), so a
    // recoverable input still lands on a clean subdomain of our own lab domain.
    const res = GET(reqFor("?slug=Smith_Lab"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(
      "https://smith-lab.research-os.com/",
    );
  });

  it("preserves the nested path in the redirect target", () => {
    const res = GET(reqFor("?slug=smithlab&path=results/figure-2"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(
      "https://smithlab.research-os.com/results/figure-2",
    );
  });

  it("strips a leading slash on the path so the target is not doubled", () => {
    const res = GET(reqFor("?slug=smithlab&path=/results"));
    expect(res.headers.get("location")).toBe(
      "https://smithlab.research-os.com/results",
    );
  });

  it("404s a slug that normalizes to empty (never an off-domain redirect)", () => {
    // Only inputs with no recoverable slug content 404. labSiteOrigin always builds
    // a *.research-os.com host, so even a recovered slug can never leave our domain.
    for (const q of ["", "?slug=", "?slug=@@@", "?slug=...", "?slug=---"]) {
      expect(GET(reqFor(q)).status).toBe(404);
    }
  });

  it("404s when the cutover flag is off (inert)", () => {
    process.env.LAB_SITES_COM_ORIGIN = "false";
    expect(GET(reqFor("?slug=fakeyeast-lab")).status).toBe(404);
  });
});
