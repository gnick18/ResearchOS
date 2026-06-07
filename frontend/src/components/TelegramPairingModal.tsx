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
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { writeEncryptedBackup } from "@/lib/telegram/encrypted-backup";
import { loadIdentity } from "@/lib/sharing/identity/storage";
import Tooltip from "./Tooltip";

interface TelegramPairingModalProps {
  username: string;
  /** Called when the modal is dismissed. Pass the new pairing (or null if
   *  disconnected) so the parent can update its cached state. Pass `undefined`
   *  if the user simply cancelled without changing anything. */
  onClose: (updated: TelegramPairing | null | undefined) => void;
  /** When true, render only the white card contents (no fixed-position
   *  black overlay, no rounded outer chrome). Used by the Onboarding v2
   *  wizard's Step 4 to embed the pair flow inline inside the wizard's
   *  body. Default false preserves the original modal behavior the
   *  Settings page consumer depends on. */
  inline?: boolean;
}

type Step =
  | { kind: "loading" }
  | { kind: "alreadyPaired"; pairing: TelegramPairing }
  | { kind: "enterToken"; error?: string }
  | {
      kind: "waitForStart";
      token: string;
      botUsername: string;
      botFirstName?: string;
      /** When true, the user opted into the encrypted backup at enterToken
       *  time. We defer the actual writeEncryptedBackup call to here because
       *  the chatId isn't known until /start lands. The backup is keyed off
       *  the on-device keypair, loaded at write time. */
      encryptedBackup?: boolean;
    }
  | { kind: "success"; pairing: TelegramPairing };

export default function TelegramPairingModal({
  username,
  onClose,
  inline = false,
}: TelegramPairingModalProps) {
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [tokenInput, setTokenInput] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [validating, setValidating] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  // Opt-in encrypted-backup state. Off by default per the security posture
  // review — the disk backup is a power-user "remember across browser wipes"
  // feature, not the default. It is keyed off the on-device identity keypair, so
  // it is offered only when a keypair exists (the user is signed in).
  const [saveBackup, setSaveBackup] = useState(false);
  const [hasIdentity, setHasIdentity] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    (async () => {
      const existing = await readPairing(username);
      setHasIdentity((await loadIdentity()) !== null);
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
            // If the user opted into the encrypted backup at this pairing's
            // enterToken step, we deferred the write until chatId was known
            // (only available after /start). The backup is keyed off the
            // on-device keypair, loaded here at write time.
            if (step.encryptedBackup) {
              try {
                const identity = await loadIdentity();
                if (identity) {
                  // botFirstName is intentionally NOT in the encrypted payload
                  // (constraint #6), it is recovered via getMe() on the next poll.
                  await writeEncryptedBackup(
                    username,
                    {
                      botToken: step.token,
                      chatId,
                      botUsername: step.botUsername,
                    },
                    identity.keys.encryption.privateKey,
                  );
                  await ensureGitignoreEntries([
                    "_telegram-encrypted.json",
                    "users/*/_telegram-encrypted.json",
                  ]);
                }
              } catch (err) {
                console.warn("[pairing-modal] encrypted-backup write failed", err);
              }
            }
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
      // The backup is keyed off the on-device keypair, so opting in needs no
      // password, just a signed-in identity. The actual write is deferred until
      // the chatId is known (inside the waitForStart effect).
      const wantsBackup = saveBackup && hasIdentity;
      const info = await getMe(token);
      setStep({
        kind: "waitForStart",
        token,
        botUsername: info.username,
        botFirstName: info.first_name,
        encryptedBackup: wantsBackup,
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

  // Escape closes this modal (app-wide convention), through the same cancel
  // path the close button uses. Skip in inline mode: the wizard shell that
  // embeds the pair flow owns dismissal there.
  useEscapeToClose(handleCancel, !inline);

  // The pair-flow card body. Identical between modal and inline modes;
  // the only difference is the surrounding chrome (fixed-position
  // overlay + max-w-md card vs. fits-the-wizard-body container).
  const cardBody = (
    <>
      <div className="px-5 py-4 border-b border-border bg-surface-sunken">
          <h3 className="text-title font-semibold text-foreground">Connect Telegram</h3>
          <p className="text-meta text-foreground-muted mt-0.5">
            Send lab-bench photos straight into the open experiment.
          </p>
        </div>

        {step.kind === "loading" && (
          <div className="px-5 py-8 text-center text-body text-foreground-muted">Loading…</div>
        )}

        {step.kind === "alreadyPaired" && (
          <div className="px-5 py-4 space-y-4">
            <div className="bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 rounded-lg p-3">
              <p className="text-body text-emerald-800 dark:text-emerald-300">
                Paired with{" "}
                <span className="font-medium">@{step.pairing.botUsername}</span> since{" "}
                {new Date(step.pairing.pairedAt).toLocaleDateString()}.
              </p>
              <p className="text-meta text-emerald-700 dark:text-emerald-300 mt-1">
                Chat id: {step.pairing.chatId}
              </p>
            </div>
            <div className="text-meta text-foreground-muted space-y-2">
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
              <p className="text-foreground-muted">
                After each photo the bot asks for a caption. Reply with a
                sentence, or send <span className="font-mono">/skip</span>.
              </p>
            </div>
            <div className="flex items-center justify-between gap-2 pt-2">
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="px-3 py-2 text-meta text-red-600 dark:text-red-300 border border-red-200 dark:border-red-500/30 hover:bg-red-50 dark:hover:bg-red-500/20 rounded-lg transition-colors disabled:opacity-50"
              >
                {disconnecting ? "Disconnecting…" : "Disconnect bot"}
              </button>
              <button
                onClick={handleCancel}
                className="px-5 py-2 text-body text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors font-medium"
              >
                Keep paired
              </button>
            </div>
            <p className="text-meta text-foreground-muted text-center pt-1">
              &quot;Keep paired&quot; just closes this dialog — your connection stays active.
            </p>
          </div>
        )}

        {step.kind === "enterToken" && (
          <div className="px-5 py-4 space-y-4">
            <ol className="text-meta text-foreground-muted space-y-1 list-decimal list-inside">
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
                <label className="text-meta font-medium text-foreground-muted">
                  Bot token
                </label>
                <Tooltip
                  label="Stored in users/<your-username>/_telegram.json on your disk, with a .gitignore rule appended automatically. Your browser uses this token to talk directly to api.telegram.org (not through our server) when polling for new messages."
                  placement="top"
                >
                  <button
                    type="button"
                    aria-label="Where does this go?"
                    className="text-foreground-muted hover:text-foreground-muted text-meta leading-none"
                  >
                    (?)
                  </button>
                </Tooltip>
              </div>
              <div className="relative">
                <input
                  type="text"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleValidate();
                  }}
                  placeholder="123456:ABC-DEF…"
                  autoFocus
                  autoComplete="off"
                  className={`w-full pl-3 pr-10 py-2 border border-border rounded-lg text-body font-mono focus:outline-none focus:ring-2 focus:ring-blue-500${!showToken ? " [-webkit-text-security:disc]" : ""}`}
                />
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  aria-label={showToken ? "Hide token" : "Show token"}
                  aria-pressed={showToken}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-foreground-muted hover:text-foreground-muted rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                <p className="mt-2 text-meta text-red-600 dark:text-red-300">{step.error}</p>
              )}
            </div>
            {hasIdentity ? (
              <div className="space-y-2 border-t border-border pt-3">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={saveBackup}
                    onChange={(e) => setSaveBackup(e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 rounded border-border text-blue-600 dark:text-blue-300 focus:ring-blue-500"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-meta font-medium text-foreground">
                        Save encrypted backup for auto-reconnect
                      </span>
                      <Tooltip
                        label="If _telegram.json ever goes missing (cloud-sync conflict, browser wipe, manual cleanup), an encrypted backup at _telegram-encrypted.json lets ResearchOS reconnect automatically, no re-paste needed. Encrypted with AES-GCM and a key derived from your on-device identity keypair, so the backup is useless to anyone without your account."
                        placement="top"
                      >
                        <button
                          type="button"
                          aria-label="What does this do?"
                          className="text-foreground-muted hover:text-foreground-muted text-meta leading-none"
                        >
                          (?)
                        </button>
                      </Tooltip>
                    </div>
                    {!saveBackup && (
                      <p className="mt-1 text-meta italic text-amber-600 dark:text-amber-300">
                        You&apos;ll need to re-paste your bot token if the
                        local pairing file is lost.
                      </p>
                    )}
                  </div>
                </label>
              </div>
            ) : (
              <p className="text-meta italic text-amber-600 dark:text-amber-300">
                You&apos;ll need to re-paste your bot token if the local pairing
                file is lost. (Sign in to unlock the encrypted-backup option.)
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleValidate}
                disabled={!tokenInput.trim() || validating}
                className="px-4 py-2 text-body text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {validating ? "Checking…" : "Connect"}
              </button>
            </div>
          </div>
        )}

        {step.kind === "waitForStart" && (
          <div className="px-5 py-6 space-y-4 text-center">
            <p className="text-body text-foreground">
              Token accepted for{" "}
              <span className="font-medium">@{step.botUsername}</span>.
            </p>
            <p className="text-body text-foreground-muted">
              Open Telegram on your phone, message{" "}
              <span className="font-medium">@{step.botUsername}</span>, and send{" "}
              <span className="font-mono">/start</span> (or any message).
            </p>
            <div className="flex justify-center">
              <span className="inline-flex h-3 w-3 animate-pulse rounded-full bg-blue-400" />
            </div>
            <p className="text-meta text-amber-600 dark:text-amber-300">
              Pairing isn&apos;t saved until you send your bot a message in its
              chat.
            </p>
            <button
              onClick={handleCancel}
              className="text-meta text-foreground-muted hover:text-foreground-muted underline"
            >
              Cancel pairing
            </button>
          </div>
        )}

        {step.kind === "success" && (
          <div className="px-5 py-6 space-y-3 text-center">
            <p className="text-body font-medium text-emerald-700 dark:text-emerald-300">
              Paired with{" "}
              <span className="font-semibold">@{step.pairing.botUsername}</span>.
            </p>
          </div>
        )}
    </>
  );

  // Inline mode (Onboarding v2 wizard Step 4): render the bare card
  // content inside a transparent wrapper so the wizard's body owns the
  // chrome. No backdrop, no fixed positioning, no rounded outer card,
  // the wizard's white card already provides those.
  if (inline) {
    return (
      <div className="border border-border rounded-xl overflow-hidden bg-surface-raised">
        {cardBody}
      </div>
    );
  }

  // Modal mode (Settings consumer): the original portal-less overlay
  // pattern. Click on the dim background = cancel; click on the inner
  // card stops propagation so the user doesn't accidentally close while
  // pasting a token.
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      // Marker for TourSpotlight (popup-occluding sweep manager,
      // 2026-05-27). Hides the v4 walkthrough ring while this popup
      // is mounted; see SnapshotTilePopup for the canonical example.
      data-tour-popup-occluding="telegram-pairing"
      onClick={handleCancel}
    >
      <div
        className="bg-surface-raised rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {cardBody}
      </div>
    </div>
  );
}
