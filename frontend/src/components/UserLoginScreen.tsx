"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usersApi } from "@/lib/local-api";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { hasPassword, verifyPassword } from "@/lib/auth/password";
import { performUserDelete } from "@/lib/users/perform-delete";
import { readUserSettings } from "@/lib/settings/user-settings";
import { readArchivedSet } from "@/lib/lab/user-archive";
import {
  createUserMetadataEntry,
  readAllUserMetadata,
  suggestInitialColorForNewUser,
} from "@/lib/file-system/user-metadata";
import { otherUsersOnlyAsync } from "@/lib/file-system/user-color-collisions";
import { USER_COLOR_QUERY_KEY } from "@/hooks/useUserColor";
import type { UserMetadataEntry } from "@/lib/file-system/user-metadata";
import AccountPasswordPopup from "@/components/AccountPasswordPopup";
import BetaDonationButton from "@/components/BetaDonationButton";
import FeedbackModal from "@/components/FeedbackModal";
import UserAvatar from "@/components/UserAvatar";
import UserColorPickerPopup from "@/components/UserColorPickerPopup";
import Tooltip from "@/components/Tooltip";
import BeakerBot from "@/components/BeakerBot";
import DevForceWalkthroughButton from "@/components/DevForceWalkthroughButton";
import { useErrorReporting } from "@/hooks/useErrorReporting";

interface UserLoginScreenProps {
  onLogin: () => void;
}

export default function UserLoginScreen({ onLogin }: UserLoginScreenProps) {
  const { setCurrentUser, currentUser: contextCurrentUser } = useFileSystem();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<string[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState<string | null>(null);
  const [mainUser, setMainUser] = useState<string | null>(null);

  // Color-picker popup state — opened after the user types a username and
  // clicks "Create & Login" so they can confirm (or replace) the random
  // palette color we'd otherwise assign silently. We hold the
  // pre-computed default + the metadata snapshot so the popup can render
  // collision-aware swatches without re-reading the file. `pickerOpen`
  // distinguishes "we're computing the default" (busy spinner on the
  // Create button) from "popup is mounted" (popup is interactive).
  const [colorPicker, setColorPicker] = useState<{
    username: string;
    defaultColor: string;
    otherUsers: Record<string, UserMetadataEntry>;
  } | null>(null);
  
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
    nextAction: "user";
  } | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [verifyingPassword, setVerifyingPassword] = useState(false);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  // Per-user password management popup (set/change/remove)
  const [managingPasswordFor, setManagingPasswordFor] = useState<string | null>(null);

  // Per-user password-set status — drives the lock icon's appearance.
  // Loaded after the user list comes back, refreshed after the password popup closes.
  const [lockedUsers, setLockedUsers] = useState<Set<string>>(new Set());

  // Per-user `account_type` (Lab Head Phase 1). Drives both the PI badge
  // on lab_head tiles and the sort order (lab heads to the top). Loaded
  // alongside the user list; users we couldn't read settings for fall
  // back to "member" so they never appear elevated by accident.
  // Mirror of the lockedUsers pattern: fan-out read per user.
  const [labHeadUsers, setLabHeadUsers] = useState<Set<string>>(new Set());

  // Per-user `archived` flag (Lab Head Phase 6). Drives the "hidden by
  // default" visibility of archived accounts; the Show archived toggle
  // below the user grid reveals them. Loaded alongside the lab_head
  // status — fan-out read per user via readArchivedSet. A read failure
  // leaves the user out of the set (i.e. defaults to non-archived) so
  // a corrupt sidecar can never accidentally hide an active member.
  const [archivedUsers, setArchivedUsers] = useState<Set<string>>(new Set());
  // Toggle state — false by default per design decision #2 (Grant
  // 2026-05-23): archived users hidden by default, the toggle is the
  // "temporary returner" escape hatch so they can re-login without
  // bugging the PI.
  const [showArchived, setShowArchived] = useState(false);

  // Bug report state
  const { showBugReport, currentError, openBugReport, closeBugReport } = useErrorReporting();

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

  // Fan-out read of every user's settings.json to find lab_head accounts.
  // Mirrors the `refreshLockStatus` shape — a failed read leaves the user
  // out of the set (i.e. defaults to member), which is the safe choice
  // since elevating to lab_head by accident would be misleading. The PI
  // badge + sort tier both key off this set.
  const refreshLabHeadStatus = async (usernames: string[]) => {
    const next = new Set<string>();
    await Promise.all(
      usernames.map(async (u) => {
        try {
          const settings = await readUserSettings(u);
          if (settings.account_type === "lab_head") next.add(u);
        } catch {
          // Treat as member on read failure — never accidentally elevate.
        }
      })
    );
    setLabHeadUsers(next);
  };

  // Lab Head Phase 6: fan-out read of every user's `_onboarding.json` to
  // find archived accounts. Mirrors the lab_head fan-out — a per-user
  // read failure drops that user into the non-archived tier so a broken
  // sidecar can never accidentally hide an active member.
  const refreshArchivedStatus = async (usernames: string[]) => {
    try {
      const set = await readArchivedSet(usernames);
      setArchivedUsers(set);
    } catch {
      // Whole-batch failure — treat as none-archived. Safe default.
      setArchivedUsers(new Set());
    }
  };

  useEffect(() => {
    if (users.length > 0) {
      refreshLockStatus(users);
      refreshLabHeadStatus(users);
      refreshArchivedStatus(users);
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
    } catch {
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
    } catch {
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

    // Refuse if the name collides with an existing user. Without this
    // check the color picker would briefly mount for a name that
    // `usersApi.create` would then silently overwrite/login as. The
    // picker isn't the right surface to surface the collision message.
    if (users.includes(username)) {
      setError(`User '${username}' already exists. Pick a different name.`);
      return;
    }

    // Compute the random palette default for the popup. We snapshot the
    // metadata BEFORE opening so the popup's "Used by <name>" tooltips
    // reflect what's actually on disk (not a stale cached map). The
    // snapshot is cheap — _user_metadata.json is a single small JSON
    // file.
    setLoggingIn("creating");
    setError(null);
    try {
      const meta = await readAllUserMetadata();
      // The new user isn't in the map yet — `otherUsersOnlyAsync` also
      // strips tombstoned AND Phase 6 archived users so freed-up
      // palette slots become available again (Mira Batch 1 polish,
      // 2026-05-23).
      const others = await otherUsersOnlyAsync(meta, username);
      const defaultColor = suggestInitialColorForNewUser(username, others);
      setColorPicker({ username, defaultColor, otherUsers: others });
      // Keep the Create button in its busy state while the popup is up
      // so a re-click doesn't double-mount.
    } catch (err) {
      console.error("Failed to prep color picker:", err);
      // Fall back to the silent create path if the metadata snapshot
      // fails — the user still gets a usable account; their color just
      // comes from the deterministic hash. Better than blocking
      // creation entirely on a metadata read hiccup.
      try {
        await usersApi.create(username);
        await setCurrentUser(username);
        onLogin();
      } catch {
        setError("Failed to create user. Please try again.");
        setLoggingIn(null);
      }
    }
  };

  // Color picker accepted — persist the chosen color BEFORE
  // usersApi.create so by the time the new user logs in, every
  // UserAvatar that resolves them already finds a stored entry (the
  // render path prefers stored over the username hash). This is the
  // anchor that survives later renames: the rename helper migrates
  // _user_metadata.json so the entry travels with the user, and from
  // there `useUserColors` reads the same persisted swatch the user
  // accepted at creation time. The original "rename re-rolled my color"
  // bug was that no entry ever got written at creation, so the avatar
  // fell back to `fallbackColorForUsername(username)` which IS
  // username-hashed and DOES change on rename.
  const handleColorPickerAccept = async (
    color: string,
    colorSecondary: string | null,
  ) => {
    if (!colorPicker) return;
    const { username } = colorPicker;
    try {
      // 1. Persist the chosen color first. If this fails, we abort
      //    creation rather than ending up with a user-with-no-color.
      //    `colorSecondary` is non-null when the user opted into the
      //    2-stop gradient via the popup's optional second-color row.
      await createUserMetadataEntry(username, color, colorSecondary);

      // 2. Bust the user-color cache so any avatar that re-renders
      //    after login picks up the new entry without a stale read.
      queryClient.invalidateQueries({ queryKey: USER_COLOR_QUERY_KEY });

      // 3. Finalize user creation (storeCurrentUser).
      await usersApi.create(username);
      await setCurrentUser(username);

      setColorPicker(null);
      onLogin();
    } catch (err) {
      console.error("Failed to finalize user creation:", err);
      setError("Failed to create user. Please try again.");
      setColorPicker(null);
      setLoggingIn(null);
    }
  };

  const handleColorPickerCancel = () => {
    // No bytes were written yet — just dismiss and return the user to
    // the form so they can either retry or back out entirely. We also
    // clear the busy state on the Create button.
    setColorPicker(null);
    setLoggingIn(null);
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
      // usersApi.rename throws plain Error objects (collision, validation,
      // FS-disconnect). Surface `.message` first so the user sees the
      // friendly "Username 'foo' is already in use" string rather than a
      // generic "Failed to rename" fallback. The older `response.data.detail`
      // path is kept as a secondary lookup for the obsolete server-error
      // shape; harmless when absent.
      const message =
        err instanceof Error
          ? err.message
          : (err as { response?: { data?: { detail?: string } } })?.response
              ?.data?.detail;
      setError(message || "Failed to rename user. Please try again.");
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
        // Persistence layer extracted to a pure module so the dangerous
        // branching (when-to-clear-currentUser, when-to-clear-mainUser) is
        // unit-testable. See lib/users/perform-delete.ts + its test file
        // for coverage of every branch — pinning fix 7ac7a9ab against
        // future silent regressions.
        await performUserDelete(deleteUserSelected, {
          currentUser: contextCurrentUser,
          mainUser,
          deleteUser: usersApi.delete,
          setCurrentUser,
          setMainUserPersisted: usersApi.setMainUser,
        });

        // Local UI state only — the picker list refreshes, and this
        // component's own mainUser mirror clears. Persistence already
        // happened inside performUserDelete.
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

  // Tile sort order (Lab Head Phase 1 polish + Phase 6 archive):
  //   1. Active (non-archived) lab_head users (Main first)
  //   2. Active member users (Main first)
  //   3. Archived lab_head users (only shown when showArchived === true)
  //   4. Archived member users (only shown when showArchived === true)
  //   5. Alphabetical by username within each tier
  //
  // PI prominence wins over Main within the active tier — the live lab
  // head's tile is always at the very top, even if some other account
  // is flagged Main. Archived users go to the very bottom regardless of
  // role/main status; the visual "Archived" badge handles distinction.
  const sortedActiveUsers = useMemo(() => {
    const real = users.filter((u) => !archivedUsers.has(u));
    const tier = (u: string) => (labHeadUsers.has(u) ? 0 : 1);
    const mainRank = (u: string) => (mainUser === u ? 0 : 1);
    return [...real].sort((a, b) => {
      const tierDiff = tier(a) - tier(b);
      if (tierDiff !== 0) return tierDiff;
      const mainDiff = mainRank(a) - mainRank(b);
      if (mainDiff !== 0) return mainDiff;
      return a.localeCompare(b);
    });
  }, [users, labHeadUsers, mainUser, archivedUsers]);

  // Archived users — separate list so the toggle can show/hide them
  // independently. Sorted alphabetically; no tier preference inside the
  // archived bucket (archived lab_head is rare and doesn't need the
  // visual elevation that the active tier preserves).
  const sortedArchivedUsers = useMemo(() => {
    const real = users.filter((u) => archivedUsers.has(u));
    return [...real].sort((a, b) => a.localeCompare(b));
  }, [users, archivedUsers]);

  // Combined render list — active always, archived appended only when
  // the toggle is on. Existing `sortedUsers` consumers in the JSX
  // continue to work by reading this single variable.
  const sortedUsers = useMemo(() => {
    return showArchived
      ? [...sortedActiveUsers, ...sortedArchivedUsers]
      : sortedActiveUsers;
  }, [sortedActiveUsers, sortedArchivedUsers, showArchived]);

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
          {/* Brand mark: BeakerBot in the gradient pill. Static (no
              idle bob — branding shouldn't bounce). `noLiquid` so the
              mascot reads as a clean white wireframe on the blue→
              purple gradient instead of fighting it with its own
              pastel-rainbow fill. */}
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg mb-4">
            <BeakerBot
              pose="idle"
              noLiquid
              ariaLabel="ResearchOS BeakerBot logo"
              className="w-8 h-8 text-white"
            />
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
                {sortedUsers.length === 0 ? (
                  <p className="text-center text-slate-400 py-4">
                    No users found. Create a new user to get started.
                  </p>
                ) : (
                  sortedUsers.map((user) => (
                    <div key={user} className="relative">
                      {editingUser === user ? (
                        // Edit mode
                        <div className="flex items-center gap-2 p-3 bg-white/10 border border-blue-500/50 rounded-xl">
                          <UserAvatar
                            username={user}
                            size="md"
                            letter={(editValue.charAt(0) || user.charAt(0))}
                          />
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
                          <Tooltip label="Save" placement="bottom">
                            <button
                              onClick={() => handleRename(user)}
                              disabled={renaming}
                              className="p-2 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 rounded-lg text-green-400 hover:text-green-300 transition-all disabled:opacity-50"
                            >
                              {renaming ? (
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-green-400"></div>
                              ) : (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </button>
                          </Tooltip>
                          <Tooltip label="Cancel" placement="bottom">
                            <button
                              onClick={cancelEdit}
                              disabled={renaming}
                              className="p-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg text-red-400 hover:text-red-300 transition-all disabled:opacity-50"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </Tooltip>
                        </div>
                      ) : (
                        // Normal view - using div to avoid nested button hydration error
                        <div
                          onClick={() => loggingIn === null && handleLogin(user)}
                          className={`w-full flex items-center gap-3 p-4 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl transition-all group cursor-pointer ${
                            loggingIn !== null ? 'opacity-50 cursor-not-allowed' : ''
                          }`}
                        >
                          <UserAvatar
                            username={user}
                            size="md"
                            showOwnerBadge={mainUser === user}
                          />
                          <div className="flex-1 text-left flex items-center gap-2">
                            <span className="text-white font-medium">{user}</span>
                            {labHeadUsers.has(user) && (
                              // Lab Head badge — matches the CommentsThread
                              // author attribution badge (amber-100/amber-800).
                              // Generic "Lab Head" copy works across academia,
                              // industry, and government settings (avoided
                              // "PI" since it's academia-specific). The Main
                              // badge is orthogonal (laptop owner) and shows
                              // alongside when both apply.
                              <span
                                className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-100 text-amber-800"
                                title="Lab Head"
                              >
                                Lab Head
                              </span>
                            )}
                            {archivedUsers.has(user) && (
                              // Lab Head Phase 6: Archived badge. Gray so it
                              // visually de-emphasizes the tile compared to
                              // active members; the Show archived toggle
                              // below the grid controls visibility entirely.
                              // Clicking an archived tile still works (a
                              // returning postdoc can re-login without PI
                              // help — design decision #2, Grant 2026-05-23).
                              <span
                                className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-slate-200 text-slate-600"
                                title="Archived account — hidden by default"
                              >
                                Archived
                              </span>
                            )}
                            {mainUser === user && (
                              <span className="text-xs text-amber-400 font-normal">(Main)</span>
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
                                data-force-hover-controls-target
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
                              data-force-hover-controls-target
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
                              data-force-hover-controls-target
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
                              data-force-hover-controls-target
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

              {/* Lab Head Phase 6: Show archived toggle. Only renders when
                  there are archived users to surface — keeps the picker
                  uncluttered for labs with zero archives. The toggle
                  itself is a plain text-link style so it doesn't compete
                  with the Create user CTA below. */}
              {sortedArchivedUsers.length > 0 && (
                <div className="text-center mb-3">
                  <button
                    type="button"
                    onClick={() => setShowArchived((v) => !v)}
                    disabled={loggingIn !== null}
                    className="text-xs text-slate-400 hover:text-slate-200 underline-offset-2 hover:underline transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-pressed={showArchived}
                    data-testid="login-show-archived-toggle"
                  >
                    {showArchived
                      ? `Hide archived (${sortedArchivedUsers.length})`
                      : `Show archived (${sortedArchivedUsers.length})`}
                  </button>
                </div>
              )}

              {/* Divider */}
              {users.length > 0 && (
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
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-slate-500 text-sm mt-6">
          Your data is stored locally in the folder you picked
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
            refreshLockStatus(users);
          }}
        />
      )}

      {/* User color picker — opens after the user types a name + clicks
          Create. Mounted at the same z-tier as the password popups so it
          floats above the entry-screen card. Accept persists the chosen
          color to _user_metadata.json BEFORE usersApi.create runs, so the
          new user's color is stored from the moment their account
          exists; Cancel rolls back without writing anything. */}
      {colorPicker && (
        <UserColorPickerPopup
          username={colorPicker.username}
          defaultColor={colorPicker.defaultColor}
          otherUsers={colorPicker.otherUsers}
          onAccept={handleColorPickerAccept}
          onCancel={handleColorPickerCancel}
        />
      )}

      {/* Beta: Support this project */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-4 flex-wrap justify-center max-w-[90vw]">
        <a
          href="/wiki/getting-started/creating-a-user"
          className="text-slate-400 hover:text-white text-xs transition-colors flex items-center gap-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="12" y1="17" x2="12.01" y2="17" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          User & password help
        </a>
        <a
          href="/wiki/shared-lab-accounts"
          className="text-slate-400 hover:text-white text-xs transition-colors flex items-center gap-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-5.13a4 4 0 11-8 0 4 4 0 018 0zm6 0a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Setting up a shared lab account?
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

      {/* Bug Report Modal */}
      <FeedbackModal
        isOpen={showBugReport}
        onClose={closeBugReport}
        prefilledError={currentError}
      />

      {/* Dev-only floating button: create a temporary Test-N user and
          fire the v4 walkthrough on it. Renders nothing in production
          (NODE_ENV gate inside the component). Restored after the V3
          onboarding rip removed the original DevForceTipButton; the
          new button is v4-only and never touches a real account. */}
      <DevForceWalkthroughButton onLoggedIn={onLogin} />

    </div>
  );
}
