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

/** Where an inserted note block lands, mirroring AppendTab. */
export type InsertTab = 'notes' | 'results';

/**
 * Builds, seals, and posts an insert-note-block command to the relay (phone
 * notes P2). Unlike append-line (which only lands at the END of the doc), this
 * carries a content anchor so the laptop can insert the block AFTER a specific
 * existing block.
 *
 * `anchorHash` is blockAnchor(block) of the block the note was placed after, and
 * `anchorIndex` is that block's index in the pulled doc (a disambiguation hint
 * when several blocks share an anchor). Two sentinels:
 *   anchorIndex = -1 with an empty anchorHash means "insert at the very top".
 *   anchorIndex = Number.MAX_SAFE_INTEGER (END_ANCHOR_INDEX) means "append at end".
 *
 * `block` is the phone-note callout markdown. `clientId` is the idempotency key:
 * it is sent both inside the payload AND as the relay commandId, so a re-send
 * (offline flush, double-tap) is deduped by the relay and the laptop poller. As
 * with postAppendLine, an absent userX25519PubHex is a graceful no-op.
 */
export async function postInsertNoteBlock(
  taskId: number,
  owner: string,
  tab: InsertTab,
  anchorHash: string,
  anchorIndex: number,
  block: string,
  clientId: string,
  userX25519PubHex: string,
  relayUrl?: string,
): Promise<boolean> {
  // Guard: no-op when the user X25519 pubkey is not yet available (pairing gap).
  if (!userX25519PubHex) return false;

  const command = {
    type: 'insert-note-block',
    taskId,
    owner,
    tab,
    anchorHash,
    anchorIndex,
    block,
    clientId,
    ts: new Date().toISOString(),
  };
  const plaintext = utf8ToBytes(JSON.stringify(command));

  let sealed: Uint8Array;
  try {
    sealed = await sealToUser(plaintext, userX25519PubHex);
  } catch {
    // Sealing failed (bad key format, etc.). Report the failure so the caller
    // can keep the note staged rather than silently dropping it.
    return false;
  }

  // Pass clientId as the relay commandId so a retry of the same staged note is
  // deduped end to end (relay + laptop poller).
  return postCommand(bytesToHex(sealed), relayUrl, clientId);
}

/** Sentinel anchorIndex meaning "append the block at the very end of the doc". */
export const END_ANCHOR_INDEX = Number.MAX_SAFE_INTEGER;

/** Sentinel anchorIndex meaning "insert the block before the first block". */
export const TOP_ANCHOR_INDEX = -1;
