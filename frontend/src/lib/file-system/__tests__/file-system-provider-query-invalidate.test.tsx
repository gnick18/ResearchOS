// FileSystemProvider × React Query invalidation integration coverage
// for the events-widget user-switch fix (2026-05-25).
//
// R2 Mira PI verifier flagged that switching the active user in-tab
// (via setCurrentUser) did not invalidate the React Query cache, so
// the Today's events widget on /lab-overview kept rendering the
// previous user's data until a full page reload. The fix wires
// `appQueryClient.invalidateQueries()` into setCurrentUser whenever
// the username actually changes (skipped on the initial null → user
// transition to avoid redundant refetches at mount time).
//
// What this file pins:
//   - A user switch (alex → morgan) calls invalidateQueries exactly
//     once, so cached ["events"] / ["tasks"] / etc. for alex are
//     marked stale before any morgan widget renders.
//   - Same-user re-call (alex → alex) does NOT invalidate, matching
//     the prev-vs-incoming guard used elsewhere in the function.
//   - Initial null → user (mount / silent reconnect) does NOT
//     invalidate — there are no stale queries from a prior session
//     and we don't want to thrash freshly-mounted widgets.
//
// Mocking strategy mirrors `file-system-provider-edit-session.test.tsx`
// so the provider mount short-circuits at the first IDB read and the
// in-memory state machine drives the setCurrentUser callback.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { useEffect } from "react";
import { act, render } from "@testing-library/react";

vi.mock("@/lib/file-system/indexeddb-store", () => ({
  getStoredDirectoryHandle: vi.fn(async () => null),
  getStoredDirectoryMeta: vi.fn(async () => null),
  getCurrentUser: vi.fn(async () => null),
  getMainUser: vi.fn(async () => null),
  storeCurrentUser: vi.fn(async () => undefined),
  storeDirectoryHandle: vi.fn(async () => undefined),
  clearDirectoryHandle: vi.fn(async () => undefined),
  clearCurrentUser: vi.fn(async () => undefined),
  clearMainUser: vi.fn(async () => undefined),
  restorePreDemoStateOrClear: vi.fn(async () => false),
}));

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    isConnected: () => false,
    setDirectoryHandle: vi.fn(),
    clearDirectoryHandle: vi.fn(),
    getDirectoryHandle: () => null,
    verifyPermission: vi.fn(async () => true),
    resetReadCount: vi.fn(),
  },
}));

vi.mock("@/lib/file-system/user-discovery", () => ({
  discoverUsers: vi.fn(async () => []),
  validateResearchFolder: vi.fn(async () => true),
  ensureFolderStructure: vi.fn(async () => true),
}));

vi.mock("@/lib/file-system/user-metadata", () => ({
  readMainUser: vi.fn(async () => null),
  writeMainUser: vi.fn(async () => undefined),
}));

vi.mock("@/lib/file-system/wiki-capture-mock", () => ({
  getWikiCaptureVariant: vi.fn(() => null),
  getDemoMode: vi.fn(() => false),
  markDemoMode: vi.fn(),
  installWikiCaptureFixture: vi.fn(async () => undefined),
  resolveFixtureUser: vi.fn(() => "alex"),
  WIKI_CAPTURE_FIXTURE_USERS: ["alex", "morgan", "mira", "sam"],
}));

vi.mock("@/lib/demo/rebase", () => ({
  rebaseDemoDates: vi.fn(async () => ({ delta: 0, filesWritten: 0 })),
  isDemoLab: vi.fn(async () => false),
}));

vi.mock("@/lib/storage/json-store", () => ({
  clearCurrentUserCache: vi.fn(),
}));

vi.mock("@/lib/settings/user-settings", () => ({
  userSettingsFileExists: vi.fn(async () => false),
  readUserSettings: vi.fn(async () => ({
    animationType: "none",
    defaultGanttViewMode: "week",
    defaultCalendarViewMode: "month",
    showSharedByDefault: false,
    visibleTabs: [],
    defaultLandingTab: null,
    sidebarShowTasks: true,
    sidebarShowCalendarEvents: true,
    sidebarEventsHorizonDays: 7,
    coloredHeader: false,
    offlineMode: false,
  })),
  patchUserSettings: vi.fn(async () => ({
    animationType: "none",
    defaultGanttViewMode: "week",
    defaultCalendarViewMode: "month",
    showSharedByDefault: false,
    visibleTabs: [],
    defaultLandingTab: null,
    sidebarShowTasks: true,
    sidebarShowCalendarEvents: true,
    sidebarEventsHorizonDays: 7,
    coloredHeader: false,
    offlineMode: false,
  })),
  DEFAULT_SETTINGS: {
    animationType: "none",
    defaultGanttViewMode: "week",
    defaultCalendarViewMode: "month",
    showSharedByDefault: false,
    visibleTabs: [],
    defaultLandingTab: null,
    sidebarShowTasks: true,
    sidebarShowCalendarEvents: true,
    sidebarEventsHorizonDays: 7,
    coloredHeader: false,
    offlineMode: false,
  },
}));

vi.mock("@/lib/store", () => ({
  useAppStore: {
    getState: () => ({
      hydrateFromSettings: vi.fn(),
      resetSettingsToDefaults: vi.fn(),
    }),
  },
  readLegacyLocalStorageSettings: vi.fn(() => null),
}));

// Spy on appQueryClient.invalidateQueries WITHOUT replacing the whole
// module — the production setCurrentUser callback imports
// `appQueryClient` as a value and calls `.invalidateQueries()` on it.
// A module-level vi.mock would force us to re-implement the whole
// QueryClient surface. Instead, import the real singleton and patch
// the one method we care about with a spy that delegates back to the
// original. afterEach restores the spy.
import { appQueryClient } from "../../query-client";

import { FileSystemProvider, useFileSystem } from "../file-system-context";

type FileSystemContextValue = ReturnType<typeof useFileSystem>;

function ContextProbe({
  ctxRef,
}: {
  ctxRef: { current: FileSystemContextValue | null };
}) {
  const ctx = useFileSystem();
  useEffect(() => {
    ctxRef.current = ctx;
  }, [ctx, ctxRef]);
  return null;
}

async function mountProvider(): Promise<{
  ctxRef: { current: FileSystemContextValue | null };
}> {
  const ctxRef: { current: FileSystemContextValue | null } = { current: null };
  await act(async () => {
    render(
      <FileSystemProvider>
        <ContextProbe ctxRef={ctxRef} />
      </FileSystemProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  if (!ctxRef.current) {
    throw new Error("ContextProbe failed to capture FileSystemContextValue");
  }
  return { ctxRef };
}

describe("FileSystemProvider × React Query invalidation on user switch", () => {
  let invalidateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    invalidateSpy = vi.spyOn(appQueryClient, "invalidateQueries");
  });

  afterEach(() => {
    invalidateSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("initial null → alex transition does NOT invalidate (mount path, no stale cache)", async () => {
    const { ctxRef } = await mountProvider();

    await act(async () => {
      await ctxRef.current!.setCurrentUser("alex");
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("alex → morgan switch invalidates React Query exactly once", async () => {
    const { ctxRef } = await mountProvider();

    // Establish alex as the prior user. This is the null → user
    // transition, which intentionally does not invalidate (covered
    // above), so we can pin the morgan-switch case in isolation.
    await act(async () => {
      await ctxRef.current!.setCurrentUser("alex");
    });
    expect(invalidateSpy).not.toHaveBeenCalled();

    // The real user-switch: alex → morgan. This is the bug Mira's
    // verifier hit. invalidateQueries() with no args nukes every
    // cached query, including the ["events"] / ["tasks"] keys that
    // don't carry the username in their tuple.
    await act(async () => {
      await ctxRef.current!.setCurrentUser("morgan");
    });

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    // No-args invalidate means "nuke everything"; assert the
    // call-shape so a future selective refactor doesn't silently
    // weaken the fix.
    expect(invalidateSpy.mock.calls[0]).toEqual([]);
  });

  it("same-user setCurrentUser('alex') → setCurrentUser('alex') does NOT invalidate", async () => {
    const { ctxRef } = await mountProvider();

    await act(async () => {
      await ctxRef.current!.setCurrentUser("alex");
    });
    // Re-call with the same username. The prev-vs-incoming guard
    // (shared with the edit-session reset above it) must short-
    // circuit; we don't want to thrash the cache on routes that
    // re-call setCurrentUser purely to refresh other state.
    await act(async () => {
      await ctxRef.current!.setCurrentUser("alex");
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("alex → morgan → alex round-trip invalidates exactly twice (once per real change)", async () => {
    const { ctxRef } = await mountProvider();

    await act(async () => {
      await ctxRef.current!.setCurrentUser("alex");
    });
    await act(async () => {
      await ctxRef.current!.setCurrentUser("morgan");
    });
    await act(async () => {
      await ctxRef.current!.setCurrentUser("alex");
    });

    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });
});
