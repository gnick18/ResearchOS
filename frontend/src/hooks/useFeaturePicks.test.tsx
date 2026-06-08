// Hook-level tests for useFeaturePicks(). The unit-level contract on
// `deriveVisibleTabs(picks, settings)` is pinned in
// feature-picks-tabs.test.ts; this file pins the L1/L22 invariant at
// the boundary that AppShell actually reads from. A pre-v4 (or v4
// with feature_picks=null) sidecar MUST surface as `null` from the
// hook so AppShell's `deriveVisibleTabs(null, settings)` falls
// straight through to settings.json.visibleTabs and an existing
// user's tab set is byte-identical to pre-chip.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

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

import { useFeaturePicks } from "./useFeaturePicks";
import {
  patchOnboarding,
  _clearSidecarWrittenSubscribersForTest,
} from "@/lib/onboarding/sidecar";

const USER = "alex";
const PATH = `users/${USER}/_onboarding.json`;

beforeEach(() => {
  memFs.clear();
  _clearSidecarWrittenSubscribersForTest();
});

describe("useFeaturePicks() — existing-user invariant (L1/L22)", () => {
  it("returns null when the sidecar's feature_picks is null (migrated v3 record)", async () => {
    // A v3 record that just migrated to v4: feature_picks=null,
    // wizard_completed_at preserved. AppShell must NOT change its
    // tab set for this user.
    memFs.set(PATH, {
      version: 4,
      first_seen_at: "2026-05-14T10:00:00.000Z",
      active_seconds: 0,
      feature_picks: null,
      wizard_completed_at: "2026-05-20T12:00:00.000Z",
      wizard_skipped_at: null,
      wizard_force_show: false,
      wizard_resume_state: null,
      lab_tour_pending: false,
      lab_tour_dismissed_at: null,
    });

    const { result } = renderHook(() => useFeaturePicks(USER));
    await waitFor(() => expect(result.current).toBe(null));
  });

  it("returns null when no sidecar file exists yet (fresh user, pre-Phase-1)", async () => {
    // No sidecar on disk → readOnboarding returns a freshly-defaulted
    // record with feature_picks=null. Same fallback path.
    const { result } = renderHook(() => useFeaturePicks(USER));
    await waitFor(() => expect(result.current).toBe(null));
  });

  it("returns null synchronously when username is null (signed-out)", () => {
    // No I/O attempted. The hook short-circuits so the deriveVisibleTabs
    // caller never sees `undefined` lingering after sign-out.
    const { result } = renderHook(() => useFeaturePicks(null));
    expect(result.current).toBe(null);
  });
});

describe("useFeaturePicks() — populated picks", () => {
  it("returns the persisted FeaturePicks object when Phase 1 has populated it", async () => {
    const picks = {
      account_type: "lab" as const,
      lab_storage: "google_drive" as const,
      purchases: "yes" as const,
      calendar: "no" as const,
      goals: "maybe" as const,
      ai_helper: "medium" as const,
    };
    memFs.set(PATH, {
      version: 4,
      first_seen_at: "2026-05-20T00:00:00.000Z",
      active_seconds: 0,
      feature_picks: picks,
      wizard_completed_at: null,
      wizard_skipped_at: null,
      wizard_force_show: false,
      wizard_resume_state: null,
      lab_tour_pending: false,
      lab_tour_dismissed_at: null,
    });

    const { result } = renderHook(() => useFeaturePicks(USER));
    await waitFor(() => expect(result.current).toEqual(picks));
  });
});

// ---------------------------------------------------------------------------
// Live-reactivity per pick (setup-q feature-gating audit manager, 2026-05-27).
// Pins the contract that EVERY pick — not just calendar (which the prior fix
// happened to test) — drives a live setPicks via the onSidecarWritten bus.
// Grant's report: purchases=no didn't hide the Purchases tab the same way
// calendar=no now hides Calendar. Since the gate code in feature-picks-tabs
// is symmetric (purchases === "yes" / calendar === "yes"), regression-coverage
// must demonstrate the bus path lands the new pick into the hook for every
// field a downstream gate consumes.
// ---------------------------------------------------------------------------

describe("useFeaturePicks() — live reactivity via onSidecarWritten", () => {
  // Helper to seed a fresh sidecar with feature_picks already initialized.
  // Mirrors what Q1AccountTypeStep writes the first time the user picks an
  // account type — subsequent Q2-Q7 patches spread + override on this object.
  function seedInitialSidecar(accountType: "solo" | "lab" = "solo") {
    memFs.set(PATH, {
      version: 4,
      first_seen_at: "2026-05-27T00:00:00.000Z",
      active_seconds: 0,
      feature_picks: { account_type: accountType },
      wizard_completed_at: null,
      wizard_skipped_at: null,
      wizard_force_show: false,
      wizard_resume_state: null,
      lab_tour_pending: false,
      lab_tour_dismissed_at: null,
    });
  }

  // The pick fields exercised end-to-end. Each entry's `field` must match a
  // FeaturePicks key the downstream gates read; the `value` is the "no" / opt-out
  // answer the user would pick to HIDE a feature (mirrors Grant's
  // purchases=no scenario).
  const PICKS = [
    { field: "purchases", value: "no" as const },
    { field: "calendar", value: "no" as const },
    { field: "goals", value: "no" as const },
    { field: "telegram", value: "no" as const },
    { field: "links", value: "no" as const },
  ] as const;

  for (const { field, value } of PICKS) {
    it(`live-updates when ${field}=${value} is patched mid-session`, async () => {
      seedInitialSidecar("solo");
      const { result } = renderHook(() => useFeaturePicks(USER));
      // Initial read lands the seeded picks (account_type only).
      await waitFor(() =>
        expect(result.current).toEqual({ account_type: "solo" }),
      );

      // Mimic a Q-step's patchSidecar: spread + override a single field.
      // This is the EXACT shape Q2-Q7 use today.
      await act(async () => {
        await patchOnboarding(USER, (cur) => {
          if (!cur.feature_picks) return cur;
          return {
            ...cur,
            feature_picks: { ...cur.feature_picks, [field]: value },
          };
        });
      });

      await waitFor(() =>
        expect(result.current).toEqual({ account_type: "solo", [field]: value }),
      );
    });
  }

  it("live-updates ai_helper=no (Q6 opt-out)", async () => {
    // ai_helper carries a five-state enum ("full"/"medium"/"minimal"/
    // "no"/"maybe") so the dedicated test pins the same bus path for the
    // odd-enum field. Q6 also seeds "full" on mount when the field is
    // undefined; the patch below skips that seed by writing the user
    // picked the opt-out value directly.
    seedInitialSidecar("solo");
    const { result } = renderHook(() => useFeaturePicks(USER));
    await waitFor(() =>
      expect(result.current).toEqual({ account_type: "solo" }),
    );

    await act(async () => {
      await patchOnboarding(USER, (cur) => {
        if (!cur.feature_picks) return cur;
        return {
          ...cur,
          feature_picks: { ...cur.feature_picks, ai_helper: "no" },
        };
      });
    });

    await waitFor(() =>
      expect(result.current).toEqual({ account_type: "solo", ai_helper: "no" }),
    );
  });

  it("live-updates lab_head=true (Q1c bridge)", async () => {
    // Q1c writes feature_picks.lab_head; the prior top-nav fix added the
    // _user_settings bridge but the sidecar write still has to land in the
    // hook too (downstream readers like SetupWrapupStep's account-type
    // formatter consult feature_picks.lab_head, not _user_settings).
    seedInitialSidecar("lab");
    const { result } = renderHook(() => useFeaturePicks(USER));
    await waitFor(() =>
      expect(result.current).toEqual({ account_type: "lab" }),
    );

    await act(async () => {
      await patchOnboarding(USER, (cur) => {
        if (!cur.feature_picks) return cur;
        return {
          ...cur,
          feature_picks: { ...cur.feature_picks, lab_head: true },
        };
      });
    });

    await waitFor(() =>
      expect(result.current).toEqual({ account_type: "lab", lab_head: true }),
    );
  });

  it("ignores writes for OTHER users (multi-tab scoping)", async () => {
    seedInitialSidecar("solo");
    const { result } = renderHook(() => useFeaturePicks(USER));
    await waitFor(() =>
      expect(result.current).toEqual({ account_type: "solo" }),
    );

    // Write to a different user's sidecar; the hook for USER must not pick
    // it up. Seed the other user's sidecar first so patchOnboarding has
    // something to patch.
    const OTHER = "morgan";
    memFs.set(`users/${OTHER}/_onboarding.json`, {
      version: 4,
      first_seen_at: "2026-05-27T00:00:00.000Z",
      active_seconds: 0,
      feature_picks: { account_type: "solo" },
      wizard_completed_at: null,
      wizard_skipped_at: null,
      wizard_force_show: false,
      wizard_resume_state: null,
      lab_tour_pending: false,
      lab_tour_dismissed_at: null,
    });

    await act(async () => {
      await patchOnboarding(OTHER, (cur) => {
        if (!cur.feature_picks) return cur;
        return {
          ...cur,
          feature_picks: { ...cur.feature_picks, purchases: "no" },
        };
      });
    });

    // Active user's hook still holds only the original picks.
    expect(result.current).toEqual({ account_type: "solo" });
  });
});
