import { describe, expect, it } from "vitest";
import {
  isLabHead,
  isLabModeFolder,
  deriveWorkspaceAccountType,
} from "./lab-mode";

describe("isLabHead", () => {
  it("is true only for lab_head", () => {
    expect(isLabHead("lab_head")).toBe(true);
  });

  it("is false for member", () => {
    expect(isLabHead("member")).toBe(false);
  });
});

describe("isLabModeFolder", () => {
  it("is true when the folder has two or more users", () => {
    expect(isLabModeFolder({ userCount: 2, anyLabHead: false })).toBe(true);
    expect(isLabModeFolder({ userCount: 5, anyLabHead: false })).toBe(true);
  });

  it("is true when any account is a lab head, even with a single user", () => {
    expect(isLabModeFolder({ userCount: 1, anyLabHead: true })).toBe(true);
    expect(isLabModeFolder({ userCount: 0, anyLabHead: true })).toBe(true);
  });

  it("is false for a genuinely solo folder (one user, no lab head)", () => {
    expect(isLabModeFolder({ userCount: 1, anyLabHead: false })).toBe(false);
  });

  it("is false for an empty folder with no lab head", () => {
    expect(isLabModeFolder({ userCount: 0, anyLabHead: false })).toBe(false);
  });
});

describe("deriveWorkspaceAccountType", () => {
  it("is lab_head whenever the user is a lab head, regardless of lab mode", () => {
    expect(
      deriveWorkspaceAccountType({ isLabHead: true, isLabMode: true }),
    ).toBe("lab_head");
    expect(
      deriveWorkspaceAccountType({ isLabHead: true, isLabMode: false }),
    ).toBe("lab_head");
  });

  it("is lab for a non-head in a lab-mode folder", () => {
    expect(
      deriveWorkspaceAccountType({ isLabHead: false, isLabMode: true }),
    ).toBe("lab");
  });

  it("is solo for a non-head in a non-lab-mode folder", () => {
    expect(
      deriveWorkspaceAccountType({ isLabHead: false, isLabMode: false }),
    ).toBe("solo");
  });
});
