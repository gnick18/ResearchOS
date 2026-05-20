// Hook-level tests for useFeaturePicks(). The unit-level contract on
// `deriveVisibleTabs(picks, settings)` is pinned in
// feature-picks-tabs.test.ts; this file pins the L1/L22 invariant at
// the boundary that AppShell actually reads from. A pre-v4 (or v4
// with feature_picks=null) sidecar MUST surface as `null` from the
// hook so AppShell's `deriveVisibleTabs(null, settings)` falls
// straight through to settings.json.visibleTabs and an existing
// user's tab set is byte-identical to pre-chip.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

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

const USER = "alex";
const PATH = `users/${USER}/_onboarding.json`;

beforeEach(() => {
  memFs.clear();
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
      telegram: "no" as const,
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
