"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useFileSystem, isFileSystemAccessSupported } from "@/lib/file-system/file-system-context";
import BetaDonationButton from "@/components/BetaDonationButton";
import FeedbackModal from "@/components/FeedbackModal";
import ImportELNDialog from "@/components/import-eln/ImportELNDialog";
import Tooltip from "@/components/Tooltip";
import UserAvatar from "@/components/UserAvatar";
import BeakerBot from "@/components/BeakerBot";
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
                  hasUser={Boolean(currentUser)}
                  onOpen={() => setElnImportOpen(true)}
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
        {/* BeakerBot-led welcome. The mascot lives inline on the picker
            page (no modal takeover) and uses the `waving` pose, which
            has a CSS keyframe animation built in, so he waves
            continuously as a friendly entry signal. Click him and a
            pink heart pops (the default easter egg since 2026-05-25 when
            tickle was retired). The sky-blue color matches the canonical
            BeakerBot palette used elsewhere in the app. Rehomed from the
            retired pre-onboarding modal 2026-05-25; salvages the
            WelcomeBeat copy (author + funding line) into a two-line
            welcome alongside the mascot. */}
        <div className="text-center mb-8">
          <div
            className="mx-auto mb-3 flex h-28 w-28 items-center justify-center"
            data-testid="picker-beakerbot"
          >
            <BeakerBot
              pose="waving"
              className="h-full w-full text-sky-300"
              ariaLabel="BeakerBot waving hello"
            />
          </div>
          <h1 className="text-3xl font-bold text-white">
            Welcome to ResearchOS
          </h1>
          <p
            className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-slate-300"
            data-testid="picker-welcome-copy"
          >
            A free and open source digital lab notebook built by Dr. Grant
            R. Nickles (PhD) and funded in part by the UW-Madison RISE
            Initiative.
          </p>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">
            New here? After you link your folder, I&apos;ll walk you
            through every page. Returning? Just take it from here.
          </p>
        </div>

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
    </div>
  );
}

function ImportFromELNButton({
  hasUser,
  onOpen,
}: {
  hasUser: boolean;
  onOpen: () => void;
}) {
  const button = (
    <button
      type="button"
      onClick={hasUser ? onOpen : undefined}
      disabled={!hasUser}
      className="w-full px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-500/50 rounded-lg text-white text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white/5 disabled:hover:border-white/10"
    >
      Import from LabArchives
    </button>
  );
  if (hasUser) return button;
  return (
    <Tooltip label="Sign in to a user first." placement="top">
      <span className="block">{button}</span>
    </Tooltip>
  );
}
