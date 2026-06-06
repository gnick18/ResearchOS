"use client";

// The Telegram auto-reconnect (encrypted-backup) toggle, extracted from the old
// Settings TelegramAutoReconnectRow so the consolidated TelegramPopup can own
// the same behavior. Flipping ON encrypts the current bot token under the
// on-device identity keypair and writes _telegram-encrypted.json; flipping OFF
// deletes that sidecar. No password, the keypair is the secret.
//
// The hook reads and writes the user's settings directly so callers do not need
// to thread a settings object through, and exposes the live enabled/busy/error
// state plus any reason the toggle is currently unavailable.

import { useCallback, useEffect, useState } from "react";
import { loadIdentity } from "@/lib/sharing/identity/storage";
import { readPairing } from "@/lib/telegram/telegram-store";
import {
  deleteEncryptedBackup,
  hasEncryptedBackup,
  writeEncryptedBackup,
} from "@/lib/telegram/encrypted-backup";
import { ensureGitignoreEntries } from "@/lib/file-system/gitignore";
import {
  patchUserSettings,
  readUserSettings,
} from "@/lib/settings/user-settings";

export interface UseTelegramAutoReconnect {
  /** True when the encrypted backup is on (setting flag AND sidecar present). */
  enabled: boolean;
  busy: boolean;
  error: string | null;
  hasIdentity: boolean | null;
  /** Toggle the encrypted backup on or off. */
  toggle: (next: boolean) => Promise<void>;
  /** Re-read disk state (call after a (dis)connect changes the pairing). */
  refresh: () => Promise<void>;
}

export function useTelegramAutoReconnect(
  username: string | null,
): UseTelegramAutoReconnect {
  const [hasIdentity, setHasIdentity] = useState<boolean | null>(null);
  const [backupExists, setBackupExists] = useState<boolean | null>(null);
  const [flag, setFlag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!username) {
      setHasIdentity(null);
      setBackupExists(null);
      setFlag(false);
      return;
    }
    const [identity, backup, settings] = await Promise.all([
      loadIdentity(),
      hasEncryptedBackup(username),
      readUserSettings(username),
    ]);
    setHasIdentity(identity !== null);
    setBackupExists(backup);
    setFlag(settings.telegramAutoReconnect);
  }, [username]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const toggle = useCallback(
    async (next: boolean) => {
      if (!username) return;
      setError(null);
      if (next) {
        const identity = await loadIdentity();
        if (!identity) {
          setError("Sign in first so the backup can be encrypted to your account.");
          return;
        }
        const pairing = await readPairing(username);
        if (!pairing) {
          setError("Pair Telegram first, there is no bot token to back up yet.");
          return;
        }
        setBusy(true);
        try {
          await writeEncryptedBackup(
            username,
            {
              botToken: pairing.botToken,
              chatId: pairing.chatId,
              botUsername: pairing.botUsername,
            },
            identity.keys.encryption.privateKey,
          );
          try {
            await ensureGitignoreEntries([
              "_telegram-encrypted.json",
              "users/*/_telegram-encrypted.json",
            ]);
          } catch {
            /* best-effort */
          }
          await patchUserSettings(username, { telegramAutoReconnect: true });
          setFlag(true);
          setBackupExists(true);
        } catch (err) {
          console.error("[telegram-autoreconnect] enable failed", err);
          setError("Could not write the encrypted backup. Try again.");
        } finally {
          setBusy(false);
        }
        return;
      }
      setBusy(true);
      try {
        await deleteEncryptedBackup(username);
        await patchUserSettings(username, { telegramAutoReconnect: false });
        setFlag(false);
        setBackupExists(false);
      } catch (err) {
        console.error("[telegram-autoreconnect] disable failed", err);
        setError("Could not delete the encrypted backup. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [username],
  );

  const enabled = flag && backupExists !== false;

  return { enabled, busy, error, hasIdentity, toggle, refresh };
}
