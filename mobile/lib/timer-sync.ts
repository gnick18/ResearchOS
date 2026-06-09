// Timer sync (Phase 3, mobile side). The phone tells the laptop when it starts
// or dismisses a timer (sealed command), and fetches the laptop's own running
// timers from the "timers" snapshot so they mirror onto the phone.
//
// Command JSON shapes (MUST match the laptop's poll.ts consumer exactly):
//   { type: "timer", op: "create", timerId, label, durationSec, startedAt, endsAt }
//   { type: "timer", op: "dismiss", timerId }
//
// The command is sealed to the USER's X25519 key so only the laptop can open it
// (the relay stores only ciphertext). userX25519PubHex comes from the Pairing
// record; absent (a pairing made before that carry existed) means a silent no-op
// and the timer stays phone-local. "done" is never sent, each device flips to
// done locally from the absolute endsAt.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { bytesToHex } from '@noble/curves/utils.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { sealToUser } from '@/lib/device-identity';
import { postCommand } from '@/lib/focus-context';
import { fetchSnapshot } from '@/lib/snapshots';
import type { Pairing } from '@/lib/pairing';
import type { Timer, LaptopTimerWire } from '@/lib/timers';

/** Tell the laptop a timer started on the phone, so it mirrors there. No-op when
 *  the user X25519 key is not on the pairing (silent, timer stays phone-local). */
export async function postTimerCreate(
  timer: Timer,
  userX25519PubHex: string,
  relayUrl?: string,
): Promise<void> {
  if (!userX25519PubHex) return;
  const command = {
    type: 'timer',
    op: 'create',
    timerId: timer.id,
    label: timer.label,
    durationSec: timer.durationSec,
    startedAt: timer.startedAt,
    endsAt: timer.endsAt,
  };
  let sealed: Uint8Array;
  try {
    sealed = await sealToUser(utf8ToBytes(JSON.stringify(command)), userX25519PubHex);
  } catch {
    return;
  }
  await postCommand(bytesToHex(sealed), relayUrl);
}

/** Tell the laptop a timer was dismissed on the phone (unified dismiss). Works
 *  for a phone timer or a mirrored laptop timer. */
export async function postTimerDismiss(
  timerId: string,
  userX25519PubHex: string,
  relayUrl?: string,
): Promise<void> {
  if (!userX25519PubHex) return;
  const command = { type: 'timer', op: 'dismiss', timerId };
  let sealed: Uint8Array;
  try {
    sealed = await sealToUser(utf8ToBytes(JSON.stringify(command)), userX25519PubHex);
  } catch {
    return;
  }
  await postCommand(bytesToHex(sealed), relayUrl);
}

/** The decrypted "timers" snapshot the laptop publishes. */
export type LaptopTimersSnapshot = {
  generatedAt?: string;
  running: LaptopTimerWire[];
  dismissed: string[];
};

/** Fetch + unseal the laptop "timers" snapshot. Returns empty lists when the
 *  laptop has not published yet (404) or the shape is unexpected, so the caller
 *  can merge unconditionally. */
export async function fetchLaptopTimers(
  pairing: Pairing,
  deviceSign: (message: string) => Promise<string>,
): Promise<LaptopTimersSnapshot> {
  const empty: LaptopTimersSnapshot = { running: [], dismissed: [] };
  const raw = await fetchSnapshot('timers', pairing, deviceSign);
  if (!raw || typeof raw !== 'object') return empty;
  const snap = raw as Partial<LaptopTimersSnapshot>;
  return {
    generatedAt: snap.generatedAt,
    running: Array.isArray(snap.running) ? snap.running : [],
    dismissed: Array.isArray(snap.dismissed) ? snap.dismissed : [],
  };
}
