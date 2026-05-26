"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useFileSystem, isFileSystemAccessSupported } from "@/lib/file-system/file-system-context";
import BetaDonationButton from "@/components/BetaDonationButton";
import FeedbackModal from "@/components/FeedbackModal";
import ImportELNDialog from "@/components/import-eln/ImportELNDialog";
import PickUserBeforeImportModal, {
  ELN_IMPORT_PENDING_KEY,
} from "@/components/import-eln/PickUserBeforeImportModal";
import UserAvatar from "@/components/UserAvatar";
import BeakerBot from "@/components/BeakerBot";
import PickerWalkthroughModal from "@/components/picker-walkthrough/PickerWalkthroughModal";
import RiseCredentialsStamp from "@/components/RiseCredentialsStamp";
import { useErrorReporting } from "@/hooks/useErrorReporting";
import {
  extractDirectoryHandleFromDrop,
  describeDropExtractionError,
  type DropExtractionResult,
} from "@/lib/file-system/drop-folder";

interface ResearchFolderSetupProps {
  onComplete: () => void;
}

export default function ResearchFolderSetup({ onComplete }: ResearchFolderSetupProps) {
  const {
    connect,
    connectWithHandle,
    reconnectWithStoredHandle,
    isLoading,
    error,
    isConnected,
    availableUsers,
    currentUser,
    setCurrentUser,
    createUser,
    directoryName,
    needsInitialization,
    initializeFolder,
    lastConnectedFolder,
    createNewFolder,
  } = useFileSystem();

  const [showUserSelection, setShowUserSelection] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [elnImportOpen, setElnImportOpen] = useState(false);
  // Inline user-picker modal for the "Import from LabArchives" CTA. When
  // no `currentUser` is set, clicking the CTA opens this picker rather
  // than the ImportELNDialog directly: the user picks an existing
  // account or creates one, the picker sets a sticky-intent flag in
  // sessionStorage, fires the sign-in, and the post-sign-in surface
  // (lib/providers.tsx) re-mounts ImportELNDialog automatically.
  const [pickUserForImportOpen, setPickUserForImportOpen] = useState(false);
  const { showBugReport, currentError, openBugReport, closeBugReport } = useErrorReporting();


  // Drag-and-drop state for the "Link Existing Folder" card. `isDragOver` is
  // a ref-counted boolean (incremented on dragenter, decremented on
  // dragleave) so nested children don't flicker the visual treatment off
  // when the pointer crosses an internal element boundary. `dropError`
  // surfaces file-not-folder / multi-item validation errors next to the
  // existing folder-system error.
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const dragCounterRef = useRef(0);

  // Opt-in walkthrough modal (the resurrected 4-beat tour that used
  // to fire automatically pre-75c6107b). Now triggered only by the
  // explicit CTA below the welcome bubble. Returning users skip past.
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);

  console.log("ResearchFolderSetupNew render:", { 
    isConnected, 
    currentUser, 
    availableUsers: availableUsers.length, 
    showUserSelection,
    needsInitialization 
  });

  useEffect(() => {
    console.log("useEffect triggered:", { isConnected, currentUser, availableUsers: availableUsers.length });
    if (isConnected && currentUser) {
      console.log("Calling onComplete - should navigate to app");
      onComplete();
    } else if (isConnected && availableUsers.length > 0) {
      console.log("Setting showUserSelection to true - multiple users");
      setShowUserSelection(true);
    } else if (isConnected && availableUsers.length === 0) {
      console.log("Setting showUserSelection to true - no users");
      setShowUserSelection(true);
    }
  }, [isConnected, currentUser, availableUsers, onComplete]);

  const handleConnect = async () => {
    await connect();
  };

  // Drag-and-drop handlers for the "Link Existing Folder" card. Browser
  // support note: `DataTransferItem.getAsFileSystemHandle()` and
  // `showDirectoryPicker()` ship together in Chromium (Chrome / Edge /
  // Brave) and are absent in Safari + Firefox alike. We already gate the
  // entire setup screen on `isFileSystemAccessSupported()` above, so if
  // the click-the-button path works in this browser the drop path works
  // too. `webkitGetAsEntry()` is kept as a defensive fallback.
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.dataTransfer?.types?.includes("Files")) return;
    dragCounterRef.current += 1;
    setIsDragOver(true);
    setDropError(null);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    // Must preventDefault on dragover for the browser to treat the element
    // as a valid drop target. Without this, the drop event never fires.
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);

    const items = e.dataTransfer?.items;
    if (!items || items.length === 0) return;

    const result: DropExtractionResult = await extractDirectoryHandleFromDrop(items);
    if (result.kind === "ok") {
      setDropError(null);
      await connectWithHandle(result.handle);
      return;
    }
    setDropError(describeDropExtractionError(result.kind));
  };

  const handleSelectUser = async (username: string) => {
    await setCurrentUser(username);
    onComplete();
  };

  const handleCreateUser = async () => {
    if (!newUsername.trim()) {
      setCreateError("Please enter a username");
      return;
    }

    const sanitized = newUsername.trim().replace(/[^a-zA-Z0-9_-]/g, "");
    if (sanitized !== newUsername.trim()) {
      setCreateError("Username can only contain letters, numbers, underscores, and hyphens");
      return;
    }

    setIsCreating(true);
    setCreateError(null);

    try {
      const success = await createUser(sanitized);
      if (success) {
        await setCurrentUser(sanitized);
        onComplete();
      } else {
        setCreateError("Failed to create user. Please try again.");
      }
    } catch {
      setCreateError("Failed to create user. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  if (!isFileSystemAccessSupported()) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="max-w-lg mx-4 p-6 bg-white/10 backdrop-blur-xl rounded-2xl border border-white/20">
          <h2 className="text-xl font-bold text-white mb-4">Browser Not Supported</h2>
          <p className="text-slate-300">
            ResearchOS requires the File System Access API, which is only supported in 
            Chromium-based browsers (Chrome, Edge, Brave). Please switch to a supported browser.
          </p>
        </div>
      </div>
    );
  }

  if (showUserSelection) {
    return (
      <div className="fixed inset-0 z-[100] overflow-y-auto flex items-start sm:items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 py-8">
        <div className="absolute inset-0 opacity-5">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }}
          />
        </div>

        <div className="relative z-10 w-full max-w-md mx-4">
          <div className="text-center mb-8">
            {/* Brand mark: BeakerBot in the gradient pill, matching
                UserLoginScreen. Static, no liquid (white wireframe
                reads cleanly on the blue→purple gradient). */}
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg mb-4">
              <BeakerBot
                pose="idle"
                noLiquid
                ariaLabel="ResearchOS BeakerBot logo"
                className="w-8 h-8 text-white"
              />
            </div>
            <h1 className="text-3xl font-bold text-white">ResearchOS</h1>
            <p className="text-slate-400 mt-2">Connected to: {directoryName}</p>
          </div>

          <div className="bg-white/10 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20 overflow-hidden">
            <div className="p-6">
              {availableUsers.length > 0 ? (
                <>
                  <h2 className="text-xl font-bold text-white mb-4">Select Account</h2>
                  <p className="text-slate-400 mb-6">
                    Choose an existing account or create a new one to continue.
                  </p>

                  <div className="space-y-2 mb-6">
                    {availableUsers.map((user) => (
                      <button
                        key={user}
                        onClick={() => handleSelectUser(user)}
                        className="w-full p-4 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-500/50 rounded-lg transition-all text-left flex items-center gap-3"
                      >
                        <UserAvatar username={user} size="md" />
                        <span className="text-white font-medium">{user}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <h2 className="text-xl font-bold text-white mb-4">Create Your First Account</h2>
                  <p className="text-slate-400 mb-6">
                    This folder doesn&apos;t have any accounts yet. Create one to get started.
                  </p>
                </>
              )}

              <div className={availableUsers.length > 0 ? "border-t border-white/10 pt-6" : ""}>
                {availableUsers.length > 0 && (
                  <h3 className="text-sm font-medium text-slate-300 mb-3">Create New Account</h3>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="Enter username"
                    className="flex-1 px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    onKeyDown={(e) => e.key === "Enter" && handleCreateUser()}
                  />
                  <button
                    onClick={handleCreateUser}
                    disabled={isCreating}
                    className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    {isCreating ? "Creating..." : "Create"}
                  </button>
                </div>
                {createError && (
                  <p className="text-red-400 text-sm mt-2">{createError}</p>
                )}
              </div>

              <div className="border-t border-white/10 pt-4 mt-6">
                <h3 className="text-sm font-medium text-slate-300 mb-2">
                  Coming from LabArchives?
                </h3>
                <p className="text-xs text-slate-400 mb-3">
                  Import a LabArchives Offline Notebook ZIP into your
                  workspace. Pages become tasks, folders can become projects.
                  Other ELNs (Benchling, Notion, paper notebooks) coming later.
                </p>
                <ImportFromELNButton
                  onOpen={() => {
                    // Branch on `currentUser`: with a user we already
                    // have a sign-in to attach the import to, so jump
                    // straight to the dialog. Without one we open the
                    // inline user-picker; it'll set the sticky-intent
                    // flag before sign-in so the dialog re-mounts on
                    // the post-sign-in surface.
                    if (currentUser) {
                      setElnImportOpen(true);
                    } else {
                      setPickUserForImportOpen(true);
                    }
                  }}
                />
                <a
                  href="/wiki/getting-started/labarchives-export"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200 underline"
                >
                  How to export from LabArchives →
                </a>
              </div>
            </div>
          </div>

          <div className="text-center mt-6 flex items-center justify-center gap-4">
            <button
              onClick={openBugReport}
              className="text-slate-500 hover:text-white text-xs transition-colors flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Report Bug
            </button>
            <BetaDonationButton variant="link" />
          </div>
        </div>

        <FeedbackModal
          isOpen={showBugReport}
          onClose={closeBugReport}
          prefilledError={currentError}
        />
        {elnImportOpen && (
          <ImportELNDialog
            isOpen={elnImportOpen}
            onClose={() => setElnImportOpen(false)}
          />
        )}
        <PickUserBeforeImportModal
          isOpen={pickUserForImportOpen}
          availableUsers={availableUsers}
          onPickUser={async (username) => {
            // Set the sticky-intent flag BEFORE sign-in: setCurrentUser
            // triggers the AppContent re-render that unmounts this
            // screen, so any post-state work has to be queued up to
            // run on the next surface. providers.tsx reads + clears
            // this flag on the signed-in branch.
            try {
              sessionStorage.setItem(ELN_IMPORT_PENDING_KEY, "1");
            } catch {
              // sessionStorage can throw in private-mode Safari. The
              // picker still closes; the import just won't re-open
              // automatically.
            }
            setPickUserForImportOpen(false);
            await setCurrentUser(username);
            onComplete();
          }}
          onCreateUser={async (username) => {
            // Same sticky-intent flow as onPickUser. We set the flag
            // before the createUser->setCurrentUser pair so it's in
            // place when AppContent re-renders us out.
            try {
              sessionStorage.setItem(ELN_IMPORT_PENDING_KEY, "1");
            } catch {
              // See onPickUser.
            }
            const ok = await createUser(username);
            if (!ok) {
              // Sign-in didn't happen — clear the flag so a stray
              // re-render doesn't open the dialog on a stale state.
              try {
                sessionStorage.removeItem(ELN_IMPORT_PENDING_KEY);
              } catch {
                // intentionally swallowed
              }
              return false;
            }
            setPickUserForImportOpen(false);
            await setCurrentUser(username);
            onComplete();
            return true;
          }}
          onClose={() => setPickUserForImportOpen(false)}
        />
      </div>
    );
  }

  if (needsInitialization) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="absolute inset-0 opacity-5">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }}
          />
        </div>

        <div className="relative z-10 w-full max-w-lg mx-4">
          <div className="text-center mb-8">
            {/* Brand mark: BeakerBot in the gradient pill, matching
                UserLoginScreen. Static, no liquid (white wireframe
                reads cleanly on the blue→purple gradient). */}
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg mb-4">
              <BeakerBot
                pose="idle"
                noLiquid
                ariaLabel="ResearchOS BeakerBot logo"
                className="w-8 h-8 text-white"
              />
            </div>
            <h1 className="text-3xl font-bold text-white">ResearchOS</h1>
            <p className="text-slate-400 mt-2">Connected to: {directoryName}</p>
          </div>

          <div className="bg-white/10 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20 overflow-hidden">
            <div className="p-6">
              <h2 className="text-xl font-bold text-white mb-4 text-center">
                Initialize New Folder
              </h2>
              <p className="text-slate-400 mb-6 text-center">
                This folder doesn&apos;t have the required structure. Would you like to initialize it as a ResearchOS folder?
              </p>

              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    const success = await initializeFolder();
                    if (success) {
                      setShowUserSelection(true);
                    }
                  }}
                  disabled={isLoading}
                  className="flex-1 py-3 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-medium rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isLoading ? (
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                  ) : (
                    "Initialize Folder"
                  )}
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="px-4 py-3 bg-white/10 hover:bg-white/20 text-white font-medium rounded-lg transition-all"
                >
                  Cancel
                </button>
              </div>

              {error && (
                <div className="mt-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg">
                  <p className="text-sm text-red-300">{error}</p>
                </div>
              )}
            </div>
          </div>

          <div className="text-center mt-6 flex items-center justify-center gap-4">
            <button
              onClick={openBugReport}
              className="text-slate-500 hover:text-white text-xs transition-colors flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Report Bug
            </button>
            <BetaDonationButton variant="link" />
          </div>
        </div>

        <FeedbackModal
          isOpen={showBugReport}
          onClose={closeBugReport}
          prefilledError={currentError}
        />
      </div>
    );
  }

  if (lastConnectedFolder) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="absolute inset-0 opacity-5">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }}
          />
        </div>

        <div className="relative z-10 w-full max-w-lg mx-4">
          <div className="text-center mb-8">
            {/* Brand mark: BeakerBot in the gradient pill, matching
                UserLoginScreen. Static, no liquid (white wireframe
                reads cleanly on the blue→purple gradient). */}
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg mb-4">
              <BeakerBot
                pose="idle"
                noLiquid
                ariaLabel="ResearchOS BeakerBot logo"
                className="w-8 h-8 text-white"
              />
            </div>
            <h1 className="text-3xl font-bold text-white">ResearchOS</h1>
            <p className="text-slate-400 mt-2">Local-first research data management</p>
          </div>

          <div className="bg-white/10 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20 overflow-hidden">
            <div className="p-6">
              <h2 className="text-xl font-bold text-white mb-4 text-center">
                Reconnect to <span className="text-blue-300">{lastConnectedFolder}</span>
              </h2>
              <p className="text-slate-300 mb-6 text-center">
                We remember the folder you picked last time. Continue to re-attach without going through the OS picker.
              </p>

              <button
                onClick={() => reconnectWithStoredHandle()}
                disabled={isLoading}
                className="w-full py-3 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-medium rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isLoading ? (
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                ) : (
                  <>
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Continue
                  </>
                )}
              </button>

              <button
                onClick={handleConnect}
                disabled={isLoading}
                className="w-full mt-3 py-2 text-sm text-slate-400 hover:text-white transition-colors disabled:opacity-50"
              >
                Pick a different folder
              </button>

              {error && (
                <div className="mt-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg">
                  <p className="text-sm text-red-300">{error}</p>
                </div>
              )}
            </div>
          </div>

          <div className="text-center mt-6 flex items-center justify-center gap-4">
            <button
              onClick={openBugReport}
              className="text-slate-500 hover:text-white text-xs transition-colors flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Report Bug
            </button>
            <BetaDonationButton variant="link" />
          </div>
        </div>

        <FeedbackModal
          isOpen={showBugReport}
          onClose={closeBugReport}
          prefilledError={currentError}
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="absolute inset-0 opacity-5">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-3xl mx-4">
        {/* Page title, centered. */}
        <h1 className="mb-8 text-center text-3xl font-bold text-white">
          Welcome to ResearchOS
        </h1>

        {/* BeakerBot side column. Grant 2026-05-25: must NOT shift the
            folder cards out of the page center. On lg+ this floats
            absolutely in the left margin (right-full + mr-6 anchors it
            outside the wrapper). On sm/md the absolute positioning
            classes drop, so it stacks vertically above the cards in
            normal flow. The proximity-wave hook means the cursor
            moving toward the cards passes near BeakerBot, triggering
            the wave + surfacing the walkthrough CTA. */}
        <div className="mb-6 flex flex-col items-center lg:fixed lg:top-6 lg:right-6 lg:left-auto lg:ml-0 lg:mb-0 lg:w-64 lg:z-40">
          <div
            className="mb-2 flex h-28 w-28 items-center justify-center"
            data-testid="picker-beakerbot"
          >
            <BeakerBot
              pose="waving"
              className="h-full w-full text-sky-300"
              ariaLabel="BeakerBot waving hello"
            />
          </div>
          {/* Square-ish speech bubble pointing up at BeakerBot. Capped
              at max-w-xs so it reads as a chat bubble, not a banner. */}
          <div className="relative w-full max-w-xs">
            <div
              aria-hidden
              className="absolute -top-2 left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 bg-white"
            />
            <div
              className="relative rounded-2xl bg-white px-3 py-3 text-center shadow-lg"
              data-testid="picker-welcome-bubble"
            >
              <p
                className="text-base font-medium leading-snug text-slate-800"
                data-testid="picker-welcome-copy"
              >
                New here? It is strongly recommended to take a short
                onboarding walkthrough (3 minutes). Returning? Just
                take it from here.
              </p>
            </div>
          </div>
          {/* Opt-in walkthrough CTA. Author + funding credit lives in
              the modal's first slide + the RISE stamp, not here. */}
          <button
            type="button"
            onClick={() => setWalkthroughOpen(true)}
            data-testid="picker-walkthrough-open"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-sky-500/15 px-4 py-2 text-sm font-semibold text-sky-100 border border-sky-300/40 transition-colors hover:bg-sky-500/25 hover:text-white hover:border-sky-300/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
          >
            <svg
              aria-hidden="true"
              className="h-3.5 w-3.5"
              viewBox="0 0 12 12"
              fill="currentColor"
            >
              <path d="M3 1.5v9l8-4.5-8-4.5z" />
            </svg>
            Take the 3-minute walkthrough
          </button>
        </div>

        {/* Folder picker cards: always in the natural centered flow
            of the max-w-3xl wrapper, unaffected by BeakerBot's
            absolute positioning. */}
        <div>
        <div className="grid md:grid-cols-2 gap-4">
          <div
            data-testid="link-folder-drop-zone"
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative bg-white/10 backdrop-blur-xl rounded-2xl shadow-2xl overflow-hidden transition-all ${
              isDragOver
                ? "border-2 border-dashed border-blue-400 bg-blue-500/15 ring-4 ring-blue-400/30"
                : "border-2 border-dashed border-white/25 hover:border-white/40"
            }`}
          >
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                  <svg
                    className="w-5 h-5 text-blue-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                    />
                  </svg>
                </div>
                <h2 className="text-lg font-bold text-white">Link Existing Folder</h2>
              </div>
              <p className="text-slate-400 text-sm mb-4">
                Connect to an existing ResearchOS folder with your projects and data. Perfect if you&apos;ve synced your folder via OneDrive or iCloud.
              </p>
              <p
                className={`text-xs mb-4 transition-colors ${
                  isDragOver ? "text-blue-200 font-medium" : "text-slate-500"
                }`}
              >
                {isDragOver
                  ? "Release to link this folder"
                  : "Drop your lab folder here, or click below to pick"}
              </p>
              <button
                onClick={handleConnect}
                disabled={isLoading}
                className="w-full py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isLoading ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    Link Folder
                  </>
                )}
              </button>
              {dropError && (
                <p
                  role="alert"
                  data-testid="link-folder-drop-error"
                  className="mt-3 text-xs text-red-300"
                >
                  {dropError}
                </p>
              )}
            </div>
          </div>

          <div className="bg-white/10 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20 overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                  <svg
                    className="w-5 h-5 text-purple-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                    />
                  </svg>
                </div>
                <h2 className="text-lg font-bold text-white">Create New Folder</h2>
              </div>
              <p className="text-slate-400 text-sm mb-4">
                Start fresh with a new ResearchOS folder. Enter a name and choose where to save it.
              </p>

              <div className="mb-4">
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  Folder Name
                </label>
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="e.g., SmithLab_ResearchOS"
                  className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                />
              </div>

              <button
                onClick={() => createNewFolder(newFolderName)}
                disabled={isLoading || !newFolderName.trim()}
                className="w-full py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-medium rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    Choose Location
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg max-w-3xl mx-auto">
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        <div className="mt-4 flex flex-col items-center gap-2">
          <Link
            href="/demo"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 hover:text-white border border-amber-300/40 hover:border-amber-300/70 rounded-lg text-sm font-semibold transition-colors"
          >
            <svg
              aria-hidden
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M14 5l7 7m0 0l-7 7m7-7H3"
              />
            </svg>
            Explore demo in browser
          </Link>
          <a
            href="/demo-lab.zip"
            className="text-xs text-slate-400 hover:text-amber-200 underline-offset-2 hover:underline transition-colors"
          >
            Or download as a starter folder
          </a>
          <p className="text-xs text-slate-500">
            An entirely fake yeast-lab dataset to explore the app with.
          </p>
        </div>

        <div className="text-center mt-6 flex items-center justify-center gap-4 flex-wrap">
          <a
            href="/wiki/getting-started/connecting-your-folder"
            className="text-slate-400 hover:text-white text-xs transition-colors flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="12" y1="17" x2="12.01" y2="17" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            New here? Read the setup guide
          </a>
          <a
            href="/wiki/shared-lab-accounts"
            className="text-slate-400 hover:text-white text-xs transition-colors flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-5.13a4 4 0 11-8 0 4 4 0 018 0zm6 0a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Sharing a folder with your lab?
          </a>
          <button
            onClick={openBugReport}
            className="text-slate-500 hover:text-white text-xs transition-colors flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Report Bug
          </button>
          <BetaDonationButton variant="link" />
        </div>
      </div>

      <FeedbackModal
        isOpen={showBugReport}
        onClose={closeBugReport}
        prefilledError={currentError}
      />

      {/* Persistent RISE credentials stamp in the bottom-right corner.
          Authority signal: "real academic project, not a data-harvesting
          scheme." Rehomed from the retired pre-onboarding modal
          2026-05-25. */}
      <RiseCredentialsStamp />

      {/* Opt-in walkthrough modal (controlled). Renders nothing while
          closed, so the picker stays as the persistent landing. The
          modal does not link a folder; on close the user returns to
          this picker. */}
      <PickerWalkthroughModal
        open={walkthroughOpen}
        onClose={() => setWalkthroughOpen(false)}
      />
    </div>
  );
}

function ImportFromELNButton({ onOpen }: { onOpen: () => void }) {
  // No-user gating used to wrap this in a `Sign in to a user first.`
  // Tooltip + disabled state. That dead-ended the user: signing in
  // navigated away from this screen so the button was never reachable
  // in its enabled form. The click handler now branches on currentUser
  // upstream — without a user it opens the inline picker modal, with
  // one it opens the import dialog directly.
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="import-eln-cta"
      className="w-full px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-500/50 rounded-lg text-white text-sm font-medium transition-all"
    >
      Import from LabArchives
    </button>
  );
}
