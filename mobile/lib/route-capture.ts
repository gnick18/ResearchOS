// Route-capture command (Phase 1, mobile side). After a photo is uploaded, the
// phone can post a sealed command telling the laptop which experiment tab to
// route the capture into. The laptop's Phase 1 worker unseals this command and
// writes the photo to the chosen tab (Lab Notes or Results).
//
// Command JSON shape (MUST match the laptop's openSealed consumer exactly):
//   { type: "route-capture", captureId: string, taskId: number, owner: string, tab: "notes" | "results" }
//
// The blob is sealed to the USER's X25519 public key so only the laptop can
// open it (the relay stores only ciphertext). The sealed hex string is passed
// to postCommand, which adds the device signature envelope.
//
// userX25519PubHex comes from the Pairing record (field "userX25519PubHex"),
// carried in the pairing grant + register response and stored at pair time.
// A pairing made before that carry existed has no value, in which case callers
// get a silent no-op and the capture lands in the inbox as today.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { bytesToHex } from '@noble/curves/utils.js';
import { sealToUser } from '@/lib/device-identity';
import { postCommand } from '@/lib/focus-context';

const enc = new TextEncoder();

/** The tab a capture should be routed into. */
export type RouteTab = 'notes' | 'results';

/**
 * Builds, seals, and posts a route-capture command to the relay.
 *
 * The command tells the laptop to place the uploaded capture into the given
 * tab of the specified experiment. If userX25519PubHex is absent or empty the
 * function returns without posting (graceful no-op so the capture still lands
 * in the inbox).
 *
 * Must be called AFTER sendCapture completes so the relay already holds the
 * image when the laptop polls the command queue.
 */
export async function postRouteCapture(
  captureId: string,
  taskId: number,
  owner: string,
  tab: RouteTab,
  userX25519PubHex: string,
  relayUrl?: string,
): Promise<void> {
  // Guard: no-op when the user X25519 pubkey is not yet available (pairing gap).
  if (!userX25519PubHex) return;

  const command = { type: 'route-capture', captureId, taskId, owner, tab };
  const plaintext = enc.encode(JSON.stringify(command));

  let sealed: Uint8Array;
  try {
    sealed = await sealToUser(plaintext, userX25519PubHex);
  } catch {
    // Sealing failed (bad key format, etc.). Fail silently so the upload is not
    // affected.
    return;
  }

  await postCommand(bytesToHex(sealed), relayUrl);
}
