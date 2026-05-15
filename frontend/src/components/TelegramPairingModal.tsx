"use client";

import { useEffect, useRef, useState } from "react";
import { getMe, getUpdates, sendMessage, TelegramApiError } from "@/lib/telegram/telegram-client";
import {
  clearPairing,
  readPairing,
  writePairing,
  type TelegramPairing,
} from "@/lib/telegram/telegram-store";
import { ensureGitignoreEntries } from "@/lib/file-system/gitignore";
import Tooltip from "./Tooltip";

interface TelegramPairingModalProps {
  username: string;
  /** Called when the modal is dismissed. Pass the new pairing (or null if
   *  disconnected) so the parent can update its cached state. Pass `undefined`
   *  if the user simply cancelled without changing anything. */
  onClose: (updated: TelegramPairing | null | undefined) => void;
}

type Step =
  | { kind: "loading" }
  | { kind: "alreadyPaired"; pairing: TelegramPairing }
  | { kind: "enterToken"; error?: string }
  | { kind: "waitForStart"; token: string; botUsername: string; botFirstName?: string }
  | { kind: "success"; pairing: TelegramPairing };

export default function TelegramPairingModal({ username, onClose }: TelegramPairingModalProps) {
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [tokenInput, setTokenInput] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [validating, setValidating] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    (async () => {
      const existing = await readPairing(username);
      if (existing) {
        setStep({ kind: "alreadyPaired", pairing: existing });
      } else {
        setStep({ kind: "enterToken" });
      }
    })();
  }, [username]);

  // Long-poll loop during the "waitForStart" step. Stops on unmount or step
  // change because the AbortController is created per-step.
  useEffect(() => {
    if (step.kind !== "waitForStart") return;
    const controller = new AbortController();
    abortRef.current = controller;
    let cancelled = false;

    (async () => {
      let offset: number | undefined;
      while (!cancelled) {
        try {
          const updates = await getUpdates(step.token, {
            offset,
            timeout: 25,
            signal: controller.signal,
          });
          if (cancelled) return;
          for (const update of updates) {
            offset = update.update_id + 1;
            const msg = update.message;
            if (!msg) continue;
            const chatId = msg.chat.id;
            const pairing: TelegramPairing = {
              botToken: step.token,
              botUsername: step.botUsername,
              botFirstName: step.botFirstName,
              chatId,
              lastUpdateId: update.update_id,
              pairedAt: new Date().toISOString(),
            };
            await writePairing(username, pairing);
            // Make sure the bot token never accidentally gets committed if
            // the data folder is a git repo (it carries an active Telegram
            // bot credential). Best-effort; failure is non-fatal.
            try {
              await ensureGitignoreEntries([
                "_telegram.json",
                "users/*/_telegram.json",
                // No secrets in the tutorial sidecar, but it lives
                // alongside _telegram.json and changes frequently
                // during the guided tour. Keeps the data folder's git
                // history (if any) free of policy-only churn.
                "_telegram_tutorial.json",
                "users/*/_telegram_tutorial.json",
              ]);
            } catch {
              /* ignore */
            }
            // Friendly confirmation to the user's Telegram chat. Mirrors
            // the dual-mode framing the bot's `/start` reply uses now,
            // so the very first thing a user sees after pairing is the
            // full mental model (active task auto-attaches, no task
            // routes to Inbox). Best-effort.
            try {
              await sendMessage(
                step.token,
                chatId,
                `Paired with ResearchOS as ${username}.\n\n` +
                  "Send me a photo and I'll route it two ways:\n\n" +
                  "1. With an experiment popup OPEN in ResearchOS, the photo attaches to that experiment's image strip.\n" +
                  "2. With nothing open, the photo lands in your Inbox (badge in the top bar) to file later.\n\n" +
                  "After each photo I'll ask for a caption. Reply with a sentence, or send /skip. Type /help any time."
              );
            } catch {
              /* ignore */
            }
            setStep({ kind: "success", pairing });
            window.setTimeout(() => onClose(pairing), 1200);
            return;
          }
        } catch (err) {
          if (cancelled) return;
          if (err instanceof DOMException && err.name === "AbortError") return;
          // Transient errors: backoff briefly and retry.
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [step, username, onClose]);

  const handleValidate = async () => {
    const token = tokenInput.trim();
    if (!token) return;
    setValidating(true);
    try {
      const info = await getMe(token);
      setStep({
        kind: "waitForStart",
        token,
        botUsername: info.username,
        botFirstName: info.first_name,
      });
    } catch (err) {
      const message =
        err instanceof TelegramApiError
          ? err.message
          : "Couldn't reach Telegram. Check the token and your network.";
      setStep({ kind: "enterToken", error: message });
    } finally {
      setValidating(false);
    }
  };

  const handleDisconnect = async () => {
    const ok = window.confirm(
      "Disconnect your Telegram bot? Inbound photos will stop arriving until you re-pair. Your existing photos and notes are untouched."
    );
    if (!ok) return;
    setDisconnecting(true);
    try {
      await clearPairing(username);
      onClose(null);
    } finally {
      setDisconnecting(false);
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    onClose(undefined);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={handleCancel}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
          <h3 className="text-base font-semibold text-gray-900">Connect Telegram</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Send lab-bench photos straight into the open experiment.
          </p>
        </div>

        {step.kind === "loading" && (
          <div className="px-5 py-8 text-center text-sm text-gray-500">Loading…</div>
        )}

        {step.kind === "alreadyPaired" && (
          <div className="px-5 py-4 space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              <p className="text-sm text-emerald-800">
                Paired with{" "}
                <span className="font-medium">@{step.pairing.botUsername}</span> since{" "}
                {new Date(step.pairing.pairedAt).toLocaleDateString()}.
              </p>
              <p className="text-xs text-emerald-700 mt-1">
                Chat id: {step.pairing.chatId}
              </p>
            </div>
            <div className="text-xs text-gray-600 space-y-2">
              <p>
                Send a photo to{" "}
                <span className="font-medium">@{step.pairing.botUsername}</span>{" "}
                and it routes two ways:
              </p>
              <ol className="list-decimal list-inside space-y-1 pl-1">
                <li>
                  With an experiment popup OPEN in ResearchOS, the photo
                  attaches to that experiment&apos;s image strip.
                </li>
                <li>
                  With nothing open, the photo lands in your Inbox (top-bar
                  badge) to file later.
                </li>
              </ol>
              <p className="text-gray-500">
                After each photo the bot asks for a caption. Reply with a
                sentence, or send <span className="font-mono">/skip</span>.
              </p>
            </div>
            <div className="flex items-center justify-between gap-2 pt-2">
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="px-3 py-2 text-xs text-red-600 border border-red-200 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
              >
                {disconnecting ? "Disconnecting…" : "Disconnect bot"}
              </button>
              <button
                onClick={handleCancel}
                className="px-5 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors font-medium"
              >
                Keep paired
              </button>
            </div>
            <p className="text-[10px] text-gray-400 text-center pt-1">
              &quot;Keep paired&quot; just closes this dialog — your connection stays active.
            </p>
          </div>
        )}

        {step.kind === "enterToken" && (
          <div className="px-5 py-4 space-y-4">
            <ol className="text-xs text-gray-600 space-y-1 list-decimal list-inside">
              <li>
                Open Telegram on your phone and message{" "}
                <span className="font-mono">@BotFather</span>.
              </li>
              <li>
                Send <span className="font-mono">/newbot</span> and follow the prompts to
                name your bot.
              </li>
              <li>Paste the access token BotFather gives you below.</li>
            </ol>
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <label className="text-xs font-medium text-gray-500">
                  Bot token
                </label>
                <Tooltip
                  label="Stored in users/<your-username>/_telegram.json on your disk, with a .gitignore rule appended automatically. Your browser uses this token to talk directly to api.telegram.org (not through our server) when polling for new messages."
                  placement="top"
                >
                  <button
                    type="button"
                    aria-label="Where does this go?"
                    className="text-gray-400 hover:text-gray-600 text-[11px] leading-none"
                  >
                    (?)
                  </button>
                </Tooltip>
              </div>
              <div className="relative">
                <input
                  type={showToken ? "text" : "password"}
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleValidate();
                  }}
                  placeholder="123456:ABC-DEF…"
                  autoFocus
                  className="w-full pl-3 pr-10 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  aria-label={showToken ? "Hide token" : "Show token"}
                  aria-pressed={showToken}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {showToken ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                      <line x1="2" x2="22" y1="2" y2="22" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
              {step.error && (
                <p className="mt-2 text-xs text-red-600">{step.error}</p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleValidate}
                disabled={!tokenInput.trim() || validating}
                className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {validating ? "Checking…" : "Connect"}
              </button>
            </div>
          </div>
        )}

        {step.kind === "waitForStart" && (
          <div className="px-5 py-6 space-y-4 text-center">
            <p className="text-sm text-gray-700">
              Token accepted for{" "}
              <span className="font-medium">@{step.botUsername}</span>.
            </p>
            <p className="text-sm text-gray-600">
              Open Telegram on your phone, message{" "}
              <span className="font-medium">@{step.botUsername}</span>, and send{" "}
              <span className="font-mono">/start</span> (or any message).
            </p>
            <div className="flex justify-center">
              <span className="inline-flex h-3 w-3 animate-pulse rounded-full bg-blue-400" />
            </div>
            <p className="text-[11px] text-amber-600">
              Pairing isn&apos;t saved until your bot receives a message.
            </p>
            <button
              onClick={handleCancel}
              className="text-xs text-gray-400 hover:text-gray-600 underline"
            >
              Cancel pairing
            </button>
          </div>
        )}

        {step.kind === "success" && (
          <div className="px-5 py-6 space-y-3 text-center">
            <p className="text-sm font-medium text-emerald-700">
              Paired with{" "}
              <span className="font-semibold">@{step.pairing.botUsername}</span>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
