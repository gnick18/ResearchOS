"use client";

import { useCallback, useEffect, useState } from "react";
import {
  onUserSettingsWritten,
  readUserSettings,
} from "@/lib/settings/user-settings";
import { setWidgetEnabled } from "@/lib/lab-overview/widget-enablement";

/**
 * Read (and toggle) the active user's `enabledWidgets` curation set (Extension
 * Store Phase U3, extension-store U3 bot, 2026-05-29).
 *
 * Mirrors `useEnabledMethodTypes`: subscribes to `onUserSettingsWritten` so a
 * toggle made in the Widget store propagates to the "+ Add widget" palette
 * without a route change, and ignores writes for OTHER users so a multi-tab
 * session doesn't cross-pollute.
 *
 * Returns:
 *   - `raw`: the raw persisted array, or `null` while loading / when the field
 *     is absent (absent => all enabled; consumers pass this straight into
 *     `resolveEnabledWidgets`, which applies the default).
 *   - `setEnabled(id, on)`: persist a single widget's enablement. Optimistically
 *     updates local state, then writes; the written-bus refresh reconciles.
 */
export function useEnabledWidgets(username: string | null): {
  raw: string[] | null;
  setEnabled: (id: string, on: boolean) => Promise<void>;
} {
  const [raw, setRaw] = useState<string[] | null>(null);

  useEffect(() => {
    if (!username) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sign-out transition: the previous user's enabled set must clear immediately, no I/O involved, so the synchronous setState is the correct shape (mirrors useEnabledMethodTypes).
      setRaw(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const settings = await readUserSettings(username);
        if (!cancelled) setRaw(settings.enabledWidgets ?? null);
      } catch (err) {
        console.warn("[useEnabledWidgets] readUserSettings failed", err);
        if (!cancelled) setRaw(null);
      }
    })();

    const unsubscribe = onUserSettingsWritten((event) => {
      if (cancelled) return;
      if (event.username !== username) return;
      setRaw(event.next.enabledWidgets ?? null);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [username]);

  const setEnabled = useCallback(
    async (id: string, on: boolean) => {
      if (!username) return;
      const updated = await setWidgetEnabled(username, id, on);
      // The written-bus subscriber above also fires; setting here keeps the
      // caller's view immediate even if the bus dispatch is a microtask away.
      setRaw(updated.enabledWidgets ?? null);
    },
    [username],
  );

  return { raw, setEnabled };
}
