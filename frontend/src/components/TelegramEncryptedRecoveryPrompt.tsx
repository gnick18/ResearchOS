// SENSITIVE: this surface re-arms a previously paired bot from the
// encrypted disk sidecar at users/<u>/_telegram-encrypted.json when
// `_telegram.json` has gone missing. Decryption is gated on the user's
// account password (we have no in-memory password cache, by design).
// See SECURITY_AUDIT.md §1.3 for the threat model.
//
// Trigger predicate (boot / folder-open / user-switch — NOT on poll failure):
//   readPairing(user) === null
//   && settings.telegramAutoReconnect === true
//   && hasEncryptedBackup(user) === true
//   && IDB token cache for {folder, user} is absent (otherwise the
//      faster, password-free TelegramRecoveryPrompt handles it)

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

type PromptState =
  | { kind: "hidden" }
  | { kind: "show" }
  | { kind: "verifying" }
  | { kind: "restored" }
  | { kind: "error"; message: string };

export default function TelegramEncryptedRecoveryPrompt() {
  const { currentUser } = useCurrentUser();
  const { isConnected } = useFileSystem();
  const [state, setState] = useState<PromptState>({ kind: "hidden" });
  const [passwordInput, setPasswordInput] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // One-shot guard so we don't re-show the prompt inside the same
  // {folder, user} session after the user dismisses it.
  const checkedKeyRef = useRef<string | null>(null);

  const evaluate = useCallback(async () => {
    if (!currentUser || !isConnected) {
      setState({ kind: "hidden" });
      return;
    }
    const meta = await getStoredDirectoryMeta();
    const folder = meta?.name;
    if (!folder) {
      setState({ kind: "hidden" });
      return;
    }
    const triggerKey = `${folder}:${currentUser}`;
    if (checkedKeyRef.current === triggerKey) return;
    checkedKeyRef.current = triggerKey;

    const onDisk = await readPairing(currentUser);
    if (onDisk) {
      setState({ kind: "hidden" });
      return;
    }

    const settings = await readUserSettings(currentUser);
    if (!settings.telegramAutoReconnect) {
      setState({ kind: "hidden" });
      return;
    }
    const backup = await hasEncryptedBackup(currentUser);
    if (!backup) {
      setState({ kind: "hidden" });
      return;
    }
    // If the IDB cache can handle this without a password, defer to it.
    const cached = await readTelegramTokenCache(folder, currentUser);
    if (cached) {
      setState({ kind: "hidden" });
      return;
    }
    setState({ kind: "show" });
  }, [currentUser, isConnected]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on deps change
    void evaluate();
  }, [evaluate]);

  useEffect(() => {
    checkedKeyRef.current = null;
  }, [currentUser, isConnected]);

  const handleRestore = useCallback(async () => {
    if (!currentUser) return;
    if (!passwordInput) return;
    setState({ kind: "verifying" });
    try {
      const payload = await decryptEncryptedBackup(currentUser, passwordInput);
      if (payload === null) {
        setState({ kind: "error", message: "Incorrect account password (or backup unreadable)." });
        return;
      }
      // botFirstName is not in the encrypted payload (security-manager
      // constraint #6). Leave it undefined; the next polling tick will
      // repopulate it via getMe() through telegram-runtime.
      const pairing: TelegramPairing = {
        botToken: payload.botToken,
        botUsername: payload.botUsername,
        chatId: payload.chatId,
        // Cursor self-heals on the first long-poll — Telegram replies
        // with the latest pending updates regardless of an unknown
        // offset, and updateLastUpdateId catches us up after that.
        lastUpdateId: 0,
        pairedAt: new Date().toISOString(),
      };
      await writePairing(currentUser, pairing);
      // Confirmation ping. Best-effort — failure here does not roll
      // back the sidecar write, the polling loop will start fine.
      try {
        await sendMessage(
          payload.botToken,
          payload.chatId,
          `Reconnected to ResearchOS as ${currentUser} from the encrypted backup. Send a photo to attach it to your open experiment, or to your Inbox.`,
        );
      } catch {
        /* ignore */
      }
      setPasswordInput("");
      setState({ kind: "restored" });
    } catch (err) {
      console.error("[encrypted-recovery] restore failed", err);
      setState({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Restore failed unexpectedly.",
      });
    }
  }, [currentUser, passwordInput]);

  const handleDismiss = useCallback(() => {
    setState({ kind: "hidden" });
    setPasswordInput("");
  }, []);

  const handleForget = useCallback(async () => {
    if (!currentUser) return;
    try {
      await deleteEncryptedBackup(currentUser);
    } catch (err) {
      console.warn("[encrypted-recovery] forget failed", err);
    }
    setState({ kind: "hidden" });
    setPasswordInput("");
  }, [currentUser]);

  if (state.kind === "hidden" || state.kind === "restored") return null;

  return (
    <div
      role="status"
      className="w-full bg-amber-50 border-b border-amber-200 text-amber-950 text-sm px-4 py-2"
    >
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          {state.kind === "show" && (
            <>
              Your Telegram pairing file is missing. Enter your account
              password to restore the bot token from the encrypted backup.
            </>
          )}
          {state.kind === "verifying" && (
            <>Restoring from encrypted backup…</>
          )}
          {state.kind === "error" && <>{state.message}</>}
        </div>
        {(state.kind === "show" || state.kind === "error") && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="relative">
              <input
                type="text"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleRestore();
                }}
                autoComplete="off"
                placeholder="Account password"
                className={`pl-3 pr-12 py-1 border border-amber-300 rounded-md text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500${!showPassword ? " [-webkit-text-security:disc]" : ""}`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-1 top-1/2 -translate-y-1/2 px-1 text-[10px] text-amber-700 hover:text-amber-900"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            <button
              type="button"
              onClick={() => void handleRestore()}
              disabled={!passwordInput}
              className="px-3 py-1 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-md transition-colors disabled:opacity-50"
            >
              Restore
            </button>
            <button
              type="button"
              onClick={() => void handleForget()}
              className="px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 rounded-md transition-colors"
              title="Delete the encrypted backup and re-pair from scratch"
            >
              Forget
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              className="px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 rounded-md transition-colors"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
