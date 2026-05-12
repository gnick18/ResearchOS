"use client";

import { useState, useEffect } from "react";
import { useFileSystem, isFileSystemAccessSupported } from "@/lib/file-system/file-system-context";
import BetaDonationButton from "@/components/BetaDonationButton";
import BugReportModal from "@/components/BugReportModal";
import { useErrorReporting } from "@/hooks/useErrorReporting";

interface ResearchFolderSetupProps {
  onComplete: () => void;
}

export default function ResearchFolderSetup({ onComplete }: ResearchFolderSetupProps) {
  const {
    connect,
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
  const { showBugReport, currentError, openBugReport, closeBugReport } = useErrorReporting();

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
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
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
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg mb-4">
              <svg
                className="w-8 h-8 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
                />
              </svg>
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
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold">
                          {user.charAt(0).toUpperCase()}
                        </div>
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

        <BugReportModal
          isOpen={showBugReport}
          onClose={closeBugReport}
          prefilledError={currentError}
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
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg mb-4">
              <svg
                className="w-8 h-8 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
                />
              </svg>
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

        <BugReportModal
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
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg mb-4">
              <svg
                className="w-8 h-8 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
                />
              </svg>
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

        <BugReportModal
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
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg mb-4">
            <svg
              className="w-8 h-8 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
              />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white">ResearchOS</h1>
          <p className="text-slate-400 mt-2">Local-first research data management</p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-white/10 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20 overflow-hidden">
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
              <p className="text-slate-400 text-sm mb-6">
                Connect to an existing ResearchOS folder with your projects and data. Perfect if you&apos;ve synced your folder via OneDrive or iCloud.
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

      <BugReportModal
        isOpen={showBugReport}
        onClose={closeBugReport}
        prefilledError={currentError}
      />
    </div>
  );
}
