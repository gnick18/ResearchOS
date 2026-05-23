"use client";

import { useEffect, useRef, useState } from "react";
import {
  hasLabHeadPassword,
  verifyLabHeadPassword,
} from "@/lib/lab/lab-head-auth";
import { startEditSession } from "@/lib/lab/edit-session";

interface LabHeadPasswordModalProps {
  /** The lab head's username. We verify the password against this user's
   *  `_lab_head_auth.json` (or, on first use, their `_auth.json`
   *  account-password file — see `verifyLabHeadPassword` for the
   *  bootstrap path). */
  username: string;
  /** Optional context line shown in the modal header. E.g.
   *  `"alex's task: Mini-prep DNA"`. Pure copy; ignored by the verify
   *  step. */
  targetLabel?: string;
  onClose: () => void;
  /** Fired after a successful unlock + session-start. The caller can
   *  use this to e.g. close the modal AND surface a confirmation. */
  onUnlocked?: () => void;
}

/**
 * Lab Head Phase 5 (lab head Phase 5 manager, 2026-05-23): password
 * prompt that gates edit-mode unlock.
 *
 * On submit:
 *   1. `verifyLabHeadPassword(username, password)` — checks the dedicated
 *      `_lab_head_auth.json` first; falls back to the account password
 *      (decision #3) and persists a hash on success.
 *   2. On success, `startEditSession(username)` spins up the 5-minute
 *      timer. The session lives at module scope so closing this modal
 *      and navigating doesn't lose it.
 *   3. `onUnlocked()` + `onClose()` fire so the popup can re-render with
 *      writable inputs.
 *
 * On failure: shows an error message, leaves the modal open for retry.
 * No throttling here — the local-first threat model is "someone with
 * shared-folder access" not "online attacker," and PBKDF2's 600k
 * iterations make brute force expensive enough on its own.
 */
export default function LabHeadPasswordModal({
  username,
  targetLabel,
  onClose,
  onUnlocked,
}: LabHeadPasswordModalProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [firstUse, setFirstUse] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const exists = await hasLabHeadPassword(username);
      if (cancelled) return;
      setFirstUse(!exists);
    })();
    return () => {
      cancelled = true;
    };
  }, [username]);

  // Focus the password input on mount so the PI can start typing
  // immediately. (Modal opens via a button click that already took
  // keyboard focus away.)
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Esc closes the modal (matches AccountPasswordPopup's UX).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleSubmit() {
    setError(null);
    if (!password) {
      setError("Enter your password to continue.");
      return;
    }
    setBusy(true);
    try {
      const ok = await verifyLabHeadPassword(username, password);
      if (!ok) {
        setError(
          firstUse
            ? "That doesn't match your account password. Try again."
            : "Incorrect lab-head password.",
        );
        setBusy(false);
        return;
      }
      startEditSession(username);
      onUnlocked?.();
      onClose();
    } catch (err) {
      console.warn("[LabHeadPasswordModal] verify failed", err);
      setError("Verification failed. Try again.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="lab-head-password-modal-title"
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2
            id="lab-head-password-modal-title"
            className="text-base font-semibold text-gray-900"
          >
            Unlock edit mode
          </h2>
          {targetLabel ? (
            <p className="text-xs text-gray-500 mt-1">
              Editing <span className="font-medium text-gray-700">{targetLabel}</span>.
              All changes are attributed to you with a timestamp.
            </p>
          ) : (
            <p className="text-xs text-gray-500 mt-1">
              Editing another lab member&apos;s record. All changes are attributed
              to you with a timestamp.
            </p>
          )}
        </div>

        {firstUse === true && (
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
            <p className="font-medium">First time unlocking edit mode.</p>
            <p className="mt-1">
              For convenience, your edit-mode password starts out the same as
              your account password. You can change it later in Settings →
              Lab Head.
            </p>
          </div>
        )}

        <div>
          <label
            htmlFor="lab-head-password-modal-input"
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            {firstUse ? "Account password" : "Lab-head password"}
          </label>
          <input
            id="lab-head-password-modal-input"
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            disabled={busy}
            autoComplete="current-password"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:bg-gray-50 disabled:text-gray-400"
          />
        </div>

        {error && (
          <p className="text-xs text-red-600" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 rounded-md text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={busy || !password}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "Verifying…" : "Unlock"}
          </button>
        </div>
      </div>
    </div>
  );
}
