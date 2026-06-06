"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { readPairing, type TelegramPairing } from "@/lib/telegram/telegram-store";
import { useTelegramPolling } from "@/lib/telegram/use-telegram-polling";
import {
  getPollingHealth,
  requestTakeover,
  subscribePollingHealth,
  type PollingHealth,
} from "@/lib/telegram/telegram-runtime";
import {
  getStaleSignal,
  subscribeStaleSignal,
  type StaleSignal,
} from "@/lib/telegram/staleness";
import { resolveBadgePresentation } from "@/lib/telegram/badge-presentation";
import TelegramPairingModal from "./TelegramPairingModal";
import Tooltip from "./Tooltip";

// Copy shown on hover when polling has gone stale — the recovery action
// is one user-side message away, so the tooltip just tells them the magic
// words rather than offering a button. Replaces the older app-wide amber
// banner; the badge's emerald→amber flip is now the sole visual signal.
const STALE_TOOLTIP_LABEL =
  "Send a message in your Telegram app to refresh the stale connection.";

// Copy shown on hover when another open tab is the active poller. Calm and
// reassuring on purpose: with one stable leader tab, multiple tabs just work
// (the inbound image lands in your shared local data either way), so there is
// nothing to close and nothing to fix. The adjacent "Switch to this tab" button
// is the only action, for when the user wants THIS tab to do the polling.
const STANDBY_TOOLTIP_LABEL =
  "Telegram is running in another open tab. This tab is on standby — your messages still come through, so there is nothing to close. Click \"Switch to this tab\" to handle them here instead.";

export default function TelegramStatusBadge({
  tinted = false,
}: {
  /** True when the app header is a colored (project-tinted) header, so the
   *  neutral pill uses a clean white-on-color treatment like the nav pills
   *  instead of the muted token fill (which looks muddy on a vivid header). */
  tinted?: boolean;
} = {}) {
  const { currentUser } = useCurrentUser();
  const [pairing, setPairing] = useState<TelegramPairing | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const reload = useCallback(async () => {
    if (!currentUser) {
      setPairing(null);
      return;
    }
    const p = await readPairing(currentUser);
    setPairing(p);
  }, [currentUser]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on deps change
    void reload();
  }, [reload]);

  // Drive the inbound photo pipeline. The hook short-circuits when the user
  // isn't paired and self-throttles via a cross-tab lock.
  useTelegramPolling(pairing ? currentUser : null);

  const [health, setHealth] = useState<PollingHealth>(getPollingHealth());
  useEffect(() => subscribePollingHealth(setHealth), []);

  // Subscribe to the stale-polling signal so a long-quiet long-poll
  // flips the dot from emerald to amber (and reveals the recovery
  // tooltip below) without waiting for the next health-state change.
  const [staleSignal, setStaleSignal] = useState<StaleSignal>(() =>
    getStaleSignal(),
  );
  useEffect(() => subscribeStaleSignal(setStaleSignal), []);

  // Conflict state: the badge collapses to a quiet amber dot, and clicking it
  // opens a small popover that explains a separate client is polling and
  // offers a one-click takeover. Popover open/close + click-outside live here
  // as unconditional hooks (before any early return) per rules of hooks.
  const [conflictOpen, setConflictOpen] = useState(false);
  const conflictRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!conflictOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (conflictRef.current && !conflictRef.current.contains(e.target as Node)) {
        setConflictOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [conflictOpen]);

  if (!currentUser) return null;

  const paired = !!pairing;
  const presentation = resolveBadgePresentation({
    paired,
    health,
    isStale: staleSignal.isStale,
  });
  const isStandby = paired && presentation.tone === "standby";

  // Header-declutter pass (2026-06-02): the badge used to be a loud pill
  // showing "Telegram: @botname" + an uppercase status word + a "+N"
  // recent-photo counter + a breathing emerald glow. Two beta testers
  // flagged the top nav as busy. The status badge is now a single quiet
  // dot in the calm steady-state; the bot name, the per-arrival counter,
  // and connection management all moved off the header. Inbound photos
  // still surface via the adjacent Inbox affordance, and full connection
  // management (pairing, auto-reconnect, encrypted backup, the on/off
  // notifications switch) lives in Settings -> Notifications & behavior
  // (`/settings#telegram`). The badge is kept (and still mounts the
  // polling pipeline + the pairing modal), but only RAISES ITS VOICE when
  // there is something the user must see: a connection problem (warn /
  // error / stale), the standby handoff, or an unpaired "Connect" prompt.
  //
  // "calm" === paired and healthy (tone ok, not stale): nothing is wrong,
  // so we render a bare dot with no pill chrome, no label, no name.
  const calm = paired && presentation.tone === "ok" && !staleSignal.isStale;

  // Conflict === a genuinely separate client (another browser profile or
  // device) is polling the same bot, so this tab stepped aside. Grant asked
  // for this to be a quiet amber dot rather than a loud "ANOTHER CLIENT IS
  // USING THIS BOT" pill, with the explanation + takeover behind a click.
  const isConflict = paired && health === "conflict";

  // Neutral "Connect / standby" pill. On a colored (tinted) header it must be a
  // clean white-on-color pill (like the nav pills); otherwise the muted token
  // fill reads as a muddy smear on a vivid header. On the normal header it uses
  // the token fill that works in both light (subtle gray) and dark (legible
  // light-translucent).
  const neutralClass = tinted
    ? "border-white/40 bg-white/85 text-gray-700 hover:bg-white shadow-sm"
    : "border-border bg-foreground-muted/10 text-foreground hover:bg-foreground-muted/20";
  const toneClass =
    presentation.tone === "error"
      ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-600 dark:border-red-600 dark:text-white dark:hover:bg-red-700"
      : presentation.tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-600 dark:border-amber-600 dark:text-white dark:hover:bg-amber-700"
        : neutralClass;

  // Detail string surfaced on hover (and used as the dot's title) so the
  // bot name and live status are one hover away rather than always-on text.
  const detailTitle = paired
    ? `Telegram connected as @${pairing.botUsername}${presentation.label ? ` (${presentation.label})` : ""}. Manage in Settings -> Notifications & behavior.`
    : "Connect a Telegram bot to send photos to your inbox.";

  if (calm) {
    // Quiet steady-state: a single small dot, no pill, no text, no glow,
    // no counter. Clicking still opens the pairing/manage modal; the
    // tooltip carries the bot name and points at Settings.
    const calmDot = (
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        aria-label={detailTitle}
        title={detailTitle}
        className="flex items-center justify-center w-7 h-7 rounded-full bg-surface-raised/75 shadow-sm text-foreground-muted hover:text-foreground-muted hover:bg-surface-raised transition-colors"
      >
        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
      </button>
    );
    return (
      <>
        <Tooltip label={detailTitle} placement="bottom">
          {calmDot}
        </Tooltip>
        {modalOpen && (
          <TelegramPairingModal
            username={currentUser}
            onClose={(updated) => {
              setModalOpen(false);
              if (updated === undefined) return;
              setPairing(updated);
            }}
          />
        )}
      </>
    );
  }

  if (isConflict) {
    // Quiet amber dot, same footprint as the calm dot. The detail and the
    // takeover offer live in a click-opened popover so the header stays calm
    // (no shouty uppercase pill) while the signal is still discoverable.
    const conflictHint = `Another client is connected to @${pairing.botUsername}. Click for details.`;
    return (
      <div ref={conflictRef} className="relative">
        <Tooltip label={conflictHint} placement="bottom">
          <button
            type="button"
            onClick={() => setConflictOpen((open) => !open)}
            aria-label={conflictHint}
            aria-expanded={conflictOpen}
            className="flex items-center justify-center w-7 h-7 rounded-full bg-surface-raised/75 shadow-sm hover:bg-surface-raised transition-colors"
          >
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
          </button>
        </Tooltip>
        {conflictOpen && (
          <div className="absolute right-0 mt-2 w-72 z-50 rounded-lg border border-border bg-surface-raised shadow-lg p-3 text-left">
            <div className="flex items-start gap-2">
              <span className="mt-1 inline-block w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
              <div className="space-y-1">
                <p className="text-body font-medium text-foreground">
                  Another client is using this bot
                </p>
                <p className="text-meta text-foreground-muted leading-relaxed">
                  A different browser or device is connected to @
                  {pairing.botUsername} and is handling its messages, so this tab
                  stepped aside. Take over to handle Telegram here instead.
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConflictOpen(false)}
                className="px-2.5 py-1 text-meta font-medium text-foreground-muted hover:bg-surface-sunken rounded-md transition-colors"
              >
                Leave it
              </button>
              <button
                type="button"
                onClick={() => {
                  requestTakeover();
                  setConflictOpen(false);
                }}
                className="px-2.5 py-1 text-meta font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Use this tab
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Attention states (warn / error / stale / standby / unpaired): keep a
  // visible labeled chip so the user can SEE that something needs them. This
  // is the load-bearing "messages may not be arriving" signal the spec said
  // to preserve; it just no longer competes for attention in the calm case.
  const badgeButton = (
    <button
      type="button"
      onClick={() => setModalOpen(true)}
      title={detailTitle}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-meta font-medium border transition-colors ${toneClass}`}
    >
      <span className={`inline-block w-2 h-2 rounded-full ${presentation.dot}`} />
      {paired ? "Telegram" : "Connect Telegram"}
      {paired && presentation.label && (
        <span className="ml-1 text-meta uppercase tracking-wide">
          {presentation.label}
        </span>
      )}
    </button>
  );

  return (
    <>
      {isStandby ? (
        // Another open tab is the active poller. Calm gray badge + an
        // explanatory tooltip + a one-click "Use this tab" handoff. No
        // "close your tabs" alarm: the leader fix means multiple tabs just
        // work, so this is purely informational.
        <span className="flex items-center gap-1.5">
          <Tooltip label={STANDBY_TOOLTIP_LABEL}>{badgeButton}</Tooltip>
          <Tooltip label="Move the live Telegram connection to this browser tab so messages arrive here.">
            <button
              type="button"
              onClick={() => requestTakeover()}
              className="px-2 py-1 text-meta font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Switch to this tab
            </button>
          </Tooltip>
        </span>
      ) : staleSignal.isStale ? (
        // Hover-only surface — touch devices and keyboard users still see
        // the amber dot flip, which is the load-bearing signal. The
        // tooltip is a secondary cue for desktop hover, replacing the
        // older full-width amber banner Grant flagged as too prominent.
        <Tooltip label={STALE_TOOLTIP_LABEL}>{badgeButton}</Tooltip>
      ) : (
        badgeButton
      )}
      {modalOpen && (
        <TelegramPairingModal
          username={currentUser}
          onClose={(updated) => {
            setModalOpen(false);
            if (updated === undefined) return;
            setPairing(updated);
          }}
        />
      )}
    </>
  );
}
