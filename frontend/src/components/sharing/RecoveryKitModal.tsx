"use client";

// Cloud-accounts Phase 2, Chunk 2B: the one-time recovery-kit modal.
//
// Shows the recovery words / code ONCE right after a key is provisioned, with a
// copy button and an "I saved these" confirm. The words are passed in by the
// caller (provisioning held them only long enough to show here); this component
// never fetches them and never sends them anywhere. Closing without confirming is
// allowed (no soft-lock): the words just will not be shown again, and the user
// can re-download the kit from Settings later.
//
// Reused by the provisioning flow in AccountHome. Kept presentational: the caller
// owns when to mount it and what to do on confirm.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useState } from "react";

export interface RecoveryKitModalProps {
  /** The 12 recovery words (verbatim). Shown once, never persisted by this UI. */
  recoveryWords: string;
  /** The friendlier base32 rendering of the same secret. */
  recoveryCode: string;
  /** Called when the user clicks "I saved these". */
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
      // Clipboard can be blocked; the words are visible to copy by hand.
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Save your recovery words"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-xl">
        <h2 className="text-title font-bold text-foreground">
          Save your recovery words
        </h2>
        <p className="mt-1 text-meta text-foreground-muted">
          These words are the only way to unlock your encrypted data on a new
          device. We cannot recover them for you. Write them down or store them in
          a password manager, then confirm below.
        </p>

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
          <span>
            I have saved these recovery words somewhere safe. I understand they
            will not be shown again.
          </span>
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
            className="rounded-lg bg-brand-action px-4 py-2 text-meta font-semibold text-white disabled:opacity-60"
          >
            I saved these
          </button>
        </div>
      </div>
    </div>
  );
}
