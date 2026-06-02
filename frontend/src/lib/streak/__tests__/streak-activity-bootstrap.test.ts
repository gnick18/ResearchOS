// frontend/src/lib/streak/__tests__/streak-activity-bootstrap.test.ts
//
// S1 wiring tests: the bootstrap that bridges fileService writes to
// the streak activity tracker. Verifies the two explicit gates
// (_streak.json feedback loop + _user_metadata.json non-data-write)
// and the no-active-user case.
//
// Mocks fileService + getCurrentUserCached so we can drive the
// observer pipeline without an FSA shim or IndexedDB.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock the write-hooks registry. We don't mock the real fileService:
// we drive notifyFileWritten directly, since fileService's atomicWrite
// can't run in node-env (no FSA). The thing under test is the
// registration + path-gating logic, which lives in the bootstrap.
vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async () => null),
    writeJson: vi.fn(async () => undefined),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("@/lib/file-system/user-metadata", () => ({
  getUserMetadata: vi.fn(async () => null),
}));

// Mock the current-user accessor so we can flip between "alex",
// "_no_user_", and a throwing case.
const userMock = vi.fn(async () => "alex");
vi.mock("@/lib/storage/json-store", () => ({
  getCurrentUserCached: (...args: unknown[]) => userMock(...args as []),
}));

// Mock the tracker so we can observe notify calls (we already test
// the tracker's internal logic in the sibling file).
const notifyMock = vi.fn();
const flushMock = vi.fn(async (_username?: string) => undefined);
vi.mock("../streak-activity-tracker", () => ({
  notifyStreakActivity: (...args: unknown[]) => notifyMock(...args as [string]),
  flushStreakActivity: (...args: unknown[]) =>
    flushMock(...args as [string | undefined]),
  onStreakMilestoneCrossed: vi.fn(),
  __resetStreakActivityTrackerForTests: vi.fn(),
}));

import {
  __resetFileWriteObserversForTests,
  notifyFileWritten,
} from "@/lib/file-system/file-write-hooks";
import {
  installStreakActivityTracking,
  uninstallStreakActivityTracking,
} from "../streak-activity-bootstrap";

beforeEach(() => {
  __resetFileWriteObserversForTests();
  uninstallStreakActivityTracking();
  notifyMock.mockClear();
  flushMock.mockClear();
  userMock.mockReset();
  userMock.mockResolvedValue("alex");
});

afterEach(() => {
  uninstallStreakActivityTracking();
  __resetFileWriteObserversForTests();
});

/** Wait one macrotask for the inner async user-resolution to complete. */
async function tickAsync(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("write-path gate", () => {
  it("a normal user-data write triggers notifyStreakActivity", async () => {
    installStreakActivityTracking();
    notifyFileWritten("users/alex/projects/p-001/_sidecar.json");
    await tickAsync();
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith("alex");
  });

  it("a write to _streak.json does NOT trigger notify (feedback loop gate)", async () => {
    installStreakActivityTracking();
    notifyFileWritten("users/alex/_streak.json");
    await tickAsync();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("a write to _user_metadata.json does NOT trigger notify", async () => {
    installStreakActivityTracking();
    notifyFileWritten("users/alex/_user_metadata.json");
    await tickAsync();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("no active user (sentinel _no_user_) does NOT trigger notify", async () => {
    userMock.mockResolvedValue("_no_user_");
    installStreakActivityTracking();
    notifyFileWritten("users/alex/projects/p-001/_sidecar.json");
    await tickAsync();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("empty-string active user does NOT trigger notify", async () => {
    userMock.mockResolvedValue("");
    installStreakActivityTracking();
    notifyFileWritten("users/alex/projects/p-001/_sidecar.json");
    await tickAsync();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("user-resolution failure does NOT throw out of the observer", async () => {
    userMock.mockRejectedValue(new Error("indexeddb dead"));
    installStreakActivityTracking();
    // notifyFileWritten itself must NOT throw; the rejected promise is
    // caught inside the bootstrap's void IIFE.
    expect(() =>
      notifyFileWritten("users/alex/projects/p-001/_sidecar.json"),
    ).not.toThrow();
    await tickAsync();
    expect(notifyMock).not.toHaveBeenCalled();
  });
});

describe("idempotent install", () => {
  it("repeated installStreakActivityTracking calls don't double-register", async () => {
    installStreakActivityTracking();
    installStreakActivityTracking();
    installStreakActivityTracking();

    notifyFileWritten("users/alex/projects/p-001/_sidecar.json");
    await tickAsync();
    // If we double-registered, notifyMock would be called 3x for one
    // write. It must be exactly 1.
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it("uninstall stops further notifies", async () => {
    installStreakActivityTracking();
    notifyFileWritten("users/alex/projects/p-001/_sidecar.json");
    await tickAsync();
    expect(notifyMock).toHaveBeenCalledTimes(1);

    uninstallStreakActivityTracking();
    notifyFileWritten("users/alex/projects/p-002/_sidecar.json");
    await tickAsync();
    // Still 1: second write wasn't observed.
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });
});
