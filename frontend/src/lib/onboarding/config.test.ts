// Onboarding flag unification (2026-06-16). The wizard and the tour are one
// intertwined flow, so they gate together under a single flag. This locks that
// invariant so they cannot drift back into two independent flags.

import { describe, it, expect } from "vitest";
import {
  ONBOARDING_ENABLED,
  ONBOARDING_WIZARD_ENABLED,
  ONBOARDING_TUTOR_ENABLED,
} from "./config";

describe("onboarding flag is unified", () => {
  it("the wizard and tutor flags both resolve to the single onboarding flow flag", () => {
    expect(ONBOARDING_WIZARD_ENABLED).toBe(ONBOARDING_ENABLED);
    expect(ONBOARDING_TUTOR_ENABLED).toBe(ONBOARDING_ENABLED);
  });

  it("is a boolean (env-driven, off by default in test)", () => {
    expect(typeof ONBOARDING_ENABLED).toBe("boolean");
  });
});
