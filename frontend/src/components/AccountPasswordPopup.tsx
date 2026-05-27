"use client";

import { useEffect, useState } from "react";
import {
  hasPassword,
  setPassword,
  removePassword,
  verifyPassword,
} from "@/lib/auth/password";
import {
  clearCachedPassword,
  setCachedPassword,
} from "@/lib/auth/cached-password";
import {
  decryptEncryptedBackup,
  hasEncryptedBackup,
  writeEncryptedBackup,
} from "@/lib/telegram/encrypted-backup";
import Tooltip from "./Tooltip";

interface AccountPasswordPopupProps {
  username: string;
  onClose: () => void;
}

type Mode = "set" | "change" | "remove";

/**
 * Per-account password management. Reached via the lock icon next to a user
 * in UserLoginScreen. The popup decides whether the account is in "set" mode
 * (no password yet) or "change/remove" mode (password exists) on open. A
 * "Forgot password?" link explains the manual reset path — deleting the
 * `_auth.json` file in the user's folder.
 */
export default function AccountPasswordPopup({ username, onClose }: AccountPasswordPopupProps) {
  const [hasExisting, setHasExisting] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>("set");
  const [currentInput, setCurrentInput] = useState("");
  const [newInput, setNewInput] = useState("");
  const [confirmInput, setConfirmInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [showForgot, setShowForgot] = useState(false);
  // When true, the change-password submit is mid-re-encrypt of the
  // Telegram backup. The submit button shows a different label so the
  // user sees a step actually happening on their behalf.
  const [reencrypting, setReencrypting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const exists = await hasPassword(username);
      if (cancelled) return;
      setHasExisting(exists);
      setMode(exists ? "change" : "set");
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
      if (!newInput) {
        setError("Enter a new password.");
        return;
      }
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
        await setPassword(username, newInput);
        setHasExisting(true);
        setDone("Password set.");
        resetForm();
        setMode("change");
      } catch {
        setError("Failed to save password.");
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
      if (!newInput || newInput.length < 4) {
        setError("New password must be at least 4 characters.");
        return;
      }
      if (newInput !== confirmInput) {
        setError("Passwords do not match.");
        return;
      }
      setBusy(true);
      try {
        const ok = await verifyPassword(username, currentInput);
        if (!ok) {
          // Constraint #2(e): auth-failure wipes the cached password
          // so the next attempt cannot accidentally reuse a stale
          // value.
          clearCachedPassword();
          setError("Current password is incorrect.");
          setBusy(false);
          return;
        }
        // Security-manager constraints #7+8: if there is an encrypted
        // Telegram backup at users/<u>/_telegram-encrypted.json, the
        // old password is the only thing that can decrypt it. Decrypt
        // with old, re-encrypt with new, then write the new _auth.json
        // hash — order matters because if the backup re-encrypt fails
        // we want to abort BEFORE the password hash actually rotates.
        const backupExists = await hasEncryptedBackup(username);
        if (backupExists) {
          setReencrypting(true);
          const decrypted = await decryptEncryptedBackup(username, currentInput);
          if (decrypted === null) {
            // verifyPassword passed but decrypt failed — sidecar is
            // corrupt or has been re-encrypted by another surface
            // with a different password. Bail without rotating: the
            // user can delete _telegram-encrypted.json and re-pair if
            // they want to clear this state.
            setError(
              "Encrypted Telegram backup couldn't be decrypted with the current password. Aborting password change. Delete _telegram-encrypted.json from your user folder if you want to reset it.",
            );
            setReencrypting(false);
            setBusy(false);
            return;
          }
          try {
            await writeEncryptedBackup(username, decrypted, newInput);
          } catch (writeErr) {
            console.error("[account-password] re-encrypt backup failed", writeErr);
            setError(
              "Could not re-encrypt the Telegram backup. Password change aborted; your current password is still active.",
            );
            setReencrypting(false);
            setBusy(false);
            return;
          }
          setReencrypting(false);
        }
        await setPassword(username, newInput);
        // Rotate the cached password too so the rest of the session
        // matches the new on-disk hash.
        setCachedPassword(newInput);
        setDone(backupExists ? "Password updated. Telegram backup re-encrypted." : "Password updated.");
        resetForm();
      } catch {
        setError("Failed to update password.");
        setReencrypting(false);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (mode === "remove") {
      if (!currentInput) {
        setError("Enter your current password to remove it.");
        return;
      }
      setBusy(true);
      try {
        const ok = await verifyPassword(username, currentInput);
        if (!ok) {
          clearCachedPassword();
          setError("Current password is incorrect.");
          setBusy(false);
          return;
        }
        await removePassword(username);
        // Password gone → cached password is meaningless. Wipe it so
        // any encrypted-backup decrypt attempt re-prompts (and finds
        // there is no password to verify against either).
        clearCachedPassword();
        setHasExisting(false);
        setDone("Password removed.");
        resetForm();
        setMode("set");
      } catch {
        setError("Failed to remove password.");
      } finally {
        setBusy(false);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      // Marker for TourSpotlight (popup-occluding sweep manager,
      // 2026-05-27). Hides the v4 walkthrough ring while this popup
      // is mounted; see SnapshotTilePopup for the canonical example.
      data-tour-popup-occluding="account-password"
      onClick={onClose}
    >
      <div
        className="bg-slate-800 rounded-2xl shadow-2xl border border-white/20 max-w-md w-full mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-white/10 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Account password</h3>
            <p className="text-xs text-slate-400 mt-0.5">for {username}</p>
          </div>
          <Tooltip label="Close" placement="bottom">
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white text-lg leading-none"
              aria-label="Close"
            >
              ✕
            </button>
          </Tooltip>
        </div>

        {hasExisting === null ? (
          <div className="px-6 py-8 flex justify-center">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            <p className="text-xs text-slate-400 leading-relaxed">
              A password blocks accidental sign-in to this account from inside
              the app. It does not encrypt your files on disk — anyone with
              access to the shared folder can still read raw markdown and
              images.
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
                  className={`flex-1 py-2 text-xs rounded-lg border transition-colors ${
                    mode === "change"
                      ? "bg-blue-500/20 border-blue-400/40 text-blue-200"
                      : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
                  }`}
                >
                  Change
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("remove");
                    resetForm();
                    setDone(null);
                  }}
                  className={`flex-1 py-2 text-xs rounded-lg border transition-colors ${
                    mode === "remove"
                      ? "bg-red-500/20 border-red-400/40 text-red-200"
                      : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
                  }`}
                >
                  Remove
                </button>
              </div>
            )}

            {(mode === "change" || mode === "remove") && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Current password
                </label>
                <input
                  type="password"
                  value={currentInput}
                  onChange={(e) => setCurrentInput(e.target.value)}
                  className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  autoComplete="current-password"
                  autoFocus
                />
              </div>
            )}

            {(mode === "set" || mode === "change") && (
              <>
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <label className="text-xs font-medium text-slate-300">
                      {mode === "set" ? "New password" : "New password"}
                    </label>
                    <Tooltip
                      label="Hashed with PBKDF2-SHA-256 (600,000 iterations) into users/<your-username>/_auth.json on your disk. Never sent to any server. If you forget it, delete that file directly in your folder to reset."
                      placement="top"
                    >
                      <button
                        type="button"
                        aria-label="Where does this go?"
                        className="text-slate-500 hover:text-slate-300 text-[11px] leading-none"
                      >
                        (?)
                      </button>
                    </Tooltip>
                  </div>
                  <input
                    type="password"
                    value={newInput}
                    onChange={(e) => setNewInput(e.target.value)}
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    autoComplete="new-password"
                    autoFocus={mode === "set"}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Confirm new password
                  </label>
                  <input
                    type="password"
                    value={confirmInput}
                    onChange={(e) => setConfirmInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSubmit();
                    }}
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    autoComplete="new-password"
                  />
                </div>
              </>
            )}

            {error && (
              <div className="p-2 bg-red-500/20 border border-red-500/30 rounded-lg">
                <p className="text-xs text-red-300">{error}</p>
              </div>
            )}
            {done && !error && (
              <div className="p-2 bg-emerald-500/20 border border-emerald-500/30 rounded-lg">
                <p className="text-xs text-emerald-300">{done}</p>
              </div>
            )}

            {hasExisting && (
              <button
                type="button"
                onClick={() => setShowForgot(true)}
                className="text-xs text-blue-400 hover:text-blue-300 underline"
              >
                Forgot your password?
              </button>
            )}

            <div className="flex gap-2 pt-2">
              <button
                onClick={onClose}
                disabled={busy}
                className="flex-1 py-2 text-sm bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 rounded-lg disabled:opacity-50"
              >
                Close
              </button>
              <button
                onClick={handleSubmit}
                disabled={busy}
                className={`flex-1 py-2 text-sm rounded-lg font-medium disabled:opacity-50 ${
                  mode === "remove"
                    ? "bg-red-600 hover:bg-red-700 text-white"
                    : "bg-blue-600 hover:bg-blue-700 text-white"
                }`}
              >
                {busy
                  ? reencrypting
                    ? "Re-encrypting Telegram backup…"
                    : "..."
                  : mode === "set"
                  ? "Set password"
                  : mode === "change"
                  ? "Update password"
                  : "Remove password"}
              </button>
            </div>
          </div>
        )}
      </div>

      {showForgot && (
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          // Marker for TourSpotlight (popup-occluding sweep manager,
          // 2026-05-27).
          data-tour-popup-occluding="account-password-forgot"
          onClick={() => setShowForgot(false)}
        >
          <div
            className="bg-slate-800 rounded-2xl shadow-2xl border border-white/20 max-w-md w-full mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-lg font-semibold text-white">Forgot your password?</h3>
              <Tooltip label="Close" placement="bottom">
                <button
                  onClick={() => setShowForgot(false)}
                  className="text-slate-400 hover:text-white text-lg leading-none"
                  aria-label="Close"
                >
                  ✕
                </button>
              </Tooltip>
            </div>
            <p className="text-sm text-slate-300 mb-3 leading-relaxed">
              Since ResearchOS stores everything locally, there&apos;s no
              recovery email or reset link. To clear the password and sign in
              again:
            </p>
            <ol className="text-sm text-slate-300 space-y-2 list-decimal list-inside mb-4">
              <li>Open your shared data folder (e.g. in OneDrive or Finder).</li>
              <li>
                Go into <code className="px-1 py-0.5 bg-white/10 rounded text-blue-300">users/{username}/</code>.
              </li>
              <li>
                Delete <code className="px-1 py-0.5 bg-white/10 rounded text-blue-300">_auth.json</code>.
              </li>
              <li>Return to ResearchOS and sign in normally.</li>
            </ol>
            <p className="text-xs text-slate-400 mb-4">
              A lab admin (or anyone with access to the folder) can also do
              this for you. Your other notes and files are not affected.
            </p>
            <div className="flex justify-end">
              <button
                onClick={() => setShowForgot(false)}
                className="px-4 py-2 text-sm bg-white/10 hover:bg-white/20 text-white rounded-lg"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
