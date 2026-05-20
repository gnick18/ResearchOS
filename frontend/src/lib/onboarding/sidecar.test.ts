// frontend/src/lib/onboarding/sidecar.test.ts
//
// Unit tests for the onboarding sidecar's v3 → v4 migration (P0 of the
// Onboarding v3 arc per ONBOARDING_V3_PROPOSAL.md §10). Pinning the
// migration contract here means a future schema bump that accidentally
// clobbers an existing user's wizard_completed_at, or that re-arms
// wizard_force_show on a migration path, trips a red test instead of
// silently re-triggering the v3 walkthrough for everyone (L1/L22).
//
// Cases:
//   - v3 → v4: full v3 record with every removed field present → v4
//     shape with feature_picks = null, wizard_resume_state = null,
//     lab_tour_pending = false, lab_tour_dismissed_at = null, removed
//     fields stripped, retained wizard timestamps preserved.
//   - v2 → v4: a v2 record (mode + tips, no v3 wizard fields) → v4
//     shape with every wizard-and-newer field at defaults.
//   - v1 → v4: minimal v1 record (active_seconds + first_seen_at + tips)
//     → v4 with every wizard-and-newer field at defaults.
//   - v4 round-trip: write + read a v4 sidecar, deep-equal.
//   - Existing-user invisibility invariant: after normalize() of any
//     v1/v2/v3 record, wizard_force_show === false AND feature_picks
//     === null AND wizard_completed_at is preserved if present. Codifies
//     the L1/L22 contract at the unit-test layer.

import { describe, expect, it, vi, beforeEach } from "vitest";

const memFs = new Map<string, unknown>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
    }),
  },
}));

import {
  clearWizardCompletion,
  readOnboarding,
  writeOnboarding,
  type FeaturePicks,
  type OnboardingSidecar,
  type WizardResumeState,
} from "./sidecar";

const USER = "alex";
const PATH = `users/${USER}/_onboarding.json`;

beforeEach(() => {
  memFs.clear();
});

describe("sidecar v3 → v4 migration", () => {
  it("strips every removed v3 field and produces a v4 shape", async () => {
    memFs.set(PATH, {
      version: 3,
      first_seen_at: "2026-05-14T10:00:00.000Z",
      active_seconds: 1200,
      // Removed v3 fields, all populated:
      last_tip_at: 600,
      tips: {
        "home-welcome": {
          shown_at: "2026-05-14T10:05:00.000Z",
          dismissed_at: "2026-05-14T10:05:30.000Z",
          outcome: "got-it",
        },
      },
      tips_off: false,
      shown_count: 3,
      mode: "suggestions",
      use_cases: ["postdoc", "phd_experiments"],
      other_use_case: "physics simulations",
      telegram_decision: "paired",
      calendar_decision: "added",
      ai_helper_decision: "copied",
      // Retained v3 fields:
      wizard_completed_at: "2026-05-20T12:00:00Z",
      wizard_skipped_at: null,
      wizard_force_show: false,
    });
    const sc = await readOnboarding(USER);

    expect(sc.version).toBe(4);
    expect(sc.first_seen_at).toBe("2026-05-14T10:00:00.000Z");
    expect(sc.active_seconds).toBe(1200);
    // Retained v3 timestamps preserved.
    expect(sc.wizard_completed_at).toBe("2026-05-20T12:00:00Z");
    expect(sc.wizard_skipped_at).toBeNull();
    // New v4 fields at defaults.
    expect(sc.feature_picks).toBeNull();
    expect(sc.wizard_resume_state).toBeNull();
    expect(sc.lab_tour_pending).toBe(false);
    expect(sc.lab_tour_dismissed_at).toBeNull();
    // Existing user → wizard_force_show stays false (L1/L22).
    expect(sc.wizard_force_show).toBe(false);

    // Every removed v3 key must not leak onto the parsed v4 object.
    const leaked = sc as unknown as Record<string, unknown>;
    expect(leaked.tips).toBeUndefined();
    expect(leaked.last_tip_at).toBeUndefined();
    expect(leaked.shown_count).toBeUndefined();
    expect(leaked.tips_off).toBeUndefined();
    expect(leaked.mode).toBeUndefined();
    expect(leaked.use_cases).toBeUndefined();
    expect(leaked.other_use_case).toBeUndefined();
    expect(leaked.telegram_decision).toBeUndefined();
    expect(leaked.calendar_decision).toBeUndefined();
    expect(leaked.ai_helper_decision).toBeUndefined();
  });
});

describe("sidecar v2 → v4 migration", () => {
  it("reads a v2 record (no v3 wizard fields) → v4 shape with everything at defaults", async () => {
    memFs.set(PATH, {
      version: 2,
      first_seen_at: "2026-05-14T10:00:00.000Z",
      active_seconds: 800,
      last_tip_at: 400,
      tips: {
        "home-welcome": {
          shown_at: "2026-05-14T10:05:00.000Z",
          dismissed_at: null,
          outcome: "x",
        },
      },
      tips_off: false,
      shown_count: 1,
      mode: "tutorial",
    });
    const sc = await readOnboarding(USER);

    expect(sc.version).toBe(4);
    expect(sc.first_seen_at).toBe("2026-05-14T10:00:00.000Z");
    expect(sc.active_seconds).toBe(800);
    expect(sc.feature_picks).toBeNull();
    expect(sc.wizard_completed_at).toBeNull();
    expect(sc.wizard_skipped_at).toBeNull();
    expect(sc.wizard_force_show).toBe(false);
    expect(sc.wizard_resume_state).toBeNull();
    expect(sc.lab_tour_pending).toBe(false);
    expect(sc.lab_tour_dismissed_at).toBeNull();
  });
});

describe("sidecar v1 → v4 migration", () => {
  it("reads a minimal v1 record → v4 shape with every wizard field defaulted", async () => {
    memFs.set(PATH, {
      version: 1,
      first_seen_at: "2026-05-14T10:00:00.000Z",
      active_seconds: 42,
      last_tip_at: 0,
      tips: {},
      tips_off: false,
      shown_count: 0,
    });
    const sc = await readOnboarding(USER);

    expect(sc.version).toBe(4);
    expect(sc.first_seen_at).toBe("2026-05-14T10:00:00.000Z");
    expect(sc.active_seconds).toBe(42);
    expect(sc.feature_picks).toBeNull();
    expect(sc.wizard_completed_at).toBeNull();
    expect(sc.wizard_skipped_at).toBeNull();
    expect(sc.wizard_force_show).toBe(false);
    expect(sc.wizard_resume_state).toBeNull();
    expect(sc.lab_tour_pending).toBe(false);
    expect(sc.lab_tour_dismissed_at).toBeNull();
  });
});

describe("sidecar v4 round-trip", () => {
  const samplePicks: FeaturePicks = {
    account_type: "lab",
    lab_storage: "google_drive",
    purchases: "yes",
    calendar: "yes",
    goals: "maybe",
    telegram: "no",
    ai_helper: "full",
  };
  const sampleResume: WizardResumeState = {
    current_step: "W3",
    skipped_steps: ["W2"],
    artifacts_created: [
      { type: "project", id: "proj-001", cleanup_default: "keep" },
      { type: "method", id: "method-007", cleanup_default: "discard" },
    ],
  };

  it("write + read preserves feature_picks, wizard_resume_state, and the lab-tour fields", async () => {
    const initial: OnboardingSidecar = {
      version: 4,
      first_seen_at: "2026-05-20T08:00:00.000Z",
      active_seconds: 4242,
      feature_picks: samplePicks,
      wizard_completed_at: null,
      wizard_skipped_at: null,
      wizard_force_show: false,
      wizard_resume_state: sampleResume,
      lab_tour_pending: true,
      lab_tour_dismissed_at: null,
    };
    await writeOnboarding(USER, initial);
    const sc = await readOnboarding(USER);
    expect(sc).toEqual(initial);
  });

  it("normalizes a malformed feature_picks object back to null (no half-trust)", async () => {
    memFs.set(PATH, {
      version: 4,
      first_seen_at: "2026-05-20T08:00:00.000Z",
      active_seconds: 0,
      // account_type missing → invalid → null
      feature_picks: { purchases: "yes" },
      wizard_completed_at: null,
      wizard_skipped_at: null,
      wizard_force_show: false,
      wizard_resume_state: null,
      lab_tour_pending: false,
      lab_tour_dismissed_at: null,
    });
    const sc = await readOnboarding(USER);
    expect(sc.feature_picks).toBeNull();
  });

  it("normalizes a malformed wizard_resume_state to null", async () => {
    memFs.set(PATH, {
      version: 4,
      first_seen_at: "2026-05-20T08:00:00.000Z",
      active_seconds: 0,
      feature_picks: null,
      wizard_completed_at: null,
      wizard_skipped_at: null,
      wizard_force_show: false,
      // current_step missing → invalid → null
      wizard_resume_state: { skipped_steps: [], artifacts_created: [] },
      lab_tour_pending: false,
      lab_tour_dismissed_at: null,
    });
    const sc = await readOnboarding(USER);
    expect(sc.wizard_resume_state).toBeNull();
  });

  it("filters out non-string entries inside wizard_resume_state.skipped_steps + non-object artifacts", async () => {
    memFs.set(PATH, {
      version: 4,
      first_seen_at: "2026-05-20T08:00:00.000Z",
      active_seconds: 0,
      feature_picks: null,
      wizard_completed_at: null,
      wizard_skipped_at: null,
      wizard_force_show: false,
      wizard_resume_state: {
        current_step: "W3",
        skipped_steps: ["W2", 42, null, "L4"],
        artifacts_created: [
          { type: "project", id: "p1", cleanup_default: "keep" },
          { type: "method" }, // missing id → dropped
          "not an object", // not an object → dropped
          { type: "experiment", id: "e1", cleanup_default: "weird" }, // unknown cleanup → coerced to "keep"
        ],
      },
      lab_tour_pending: false,
      lab_tour_dismissed_at: null,
    });
    const sc = await readOnboarding(USER);
    expect(sc.wizard_resume_state).not.toBeNull();
    expect(sc.wizard_resume_state?.current_step).toBe("W3");
    expect(sc.wizard_resume_state?.skipped_steps).toEqual(["W2", "L4"]);
    expect(sc.wizard_resume_state?.artifacts_created).toEqual([
      { type: "project", id: "p1", cleanup_default: "keep" },
      { type: "experiment", id: "e1", cleanup_default: "keep" },
    ]);
  });

  it("treats lab_tour_pending strictly: only literal `true` counts", async () => {
    memFs.set(PATH, {
      version: 4,
      first_seen_at: "2026-05-20T08:00:00.000Z",
      active_seconds: 0,
      feature_picks: null,
      wizard_completed_at: null,
      wizard_skipped_at: null,
      wizard_force_show: false,
      wizard_resume_state: null,
      lab_tour_pending: "true", // string, not boolean
      lab_tour_dismissed_at: null,
    });
    const sc = await readOnboarding(USER);
    expect(sc.lab_tour_pending).toBe(false);
  });
});

describe("existing-user invisibility invariant (L1/L22)", () => {
  it("v3 record with wizard_completed_at set: timestamp preserved, force_show stays false, feature_picks null", async () => {
    memFs.set(PATH, {
      version: 3,
      first_seen_at: "2026-05-14T08:00:00.000Z",
      active_seconds: 4242,
      last_tip_at: 1200,
      tips: {},
      tips_off: false,
      shown_count: 3,
      mode: "suggestions",
      use_cases: ["postdoc"],
      wizard_completed_at: "2026-05-20T12:00:00Z",
      wizard_skipped_at: null,
      wizard_force_show: false,
    });
    const sc = await readOnboarding(USER);
    expect(sc.wizard_force_show).toBe(false);
    expect(sc.feature_picks).toBeNull();
    expect(sc.wizard_completed_at).toBe("2026-05-20T12:00:00Z");
  });

  it("v3 record with wizard_force_show TRUE on disk is forced back to false on read (existing users get nothing automatic)", async () => {
    // L1/L22 contract: ANY pre-v4 record normalizes with
    // wizard_force_show=false even if the v3 disk shape was carrying a
    // mid-flight Re-run flag. The v4 Re-run flow re-arms force_show
    // post-migration via clearWizardCompletion(), not via the v3-era
    // flag, so this is safe.
    memFs.set(PATH, {
      version: 3,
      first_seen_at: "2026-05-14T08:00:00.000Z",
      active_seconds: 100,
      last_tip_at: 0,
      tips: {},
      tips_off: false,
      shown_count: 0,
      mode: null,
      use_cases: null,
      wizard_completed_at: null,
      wizard_skipped_at: null,
      wizard_force_show: true,
    });
    const sc = await readOnboarding(USER);
    expect(sc.wizard_force_show).toBe(false);
  });

  it("v2 record with no wizard fields: force_show stays false, feature_picks null", async () => {
    memFs.set(PATH, {
      version: 2,
      first_seen_at: "2026-05-14T10:00:00.000Z",
      active_seconds: 800,
      last_tip_at: 400,
      tips: {},
      tips_off: false,
      shown_count: 0,
      mode: "suggestions",
    });
    const sc = await readOnboarding(USER);
    expect(sc.wizard_force_show).toBe(false);
    expect(sc.feature_picks).toBeNull();
    expect(sc.wizard_completed_at).toBeNull();
  });

  it("missing sidecar reads as a fresh v4 default (new user, no auto-fire)", async () => {
    const sc = await readOnboarding(USER);
    expect(sc.version).toBe(4);
    expect(sc.feature_picks).toBeNull();
    expect(sc.wizard_completed_at).toBeNull();
    expect(sc.wizard_skipped_at).toBeNull();
    expect(sc.wizard_force_show).toBe(false);
    expect(sc.wizard_resume_state).toBeNull();
    expect(sc.lab_tour_pending).toBe(false);
    expect(sc.lab_tour_dismissed_at).toBeNull();
  });
});

describe("clearWizardCompletion (v4 Re-run-tour bypass)", () => {
  it("on a v4 sidecar: null-s both wizard timestamps and arms wizard_force_show, leaves everything else untouched", async () => {
    const initial: OnboardingSidecar = {
      version: 4,
      first_seen_at: "2026-05-14T08:00:00.000Z",
      active_seconds: 4242,
      feature_picks: {
        account_type: "lab",
        lab_storage: "local",
        purchases: "yes",
        calendar: "yes",
        goals: "maybe",
        telegram: "no",
        ai_helper: "minimal",
      },
      wizard_completed_at: "2026-05-20T12:00:00Z",
      wizard_skipped_at: null,
      wizard_force_show: false,
      wizard_resume_state: null,
      lab_tour_pending: true,
      lab_tour_dismissed_at: null,
    };
    await writeOnboarding(USER, initial);

    const sc = await clearWizardCompletion(USER);
    expect(sc.wizard_completed_at).toBeNull();
    expect(sc.wizard_skipped_at).toBeNull();
    expect(sc.wizard_force_show).toBe(true);
    // Everything else preserved.
    expect(sc.feature_picks).toEqual(initial.feature_picks);
    expect(sc.first_seen_at).toBe(initial.first_seen_at);
    expect(sc.active_seconds).toBe(initial.active_seconds);
    expect(sc.lab_tour_pending).toBe(true);

    // Re-read confirms the disk write committed the same shape.
    const sc2 = await readOnboarding(USER);
    expect(sc2.wizard_force_show).toBe(true);
    expect(sc2.feature_picks).toEqual(initial.feature_picks);
  });
});
