"use client";

// The quiet Telegram entry point in the top bar: a single paper-plane icon with
// a tiny status dot. The dot is the WHOLE state vocabulary, green (connected and
// healthy), amber (needs attention), or hollow (not connected). Clicking opens
// the consolidated TelegramPopup; everything else (bot name, pairing, problems,
// management) lives in there. This replaces the old six-mode TelegramStatusBadge
// and its "ANOTHER TAB / Switch to this tab" pill, conflict popover, and labels.
//
// It still mounts the inbound-photo polling pipeline (the badge used to), so
// removing the badge from the header does not stop messages from arriving.
//
// House style: no em-dashes, no emojis, no mid-sentence colons. Icon-only button
// uses <Tooltip>.

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
import { useTelegramPopup } from "@/lib/telegram/telegram-popup-store";
import Tooltip from "@/components/Tooltip";

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

export default function TelegramHeaderButton({
  tinted = false,
}: {
  /** True when the app header is a colored (project-tinted) header. */
  tinted?: boolean;
} = {}) {
  const { currentUser } = useCurrentUser();
  const open = useTelegramPopup((s) => s.open);
  const openPopup = useTelegramPopup((s) => s.openPopup);

  const [pairing, setPairing] = useState<TelegramPairing | null>(null);
  const reload = useCallback(async () => {
    if (!currentUser) {
      setPairing(null);
      return;
    }
    setPairing(await readPairing(currentUser));
  }, [currentUser]);

  // Re-read on mount and whenever the popup closes (a connect/disconnect there
  // changes the pairing on disk).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on deps change
    void reload();
  }, [reload, open]);

  // Keep the inbound photo pipeline alive. Short-circuits when not paired.
  useTelegramPolling(pairing ? currentUser : null);

  const [health, setHealth] = useState<PollingHealth>(getPollingHealth());
  useEffect(() => subscribePollingHealth(setHealth), []);
  const [stale, setStale] = useState<StaleSignal>(() => getStaleSignal());
  useEffect(() => subscribeStaleSignal(setStale), []);

  if (!currentUser) return null;

  const paired = !!pairing;
  const healthy = paired && health === "ok" && !stale.isStale;
  const needsAttention = paired && !healthy;

  // Dot tone: emerald healthy, amber attention, hollow when not connected.
  const dotClass = !paired
    ? "bg-transparent border border-foreground-muted/50"
    : healthy
      ? "bg-emerald-500"
      : "bg-amber-400";

  const tooltip = !paired
    ? "Connect a Telegram bot to send photos to your inbox"
    : needsAttention
      ? `Telegram needs attention. Open to fix (@${pairing.botUsername}).`
      : `Telegram connected as @${pairing.botUsername}`;

  const buttonClass = tinted
    ? "text-white/90 hover:text-white hover:bg-white/15"
    : "text-foreground-muted hover:text-foreground hover:bg-foreground-muted/10";

  return (
    <Tooltip label={open ? "" : tooltip} placement="bottom">
      <button
        type="button"
        onClick={(e) => openPopup({ x: e.clientX, y: e.clientY })}
        aria-label={tooltip}
        aria-expanded={open}
        className={`relative flex h-7 w-7 items-center justify-center rounded-full transition-colors ${buttonClass}`}
      >
        <PaperPlaneIcon className="h-4 w-4" />
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ${
            tinted ? "ring-[color:var(--header-tint,#2563eb)]" : "ring-surface"
          } ${dotClass}`}
          aria-hidden="true"
        />
      </button>
    </Tooltip>
  );
}
