// Note-route command (Phase 1.5, mobile side). After a photo is uploaded, the
// phone can post a sealed command telling the laptop which note entry to route
// the capture into. The laptop's Phase 1.5 worker unseals this command and
// writes the photo to the chosen note entry via attachImageToNote.
//
// Command JSON shapes (MUST match the laptop's openSealed consumer exactly):
//   { type: "route-capture-note", captureId: string, noteId: number,
//     owner: string, entryId: string | null }
//   { type: "append-note-text", noteId: number, owner: string,
//     entryId: string | null, text: string }
//
// For append-note-text the note body rides INSIDE the sealed command (E2E
// sealed to the user X25519), so there is no separate relay upload.
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
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { sealToUser } from '@/lib/device-identity';
import { postCommand } from '@/lib/focus-context';

/**
 * Builds, seals, and posts a route-capture-note command to the relay.
 *
 * Tells the laptop to place the uploaded capture into the given note entry.
 * When entryId is null the laptop uses the latest entry (same fallback as
 * attachImageToNote). If userX25519PubHex is absent or empty the function
 * returns without posting (graceful no-op so the capture still lands in the
 * inbox).
 *
 * Must be called AFTER sendCapture completes so the relay already holds the
 * image when the laptop polls the command queue.
 */
export async function postRouteCaptureNote(
  captureId: string,
  noteId: number,
  owner: string,
  entryId: string | null,
  userX25519PubHex: string,
  relayUrl?: string,
): Promise<void> {
  // Guard: no-op when the user X25519 pubkey is not yet available (pairing gap).
  if (!userX25519PubHex) return;

  const command = { type: 'route-capture-note', captureId, noteId, owner, entryId };
  const plaintext = utf8ToBytes(JSON.stringify(command));

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

/**
 * Builds, seals, and posts an append-note-text command to the relay.
 *
 * Tells the laptop to append `text` into the given note entry. Unlike the
 * photo path, the text rides INSIDE the sealed command (no separate relay
 * upload). When entryId is null the laptop uses the latest entry, or creates
 * one if the note has no entries. If userX25519PubHex is absent or empty the
 * function returns without posting (graceful no-op; caller falls back to inbox).
 */
export async function postAppendNoteText(
  noteId: number,
  owner: string,
  entryId: string | null,
  text: string,
  userX25519PubHex: string,
  relayUrl?: string,
): Promise<void> {
  // Guard: no-op when the user X25519 pubkey is not yet available (pairing gap).
  if (!userX25519PubHex) return;

  const command = { type: 'append-note-text', noteId, owner, entryId, text };
  const plaintext = utf8ToBytes(JSON.stringify(command));

  let sealed: Uint8Array;
  try {
    sealed = await sealToUser(plaintext, userX25519PubHex);
  } catch {
    // Sealing failed (bad key format, etc.). Fail silently so the caller can
    // fall back to the inbox path.
    return;
  }

  await postCommand(bytesToHex(sealed), relayUrl);
}
