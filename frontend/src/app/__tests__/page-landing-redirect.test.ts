import { describe, expect, it } from "vitest";
import {
  decideLandingRedirect,
  type LandingRedirectInput,
} from "../page-landing-redirect";

/**
 * Unit coverage for the "/" landing-tab redirect decision.
 *
 * Widget-framework teardown v2 (2026-06-02): "/" stopped rendering the
 * widget canvas, so it is now a pure router. A lab_head bounces to the
 * curated /lab-overview; everyone else bounces to /workbench. An explicit
 * non-"/" default landing tab still wins over the role default. The
 * v4-walkthrough guard is retained: a user walking the tour must NOT be
 * bounced off "/" while the tour drives the browser there.
 */

function input(over: Partial<LandingRedirectInput> = {}): LandingRedirectInput {
  return {
    suppress: false,
    currentUser: "mira",
    isLabHead: false,
    defaultLandingTab: null,
    fromRedirect: null,
    tourActive: false,
    ...over,
  };
}

describe("decideLandingRedirect — in-flight / suppress guards", () => {
  it("does nothing while a deep-link / open popup suppresses the bounce", () => {
    const d = decideLandingRedirect(
      input({ suppress: true, isLabHead: true }),
    );
    expect(d).toEqual({ kind: "none", markOneShot: false });
  });

  it("does nothing (and doesn't mark) when there's no user yet", () => {
    const d = decideLandingRedirect(input({ currentUser: "" }));
    expect(d).toEqual({ kind: "none", markOneShot: false });
  });

  it("waits (no mark) while the lab-head read is in flight", () => {
    const d = decideLandingRedirect(input({ isLabHead: undefined }));
    expect(d).toEqual({ kind: "none", markOneShot: false });
  });
});

describe("decideLandingRedirect — role-based bounce", () => {
  it("bounces a lab_head to the curated /lab-overview", () => {
    const d = decideLandingRedirect(input({ isLabHead: true }));
    expect(d).toEqual({
      kind: "replace",
      to: "/lab-overview",
      markOneShot: true,
    });
  });

  it("bounces a lab_head in My-work mode to /workbench (NAV-2)", () => {
    const d = decideLandingRedirect(
      input({ isLabHead: true, piViewMode: "my-work" }),
    );
    expect(d).toEqual({
      kind: "replace",
      to: "/workbench",
      markOneShot: true,
    });
  });

  it("keeps a lab_head in the lab lens on /lab-overview (explicit lab mode)", () => {
    const d = decideLandingRedirect(
      input({ isLabHead: true, piViewMode: "lab" }),
    );
    expect(d).toEqual({
      kind: "replace",
      to: "/lab-overview",
      markOneShot: true,
    });
  });

  it("bounces a member to /workbench", () => {
    const d = decideLandingRedirect(input({ isLabHead: false }));
    expect(d).toEqual({
      kind: "replace",
      to: "/workbench",
      markOneShot: true,
    });
  });

  it("an explicit non-'/' landing tab wins over the role default", () => {
    const d = decideLandingRedirect(
      input({ isLabHead: true, defaultLandingTab: "/methods" }),
    );
    expect(d).toEqual({
      kind: "replace",
      to: "/methods",
      markOneShot: true,
    });
  });
});

describe("decideLandingRedirect — v4 walkthrough guard", () => {
  it("does NOT bounce off '/' while the tour is active", () => {
    const d = decideLandingRedirect(
      input({
        isLabHead: true,
        defaultLandingTab: "/workbench",
        tourActive: true,
      }),
    );
    // Suppressed AND not marked, so the normal landing behavior can
    // resume on the next clean landing once the tour ends.
    expect(d).toEqual({ kind: "none", markOneShot: false });
  });

  it("resumes the redirect normally once the tour ends", () => {
    const d = decideLandingRedirect(
      input({
        isLabHead: true,
        defaultLandingTab: "/workbench",
        tourActive: false,
      }),
    );
    expect(d).toEqual({
      kind: "replace",
      to: "/workbench",
      markOneShot: true,
    });
  });
});

describe("decideLandingRedirect — ?from sentinel loop guard", () => {
  it("a non-PI bounced off /lab-overview lands on the role default /workbench", () => {
    const d = decideLandingRedirect(
      input({ isLabHead: false, fromRedirect: "lab-overview" }),
    );
    expect(d).toEqual({
      kind: "replace",
      to: "/workbench",
      markOneShot: true,
    });
  });

  it("ignores an explicit landing tab that equals the bounce-source (avoids ping-pong)", () => {
    // A member who configured /lab-overview as their landing tab but is
    // not a PI gets bounced off it; the explicit-tab rule must not send
    // them straight back. Falls through to the role default.
    const d = decideLandingRedirect(
      input({
        isLabHead: false,
        defaultLandingTab: "/lab-overview",
        fromRedirect: "lab-overview",
      }),
    );
    expect(d).toEqual({
      kind: "replace",
      to: "/workbench",
      markOneShot: true,
    });
  });

  it("the tour guard still wins over a ?from sentinel", () => {
    const d = decideLandingRedirect(
      input({ fromRedirect: "lab-overview", tourActive: true }),
    );
    expect(d).toEqual({ kind: "none", markOneShot: false });
  });
});

describe("decideLandingRedirect — default landing tab '/'", () => {
  it("treats default '/' as no explicit tab and applies the role default", () => {
    const d = decideLandingRedirect(
      input({ isLabHead: false, defaultLandingTab: "/" }),
    );
    expect(d).toEqual({
      kind: "replace",
      to: "/workbench",
      markOneShot: true,
    });
  });
});
