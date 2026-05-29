import { describe, expect, it } from "vitest";
import {
  decideLandingRedirect,
  type LandingRedirectInput,
} from "../page-landing-redirect";

/**
 * Unit coverage for the Home page's one-shot landing-tab redirect
 * decision (pi-walkthrough hardening, 2026-05-29).
 *
 * The decision is extracted into a pure function so the PI Home
 * migration bounce AND its v4-walkthrough guard can be proven without
 * mounting HomePage. The key regression this locks in: a PI (lab_head,
 * Home hidden) walking the v4 tour must NOT be bounced off "/" to
 * /lab-overview while the tour is on its Home phase.
 */

function input(over: Partial<LandingRedirectInput> = {}): LandingRedirectInput {
  return {
    didLandingRedirect: false,
    currentUser: "mira",
    accountType: "member",
    defaultLandingTab: null,
    showHomeForLabHead: false,
    fromRedirect: null,
    tourActive: false,
    ...over,
  };
}

describe("decideLandingRedirect — in-flight / one-shot guards", () => {
  it("does nothing once the one-shot flag is already set", () => {
    const d = decideLandingRedirect(
      input({ didLandingRedirect: true, accountType: "lab_head" }),
    );
    expect(d).toEqual({ kind: "none", markOneShot: false });
  });

  it("does nothing (and doesn't mark) when there's no user yet", () => {
    const d = decideLandingRedirect(input({ currentUser: "" }));
    expect(d).toEqual({ kind: "none", markOneShot: false });
  });

  it("waits (no mark) while the account-type read is in flight", () => {
    const d = decideLandingRedirect(input({ accountType: undefined }));
    expect(d).toEqual({ kind: "none", markOneShot: false });
  });
});

describe("decideLandingRedirect — PI Home migration bounce", () => {
  it("bounces a lab_head with Home hidden + no override to /lab-overview", () => {
    const d = decideLandingRedirect(
      input({ accountType: "lab_head", showHomeForLabHead: false }),
    );
    expect(d).toEqual({
      kind: "replace",
      to: "/lab-overview",
      markOneShot: true,
    });
  });

  it("keeps a lab_head on Home when they opted Home back in", () => {
    const d = decideLandingRedirect(
      input({ accountType: "lab_head", showHomeForLabHead: true }),
    );
    expect(d).toEqual({ kind: "none", markOneShot: true });
  });

  it("never bounces a member", () => {
    const d = decideLandingRedirect(input({ accountType: "member" }));
    expect(d).toEqual({ kind: "none", markOneShot: true });
  });

  it("an explicit non-Home landing tab wins for a PI too", () => {
    const d = decideLandingRedirect(
      input({ accountType: "lab_head", defaultLandingTab: "/workbench" }),
    );
    expect(d).toEqual({
      kind: "replace",
      to: "/workbench",
      markOneShot: true,
    });
  });
});

describe("decideLandingRedirect — v4 walkthrough guard (the fix)", () => {
  it("does NOT bounce a PI off '/' while the tour is active", () => {
    const d = decideLandingRedirect(
      input({
        accountType: "lab_head",
        showHomeForLabHead: false,
        tourActive: true,
      }),
    );
    // Suppressed AND not marked, so the normal landing behavior can
    // resume on the next clean landing once the tour ends.
    expect(d).toEqual({ kind: "none", markOneShot: false });
  });

  it("suppresses even an explicit-landing-tab bounce while the tour runs", () => {
    const d = decideLandingRedirect(
      input({
        accountType: "lab_head",
        defaultLandingTab: "/workbench",
        tourActive: true,
      }),
    );
    expect(d).toEqual({ kind: "none", markOneShot: false });
  });

  it("resumes the PI bounce normally once the tour ends", () => {
    const d = decideLandingRedirect(
      input({
        accountType: "lab_head",
        showHomeForLabHead: false,
        tourActive: false,
      }),
    );
    expect(d).toEqual({
      kind: "replace",
      to: "/lab-overview",
      markOneShot: true,
    });
  });
});

describe("decideLandingRedirect — ?from sentinel", () => {
  it("honors a ?from bounce-source (stay on Home, mark one-shot)", () => {
    const d = decideLandingRedirect(
      input({ accountType: "lab_head", fromRedirect: "lab-overview" }),
    );
    // The bounce-source already chose Home; the PI bounce must NOT
    // compound on top of it.
    expect(d).toEqual({ kind: "none", markOneShot: true });
  });

  it("the tour guard still wins over a ?from sentinel", () => {
    const d = decideLandingRedirect(
      input({ fromRedirect: "lab-overview", tourActive: true }),
    );
    expect(d).toEqual({ kind: "none", markOneShot: false });
  });
});

describe("decideLandingRedirect — default landing tab '/' ", () => {
  it("stays on Home + marks one-shot when default is '/'", () => {
    const d = decideLandingRedirect(input({ defaultLandingTab: "/" }));
    expect(d).toEqual({ kind: "none", markOneShot: true });
  });
});
