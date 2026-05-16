// SENSITIVE: this surface re-arms a previously paired bot from the IDB
// token cache when `_telegram.json` has gone missing. The cache holds bot
// tokens — see SECURITY_AUDIT.md §1.3 for the threat model and the
// security-manager-approved constraints behind every branch below.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getMe, sendMessage } from "@/lib/telegram/telegram-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useAppStore } from "@/lib/store";
import { getStoredDirectoryMeta } from "@/lib/file-system/indexeddb-store";
import {
  readPairing,
  writePairing,
  type TelegramPairing,
} from "@/lib/telegram/telegram-store";
import {
  clearTelegramTokenCacheEntry,
  readTelegramTokenCache,
  type CachedTelegramToken,
} from "@/lib/telegram/telegram-token-cache";
import { decideRecovery, type RecoveryDecision } from "@/lib/telegram/telegram-recovery";
import Tooltip from "./Tooltip";

type PromptState =
  | { kind: "hidden" }
  | { kind: "show"; cached: CachedTelegramToken; botUsername: string; botFirstName?: string }
  | { kind: "showOffline"; cached: CachedTelegramToken }
  | { kind: "retry"; cached: CachedTelegramToken }
  | { kind: "reconnecting" }
  | { kind: "error"; message: string };

export default function TelegramRecoveryPrompt() {
  const { currentUser } = useCurrentUser();
  const { isConnected } = useFileSystem();
  const offlineMode = useAppStore((s) => s.offlineMode);
  const [state, setState] = useState<PromptState>({ kind: "hidden" });
  // Guard against running the predicate twice in a session for the same
  // {folder, user} — once dismissed, we don't want a re-check while still
  // mounted to resurrect the prompt. New folder / user resets the guard.
  const checkedKeyRef = useRef<string | null>(null);

  // ── Trigger predicate (security-manager-gated, constraint [trigger]):
  // readPairing(user) === null && idbCache(folder, user) !== null
  // Fires on boot / folder-open / user-switch. NOT on poll failure.
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

    // Disk wins. The readPairing call also lazy-refreshes the cache via
    // constraint [4] so the snapshot's in sync with disk on the way out.
    const onDisk = await readPairing(currentUser);
    if (onDisk) {
      setState({ kind: "hidden" });
      return;
    }

    const cached = await readTelegramTokenCache(folder, currentUser);
    const decision: RecoveryDecision = await decideRecovery({
      cached,
      offlineMode,
      getMe,
    });

    switch (decision.kind) {
      case "none":
        setState({ kind: "hidden" });
        return;
      case "drop":
        // Constraint [8]: 401 / 403 → silently drop, no prompt. Token is
        // revoked in BotFather; offering recovery would dead-end the user.
        await clearTelegramTokenCacheEntry(folder, currentUser);
        setState({ kind: "hidden" });
        return;
      case "show":
        setState({
          kind: "show",
          cached: decision.cached,
          botUsername: decision.botInfo.username,
          botFirstName: decision.botInfo.first_name,
        });
        return;
      case "showOffline":
        setState({ kind: "showOffline", cached: decision.cached });
        return;
      case "retry":
        setState({ kind: "retry", cached: decision.cached });
        return;
    }
  }, [currentUser, isConnected, offlineMode]);

  useEffect(() => {
    // Re-evaluate whenever boot / folder-open / user-switch transitions
    // the {folder, user} pair. The ref-guard makes this idempotent within
    // a single key.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on deps change
    void evaluate();
  }, [evaluate]);

  // Reset the per-key guard when currentUser or isConnected changes (so
  // a fresh user-switch / folder-open re-checks the predicate).
  useEffect(() => {
    checkedKeyRef.current = null;
  }, [currentUser, isConnected]);

  const handleRetry = useCallback(async () => {
    checkedKeyRef.current = null;
    await evaluate();
  }, [evaluate]);

  const handleReconnect = useCallback(async () => {
    if (state.kind !== "show" && state.kind !== "retry") return;
    if (offlineMode) return; // belt-and-braces; CTA should already be disabled
    if (!currentUser) return;

    const cached =
      state.kind === "show"
        ? state.cached
        : state.cached;

    setState({ kind: "reconnecting" });
    try {
      // Re-derive the disk sidecar from the cache. `lastUpdateId: 0` is
      // safe: the polling loop tolerates an unknown cursor and Telegram
      // will reply with the latest pending updates on the first long-poll.
      const pairing: TelegramPairing = {
        botToken: cached.botToken,
        botUsername: cached.botUsername,
        chatId: cached.chatId,
        lastUpdateId: 0,
        pairedAt: new Date().toISOString(),
      };
      await writePairing(currentUser, pairing);
      // Friendly chat ping so the user gets visible confirmation that the
      // recovery worked. Best-effort — failure here doesn't roll back the
      // sidecar write.
      try {
        await sendMessage(
          cached.botToken,
          cached.chatId,
          `Reconnected to ResearchOS as ${currentUser}. Send a photo to attach it to your open experiment, or to your Inbox.`,
        );
      } catch {
        /* ignore */
      }
      setState({ kind: "hidden" });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Reconnect failed.",
      });
    }
  }, [state, currentUser, offlineMode]);

  const handleSetUpNew = useCallback(async () => {
    if (state.kind === "hidden" || state.kind === "reconnecting") return;
    const meta = await getStoredDirectoryMeta();
    const folder = meta?.name;
    if (folder && currentUser) {
      // Constraint [7]: rejecting recovery clears the cache entry for
      // this {folder, user} so the prompt doesn't reappear next boot.
      await clearTelegramTokenCacheEntry(folder, currentUser);
    }
    setState({ kind: "hidden" });
  }, [state, currentUser]);

  if (state.kind === "hidden") return null;

  const handle =
    state.kind === "show"
      ? `@${state.botUsername}`
      : (state.kind === "showOffline" || state.kind === "retry" || state.kind === "reconnecting" || state.kind === "error")
        ? state.kind === "showOffline" || state.kind === "retry"
          ? `@${state.cached.botUsername}`
          : "your bot"
        : "your bot";

  // Render
  return (
    <div
      role="status"
      className="w-full bg-blue-50 border-b border-blue-200 text-blue-950 text-sm px-4 py-2"
    >
      <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          {state.kind === "show" && (
            <>
              We still have <strong className="font-semibold">{handle}</strong>{" "}
              cached for you in this folder. Reconnect to keep using it without
              re-pasting the bot token, or set up a different bot.
            </>
          )}
          {state.kind === "showOffline" && (
            <>
              We still have <strong className="font-semibold">{handle}</strong>{" "}
              cached for you. Offline mode is on, so we can&apos;t verify the
              bot right now — disable Offline mode in Settings to reconnect.
            </>
          )}
          {state.kind === "retry" && (
            <>
              Couldn&apos;t verify <strong className="font-semibold">{handle}</strong>{" "}
              right now (Telegram unreachable). Your cached bot is still here
              — retry when your connection is back.
            </>
          )}
          {state.kind === "reconnecting" && (
            <>Reconnecting <strong className="font-semibold">{handle}</strong>…</>
          )}
          {state.kind === "error" && (
            <>Reconnect failed: {state.message}</>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {state.kind === "retry" && (
            <button
              type="button"
              onClick={handleRetry}
              className="px-3 py-1 text-xs font-medium text-blue-700 border border-blue-300 hover:bg-blue-100 rounded-md transition-colors"
            >
              Retry
            </button>
          )}
          {state.kind === "show" && (
            <ReconnectButton
              offlineMode={offlineMode}
              onClick={handleReconnect}
            />
          )}
          {state.kind === "showOffline" && (
            <ReconnectButton offlineMode={true} onClick={() => {}} />
          )}
          {(state.kind === "show" ||
            state.kind === "showOffline" ||
            state.kind === "retry" ||
            state.kind === "error") && (
            <button
              type="button"
              onClick={handleSetUpNew}
              className="px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 rounded-md transition-colors"
            >
              Set up new bot
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ReconnectButton({
  offlineMode,
  onClick,
}: {
  offlineMode: boolean;
  onClick: () => void;
}) {
  const btn = (
    <button
      type="button"
      onClick={onClick}
      disabled={offlineMode}
      className="px-3 py-1 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      Reconnect
    </button>
  );
  if (!offlineMode) return btn;
  return (
    <Tooltip
      label="Disable Offline mode in Settings to reconnect."
      placement="bottom"
    >
      {btn}
    </Tooltip>
  );
}
