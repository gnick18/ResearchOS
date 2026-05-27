"use client";

import { useState } from "react";
import UserAvatar from "@/components/UserAvatar";

/**
 * Sticky-intent key. When set in sessionStorage before a sign-in that
 * is going to unmount ResearchFolderSetupNew, the post-sign-in route
 * picks the flag up and auto-mounts ImportELNDialog. This lets the
 * "Import from LabArchives" CTA survive the navigation from picker
 * screen to the signed-in app shell.
 *
 * The consumer lives in `lib/providers.tsx` (PendingELNImportMount).
 * The flag is single-shot: it's cleared on read.
 */
export const ELN_IMPORT_PENDING_KEY = "researchos:eln-import-pending";

interface PickUserBeforeImportModalProps {
  isOpen: boolean;
  availableUsers: string[];
  /** Sign in as an existing user. Caller is responsible for setting the
   *  sticky-intent flag and triggering the actual sign-in. */
  onPickUser: (username: string) => Promise<void> | void;
  /** Create a new user. Returns true if create+sign-in succeeded. */
  onCreateUser: (username: string) => Promise<boolean>;
  onClose: () => void;
}

/**
 * Inline user-picker modal shown when the "Import from LabArchives" CTA
 * is clicked on the folder-setup screen and no user is signed in yet.
 *
 * Visual: matches the existing user-picker tile + create-form pattern
 * inside `ResearchFolderSetupNew` (same dark-glass card aesthetic), so
 * the modal feels like a sub-step of that screen rather than a separate
 * UI surface.
 *
 * Mechanics:
 *   1. List existing users as clickable tiles. Click → onPickUser.
 *   2. Below the tile list, an inline "Create new user" mini-form.
 *   3. If there are zero existing users, the tile list collapses and the
 *      create form is the only affordance.
 *   4. Sign-in unmounts the parent screen; the sticky-intent flag the
 *      caller sets before delegating here is read post-sign-in.
 */
export default function PickUserBeforeImportModal({
  isOpen,
  availableUsers,
  onPickUser,
  onCreateUser,
  onClose,
}: PickUserBeforeImportModalProps) {
  const [newUsername, setNewUsername] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isPicking, setIsPicking] = useState(false);

  if (!isOpen) return null;

  const handlePick = async (username: string) => {
    if (isPicking || isCreating) return;
    setIsPicking(true);
    try {
      await onPickUser(username);
    } finally {
      setIsPicking(false);
    }
  };

  const handleCreate = async () => {
    if (isCreating || isPicking) return;
    const trimmed = newUsername.trim();
    if (!trimmed) {
      setCreateError("Please enter a username");
      return;
    }
    const sanitized = trimmed.replace(/[^a-zA-Z0-9_-]/g, "");
    if (sanitized !== trimmed) {
      setCreateError(
        "Username can only contain letters, numbers, underscores, and hyphens",
      );
      return;
    }
    setIsCreating(true);
    setCreateError(null);
    try {
      const ok = await onCreateUser(sanitized);
      if (!ok) {
        setCreateError("Failed to create user. Please try again.");
      }
    } catch {
      setCreateError("Failed to create user. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  const hasUsers = availableUsers.length > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="eln-pick-user-title"
      data-testid="eln-pick-user-modal"
      // Marker for TourSpotlight (popup-occluding sweep manager,
      // 2026-05-27). Hides the v4 walkthrough ring while this popup
      // is mounted; see SnapshotTilePopup for the canonical example.
      data-tour-popup-occluding="eln-pick-user"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => {
        // Click-outside closes. Inner card stops propagation below.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-md bg-gradient-to-br from-slate-800 to-slate-900 border border-white/15 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close user picker"
          data-testid="eln-pick-user-close"
          className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        <div className="p-6">
          <h2
            id="eln-pick-user-title"
            className="text-lg font-bold text-white mb-1"
          >
            Pick a user to own the imported notebook
          </h2>
          <p className="text-xs text-slate-400 mb-5">
            The LabArchives notebook needs an account on this folder. Pick an
            existing user or create a new one, then the import will continue.
          </p>

          {hasUsers && (
            <div className="space-y-2 mb-5" data-testid="eln-pick-user-list">
              {availableUsers.map((user) => (
                <button
                  key={user}
                  type="button"
                  onClick={() => handlePick(user)}
                  disabled={isPicking || isCreating}
                  data-testid={`eln-pick-user-tile-${user}`}
                  className="w-full p-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-500/50 rounded-lg transition-all text-left flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <UserAvatar username={user} size="md" />
                  <span className="text-white font-medium">{user}</span>
                </button>
              ))}
            </div>
          )}

          <div className={hasUsers ? "border-t border-white/10 pt-5" : ""}>
            <h3 className="text-sm font-medium text-slate-300 mb-3">
              {hasUsers ? "Create new account" : "Create your first account"}
            </h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="Enter username"
                data-testid="eln-pick-user-new-input"
                className="flex-1 px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreate();
                }}
                disabled={isCreating || isPicking}
              />
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={isCreating || isPicking}
                data-testid="eln-pick-user-create-btn"
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {isCreating ? "Creating..." : "Create"}
              </button>
            </div>
            {createError && (
              <p className="text-red-400 text-sm mt-2" role="alert">
                {createError}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
