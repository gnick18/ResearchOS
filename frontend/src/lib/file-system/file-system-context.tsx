"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { fileService } from "./file-service";
import {
  storeDirectoryHandle,
  getStoredDirectoryHandle,
  getStoredDirectoryMeta,
  clearDirectoryHandle,
  storeCurrentUser,
  getCurrentUser,
  getMainUser,
  clearMainUser,
  clearCurrentUser,
  restorePreDemoStateOrClear,
} from "./indexeddb-store";
import { readMainUser, writeMainUser, pruneOrphanUserMetadataEntries } from "./user-metadata";
import { clearCurrentUserCache } from "../storage/json-store";
import { clearCachedPassword } from "../auth/cached-password";
import { discoverUsers, validateResearchFolder, ensureFolderStructure } from "./user-discovery";
import { readUserSettings, patchUserSettings, userSettingsFileExists, DEFAULT_SETTINGS } from "../settings/user-settings";
import { useAppStore, readLegacyLocalStorageSettings } from "../store";
import { getWikiCaptureVariant, getDemoMode, markDemoMode, installWikiCaptureFixture, resolveFixtureUser } from "./wiki-capture-mock";
import { rebaseDemoDates, isDemoLab } from "../demo/rebase";
import { resetEditSession } from "../lab/edit-session";
import { appQueryClient } from "../query-client";
import { FEED_EVENTS_PREFIX } from "../calendar/feed-cache-keys";
import {
  migrateLegacyNotesTrashAllUsers,
  runAutoCleanupPass,
} from "../trash";
import { runRevertWindowSweep } from "../notes/revert-window-sweep";

/** Coarse-grained phase of the startup connect flow. Used by the loading
 *  screen so the user sees something change while OneDrive is being slow.
 *  `opening-picker` covers the time between clicking Connect and the OS
 *  picker appearing — on OneDrive folders this can be 15-60s and the
 *  browser is fully blocked. */
export type LoadingStage =
  | null
  | "opening-picker"
  | "connecting"
  | "verifying-permission"
  | "validating-folder"
  | "discovering-users"
  | "preparing";

interface FileSystemState {
  isConnected: boolean;
  isLoading: boolean;
  loadingStage: LoadingStage;
  error: string | null;
  directoryName: string | null;
  currentUser: string | null;
  mainUser: string | null;
  availableUsers: string[];
  needsInitialization: boolean;
  lastConnectedFolder: string | null;
}

interface FileSystemContextValue extends FileSystemState {
  connect: () => Promise<boolean>;
  /**
   * Attach to a `FileSystemDirectoryHandle` we already obtained (e.g. from
   * `DataTransferItem.getAsFileSystemHandle()` on a folder drop). Routes
   * through the exact same post-handle pipeline as `connect()` — verify
   * permission, validate folder, discover users, populate state. Must be
   * called from a user gesture (the drop event itself qualifies).
   */
  connectWithHandle: (handle: FileSystemDirectoryHandle) => Promise<boolean>;
  /**
   * Re-attach to the previously connected folder using the handle persisted
   * in IndexedDB. If the browser still remembers the permission grant, this
   * resolves silently; otherwise it triggers a tiny `requestPermission`
   * confirmation (much cheaper than the full OS folder picker). Must be
   * called from a user gesture so the browser allows the permission prompt.
   */
  reconnectWithStoredHandle: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  setCurrentUser: (username: string) => Promise<void>;
  createUser: (username: string) => Promise<boolean>;
  refreshUsers: () => Promise<void>;
  reverifyPermission: () => Promise<boolean>;
  initializeFolder: () => Promise<boolean>;
  createNewFolder: (folderName: string) => Promise<boolean>;
}

interface PermissionableHandle extends FileSystemDirectoryHandle {
  queryPermission?: (opts: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (opts: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
}

const FileSystemContext = createContext<FileSystemContextValue | null>(null);

export function FileSystemProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<FileSystemState>({
    isConnected: false,
    isLoading: true,
    loadingStage: null,
    error: null,
    directoryName: null,
    currentUser: null,
    mainUser: null,
    availableUsers: [],
    needsInitialization: false,
    lastConnectedFolder: null,
  });

  // edit-session bleed fix 2026-05-24: shadow the currentUser into a ref
  // so user-switch callbacks (setCurrentUser, disconnect) can read the
  // previous user synchronously without going through setState updater
  // side-effects (which fire twice in StrictMode). The ref is the
  // source of truth for "what user did we leave behind?" when deciding
  // whether to clear the lab-head edit session.
  const currentUserRef = useRef<string | null>(null);
  useEffect(() => {
    currentUserRef.current = state.currentUser;
  }, [state.currentUser]);

  const refreshUsers = useCallback(async () => {
    if (!fileService.isConnected()) return;

    const users = await discoverUsers();
    setState((prev) => ({ ...prev, availableUsers: users }));
  }, []);

  /**
   * Loads `users/{username}/settings.json` from disk into the Zustand store.
   * On first run, migrates the legacy `research-os-settings` localStorage
   * blob (animation choice only) into the new file. Safe to call repeatedly.
   */
  const hydrateSettingsForUser = useCallback(async (username: string) => {
    try {
      const exists = await userSettingsFileExists(username);
      let settings = await readUserSettings(username);
      if (!exists && fileService.isConnected()) {
        const legacy = readLegacyLocalStorageSettings();
        if (legacy?.animationType) {
          settings = await patchUserSettings(username, { animationType: legacy.animationType });
          // Consume the legacy blob so subsequent users (who never owned this
          // localStorage key) don't inherit the same animation choice when
          // they log in for the first time. The localStorage was tied to the
          // browser, not the user — whoever migrates first wins.
          if (typeof window !== "undefined") {
            window.localStorage.removeItem("research-os-settings");
          }
        }
      }
      useAppStore.getState().hydrateFromSettings({
        animationType: settings.animationType,
        viewMode: settings.defaultGanttViewMode,
        calendarViewMode: settings.defaultCalendarViewMode,
        showShared: settings.showSharedByDefault,
        visibleTabs: settings.visibleTabs,
        defaultLandingTab: settings.defaultLandingTab,
        sidebarShowTasks: settings.sidebarShowTasks,
        sidebarShowCalendarEvents: settings.sidebarShowCalendarEvents,
        sidebarEventsHorizonDays: settings.sidebarEventsHorizonDays,
        coloredHeader: settings.coloredHeader,
        offlineMode: settings.offlineMode,
      });
    } catch (err) {
      console.warn("[FileSystemProvider.hydrateSettingsForUser] failed", err);
      useAppStore.getState().hydrateFromSettings({
        animationType: DEFAULT_SETTINGS.animationType,
        viewMode: DEFAULT_SETTINGS.defaultGanttViewMode,
        calendarViewMode: DEFAULT_SETTINGS.defaultCalendarViewMode,
        showShared: DEFAULT_SETTINGS.showSharedByDefault,
        visibleTabs: DEFAULT_SETTINGS.visibleTabs,
        defaultLandingTab: DEFAULT_SETTINGS.defaultLandingTab,
        sidebarShowTasks: DEFAULT_SETTINGS.sidebarShowTasks,
        sidebarShowCalendarEvents: DEFAULT_SETTINGS.sidebarShowCalendarEvents,
        sidebarEventsHorizonDays: DEFAULT_SETTINGS.sidebarEventsHorizonDays,
        coloredHeader: DEFAULT_SETTINGS.coloredHeader,
        offlineMode: DEFAULT_SETTINGS.offlineMode,
      });
    }
  }, []);

  const reverifyPermission = useCallback(async (): Promise<boolean> => {
    return fileService.verifyPermission(true);
  }, []);

  /**
   * Drive the shared "post-handle" phases — verify permission, validate the
   * folder, discover users, populate state. Called both by `connect()` after
   * the OS picker resolves and by `reconnectWithStoredHandle()` after the
   * lightweight permission-only path. The caller is responsible for setting
   * `isLoading: true` first.
   */
  const finishConnect = useCallback(
    async (handle: FileSystemDirectoryHandle): Promise<boolean> => {
      try {
        fileService.setDirectoryHandle(handle);

        setState((prev) => ({ ...prev, loadingStage: "verifying-permission" }));
        const hasPermission = await fileService.verifyPermission(true);
        if (!hasPermission) {
          fileService.clearDirectoryHandle();
          setState((prev) => ({
            ...prev,
            isLoading: false,
            loadingStage: null,
            error: "Permission denied. Please allow read/write access to the folder.",
          }));
          return false;
        }

        setState((prev) => ({ ...prev, loadingStage: "validating-folder" }));
        const isValid = await validateResearchFolder(handle);
        if (!isValid) {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            loadingStage: null,
            error: null,
            directoryName: handle.name,
            needsInitialization: true,
          }));
          return false;
        }

        await storeDirectoryHandle(handle);

        // Demo-lab date rebase: if this folder is a demo (marker file
        // says so), shift all task/goal/event/project/shared dates by
        // `today - last_rebased_at` days. Idempotent — no-op when run
        // twice on the same day. Strictly guarded by `is_demo: true`
        // so real research folders never go through this code path.
        try {
          if (await isDemoLab(fileService)) {
            const result = await rebaseDemoDates(fileService);
            if (result.delta !== 0) {
              console.log(
                `[FileSystemProvider] Rebased demo dates by ${result.delta} day(s); ${result.filesWritten} file(s) updated.`,
              );
            }
          }
        } catch (err) {
          console.warn("[FileSystemProvider] demo rebase failed:", err);
        }

        setState((prev) => ({ ...prev, loadingStage: "discovering-users" }));
        const users = await discoverUsers();

        // Self-heal sweep over `_user_metadata.json` (lab-roster ghost
        // cleanup, 2026-05-26). Removes entries that are invalid
        // usernames (`undefined`, empty, `"undefined"`, `"null"`) or
        // truly orphaned (no on-disk dir AND no tombstone). Tombstones
        // are preserved — they're the collision blocker that prevents
        // a deleted user's name from being silently reclaimed. Best-
        // effort: a failure here doesn't block connect.
        try {
          await pruneOrphanUserMetadataEntries(users);
        } catch (err) {
          console.warn(
            "[FileSystemProvider] pruneOrphanUserMetadataEntries failed:",
            err,
          );
        }

        // VCP R1 trash MVP notes (2026-05-26): one-time migration of
        // legacy `notes_trash/<id>.json` files into the new
        // `_trash/notes/<id>-<slug>.json` layout, then a sweep of every
        // user's `_trash/_index.json` to hard-delete expired entries.
        // Both passes are best-effort and idempotent — failures are
        // logged but don't block the folder connect.
        try {
          await migrateLegacyNotesTrashAllUsers(users);
        } catch (err) {
          console.warn(
            "[FileSystemProvider] migrateLegacyNotesTrashAllUsers failed:",
            err,
          );
        }
        try {
          for (const username of users) {
            try {
              const summary = await runAutoCleanupPass(username);
              if (summary.scanned > 0 || summary.expired > 0) {
                console.info(
                  `[trash-cleanup] ${username}: scanned=${summary.scanned} expired=${summary.expired} hardDeleted=${summary.hardDeleted} errors=${summary.errors}`,
                );
              }
            } catch (err) {
              console.warn(
                `[FileSystemProvider] runAutoCleanupPass failed for ${username}:`,
                err,
              );
            }
          }
        } catch (err) {
          console.warn(
            "[FileSystemProvider] trash auto-cleanup loop failed:",
            err,
          );
        }

        // VC Phase 2 (restore-a-version sub-bot of HR, 2026-05-30): strip
        // expired `revert_undo_window` sidecars from every user's notes. Rides
        // the same connect-time cleanup loop as the trash sweep above. The
        // render-gate already hides an expired Undo button, so this is pure
        // disk hygiene: best-effort + idempotent, and a failure never blocks
        // the folder connect.
        try {
          for (const username of users) {
            try {
              const summary = await runRevertWindowSweep(username);
              if (summary.stripped > 0) {
                console.info(
                  `[revert-window-sweep] ${username}: scanned=${summary.scanned} stripped=${summary.stripped} kept=${summary.kept} errors=${summary.errors}`,
                );
              }
            } catch (err) {
              console.warn(
                `[FileSystemProvider] runRevertWindowSweep failed for ${username}:`,
                err,
              );
            }
          }
        } catch (err) {
          console.warn(
            "[FileSystemProvider] revert-window sweep loop failed:",
            err,
          );
        }

        let currentUser = await getCurrentUser();
        if (users.length === 1) {
          currentUser = users[0];
          await storeCurrentUser(currentUser);
        } else if (
          currentUser &&
          users.length > 0 &&
          !users.includes(currentUser)
        ) {
          // Stale currentUser pointing at a deleted/tombstoned/never-existed
          // user (e.g. carryover from a demo-lab copy whose user folders were
          // later wiped, Grant hit `alex` 2026-05-20). Same bug class as the
          // stale-mainUser fix in usersApi.getMainUser at local-api.ts:4278;
          // both read paths needed to be filtered against discoverUsers.
          //
          // Lab Mode retirement R5 (2026-05-23): the legacy `lab` sentinel
          // is now treated as stale just like any other non-discoverable
          // pointer — `discoverUsers` excludes the `users/lab` shared
          // funding-account namespace, so a stale `lab` value in IDB falls
          // into this branch and gets cleared.
          //
          // `users.length > 0` guard: discoverUsers returns [] both for a
          // genuinely fresh folder AND for transient FS errors. Clearing on
          // [] risks wiping a valid pointer on an FS hiccup; bias toward
          // keeping the IDB key in that ambiguous case. See the follow-up
          // branch below for the disambiguated empty-users case.
          await clearCurrentUser();
          currentUser = null;
        } else if (
          currentUser &&
          currentUser.toLowerCase() !== "lab" &&
          users.length === 0
        ) {
          // Panel investigator follow-up (finding #3): when discoverUsers
          // returns [] AND we have a stale IDB pointer, the old code left
          // the pointer alone to protect against transient FS errors. That
          // strands the user in a "have user → no user" surface (the IDB
          // hit logged, then the picker rendered without the user).
          //
          // Disambiguate with a cheap, defensive probe: try to walk
          // `users/<currentUser>` via the raw FSA `getDirectoryHandle`.
          // Three outcomes:
          //   - handle resolves → preserve the IDB pointer (some edge case
          //     where the user dir exists but discoverUsers couldn't list it).
          //   - browser throws `NotFoundError` → the dir is genuinely gone,
          //     clear the IDB key.
          //   - any other error (permission, IO, abort) → preserve the
          //     pointer, treat as transient (matches the existing protection).
          try {
            const rootHandle = fileService.getDirectoryHandle();
            if (rootHandle) {
              const usersHandle = await rootHandle.getDirectoryHandle("users");
              try {
                await usersHandle.getDirectoryHandle(currentUser);
                // Dir exists, leave the IDB pointer alone.
              } catch (probeErr) {
                const isNotFound =
                  probeErr instanceof DOMException &&
                  probeErr.name === "NotFoundError";
                if (isNotFound) {
                  await clearCurrentUser();
                  currentUser = null;
                }
                // Other errors: preserve the pointer (transient).
              }
            }
            // No root handle: bail without clearing (defensive).
          } catch {
            // Anything blew up before we could probe (eg. `users` dir
            // itself missing or permission revoked mid-call). Preserve the
            // IDB pointer; the next connect will retry.
          }
        }

        // Per-folder Main read (Bug 2 fix 2026-05-23). The previous
        // impl read from IndexedDB only, which is per-machine and
        // leaked across folder switches. Now: read the per-folder
        // _user_metadata.json file first; fall back to the IDB key
        // only when it points at a user that genuinely exists in
        // this folder (migration shim for legacy pins set before
        // the per-folder field existed).
        let mainUser = await readMainUser();
        if (!mainUser) {
          const idbMain = await getMainUser();
          if (idbMain && users.includes(idbMain)) {
            // Legacy IDB pin and it actually maps to a real user in
            // this folder. Migrate to the file so future reads are
            // authoritative without consulting IDB.
            mainUser = idbMain;
            try {
              await writeMainUser(idbMain);
            } catch {
              // Best-effort. The next read will retry the migration.
            }
          }
          // If the IDB pin is a stale cross-folder leak (the Bug 2
          // case), DO NOT promote it. Leave mainUser null so the
          // picker renders without a (Main) badge until the user
          // clicks the star explicitly.
        }
        // Auto-promote-on-connect (was: bootstrap mainUser from
        // currentUser when null) is GONE. Main must come from an
        // explicit user action (star-click in the picker) so folder
        // switches don't silently re-pin Main. The Lab Mode "lab"
        // sentinel concern that gated the old branch no longer
        // applies because the new code never writes mainUser
        // unsolicited.

        setState((prev) => ({
          ...prev,
          isConnected: true,
          isLoading: false,
          loadingStage: null,
          error: null,
          directoryName: handle.name,
          currentUser,
          mainUser,
          availableUsers: users,
          needsInitialization: false,
          lastConnectedFolder: handle.name,
        }));

        // Once a user is known, load their preferences from disk into the
        // Zustand store. Auto-login paths (single-user folder or silent
        // reconnect) skip setCurrentUser, so we hydrate here too.
        if (currentUser) {
          await hydrateSettingsForUser(currentUser);
        }

        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to connect to folder";
        setState((prev) => ({
          ...prev,
          isLoading: false,
          loadingStage: null,
          error: message,
        }));
        return false;
      }
    },
    [hydrateSettingsForUser]
  );

  useEffect(() => {
    async function initialize() {
      // Wiki-screenshot capture mode (?wikiCapture=… on localhost) and the
      // public in-browser demo (/demo, allowed in production) both bypass
      // the FS picker and silent reconnect and seed the same in-memory
      // fixture. The "picker" wiki-capture variant leaves currentUser
      // empty so the user-picker screen renders — used to capture
      // user-login.png. Every other path signs in as "alex" (the Demo
      // Lab PI) so feature pages render with realistic data.
      const captureVariant = getWikiCaptureVariant();
      const demoMode = getDemoMode();
      if (captureVariant || demoMode) {
        // Real-user shadowing guard for `?wikiCapture=…`. The hostname gate
        // inside `getWikiCaptureVariant()` already hard-blocks non-local
        // hostnames in production, so true prod is safe. The dev /
        // wiki-capture host is wide open though: pasting `?wikiCapture=1`
        // mid-session over a real signed-in user would silently swap their
        // file-service for the in-memory fixture and mark the tab as
        // capture mode. Belt-and-suspenders: when wiki-capture is the
        // trigger AND IndexedDB already holds a real (non-sentinel) handle
        // + a real current user, refuse the install and let the normal
        // silent-reconnect path below take over.
        //
        // Skipped for `/demo` (public route): demo mode has its own
        // back-up-and-restore flow (`backupRealHandleForDemo` /
        // `restorePreDemoStateOrClear`) that already preserves the real
        // folder grant. We only short-circuit the wiki-capture trigger,
        // which is the one with the URL-shadowing problem.
        if (captureVariant && !demoMode) {
          try {
            const [existingHandle, existingUser] = await Promise.all([
              getStoredDirectoryHandle(),
              getCurrentUser(),
            ]);
            const realFolderConnected =
              !!existingHandle &&
              existingHandle.name !== "wiki-capture-fixture" &&
              !!existingUser;
            if (realFolderConnected) {
              console.warn(
                "[FileSystemProvider] Refusing ?wikiCapture install: real user already signed in.",
              );
              // Fall through to the normal stored-handle reconnect path
              // below by NOT entering the fixture branch.
            } else {
              return await installFixtureBranch(captureVariant, demoMode);
            }
          } catch (err) {
            // If the IndexedDB read fails, fall back to current behavior
            // (allow the install). The guard is best-effort; we'd rather
            // honor the URL flag than block a developer who's trying to
            // capture screenshots on a fresh browser profile.
            console.warn(
              "[FileSystemProvider] real-user guard check failed; falling back to install:",
              err,
            );
            return await installFixtureBranch(captureVariant, demoMode);
          }
        } else {
          return await installFixtureBranch(captureVariant, demoMode);
        }
      }

      // Extracted so the real-user-guard branch above can reuse the
      // exact same install path without duplicating the setState shape.
      async function installFixtureBranch(
        variant: ReturnType<typeof getWikiCaptureVariant>,
        demo: boolean,
      ): Promise<void> {
        try {
          const signIn = demo || variant === "signed-in";
          // `?fixtureUser=<name>` override (events-widget user-switch
          // fix 2026-05-25). Lets verifiers / capture scripts boot the
          // fixture pinned to a different seeded user (e.g. mira) so
          // PI-archetype widgets render against her events / tasks.
          // Defaults to "alex" when the param is absent or invalid.
          // Demo route ignores the override and stays on alex — the
          // public /demo experience is documented as alex's lab and
          // shouldn't shift under a URL flag.
          const fixtureUser = !demo && signIn ? resolveFixtureUser() : "alex";
          await installWikiCaptureFixture({ signIn, fixtureUser });
          if (demo) {
            // Set the sticky flag now that the fixture is ready, so the
            // banner + floating exit button + future consumers see
            // demo mode across in-tab navigation (e.g., /demo → /methods).
            markDemoMode();
          }
          if (signIn) {
            await hydrateSettingsForUser(fixtureUser);
          }
          setState((prev) => ({
            ...prev,
            isConnected: true,
            isLoading: false,
            loadingStage: null,
            error: null,
            directoryName: "wiki-capture-fixture",
            currentUser: signIn ? fixtureUser : null,
            mainUser: signIn ? fixtureUser : null,
            // mira (Dr. Mira Castellanos) is the demo PI archetype — owns
            // no tasks/notes of her own, but authors LabComments across
            // alex + morgan's shared content. Listed so user-picker UI
            // and lab-mode user filters surface her as a real lab member.
            availableUsers: ["alex", "morgan", "mira"],
            needsInitialization: false,
            lastConnectedFolder: "wiki-capture-fixture",
          }));
        } catch (err) {
          console.error("[FileSystemProvider] fixture init failed:", err);
          setState((prev) => ({ ...prev, isLoading: false }));
        }
      }

      try {
        // `let` so the stale-fixture-handle restore branch below can
        // re-read after `restorePreDemoStateOrClear` swaps the live IDB
        // state. `meta` is read-only and stays const-shaped via the
        // initial assignment.
        //
        // mainUser is NOT read here anymore — Bug 2 fix 2026-05-23 made
        // Main per-folder, so its authoritative value lives in
        // `users/_user_metadata.json` and gets read inside `finishConnect`
        // (the post-permission, post-folder-validation phase). Reading
        // the IDB key at this earlier point would surface a leaked
        // cross-folder pin in the loading screen UI.
        // eslint-disable-next-line prefer-const -- destructured reassignment below
        let [storedHandle, meta, currentUser] = await Promise.all([
          getStoredDirectoryHandle(),
          getStoredDirectoryMeta(),
          getCurrentUser(),
        ]);

        console.log("[FileSystemProvider.initialize] meta:", meta, "hasHandle:", !!storedHandle);

        // Stale wiki-capture / demo state cleanup. `installWikiCaptureFixture`
        // seeds IDB with a `name: "wiki-capture-fixture"` fake handle +
        // currentUser/mainUser so the in-page flow works. If the user
        // leaves `?wikiCapture=1` or closes a `/demo` tab and lands on `/`
        // without going through `<LeaveDemoModal>`, those entries persist
        // and the next visit hits the silent-reconnect path with a
        // non-FSA fake handle — surfaces as a broken
        // "Reconnect to wiki-capture-fixture" screen because
        // queryPermission on the fake throws. We're not in wiki-capture
        // or demo mode here (already early-returned above if we were),
        // so the sentinel-named handle is unambiguously stale.
        //
        // Two sub-cases (handled by `restorePreDemoStateOrClear`):
        //   - real folder was backed up before demo → restore it onto the
        //     main keys and fall through to the silent-reconnect path,
        //     so the user reconnects to their real folder transparently.
        //   - no backup (true wiki-capture orphan or true public-demo
        //     orphan) → clear main keys and stop on the welcome screen.
        if (storedHandle?.name === "wiki-capture-fixture") {
          const restored = await restorePreDemoStateOrClear();
          if (restored) {
            // Re-read so the silent-reconnect path below sees the
            // restored real handle + users instead of the stale fake.
            // mainUser is read inside finishConnect from the
            // per-folder file (Bug 2 fix 2026-05-23).
            [storedHandle, currentUser] = await Promise.all([
              getStoredDirectoryHandle(),
              getCurrentUser(),
            ]);
          } else {
            setState((prev) => ({
              ...prev,
              isLoading: false,
              lastConnectedFolder: null,
              currentUser: null,
              mainUser: null,
            }));
            return;
          }
        }

        // Try a silent reconnect: if Chrome still remembers the readwrite
        // grant on this handle, we can skip the OS picker entirely. We
        // intentionally only use the *silent* path here — calling
        // requestPermission outside a user gesture is rejected by the
        // browser, and we don't want to surface a confusing prompt on
        // page load.
        if (storedHandle) {
          const permissionable = storedHandle as PermissionableHandle;
          if (permissionable.queryPermission) {
            try {
              const permission = await permissionable.queryPermission({ mode: "readwrite" });
              if (permission === "granted") {
                fileService.resetReadCount();
                setState((prev) => ({
                  ...prev,
                  isLoading: true,
                  loadingStage: "connecting",
                  lastConnectedFolder: storedHandle.name,
                  currentUser,
                  // Don't surface the IDB mainUser candidate here —
                  // finishConnect re-reads from the per-folder file
                  // and writes the authoritative value. Setting null
                  // during the connecting phase avoids briefly badging
                  // a (Main) user from a leaked cross-folder IDB pin
                  // (Bug 2 fix 2026-05-23).
                  mainUser: null,
                }));
                const ok = await finishConnect(storedHandle);
                if (ok) return;
                // finishConnect failed (e.g. folder validation issue); fall
                // through to the normal "show setup screen" path below.
              }
            } catch (err) {
              console.warn("[FileSystemProvider.initialize] queryPermission failed:", err);
            }
          }
        }

        setState((prev) => ({
          ...prev,
          lastConnectedFolder: meta?.name || storedHandle?.name || null,
          currentUser,
          // mainUser stays null until finishConnect runs and reads the
          // per-folder _user_metadata.json. The IDB mainUser candidate
          // is no longer authoritative — see Bug 2 fix 2026-05-23.
          mainUser: null,
          isLoading: false,
        }));
      } catch (err) {
        console.error("[FileSystemProvider.initialize] Error:", err);
        setState((prev) => ({ ...prev, isLoading: false }));
      }
    }

    initialize();
  }, [finishConnect, hydrateSettingsForUser]);

  const connect = useCallback(async (): Promise<boolean> => {
    const showDirectoryPicker = (window as unknown as { showDirectoryPicker?: (options?: { mode?: string; startIn?: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    if (!showDirectoryPicker) {
      setState((prev) => ({
        ...prev,
        error: "File System Access API not supported in this browser.",
      }));
      return false;
    }

    // Flip into the loading screen BEFORE calling showDirectoryPicker. On
    // OneDrive/iCloud folders the call itself can block JS for 15-60s while
    // the OS spins up the directory provider, so we need React to paint the
    // staged screen first. Two requestAnimationFrame ticks guarantee the
    // browser has committed the DOM update before we hand control back.
    setState((prev) => ({ ...prev, isLoading: true, loadingStage: "opening-picker", error: null }));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );

    let handle: FileSystemDirectoryHandle | null = null;

    try {
      // startIn "documents" opens the OS picker in the Documents folder
      // (Grant 2026-05-28). Chrome / macOS block Desktop, Downloads, and
      // their Mac subfolders, so steering the picker to Documents (whose
      // subfolders ARE allowed) reduces the chance the user lands on a
      // blocked folder and hits the "contains system files" dead-end.
      handle = await showDirectoryPicker({ mode: "readwrite", startIn: "documents" });
    } catch (err) {
      // User dismissed the picker — clear loading state and bail quietly.
      if (err instanceof Error && err.name === "AbortError") {
        setState((prev) => ({ ...prev, isLoading: false, loadingStage: null }));
        return false;
      }
      const message = err instanceof Error ? err.message : "Failed to open folder picker";
      setState((prev) => ({ ...prev, isLoading: false, loadingStage: null, error: message }));
      return false;
    }

    if (!handle) {
      setState((prev) => ({ ...prev, isLoading: false, loadingStage: null }));
      return false;
    }

    fileService.resetReadCount();
    setState((prev) => ({ ...prev, loadingStage: "connecting" }));
    return finishConnect(handle);
  }, [finishConnect]);

  /**
   * Drag-and-drop entry point. The caller has already extracted a
   * `FileSystemDirectoryHandle` from a drop event (via
   * `DataTransferItem.getAsFileSystemHandle()`), so we skip the OS picker
   * and route straight into the same `finishConnect` pipeline. Permission
   * is still verified there — the drop hands us a handle but Chrome can
   * still gate readwrite access behind a one-time prompt.
   */
  const connectWithHandle = useCallback(async (handle: FileSystemDirectoryHandle): Promise<boolean> => {
    setState((prev) => ({
      ...prev,
      isLoading: true,
      loadingStage: "connecting",
      error: null,
    }));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );

    fileService.resetReadCount();
    return finishConnect(handle);
  }, [finishConnect]);

  const reconnectWithStoredHandle = useCallback(async (): Promise<boolean> => {
    setState((prev) => ({ ...prev, isLoading: true, loadingStage: "verifying-permission", error: null }));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );

    const handle = await getStoredDirectoryHandle();
    if (!handle) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        loadingStage: null,
        error: "No previously connected folder found. Please pick a folder.",
      }));
      return false;
    }

    const permissionable = handle as PermissionableHandle;
    if (!permissionable.requestPermission) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        loadingStage: null,
        error: "This browser doesn't support reconnecting to a stored folder. Please pick the folder again.",
      }));
      return false;
    }

    let permission: PermissionState;
    try {
      permission = await permissionable.requestPermission({ mode: "readwrite" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Permission request failed";
      setState((prev) => ({ ...prev, isLoading: false, loadingStage: null, error: message }));
      return false;
    }

    if (permission !== "granted") {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        loadingStage: null,
        error: "Access not granted. Click Continue and choose Allow, or pick the folder again.",
      }));
      return false;
    }

    fileService.resetReadCount();
    setState((prev) => ({ ...prev, loadingStage: "connecting" }));
    return finishConnect(handle);
  }, [finishConnect]);

  const initializeFolder = useCallback(async (): Promise<boolean> => {
    if (!fileService.isConnected()) return false;

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const success = await ensureFolderStructure();
      if (!success) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: "Failed to create folder structure. Please try again.",
        }));
        return false;
      }

      await storeDirectoryHandle(fileService.getDirectoryHandle()!);

      setState((prev) => ({
        ...prev,
        isConnected: true,
        isLoading: false,
        error: null,
        availableUsers: [],
        needsInitialization: false,
      }));

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to initialize folder";
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: message,
      }));
      return false;
    }
  }, []);

  const createNewFolder = useCallback(async (folderName: string): Promise<boolean> => {
    const showDirectoryPicker = (window as unknown as { showDirectoryPicker?: (options?: { mode?: string; startIn?: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    if (!showDirectoryPicker) {
      setState((prev) => ({
        ...prev,
        error: "File System Access API not supported in this browser.",
      }));
      return false;
    }

    const sanitizedName = folderName.trim().replace(/[<>:"/\\|?*]/g, "");
    if (!sanitizedName) {
      setState((prev) => ({
        ...prev,
        error: "Please enter a valid folder name.",
      }));
      return false;
    }

    setState((prev) => ({ ...prev, isLoading: true, loadingStage: "opening-picker", error: null }));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );

    let parentHandle: FileSystemDirectoryHandle | null = null;

    try {
      // startIn "documents" (Grant 2026-05-28): open the picker in
      // Documents so the user creates the new folder somewhere allowed.
      // Chrome / macOS block Desktop, Downloads, and their Mac subfolders;
      // Documents subfolders are fine, so this is the safe landing spot.
      parentHandle = await showDirectoryPicker({ mode: "readwrite", startIn: "documents" });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setState((prev) => ({ ...prev, isLoading: false, loadingStage: null }));
        return false;
      }
      const message = err instanceof Error ? err.message : "Failed to open folder picker";
      setState((prev) => ({ ...prev, isLoading: false, loadingStage: null, error: message }));
      return false;
    }

    if (!parentHandle) {
      setState((prev) => ({ ...prev, isLoading: false, loadingStage: null }));
      return false;
    }

    setState((prev) => ({ ...prev, loadingStage: "connecting" }));

    try {
      const newFolderHandle = await parentHandle.getDirectoryHandle(sanitizedName, { create: true });
      fileService.setDirectoryHandle(newFolderHandle);

      setState((prev) => ({ ...prev, loadingStage: "verifying-permission" }));
      const hasPermission = await fileService.verifyPermission(true);

      if (!hasPermission) {
        fileService.clearDirectoryHandle();
        setState((prev) => ({
          ...prev,
          isLoading: false,
          loadingStage: null,
          error: "Permission denied. Please allow read/write access to the folder.",
        }));
        return false;
      }

      setState((prev) => ({ ...prev, loadingStage: "preparing" }));
      const success = await ensureFolderStructure();
      if (!success) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          loadingStage: null,
          error: "Failed to create folder structure. Please try again.",
        }));
        return false;
      }

      await storeDirectoryHandle(newFolderHandle);

      setState((prev) => ({
        ...prev,
        isConnected: true,
        isLoading: false,
        loadingStage: null,
        error: null,
        directoryName: newFolderHandle.name,
        availableUsers: [],
        needsInitialization: false,
        lastConnectedFolder: newFolderHandle.name,
      }));

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create folder";
      setState((prev) => ({
        ...prev,
        isLoading: false,
        loadingStage: null,
        error: message,
      }));
      return false;
    }
  }, []);

  const disconnect = useCallback(async () => {
    // edit-session bleed fix 2026-05-24: disconnect ends the active
    // user session entirely. Any unlocked lab-head window must be
    // dropped so a fresh connect (to the same OR a different folder)
    // starts from idle. resetEditSession is idempotent so calling
    // unconditionally here is safe.
    resetEditSession();
    fileService.clearDirectoryHandle();
    await clearDirectoryHandle();
    await clearCurrentUser();
    // Bug 2 fix 2026-05-23: clear the legacy per-machine Main IDB key
    // on disconnect. With Main now stored per-folder in
    // `users/_user_metadata.json`, the IDB key only exists as a
    // migration fallback for legacy pins — but leaving a stale value
    // here can still leak across folder switches via the migration
    // shim in `usersApi.getMainUser` if the leaked username happens
    // to also exist in the new folder. Clearing on disconnect closes
    // that window: connecting to a different folder always starts
    // with no IDB candidate to migrate from.
    await clearMainUser();

    // Constraint #2(c): folder switch wipes the cached password. The
    // encrypted backup at users/<u>/_telegram-encrypted.json stays with
    // the disconnecting folder, so any cached password from that folder's
    // user must not survive into a freshly-connected folder.
    clearCachedPassword();

    // Clear any hydrated user preferences so the next user's settings don't
    // leak from the in-memory store.
    useAppStore.getState().resetSettingsToDefaults();

    setState({
      isConnected: false,
      isLoading: false,
      loadingStage: null,
      error: null,
      directoryName: null,
      currentUser: null,
      mainUser: null,
      availableUsers: [],
      needsInitialization: false,
      lastConnectedFolder: null,
    });
  }, []);

  const setCurrentUser = useCallback(async (username: string) => {
    // edit-session bleed fix 2026-05-24: a still-unlocked lab-head
    // session belongs to whichever username was just active. Switching
    // to a different user must drop that unlock back to idle so the
    // new user cannot inherit write-gating permissions from the old
    // one. The `resetEditSession` helper was added for exactly this
    // case but had no callsite; skipping the reset on a same-user
    // no-op switch keeps the session timer ticking on routes that
    // re-call setCurrentUser to refresh other state.
    const prevUser = currentUserRef.current;
    const isUserChange = prevUser !== null && prevUser !== username;
    if (isUserChange) {
      resetEditSession();
    }
    clearCurrentUserCache();
    // Constraint #2(b): explicit user-switch wipes the cached password.
    // The encrypted backup is keyed per-user and the password gate
    // belongs to whichever account we just left.
    clearCachedPassword();
    await storeCurrentUser(username);
    setState((prev) => ({ ...prev, currentUser: username }));
    await hydrateSettingsForUser(username);
    // React Query cache invalidation on user-switch (events-widget
    // user-switch fix 2026-05-25). A live in-tab user swap leaves
    // every cached query keyed against the previous user, so widgets
    // like Today's events on /lab-overview keep rendering the old
    // user's data until a full page reload. Many user-scoped query
    // keys (`["events"]`, `["tasks"]`, `["notes"]`, `["projects"]`,
    // etc.) don't even include the username as a key segment, so
    // selective invalidation would miss them. A blanket
    // `invalidateQueries()` is the right hammer here: switching users
    // implies showing a different user's data, so the entire cache is
    // logically stale. Skipped on the initial null → user transition
    // (mount / silent reconnect) because there are no stale queries
    // from a prior session and skipping avoids triggering redundant
    // refetches the moment widgets first mount.
    if (isUserChange) {
      // Calendar-privacy fix (2026-05-29): external ICS calendar feed
      // events are strictly personal (a user's linked Google / iCloud /
      // Outlook feeds) and must NEVER bleed across an account switch.
      // The blanket invalidateQueries() below only marks queries stale;
      // it leaves the previous user's resident data in the cache until a
      // refetch resolves, and the per-feed external-event entries
      // (gcTime: ONE_HOUR_MS) sit there keyed by a per-user feed id that
      // collides across users (every user's first feed is id 1). Without
      // an explicit eviction the next user could be served the prior
      // user's parsed feed events out of cache. removeQueries drops those
      // entries outright so nothing personal survives the switch; the
      // new user's useExternalEvents re-fetches under its own
      // user-scoped key. Run BEFORE the blanket invalidate so the removed
      // entries don't get a redundant background refetch scheduled
      // against the now-departed user.
      appQueryClient.removeQueries({ queryKey: [FEED_EVENTS_PREFIX] });
      appQueryClient.invalidateQueries();
    }
  }, [hydrateSettingsForUser]);

  const createUser = useCallback(async (username: string): Promise<boolean> => {
    if (!fileService.isConnected()) return false;

    const sanitized = username.trim().replace(/[^a-zA-Z0-9_-]/g, "");
    if (!sanitized) return false;

    try {
      const userDir = await fileService.ensureDir(`users/${sanitized}`);
      if (!userDir) return false;

      await fileService.ensureDir(`users/${sanitized}/projects`);
      await fileService.ensureDir(`users/${sanitized}/tasks`);
      await fileService.ensureDir(`users/${sanitized}/dependencies`);
      await fileService.ensureDir(`users/${sanitized}/methods`);
      await fileService.ensureDir(`users/${sanitized}/events`);
      await fileService.ensureDir(`users/${sanitized}/goals`);
      await fileService.ensureDir(`users/${sanitized}/pcr_protocols`);
      await fileService.ensureDir(`users/${sanitized}/purchase_items`);
      await fileService.ensureDir(`users/${sanitized}/lab_links`);
      await fileService.ensureDir(`users/${sanitized}/notes`);
      await fileService.ensureDir(`users/${sanitized}/Images`);
      await fileService.ensureDir(`users/${sanitized}/Files`);

      await fileService.writeJson(`users/${sanitized}/_counters.json`, {});

      await refreshUsers();
      return true;
    } catch {
      return false;
    }
  }, [refreshUsers]);

  const value: FileSystemContextValue = {
    ...state,
    connect,
    connectWithHandle,
    reconnectWithStoredHandle,
    disconnect,
    setCurrentUser,
    createUser,
    refreshUsers,
    reverifyPermission,
    initializeFolder,
    createNewFolder,
  };

  return (
    <FileSystemContext.Provider value={value}>
      {children}
    </FileSystemContext.Provider>
  );
}

export function useFileSystem(): FileSystemContextValue {
  const context = useContext(FileSystemContext);
  if (!context) {
    throw new Error("useFileSystem must be used within a FileSystemProvider");
  }
  return context;
}

/**
 * Non-throwing variant: returns the current username, or null when there is
 * no FileSystemProvider above (e.g. an isolated component-test render) or no
 * user is connected. Use this in leaf components that want to best-effort
 * read/write per-user state but must render fine in a provider-less context.
 * Added for the markdown editor's width-preset settings mirror
 * (MARKDOWN_EDITOR_TYPORA_DESIGN.md Phase 1, editor-fluid-width bot).
 */
export function useOptionalCurrentUser(): string | null {
  const context = useContext(FileSystemContext);
  return context?.currentUser ?? null;
}

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/**
 * When the folder picker is missing we want to explain *why* in
 * browser-specific terms instead of a generic "switch browsers."
 *
 * Brave is the case that bit a real user: it is Chromium-based, so we used
 * to list it as supported, but it deliberately removes `showDirectoryPicker`
 * (brave-browser#11407) with no reliable user-facing way to re-enable it. A
 * Brave visitor otherwise lands on a "Browser Not Supported" screen that
 * still names Brave as supported. Detect it synchronously via the
 * `navigator.brave` object Brave injects (its `isBrave()` method is async and
 * unusable in a render path). Safari and Firefox only ship the sandboxed
 * Origin Private File System, never the real-folder picker, so they fall here
 * too.
 */
export type UnsupportedBrowser = "brave" | "safari" | "firefox" | "other";

export function detectUnsupportedBrowser(): UnsupportedBrowser {
  if (typeof navigator === "undefined") return "other";
  const nav = navigator as Navigator & {
    brave?: { isBrave?: () => Promise<boolean> };
  };
  if (nav.brave && typeof nav.brave.isBrave === "function") return "brave";
  const ua = navigator.userAgent;
  if (/firefox\//i.test(ua)) return "firefox";
  // Safari UA contains "Safari" but so does Chrome; exclude the Chromium and
  // iOS-Chrome/Firefox markers to isolate genuine Safari.
  if (/^((?!chrome|chromium|crios|fxios|android).)*safari/i.test(ua)) {
    return "safari";
  }
  return "other";
}
