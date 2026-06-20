import { describe, expect, it } from "vitest";
import {
  decideLandingRedirect,
  type LandingRedirectInput,
} from "./page-landing-redirect";

// Minimal valid input; each test overrides the axes it cares about.
const base: LandingRedirectInput = {
  suppress: false,
  currentUser: "alice",
  isLabHead: false,
  defaultLandingTab: null,
  fromRedirect: null,
  tourActive: false,
};

describe("decideLandingRedirect role default (CM-P2B)", () => {
  it("sends a research PI to /lab-overview (class mode off, byte-identical)", () => {
    const d = decideLandingRedirect({ ...base, isLabHead: true });
    expect(d).toEqual({ kind: "replace", to: "/lab-overview", markOneShot: true });
  });

  it("sends a research PI in my-work mode to /workbench (unchanged)", () => {
    const d = decideLandingRedirect({
      ...base,
      isLabHead: true,
      piViewMode: "my-work",
    });
    expect(d.kind).toBe("replace");
    expect(d.kind === "replace" && d.to).toBe("/workbench");
  });

  it("sends a CLASS instructor to /workbench, NOT the research /lab-overview", () => {
    const d = decideLandingRedirect({
      ...base,
      isLabHead: true,
      isClassMode: true,
    });
    expect(d.kind).toBe("replace");
    expect(d.kind === "replace" && d.to).toBe("/workbench");
  });

  it("class branch wins even in the default (lab) PI view mode", () => {
    const d = decideLandingRedirect({
      ...base,
      isLabHead: true,
      isClassMode: true,
      piViewMode: "lab",
    });
    expect(d.kind === "replace" && d.to).toBe("/workbench");
  });

  it("sends a member to /workbench regardless of class mode", () => {
    expect(
      (decideLandingRedirect({ ...base, isLabHead: false }) as { to: string }).to,
    ).toBe("/workbench");
    expect(
      (
        decideLandingRedirect({
          ...base,
          isLabHead: false,
          isClassMode: true,
        }) as { to: string }
      ).to,
    ).toBe("/workbench");
  });
});

describe("decideLandingRedirect flag-off parity", () => {
  it("isClassMode absent is identical to a research PI bounce", () => {
    const withAbsent = decideLandingRedirect({ ...base, isLabHead: true });
    const withFalse = decideLandingRedirect({
      ...base,
      isLabHead: true,
      isClassMode: false,
    });
    expect(withFalse).toEqual(withAbsent);
    expect(withFalse).toEqual({
      kind: "replace",
      to: "/lab-overview",
      markOneShot: true,
    });
  });

  it("still waits for the role read before deciding", () => {
    const d = decideLandingRedirect({
      ...base,
      isLabHead: undefined,
      isClassMode: true,
    });
    expect(d).toEqual({ kind: "none", markOneShot: false });
  });

  it("an explicit non-/ landing tab still wins over the class default", () => {
    const d = decideLandingRedirect({
      ...base,
      isLabHead: true,
      isClassMode: true,
      defaultLandingTab: "/methods",
    });
    expect(d).toEqual({ kind: "replace", to: "/methods", markOneShot: true });
  });
});
