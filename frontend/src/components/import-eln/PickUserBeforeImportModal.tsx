"use client";

import { useState } from "react";
import UserAvatar from "@/components/UserAvatar";
import LivingPopup from "@/components/ui/LivingPopup";

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
    <LivingPopup
      open={isOpen}
      onClose={onClose}
      label="User picker"
      widthClassName="max-w-md"
      card={false}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="eln-pick-user-title"
        data-testid="eln-pick-user-modal"
        className="relative w-full max-w-md bg-surface-overlay border border-border rounded-2xl ros-popup-card-shadow overflow-hidden"
      >
        <div className="p-6">
          <h2
            id="eln-pick-user-title"
            className="text-heading font-bold text-foreground mb-1"
          >
            Pick a user to own the imported notebook
          </h2>
          <p className="text-meta text-foreground-muted mb-5">
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
                  className="w-full p-3 bg-surface-raised/80 hover:bg-surface-raised border border-border hover:border-blue-500/50 rounded-lg transition-all text-left flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <UserAvatar username={user} size="md" />
                  <span className="text-foreground font-medium">{user}</span>
                </button>
              ))}
            </div>
          )}

          <div className={hasUsers ? "border-t border-border pt-5" : ""}>
            <h3 className="text-body font-medium text-foreground-muted mb-3">
              {hasUsers ? "Create new account" : "Create your first account"}
            </h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="Enter username"
                data-testid="eln-pick-user-new-input"
                className="flex-1 px-4 py-2 bg-surface-sunken border border-border rounded-lg text-foreground placeholder-foreground-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                className="ros-btn-raise px-4 py-2 bg-brand-action hover:bg-brand-action/90 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {isCreating ? "Creating..." : "Create"}
              </button>
            </div>
            {createError && (
              <p className="text-red-600 dark:text-red-400 text-body mt-2" role="alert">
                {createError}
              </p>
            )}
          </div>
        </div>
      </div>
    </LivingPopup>
  );
}
