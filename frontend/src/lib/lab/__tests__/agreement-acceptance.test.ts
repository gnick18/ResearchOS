// Tests for the membership-agreement acceptance gate (LAB_ARCHIVE_CONTINUITY.md).

import { describe, it, expect } from "vitest";
import { needsAgreementAcceptance } from "../agreement-acceptance";

describe("needsAgreementAcceptance", () => {
  it("does not gate when the agreement is disabled", () => {
    expect(needsAgreementAcceptance({ enabled: false, version: 3 }, null)).toBe(
      false,
    );
  });

  it("gates a member who has never accepted an enabled agreement", () => {
    expect(needsAgreementAcceptance({ enabled: true, version: 1 }, null)).toBe(
      true,
    );
  });

  it("does not gate when the member accepted the current version", () => {
    expect(
      needsAgreementAcceptance({ enabled: true, version: 2 }, { version: 2 }),
    ).toBe(false);
  });

  it("re-gates when the PI revised the text to a newer version", () => {
    expect(
      needsAgreementAcceptance({ enabled: true, version: 3 }, { version: 2 }),
    ).toBe(true);
  });

  it("treats null/undefined config as no gate", () => {
    expect(needsAgreementAcceptance(null, null)).toBe(false);
    expect(needsAgreementAcceptance(undefined, { version: 1 })).toBe(false);
  });
});
