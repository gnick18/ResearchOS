// Calc-export command (Phase 2, mobile side). The calculator screen calls
// postAppendLine after building a human-readable "<expr> = <value>" string
// from the active tab's state. The laptop's Phase 2 worker unseals this
// command and appends the line to the open (or on-disk) experiment doc.
//
// Command JSON shape (MUST match the laptop's openSealed consumer exactly):
//   { type: "append-line", taskId: number, owner: string,
//     tab: "notes" | "results", text: string }
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
import { postCommand } from '@/lib/focus-context';

/** The tab an appended line should land in. */
export type AppendTab = 'notes' | 'results';

/**
 * Builds, seals, and posts an append-line command to the relay.
 *
 * The command tells the laptop to append `text` as a new line at the end of
 * the given tab's markdown doc in the specified experiment. If
 * userX25519PubHex is absent or empty the function returns without posting
 * (graceful no-op so the calculator remains usable without a pairing).
 */
export async function postAppendLine(
  taskId: number,
  owner: string,
  tab: AppendTab,
  text: string,
  userX25519PubHex: string,
  relayUrl?: string,
): Promise<void> {
  // Guard: no-op when the user X25519 pubkey is not yet available (pairing gap).
  if (!userX25519PubHex) return;

  const command = { type: 'append-line', taskId, owner, tab, text };
  const plaintext = utf8ToBytes(JSON.stringify(command));

  let sealed: Uint8Array;
  try {
    sealed = await sealToUser(plaintext, userX25519PubHex);
  } catch {
    // Sealing failed (bad key format, etc.). Fail silently so the calculator
    // is not affected.
    return;
  }

  await postCommand(bytesToHex(sealed), relayUrl);
}
