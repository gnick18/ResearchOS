"use client";

import { useCallback, useEffect, useState } from "react";
import {
  onUserSettingsWritten,
  readUserSettings,
} from "@/lib/settings/user-settings";
import { setMethodTypeEnabled } from "@/lib/methods/method-type-enablement";
import type { MethodTypeId } from "@/lib/methods/method-type-registry";

/**
 * Read (and toggle) the active user's `enabledMethodTypes` curation set
 * (Extension Store Phase U2, extension-store U2 bot, 2026-05-29).
 *
 * Mirrors `useAccountType`: subscribes to `onUserSettingsWritten` so a toggle
 * made in the store shell propagates to the create modal's picker without a
 * route change, and ignores writes for OTHER users so a multi-tab session
 * doesn't cross-pollute.
 *
 * Returns:
 *   - `raw`: the raw persisted array, or `null` while loading / when the
 *     field is absent (absent => all enabled; consumers pass this straight
 *     into `resolveEnabledMethodTypes`, which applies the default).
 *   - `setEnabled(id, on)`: persist a single type's enablement. Optimistically
 *     updates local state, then writes; the written-bus refresh reconciles.
 */
export function useEnabledMethodTypes(username: string | null): {
  raw: string[] | null;
  setEnabled: (id: MethodTypeId, on: boolean) => Promise<void>;
} {
  const [raw, setRaw] = useState<string[] | null>(null);

  useEffect(() => {
    if (!username) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sign-out transition: the previous user's enabled set must clear immediately, no I/O involved, so the synchronous setState is the correct shape (mirrors useAccountType).
      setRaw(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const settings = await readUserSettings(username);
        if (!cancelled) setRaw(settings.enabledMethodTypes ?? null);
      } catch (err) {
        console.warn("[useEnabledMethodTypes] readUserSettings failed", err);
        if (!cancelled) setRaw(null);
      }
    })();

    const unsubscribe = onUserSettingsWritten((event) => {
      if (cancelled) return;
      if (event.username !== username) return;
      setRaw(event.next.enabledMethodTypes ?? null);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [username]);

  const setEnabled = useCallback(
    async (id: MethodTypeId, on: boolean) => {
      if (!username) return;
      const updated = await setMethodTypeEnabled(username, id, on);
      // The written-bus subscriber above also fires; setting here keeps the
      // caller's view immediate even if the bus dispatch is a microtask away.
      setRaw(updated.enabledMethodTypes ?? null);
    },
    [username],
  );

  return { raw, setEnabled };
}
