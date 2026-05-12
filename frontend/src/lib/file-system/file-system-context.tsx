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
 *  screen so the user sees something change while OneDrive is being slow. */
export type LoadingStage =
  | null
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
  disconnect: () => Promise<void>;
  setCurrentUser: (username: string) => Promise<void>;
  createUser: (username: string) => Promise<boolean>;
  refreshUsers: () => Promise<void>;
  reverifyPermission: () => Promise<boolean>;
  initializeFolder: () => Promise<boolean>;
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

  useEffect(() => {
    async function initialize() {
      try {
        const meta = await getStoredDirectoryMeta();
        const [currentUser, mainUser] = await Promise.all([
          getCurrentUser(),
          getMainUser(),
        ]);

        console.log("[FileSystemProvider.initialize] meta:", meta);
        console.log("[FileSystemProvider.initialize] currentUser:", currentUser);
        console.log("[FileSystemProvider.initialize] mainUser:", mainUser);

        setState((prev) => ({
          ...prev,
          lastConnectedFolder: meta?.name || null,
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
  }, []);

  const connect = useCallback(async (): Promise<boolean> => {
    const showDirectoryPicker = (window as unknown as { showDirectoryPicker?: (options?: { mode?: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    if (!showDirectoryPicker) {
      setState((prev) => ({
        ...prev,
        error: "File System Access API not supported in this browser.",
      }));
      return false;
    }

    let handle: FileSystemDirectoryHandle | null = null;

    try {
      handle = await showDirectoryPicker({ mode: "readwrite" });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return false;
      }
      const message = err instanceof Error ? err.message : "Failed to open folder picker";
      setState((prev) => ({ ...prev, error: message }));
      return false;
    }

    if (!handle) {
      return false;
    }

    fileService.resetReadCount();
    setState((prev) => ({ ...prev, isLoading: true, loadingStage: "connecting", error: null }));

    try {
      fileService.setDirectoryHandle(handle);

      setState((prev) => ({ ...prev, loadingStage: "verifying-permission" }));
      const hasPermission = await fileService.verifyPermission(true);
      console.log("Permission check result:", hasPermission);

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
      console.log("Folder validation result:", isValid, "for folder:", handle.name);

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
        directoryName: handle!.name,
        currentUser,
        mainUser,
        availableUsers: users,
        needsInitialization: false,
        lastConnectedFolder: handle!.name,
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
  }, []);

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
    disconnect,
    setCurrentUser,
    createUser,
    refreshUsers,
    reverifyPermission,
    initializeFolder,
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
