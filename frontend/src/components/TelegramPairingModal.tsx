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
              ]);
            } catch {
              /* ignore */
            }
            // Friendly confirmation to the user's Telegram chat. Best-effort.
            try {
              await sendMessage(
                step.token,
                chatId,
                `✅ Paired with ResearchOS as ${username}. Send photos here while an experiment is open and they'll land in that experiment's image strip.`
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
          <div className="flex items-center gap-3">
            <span className="text-2xl">📱</span>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Connect Telegram</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Send lab-bench photos straight into the open experiment.
              </p>
            </div>
          </div>
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
            <p className="text-xs text-gray-500">
              Send any photo to{" "}
              <span className="font-medium">@{step.pairing.botUsername}</span> while an
              experiment is open and it&apos;ll appear in that experiment&apos;s image
              strip.
            </p>
            <div className="flex items-center justify-between gap-2 pt-2">
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="px-3 py-2 text-xs text-red-600 border border-red-200 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
              >
                {disconnecting ? "Disconnecting…" : "🔌 Disconnect bot"}
              </button>
              <button
                onClick={handleCancel}
                className="px-5 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors font-medium"
              >
                ✓ Keep paired
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
              <label className="block text-xs font-medium text-gray-500 mb-2">
                Bot token
              </label>
              <input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleValidate();
                }}
                placeholder="123456:ABC-DEF…"
                autoFocus
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
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
            <div className="text-2xl">⏳</div>
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
            <div className="text-3xl">✅</div>
            <p className="text-sm text-gray-700">
              Paired with{" "}
              <span className="font-medium">@{step.pairing.botUsername}</span>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
