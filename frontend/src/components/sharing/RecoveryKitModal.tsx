"use client";

// Cloud-accounts Phase 2, Chunk 2B: the one-time recovery-code modal.
//
// Shows the recovery words / code ONCE right after a key is provisioned, with a
// copy button and an "I saved this" confirm. The words are passed in by the
// caller (provisioning held them only long enough to show here); this component
// never fetches them and never sends them anywhere. Closing without confirming is
// allowed (no soft-lock): the code just will not be shown again here, and the
// user can save it again from Settings later.
//
// Note: this provision-on-demand path does not have the account email or the
// encrypted backup blob on hand, so it cannot build a self-contained Recovery Kit
// file the way the Set up sharing wizard does (see SharingSetupWizard GenerateStep,
// which gates continue on a kit download via downloadRecoveryKit). It shows the
// recovery code directly instead and keeps the saved-it confirm. If those inputs
// are ever plumbed through here, swap to the kit-download pattern for consistency.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useState } from "react";
import { CheckIcon, KeyIcon } from "./icons";

export interface RecoveryKitModalProps {
  /** The 12 recovery words (verbatim). Shown once, never persisted by this UI. */
  recoveryWords: string;
  /** The friendlier base32 rendering of the same secret. */
  recoveryCode: string;
  /** Called when the user clicks "I saved this". */
  onConfirm: () => void;
  /** Called when the user dismisses without confirming (escape hatch). */
  onClose: () => void;
}

export default function RecoveryKitModal({
  recoveryWords,
  recoveryCode,
  onConfirm,
  onClose,
}: RecoveryKitModalProps) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the code is visible to copy by hand.
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Save your recovery code"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-xl">
        <h2 className="text-title font-bold text-foreground">
          Your data key is ready
        </h2>

        <div className="mt-3 flex items-start gap-3 rounded-xl border border-border bg-surface-sunken p-4">
          <span className="flex-none grid h-9 w-9 place-items-center rounded-lg bg-brand-action/15 text-brand-action">
            <KeyIcon className="w-5 h-5" />
          </span>
          <div>
            <p className="text-body font-semibold text-foreground">
              Keep your recovery code somewhere safe
            </p>
            <p className="mt-0.5 text-meta leading-relaxed text-foreground-muted">
              Your key lives on this device and unlocks automatically here. Save
              the code below so you can sign in on another computer later, or get
              back in if you ever lose this one. Store it in your password manager
              or another private place.
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-surface-sunken p-4">
          <p className="font-mono text-body leading-relaxed text-foreground">
            {recoveryWords}
          </p>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 truncate rounded-lg bg-surface-sunken px-3 py-2 font-mono text-meta text-foreground-muted">
            {recoveryCode}
          </code>
          <button
            type="button"
            onClick={() => void copy()}
            className="flex-none rounded-lg border border-border px-3 py-2 text-meta font-semibold text-foreground hover:border-brand-action"
          >
            {copied ? "Copied" : "Copy code"}
          </button>
        </div>

        <label className="mt-4 flex items-start gap-2 text-meta text-foreground">
          <input
            type="checkbox"
            checked={saved}
            onChange={(e) => setSaved(e.target.checked)}
            className="mt-0.5"
          />
          <span>I saved my recovery code somewhere safe.</span>
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-meta font-medium text-foreground-muted hover:border-brand-action"
          >
            Later
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!saved}
            className="ros-btn-raise inline-flex items-center gap-1.5 rounded-lg bg-brand-action px-4 py-2 text-meta font-semibold text-white disabled:opacity-60"
          >
            <CheckIcon className="w-3.5 h-3.5" />
            I saved this
          </button>
        </div>
      </div>
    </div>
  );
}
