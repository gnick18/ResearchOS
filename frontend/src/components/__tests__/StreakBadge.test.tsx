// Component tests for <StreakBadge /> — Phase S2 of the
// Streak-and-Milestones arc (see STREAK_AND_MILESTONES_PROPOSAL.md
// §6.1, locks L4 + L5 + L6).
//
// Mocks: the fileService is replaced with an in-memory Map, mirroring
// the S0/S1 test fixtures. The S0 / S1 streak modules themselves are
// imported normally (NOT mocked) so the badge exercises the real
// onStreakSidecarChanged + onStreakMilestoneCrossed wiring.
//
// Tooltip is stubbed to render its child verbatim — the tooltip is
// portal-based and adds no useful surface to assert against in jsdom,
// and stubbing dodges the React 19 ref-composition path which is not
// what we're testing here.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";

const memFs = new Map<string, unknown>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      // Microtask-only so fake-timer tests don't deadlock.
      await Promise.resolve();
      memFs.set(path, data);
    }),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("@/lib/file-system/user-metadata", () => ({
  getUserMetadata: vi.fn(async () => null),
}));

// Tooltip is unrelated to the badge contract; render-through.
vi.mock("@/components/Tooltip", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import StreakBadge from "../StreakBadge";
import {
  INITIAL_STREAK,
  __resetStreakWriteQueueForTests,
  patchStreak,
  type StreakSidecar,
} from "@/lib/streak/streak-sidecar";
import {
  __resetStreakActivityTrackerForTests,
} from "@/lib/streak/streak-activity-tracker";

const sidecarPath = (u: string) => `users/${u}/_streak.json`;

function seed(username: string, patch: Partial<StreakSidecar>): void {
  memFs.set(sidecarPath(username), { ...INITIAL_STREAK, ...patch });
}

/** Microtask drain so the badge's mount-time read resolves and the
 *  resulting setState commits before the test assertion. */
async function flushReads(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  memFs.clear();
  __resetStreakWriteQueueForTests();
  __resetStreakActivityTrackerForTests();
});

// ----- visibility gating -------------------------------------------

describe("visibility", () => {
  it("hides when current_count is 0", async () => {
    seed("alex", { current_count: 0, enabled: true });
    render(<StreakBadge username="alex" />);
    await flushReads();
    expect(screen.queryByTestId("streak-badge")).toBeNull();
  });

  it("hides when enabled is false (even if count > 0)", async () => {
    seed("alex", { current_count: 12, enabled: false });
    render(<StreakBadge username="alex" />);
    await flushReads();
    expect(screen.queryByTestId("streak-badge")).toBeNull();
  });

  it("hides when username is null", async () => {
    seed("alex", { current_count: 12, enabled: true });
    render(<StreakBadge username={null} />);
    await flushReads();
    expect(screen.queryByTestId("streak-badge")).toBeNull();
  });

  it("renders with flame + count when current_count >= 1", async () => {
    seed("alex", { current_count: 7, enabled: true });
    render(<StreakBadge username="alex" />);
    await flushReads();
    const btn = screen.getByTestId("streak-badge");
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain("7");
    // Inline SVG flame inside the button.
    expect(btn.querySelector("svg")).toBeTruthy();
  });
});

// ----- click popover -----------------------------------------------

describe("click popover", () => {
  it("opens with started_on + longest + privacy reminder", async () => {
    seed("alex", {
      current_count: 12,
      longest_count: 28,
      started_on: "2026-05-08",
      shown_privacy_notice: true, // suppress first-reveal for this test
      enabled: true,
    });
    render(<StreakBadge username="alex" />);
    await flushReads();

    expect(screen.queryByTestId("streak-badge-popover")).toBeNull();
    fireEvent.click(screen.getByTestId("streak-badge"));

    const popover = screen.getByTestId("streak-badge-popover");
    expect(popover.textContent).toContain("12");
    expect(popover.textContent).toContain("2026-05-08");
    expect(popover.textContent).toContain("28");
    expect(popover.textContent?.toLowerCase()).toContain("private");
    expect(popover.textContent?.toLowerCase()).toContain("settings");
  });
});

// ----- live updates from S0 / S1 -----------------------------------

describe("live updates", () => {
  it("re-renders when onStreakSidecarChanged fires (Option C)", async () => {
    seed("alex", {
      current_count: 3,
      enabled: true,
      shown_privacy_notice: true,
    });
    render(<StreakBadge username="alex" />);
    await flushReads();
    expect(screen.getByTestId("streak-badge").textContent).toContain("3");

    await act(async () => {
      await patchStreak("alex", (cur) => ({
        ...cur,
        current_count: 4,
        longest_count: 4,
      }));
    });

    expect(screen.getByTestId("streak-badge").textContent).toContain("4");
  });

  it("ignores sidecar-change events for a different user", async () => {
    seed("alex", {
      current_count: 5,
      enabled: true,
      shown_privacy_notice: true,
    });
    render(<StreakBadge username="alex" />);
    await flushReads();
    expect(screen.getByTestId("streak-badge").textContent).toContain("5");

    await act(async () => {
      // Bob's sidecar change should be ignored by Alex's badge.
      await patchStreak("bob", (cur) => ({
        ...cur,
        current_count: 99,
        longest_count: 99,
      }));
    });

    expect(screen.getByTestId("streak-badge").textContent).toContain("5");
  });

  it("hides immediately when patch flips enabled to false", async () => {
    seed("alex", {
      current_count: 9,
      enabled: true,
      shown_privacy_notice: true,
    });
    render(<StreakBadge username="alex" />);
    await flushReads();
    expect(screen.getByTestId("streak-badge")).toBeTruthy();

    await act(async () => {
      await patchStreak("alex", (cur) => ({ ...cur, enabled: false }));
    });

    expect(screen.queryByTestId("streak-badge")).toBeNull();
  });
});
