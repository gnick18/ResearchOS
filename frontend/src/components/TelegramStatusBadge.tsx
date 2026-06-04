"use client";

import { useCallback, useEffect, useState } from "react";
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

export default function TelegramStatusBadge() {
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

  const toneClass =
    presentation.tone === "error"
      ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
      : presentation.tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
        : presentation.tone === "standby"
          ? "border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100"
          : "border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100";

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
        className="flex items-center justify-center w-7 h-7 rounded-full bg-white/75 shadow-sm text-gray-400 hover:text-gray-600 hover:bg-white transition-colors"
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
