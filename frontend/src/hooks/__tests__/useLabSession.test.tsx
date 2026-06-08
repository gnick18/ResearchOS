// Tests for hooks/useLabSession.ts
//
// Covers:
//   - returns { controller, labId } when LAB_TIER_ENABLED + currentUser + lab_id
//   - returns null when no lab_id (solo user)
//   - returns null when LAB_TIER_ENABLED is false
//   - returns null when no currentUser
//
// All external I/O is mocked. createLabSessionController/Effects are stubbed
// with a plain object so no real crypto or DO calls happen.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Hoist mutable refs so vi.mock factories can close over them.
// ---------------------------------------------------------------------------

const {
  labTierEnabledRef,
  currentUserRef,
  readUserSettingsRef,
  onUserSettingsWrittenRef,
  stubController,
} = vi.hoisted(() => ({
  labTierEnabledRef: { current: true },
  currentUserRef: { current: null as string | null },
  readUserSettingsRef: {
    current: vi.fn().mockResolvedValue({ lab_id: null }),
  },
  onUserSettingsWrittenRef: {
    current: vi.fn().mockReturnValue(() => {}),
  },
  stubController: {
    getState: vi.fn(),
    subscribe: vi.fn().mockReturnValue(() => {}),
    getError: vi.fn().mockReturnValue(null),
    start: vi.fn(),
    signIn: vi.fn(),
    signalExpiry: vi.fn(),
    tickExpiry: vi.fn(),
    logout: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/lab/config", () => ({
  get LAB_TIER_ENABLED() {
    return labTierEnabledRef.current;
  },
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: currentUserRef.current }),
}));

vi.mock("@/lib/settings/user-settings", () => ({
  readUserSettings: (...args: Parameters<typeof readUserSettingsRef.current>) =>
    readUserSettingsRef.current(...args),
  onUserSettingsWritten: (...args: Parameters<typeof onUserSettingsWrittenRef.current>) =>
    onUserSettingsWrittenRef.current(...args),
}));

vi.mock("@/lib/lab/lab-session", () => ({
  createLabSessionController: vi.fn().mockReturnValue(stubController),
}));

vi.mock("@/lib/lab/lab-session-effects", () => ({
  createLabSessionEffects: vi.fn().mockReturnValue({}),
}));

// ---------------------------------------------------------------------------
// Import the hook under test AFTER mocks.
// ---------------------------------------------------------------------------

import { useLabSession } from "../useLabSession";

// ---------------------------------------------------------------------------
// Reset helpers before each test.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  labTierEnabledRef.current = true;
  currentUserRef.current = "manny";
  readUserSettingsRef.current = vi.fn().mockResolvedValue({ lab_id: "L1" });
  onUserSettingsWrittenRef.current = vi.fn().mockReturnValue(() => {});
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useLabSession", () => {
  it("returns { controller, labId } when flag on + user present + lab_id set", async () => {
    const { result } = renderHook(() => useLabSession());

    // The effect is async, so we need to wait for the state to resolve.
    await act(async () => {});

    expect(result.current).not.toBeNull();
    const s = result.current;
    if (!s || s.loading) throw new Error("expected resolved session");
    expect(s.labId).toBe("L1");
    expect(s.controller).toBe(stubController);
  });

  it("returns null when user has no lab_id (solo user)", async () => {
    readUserSettingsRef.current = vi.fn().mockResolvedValue({ lab_id: undefined });

    const { result } = renderHook(() => useLabSession());
    await act(async () => {});

    expect(result.current).toBeNull();
  });

  it("returns null when LAB_TIER_ENABLED is false", async () => {
    labTierEnabledRef.current = false;

    const { result } = renderHook(() => useLabSession());
    await act(async () => {});

    expect(result.current).toBeNull();
  });

  it("returns null when there is no currentUser", async () => {
    currentUserRef.current = null;

    const { result } = renderHook(() => useLabSession());
    await act(async () => {});

    expect(result.current).toBeNull();
  });
});
