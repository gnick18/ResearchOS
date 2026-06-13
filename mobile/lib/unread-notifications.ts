// Unread badge for the companion's notifications bell. Fetches the phone-routed
// notifications snapshot the laptop publishes and counts the unread ones, so the
// Notebook header bell can show a small count. One round-trip per focus (and an
// optional interval), deliberately cheap: it reuses the same sealed snapshot the
// Notifications screen reads, so there is no extra relay surface.
//
// Read state is owned by the laptop bell; the count mirrors it. A failed sync
// just leaves the last known count (or zero) rather than surfacing an error,
// since a badge is a glance, not a screen.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';
import { fetchNotificationsSnapshot } from '@/lib/snapshots';

/**
 * Returns the number of unread phone-routed notifications, refreshed each time
 * the calling screen gains focus. Zero when unpaired or when the laptop has not
 * published. Never throws.
 */
export function useUnreadNotificationCount(): number {
  const { pairing } = usePairing();
  const [count, setCount] = useState(0);

  const pairingKey = pairing ? `${pairing.u}:${pairing.relayUrl}` : 'none';

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (!pairing) {
        setCount(0);
        return;
      }
      void (async () => {
        try {
          const snap = await fetchNotificationsSnapshot(pairing, signWithDevice);
          if (cancelled) return;
          const list = Array.isArray(snap?.notifications)
            ? snap!.notifications!
            : [];
          setCount(list.filter((n) => n.read === false).length);
        } catch {
          // A glance badge never surfaces an error; leave the last known count.
        }
      })();
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pairingKey]),
  );

  return count;
}
