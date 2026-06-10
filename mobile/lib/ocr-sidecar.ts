// Decoupled OCR delivery (handwriting capture). The OCR layer is a property of
// the scanned PHOTO, not of where it gets filed, so it travels on its OWN sealed
// command keyed to the captureId, independent of routing. The laptop writes
// {image}.ocr.json next to the image wherever it lands (inbox, notebook, or
// experiment).
//
// Command JSON shape (MUST match the laptop poll.ts consumer exactly):
//   { type: "ocr-sidecar", captureId: string, ocr: OcrResult }
//
// Sealed to the user's X25519 key (E2E), like the route commands. Sent right
// after the image uploads, for every scanned capture, before any routing
// decision. A no-op when the user X25519 key is absent (older pairing).
//
// No em-dashes, no emojis, no mid-sentence colons.

import { bytesToHex } from '@noble/curves/utils.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { sealToUser } from '@/lib/device-identity';
import { postCommand } from '@/lib/focus-context';
import type { OcrResult } from '@/lib/ocr';

/** Send the OCR layer for a scanned capture so the laptop writes its sidecar
 *  wherever the image lands. No-op when the user X25519 key is not on hand. */
export async function postOcrSidecar(
  captureId: string,
  ocr: OcrResult,
  userX25519PubHex: string,
  relayUrl?: string,
): Promise<void> {
  if (!userX25519PubHex) return;
  const command = { type: 'ocr-sidecar', captureId, ocr };
  let sealed: Uint8Array;
  try {
    sealed = await sealToUser(utf8ToBytes(JSON.stringify(command)), userX25519PubHex);
  } catch {
    return;
  }
  await postCommand(bytesToHex(sealed), relayUrl);
}
