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
  peekSharedRealIdentity,
  rememberFolder,
  listRememberedFolders,
  forgetRememberedFolder,
  renameRememberedFolder,
  setRememberedFolderNickname,
  setRememberedFolderPinned,
  getActiveFolderId,
  getRememberedFolderHandle,
  setActiveFolderId,
  type RememberedFolder,
} from "./indexeddb-store";
import { MULTI_FOLDER_ENABLED } from "./multi-folder-config";
import {
  type PendingTakeover,
  resolveOwnerAction,
  currentAccountFingerprint,
} from "./folder-owner-connect";
import {
  readFolderOwner,
  writeFolderOwner,
  takeoverRecord,
  revertRecord,
  lastTakeover,
  makeTakeoverEventId,
} from "./folder-owner";
import {
  sweepForeignShares,
  restoreSweptShares,
} from "../sharing/foreign-share-sweep";
import { readSharingIdentity } from "../sharing/identity/sidecar";
import { readMainUser, writeMainUser, pruneOrphanUserMetadataEntries } from "./user-metadata";
import { clearCurrentUserCache } from "../storage/json-store";
import { clearPiEditConfirmations } from "../lab/pi-edit-guard";
import { validateHeadAndSeed } from "../lab/pi-context-seed";
import { discoverUsers, validateResearchFolder, ensureFolderStructure } from "./user-discovery";
import { isDirectoryHandleMissing } from "./handle-liveness";
import { readUserSettings, patchUserSettings, userSettingsFileExists, DEFAULT_SETTINGS } from "../settings/user-settings";
import { useAppStore, readLegacyLocalStorageSettings } from "../store";
import { getWikiCaptureVariant, getDemoMode, markDemoMode, installWikiCaptureFixture, resolveFixtureUser, resolveDemoViewAsUser, clearAllStickyDemoFlags } from "./wiki-capture-mock";
import { rebaseDemoDates, isDemoLab } from "../demo/rebase";
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
  | "warming-cache"
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
  /**
   * The NAME of a previously connected folder whose handle is now stale because
   * the folder was moved, renamed, or deleted on disk (folder-missing detection,
   * 2026-06-16). A persisted handle keeps reporting its name + permission, so a
   * reconnect otherwise lands on the misleading "Initialize New Folder" prompt
   * and a failed init. When set, the gate shows a clear "folder is gone, locate
   * or pick another" path instead. Null in the normal case. Only the name is
   * available (the File System Access API hides the absolute path).
   */
  folderMissing: string | null;
  lastConnectedFolder: string | null;
  /**
   * True when a `?wikiCapture=…` install was REFUSED because a real,
   * non-sentinel folder + a real signed-in user were already present
   * (the real-user shadowing guard fired and fell through to the normal
   * reconnect path). Consumed by `<WikiCaptureRefusedBanner>` to warn the
   * person that capture mode did NOT engage and their real data is on
   * screen. Never set in normal use, true fixture installs, or `/demo`.
   */
  captureRefused: boolean;
  /**
   * The folders the app remembers, most-recently-opened first (Phase A,
   * multi-folder). Always [] when NEXT_PUBLIC_MULTI_FOLDER is off, so flag-off
   * consumers see no remembered set and the switcher UI stays hidden. Refreshed
   * on connect / switch / forget. Carries the structured-clone handle so a
   * switch can re-grant permission without the OS picker.
   */
  rememberedFolders: RememberedFolder[];
  /**
   * Account-centric folder identity (Phase B, D2). Set when the signed-in account
   * connects to a folder ALREADY owned by a DIFFERENT account, so the takeover
   * warning can render. Null in every other case (no session, flag off, unowned
   * folder which is silently adopted per D4, or a folder this account owns). While
   * set, the connecting account has NOT been rebound to this folder, the user must
   * either Cancel (leave under the original owner) or deliberately Take over.
   * Always null when NEXT_PUBLIC_MULTI_FOLDER is off.
   */
  pendingTakeover: PendingTakeover | null;
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
  /**
   * DEV ONLY. Connect to a throwaway in-browser (OPFS) data folder instead of
   * an OS-picked disk folder, so a clean-slate session is one click with no
   * picker and nothing to reconnect to. Recreated empty on every call and
   * never persisted, so a reload lands on the login screen. `disconnect()`
   * removes the OPFS folder. No-op (returns false) in production or where OPFS
   * is unavailable.
   */
  connectEphemeralDev: () => Promise<boolean>;
  /**
   * Multi-folder (Phase A). Returns the remembered folders, most-recently-opened
   * first. When NEXT_PUBLIC_MULTI_FOLDER is off this always resolves to [] (the
   * remembered set is never read), so callers degrade to single-folder behavior.
   */
  listFolders: () => Promise<RememberedFolder[]>;
  /**
   * Multi-folder (Phase A). Re-grant permission to an already-remembered folder
   * handle and make it active WITHOUT the OS picker, reusing the same
   * permission-then-finishConnect machinery as reconnectWithStoredHandle. Falls
   * back to the OS picker (connect) only when the stored handle can't be
   * re-granted (handle missing or the browser revoked the grant). Returns true
   * when a folder ends up connected. No-op (returns false) when the flag is off.
   */
  switchFolder: (id: string) => Promise<boolean>;
  /**
   * Multi-folder (Phase A). Remove one folder from the remembered set. Does NOT
   * delete any data on disk. If the forgotten folder is the active one, the
   * session is disconnected (back to the connect screen) so the user is never
   * left pointing at a folder the app no longer remembers. No-op when the flag
   * is off.
   */
  forgetFolder: (id: string) => Promise<void>;
  /**
   * Multi-folder (Phase A). Rename one remembered folder's display label within
   * the current account scope. Does NOT touch the on-disk folder or the active
   * pointer. A blank name is a no-op. No-op when the flag is off.
   */
  renameFolder: (id: string, name: string) => Promise<void>;
  /**
   * Multi-folder (REFINEMENT 3). Set or clear one remembered folder's nickname
   * within the current account scope. Never touches the real folder name (the
   * switcher displays the nickname when set, else the name). A blank nickname
   * clears it. No-op when the flag is off.
   */
  setFolderNickname: (id: string, nickname: string) => Promise<void>;
  /**
   * Account-centric folder identity (Phase B, D2 + D6). Deliberately take over a
   * folder owned by a different account. Sweeps the foreign-shared records this
   * account cannot view to the folder trash (recoverable, tagged with the takeover
   * event id), writes the new owner record (recording the previous owner so it can
   * be reverted), clears pendingTakeover, and rebinds the active user. No-op when
   * the flag is off or there is no pending takeover. Returns true on success.
   *
   * DATA-SAFETY GUARD: safe only while DEVICE_KEY_V2 at-rest encryption is OFF, see
   * folder-owner.ts. Re-review this flow before shipping at-rest encryption.
   */
  takeOverFolder: () => Promise<boolean>;
  /**
   * Account-centric folder identity (Phase B, D6). Revert the most recent takeover
   * on the active folder, restoring exactly the shared files swept under that event
   * and handing ownership back to the previous owner fingerprint. No-op when the
   * flag is off or the folder has no recorded takeover. Returns true on success.
   */
  revertOwnership: () => Promise<boolean>;
  /**
   * Cancel a pending takeover (D2, the visible escape). Leaves the folder under
   * its original owner with no rebind and clears the warning state. The caller
   * typically pairs this with disconnect() so the user is not stranded on a folder
   * they declined to take over. No-op when there is no pending takeover.
   */
  cancelTakeover: () => void;
  /**
   * Multi-folder (top-bar folder picker). Pin or unpin one remembered folder for
   * the top-bar quick-switch chips within the current account scope. At most three
   * folders may be pinned at once; a fourth pin request is refused and resolves to
   * false (the caller surfaces a "cap reached" note). Unpinning always succeeds.
   * Never touches the data, the lab fields, the nickname, or the active pointer.
   * No-op (resolves false) when the flag is off.
   */
  setFolderPinned: (id: string, pinned: boolean) => Promise<boolean>;
}

/** DEV ONLY. Name of the throwaway OPFS folder backing an ephemeral session. */
const EPHEMERAL_DEV_DIR = "researchos-dev-ephemeral";
// Per-TAB marker that an ephemeral dev session is live. sessionStorage survives a
// refresh but is cleared when the tab closes, which is exactly the lifetime we
// want: the session persists across reloads and vanishes on close. The OPFS data
// folder itself is durable; this flag is what tells a reload to reconnect to it
// instead of forgetting it (and a fresh tab, with no flag, starts clean).
const EPHEMERAL_DEV_SESSION_FLAG = "researchos:ephemeral-dev-active";

interface PermissionableHandle extends FileSystemDirectoryHandle {
  queryPermission?: (opts: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (opts: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
}

/**
 * Best-effort, idempotent disk hygiene run AFTER a folder connects, off the
 * critical path: the one-time legacy-trash migration, the per-user trash
 * auto-cleanup, and the expired revert-window strip. Each pass reads many
 * per-user files; on a cloud-synced folder (iCloud/OneDrive/Dropbox) those reads
 * hydrate placeholders and are slow, so it used to make the connect block in
 * proportion to a user's note count. Fully guarded so a failure never surfaces,
 * and the UI already render-gates expired undo buttons and trashed items, so
 * running these a moment later is invisible.
 */
async function runConnectMaintenance(users: string[]): Promise<void> {
  try {
    await migrateLegacyNotesTrashAllUsers(users);
  } catch (err) {
    console.warn(
      "[FileSystemProvider] migrateLegacyNotesTrashAllUsers failed:",
      err,
    );
  }
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
}

/**
 * Schedules runConnectMaintenance off the connect critical path. Prefers
 * requestIdleCallback so it yields to the initial render, with a short
 * setTimeout fallback. Never awaited, never throws. No-op for an empty roster.
 */
function scheduleConnectMaintenance(users: string[]): void {
  if (users.length === 0) return;
  const run = () => {
    void runConnectMaintenance(users);
  };
  const ric = (
    globalThis as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
    }
  ).requestIdleCallback;
  if (typeof ric === "function") {
    ric(run, { timeout: 5000 });
  } else {
    setTimeout(run, 1500);
  }
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
    folderMissing: null,
    lastConnectedFolder: null,
    captureRefused: false,
    rememberedFolders: [],
    pendingTakeover: null,
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
        // Never CREATE a user folder from a passive hydrate. patchUserSettings
        // writes users/<username>/_settings.json, which materializes the folder.
        // If `username` is a leaked pointer (e.g. a demo "alex" carried in the
        // shared IndexedDB current-user key) on a real folder, that would stamp
        // a stray empty users/alex into the real folder (the 2026-06-07 bug).
        // Only migrate legacy settings for a user that genuinely exists here.
        const userDirs = await fileService
          .listDirectories("users")
          .catch(() => [] as string[]);
        const userIsReal = userDirs.includes(username);
        const legacy = readLegacyLocalStorageSettings();
        if (userIsReal && legacy?.animationType) {
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
        navLayout: settings.navLayout ?? null,
        defaultLandingTab: settings.defaultLandingTab,
        sidebarShowTasks: settings.sidebarShowTasks,
        sidebarShowCalendarEvents: settings.sidebarShowCalendarEvents,
        sidebarEventsHorizonDays: settings.sidebarEventsHorizonDays,
        coloredHeader: settings.coloredHeader,
        showCompanionButton: settings.showCompanionButton,
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
        navLayout: DEFAULT_SETTINGS.navLayout ?? null,
        defaultLandingTab: DEFAULT_SETTINGS.defaultLandingTab,
        sidebarShowTasks: DEFAULT_SETTINGS.sidebarShowTasks,
        sidebarShowCalendarEvents: DEFAULT_SETTINGS.sidebarShowCalendarEvents,
        sidebarEventsHorizonDays: DEFAULT_SETTINGS.sidebarEventsHorizonDays,
        coloredHeader: DEFAULT_SETTINGS.coloredHeader,
        showCompanionButton: DEFAULT_SETTINGS.showCompanionButton,
        offlineMode: DEFAULT_SETTINGS.offlineMode,
      });
    }
  }, []);

  /**
   * PI-context seed-on-connect (Owen pilot, A7 + addendum M5). A lab head who
   * lands in a folder that has no settings.json (a brand-new or just-initialized
   * folder) used to render as an individual, because account_type fell back to
   * its "member" default and PI context vanished. When the folder switcher
   * remembered this folder as the account's HEAD folder, re-derive PI context
   * here, but ONLY after confirming the head match against the signed lab record
   * (a cached labRole alone never re-PIs a folder, M5). On a confirmed seed we
   * re-hydrate so the UI paints PI chrome without a reload.
   *
   * Flag-gated + best-effort. A normal solo login (no head meta) is a no-op and
   * stays byte-identical. Runs from BOTH the auto-login connect path (finishConnect)
   * and the explicit login path (setCurrentUser), so a head who connects then
   * picks their account on the login screen is covered too.
   */
  const maybeSeedPiContext = useCallback(
    async (username: string) => {
      if (!MULTI_FOLDER_ENABLED || !username) return;
      try {
        const hasOwnSettings = await userSettingsFileExists(username);
        const settings = await readUserSettings(username);
        const activeId = await getActiveFolderId();
        const meta = activeId
          ? (await listRememberedFolders()).find((f) => f.id === activeId) ??
            null
          : null;
        const result = await validateHeadAndSeed({
          username,
          inputs: {
            currentAccountType: settings.account_type,
            hasOwnSettings,
            meta: meta ? { labRole: meta.labRole, labId: meta.labId } : null,
          },
        });
        if (result.seeded) {
          console.log(
            `[FileSystemProvider] PI-context seeded for ${username} (lab ${result.labId}).`,
          );
          await hydrateSettingsForUser(username);
        }
      } catch (err) {
        console.warn(
          "[FileSystemProvider] PI-context seed-on-connect failed:",
          err,
        );
      }
    },
    [hydrateSettingsForUser],
  );

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

        setState((prev) => ({
          ...prev,
          loadingStage: "verifying-permission",
          // Clear any prior "folder is gone" banner now that a fresh attempt is
          // underway (covers connect / reconnect / drop, which all funnel here).
          folderMissing: null,
        }));
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
          // A folder can fail validation for two very different reasons: it is a
          // present-but-empty folder that just needs initializing, OR its handle
          // is stale because the folder was moved/renamed/deleted on disk. Probe
          // the handle to tell them apart, so a vanished folder shows a clear
          // "locate or pick another" path instead of the misleading init prompt
          // (whose write would then fail against the missing directory anyway).
          const missing = await isDirectoryHandleMissing(handle);
          if (missing) {
            fileService.clearDirectoryHandle();
            setState((prev) => ({
              ...prev,
              isLoading: false,
              loadingStage: null,
              error: null,
              directoryName: null,
              needsInitialization: false,
              folderMissing: handle.name,
            }));
            return false;
          }
          setState((prev) => ({
            ...prev,
            isLoading: false,
            loadingStage: null,
            error: null,
            directoryName: handle.name,
            needsInitialization: true,
            folderMissing: null,
          }));
          return false;
        }

        await storeDirectoryHandle(handle);

        // Multi-folder (Phase A): add this folder to the remembered set and make
        // it the active one, keeping the legacy single key (written just above)
        // in lockstep with the active folder. Guarded by the flag, so a flag-off
        // build never touches the remembered set and stays byte-identical to
        // today. Best-effort: a failure here must not block the connect.
        if (MULTI_FOLDER_ENABLED) {
          try {
            await rememberFolder(handle);
          } catch (err) {
            console.warn("[FileSystemProvider] rememberFolder failed:", err);
          }
        }

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

        // Escape-hatch guard (2026-06-07): if the user hit "choose a different
        // folder" on the loading screen while we were awaiting the slow cloud
        // reads above, disconnect() cleared the handle. Bail without touching
        // state so this stale connect does not flicker the screen back or
        // wrongly mark the abandoned folder connected. The handle identity is
        // the token: setDirectoryHandle(handle) ran at the top, disconnect
        // nulls it, a fresh connect sets a different one.
        if (fileService.getDirectoryHandle() !== handle) return false;

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

        // Warm the FSA read cache: evict any stale entries before the UI mounts.
        setState((prev) => ({ ...prev, loadingStage: "warming-cache" }));
        try {
          await fileService.runConnectSweep(users);
        } catch (err) {
          console.warn("[FileSystemProvider] cache sweep failed:", err);
        }

        // Best-effort disk hygiene (legacy trash migration, trash auto-cleanup,
        // and the expired revert-window strip) used to run inline here, but each
        // pass reads many per-user files. On a cloud-synced folder
        // (iCloud/OneDrive/Dropbox) those reads hydrate placeholders one by one,
        // so blocking the connect on them made the loading screen scale with a
        // user's note count. They are idempotent and invisible to the UI
        // (expired undo buttons and trashed items are already render-gated), so
        // we now run them in the BACKGROUND after the connect resolves, off the
        // critical path. See scheduleConnectMaintenance.
        scheduleConnectMaintenance(users);

        let currentUser = await getCurrentUser();
        // A one-user folder no longer silently auto-logs in (identity model
        // phase 1, 2026-06-05). The login screen shows a quick "Continue as
        // <user>?" confirm instead, so a different person can add their own
        // account and a user who set a password is still prompted for it. A
        // returning session keeps its stored currentUser (handled below); only a
        // fresh connect with no stored pointer falls through to the login screen.
        if (
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

        // Account-centric folder identity (Phase B). When MULTI_FOLDER is on AND
        // a session identity is present, reconcile folder ownership for the
        // signed-in account. A folder with no owner record is ADOPTED silently
        // (D4). A folder this account already owns proceeds normally. A folder
        // owned by a DIFFERENT account surfaces a takeover warning (D2) and does
        // NOT rebind until the user resolves it. With the flag OFF or no session
        // this resolves to "none" and writes nothing, so the legacy connect path
        // below is byte-identical to today. Best-effort, an owner-record IO
        // failure must never block a connect.
        let pendingTakeover: PendingTakeover | null = null;
        if (MULTI_FOLDER_ENABLED && currentAccountFingerprint()) {
          try {
            const action = await resolveOwnerAction(
              MULTI_FOLDER_ENABLED,
              currentUser,
            );
            if (action.kind === "takeover" && action.pendingTakeover) {
              pendingTakeover = action.pendingTakeover;
            }
          } catch (err) {
            console.warn("[FileSystemProvider] owner resolution failed:", err);
          }
        }

        // Final escape-hatch guard before we commit "connected": if the user
        // bailed to a different folder during the reads above, do not mark this
        // abandoned folder connected.
        if (fileService.getDirectoryHandle() !== handle) return false;

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
          pendingTakeover,
        }));

        // Once a user is known, load their preferences from disk into the
        // Zustand store. Auto-login paths (single-user folder or silent
        // reconnect) skip setCurrentUser, so we hydrate here too.
        if (currentUser) {
          await hydrateSettingsForUser(currentUser);
        }

        // PI-context seed-on-connect (Owen pilot, A7 + M5). Runs only on the
        // auto-login paths where setCurrentUser is skipped; the explicit login
        // path calls maybeSeedPiContext from setCurrentUser instead.
        if (currentUser) {
          await maybeSeedPiContext(currentUser);
        }

        // Multi-folder (Phase A): surface the up-to-date remembered set to the
        // switcher UI. Off the critical path (the connect already committed
        // above) and flag-guarded so it is inert when multi-folder is off.
        if (MULTI_FOLDER_ENABLED) {
          try {
            const folders = await listRememberedFolders();
            setState((prev) => ({ ...prev, rememberedFolders: folders }));
          } catch {
            // best-effort
          }
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
    [hydrateSettingsForUser, maybeSeedPiContext]
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
            // Peek the SHARED IDB identity directly. The normal getters are
            // now per-tab demo-aware and would report this fixture tab's own
            // (empty / fixture) identity, hiding any real signed-in user in
            // the shared store. peekSharedRealIdentity bypasses that masking
            // so the shadowing guard still fires.
            const { handleName, currentUser: existingUser } =
              await peekSharedRealIdentity();
            const realFolderConnected = !!handleName && !!existingUser;
            if (realFolderConnected) {
              console.warn(
                "[FileSystemProvider] Refusing ?wikiCapture install: real user already signed in.",
              );
              // Surface a VISIBLE warning (not just this console line) so a
              // would-be screenshotter knows capture mode did not engage and
              // their real data is on screen. `<WikiCaptureRefusedBanner>`
              // watches this flag. This is the only place it is ever set, so
              // it never fires in normal use, true fixture installs, or /demo.
              setState((prev) => ({ ...prev, captureRefused: true }));
              // Drop the stale sticky capture flags now. A real folder is
              // present, so this tab is definitively NOT a capture/demo tab.
              // Without this, the wiki-capture sticky set by getWikiCaptureVariant
              // persists for the whole tab session: every navigation re-fires
              // this banner, AND the per-tab demo isolation (isDemoTab keys off
              // the same sticky) would mask the real folder. Clearing here, before
              // the fall-through reconnect, un-masks the real folder this load and
              // stops the nag on the next navigation. (2026-06-07)
              clearAllStickyDemoFlags();
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
          // The public /demo route deliberately ignores `?fixtureUser=`
          // (documented as alex's lab, shouldn't shift under a public URL
          // flag). It honors only the internal `?demoViewAs=` param, set
          // by the demo "view as lab head" toggle so the PI-dashboard
          // welcome clip can be recorded. Both default to "alex".
          const fixtureUser = demo
            ? (resolveDemoViewAsUser() ?? "alex")
            : signIn
              ? resolveFixtureUser()
              : "alex";
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

      // Dev ephemeral session restore (survives refresh, dies on tab close).
      // The "start ephemeral session" button keeps its data in OPFS (durable)
      // but does not persist the handle, so a normal load forgets it. When the
      // per-tab sessionStorage flag is set, this was a refresh of a live
      // session: re-acquire the OPFS folder (without wiping it) and reconnect.
      // A fresh tab has no flag, so we fall through and the next button click
      // starts clean. Dev-only and gated, so it never runs in production.
      if (
        process.env.NODE_ENV === "development" &&
        typeof sessionStorage !== "undefined" &&
        sessionStorage.getItem(EPHEMERAL_DEV_SESSION_FLAG) === "1"
      ) {
        try {
          const storage = (typeof navigator !== "undefined" ? navigator.storage : undefined) as
            | { getDirectory?: () => Promise<FileSystemDirectoryHandle> }
            | undefined;
          const root = storage?.getDirectory ? await storage.getDirectory() : null;
          // No { create: true }: reconnect to the existing folder only, never
          // recreate. If it's gone, the session can't be restored.
          const handle = root
            ? await root.getDirectoryHandle(EPHEMERAL_DEV_DIR).catch(() => null)
            : null;
          if (handle) {
            fileService.setDirectoryHandle(handle);
            fileService.resetReadCount();
            setState((prev) => ({
              ...prev,
              isLoading: true,
              loadingStage: "connecting",
              error: null,
            }));
            const ok = await finishConnect(handle);
            if (ok) return;
          }
          // Folder gone or reconnect failed: drop the stale flag and fall
          // through to the normal path (which lands on the welcome/setup screen).
          sessionStorage.removeItem(EPHEMERAL_DEV_SESSION_FLAG);
        } catch {
          try {
            sessionStorage.removeItem(EPHEMERAL_DEV_SESSION_FLAG);
          } catch {
            // ignore
          }
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

        // Multi-folder (Phase A): on the connect/setup screen, surface the
        // remembered set so the switcher can offer one-click re-open of any
        // previously connected folder. listRememberedFolders runs the legacy
        // OLD->NEW migration internally, so a returning user's single folder
        // appears here even on the very first multi-folder load. Flag-guarded
        // and best-effort, so a flag-off load is byte-identical to today.
        let initialFolders: RememberedFolder[] = [];
        if (MULTI_FOLDER_ENABLED) {
          try {
            initialFolders = await listRememberedFolders();
          } catch {
            initialFolders = [];
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
          rememberedFolders: initialFolders,
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
        // The write can fail because the folder vanished between connect and
        // this click (moved/renamed/deleted). Distinguish that from a real write
        // error so the user gets the clear "folder is gone" path, not a dead-end
        // "try again" against a directory that no longer exists.
        const initHandle = fileService.getDirectoryHandle();
        const missing = initHandle
          ? await isDirectoryHandleMissing(initHandle)
          : false;
        if (missing) {
          const goneName = initHandle?.name ?? null;
          fileService.clearDirectoryHandle();
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error: null,
            needsInitialization: false,
            folderMissing: goneName,
          }));
          return false;
        }
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: "Failed to create folder structure. Please try again.",
        }));
        return false;
      }

      const initHandle = fileService.getDirectoryHandle()!;
      await storeDirectoryHandle(initHandle);

      // Multi-folder (Phase A): remember the just-initialized folder as active.
      let initFolders: RememberedFolder[] = [];
      if (MULTI_FOLDER_ENABLED) {
        try {
          await rememberFolder(initHandle);
          initFolders = await listRememberedFolders();
        } catch (err) {
          console.warn("[FileSystemProvider] rememberFolder (init) failed:", err);
        }
      }

      setState((prev) => ({
        ...prev,
        isConnected: true,
        isLoading: false,
        error: null,
        availableUsers: [],
        needsInitialization: false,
        rememberedFolders: MULTI_FOLDER_ENABLED ? initFolders : prev.rememberedFolders,
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

  const connectEphemeralDev = useCallback(async (): Promise<boolean> => {
    if (process.env.NODE_ENV !== "development") return false;
    const storage = (typeof navigator !== "undefined" ? navigator.storage : undefined) as
      | { getDirectory?: () => Promise<FileSystemDirectoryHandle> }
      | undefined;
    if (!storage?.getDirectory) {
      setState((prev) => ({
        ...prev,
        error: "This browser has no OPFS, so an ephemeral dev session is not available.",
      }));
      return false;
    }
    setState((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
      loadingStage: "validating-folder",
    }));
    try {
      const root = await storage.getDirectory();
      const rootEntry = root as unknown as {
        removeEntry: (name: string, opts?: { recursive?: boolean }) => Promise<void>;
      };
      // Fresh slate: drop any prior ephemeral folder, then recreate it empty so
      // a re-click never carries old state forward.
      try {
        await rootEntry.removeEntry(EPHEMERAL_DEV_DIR, { recursive: true });
      } catch {
        // No prior folder, or it was already gone. Both are fine.
      }
      const handle = await root.getDirectoryHandle(EPHEMERAL_DEV_DIR, { create: true });
      fileService.setDirectoryHandle(handle);
      const ok = await ensureFolderStructure();
      if (!ok) {
        fileService.clearDirectoryHandle();
        setState((prev) => ({
          ...prev,
          isLoading: false,
          loadingStage: null,
          error: "Could not create the ephemeral dev folder.",
        }));
        return false;
      }
      // Deliberately NOT storeDirectoryHandle (IndexedDB persists across tab
      // close): we don't want a silent reconnect on a fresh tab. Instead mark
      // the session in sessionStorage, which a reload reads to reconnect to the
      // still-present OPFS folder, and which clears itself on tab close.
      try {
        sessionStorage.setItem(EPHEMERAL_DEV_SESSION_FLAG, "1");
      } catch {
        // sessionStorage unavailable (private mode edge); the session just
        // won't survive a refresh, which is the old behavior. No-op.
      }
      setState((prev) => ({
        ...prev,
        isConnected: true,
        isLoading: false,
        loadingStage: null,
        error: null,
        directoryName: "Dev ephemeral",
        availableUsers: [],
        needsInitialization: false,
        lastConnectedFolder: null,
        captureRefused: false,
      }));
      return true;
    } catch (err) {
      fileService.clearDirectoryHandle();
      setState((prev) => ({
        ...prev,
        isLoading: false,
        loadingStage: null,
        error: err instanceof Error ? err.message : "Ephemeral dev connect failed.",
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

      // Multi-folder (Phase A): remember the newly-created folder as active.
      let createdFolders: RememberedFolder[] = [];
      if (MULTI_FOLDER_ENABLED) {
        try {
          await rememberFolder(newFolderHandle);
          createdFolders = await listRememberedFolders();
        } catch (err) {
          console.warn("[FileSystemProvider] rememberFolder (create) failed:", err);
        }
      }

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
        rememberedFolders: MULTI_FOLDER_ENABLED ? createdFolders : prev.rememberedFolders,
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

  // disconnect() semantics (Phase A / multi-folder).
  //
  // SINGLE-FOLDER (flag off): unchanged from today. It clears the one remembered
  // handle + the current/main user and returns the user to the connect screen.
  // It is the "forget my folder" action (the only folder the app knew).
  //
  // MULTI-FOLDER (flag on): disconnect FORGETS THE ACTIVE FOLDER ONLY, not the
  // whole remembered set. The legacy single key and the active pointer are
  // cleared (so the app is no longer pointing at a folder), and the active
  // folder is dropped from the remembered set (its on-disk data is untouched).
  // The OTHER remembered folders survive, so the connect screen can still offer
  // a one-click switch to them. This matches the "return to connect screen"
  // behavior the UI already expects while keeping the rest of the set intact.
  // To remove a specific non-active folder, use forgetFolder(id).
  const disconnect = useCallback(async () => {
    let survivingFolders: RememberedFolder[] = [];
    if (MULTI_FOLDER_ENABLED) {
      try {
        const activeId = await getActiveFolderId();
        if (activeId) {
          await forgetRememberedFolder(activeId);
        }
        survivingFolders = await listRememberedFolders();
      } catch (err) {
        console.warn("[FileSystemProvider] disconnect: forget active failed:", err);
      }
    }

    fileService.clearDirectoryHandle();
    await clearDirectoryHandle();
    // Dev: drop the throwaway OPFS folder so a closed ephemeral session leaves
    // nothing behind. A no-op for real disk folders (the entry is absent).
    if (process.env.NODE_ENV === "development") {
      // Clear the per-tab session marker first so a refresh after an explicit
      // disconnect does not try to resurrect the (now removed) session.
      try {
        sessionStorage.removeItem(EPHEMERAL_DEV_SESSION_FLAG);
      } catch {
        // ignore
      }
      try {
        const storage = (typeof navigator !== "undefined" ? navigator.storage : undefined) as
          | { getDirectory?: () => Promise<FileSystemDirectoryHandle> }
          | undefined;
        if (storage?.getDirectory) {
          const root = (await storage.getDirectory()) as unknown as {
            removeEntry: (name: string, opts?: { recursive?: boolean }) => Promise<void>;
          };
          await root.removeEntry(EPHEMERAL_DEV_DIR, { recursive: true });
        }
      } catch {
        // Not an ephemeral session, or nothing to remove.
      }
    }
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
      folderMissing: null,
      lastConnectedFolder: null,
      captureRefused: false,
      rememberedFolders: survivingFolders,
      // Phase B: never leak a takeover prompt across a disconnect / folder switch.
      pendingTakeover: null,
    });
  }, []);

  const setCurrentUser = useCallback(async (username: string) => {
    const prevUser = currentUserRef.current;
    const isUserChange = prevUser !== null && prevUser !== username;
    clearCurrentUserCache();
    // PI capability revamp: a lab head's once-per-session edit confirmations
    // must not carry across a user switch (the keys are owner-scoped, not
    // confirming-user-scoped), so wipe them when the active user changes.
    clearPiEditConfirmations();
    await storeCurrentUser(username);
    setState((prev) => ({ ...prev, currentUser: username }));
    await hydrateSettingsForUser(username);
    // PI-context seed-on-connect (Owen pilot, A7 + M5). A head logging into a
    // freshly initialized folder that has no PI settings gets their account_type
    // + lab_id re-derived here, validated against the signed lab record. No-op
    // for a solo user or a folder that already carries its own settings.
    await maybeSeedPiContext(username);
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
  }, [hydrateSettingsForUser, maybeSeedPiContext]);

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

  // ── Multi-folder (Phase A) public methods ────────────────────────────────

  const listFolders = useCallback(async (): Promise<RememberedFolder[]> => {
    if (!MULTI_FOLDER_ENABLED) return [];
    const folders = await listRememberedFolders();
    setState((prev) => ({ ...prev, rememberedFolders: folders }));
    return folders;
  }, []);

  const switchFolder = useCallback(
    async (id: string): Promise<boolean> => {
      if (!MULTI_FOLDER_ENABLED) return false;

      const handle = await getRememberedFolderHandle(id);
      if (!handle) {
        // The remembered handle is gone (forgotten, or never stored). Fall back
        // to the OS picker so the user can re-pick a folder. connect() routes
        // through finishConnect, which re-remembers whatever they pick.
        return connect();
      }

      setState((prev) => ({
        ...prev,
        isLoading: true,
        loadingStage: "verifying-permission",
        error: null,
      }));
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );

      // Re-grant permission to the stored handle WITHOUT the OS picker, reusing
      // the same requestPermission-then-finishConnect machinery as
      // reconnectWithStoredHandle. requestPermission must run from a user
      // gesture (the switcher click qualifies).
      const permissionable = handle as PermissionableHandle;
      if (permissionable.requestPermission) {
        let permission: PermissionState = "denied";
        try {
          permission = await permissionable.requestPermission({ mode: "readwrite" });
        } catch (err) {
          console.warn("[FileSystemProvider.switchFolder] requestPermission failed:", err);
          permission = "denied";
        }
        if (permission !== "granted") {
          // Could not re-grant on the stored handle. Fall back to the picker so
          // the user is never hard-stuck on a folder they can't re-open.
          setState((prev) => ({ ...prev, isLoading: false, loadingStage: null }));
          return connect();
        }
      }

      // Make this the active folder and keep the legacy single key in lockstep
      // so a later flag-off build reconnects to it. fileService is pointed at
      // the new handle inside finishConnect.
      await setActiveFolderId(id);
      fileService.resetReadCount();
      setState((prev) => ({ ...prev, loadingStage: "connecting" }));
      const ok = await finishConnect(handle);
      if (!ok) {
        setState((prev) => ({ ...prev, isLoading: false, loadingStage: null }));
      }
      return ok;
    },
    [connect, finishConnect],
  );

  const forgetFolder = useCallback(
    async (id: string): Promise<void> => {
      if (!MULTI_FOLDER_ENABLED) return;
      const activeId = await getActiveFolderId();
      await forgetRememberedFolder(id);
      const folders = await listRememberedFolders();
      setState((prev) => ({ ...prev, rememberedFolders: folders }));
      // Forgetting the ACTIVE folder means the app is now pointing at a folder
      // it no longer remembers. Disconnect the session so the user lands on the
      // connect screen (where the surviving folders are still one click away)
      // rather than being stranded mid-session. forgetRememberedFolder already
      // cleared the active pointer; disconnect() clears the legacy single key.
      if (activeId && activeId === id) {
        await disconnect();
      }
    },
    [disconnect],
  );

  const renameFolder = useCallback(
    async (id: string, name: string): Promise<void> => {
      if (!MULTI_FOLDER_ENABLED) return;
      await renameRememberedFolder(id, name);
      const folders = await listRememberedFolders();
      setState((prev) => ({ ...prev, rememberedFolders: folders }));
    },
    [],
  );

  const setFolderNickname = useCallback(
    async (id: string, nickname: string): Promise<void> => {
      if (!MULTI_FOLDER_ENABLED) return;
      await setRememberedFolderNickname(id, nickname);
      const folders = await listRememberedFolders();
      setState((prev) => ({ ...prev, rememberedFolders: folders }));
    },
    [],
  );

  // Account-centric folder identity (Phase B, D2). Deliberately take over a
  // folder owned by a different account. Reads the live owner record, sweeps the
  // foreign-shared records this account cannot view to the folder trash (tagged
  // with the takeover event id so it is recoverable, D6), writes the new owner
  // record recording the previous owner, then clears pendingTakeover.
  //
  // DATA-SAFETY GUARD: this blind rebind is safe ONLY while DEVICE_KEY_V2 at-rest
  // encryption stays OFF, see folder-owner.ts. With at-rest encryption on, the new
  // owner would not hold the prior owner's unwrap key, so this flow must be
  // re-reviewed before that ships.
  const takeOverFolder = useCallback(async (): Promise<boolean> => {
    if (!MULTI_FOLDER_ENABLED) return false;
    const myFingerprint = currentAccountFingerprint();
    const currentUser = currentUserRef.current;
    if (!myFingerprint) return false;

    try {
      const prev = await readFolderOwner();
      // Nothing to take over (record vanished or is already ours), just clear the
      // prompt so the user is never stuck.
      if (!prev || prev.owner_fingerprint === myFingerprint) {
        setState((s) => ({ ...s, pendingTakeover: null }));
        return false;
      }

      const eventId = makeTakeoverEventId(
        new Date().toISOString(),
        Math.random().toString(36).slice(2, 8),
      );

      // Sweep the foreign shares first (recoverable, D6). Scoped to the connecting
      // account's own user dir. No user yet means nothing to sweep.
      let sweptCount = 0;
      if (currentUser) {
        const swept = await sweepForeignShares(
          currentUser,
          myFingerprint,
          eventId,
        );
        sweptCount = swept.length;
      }

      // The new owner's email label, best-effort from this account's sidecar.
      let myEmail: string | undefined;
      if (currentUser) {
        try {
          const sc = await readSharingIdentity(currentUser);
          myEmail = sc?.email;
        } catch {
          // best-effort label only
        }
      }

      await writeFolderOwner(
        takeoverRecord(prev, myFingerprint, myEmail, {
          id: eventId,
          at: new Date().toISOString(),
          from_fingerprint: prev.owner_fingerprint,
          to_fingerprint: myFingerprint,
          swept_count: sweptCount,
        }),
      );

      setState((s) => ({ ...s, pendingTakeover: null }));
      return true;
    } catch (err) {
      console.warn("[FileSystemProvider] takeOverFolder failed:", err);
      return false;
    }
  }, []);

  // Account-centric folder identity (Phase B, D6). Revert the most recent takeover
  // on the active folder, restoring exactly the swept shares and handing ownership
  // back to the previous owner fingerprint.
  const revertOwnership = useCallback(async (): Promise<boolean> => {
    if (!MULTI_FOLDER_ENABLED) return false;
    try {
      const rec = await readFolderOwner();
      const last = lastTakeover(rec);
      if (!rec || !last) return false;

      // Restore the swept set first, then hand ownership back, so a mid-way
      // failure leaves the shares recoverable rather than orphaned under a
      // reverted owner record.
      await restoreSweptShares(last.id);
      const reverted = revertRecord(rec);
      if (reverted) {
        await writeFolderOwner(reverted);
      }
      return true;
    } catch (err) {
      console.warn("[FileSystemProvider] revertOwnership failed:", err);
      return false;
    }
  }, []);

  // Account-centric folder identity (Phase B, D2). Cancel a pending takeover, the
  // visible escape. Leaves the folder under its original owner with no rebind.
  const cancelTakeover = useCallback((): void => {
    setState((s) => ({ ...s, pendingTakeover: null }));
  }, []);

  const setFolderPinned = useCallback(
    async (id: string, pinned: boolean): Promise<boolean> => {
      if (!MULTI_FOLDER_ENABLED) return false;
      const ok = await setRememberedFolderPinned(id, pinned);
      // Re-read regardless so the UI reflects the true persisted state even when
      // a pin was refused by the cap (nothing changed, the list is unchanged).
      const folders = await listRememberedFolders();
      setState((prev) => ({ ...prev, rememberedFolders: folders }));
      return ok;
    },
    [],
  );

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
    connectEphemeralDev,
    listFolders,
    switchFolder,
    forgetFolder,
    renameFolder,
    setFolderNickname,
    takeOverFolder,
    revertOwnership,
    cancelTakeover,
    setFolderPinned,
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

/**
 * Whether this is a phone / mobile device. UA-based on purpose (not
 * pointer:coarse, which would also catch touch laptops). userAgentData.mobile is
 * the modern signal; the regex covers engines that do not expose it yet.
 * Client-only (returns false during SSR where there is no navigator).
 */
export function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & {
    userAgentData?: { mobile?: boolean };
  };
  if (typeof nav.userAgentData?.mobile === "boolean") {
    return nav.userAgentData.mobile;
  }
  return /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(nav.userAgent);
}

export function isFileSystemAccessSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (!("showDirectoryPicker" in window)) return false;
  // Chrome 149+ on Android now EXPOSES showDirectoryPicker, but the app's
  // folder-backed workflow is a desktop experience (no usable directory picker
  // on a phone), and treating a phone as "supported" wrongly routes it past the
  // read-only marketing/welcome path into the folder-connect dead-end. So a
  // mobile device is unsupported regardless of the API's presence.
  return !isMobileDevice();
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
