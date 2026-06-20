import { describe, it, expect } from "vitest";
import { computeResumeStepId } from "./wizard-resume-step";

describe("computeResumeStepId", () => {
  it("first pass with no handle starts at the identity step (lab track)", () => {
    expect(
      computeResumeStepId("pi-create", { handleClaimed: false, hasBranding: false }),
    ).toBe("identity");
  });

  it("first pass with no handle starts at the identity step (solo track)", () => {
    expect(
      computeResumeStepId("solo-free", { handleClaimed: false, hasBranding: false }),
    ).toBe("identity");
  });

  it("lab re-entry with a claimed handle skips to lab-setup", () => {
    expect(
      computeResumeStepId("pi-create", { handleClaimed: true, hasBranding: false }),
    ).toBe("lab-setup");
  });

  it("lab re-entry with handle and stashed branding skips to folder", () => {
    expect(
      computeResumeStepId("pi-create", { handleClaimed: true, hasBranding: true }),
    ).toBe("folder");
  });

  it("solo re-entry with a claimed handle skips to folder", () => {
    expect(
      computeResumeStepId("solo-free", { handleClaimed: true, hasBranding: false }),
    ).toBe("folder");
  });

  it("branding is ignored on the solo track (no lab-setup step there)", () => {
    expect(
      computeResumeStepId("solo-free", { handleClaimed: true, hasBranding: true }),
    ).toBe("folder");
  });
});
