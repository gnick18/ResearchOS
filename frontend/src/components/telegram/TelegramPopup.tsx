"use client";

// The single consolidated Telegram popup. One anchored popover (opened from the
// header icon, mirroring the researcher profile popup) that owns the WHOLE
// Telegram surface: pairing, connection status, notifications, encrypted-backup
// auto-reconnect, and disconnect. It replaces the old multi-step modal, the
// header's six-mode badge chrome, and the Settings Telegram section.
//
// Three states live inside the one popover: not connected (condensed pairing),
// connected (compact management), and a calm attention line when the live
// connection needs the user (stale or a health problem). Multi-tab handoff is
// deliberately invisible here, the runtime coordinates it silently.
//
// House style: no em-dashes, no emojis, no mid-sentence colons. Every icon is an
// inline SVG; icon-only buttons use <Tooltip>.

import { useCallback, useEffect, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useTelegramPopup } from "@/lib/telegram/telegram-popup-store";
import { useTelegramPairing } from "@/lib/telegram/use-telegram-pairing";
import { useTelegramAutoReconnect } from "@/lib/telegram/use-telegram-autoreconnect";
import {
  patchUserSettings,
  readUserSettings,
} from "@/lib/settings/user-settings";
import {
  getPollingHealth,
  subscribePollingHealth,
  type PollingHealth,
} from "@/lib/telegram/telegram-runtime";
import {
  getStaleSignal,
  subscribeStaleSignal,
  type StaleSignal,
} from "@/lib/telegram/staleness";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import Tooltip from "@/components/Tooltip";

// ---------------------------------------------------------------------------
// Small inline pieces
// ---------------------------------------------------------------------------

function PaperPlaneIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4Z" />
    </svg>
  );
}

function HelpDot({ label }: { label: string }) {
  return (
    <Tooltip label={label} placement="top">
      <button
        type="button"
        aria-label={label}
        className="text-foreground-muted hover:text-foreground text-meta leading-none"
      >
        (?)
      </button>
    </Tooltip>
  );
}

function ToggleSwitch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 ${
        checked ? "bg-blue-600" : "bg-foreground-muted/30"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function ManageRow({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-body text-foreground">{title}</span>
        {hint && <HelpDot label={hint} />}
      </div>
      {children}
    </div>
  );
}

const EyeOpen = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const EyeOff = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
    <line x1="2" x2="22" y1="2" y2="22" />
  </svg>
);

// ---------------------------------------------------------------------------
// Popup
// ---------------------------------------------------------------------------

/**
 * Optional banner shown at the top of the connected view when the live
 * connection needs the user. Calm one-liner, never an alarm.
 */
function AttentionLine({ attention }: { attention: string | null }) {
  if (!attention) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-meta text-amber-700 dark:border-amber-600 dark:bg-amber-600/20 dark:text-amber-200">
      {attention}
    </div>
  );
}

export default function TelegramPopup() {
  const { currentUser } = useCurrentUser();
  const open = useTelegramPopup((s) => s.open);
  const close = useTelegramPopup((s) => s.close);

  const [pairingChanged, setPairingChanged] = useState(0);
  const onChange = useCallback(() => setPairingChanged((n) => n + 1), []);

  const pairing = useTelegramPairing(currentUser ?? "", { onChange });
  const auto = useTelegramAutoReconnect(currentUser ?? null);

  // Notifications (polling) on/off, read straight from user settings.
  const [notifications, setNotifications] = useState<boolean | null>(null);
  useEffect(() => {
    if (!currentUser || !open) return;
    let cancelled = false;
    void (async () => {
      const s = await readUserSettings(currentUser);
      if (!cancelled) setNotifications(s.telegramNotifications);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser, open]);

  // After a connect/disconnect, refresh the auto-reconnect availability.
  useEffect(() => {
    if (pairingChanged > 0) void auto.refresh();
  }, [pairingChanged, auto]);

  // Live health + staleness, to surface a calm one-line attention banner in the
  // connected view. Multi-tab standby is intentionally NOT an attention state,
  // the runtime handles tab handoff silently.
  const [health, setHealth] = useState<PollingHealth>(getPollingHealth());
  useEffect(() => subscribePollingHealth(setHealth), []);
  const [stale, setStale] = useState<StaleSignal>(() => getStaleSignal());
  useEffect(() => subscribeStaleSignal(setStale), []);

  useEscapeToClose(close, open);

  if (!open || !currentUser) return null;

  const attention: string | null = stale.isStale
    ? "Connection looks stale. Send your bot a message to refresh it."
    : health === "auth_error"
      ? "Re-pair needed. Disconnect and connect again with a fresh token."
      : health === "conflict"
        ? "Also connected on another device, which is handling messages."
        : health === "retrying"
          ? "Reconnecting..."
          : null;

  const setNotif = (next: boolean) => {
    setNotifications(next);
    void patchUserSettings(currentUser, { telegramNotifications: next });
  };

  const handleDisconnect = async () => {
    const ok = window.confirm(
      "Disconnect your Telegram bot? Inbound photos will stop arriving until you re-pair. Your existing photos and notes are untouched.",
    );
    if (!ok) return;
    await pairing.disconnect();
    onChange();
  };

  const step = pairing.step;
  const connected = step.kind === "alreadyPaired" || step.kind === "success";

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/30 backdrop-blur-sm"
      data-tour-popup-occluding="telegram-popup"
      onClick={close}
    >
      <div
        className="absolute right-3 top-14 w-[360px] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-border bg-surface-raised shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Telegram connection"
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#229ED9]/10 text-[#229ED9]">
            <PaperPlaneIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-body font-semibold text-foreground leading-tight">
              Telegram
            </p>
            <p className="text-meta text-foreground-muted leading-tight">
              {connected && "pairing" in step
                ? `Connected as @${step.pairing.botUsername}`
                : "Send lab-bench photos to your inbox"}
            </p>
          </div>
          <Tooltip label="Close" placement="bottom">
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="text-foreground-muted hover:text-foreground rounded p-1"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </Tooltip>
        </div>

        <div className="px-4 py-4 space-y-4">
          {step.kind === "loading" && (
            <p className="text-body text-foreground-muted text-center py-4">
              Loading...
            </p>
          )}

          {/* Not connected: condensed pairing */}
          {step.kind === "enterToken" && (
            <div className="space-y-3">
              <div className="flex items-center gap-1.5">
                <label className="text-meta font-medium text-foreground-muted">
                  Bot token
                </label>
                <HelpDot label="Create a bot by messaging @BotFather on Telegram and sending /newbot, then paste the access token it gives you. It is stored in users/<your-username>/_telegram.json on your disk (gitignored) and your browser talks directly to api.telegram.org with it." />
              </div>
              <div className="relative">
                <input
                  type="text"
                  value={pairing.tokenInput}
                  onChange={(e) => pairing.setTokenInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void pairing.validate();
                  }}
                  placeholder="123456:ABC-DEF..."
                  autoFocus
                  autoComplete="off"
                  className={`w-full pl-3 pr-10 py-2 border border-border rounded-lg text-body font-mono bg-surface focus:outline-none focus:ring-2 focus:ring-blue-500${
                    !pairing.showToken ? " [-webkit-text-security:disc]" : ""
                  }`}
                />
                <button
                  type="button"
                  onClick={() => pairing.setShowToken(!pairing.showToken)}
                  aria-label={pairing.showToken ? "Hide token" : "Show token"}
                  aria-pressed={pairing.showToken}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-foreground-muted hover:text-foreground rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {pairing.showToken ? EyeOff : EyeOpen}
                </button>
              </div>
              {step.error && (
                <p className="text-meta text-red-600">{step.error}</p>
              )}

              {pairing.hasIdentity ? (
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pairing.saveBackup}
                    onChange={(e) => pairing.setSaveBackup(e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 rounded border-border text-blue-600 focus:ring-blue-500"
                  />
                  <span className="flex items-center gap-1.5 text-meta text-foreground-muted">
                    Save encrypted backup for auto-reconnect
                    <HelpDot label="If the local pairing file is ever lost, an encrypted backup lets ResearchOS reconnect automatically with no re-paste. Encrypted with a key derived from your on-device identity, so it is useless to anyone without your account." />
                  </span>
                </label>
              ) : (
                <p className="text-meta italic text-amber-600">
                  Sign in to unlock the encrypted-backup option.
                </p>
              )}

              <button
                type="button"
                onClick={() => void pairing.validate()}
                disabled={!pairing.tokenInput.trim() || pairing.validating}
                className="w-full py-2 text-body text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {pairing.validating ? "Checking..." : "Connect"}
              </button>
            </div>
          )}

          {/* Waiting for the user's first message */}
          {step.kind === "waitForStart" && (
            <div className="space-y-3 text-center py-2">
              <p className="text-body text-foreground">
                Token accepted for{" "}
                <span className="font-medium">@{step.botUsername}</span>.
              </p>
              <p className="text-body text-foreground-muted">
                Open Telegram, message{" "}
                <span className="font-medium">@{step.botUsername}</span>, and
                send <span className="font-mono">/start</span>.
              </p>
              <div className="flex justify-center">
                <span className="inline-flex h-3 w-3 animate-pulse rounded-full bg-blue-400" />
              </div>
              <p className="text-meta text-amber-600">
                Pairing isn&apos;t saved until you send your bot a message in its
                chat.
              </p>
              <button
                type="button"
                onClick={pairing.cancelWait}
                className="text-meta text-foreground-muted hover:text-foreground underline"
              >
                Cancel pairing
              </button>
            </div>
          )}

          {step.kind === "success" && (
            <p className="text-body font-medium text-emerald-600 text-center py-4">
              Paired with @{step.pairing.botUsername}.
            </p>
          )}

          {/* Connected: management */}
          {step.kind === "alreadyPaired" && (
            <div className="space-y-1">
              <AttentionLine attention={attention} />
              <ManageRow
                title="Notifications"
                hint="When off, the app stops polling Telegram for inbound photos."
              >
                <ToggleSwitch
                  checked={notifications ?? true}
                  onChange={setNotif}
                  label="Telegram notifications"
                />
              </ManageRow>
              <ManageRow
                title="Auto-reconnect"
                hint="Saves your bot token encrypted to your on-device identity so ResearchOS can reconnect if the local pairing file is lost. The backup never leaves your folder."
              >
                <ToggleSwitch
                  checked={auto.enabled}
                  disabled={auto.busy || auto.hasIdentity === false}
                  onChange={(v) => void auto.toggle(v)}
                  label="Auto-reconnect Telegram bot"
                />
              </ManageRow>
              {auto.error && (
                <p className="text-meta text-red-600">{auto.error}</p>
              )}
              {auto.hasIdentity === false && (
                <p className="text-meta text-foreground-muted">
                  Sign in to enable the encrypted backup.
                </p>
              )}
              <div className="pt-2 mt-1 border-t border-border">
                <button
                  type="button"
                  onClick={() => void handleDisconnect()}
                  disabled={pairing.disconnecting}
                  className="text-meta text-red-600 hover:underline disabled:opacity-50"
                >
                  {pairing.disconnecting ? "Disconnecting..." : "Disconnect bot"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
