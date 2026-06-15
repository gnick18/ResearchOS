// Bench photo capture queue + relay upload (piece C). The companion snaps a
// bench photo, captions it, and queues it. When the phone is paired, queued
// captures upload to the relay's capture inbox signed with the phone's device
// key. The image stays at the picker's local uri until it is sent. House style:
// no em-dashes, no emojis, no mid-sentence colons.
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/curves/utils.js';

import type { Pairing } from '@/lib/pairing';
import type { AnnotationDoc } from '@/lib/annotations';
import type { OcrResult } from '@/lib/ocr';
import { fireSuccess } from '@/lib/success-burst';

const CAPTURES_KEY = 'researchos.captures.v1';

export type CaptureStatus = 'queued' | 'sending' | 'sent' | 'failed';

export type Capture = {
  // Stable id for the row. Generated at call time, see makeId below. Doubles as
  // the captureId in the upload contract.
  id: string;
  // The picker's returned local uri. Durable copy is a refine-later item.
  uri: string;
  // Optional caption the user typed. Empty string when none was given.
  caption: string;
  // ISO timestamp of when the capture was queued.
  createdAt: string;
  // Lifecycle through the outbox.
  status: CaptureStatus;
  // Optional non-destructive annotation layer (vectors in NATURAL image pixels),
  // the EXACT same schema the laptop writes to {imageName}.annot.json. Carried
  // here so the doc rides along with the queued capture. RELAY/POLLER FOLLOW-UP:
  // the upload (sendCapture) and the laptop poller do NOT yet ship this field;
  // the orchestrator wires it from this exact spot. See sendCapture below.
  annotation?: AnnotationDoc;
  // Optional handwriting OCR result (on-device Apple Vision / ML Kit output),
  // the EXACT same schema the laptop writes to {imageName}.ocr.json. Carried
  // conditionally so plain (non-OCR) captures stay byte-clean. The laptop
  // poller reads the relay meta field "ocr" and writes the sidecar.
  ocr?: OcrResult;
};

// ---- Canonical signed-byte string (MUST match relay/scripts/smoke-capture.mjs
// and relay/src/worker.ts verbatim). Copied verbatim from the contract. -------

export function captureUploadMessage(
  u: string,
  captureId: string,
  createdAt: string,
  sha256Hex: string,
): string {
  return `researchos-capture-upload\nu=${u}\ncid=${captureId}\ncreatedAt=${createdAt}\nsha256=${sha256Hex}`;
}

// Per-process counter so two captures made in the same millisecond still get
// distinct ids. Kept at module scope on purpose; it only needs to be unique
// within a single app run, the timestamp prefix handles uniqueness across runs.
let idCounter = 0;

function makeId(): string {
  idCounter += 1;
  return `cap_${Date.now().toString(36)}_${idCounter}`;
}

// On the first read of an app run, already-SENT captures are dropped so a
// previous session's "recently sent" never lingers across an app restart (they
// are delivered, the laptop has them). Queued / failed (unsent) captures are
// kept so no in-progress work is lost. Demo-seeded captures are kept too so the
// reviewer demo survives a restart. Module-scoped so it only runs once per
// launch, within a session new sends still show as "Sent".
let prunedSentThisRun = false;

// Read the queue back, newest first. Tolerates a missing or corrupt record by
// returning an empty list rather than throwing.
export async function listCaptures(): Promise<Capture[]> {
  const stored = await AsyncStorage.getItem(CAPTURES_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    let valid = parsed.filter(isCapture);
    if (!prunedSentThisRun) {
      prunedSentThisRun = true;
      // Drop delivered captures (but keep Demo: samples), AND requeue any capture
      // left mid-flight: a 'sending' status persisted to storage means a previous
      // upload was interrupted (app killed, or the relay never answered). There is
      // no live upload after a reload, so reset it to 'queued' instead of leaving
      // it stuck on "Sending..." forever (Send all only retries queued/failed).
      const hadSending = valid.some((c) => c.status === 'sending');
      const cleaned = valid
        .filter((c) => c.status !== 'sent' || c.caption.startsWith('Demo:'))
        .map((c) =>
          c.status === 'sending' ? { ...c, status: 'queued' as const } : c,
        );
      if (cleaned.length !== valid.length || hadSending) {
        await writeAll(cleaned);
        valid = cleaned;
      }
    }
    return valid;
  } catch {
    // Corrupt record, treat as an empty queue.
    return [];
  }
}

// Type guard so a corrupt or partial entry never crashes a screen.
function isCapture(value: unknown): value is Capture {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as Capture).id === 'string' &&
    typeof (value as Capture).uri === 'string' &&
    typeof (value as Capture).caption === 'string' &&
    typeof (value as Capture).createdAt === 'string' &&
    isStatus((value as Capture).status)
  );
}

function isStatus(value: unknown): value is CaptureStatus {
  return (
    value === 'queued' ||
    value === 'sending' ||
    value === 'sent' ||
    value === 'failed'
  );
}

async function writeAll(captures: Capture[]): Promise<void> {
  await AsyncStorage.setItem(CAPTURES_KEY, JSON.stringify(captures));
}

// Demo captures are sample data with no real relay behind them, so they must
// never sit on "Sending..." or "Queued" as if a real upload were pending. Mark
// every Demo: capture as delivered (sent), which is how a synced lab inbox reads.
// Idempotent: a no-op once they are all sent.
export async function markDemoCapturesSent(): Promise<void> {
  const current = await listCaptures();
  let changed = false;
  const next = current.map((c) => {
    if (c.caption.startsWith('Demo:') && c.status !== 'sent') {
      changed = true;
      return { ...c, status: 'sent' as const };
    }
    return c;
  });
  if (changed) await writeAll(next);
}

// Queue a new capture. The caller passes the picker uri and an optional caption.
// Returns the stored Capture so the screen can update without a re-read.
export async function addCapture(input: {
  uri: string;
  caption?: string;
  annotation?: AnnotationDoc;
  ocr?: OcrResult;
}): Promise<Capture> {
  const capture: Capture = {
    id: makeId(),
    uri: input.uri,
    caption: (input.caption ?? '').trim(),
    createdAt: new Date().toISOString(),
    status: 'queued',
    // Only carry the fields when present so plain captures stay byte-clean.
    ...(input.annotation ? { annotation: input.annotation } : {}),
    ...(input.ocr ? { ocr: input.ocr } : {}),
  };
  const current = await listCaptures();
  // Newest first so the freshest snap sits at the top of the outbox.
  await writeAll([capture, ...current]);
  return capture;
}

// Drop a single capture from the queue by id. A no-op if it is already gone.
export async function removeCapture(id: string): Promise<void> {
  const current = await listCaptures();
  const next = current.filter((c) => c.id !== id);
  await writeAll(next);
}

// Wipe the whole outbox. Called when the phone pairs to a DIFFERENT lab (a new
// pairing u), so captures sent to a previous lab / dev server never leak into a
// fresh connection's "recently sent".
export async function clearAllCaptures(): Promise<void> {
  await AsyncStorage.removeItem(CAPTURES_KEY);
}

// Flip a single capture's status in place. Returns the updated list.
export async function setCaptureStatus(
  id: string,
  status: CaptureStatus,
): Promise<Capture[]> {
  const current = await listCaptures();
  const next = current.map((c) => (c.id === id ? { ...c, status } : c));
  await writeAll(next);
  return next;
}

// Read an image uri into raw bytes. In React Native fetch(uri).arrayBuffer()
// works for the file:// uris the picker returns.
async function readImageBytes(uri: string): Promise<Uint8Array> {
  const res = await fetch(uri);
  const buffer = await res.arrayBuffer();
  return new Uint8Array(buffer);
}

// Best-effort content type from the uri extension. The relay stores whatever we
// declare; jpeg is the common camera output.
function contentTypeForUri(uri: string): string {
  const lower = uri.split('?')[0].toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function fileNameForUri(uri: string, contentType: string): string {
  const ext = contentType.split('/')[1] || 'jpg';
  return `capture.${ext === 'jpeg' ? 'jpg' : ext}`;
}

// Upload one capture to the relay. Reads the image bytes, hashes them, signs the
// canonical upload message with the device key, and POSTs multipart to
// ${relayUrl}/capture/upload with a file field "blob" and a JSON "meta" field.
// On success the capture is marked sent. On any failure it is marked failed and
// the error is rethrown so the caller can surface it.
//
// When pairing.demo is true the upload is skipped entirely: the capture is
// marked sent immediately and the success burst fires so the reviewer sees the
// celebration without any real network traffic going out.
export async function sendCapture(
  capture: Capture,
  pairing: Pairing,
  deviceSign: (message: string) => Promise<string>,
  opts: { suppressBurst?: boolean } = {},
): Promise<void> {
  if (pairing.demo) {
    await setCaptureStatus(capture.id, 'sent');
    if (!opts.suppressBurst) {
      fireSuccess({ subtitle: (capture.caption || 'Photo').slice(0, 60) });
    }
    return;
  }

  await setCaptureStatus(capture.id, 'sending');
  try {
    const bytes = await readImageBytes(capture.uri);
    const shaHex = bytesToHex(sha256(bytes));
    const contentType = contentTypeForUri(capture.uri);
    const message = captureUploadMessage(
      pairing.u,
      capture.id,
      capture.createdAt,
      shaHex,
    );
    const sig = await deviceSign(message);

    const form = new FormData();
    // React Native FormData takes a { uri, name, type } object for files.
    form.append('blob', {
      uri: capture.uri,
      name: fileNameForUri(capture.uri, contentType),
      type: contentType,
    } as unknown as Blob);
    // Photo markup rides along as the web .annot.json string. It is UNSIGNED
    // meta (the sig binds the image bytes via captureUploadMessage), which is
    // fine for this bound-device transient relay and avoids a canonical-string
    // change. The relay stores it; the laptop poller writes it to
    // {imageName}.annot.json. Omitted when the photo has no markup.
    form.append(
      'meta',
      JSON.stringify({
        u: pairing.u,
        devicePubkey: pairing.devicePubkey,
        captureId: capture.id,
        caption: capture.caption,
        createdAt: capture.createdAt,
        contentType,
        sig,
        ...(capture.annotation
          ? { annotation: JSON.stringify(capture.annotation) }
          : {}),
        ...(capture.ocr
          ? { ocr: JSON.stringify(capture.ocr) }
          : {}),
      }),
    );

    const base = pairing.relayUrl.replace(/\/+$/, '');
    const res = await fetch(`${base}/capture/upload`, {
      method: 'POST',
      body: form,
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    if (!res.ok || body.ok !== true) {
      throw new Error(
        `upload failed (status ${res.status})${body.error ? ` ${body.error}` : ''}`,
      );
    }

    await setCaptureStatus(capture.id, 'sent');
    // The routing flow fires its own "Filed in X" / "Sent to inbox" burst AFTER
    // the destination is chosen, so it suppresses this upload-time burst to
    // avoid celebrating before the user has picked where the capture goes.
    if (!opts.suppressBurst) {
      fireSuccess({ subtitle: (capture.caption || 'Photo').slice(0, 60) });
    }
  } catch (err) {
    await setCaptureStatus(capture.id, 'failed');
    throw err;
  }
}

// React hook so screens react to add/remove/status. Loads on mount and exposes a
// refresh the caller runs after writing.
export function useCaptures() {
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const current = await listCaptures();
      setCaptures(current);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { captures, loading, refresh };
}
