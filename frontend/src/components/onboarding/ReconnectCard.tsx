"use client";

// Focused one-click reconnect card (seamless-reconnect on login, 2026-06-20).
//
// Shown on a login return when this device has a stored folder handle whose
// account matches the signed-in account, but Chrome dropped the readwrite grant
// (permission "prompt"). Rather than dump the returning user on the generic
// /account folder-connect screen and make them re-pick the folder through the OS
// picker, this is a single "Reconnect <folder>" button: the click is the user
// gesture requestPermission needs, so it re-permissions the stored handle with no
// picker. On grant the provider's isConnected flips and the app renders in place
// (client nav, no reload, which would re-lapse the fresh grant).
//
// No soft-locks (feedback_no_soft_locks): the card always offers a visible escape
// to the full account / folder-connect screen, so a stale or wrong stored handle
// never traps the user here.
//
// House style: no em-dashes, no emojis, no mid-sentence colons. Every icon is an
// inline SVG via the Icon registry.

import { useCallback, useState } from "react";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { Icon } from "@/components/icons";

export interface ReconnectCardProps {
  /** The stored folder's display name, for the headline + button. */
  folderName: string;
  /** Escape hatch: open the full account / folder-connect screen instead. The
   *  caller routes this (client nav to /account) so the user can pick a different
   *  folder or sign in as someone else. Always present, never a dead end. */
  onUseAnotherFolder: () => void;
}

export default function ReconnectCard({
  folderName,
  onUseAnotherFolder,
}: ReconnectCardProps) {
  const { reconnectWithStoredHandle, isLoading, error } = useFileSystem();
  const [working, setWorking] = useState(false);

  const handleReconnect = useCallback(() => {
    setWorking(true);
    // reconnectWithStoredHandle runs requestPermission from this gesture, then
    // finishConnect, which flips isConnected so the app renders without a reload.
    void reconnectWithStoredHandle().finally(() => setWorking(false));
  }, [reconnectWithStoredHandle]);

  const busy = working || isLoading;

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface-raised p-7 shadow-lg">
        <div className="mb-4 flex justify-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/10 text-blue-500 dark:bg-blue-500/15">
            <Icon name="folder" className="h-6 w-6" />
          </span>
        </div>
        <h1 className="text-center text-h3 font-semibold text-foreground">
          Welcome back
        </h1>
        <p className="mt-2 text-center text-body text-foreground-muted">
          You were last connected to{" "}
          <span className="font-semibold text-foreground">{folderName}</span>.
          Your browser asks you to allow access again after a reload. No need to
          find the folder, just choose Allow.
        </p>

        <button
          type="button"
          onClick={handleReconnect}
          disabled={busy}
          data-testid="reconnect-card-button"
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg btn-brand px-5 py-3 text-body font-semibold text-white transition-all disabled:opacity-50"
        >
          {busy ? (
            <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white" />
          ) : (
            <>
              <Icon name="folder" className="h-4 w-4" />
              Reconnect {folderName}
            </>
          )}
        </button>

        {error && (
          <p className="mt-3 text-center text-meta text-red-500">{error}</p>
        )}

        <button
          type="button"
          onClick={onUseAnotherFolder}
          disabled={busy}
          data-testid="reconnect-card-other"
          className="mt-3 w-full rounded-lg px-5 py-2 text-meta text-foreground-muted transition-colors hover:text-foreground disabled:opacity-50"
        >
          Use a different folder or account
        </button>
      </div>
    </div>
  );
}
