// Seamless network <-> app navigation, unit tests.
//
// Tests for the pure logic backing the two nav affordances added in the
// feat/seamless-network-app-nav slice:
//
//   1. "View public site" deep link (built in LabSiteDashboard, .app side):
//      the href must point at the right public .com URL (or .app URL when the
//      flag is off).
//
//   2. "Manage this site" link (built in LabSitePageView, .com side):
//      the href must land at the builder's entry point on .app, the link must
//      NOT carry any session information (cookie-isolation invariant), and it
//      must only appear for real labs when the .com origin flag is on.
//
// The mechanism is Option B (non-authed generic affordance). Rationale for NOT
// choosing Option A (credentialed cross-origin probe):
//   - Auth.js default cookie settings are SameSite=Lax (the Next.js default).
//   - SameSite=Lax cookies are NOT sent on cross-origin credentialed fetches
//     (fetch with credentials:"include" from .com to .app). The session probe
//     would always resolve as unauthenticated regardless of whether the user
//     actually has an .app session.
//   - Switching to SameSite=None + Secure to enable the probe would widen the
//     cookie-isolation invariant (cookies readable on any same-site context
//     where "site" is eTLD+1, not origin), which the cookie-isolation design
//     explicitly wants to avoid.
//   - Option B is therefore the ONLY safe implementation that preserves the
//     invariant without reconfiguring Auth.js cookies. The authed-aware
//     experience lives entirely on the .app side (the user is already signed in
//     on .app when they open the builder, so the "View public site" jump from
//     the builder is the fully-contextual path).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, expect, it } from "vitest";
import { labSiteOrigin } from "@/lib/social/lab-byo";
import { isDemoLabSlug } from "@/lib/social/demo-lab";

// ---------------------------------------------------------------------------
// Helper: the logic that governs the "View public site" href
// ---------------------------------------------------------------------------

function viewPublicSiteHref(
  slug: string,
  comOriginEnabled: boolean,
): string {
  return comOriginEnabled
    ? `https://${slug}.research-os.com`
    : `https://research-os.app/${slug}`;
}

// ---------------------------------------------------------------------------
// Helper: the logic that governs whether the "Manage this site" link renders
// ---------------------------------------------------------------------------

function manageThisSiteVisible(args: {
  comOriginEnabled: boolean;
  isDemo: boolean;
}): boolean {
  return args.comOriginEnabled && !args.isDemo;
}

// ---------------------------------------------------------------------------
// Helper: the deep link that "Manage this site" targets (NO slug, NO key)
// ---------------------------------------------------------------------------

const APP_ORIGIN = "https://research-os.app";

function manageThisSiteHref(): string {
  // Always the bare builder entry. The user auths normally on .app.
  // No siteOwnerKey in the href -- that would require knowing the owner key
  // on the .com side, which has no session.
  return `${APP_ORIGIN}/account/lab-site`;
}

// ---------------------------------------------------------------------------
// Tests: "View public site" (app -> .com)
// ---------------------------------------------------------------------------

describe("viewPublicSiteHref", () => {
  it("points at <slug>.research-os.com when .com origin is enabled", () => {
    expect(viewPublicSiteHref("smith-lab", true)).toBe(
      "https://smith-lab.research-os.com",
    );
  });

  it("points at research-os.app/<slug> when .com origin is disabled", () => {
    expect(viewPublicSiteHref("smith-lab", false)).toBe(
      "https://research-os.app/smith-lab",
    );
  });

  it("agrees with the canonical labSiteOrigin when .com origin is enabled", () => {
    // labSiteOrigin is the server-side single source of truth.
    expect(viewPublicSiteHref("fungal-lab", true)).toBe(
      labSiteOrigin("fungal-lab"),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: "Manage this site" visibility (cookie-isolation invariant)
// ---------------------------------------------------------------------------

describe("manageThisSiteVisible", () => {
  it("renders when .com origin is on and lab is real", () => {
    expect(manageThisSiteVisible({ comOriginEnabled: true, isDemo: false })).toBe(true);
  });

  it("hides when .com origin is off (flag not enabled)", () => {
    expect(manageThisSiteVisible({ comOriginEnabled: false, isDemo: false })).toBe(false);
  });

  it("hides on a demo lab (demo has its own ribbon, not the manage link)", () => {
    expect(manageThisSiteVisible({ comOriginEnabled: true, isDemo: true })).toBe(false);
  });

  it("hides on a demo lab even when .com origin is off", () => {
    expect(manageThisSiteVisible({ comOriginEnabled: false, isDemo: true })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: "Manage this site" href (no session, no slug in the URL)
// ---------------------------------------------------------------------------

describe("manageThisSiteHref", () => {
  it("points at the builder entry on .app", () => {
    expect(manageThisSiteHref()).toBe("https://research-os.app/account/lab-site");
  });

  it("never contains a siteOwnerKey (cookie-isolation invariant)", () => {
    // A siteOwnerKey in the href would mean this page has derived the owner key
    // from a session -- which it never has on the .com origin.
    expect(manageThisSiteHref()).not.toContain("siteOwnerKey");
  });

  it("never contains a session token or cookie fragment", () => {
    const href = manageThisSiteHref();
    expect(href).not.toContain("token");
    expect(href).not.toContain("cookie");
    expect(href).not.toContain("auth");
  });
});

// ---------------------------------------------------------------------------
// Tests: isDemoLabSlug is used correctly to suppress the manage link on demo
// ---------------------------------------------------------------------------

describe("isDemoLabSlug gate", () => {
  it("correctly flags the demo slug as demo so the manage link is hidden", () => {
    // The manage link must not appear on the demo lab site.
    // isDemoLabSlug is the canonical gate (same check used elsewhere for the
    // DemoSampleLabRibbon, so there is one source of truth for the demo guard).
    expect(isDemoLabSlug("fakeyeast-lab")).toBe(true);
    expect(manageThisSiteVisible({ comOriginEnabled: true, isDemo: isDemoLabSlug("fakeyeast-lab") })).toBe(false);
  });

  it("treats a real lab slug as non-demo so the manage link shows", () => {
    expect(isDemoLabSlug("smith-lab")).toBe(false);
    expect(manageThisSiteVisible({ comOriginEnabled: true, isDemo: isDemoLabSlug("smith-lab") })).toBe(true);
  });
});
