"use client";

import { useEffect, useState } from "react";
import {
  changeAccountPassword,
  createAndPersistAccount,
  deleteLocalAccount,
  hasLocalAccount,
  loginWithPassword,
} from "@/lib/auth/account-store";
import { folderRequiresLogin } from "@/lib/auth/login-policy";
import { discoverUsers } from "@/lib/file-system/user-discovery";
import { readUserSettings } from "@/lib/settings/user-settings";
import LivingPopup from "@/components/ui/LivingPopup";
import Tooltip from "./Tooltip";

interface AccountPasswordPopupProps {
  username: string;
  onClose: () => void;
}

type Mode = "set" | "change" | "remove";

/**
 * Per-account password management. Reached via the lock icon next to a user in
 * UserLoginScreen. The password unlocks the account's local keypair (identity
 * model phase 1), so "set" creates the account, "change" re-wraps the keypair,
 * and "remove" is offered only for a genuinely solo folder (a shared folder
 * requires a login). A "Forgot password?" link points to the recovery code.
 */
export default function AccountPasswordPopup({
  username,
  onClose,
}: AccountPasswordPopupProps) {
  const [hasExisting, setHasExisting] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>("set");
  const [currentInput, setCurrentInput] = useState("");
  const [newInput, setNewInput] = useState("");
  const [confirmInput, setConfirmInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [showForgot, setShowForgot] = useState(false);
  // Shown once right after a new account is created.
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  // Removing the login is allowed only in a genuinely solo folder.
  const [canRemove, setCanRemove] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const exists = await hasLocalAccount(username);
      let solo = false;
      try {
        const users = await discoverUsers();
        let anyLabHead = false;
        for (const u of users) {
          try {
            const s = await readUserSettings(u);
            if (s.account_type === "lab_head") {
              anyLabHead = true;
              break;
            }
          } catch {
            /* ignore a single unreadable settings file */
          }
        }
        solo = !folderRequiresLogin(users.length, anyLabHead);
      } catch {
        /* ignore, default to not-removable */
      }
      if (cancelled) return;
      setHasExisting(exists);
      setMode(exists ? "change" : "set");
      setCanRemove(solo);
    })();
    return () => {
      cancelled = true;
    };
  }, [username]);

  const resetForm = () => {
    setCurrentInput("");
    setNewInput("");
    setConfirmInput("");
    setError(null);
  };

  const handleSubmit = async () => {
    setError(null);
    if (mode === "set") {
      if (newInput.length < 4) {
        setError("Password must be at least 4 characters.");
        return;
      }
      if (newInput !== confirmInput) {
        setError("Passwords do not match.");
        return;
      }
      setBusy(true);
      try {
        const created = await createAndPersistAccount(username, newInput);
        setHasExisting(true);
        setRecoveryCode(created.recoveryCode);
        setDone("Account password set.");
        resetForm();
        setMode("change");
      } catch {
        setError("Failed to set password.");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (mode === "change") {
      if (!currentInput) {
        setError("Enter your current password.");
        return;
      }
      if (newInput.length < 4) {
        setError("New password must be at least 4 characters.");
        return;
      }
      if (newInput !== confirmInput) {
        setError("Passwords do not match.");
        return;
      }
      setBusy(true);
      try {
        const ok = await changeAccountPassword(username, currentInput, newInput);
        if (!ok) {
          setError("Current password is incorrect.");
          setBusy(false);
          return;
        }
        setDone("Password updated.");
        resetForm();
      } catch {
        setError("Failed to update password.");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (mode === "remove") {
      if (!canRemove) {
        setError("This folder is shared, so a login is required.");
        return;
      }
      if (!currentInput) {
        setError("Enter your current password to remove it.");
        return;
      }
      setBusy(true);
      try {
        const keys = await loginWithPassword(username, currentInput);
        if (!keys) {
          setError("Current password is incorrect.");
          setBusy(false);
          return;
        }
        await deleteLocalAccount(username);
        setHasExisting(false);
        setDone("Login removed.");
        resetForm();
        setMode("set");
      } catch {
        setError("Failed to remove the login.");
      } finally {
        setBusy(false);
      }
    }
  };

  return (
    <>
    {/* Main popup. Escape closes it only when the nested forgot confirm is not
        open, so Escape dismisses the forgot layer first. */}
    <LivingPopup
      open
      onClose={onClose}
      label="Account password"
      card={false}
      widthClassName="max-w-md"
      showClose={false}
      closeOnEscape={!showForgot}
    >
      <div
        className="pointer-events-auto bg-surface-raised rounded-2xl shadow-2xl border border-border w-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border flex items-start justify-between">
          <div>
            <h3 className="text-heading font-semibold text-foreground">
              Account password
            </h3>
            <p className="text-meta text-foreground-muted mt-0.5">for {username}</p>
          </div>
          <Tooltip label="Close" placement="bottom">
            <button
              onClick={onClose}
              className="text-foreground-muted hover:text-foreground text-lg leading-none"
              aria-label="Close"
            >
              ✕
            </button>
          </Tooltip>
        </div>

        {hasExisting === null ? (
          <div className="px-6 py-8 flex justify-center">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-foreground" />
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            <p className="text-meta text-foreground-muted leading-relaxed">
              Your password unlocks this account on this device. It does not
              encrypt your files on disk, anyone with access to the shared folder
              can still read raw markdown and images.
            </p>

            {hasExisting && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setMode("change");
                    resetForm();
                    setDone(null);
                  }}
                  className={`flex-1 py-2 text-meta rounded-lg border transition-colors ${
                    mode === "change"
                      ? "bg-blue-500/20 border-blue-400/40 text-blue-700 dark:text-blue-200"
                      : "bg-surface-sunken border-border text-foreground-muted hover:bg-surface-raised"
                  }`}
                >
                  Change
                </button>
                {canRemove && (
                  <button
                    type="button"
                    onClick={() => {
                      setMode("remove");
                      resetForm();
                      setDone(null);
                    }}
                    className={`flex-1 py-2 text-meta rounded-lg border transition-colors ${
                      mode === "remove"
                        ? "bg-red-500/20 border-red-400/40 text-red-700 dark:text-red-200"
                        : "bg-surface-sunken border-border text-foreground-muted hover:bg-surface-raised"
                    }`}
                  >
                    Remove
                  </button>
                )}
              </div>
            )}

            {(mode === "change" || mode === "remove") && (
              <div>
                <label className="block text-meta font-medium text-foreground-muted mb-1">
                  Current password
                </label>
                <input
                  type="password"
                  value={currentInput}
                  onChange={(e) => setCurrentInput(e.target.value)}
                  className="w-full px-3 py-2 bg-surface-sunken border border-border rounded-lg text-foreground placeholder-foreground-muted focus:outline-none focus:ring-2 focus:ring-blue-500 text-body"
                  autoComplete="current-password"
                  autoFocus
                />
              </div>
            )}

            {(mode === "set" || mode === "change") && (
              <>
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <label className="text-meta font-medium text-foreground-muted">
                      New password
                    </label>
                    <Tooltip
                      label="Unlocks your account keypair, stored wrapped in users/<your-username>/_account.json on your disk. Never sent to any server. If you forget it, use your recovery code on the sign-in screen."
                      placement="top"
                    >
                      <button
                        type="button"
                        aria-label="Where does this go?"
                        className="text-foreground-muted hover:text-foreground-muted text-meta leading-none"
                      >
                        (?)
                      </button>
                    </Tooltip>
                  </div>
                  <input
                    type="password"
                    value={newInput}
                    onChange={(e) => setNewInput(e.target.value)}
                    className="w-full px-3 py-2 bg-surface-sunken border border-border rounded-lg text-foreground placeholder-foreground-muted focus:outline-none focus:ring-2 focus:ring-blue-500 text-body"
                    autoComplete="new-password"
                    autoFocus={mode === "set"}
                  />
                </div>
                <div>
                  <label className="block text-meta font-medium text-foreground-muted mb-1">
                    Confirm new password
                  </label>
                  <input
                    type="password"
                    value={confirmInput}
                    onChange={(e) => setConfirmInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSubmit();
                    }}
                    className="w-full px-3 py-2 bg-surface-sunken border border-border rounded-lg text-foreground placeholder-foreground-muted focus:outline-none focus:ring-2 focus:ring-blue-500 text-body"
                    autoComplete="new-password"
                  />
                </div>
              </>
            )}

            {recoveryCode && (
              <div className="p-3 rounded-lg border border-blue-400/30 bg-blue-500/10 space-y-2">
                <p className="text-meta font-medium text-blue-700 dark:text-blue-200">
                  Save your recovery code
                </p>
                <p className="font-mono text-body text-foreground tracking-wide break-all text-center">
                  {recoveryCode}
                </p>
                <p className="text-meta text-foreground-muted leading-relaxed">
                  This is the only way back in if you forget your password. It is
                  not shown again.
                </p>
              </div>
            )}

            {error && (
              <div className="p-2 bg-red-500/20 border border-red-500/30 rounded-lg">
                <p className="text-meta text-red-700 dark:text-red-300">{error}</p>
              </div>
            )}
            {done && !error && !recoveryCode && (
              <div className="p-2 bg-emerald-500/20 border border-emerald-500/30 rounded-lg">
                <p className="text-meta text-emerald-700 dark:text-emerald-300">{done}</p>
              </div>
            )}

            {hasExisting && (
              <button
                type="button"
                onClick={() => setShowForgot(true)}
                className="text-meta text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline"
              >
                Forgot your password?
              </button>
            )}

            <div className="flex gap-2 pt-2">
              <button
                onClick={onClose}
                disabled={busy}
                className="flex-1 py-2 text-body bg-surface-sunken hover:bg-surface-raised border border-border text-foreground rounded-lg disabled:opacity-50"
              >
                Close
              </button>
              <button
                onClick={handleSubmit}
                disabled={busy}
                className={`flex-1 py-2 text-body rounded-lg font-medium disabled:opacity-50 ${
                  mode === "remove"
                    ? "bg-red-600 hover:bg-red-700 text-white"
                    : "bg-brand-action hover:bg-brand-action/90 text-white"
                }`}
              >
                {busy
                  ? "Working…"
                  : mode === "set"
                    ? "Set password"
                    : mode === "change"
                      ? "Update password"
                      : "Remove login"}
              </button>
            </div>
          </div>
        )}
      </div>
    </LivingPopup>

    {/* Nested forgot-password confirm. A sibling LivingPopup so it joins the
        popup stack (single dim, no double-darken) and, rendered after the main
        popup, layers above it by DOM order. */}
    {showForgot && (
      <LivingPopup
        open
        onClose={() => setShowForgot(false)}
        label="Forgot your password?"
        card={false}
        widthClassName="max-w-md"
        showClose={false}
      >
          <div
            className="pointer-events-auto bg-surface-raised rounded-2xl shadow-2xl border border-border w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-heading font-semibold text-foreground">
                Forgot your password?
              </h3>
              <Tooltip label="Close" placement="bottom">
                <button
                  onClick={() => setShowForgot(false)}
                  className="text-foreground-muted hover:text-foreground text-lg leading-none"
                  aria-label="Close"
                >
                  ✕
                </button>
              </Tooltip>
            </div>
            <p className="text-body text-foreground-muted mb-3 leading-relaxed">
              There is no recovery email or reset link, everything is local. To
              get back into this account:
            </p>
            <ol className="text-body text-foreground-muted space-y-2 list-decimal list-inside mb-4">
              <li>On the sign-in screen, click this account.</li>
              <li>
                Choose <strong>Use your recovery code</strong> instead of the
                password.
              </li>
              <li>Enter the recovery code you saved when you set the password.</li>
            </ol>
            <p className="text-meta text-foreground-muted mb-4">
              If you also lost the recovery code, a lab admin can reset this
              member from their own account. Your other notes and files are not
              affected.
            </p>
            <div className="flex justify-end">
              <button
                onClick={() => setShowForgot(false)}
                className="px-4 py-2 text-body bg-surface-sunken hover:bg-surface-raised border border-border text-foreground rounded-lg"
              >
                Got it
              </button>
            </div>
          </div>
      </LivingPopup>
    )}
    </>
  );
}
