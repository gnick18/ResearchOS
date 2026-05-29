import { describe, expect, it } from "vitest";
import {
  decideLandingRedirect,
  type LandingRedirectInput,
} from "../page-landing-redirect";

/**
 * Unit coverage for the dashboard's one-shot landing-tab redirect
 * decision.
 *
 * Dashboard unification (dashboard-unification build, 2026-05-29): Home
 * and Lab Overview collapsed into ONE dashboard at "/", so the old
 * lab_head -> /lab-overview landing special-case (and the
 * `showHomeForLabHead` opt-back-in) are gone. Every account type now
 * lands on "/" unless they set an explicit non-"/" default landing tab.
 * The v4-walkthrough guard is retained: a user walking the tour must NOT
 * be bounced off "/" while the tour is on its dashboard phase.
 */

function input(over: Partial<LandingRedirectInput> = {}): LandingRedirectInput {
  return {
    didLandingRedirect: false,
    currentUser: "mira",
    accountType: "member",
    defaultLandingTab: null,
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

describe("decideLandingRedirect — everyone lands on the one dashboard", () => {
  it("keeps a lab_head on the dashboard (no /lab-overview bounce anymore)", () => {
    const d = decideLandingRedirect(input({ accountType: "lab_head" }));
    expect(d).toEqual({ kind: "none", markOneShot: true });
  });

  it("keeps a member on the dashboard", () => {
    const d = decideLandingRedirect(input({ accountType: "member" }));
    expect(d).toEqual({ kind: "none", markOneShot: true });
  });

  it("an explicit non-'/' landing tab wins for a PI too", () => {
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

describe("decideLandingRedirect — v4 walkthrough guard", () => {
  it("does NOT bounce off '/' while the tour is active", () => {
    const d = decideLandingRedirect(
      input({
        accountType: "lab_head",
        defaultLandingTab: "/workbench",
        tourActive: true,
      }),
    );
    // Suppressed AND not marked, so the normal landing behavior can
    // resume on the next clean landing once the tour ends.
    expect(d).toEqual({ kind: "none", markOneShot: false });
  });

  it("resumes the explicit-tab redirect normally once the tour ends", () => {
    const d = decideLandingRedirect(
      input({
        accountType: "lab_head",
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

describe("decideLandingRedirect — ?from sentinel", () => {
  it("honors a ?from bounce-source (stay on the dashboard, mark one-shot)", () => {
    const d = decideLandingRedirect(
      input({ accountType: "lab_head", fromRedirect: "lab-overview" }),
    );
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
  it("stays on the dashboard + marks one-shot when default is '/'", () => {
    const d = decideLandingRedirect(input({ defaultLandingTab: "/" }));
    expect(d).toEqual({ kind: "none", markOneShot: true });
  });
});
