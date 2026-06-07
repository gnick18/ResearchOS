// PI capability revamp Phase 4 (sharing + collaboration manager, 2026-06-07):
// the Settings "Lab audit trail" section is lab-head-only. The Lab Mode tab is
// visible to a member in a lab workspace too, so the section gates on the
// actual account_type, not the looser isLabMode tab flag. This pins that gate.

import { describe, expect, it } from "vitest";

import { shouldShowLabHeadAuditTrail } from "@/app/settings/page";

describe("shouldShowLabHeadAuditTrail", () => {
  it("shows the audit trail for a lab head", () => {
    expect(shouldShowLabHeadAuditTrail({ account_type: "lab_head" })).toBe(true);
  });

  it("hides it for a member (even one in a lab workspace)", () => {
    expect(shouldShowLabHeadAuditTrail({ account_type: "member" })).toBe(false);
  });

  it("hides it when settings are missing", () => {
    expect(shouldShowLabHeadAuditTrail(null)).toBe(false);
    expect(shouldShowLabHeadAuditTrail(undefined)).toBe(false);
  });
});
