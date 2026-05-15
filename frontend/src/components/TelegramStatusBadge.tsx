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
import { imageEvents } from "@/lib/attachments/image-events";
import TelegramPairingModal from "./TelegramPairingModal";

const HEALTH_PRESENTATION: Record<
  PollingHealth,
  { dot: string; label?: string; tone: "ok" | "warn" | "error" | "idle" }
> = {
  ok: { dot: "bg-emerald-500", tone: "ok" },
  retrying: { dot: "bg-amber-400 animate-pulse", label: "retrying", tone: "warn" },
  conflict: {
    dot: "bg-amber-400",
    label: "another tab is polling",
    tone: "warn",
  },
  auth_error: { dot: "bg-red-500", label: "re-pair needed", tone: "error" },
  idle: { dot: "bg-gray-300", tone: "idle" },
};

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

  if (!currentUser) return null;

  const paired = !!pairing;
  const presentation = paired ? HEALTH_PRESENTATION[health] : HEALTH_PRESENTATION.idle;
  const toneClass =
    presentation.tone === "error"
      ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
      : presentation.tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
        : paired
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          : "border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100";

  return (
    <>
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
        {paired && health === "ok" ? (
          // Active-connection glow: an expanding emerald halo around a
          // solid dot, so the badge visibly "breathes" while polling is
          // healthy. Other states use a flat dot so they stand out from
          // the healthy steady-state.
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
