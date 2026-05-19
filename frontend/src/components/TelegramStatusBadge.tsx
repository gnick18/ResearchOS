"use client";

import { useCallback, useEffect, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { readPairing, type TelegramPairing } from "@/lib/telegram/telegram-store";
import { useTelegramPolling } from "@/lib/telegram/use-telegram-polling";
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
import { resolveBadgePresentation } from "@/lib/telegram/badge-presentation";
import { imageEvents } from "@/lib/attachments/image-events";
import TelegramPairingModal from "./TelegramPairingModal";
import Tooltip from "./Tooltip";

// Copy shown on hover when polling has gone stale — the recovery action
// is one user-side message away, so the tooltip just tells them the magic
// words rather than offering a button. Replaces the older app-wide amber
// banner; the badge's emerald→amber flip is now the sole visual signal.
const STALE_TOOLTIP_LABEL =
  "Send a message in your Telegram app to refresh the stale connection.";

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

  // Bump the displayed counters when new images arrive — gives the user
  // visual confirmation in the header that the connection is alive.
  const [recent, setRecent] = useState(0);
  useEffect(() => {
    const unsub = imageEvents.onAttached(() => setRecent((n) => n + 1));
    return unsub;
  }, []);

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
  const toneClass =
    presentation.tone === "error"
      ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
      : presentation.tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
        : paired
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          : "border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100";

  const badgeButton = (
    <button
      type="button"
      onClick={() => setModalOpen(true)}
      title={
        paired
          ? `Paired with @${pairing.botUsername}${presentation.label ? ` (${presentation.label})` : ""}`
          : "Connect a Telegram bot to send photos"
      }
      data-onboarding-target="telegram-send-to-task"
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${toneClass}`}
    >
      {presentation.glow ? (
        // Active-connection glow: an expanding emerald halo around a
        // solid dot, so the badge visibly "breathes" while polling is
        // healthy. Other states (including stale) use a flat dot so
        // they stand out from the healthy steady-state.
        <span className="relative flex w-2 h-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
          <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_1px_rgba(16,185,129,0.7)]" />
        </span>
      ) : (
        <span className={`inline-block w-2 h-2 rounded-full ${presentation.dot}`} />
      )}
      {paired ? `Telegram: @${pairing.botUsername}` : "Connect Telegram"}
      {paired && presentation.label && (
        <span className="ml-1 text-[10px] uppercase tracking-wide">
          {presentation.label}
        </span>
      )}
      {paired && recent > 0 && (
        <span className="ml-1 text-emerald-600">+{recent}</span>
      )}
    </button>
  );

  return (
    <>
      {staleSignal.isStale ? (
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
