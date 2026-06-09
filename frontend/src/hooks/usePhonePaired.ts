"use client";

import { useEffect, useState } from "react";
import { loadUserCaptureKeys } from "@/lib/mobile-relay/keys";
import { listDevices } from "@/lib/mobile-relay/client";

/**
 * True when at least one phone is paired to this user's capture relay. Polls
 * listDevices on mount and every 15s while mounted, and stays false when no
 * identity is unlocked or the relay is unreachable.
 *
 * Used to show the "your phone is watching this" indicator on the experiment
 * and note popups so the user can see, before snapping, that a capture will
 * route to what is open rather than the inbox.
 */
export function usePhonePaired(): boolean {
  const [paired, setPaired] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const keys = await loadUserCaptureKeys();
        if (!keys) {
          if (!cancelled) setPaired(false);
          return;
        }
        const devices = await listDevices(keys);
        if (!cancelled) setPaired(devices.length > 0);
      } catch {
        // Network or relay hiccup. Leave the last known value rather than
        // flicker the indicator off on a transient failure.
      }
    };

    void check();
    const id = setInterval(() => void check(), 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return paired;
}
