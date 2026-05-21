// Component tests for <StreaksSection />, Phase S3 of the
// Streak-and-Milestones arc (see STREAK_AND_MILESTONES_PROPOSAL.md §6.2).
//
// What's pinned here:
//  - Toggle reflects sidecar.enabled and flips it via patchStreak.
//  - Stat trio is gated on enabled === true.
//  - Reset modal: cancel = no patch; confirm = clear counter +
//    started_on + last_activity_date; checkbox extends to clearing
//    celebrations_seen.streak_milestones (but never account_anniversaries
//    per §7.2).
//  - PTO subsection placeholder renders with the contract testid that
//    S4's wiring will replace.
//  - Smoke test: section mounts inside the Settings page render.
//
// Mocking strategy: the streak-sidecar module is mocked at module scope
// so we can drive readStreak / patchStreak with an in-memory store and
// assert on what the component passes through patchStreak's mutator
// (the actual write logic is covered by the S0 sidecar test).
// useFileSystem is mocked to return a stable user so the load effect
// resolves deterministically.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { StreakSidecar } from "@/lib/streak/streak-sidecar";

// ---- streak-sidecar mock --------------------------------------------------

const INITIAL: StreakSidecar = {
  schema_version: 1,
  enabled: true,
  current_count: 12,
  longest_count: 28,
  last_activity_date: "2026-05-20",
  started_on: "2026-05-08",
  shown_privacy_notice: true,
  pto_dates: [],
  celebrations_seen: {
    account_anniversaries: ["1w", "1mo"],
    streak_milestones: ["3d", "7d"],
  },
};

let storedSidecar: StreakSidecar = structuredClone(INITIAL);
const patchCalls: StreakSidecar[] = [];

vi.mock("@/lib/streak/streak-sidecar", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/streak/streak-sidecar")
  >("@/lib/streak/streak-sidecar");
  return {
    ...actual,
    readStreak: vi.fn(async () => structuredClone(storedSidecar)),
    patchStreak: vi.fn(
      async (
        _username: string,
        mutator: (cur: StreakSidecar) => StreakSidecar,
      ) => {
        const next = mutator(structuredClone(storedSidecar));
        storedSidecar = next;
        patchCalls.push(structuredClone(next));
        return structuredClone(next);
      },
    ),
  };
});

// ---- file-system-context mock --------------------------------------------

vi.mock("@/lib/file-system/file-system-context", () => ({
  useFileSystem: () => ({
    currentUser: "alex",
    isConnected: true,
  }),
}));

// ---- imports under test ---------------------------------------------------

import StreaksSection from "../StreaksSection";

beforeEach(() => {
  cleanup();
  storedSidecar = structuredClone(INITIAL);
  patchCalls.length = 0;
});

async function renderSection() {
  const result = render(<StreaksSection />);
  // The load effect kicks a microtask; wait for the toggle to appear.
  await screen.findByTestId("streaks-enable-toggle");
  return result;
}

describe("<StreaksSection />", () => {
  it("renders toggle in checked state when sidecar enabled", async () => {
    await renderSection();
    const toggle = screen.getByTestId("streaks-enable-toggle");
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("renders the stat trio when enabled", async () => {
    await renderSection();
    expect(screen.getByTestId("streaks-stats")).toBeInTheDocument();
    expect(screen.getByText("12 days")).toBeInTheDocument();
    expect(screen.getByText("28 days")).toBeInTheDocument();
    expect(screen.getByText("2026-05-08")).toBeInTheDocument();
  });

  it("hides the stat trio when disabled", async () => {
    storedSidecar = { ...INITIAL, enabled: false };
    await renderSection();
    expect(screen.queryByTestId("streaks-stats")).not.toBeInTheDocument();
    expect(screen.queryByTestId("streaks-reset-button")).not.toBeInTheDocument();
  });

  it("toggle off patches sidecar.enabled = false", async () => {
    const user = userEvent.setup();
    await renderSection();
    await user.click(screen.getByTestId("streaks-enable-toggle"));
    await waitFor(() => expect(patchCalls.length).toBe(1));
    expect(patchCalls[0].enabled).toBe(false);
    // Other fields untouched.
    expect(patchCalls[0].current_count).toBe(12);
    expect(patchCalls[0].longest_count).toBe(28);
  });

  it("toggle on patches sidecar.enabled = true (and preserves state)", async () => {
    storedSidecar = { ...INITIAL, enabled: false };
    const user = userEvent.setup();
    await renderSection();
    await user.click(screen.getByTestId("streaks-enable-toggle"));
    await waitFor(() => expect(patchCalls.length).toBe(1));
    expect(patchCalls[0].enabled).toBe(true);
    expect(patchCalls[0].current_count).toBe(12);
    expect(patchCalls[0].longest_count).toBe(28);
    expect(patchCalls[0].started_on).toBe("2026-05-08");
  });

  it("reset button opens the confirmation modal", async () => {
    const user = userEvent.setup();
    await renderSection();
    expect(screen.queryByTestId("streaks-reset-modal")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("streaks-reset-button"));
    expect(screen.getByTestId("streaks-reset-modal")).toBeInTheDocument();
    expect(screen.getByText(/Reset your 12-day streak/)).toBeInTheDocument();
  });

  it("modal Cancel closes the dialog without patching", async () => {
    const user = userEvent.setup();
    await renderSection();
    await user.click(screen.getByTestId("streaks-reset-button"));
    await user.click(screen.getByTestId("streaks-reset-cancel"));
    expect(screen.queryByTestId("streaks-reset-modal")).not.toBeInTheDocument();
    expect(patchCalls.length).toBe(0);
  });

  it("modal Confirm patches current_count=0, started_on=null, last_activity_date=null", async () => {
    const user = userEvent.setup();
    await renderSection();
    await user.click(screen.getByTestId("streaks-reset-button"));
    await user.click(screen.getByTestId("streaks-reset-confirm"));
    await waitFor(() => expect(patchCalls.length).toBe(1));
    const patched = patchCalls[0];
    expect(patched.current_count).toBe(0);
    expect(patched.started_on).toBeNull();
    expect(patched.last_activity_date).toBeNull();
    // Personal best preserved.
    expect(patched.longest_count).toBe(28);
    // Streak milestones NOT cleared when checkbox unchecked.
    expect(patched.celebrations_seen.streak_milestones).toEqual(["3d", "7d"]);
    // Account anniversaries always preserved (§7.2).
    expect(patched.celebrations_seen.account_anniversaries).toEqual([
      "1w",
      "1mo",
    ]);
  });

  it("modal Confirm with 'also clear celebrations seen' clears streak_milestones but keeps account_anniversaries", async () => {
    const user = userEvent.setup();
    await renderSection();
    await user.click(screen.getByTestId("streaks-reset-button"));
    await user.click(
      screen.getByTestId("streaks-reset-also-clear-celebrations"),
    );
    await user.click(screen.getByTestId("streaks-reset-confirm"));
    await waitFor(() => expect(patchCalls.length).toBe(1));
    const patched = patchCalls[0];
    expect(patched.celebrations_seen.streak_milestones).toEqual([]);
    // Account anniversaries are date-anchored and must NEVER be reset
    // from this UI (§7.2 hard rule).
    expect(patched.celebrations_seen.account_anniversaries).toEqual([
      "1w",
      "1mo",
    ]);
  });

  it("renders the PTO stub with its contract testid", async () => {
    await renderSection();
    const stub = screen.getByTestId("streaks-pto-stub");
    expect(stub).toBeInTheDocument();
    expect(stub).toBeDisabled();
  });

  it("shows 'Not started yet' when started_on is null", async () => {
    storedSidecar = {
      ...INITIAL,
      current_count: 0,
      started_on: null,
      last_activity_date: null,
    };
    await renderSection();
    expect(screen.getByText("Not started yet")).toBeInTheDocument();
  });

  it("shows the disabled-state subhead when enabled is false", async () => {
    storedSidecar = { ...INITIAL, enabled: false };
    await renderSection();
    expect(
      screen.getByText(/Streaks are off\. Re-enable to start tracking/),
    ).toBeInTheDocument();
  });
});

// ---- smoke: section appears in the Settings page render ------------------
//
// We don't render the whole SettingsPage tree here (it pulls in dozens
// of providers and a heavy section graph that other tests cover). The
// smoke check just confirms the page module imports StreaksSection and
// places it in the section list, which is the integration contract
// S3 commits to.

describe("Settings page integration", () => {
  it("page.tsx imports and renders StreaksSection", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const pagePath = path.resolve(
      __dirname,
      "..",
      "page.tsx",
    );
    const src = fs.readFileSync(pagePath, "utf8");
    expect(src).toContain('import StreaksSection from "./StreaksSection"');
    expect(src).toContain("<StreaksSection />");
  });
});
