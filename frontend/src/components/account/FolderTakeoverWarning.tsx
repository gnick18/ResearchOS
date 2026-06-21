"use client";

// Account-centric folder identity (Phase B, D2). The takeover warning modal.
//
// Shown when the signed-in account connects to a folder ALREADY owned by a
// DIFFERENT account (file-system-context surfaces pendingTakeover). It presents
// the current owner, the count of shared files that will be removed on takeover,
// and two routes:
//   - Cancel, the visible escape (no-soft-locks). Leaves the folder under its
//     original owner with NO rebind, and disconnects the session so the user lands
//     back on the connect screen rather than stranded mid-folder.
//   - Take over this folder, the deliberate rebind. Sweeps the foreign shares to
//     the folder trash (recoverable, D6) and rebinds this account as sole owner.
//
// Gated entirely behind MULTI_FOLDER_ENABLED at the mount site (the gate only
// passes a non-null pendingTakeover when the flag is on). Reuses LivingPopup +
// ros-btn-raise like the other account modals.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useState } from "react";
import LivingPopup from "@/components/ui/LivingPopup";
import { Icon } from "@/components/icons";
import { useFileSystem } from "@/lib/file-system/file-system-context";

export default function FolderTakeoverWarning() {
  const { pendingTakeover, takeOverFolder, cancelTakeover, disconnect } =
    useFileSystem();
  const [busy, setBusy] = useState(false);

  if (!pendingTakeover) return null;

  const { ownerEmail, ownerFingerprint, foreignShareCount } = pendingTakeover;
  const ownerLabel = ownerEmail ?? "another account";

  async function handleCancel() {
    if (busy) return;
    // Real escape, decline the takeover and leave the folder under its original
    // owner. Disconnect so the user is never stuck on a folder they declined.
    cancelTakeover();
    await disconnect();
  }

  async function handleTakeOver() {
    if (busy) return;
    setBusy(true);
    try {
      await takeOverFolder();
    } finally {
      setBusy(false);
    }
  }

  return (
    <LivingPopup
      open
      onClose={busy ? () => {} : () => void handleCancel()}
      label="Take over this folder"
      widthClassName="max-w-lg"
      padded
      blur
      closeOnScrimClick={false}
      showClose={false}
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            <Icon name="shield" className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-title font-bold text-foreground">
              This folder belongs to a different account
            </h2>
            <p className="mt-1 text-meta text-foreground-muted">
              Owned by{" "}
              <span className="font-semibold text-foreground">{ownerLabel}</span>
            </p>
          </div>
        </div>

        <p className="text-body text-foreground-muted">
          You are signed in as a different account than the one that owns this
          folder. Opening it as yourself will rebind the folder to your account.
          The previous owner keeps a co-member entry, and you can hand ownership
          back later from the folder banner.
        </p>

        {foreignShareCount > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-meta text-amber-800 dark:border-amber-800/30 dark:bg-amber-900/15 dark:text-amber-300">
            There are {foreignShareCount} shared files that you do not have
            permission to view. Taking over this folder will mean the local
            copies of those shared documents will be removed from this folder.
          </div>
        )}

        <p className="text-meta text-foreground-muted">
          Owner key{" "}
          <span className="font-mono text-foreground">{ownerFingerprint}</span>
        </p>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleTakeOver()}
            className="ros-btn-raise rounded-lg bg-brand-action px-5 py-2 text-body font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Taking over..." : "Take over this folder"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleCancel()}
            className="rounded-lg border border-border px-5 py-2 text-body font-medium text-foreground-muted disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    </LivingPopup>
  );
}
