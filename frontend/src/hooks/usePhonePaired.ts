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

export interface PairedDevices {
  /** How many phones are currently bound to this identity. */
  count: number;
  /** Label of the first bound phone, or null when unlabeled / none paired. */
  firstLabel: string | null;
}

/**
 * Like usePhonePaired but returns the bound-phone count plus the first phone's
 * label, so a surface can show "Paired to {phone}" or "{n} phones paired"
 * rather than a bare boolean. Same 15s poll. listDevices already returns the
 * full device list, so this is the same call usePhonePaired makes, just not
 * collapsed to a boolean.
 */
export function usePairedDevices(): PairedDevices {
  const [state, setState] = useState<PairedDevices>({
    count: 0,
    firstLabel: null,
  });

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const keys = await loadUserCaptureKeys();
        if (!keys) {
          if (!cancelled) setState({ count: 0, firstLabel: null });
          return;
        }
        const devices = await listDevices(keys);
        if (!cancelled) {
          setState({
            count: devices.length,
            firstLabel: devices[0]?.label ?? null,
          });
        }
      } catch {
        // Network or relay hiccup. Keep the last known value rather than
        // flicker the indicator on a transient failure.
      }
    };

    void check();
    const id = setInterval(() => void check(), 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return state;
}
