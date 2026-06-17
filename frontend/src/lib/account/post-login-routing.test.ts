// Post-login destination resolver: priority order, flag gating, from preservation.

import { describe, it, expect } from "vitest";
import { resolvePostLoginDestination } from "./post-login-routing";

const base = {
  isDeptAdmin: false,
  isInstitutionAdmin: false,
  deptEnabled: true,
  institutionEnabled: true,
  fromRoute: null,
};

describe("resolvePostLoginDestination", () => {
  it("routes a department admin to /department", () => {
    expect(resolvePostLoginDestination({ ...base, isDeptAdmin: true })).toBe(
      "/department",
    );
  });

  it("routes an institution admin to /institution", () => {
    expect(
      resolvePostLoginDestination({ ...base, isInstitutionAdmin: true }),
    ).toBe("/institution");
  });

  it("prefers department over institution when the account is both", () => {
    expect(
      resolvePostLoginDestination({
        ...base,
        isDeptAdmin: true,
        isInstitutionAdmin: true,
      }),
    ).toBe("/department");
  });

  it("never routes to a portal whose tier flag is off (falls back to the hub)", () => {
    expect(
      resolvePostLoginDestination({
        ...base,
        isDeptAdmin: true,
        deptEnabled: false,
      }),
    ).toBe("/account");
    expect(
      resolvePostLoginDestination({
        ...base,
        isInstitutionAdmin: true,
        institutionEnabled: false,
      }),
    ).toBe("/account");
  });

  it("falls back to the account hub for a solo or lab user", () => {
    expect(resolvePostLoginDestination(base)).toBe("/account");
  });

  it("preserves the bounced-from route on the hub fallback", () => {
    expect(
      resolvePostLoginDestination({ ...base, fromRoute: "/methods" }),
    ).toBe("/account?from=%2Fmethods");
  });

  it("does not preserve a from of /account itself", () => {
    expect(
      resolvePostLoginDestination({ ...base, fromRoute: "/account" }),
    ).toBe("/account");
  });

  it("ignores the from route for an org admin (the portal is their home)", () => {
    expect(
      resolvePostLoginDestination({
        ...base,
        isDeptAdmin: true,
        fromRoute: "/methods",
      }),
    ).toBe("/department");
  });
});
