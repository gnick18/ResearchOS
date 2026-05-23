"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { fileService } from "./file-service";
import {
  storeDirectoryHandle,
  getStoredDirectoryHandle,
  getStoredDirectoryMeta,
  clearDirectoryHandle,
  storeCurrentUser,
  getCurrentUser,
  storeMainUser,
  getMainUser,
  clearCurrentUser,
  restorePreDemoStateOrClear,
} from "./indexeddb-store";
import { clearCurrentUserCache } from "../storage/json-store";
import { clearCachedPassword } from "../auth/cached-password";
import { discoverUsers, validateResearchFolder, ensureFolderStructure } from "./user-discovery";
import { readUserSettings, patchUserSettings, userSettingsFileExists, DEFAULT_SETTINGS } from "../settings/user-settings";
import { useAppStore, readLegacyLocalStorageSettings } from "../store";
import { getWikiCaptureVariant, getDemoMode, markDemoMode, installWikiCaptureFixture } from "./wiki-capture-mock";
import { rebaseDemoDates, isDemoLab } from "../demo/rebase";

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

        let currentUser = await getCurrentUser();
        if (users.length === 1) {
          currentUser = users[0];
          await storeCurrentUser(currentUser);
        } else if (
          currentUser &&
          currentUser.toLowerCase() !== "lab" &&
          users.length > 0 &&
          !users.includes(currentUser)
        ) {
          // Stale currentUser pointing at a deleted/tombstoned/never-existed
          // user (e.g. carryover from a demo-lab copy whose user folders were
          // later wiped — Grant hit `alex` 2026-05-20). Same bug class as the
          // stale-mainUser fix in usersApi.getMainUser at local-api.ts:4278;
          // both read paths needed to be filtered against discoverUsers.
          // "lab" is the Lab Mode sentinel and is intentionally not a
          // discoverable user, so preserve it.
          //
          // `users.length > 0` guard: discoverUsers returns [] both for a
          // genuinely fresh folder AND for transient FS errors. Clearing on
          // [] risks wiping a valid pointer on an FS hiccup; bias toward
          // keeping the IDB key in that ambiguous case.
          await clearCurrentUser();
          currentUser = null;
        }

        let mainUser = await getMainUser();
        // Bootstrap mainUser from currentUser when it isn't set yet — but
        // NEVER store "lab" as mainUser. "lab" is a sentinel for Lab Mode,
        // not a real account. If the provider initializes with currentUser
        // === "lab" (e.g. user just clicked Lab Mode and the page reloaded
        // before mainUser was properly set to their real account), storing
        // "lab" as mainUser creates an Exit-Lab-Mode trap: handleLogout
        // tries to return to mainUser="lab" → useEffect bounces back to
        // /lab → loop. Hit by Grant 2026-05-14; fixed defensively at the
        // exit-handler level too (lab/page.tsx:3770b97f), but this is the
        // source.
        if (!mainUser && currentUser && currentUser.toLowerCase() !== "lab") {
          mainUser = currentUser;
          await storeMainUser(mainUser);
        }

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
          await installWikiCaptureFixture({ signIn });
          if (demo) {
            // Set the sticky flag now that the fixture is ready, so the
            // banner + floating exit button + future consumers see
            // demo mode across in-tab navigation (e.g., /demo → /methods).
            markDemoMode();
          }
          if (signIn) {
            await hydrateSettingsForUser("alex");
          }
          setState((prev) => ({
            ...prev,
            isConnected: true,
            isLoading: false,
            loadingStage: null,
            error: null,
            directoryName: "wiki-capture-fixture",
            currentUser: signIn ? "alex" : null,
            mainUser: signIn ? "alex" : null,
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
        // eslint-disable-next-line prefer-const -- destructured reassignment below
        let [storedHandle, meta, currentUser, mainUser] = await Promise.all([
          getStoredDirectoryHandle(),
          getStoredDirectoryMeta(),
          getCurrentUser(),
          getMainUser(),
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
            [storedHandle, currentUser, mainUser] = await Promise.all([
              getStoredDirectoryHandle(),
              getCurrentUser(),
              getMainUser(),
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
                  mainUser,
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
          mainUser,
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
    const showDirectoryPicker = (window as unknown as { showDirectoryPicker?: (options?: { mode?: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
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
      handle = await showDirectoryPicker({ mode: "readwrite" });
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
    const showDirectoryPicker = (window as unknown as { showDirectoryPicker?: (options?: { mode?: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
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
      parentHandle = await showDirectoryPicker({ mode: "readwrite" });
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
    fileService.clearDirectoryHandle();
    await clearDirectoryHandle();
    await clearCurrentUser();

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
    console.log("[FileSystemProvider.setCurrentUser] Called with username:", username);
    clearCurrentUserCache();
    // Constraint #2(b): explicit user-switch wipes the cached password.
    // The encrypted backup is keyed per-user and the password gate
    // belongs to whichever account we just left.
    clearCachedPassword();
    console.log("[FileSystemProvider.setCurrentUser] Cache cleared");
    await storeCurrentUser(username);
    console.log("[FileSystemProvider.setCurrentUser] Stored to IndexedDB");
    setState((prev) => ({ ...prev, currentUser: username }));
    await hydrateSettingsForUser(username);
    console.log("[FileSystemProvider.setCurrentUser] State updated + settings hydrated");
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

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}
