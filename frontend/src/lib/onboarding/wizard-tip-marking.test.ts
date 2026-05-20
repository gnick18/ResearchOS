// TODO P7: delete alongside `wizard-tip-marking.ts` in the tips-system
// deprecation sweep (ONBOARDING_V3_PROPOSAL.md §12 row P7). The Phase-3
// rule table this file used to pin assumed v2 use_cases + the three
// integration decision sidecar fields, all of which are gone with the
// v3 → v4 migration. Kept here as a passing placeholder so the test
// runner stays clean and the file's existence does not block P7 doing
// its own teardown.

import { describe, expect, it } from "vitest";
import {
  markWizardCoveredTips,
  WIZARD_COVERED_TIP_IDS,
} from "./wizard-tip-marking";

describe("wizard-tip-marking (P0 stub)", () => {
  it("markWizardCoveredTips returns an empty record (P7 will delete)", () => {
    expect(markWizardCoveredTips()).toEqual({});
  });

  it("WIZARD_COVERED_TIP_IDS still exports the three legacy ids", () => {
    expect(WIZARD_COVERED_TIP_IDS.telegram).toBe("telegram-send-to-task");
    expect(WIZARD_COVERED_TIP_IDS.calendar).toBe("link-calendars");
    expect(WIZARD_COVERED_TIP_IDS.aiHelper).toBe("ai-helper-prompt");
  });
});
