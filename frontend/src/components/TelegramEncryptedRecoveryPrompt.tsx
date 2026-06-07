// SENSITIVE: this surface re-arms a previously paired bot from the encrypted
// disk sidecar at users/<u>/_telegram-encrypted.json when `_telegram.json` has
// gone missing. The backup is keyed off the on-device identity keypair now
// (identity model phase 1, 2026-06-05), so restore is SILENT and automatic, no
// account-password prompt. See SECURITY_AUDIT.md §1.3 for the threat model.
//
// Trigger predicate (boot / folder-open / user-switch — NOT on poll failure):
//   readPairing(user) === null
//   && settings.telegramAutoReconnect === true
//   && hasEncryptedBackup(user) === true
//   && IDB token cache for {folder, user} is absent (otherwise the faster IDB
//      path handles it)
//   && the on-device keypair is loadable
//
// If the keypair cannot decrypt the backup (a new keypair after a reset orphans
// the old backup), the stale sidecar is deleted and nothing is shown.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { sendMessage } from "@/lib/telegram/telegram-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { getStoredDirectoryMeta } from "@/lib/file-system/indexeddb-store";
import {
  readPairing,
  writePairing,
  type TelegramPairing,
} from "@/lib/telegram/telegram-store";
import { readTelegramTokenCache } from "@/lib/telegram/telegram-token-cache";
import {
  decryptEncryptedBackup,
  deleteEncryptedBackup,
  hasEncryptedBackup,
} from "@/lib/telegram/encrypted-backup";
import { readUserSettings } from "@/lib/settings/user-settings";
import { loadIdentity } from "@/lib/sharing/identity/storage";

type PromptState = { kind: "hidden" } | { kind: "toast" };

const RESTORE_TOAST_TTL_MS = 4000;

export default function TelegramEncryptedRecoveryPrompt() {
  const { currentUser } = useCurrentUser();
  const { isConnected } = useFileSystem();
  const [state, setState] = useState<PromptState>({ kind: "hidden" });
  // One-shot guard so the auto-restore runs once per {folder, user} session.
  const checkedKeyRef = useRef<string | null>(null);

  const evaluate = useCallback(async () => {
    if (!currentUser || !isConnected) return;
    const meta = await getStoredDirectoryMeta();
    const folder = meta?.name;
    if (!folder) return;
    const triggerKey = `${folder}:${currentUser}`;
    if (checkedKeyRef.current === triggerKey) return;
    checkedKeyRef.current = triggerKey;

    // Only when the on-disk pairing is gone, auto-reconnect is on, a backup
    // exists, and the IDB cache cannot already handle it.
    if (await readPairing(currentUser)) return;
    const settings = await readUserSettings(currentUser);
    if (!settings.telegramAutoReconnect) return;
    if (!(await hasEncryptedBackup(currentUser))) return;
    if (await readTelegramTokenCache(folder, currentUser)) return;

    // Decrypt with the on-device keypair. No password prompt.
    const identity = await loadIdentity();
    if (!identity) return; // keypair not loaded yet, a later mount retries
    const secret = identity.keys.encryption.privateKey;

    let payload;
    try {
      payload = await decryptEncryptedBackup(currentUser, secret);
    } catch {
      payload = null;
    }
    if (payload === null) {
      // The backup is keyed to a different (old) keypair, a reset orphaned it.
      // Drop the stale sidecar so it stops triggering, the user can re-pair.
      try {
        await deleteEncryptedBackup(currentUser);
      } catch {
        // best effort
      }
      return;
    }

    // botFirstName is not in the encrypted payload (constraint #6), it
    // repopulates via getMe() on the next poll. The cursor self-heals.
    const pairing: TelegramPairing = {
      botToken: payload.botToken,
      botUsername: payload.botUsername,
      chatId: payload.chatId,
      lastUpdateId: 0,
      pairedAt: new Date().toISOString(),
    };
    await writePairing(currentUser, pairing);
    try {
      await sendMessage(
        payload.botToken,
        payload.chatId,
        `Reconnected to ResearchOS as ${currentUser} from the encrypted backup. Send a photo to attach it to your open experiment, or to your Inbox.`,
      );
    } catch {
      // best effort confirmation ping
    }
    setState({ kind: "toast" });
    window.setTimeout(() => {
      setState((prev) => (prev.kind === "toast" ? { kind: "hidden" } : prev));
    }, RESTORE_TOAST_TTL_MS);
  }, [currentUser, isConnected]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on deps change
    void evaluate();
  }, [evaluate]);

  useEffect(() => {
    checkedKeyRef.current = null;
  }, [currentUser, isConnected]);

  if (state.kind !== "toast") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-[120] pointer-events-none"
    >
      <div className="pointer-events-auto flex items-center gap-2 px-4 py-2 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 rounded-xl shadow-lg shadow-emerald-100/60 text-emerald-800 dark:text-emerald-300 text-body">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
        <span>Restored your Telegram pairing from the encrypted backup.</span>
      </div>
    </div>
  );
}
