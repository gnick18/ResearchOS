"use client";

import { useState, useEffect, useRef } from "react";
import { usersApi } from "@/lib/local-api";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { hasPassword, verifyPassword } from "@/lib/auth/password";
import AccountPasswordPopup from "@/components/AccountPasswordPopup";

interface UserLoginScreenProps {
  onLogin: () => void;
}

export default function UserLoginScreen({ onLogin }: UserLoginScreenProps) {
  const { setCurrentUser } = useFileSystem();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<string[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState<string | null>(null);
  const [mainUser, setMainUser] = useState<string | null>(null);
  
  // Edit mode state
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);
  
  // Delete user state
  const [deleteUserSelected, setDeleteUserSelected] = useState<string | null>(null);
  const [deleteUserArchive, setDeleteUserArchive] = useState(true);
  const [isDeletingUser, setIsDeletingUser] = useState(false);
  const [isArchivingUser, setIsArchivingUser] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmStep, setDeleteConfirmStep] = useState(0);

  // Password gate state — populated when a protected user is clicked
  const [passwordGate, setPasswordGate] = useState<{
    username: string;
    nextAction: "user" | "lab";
  } | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [verifyingPassword, setVerifyingPassword] = useState(false);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  // Per-user password management popup (set/change/remove)
  const [managingPasswordFor, setManagingPasswordFor] = useState<string | null>(null);

  // Per-user password-set status — drives the lock icon's appearance.
  // Loaded after the user list comes back, refreshed after the password popup closes.
  const [lockedUsers, setLockedUsers] = useState<Set<string>>(new Set());

  const refreshLockStatus = async (usernames: string[]) => {
    const next = new Set<string>();
    await Promise.all(
      usernames.map(async (u) => {
        try {
          if (await hasPassword(u)) next.add(u);
        } catch {
          // If we can't read, treat as unlocked rather than crashing the screen.
        }
      })
    );
    setLockedUsers(next);
  };

  useEffect(() => {
    if (users.length > 0) {
      refreshLockStatus(users.filter((u) => u !== "lab"));
    }
  }, [users]);

  useEffect(() => {
    if (passwordGate && passwordInputRef.current) {
      passwordInputRef.current.focus();
    }
  }, [passwordGate]);

  useEffect(() => {
    loadUsers();
  }, []);

  // Focus input when entering edit mode
  useEffect(() => {
    if (editingUser && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingUser]);

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersResponse, mainUserResponse] = await Promise.all([
        usersApi.list(),
        usersApi.getMainUser()
      ]);
      setUsers(usersResponse.users);
      setMainUser(mainUserResponse.main_user || null);
    } catch (err) {
      setError("Failed to load users. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const performLogin = async (username: string) => {
    try {
      await usersApi.login(username);
      await setCurrentUser(username);
      onLogin();
    } catch (err) {
      setError("Failed to login. Please try again.");
      setLoggingIn(null);
    }
  };

  const handleLogin = async (username: string) => {
    setLoggingIn(username);
    setError(null);
    try {
      const gated = await hasPassword(username);
      if (gated) {
        setPasswordGate({ username, nextAction: "user" });
        setPasswordInput("");
        return;
      }
    } catch {
      // If we can't read the auth file, fall through to normal login —
      // safer than locking the user out due to a transient FS error.
    }
    await performLogin(username);
  };

  const handleSubmitPassword = async () => {
    if (!passwordGate) return;
    setError(null);
    setVerifyingPassword(true);
    try {
      const ok = await verifyPassword(passwordGate.username, passwordInput);
      if (!ok) {
        setError("Incorrect password.");
        setVerifyingPassword(false);
        return;
      }
      const { username } = passwordGate;
      setPasswordGate(null);
      setPasswordInput("");
      setVerifyingPassword(false);
      await performLogin(username);
    } catch {
      setError("Failed to verify password. Please try again.");
      setVerifyingPassword(false);
    }
  };

  const cancelPasswordGate = () => {
    setPasswordGate(null);
    setPasswordInput("");
    setVerifyingPassword(false);
    setLoggingIn(null);
    setError(null);
  };

  const handleLabModeLogin = async () => {
    setLoggingIn("lab");
    setError(null);
    try {
      await usersApi.login("lab");
      await setCurrentUser("lab");
      onLogin();
    } catch (err) {
      setError("Failed to enter Lab Mode. Please try again.");
      setLoggingIn(null);
    }
  };

  const handleCreateUser = async () => {
    const username = newUsername.trim();
    if (!username) {
      setError("Please enter a username");
      return;
    }

    // Validate username format
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setError("Username can only contain letters, numbers, and underscores");
      return;
    }

    setLoggingIn("creating");
    setError(null);
    try {
      await usersApi.create(username);
      await setCurrentUser(username);
      onLogin();
    } catch (err) {
      setError("Failed to create user. Please try again.");
      setLoggingIn(null);
    }
  };

  const startEdit = (user: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingUser(user);
    setEditValue(user);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingUser(null);
    setEditValue("");
    setError(null);
  };

  const handleRename = async (oldUsername: string) => {
    const newUsername = editValue.trim();
    
    // Validate
    if (!newUsername) {
      setError("Username cannot be empty");
      return;
    }
    
    if (!/^[a-zA-Z0-9_]+$/.test(newUsername)) {
      setError("Username can only contain letters, numbers, and underscores");
      return;
    }
    
    // If no change, just cancel
    if (newUsername === oldUsername) {
      cancelEdit();
      return;
    }
    
    setRenaming(true);
    setError(null);
    
    try {
      await usersApi.rename(oldUsername, newUsername);
      // Update local state
      setUsers(users.map(u => u === oldUsername ? newUsername : u));
      // Update main user if the renamed user was the main user
      if (mainUser === oldUsername) {
        setMainUser(newUsername);
      }
      setEditingUser(null);
      setEditValue("");
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      const detail = error?.response?.data?.detail;
      setError(detail || "Failed to rename user. Please try again.");
    } finally {
      setRenaming(false);
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent, oldUsername: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleRename(oldUsername);
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  };

  const handleSetMainUser = async (username: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await usersApi.setMainUser(username);
      setMainUser(username);
    } catch (err) {
      console.error("Failed to set main user:", err);
    }
  };

  const startDelete = (user: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteUserSelected(user);
    setDeleteUserArchive(true);
    setShowDeleteConfirm(true);
    setDeleteConfirmStep(1);
    setError(null);
  };

  const cancelDelete = () => {
    setDeleteUserSelected(null);
    setShowDeleteConfirm(false);
    setDeleteConfirmStep(0);
    setError(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteUserSelected) return;
    
    if (deleteConfirmStep === 1) {
      // Step 1: Archive if requested, then move to step 2
      if (deleteUserArchive) {
        setIsArchivingUser(true);
        setError(null);
        try {
          const blob = await usersApi.archive(deleteUserSelected);
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${deleteUserSelected}_archive.zip`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
        } catch (err: unknown) {
          console.error("Archive error:", err);
          const errorMessage = err instanceof Error ? err.message : 
            (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to archive user data";
          setError(`Archive failed: ${errorMessage}. You can uncheck "Archive data" to proceed without backup.`);
          setIsArchivingUser(false);
          return;
        }
        setIsArchivingUser(false);
      }
      
      // Move to step 2 (final confirmation)
      setDeleteConfirmStep(2);
      return;
    }
    
    if (deleteConfirmStep === 2) {
      // Step 2: Execute deletion
      setIsDeletingUser(true);
      setError(null);
      
      try {
        await usersApi.delete(deleteUserSelected, 1, true);
        await usersApi.delete(deleteUserSelected, 2, true);
        
        // Remove from local state
        setUsers(users.filter(u => u !== deleteUserSelected));
        if (mainUser === deleteUserSelected) {
          setMainUser(null);
        }
        
        cancelDelete();
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 
          (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to delete user";
        setError(errorMessage);
      } finally {
        setIsDeletingUser(false);
      }
    }
  };

  // Check if there are any users (excluding 'lab' user if present)
  const hasUsers = users.filter(u => u !== 'lab').length > 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute inset-0" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }} />
      </div>

      <div className="relative z-10 w-full max-w-md mx-4">
        {/* Logo and title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg mb-4">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">ResearchOS</h1>
          <p className="text-slate-400">Select your profile to continue</p>
        </div>

        {/* Main card */}
        <div className="bg-white/10 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            </div>
          ) : showCreateForm ? (
            <div className="p-6">
              <button
                onClick={() => setShowCreateForm(false)}
                className="flex items-center gap-2 text-slate-400 hover:text-white mb-4 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to users
              </button>

              <h2 className="text-xl font-semibold text-white mb-4">Create New User</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">
                    Username
                  </label>
                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreateUser()}
                    placeholder="Enter your username"
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    autoFocus
                  />
                  <p className="text-xs text-slate-400 mt-1.5">
                    Letters, numbers, and underscores only
                  </p>
                </div>

                {error && (
                  <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg">
                    <p className="text-sm text-red-300">{error}</p>
                  </div>
                )}

                <button
                  onClick={handleCreateUser}
                  disabled={loggingIn !== null}
                  className="w-full py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-medium rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loggingIn === "creating" ? (
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      Create & Login
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="p-6">
              {/* Error message */}
              {error && (
                <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg">
                  <p className="text-sm text-red-300">{error}</p>
                </div>
              )}

              {/* User list */}
              <div className="space-y-2 mb-4">
                {users.filter(u => u !== 'lab').length === 0 ? (
                  <p className="text-center text-slate-400 py-4">
                    No users found. Create a new user to get started.
                  </p>
                ) : (
                  users.filter(u => u !== 'lab').map((user) => (
                    <div key={user} className="relative">
                      {editingUser === user ? (
                        // Edit mode
                        <div className="flex items-center gap-2 p-3 bg-white/10 border border-blue-500/50 rounded-xl">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-semibold flex-shrink-0">
                            {editValue.charAt(0).toUpperCase() || user.charAt(0).toUpperCase()}
                          </div>
                          <input
                            ref={editInputRef}
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => handleEditKeyDown(e, user)}
                            disabled={renaming}
                            className="flex-1 px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            maxLength={50}
                          />
                          <button
                            onClick={() => handleRename(user)}
                            disabled={renaming}
                            className="p-2 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 rounded-lg text-green-400 hover:text-green-300 transition-all disabled:opacity-50"
                            title="Save"
                          >
                            {renaming ? (
                              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-green-400"></div>
                            ) : (
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                          <button
                            onClick={cancelEdit}
                            disabled={renaming}
                            className="p-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg text-red-400 hover:text-red-300 transition-all disabled:opacity-50"
                            title="Cancel"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ) : (
                        // Normal view - using div to avoid nested button hydration error
                        <div
                          onClick={() => loggingIn === null && handleLogin(user)}
                          className={`w-full flex items-center gap-3 p-4 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl transition-all group cursor-pointer ${
                            loggingIn !== null ? 'opacity-50 cursor-not-allowed' : ''
                          }`}
                        >
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-semibold relative">
                            {user.charAt(0).toUpperCase()}
                            {mainUser === user && (
                              <div className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 rounded-full flex items-center justify-center">
                                <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                </svg>
                              </div>
                            )}
                          </div>
                          <div className="flex-1 text-left">
                            <span className="text-white font-medium">{user}</span>
                            {mainUser === user && (
                              <span className="ml-2 text-xs text-amber-400 font-normal">(Main)</span>
                            )}
                          </div>
                          
                          {/* Set as Main button */}
                          {mainUser !== user && (
                            <div className="relative group/icon">
                              <button
                                onClick={(e) => handleSetMainUser(user, e)}
                                disabled={loggingIn !== null}
                                className="p-2 opacity-0 group-hover:opacity-100 hover:bg-amber-500/20 rounded-lg text-slate-400 hover:text-amber-400 transition-all"
                                aria-label="Set as main user"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                                </svg>
                              </button>
                              <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-1 whitespace-nowrap px-2 py-1 text-[10px] font-medium rounded bg-slate-900/95 text-slate-100 border border-white/10 opacity-0 group-hover/icon:opacity-100 transition-opacity z-10">
                                Set as main
                              </span>
                            </div>
                          )}

                          {/* Edit button */}
                          <div className="relative group/icon">
                            <button
                              onClick={(e) => startEdit(user, e)}
                              disabled={loggingIn !== null}
                              className="p-2 opacity-0 group-hover:opacity-100 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-all"
                              aria-label="Rename user"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                            </button>
                            <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-1 whitespace-nowrap px-2 py-1 text-[10px] font-medium rounded bg-slate-900/95 text-slate-100 border border-white/10 opacity-0 group-hover/icon:opacity-100 transition-opacity z-10">
                              Rename
                            </span>
                          </div>

                          {/* Password button — visible-always when locked, hover-only when unlocked */}
                          <div className="relative group/icon">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setManagingPasswordFor(user);
                              }}
                              disabled={loggingIn !== null}
                              className={`p-2 rounded-lg transition-all ${
                                lockedUsers.has(user)
                                  ? "text-amber-300 hover:bg-amber-500/20 hover:text-amber-200"
                                  : "opacity-0 group-hover:opacity-100 text-slate-400 hover:bg-white/10 hover:text-white"
                              }`}
                              aria-label={lockedUsers.has(user) ? "Password protected — manage" : "Set account password"}
                            >
                              {lockedUsers.has(user) ? (
                                // Closed padlock
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                </svg>
                              ) : (
                                // Open padlock
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                                </svg>
                              )}
                            </button>
                            <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-1 whitespace-nowrap px-2 py-1 text-[10px] font-medium rounded bg-slate-900/95 text-slate-100 border border-white/10 opacity-0 group-hover/icon:opacity-100 transition-opacity z-10">
                              {lockedUsers.has(user) ? "Password set — manage" : "Set password"}
                            </span>
                          </div>

                          {/* Delete button */}
                          <div className="relative group/icon">
                            <button
                              onClick={(e) => startDelete(user, e)}
                              disabled={loggingIn !== null}
                              className="p-2 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 rounded-lg text-slate-400 hover:text-red-400 transition-all"
                              aria-label="Delete user"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                            <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-1 whitespace-nowrap px-2 py-1 text-[10px] font-medium rounded bg-slate-900/95 text-slate-100 border border-white/10 opacity-0 group-hover/icon:opacity-100 transition-opacity z-10">
                              Delete user
                            </span>
                          </div>
                          
                          {loggingIn === user ? (
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                          ) : (
                            <svg className="w-5 h-5 text-slate-400 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Divider */}
              {users.filter(u => u !== 'lab').length > 0 && (
                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-white/10"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-transparent text-slate-400">or</span>
                  </div>
                </div>
              )}

              {/* Create new user button */}
              <button
                onClick={() => setShowCreateForm(true)}
                disabled={loggingIn !== null}
                className="w-full flex items-center justify-center gap-2 py-3 border border-dashed border-white/20 hover:border-white/40 rounded-xl text-slate-300 hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Create New User
              </button>

              {/* Lab Mode button */}
              <div className="mt-4">
                <button
                  onClick={handleLabModeLogin}
                  disabled={loggingIn !== null || !hasUsers}
                  title={!hasUsers ? "No users exist yet" : ""}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-emerald-500/20 to-teal-500/20 hover:from-emerald-500/30 hover:to-teal-500/30 border border-emerald-500/30 hover:border-emerald-500/50 rounded-xl text-emerald-300 hover:text-emerald-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  {loggingIn === "lab" ? (
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-emerald-300"></div>
                  ) : (
                    <span>Lab Mode</span>
                  )}
                  {!hasUsers && (
                    <span className="text-xs text-slate-500">(No users yet)</span>
                  )}
                </button>
                <p className="text-center text-slate-500 text-xs mt-2">
                  View all researchers&apos; work (read-only)
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-slate-500 text-sm mt-6">
          Your data is stored locally and synced to your private repository
        </p>
      </div>

      {/* Delete User Confirmation Modal */}
      {deleteUserSelected && showDeleteConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-slate-800 rounded-2xl shadow-2xl border border-white/20 max-w-md w-full mx-4 overflow-hidden">
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-white mb-2">
                    Delete User Profile
                  </h3>
                  {deleteConfirmStep === 1 ? (
                    <p className="text-slate-300 text-sm">
                      Are you sure you want to delete <span className="font-semibold text-white">{deleteUserSelected}</span>? This action cannot be undone.
                    </p>
                  ) : (
                    <p className="text-slate-300 text-sm">
                      Final confirmation: Permanently delete <span className="font-semibold text-white">{deleteUserSelected}</span>?
                    </p>
                  )}
                </div>
              </div>

              {deleteConfirmStep === 1 && (
                <div className="mt-4 p-3 bg-slate-700/50 rounded-lg">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={deleteUserArchive}
                      onChange={(e) => setDeleteUserArchive(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-500 bg-slate-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                    />
                    <span className="text-sm text-slate-300">
                      Archive data before deletion (recommended)
                    </span>
                  </label>
                </div>
              )}

              {error && (
                <div className="mt-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg">
                  <p className="text-sm text-red-300">{error}</p>
                </div>
              )}

              {isArchivingUser && (
                <div className="mt-4 p-3 bg-blue-500/20 rounded-lg flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400"></div>
                  <span className="text-sm text-blue-300">Creating archive...</span>
                </div>
              )}

              {isDeletingUser && (
                <div className="mt-4 p-3 bg-red-500/20 rounded-lg flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-400"></div>
                  <span className="text-sm text-red-300">Deleting user...</span>
                </div>
              )}

              <div className="mt-6 flex gap-3">
                <button
                  onClick={cancelDelete}
                  disabled={isArchivingUser || isDeletingUser}
                  className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDelete}
                  disabled={isArchivingUser || isDeletingUser}
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {deleteConfirmStep === 1 ? (
                    "Continue"
                  ) : (
                    "Delete Permanently"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Password gate — shown when a protected user is clicked */}
      {passwordGate && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={cancelPasswordGate}
        >
          <div
            className="bg-slate-800 rounded-2xl shadow-2xl border border-white/20 max-w-sm w-full mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-white/10">
              <h3 className="text-lg font-semibold text-white">Enter password</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Sign in to {passwordGate.username}
              </p>
            </div>
            <div className="px-6 py-5 space-y-3">
              <input
                ref={passwordInputRef}
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmitPassword();
                  if (e.key === "Escape") cancelPasswordGate();
                }}
                disabled={verifyingPassword}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                autoComplete="current-password"
                placeholder="Password"
              />
              {error && (
                <div className="p-2 bg-red-500/20 border border-red-500/30 rounded-lg">
                  <p className="text-xs text-red-300">{error}</p>
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={cancelPasswordGate}
                  disabled={verifyingPassword}
                  className="flex-1 py-2 text-sm bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 rounded-lg disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmitPassword}
                  disabled={verifyingPassword || !passwordInput}
                  className="flex-1 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg disabled:opacity-50"
                >
                  {verifyingPassword ? "Verifying..." : "Sign in"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Account password management popup */}
      {managingPasswordFor && (
        <AccountPasswordPopup
          username={managingPasswordFor}
          onClose={() => {
            setManagingPasswordFor(null);
            // Re-read auth files so the lock icon flips immediately if the
            // user set or removed a password. Cheap on a small user list.
            refreshLockStatus(users.filter((u) => u !== "lab"));
          }}
        />
      )}
    </div>
  );
}
