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
} from "./indexeddb-store";
import { clearCurrentUserCache } from "../storage/json-store";
import { discoverUsers, validateResearchFolder, ensureFolderStructure } from "./user-discovery";

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

        setState((prev) => ({ ...prev, loadingStage: "discovering-users" }));
        const users = await discoverUsers();

        let currentUser = await getCurrentUser();
        if (users.length === 1) {
          currentUser = users[0];
          await storeCurrentUser(currentUser);
        }

        let mainUser = await getMainUser();
        if (!mainUser && currentUser) {
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
    []
  );

  useEffect(() => {
    async function initialize() {
      try {
        const [storedHandle, meta, currentUser, mainUser] = await Promise.all([
          getStoredDirectoryHandle(),
          getStoredDirectoryMeta(),
          getCurrentUser(),
          getMainUser(),
        ]);

        console.log("[FileSystemProvider.initialize] meta:", meta, "hasHandle:", !!storedHandle);

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
  }, [finishConnect]);

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
    console.log("[FileSystemProvider.setCurrentUser] Cache cleared");
    await storeCurrentUser(username);
    console.log("[FileSystemProvider.setCurrentUser] Stored to IndexedDB");
    setState((prev) => ({ ...prev, currentUser: username }));
    console.log("[FileSystemProvider.setCurrentUser] State updated");
  }, []);

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
