"use client";

// The Telegram pairing state machine, extracted from the old
// TelegramPairingModal so the consolidated TelegramPopup can drive the same
// proven flow without duplicating the 130-line long-poll loop. The logic here
// is a faithful port of the modal's effects and handlers; only the surface
// (which component renders the steps) changed.
//
// Flow: loading -> (alreadyPaired | enterToken) -> waitForStart -> success ->
// alreadyPaired. The waitForStart step long-polls getUpdates until the user
// sends their bot a message, at which point the chatId is known and the pairing
// (plus the optional encrypted backup) is written to disk.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMe,
  getUpdates,
  sendMessage,
  TelegramApiError,
} from "@/lib/telegram/telegram-client";
import {
  clearPairing,
  readPairing,
  writePairing,
  type TelegramPairing,
} from "@/lib/telegram/telegram-store";
import { ensureGitignoreEntries } from "@/lib/file-system/gitignore";
import { writeEncryptedBackup } from "@/lib/telegram/encrypted-backup";
import { loadIdentity } from "@/lib/sharing/identity/storage";

export type PairingStep =
  | { kind: "loading" }
  | { kind: "alreadyPaired"; pairing: TelegramPairing }
  | { kind: "enterToken"; error?: string }
  | {
      kind: "waitForStart";
      token: string;
      botUsername: string;
      botFirstName?: string;
      encryptedBackup?: boolean;
    }
  | { kind: "success"; pairing: TelegramPairing };

export interface UseTelegramPairing {
  step: PairingStep;
  tokenInput: string;
  setTokenInput: (v: string) => void;
  showToken: boolean;
  setShowToken: (v: boolean) => void;
  validating: boolean;
  disconnecting: boolean;
  saveBackup: boolean;
  setSaveBackup: (v: boolean) => void;
  hasIdentity: boolean;
  /** Validate the pasted token and advance to the wait-for-message step. */
  validate: () => Promise<void>;
  /** Tear down the pairing, returns to the not-connected state. */
  disconnect: () => Promise<void>;
  /** Abort an in-flight wait and return to the token-entry step. */
  cancelWait: () => void;
}

export function useTelegramPairing(
  username: string,
  opts: { onChange?: (pairing: TelegramPairing | null) => void } = {},
): UseTelegramPairing {
  const { onChange } = opts;
  const [step, setStep] = useState<PairingStep>({ kind: "loading" });
  const [tokenInput, setTokenInput] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [validating, setValidating] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  // Off by default: the disk backup is a power-user "remember across browser
  // wipes" feature keyed off the on-device identity keypair, offered only when
  // a keypair exists (the user is signed in).
  const [saveBackup, setSaveBackup] = useState(false);
  const [hasIdentity, setHasIdentity] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Initial load: existing pairing -> manage view, otherwise -> token entry.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const existing = await readPairing(username);
      const identity = await loadIdentity();
      if (cancelled) return;
      setHasIdentity(identity !== null);
      setStep(
        existing
          ? { kind: "alreadyPaired", pairing: existing }
          : { kind: "enterToken" },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [username]);

  // Long-poll loop during waitForStart. Recreated per step so it stops on
  // unmount or step change via the AbortController.
  useEffect(() => {
    if (step.kind !== "waitForStart") return;
    const controller = new AbortController();
    abortRef.current = controller;
    let cancelled = false;

    void (async () => {
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
            // Deferred encrypted-backup write (chatId is only known after the
            // first message). Keyed off the on-device keypair, loaded here.
            if (step.encryptedBackup) {
              try {
                const identity = await loadIdentity();
                if (identity) {
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
                console.warn("[telegram-pairing] encrypted-backup write failed", err);
              }
            }
            // Keep the active bot credential out of any git history in the data
            // folder. Best-effort.
            try {
              await ensureGitignoreEntries([
                "_telegram.json",
                "users/*/_telegram.json",
                "_telegram_tutorial.json",
                "users/*/_telegram_tutorial.json",
              ]);
            } catch {
              /* ignore */
            }
            // Friendly confirmation to the user's Telegram chat. Best-effort.
            try {
              await sendMessage(
                step.token,
                chatId,
                `Paired with ResearchOS as ${username}.\n\n` +
                  "Send me a photo and I'll route it two ways:\n\n" +
                  "1. With an experiment popup OPEN in ResearchOS, the photo attaches to that experiment's image strip.\n" +
                  "2. With nothing open, the photo lands in your Inbox (badge in the top bar) to file later.\n\n" +
                  "After each photo I'll ask for a caption. Reply with a sentence, or send /skip. Type /help any time.",
              );
            } catch {
              /* ignore */
            }
            onChange?.(pairing);
            setStep({ kind: "success", pairing });
            // Brief success flash, then settle into the manage view.
            window.setTimeout(() => {
              if (!cancelled) setStep({ kind: "alreadyPaired", pairing });
            }, 1200);
            return;
          }
        } catch (err) {
          if (cancelled) return;
          if (err instanceof DOMException && err.name === "AbortError") return;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [step, username, onChange]);

  const validate = useCallback(async () => {
    const token = tokenInput.trim();
    if (!token) return;
    setValidating(true);
    try {
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
  }, [tokenInput, saveBackup, hasIdentity]);

  const disconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      await clearPairing(username);
      onChange?.(null);
      setTokenInput("");
      setStep({ kind: "enterToken" });
    } finally {
      setDisconnecting(false);
    }
  }, [username, onChange]);

  const cancelWait = useCallback(() => {
    abortRef.current?.abort();
    setStep({ kind: "enterToken" });
  }, []);

  return {
    step,
    tokenInput,
    setTokenInput,
    showToken,
    setShowToken,
    validating,
    disconnecting,
    saveBackup,
    setSaveBackup,
    hasIdentity,
    validate,
    disconnect,
    cancelWait,
  };
}
