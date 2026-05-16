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
 * Style mirrors `DemoLabBanner` — amber palette, `role="status"` —
 * so the visual language of "system is asking for a small recovery
 * action" stays consistent across the app. No icon: a leading warning
 * triangle read as noisy alongside the badge-dot color shift, so the
 * banner now leans on copy + palette alone.
 */
export default function TelegramStaleBanner() {
  const [signal, setSignal] = useState<StaleSignal>(() => getStaleSignal());

  useEffect(() => subscribeStaleSignal(setSignal), []);

  if (!signal.isStale) return null;

  const handle = signal.botUsername ? `@${signal.botUsername}` : "your bot";

  return (
    <div
      role="status"
      className="w-full bg-amber-100 border-b border-amber-300 text-amber-950 text-sm px-4 py-2"
    >
      Telegram polling looks stale. Send any message to{" "}
      <strong className="font-semibold">{handle}</strong> in Telegram to
      refresh the connection.
    </div>
  );
}
