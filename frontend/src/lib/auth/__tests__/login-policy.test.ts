// Identity model simplification, phase 1. The login-required policy.

import { describe, expect, it } from "vitest";

import { folderRequiresLogin } from "../login-policy";

describe("folderRequiresLogin", () => {
  it("does not require a login for a genuinely solo folder", () => {
    expect(folderRequiresLogin(1, false)).toBe(false);
  });

  it("requires a login the moment a folder is shared (2+ users)", () => {
    expect(folderRequiresLogin(2, false)).toBe(true);
    expect(folderRequiresLogin(5, false)).toBe(true);
  });

  it("requires a login for a solo lab head (PI), even at one user", () => {
    expect(folderRequiresLogin(1, true)).toBe(true);
  });

  it("requires a login for a shared folder that also has a lab head", () => {
    expect(folderRequiresLogin(3, true)).toBe(true);
  });

  it("treats an empty folder as not requiring a login", () => {
    expect(folderRequiresLogin(0, false)).toBe(false);
  });
});
