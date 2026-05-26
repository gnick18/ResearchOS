// FileSystemProvider × edit-session integration coverage for the
// edit-session bleed P0 fix (commit d17c0d11, 2026-05-24).
//
// The unit tests in `lib/lab/__tests__/edit-session.test.ts` pin the
// CONTRACT of resetEditSession in the user-switch reset describe block,
// but they simulate the FileSystemProvider callsite by calling
// `resetEditSession()` directly. This file mounts the real
// `FileSystemProvider` tree, exercises the live `setCurrentUser`
// callback, and asserts on the singleton edit-session snapshot —
// closing the integration gap and pinning the actual wiring between
// the two modules.
//
// What's mocked vs real:
//   - Real: `lib/lab/edit-session` (the module under test on the
//     consumer side — getEditSession / startEditSession / isUnlockedFor
//     all run unmocked so the assertions reflect production behavior).
//   - Real: `FileSystemProvider` itself (the production component,
//     unaltered — this is the whole point of the integration test).
//   - Mocked: every heavy dependency the provider pulls in during
//     mount/initialize so jsdom doesn't try to drive IndexedDB / the
//     File System Access API / disk reads / Zustand hydration side
//     effects. setCurrentUser only needs the in-memory state machine
//     to flip; nothing it does on the bleed-fix path requires real
//     IDB persistence to observe the reset.
//
// Mocking strategy: stub `./indexeddb-store`, `./user-discovery`,
// `./wiki-capture-mock`, `./user-metadata`, `./file-service`,
// `../storage/json-store`, `../auth/cached-password`,
// `../settings/user-settings`, `../demo/rebase`, and `../store`. The
// initialize() useEffect short-circuits at the first IDB read
// (storedHandle === null) and leaves the provider in
// isLoading=false / currentUser=null / isConnected=false. From there
// we drive setCurrentUser entirely against the in-memory state.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { useEffect } from "react";
import { act, render } from "@testing-library/react";

// ── Mocks. vi.mock is hoisted above imports, so these run before the
// production module graph is loaded. The mocked surfaces are limited
// to what file-system-context.tsx actually calls in the paths we care
// about (mount → initialize → setCurrentUser). ──────────────────────

vi.mock("@/lib/file-system/indexeddb-store", () => ({
  // initialize() reads three keys via Promise.all; returning nulls
  // sends the provider down the "nothing stored, idle init" branch
  // and skips finishConnect entirely.
  getStoredDirectoryHandle: vi.fn(async () => null),
  getStoredDirectoryMeta: vi.fn(async () => null),
  getCurrentUser: vi.fn(async () => null),
  getMainUser: vi.fn(async () => null),
  // setCurrentUser writes the new username here; we stub it as a
  // recordable spy so we can assert it was called without needing a
  // real IDB.
  storeCurrentUser: vi.fn(async () => undefined),
  // Other store helpers the provider references via static import.
  // Unused on the mount/setCurrentUser paths but must be present so
  // the named-export shape matches.
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
  // Force the "normal startup" branch — no capture variant, no demo.
  // initialize() falls through to the IDB-read path, which our
  // indexeddb-store mock short-circuits.
  getWikiCaptureVariant: vi.fn(() => null),
  getDemoMode: vi.fn(() => false),
  markDemoMode: vi.fn(),
  installWikiCaptureFixture: vi.fn(async () => undefined),
  // resolveFixtureUser is read on the fixture-install branch only. Not
  // reached in this test (variant is null), but the mock must expose
  // every named export the production module uses so static-imports
  // resolve cleanly.
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

vi.mock("@/lib/auth/cached-password", () => ({
  clearCachedPassword: vi.fn(),
}));

vi.mock("@/lib/settings/user-settings", () => ({
  // hydrateSettingsForUser pulls these three; all become inert no-ops
  // returning the default-shaped settings the Zustand hydrator expects.
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

// Zustand store: stub the two consumer surfaces hydrateSettingsForUser
// touches. The provider doesn't read these back synchronously on the
// setCurrentUser path so a noop is fine. readLegacyLocalStorageSettings
// returning null skips the migration branch entirely.
vi.mock("@/lib/store", () => ({
  useAppStore: {
    getState: () => ({
      hydrateFromSettings: vi.fn(),
      resetSettingsToDefaults: vi.fn(),
    }),
  },
  readLegacyLocalStorageSettings: vi.fn(() => null),
}));

// ── Real imports. These run AFTER the mocks are hoisted. ─────────────

import { FileSystemProvider, useFileSystem } from "../file-system-context";

// The provider's context value type isn't exported, so derive it from
// the hook return type. Keeps the probe ref strongly typed without
// touching production exports.
type FileSystemContextValue = ReturnType<typeof useFileSystem>;
import {
  getEditSession,
  isUnlockedFor,
  resetEditSession,
  startEditSession,
} from "../../lab/edit-session";

// Tiny consumer that exposes the live context value to the test body
// via a ref. Mounted inside FileSystemProvider so it sees the real
// context shape.
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
  // initialize() is async; flush its post-mount microtasks. The
  // mocked IDB reads resolve in a single microtask round, so one
  // extra act() pass is enough to settle isLoading → false.
  await act(async () => {
    await Promise.resolve();
  });
  if (!ctxRef.current) {
    throw new Error("ContextProbe failed to capture FileSystemContextValue");
  }
  return { ctxRef };
}

describe("FileSystemProvider × edit-session bleed fix (integration)", () => {
  beforeEach(() => {
    // Fresh singleton state at the top of every case. The bleed-fix
    // tests in lib/lab/__tests__/edit-session.test.ts already pin the
    // unit-level contract; here we additionally make sure no prior
    // test in this file leaks an unlocked session across cases.
    resetEditSession();
  });

  afterEach(() => {
    resetEditSession();
    vi.clearAllMocks();
  });

  it("setCurrentUser('alex') on a fresh provider leaves the session idle", async () => {
    const { ctxRef } = await mountProvider();

    // Sanity baseline: session is idle and nobody is unlocked.
    expect(getEditSession().state).toBe("idle");
    expect(isUnlockedFor("alex")).toBe(false);

    await act(async () => {
      await ctxRef.current!.setCurrentUser("alex");
    });

    // Still idle — setCurrentUser doesn't unlock anything, it only
    // resets when the username changes. From null → "alex" is a
    // change, so resetEditSession fires (a no-op on an already-idle
    // session). Either way the snapshot must read idle.
    const snap = getEditSession();
    expect(snap.state).toBe("idle");
    expect(snap.active).toBeNull();
    expect(isUnlockedFor("alex")).toBe(false);
  });

  it("startEditSession after setCurrentUser unlocks the active user (precondition for the bleed test)", async () => {
    const { ctxRef } = await mountProvider();

    await act(async () => {
      await ctxRef.current!.setCurrentUser("alex");
    });

    // Drive the lab-head unlock the same way EditSessionPopup does.
    const meta = startEditSession("alex");
    expect(getEditSession().state).toBe("unlocked");
    expect(getEditSession().active?.id).toBe(meta.id);
    expect(isUnlockedFor("alex")).toBe(true);
    expect(isUnlockedFor("morgan")).toBe(false);
  });

  it("switching from alex → morgan drops alex's unlocked session to idle", async () => {
    const { ctxRef } = await mountProvider();

    // alex signs in and unlocks.
    await act(async () => {
      await ctxRef.current!.setCurrentUser("alex");
    });
    startEditSession("alex");
    expect(isUnlockedFor("alex")).toBe(true);

    // The provider switches to morgan. This is the exact bleed
    // scenario: pre-d17c0d11, the unlock survived into morgan and
    // morgan could write under alex's authorization.
    await act(async () => {
      await ctxRef.current!.setCurrentUser("morgan");
    });

    const snap = getEditSession();
    expect(snap.state).toBe("idle");
    expect(snap.active).toBeNull();
    // Both perspectives must read locked-out: morgan never had an
    // unlock and alex's unlock is gone with him.
    expect(isUnlockedFor("alex")).toBe(false);
    expect(isUnlockedFor("morgan")).toBe(false);
  });

  it("same-user setCurrentUser('morgan') → setCurrentUser('morgan') no-op does NOT reset an idle session into anything weird", async () => {
    const { ctxRef } = await mountProvider();

    // morgan signs in. Session is idle.
    await act(async () => {
      await ctxRef.current!.setCurrentUser("morgan");
    });
    expect(getEditSession().state).toBe("idle");

    // Same-user re-call. The bleed fix intentionally skips
    // resetEditSession on this branch so a live timer wouldn't be
    // interrupted. The session must remain idle (it already was).
    await act(async () => {
      await ctxRef.current!.setCurrentUser("morgan");
    });

    expect(getEditSession().state).toBe("idle");
    expect(getEditSession().active).toBeNull();
  });

  it("same-user setCurrentUser does NOT interrupt an active unlock (live timer preserved)", async () => {
    const { ctxRef } = await mountProvider();

    await act(async () => {
      await ctxRef.current!.setCurrentUser("morgan");
    });
    const meta = startEditSession("morgan");
    expect(getEditSession().state).toBe("unlocked");
    expect(getEditSession().active?.id).toBe(meta.id);

    // Provider re-calls setCurrentUser with the SAME username. The
    // fix's prev-vs-incoming guard means resetEditSession is NOT
    // called, so the unlock and its session id survive.
    await act(async () => {
      await ctxRef.current!.setCurrentUser("morgan");
    });

    const snap = getEditSession();
    expect(snap.state).toBe("unlocked");
    expect(snap.active?.username).toBe("morgan");
    expect(snap.active?.id).toBe(meta.id);
    expect(isUnlockedFor("morgan")).toBe(true);
  });

  it("round-trip alex → morgan (unlock morgan) → alex does not let alex inherit morgan's unlock", async () => {
    const { ctxRef } = await mountProvider();

    // alex signs in but stays idle.
    await act(async () => {
      await ctxRef.current!.setCurrentUser("alex");
    });
    expect(getEditSession().state).toBe("idle");

    // Switch to morgan, who then unlocks the lab-head window.
    await act(async () => {
      await ctxRef.current!.setCurrentUser("morgan");
    });
    startEditSession("morgan");
    expect(isUnlockedFor("morgan")).toBe(true);

    // Switch back to alex. The provider's prev-vs-incoming guard
    // sees the change ("morgan" → "alex"), calls resetEditSession,
    // and morgan's unlock is dropped before alex becomes current.
    await act(async () => {
      await ctxRef.current!.setCurrentUser("alex");
    });

    // alex sees an idle session — not morgan's stale unlock.
    const snap = getEditSession();
    expect(snap.state).toBe("idle");
    expect(snap.active).toBeNull();
    expect(isUnlockedFor("alex")).toBe(false);
    expect(isUnlockedFor("morgan")).toBe(false);
  });
});
