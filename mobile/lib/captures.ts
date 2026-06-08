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

// Read the queue back, newest first. Tolerates a missing or corrupt record by
// returning an empty list rather than throwing.
export async function listCaptures(): Promise<Capture[]> {
  const stored = await AsyncStorage.getItem(CAPTURES_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCapture);
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

// Queue a new capture. The caller passes the picker uri and an optional caption.
// Returns the stored Capture so the screen can update without a re-read.
export async function addCapture(input: {
  uri: string;
  caption?: string;
}): Promise<Capture> {
  const capture: Capture = {
    id: makeId(),
    uri: input.uri,
    caption: (input.caption ?? '').trim(),
    createdAt: new Date().toISOString(),
    status: 'queued',
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
export async function sendCapture(
  capture: Capture,
  pairing: Pairing,
  deviceSign: (message: string) => Promise<string>,
): Promise<void> {
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
