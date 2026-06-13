// Expo push token registration (phone push P1, the wake-and-fetch buzz).
//
// Gets this device's Expo push token and registers it with the relay so the
// paired laptop can send a GENERIC, content-free buzz when a phone-routed
// notification lands. On receipt the companion wakes and fetches the sealed
// notifications snapshot it already reads (lib/snapshots.ts), so plaintext only
// ever exists on the phone. The token itself is a routing identifier, never lab
// content.
//
// Two registration paths, both best-effort and fully fail-soft (a missing token
// just means this phone never buzzes, the synced list still works):
//   - At pairing (called from app/pair.tsx after the device is bound).
//   - On launch / when the notifications screen opens (rotation + a grant given
//     after pairing). Expo tokens rotate, and the OS notification permission can
//     be granted later, so the durable path is this device-signed refresh which
//     needs no fresh pairing grant.
//
// Remote push requires a development build (not Expo Go) on SDK 54, so in Expo
// Go getExpoPushTokenAsync throws; we swallow it and return null.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import Constants from 'expo-constants';
import { getDevicePubHex, signWithDevice } from '@/lib/device-identity';
import { ensureNotificationPermission } from '@/lib/notifications';
import type { Pairing } from '@/lib/pairing';

// Loaded lazily + guarded so a missing native module never crashes a screen,
// mirroring lib/notifications.ts.
let Notifications: typeof import('expo-notifications') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Notifications = require('expo-notifications');
} catch {
  Notifications = null;
}

// MUST stay byte-identical to devicePushTokenMessage in relay/src/worker.ts.
function devicePushTokenMessage(
  u: string,
  device: string,
  token: string,
  ts: string,
): string {
  return `researchos-device-push-token\nu=${u}\ndevice=${device}\ntoken=${token}\nts=${ts}`;
}

// The EAS project id is required by getExpoPushTokenAsync. It is baked into the
// app config (app.json extra.eas.projectId); fall back to the legacy easConfig
// location just in case.
function easProjectId(): string | null {
  const fromExtra = (Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined)
    ?.eas?.projectId;
  if (typeof fromExtra === 'string' && fromExtra.trim() !== '') return fromExtra;
  const fromEas = (Constants as { easConfig?: { projectId?: unknown } }).easConfig?.projectId;
  if (typeof fromEas === 'string' && fromEas.trim() !== '') return fromEas;
  return null;
}

// Get this device's Expo push token, or null when it is unavailable (module
// missing, permission denied, Expo Go, no project id, or any native error).
// Never throws.
export async function getExpoPushTokenOrNull(): Promise<string | null> {
  if (!Notifications) return null;
  try {
    const granted = await ensureNotificationPermission();
    if (!granted) return null;
    const projectId = easProjectId();
    if (!projectId) return null;
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    return typeof result?.data === 'string' && result.data.trim() !== ''
      ? result.data
      : null;
  } catch {
    // Expo Go (remote push needs a dev build), a simulator, or a transient
    // native error. The phone simply does not buzz; the synced list still works.
    return null;
  }
}

// Register (or refresh) this device's Expo push token with the relay over the
// device-signed /capture/devices/push-token route. Best-effort and fail-soft.
// A demo pairing never touches the network. Returns true only when the relay
// accepted the token.
export async function registerPushToken(pairing: Pairing): Promise<boolean> {
  if (pairing.demo) return false;
  try {
    const token = await getExpoPushTokenOrNull();
    if (!token) return false;
    const device = await getDevicePubHex();
    const ts = new Date().toISOString();
    const sig = await signWithDevice(
      devicePushTokenMessage(pairing.u, device, token, ts),
    );
    const base = pairing.relayUrl.replace(/\/+$/, '');
    const res = await fetch(`${base}/capture/devices/push-token?u=${pairing.u}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ u: pairing.u, device, pushToken: token, ts, sig }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
