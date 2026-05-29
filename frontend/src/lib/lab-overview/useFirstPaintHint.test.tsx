// Lab overview PI tooltips (Chip B, lab overview PI tooltips manager,
// 2026-05-25): hook-level contract for `useFirstPaintHint`.
//
// Cases:
//   (a) returns shouldAutoOpen=true on first call for the canonical
//       first widget on a lab_head viewer with a never-fired sidecar.
//   (b) returns shouldAutoOpen=false for non-first widgets on the same
//       sidecar (only the canonical first widget claims the auto-open).
//   (c) returns shouldAutoOpen=false once the sidecar's
//       lab_overview_tooltips_seen_at is set (previous-session fire).
//   (d) returns shouldAutoOpen=false for non-lab-head viewers (members,
//       solo) even on the first widget.
//
// Each test resets the module-level once-per-session guard via
// `_resetFirstPaintHintForTest` so the order-of-tests doesn't pin
// behavior to whichever case ran first.

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
    // readUserSettings short-circuits to DEFAULT_SETTINGS when
    // `isConnected()` is false, which would force account_type back to
    // "member" and skip the auto-open. Force connected = true so the
    // mocked readJson path runs and our seeded `account_type: "lab_head"`
    // settings actually reach the hook.
    isConnected: vi.fn(() => true),
  },
}));

// `getUserMetadata` is called by `readUserSettings` to seed legacy
// color / hide-goals fields. The real implementation reads from
// `_user_metadata.json` via a separate write queue, none of which we
// need under test. Return null so the seeding short-circuits.
vi.mock("@/lib/file-system/user-metadata", () => ({
  getUserMetadata: vi.fn(async () => null),
}));

// Mock useCurrentUser so we don't need to mount FileSystemProvider in
// the test tree. The hook only reads `currentUser` off the returned
// object.
let mockedCurrentUser: string | null = "mira";
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: mockedCurrentUser }),
}));

import { useFirstPaintHint, _resetFirstPaintHintForTest } from "./useFirstPaintHint";

const USER = "mira";
const ONBOARDING_PATH = `users/${USER}/_onboarding.json`;
const SETTINGS_PATH = `users/${USER}/settings.json`;

function seedLabHeadSettings(account_type: "lab_head" | "member" = "lab_head") {
  // useAccountType reads from readUserSettings which uses fileService.
  // A minimal shape is enough — the normalizer fills the rest in.
  memFs.set(SETTINGS_PATH, { account_type });
}

function seedSidecar(seenAt: string | null) {
  memFs.set(ONBOARDING_PATH, {
    version: 5,
    first_seen_at: "2026-05-20T00:00:00.000Z",
    active_seconds: 0,
    feature_picks: null,
    wizard_completed_at: null,
    wizard_skipped_at: null,
    wizard_force_show: false,
    wizard_resume_state: null,
    lab_tour_pending: false,
    lab_tour_dismissed_at: null,
    lab_overview_tooltips_seen_at: seenAt,
  });
}

beforeEach(() => {
  memFs.clear();
  _resetFirstPaintHintForTest();
  mockedCurrentUser = USER;
});

describe("useFirstPaintHint — auto-open contract", () => {
  it("(a) returns shouldAutoOpen=true for the canonical first widget on a fresh lab_head sidecar", async () => {
    seedLabHeadSettings("lab_head");
    seedSidecar(null);

    // Dashboard unification (dashboard-unification build, 2026-05-29):
    // the canonical first canvas widget is now `projects-overview`
    // (seeded at the top of defaultLabHeadLayout in layout-persistence.ts).
    const { result } = renderHook(() =>
      useFirstPaintHint("projects-overview"),
    );

    await waitFor(() => expect(result.current.shouldAutoOpen).toBe(true));
  });

  it("(b) returns shouldAutoOpen=false for non-first widgets on the same fresh sidecar", async () => {
    seedLabHeadSettings("lab_head");
    seedSidecar(null);

    // `announcements` is now the SECOND canvas tile in the lab_head
    // default (Projects Overview leads), so the hint hook should not
    // claim the auto-open for it.
    const { result } = renderHook(() => useFirstPaintHint("announcements"));

    // The hook resolves after a tick (reads sidecar / settings async),
    // but for a non-first widget it short-circuits before any sidecar
    // read. The waitFor below confirms the state stabilizes at false.
    await waitFor(() => {
      expect(result.current.shouldAutoOpen).toBe(false);
    });
  });

  it("(c) returns shouldAutoOpen=false once the sidecar field is set (previous-session fire)", async () => {
    seedLabHeadSettings("lab_head");
    // Sidecar shows the user already saw the auto-open in a prior
    // session. The hook must stay silent now.
    seedSidecar("2026-05-24T12:00:00.000Z");

    const { result } = renderHook(() => useFirstPaintHint("announcements"));

    // Give the read-sidecar effect a tick to land. The hook starts at
    // false and stays there — we waitFor to flush microtasks then
    // assert it never flipped to true.
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(result.current.shouldAutoOpen).toBe(false);
  });

  it("(d) returns shouldAutoOpen=false for non-lab-head viewers (member account)", async () => {
    seedLabHeadSettings("member");
    seedSidecar(null);

    const { result } = renderHook(() => useFirstPaintHint("announcements"));

    // Members never see the auto-open even on a sidecar that's
    // never-fired and the canonical first widget.
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(result.current.shouldAutoOpen).toBe(false);
  });
});
