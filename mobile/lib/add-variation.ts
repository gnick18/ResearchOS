// Add-variation command (View method on phone, mobile side, 2026-06-10). The
// read-mode method viewer calls postAddVariation when the researcher records a
// variation while following a method at the bench (e.g. "this batch I used 30
// cycles not 28"). The laptop's poller unseals this command and appends the
// text as a new timestamped variation entry on the experiment's method, reusing
// the existing variations feature so it shows up in the laptop's Variation
// Notes panel.
//
// Command JSON shape (MUST match the laptop's openSealed consumer in poll.ts):
//   { type: "add-variation", taskId: number, owner: string,
//     methodId?: number, text: string, at: string }
//
// The blob is sealed to the USER's X25519 public key so only the laptop can
// open it (the relay stores only ciphertext). The sealed hex string is passed
// to postCommand, which adds the device signature envelope.
//
// userX25519PubHex comes from the Pairing record (field "userX25519PubHex"),
// carried in the pairing grant + register response and stored at pair time.
// A pairing made before that carry existed has no value, in which case callers
// get a silent no-op and nothing is sent.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { bytesToHex } from '@noble/curves/utils.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { sealToUser } from '@/lib/device-identity';
import { sendOrQueueCommand } from '@/lib/command-outbox';

/**
 * Builds, seals, and posts an add-variation command to the relay.
 *
 * The command tells the laptop to append `text` as a new timestamped variation
 * entry on the given experiment's method. `methodId` selects which attached
 * method when the experiment has several; omit it (pass undefined) to let the
 * laptop fall back to the experiment's first method.
 *
 * Returns 'sent' when the relay accepted it, 'queued' when the phone was offline
 * and it was stored to sync on reconnect, and 'noop' on a no-op (missing user
 * key, empty text, or a sealing failure) so the caller can show the right status.
 */
export type VariationResult = 'sent' | 'queued' | 'noop';

export async function postAddVariation(
  taskId: number,
  owner: string,
  text: string,
  userX25519PubHex: string,
  methodId?: number,
  relayUrl?: string,
): Promise<VariationResult> {
  // Guard: no-op when the user X25519 pubkey is not yet available (pairing gap)
  // or there is nothing to send.
  if (!userX25519PubHex) return 'noop';
  const trimmed = text.trim();
  if (!trimmed) return 'noop';

  const command: {
    type: 'add-variation';
    taskId: number;
    owner: string;
    text: string;
    at: string;
    methodId?: number;
  } = {
    type: 'add-variation',
    taskId,
    owner,
    text: trimmed,
    at: new Date().toISOString(),
  };
  if (typeof methodId === 'number') command.methodId = methodId;

  const plaintext = utf8ToBytes(JSON.stringify(command));

  let sealed: Uint8Array;
  try {
    sealed = await sealToUser(plaintext, userX25519PubHex);
  } catch {
    // Sealing failed (bad key format, etc.). Fail silently so the viewer is not
    // affected.
    return 'noop';
  }

  // Post now, or queue for the reconnect flush if the phone is offline.
  return sendOrQueueCommand(bytesToHex(sealed), 'add-variation', relayUrl);
}
