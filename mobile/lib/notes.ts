// v0 quick text note upload (mobile). The companion composes a short markdown
// note and sends it to the lab inbox over the same capture relay the bench photo
// uses. A note is just an upload with contentType text/markdown, the relay
// accepts any blob. The note bytes are the UTF-8 body, hashed with sha256 and
// signed with the device key over the same canonical upload string as a photo.
// The optional title rides along as the caption, which the laptop uses as the
// note title. No outbox here, the note sends immediately and the screen shows an
// inline status. House style: no em-dashes, no emojis, no mid-sentence colons.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/curves/utils.js';

import type { Pairing } from '@/lib/pairing';
import { captureUploadMessage } from '@/lib/captures';
import { fireSuccess } from '@/lib/success-burst';

const NOTE_CONTENT_TYPE = 'text/markdown';

// Per-process counter so two notes made in the same millisecond still get
// distinct ids. Unique within a single app run, the timestamp prefix handles
// uniqueness across runs. Mirrors the captures id scheme.
let idCounter = 0;

function makeNoteId(): string {
  idCounter += 1;
  return `note_${Date.now().toString(36)}_${idCounter}`;
}

// Encode a UTF-8 string to base64 without relying on btoa, which is not present
// in the React Native runtime. Walks the bytes in chunks and maps them through
// the standard base64 alphabet.
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

export type SendNoteResult = { ok: true } | { ok: false; error: string };

// Send a single text note to the relay. Encodes the body to UTF-8 bytes, hashes
// them, signs the canonical upload message with the device key, and POSTs
// multipart to ${relayUrl}/capture/upload with a file field "blob" and a JSON
// "meta" field, exactly matching sendCapture and the relay contract. The title,
// if any, is sent as the caption which the laptop reads as the note title.
export async function sendTextNote(
  note: { title?: string; body: string },
  pairing: Pairing,
  deviceSign: (message: string) => Promise<string>,
  opts: { suppressBurst?: boolean } = {},
): Promise<SendNoteResult> {
  try {
    const body = note.body;
    const bytes = new TextEncoder().encode(body);
    if (bytes.length === 0) {
      return { ok: false, error: 'Note is empty.' };
    }
    // Demo mode never touches the relay (mirrors fetchSnapshot's pairing.demo
    // short-circuit). Report a clean success so the Try-the-demo quick-note flow
    // shows the same success burst a paired phone would, with no network.
    if (pairing.demo) {
      if (!opts.suppressBurst) fireSuccess({ subtitle: 'Quick note' });
      return { ok: true };
    }
    const shaHex = bytesToHex(sha256(bytes));
    const captureId = makeNoteId();
    const createdAt = new Date().toISOString();
    const caption = (note.title ?? '').trim();

    const message = captureUploadMessage(
      pairing.u,
      captureId,
      createdAt,
      shaHex,
    );
    const sig = await deviceSign(message);

    const form = new FormData();
    // React Native FormData sends a { uri, name, type } file object reliably with
    // non-empty bytes. We hand it a data: uri carrying the base64 of the note so
    // the runtime does not depend on Blob byte serialization, which is uneven in
    // RN. The relay receives the decoded markdown bytes verbatim.
    const dataUri = `data:${NOTE_CONTENT_TYPE};base64,${bytesToBase64(bytes)}`;
    form.append('blob', {
      uri: dataUri,
      name: 'note.md',
      type: NOTE_CONTENT_TYPE,
    } as unknown as Blob);
    form.append(
      'meta',
      JSON.stringify({
        u: pairing.u,
        devicePubkey: pairing.devicePubkey,
        captureId,
        caption,
        createdAt,
        contentType: NOTE_CONTENT_TYPE,
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
    if (!opts.suppressBurst) {
      fireSuccess({ subtitle: 'Quick note' });
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not send the note.',
    };
  }
}
