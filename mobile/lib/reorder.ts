// v0 scan-to-reorder upload (mobile). The companion scans an inventory barcode,
// matches it against the laptop-published inventory snapshot, and sends a reorder
// request to the lab inbox over the same capture relay the bench photo and quick
// note use. A reorder is just an upload with a dedicated contentType, the relay
// accepts any blob. The reorder bytes are the UTF-8 JSON body, hashed with sha256
// and signed with the device key over the same canonical upload string as a photo
// or note. The matched item name (or the scanned code) rides along as the caption
// so the laptop has a readable label. No outbox here, the reorder sends
// immediately and the screen shows an inline status. House style: no em-dashes,
// no emojis, no mid-sentence colons.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/curves/utils.js';

import type { Pairing } from '@/lib/pairing';
import { captureUploadMessage } from '@/lib/captures';

const REORDER_CONTENT_TYPE = 'application/x-researchos-reorder';

// What the phone sends for one reorder request. itemId/name/catalog_number/vendor
// are present when the scan matched a known inventory item. product_barcode is the
// scanned code, present on both match and no-match. note is an optional free line.
export type ReorderPayload = {
  product_barcode?: string;
  itemId?: number;
  name?: string;
  catalog_number?: string | null;
  vendor?: string | null;
  note?: string;
};

export type SendReorderResult = { ok: true } | { ok: false; error: string };

// Per-process counter so two reorders made in the same millisecond still get
// distinct ids. Unique within a single app run, the timestamp prefix handles
// uniqueness across runs. Mirrors the captures and notes id schemes.
let idCounter = 0;

function makeReorderId(): string {
  idCounter += 1;
  return `reorder_${Date.now().toString(36)}_${idCounter}`;
}

// Encode UTF-8 bytes to base64 without btoa, which is absent in the React Native
// runtime. Mirrors the helper in notes.ts so the data: uri FormData approach
// works the same way for the JSON reorder body.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b2 & 63] : '=';
  }
  return out;
}

// Send a single reorder request to the relay. Encodes the payload as UTF-8 JSON
// bytes, hashes them, signs the canonical upload message with the device key, and
// POSTs multipart to ${relayUrl}/capture/upload with a file field "blob" and a
// JSON "meta" field, exactly matching sendCapture, sendTextNote, and the relay
// contract. The caption is the matched item name, or the scanned barcode when no
// item matched, so the laptop has a human label without parsing the JSON first.
export async function uploadReorder(
  payload: ReorderPayload,
  pairing: Pairing,
  deviceSign: (message: string) => Promise<string>,
): Promise<SendReorderResult> {
  try {
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    if (bytes.length === 0) {
      return { ok: false, error: 'Nothing to reorder.' };
    }
    const shaHex = bytesToHex(sha256(bytes));
    const captureId = makeReorderId();
    const createdAt = new Date().toISOString();
    const caption = (payload.name ?? payload.product_barcode ?? '').trim();

    const message = captureUploadMessage(
      pairing.u,
      captureId,
      createdAt,
      shaHex,
    );
    const sig = await deviceSign(message);

    const form = new FormData();
    // React Native FormData sends a { uri, name, type } file object reliably with
    // non-empty bytes. We hand it a data: uri carrying the base64 of the JSON so
    // the runtime does not depend on Blob byte serialization, which is uneven in
    // RN. The relay receives the decoded reorder JSON bytes verbatim.
    const dataUri = `data:${REORDER_CONTENT_TYPE};base64,${bytesToBase64(bytes)}`;
    form.append('blob', {
      uri: dataUri,
      name: 'reorder.json',
      type: REORDER_CONTENT_TYPE,
    } as unknown as Blob);
    form.append(
      'meta',
      JSON.stringify({
        u: pairing.u,
        devicePubkey: pairing.devicePubkey,
        captureId,
        caption,
        createdAt,
        contentType: REORDER_CONTENT_TYPE,
        sig,
      }),
    );

    const base = pairing.relayUrl.replace(/\/+$/, '');
    const res = await fetch(`${base}/capture/upload`, {
      method: 'POST',
      body: form,
    });
    const resBody = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    if (!res.ok || resBody.ok !== true) {
      return {
        ok: false,
        error: `Send failed (status ${res.status})${resBody.error ? ` ${resBody.error}` : ''}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not send the reorder.',
    };
  }
}
