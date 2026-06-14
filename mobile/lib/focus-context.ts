// Focus context relay client, MOBILE side (Phase 0, notebook integrations).
//
// The phone uses these to:
//   1. Fetch the current focus context from the relay (what experiment is open
//      on the laptop right now).
//   2. Post a sealed command (calc export, timer event) for the laptop to apply.
//
// Canonical signed strings MUST match relay/src/worker.ts exactly.
// No em-dashes, no emojis, no mid-sentence colons.

import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { getPairing } from '@/lib/pairing';
import { unsealSnapshot, getOrCreateDeviceKey, getOrCreateDeviceX25519Key } from '@/lib/device-identity';

// React Native (Hermes) has no Web Crypto (`crypto.subtle`, `crypto.randomUUID`)
// and no reliable global TextEncoder/TextDecoder, so this module uses the same
// @noble primitives the rest of the mobile crypto code already depends on.

function sign(message: string, secretKey: Uint8Array): string {
  return bytesToHex(ed25519.sign(utf8ToBytes(message), secretKey));
}

function nowIso(): string {
  return new Date().toISOString();
}

function sha256Hex(str: string): string {
  return bytesToHex(sha256(utf8ToBytes(str)));
}

// Per-process counter so two commands posted in the same millisecond still get
// distinct ids. Uniqueness only needs to hold within a single app run; the
// timestamp prefix covers uniqueness across runs.
let commandCounter = 0;
function makeCommandId(): string {
  commandCounter += 1;
  return `cmd_${Date.now().toString(36)}_${commandCounter}`;
}

function utf8Decode(bytes: Uint8Array): string {
  // Minimal UTF-8 decode (no global TextDecoder in Hermes). The payload is the
  // small JSON focus-context string the laptop sealed.
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    if (b < 0x80) {
      out += String.fromCharCode(b);
    } else if (b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
    } else if (b < 0xf0) {
      out += String.fromCharCode(
        ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f),
      );
    } else {
      const cp =
        ((b & 0x07) << 18) |
        ((bytes[i++] & 0x3f) << 12) |
        ((bytes[i++] & 0x3f) << 6) |
        (bytes[i++] & 0x3f);
      const c = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
    }
  }
  return out;
}

// ---- Canonical signed-byte strings (MUST match worker.ts verbatim) ----

function contextGetMessage(u: string, device: string, ts: string): string {
  return `researchos-context-get\nu=${u}\ndevice=${device}\nts=${ts}`;
}

function commandPostMessage(u: string, device: string, commandId: string, ts: string, sha: string): string {
  return `researchos-command-post\nu=${u}\ndevice=${device}\ncommandId=${commandId}\nts=${ts}\nsha256=${sha}`;
}

// ---- Types ----------------------------------------------------------------

export type FocusContext =
  | { kind: 'experiment'; taskId: number; owner: string; name: string; activeTab: 'notes' | 'results' | 'other'; at: string }
  | {
      kind: 'note';
      noteId: number;
      owner: string;
      title: string;
      isRunningLog: boolean;
      entries: { id: string; title: string; date: string }[];
      openEntryId: string | null;
      lastEditedEntryId: string | null;
      at: string;
    }
  | { kind: 'none'; at: string };

// How stale a context can be before we treat it as kind:'none'.
const CONTEXT_MAX_AGE_MS = 20_000;

// ---- API ------------------------------------------------------------------

/** Fetch the sealed focus context for this device, then unseal + parse it.
 *  Returns null when no context has been published, the context is stale, or
 *  the device is not paired. */
export async function getFocusContext(
  relayUrl?: string,
): Promise<FocusContext | null> {
  const pairing = await getPairing();
  if (!pairing) return null;

  const url = relayUrl ?? pairing.relayUrl;
  const { u, devicePubkey } = pairing;

  const deviceKey = await getOrCreateDeviceKey();
  const deviceEdPrivateKey = hexToBytes(deviceKey.devicePrivHex);

  const ts = nowIso();
  const sig = sign(contextGetMessage(u, devicePubkey, ts), deviceEdPrivateKey);

  let res: Response;
  try {
    res = await fetch(
      `${url}/capture/context?u=${u}&device=${devicePubkey}&ts=${encodeURIComponent(ts)}&sig=${sig}`,
    );
  } catch {
    return null; // relay unreachable, treat as no context
  }
  if (!res.ok) return null;
  const body = (await res.json()) as { sealed?: string | null; updatedAt?: string };
  if (!body.sealed) return null;

  // Stale-context guard: if updatedAt is > CONTEXT_MAX_AGE_MS ago, treat as none.
  if (body.updatedAt) {
    const age = Date.now() - Date.parse(body.updatedAt);
    if (age > CONTEXT_MAX_AGE_MS) return null;
  }

  // Unseal the blob. The laptop sealed it with sealToRecipient to this device's
  // X25519 pubkey; we unseal with unsealSnapshot (same construction).
  const sealedBytes = hexToBytes(body.sealed);
  let plaintext: Uint8Array;
  try {
    plaintext = await unsealSnapshot(sealedBytes);
  } catch {
    return null; // wrong key or corrupted
  }
  const json = utf8Decode(plaintext);
  try {
    return JSON.parse(json) as FocusContext;
  } catch {
    return null;
  }
}

/** Post a sealed command to the relay for the laptop to apply.
 *  The command is sealed by the CALLER with sealToRecipient to the user's X25519 pubkey.
 *  Pass a STABLE commandId when retrying a queued command so the laptop poller
 *  can dedupe (never apply the same write twice); omit it for a fresh post.
 *  Returns true when the relay accepted it (HTTP ok), false on a network error,
 *  a non-ok response, or no pairing, so the caller can queue and retry. */
export async function postCommand(
  sealedCommand: string,
  relayUrl?: string,
  commandId?: string,
): Promise<boolean> {
  const pairing = await getPairing();
  if (!pairing) return false;

  const url = relayUrl ?? pairing.relayUrl;
  const { u, devicePubkey } = pairing;

  const deviceKey = await getOrCreateDeviceKey();
  const deviceEdPrivateKey = hexToBytes(deviceKey.devicePrivHex);

  const ts = nowIso();
  const cid = commandId ?? makeCommandId();
  const sha = sha256Hex(sealedCommand);
  const sig = sign(
    commandPostMessage(u, devicePubkey, cid, ts, sha),
    deviceEdPrivateKey,
  );
  try {
    const res = await fetch(`${url}/capture/command?u=${u}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ u, device: devicePubkey, commandId: cid, ts, sig, sealed: sealedCommand }),
    });
    return res.ok;
  } catch {
    // Offline or relay unreachable. Caller queues it for the reconnect flush.
    return false;
  }
}
