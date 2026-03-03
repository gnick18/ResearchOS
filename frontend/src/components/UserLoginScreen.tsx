"use client";

import { useState, useEffect, useRef } from "react";
import { usersApi } from "@/lib/api";

interface UserLoginScreenProps {
  onLogin: () => void;
}

export default function UserLoginScreen({ onLogin }: UserLoginScreenProps) {
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

  const handleLogin = async (username: string) => {
    setLoggingIn(username);
    setError(null);
    try {
      await usersApi.login(username);
      onLogin();
    } catch (err) {
      setError("Failed to login. Please try again.");
      setLoggingIn(null);
    }
  };

  const handleLabModeLogin = async () => {
    setLoggingIn("lab");
    setError(null);
    try {
      await usersApi.login("lab");
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
                            <button
                              onClick={(e) => handleSetMainUser(user, e)}
                              disabled={loggingIn !== null}
                              className="p-2 opacity-0 group-hover:opacity-100 hover:bg-amber-500/20 rounded-lg text-slate-400 hover:text-amber-400 transition-all"
                              title="Set as main user (default when exiting lab mode)"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                              </svg>
                            </button>
                          )}
                          
                          {/* Edit button */}
                          <button
                            onClick={(e) => startEdit(user, e)}
                            disabled={loggingIn !== null}
                            className="p-2 opacity-0 group-hover:opacity-100 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-all"
                            title="Rename user"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          
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
    </div>
  );
}
