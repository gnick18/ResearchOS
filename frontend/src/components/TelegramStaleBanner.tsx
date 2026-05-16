"use client";

import { useEffect, useState } from "react";
import {
  getStaleSignal,
  subscribeStaleSignal,
  type StaleSignal,
} from "@/lib/telegram/staleness";

/**
 * Amber alert shown when the Telegram long-poll has gone quiet long
 * enough that the cursor is probably stale. The recovery is one
 * message away — send anything to the bot and the next long-poll
 * refreshes — so the banner is informational, not actionable beyond
 * telling the user the magic words. Hides automatically when the
 * polling hook clears the signal (any update arriving → counters
 * reset → `isStale` flips back to false).
 *
 * The badge in the header keeps showing "ok" while polling is stale
 * (empty long-poll responses are valid HTTPS 200s), so without this
 * banner the user has no signal that recovery is needed. See
 * `lib/telegram/staleness.ts` for the three-way conjunction that
 * gates the signal.
 *
 * Style mirrors `DemoLabBanner` — amber palette, `role="status"`,
 * inline SVG icon — so the visual language of "system is asking for
 * a small recovery action" stays consistent across the app.
 */
export default function TelegramStaleBanner() {
  const [signal, setSignal] = useState<StaleSignal>(() => getStaleSignal());

  useEffect(() => subscribeStaleSignal(setSignal), []);

  if (!signal.isStale) return null;

  const handle = signal.botUsername ? `@${signal.botUsername}` : "your bot";

  return (
    <div
      role="status"
      className="w-full bg-amber-100 border-b border-amber-300 text-amber-950 text-sm px-4 py-2 flex items-center gap-3"
    >
      <svg
        aria-hidden
        className="w-4 h-4 flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m0 3.5h.008m-9.382 1.5h18.748c1.733 0 2.815-1.875 1.948-3.375L13.948 4.625c-.866-1.5-3.03-1.5-3.896 0L2.674 18.25c-.866 1.5.217 3.375 1.95 3.375z"
        />
      </svg>
      <span className="flex-1">
        Telegram polling looks stale. Send any message to{" "}
        <strong className="font-semibold">{handle}</strong> in Telegram to
        refresh the connection.
      </span>
    </div>
  );
}
