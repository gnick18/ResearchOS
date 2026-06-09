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
import { getPairing } from '@/lib/pairing';
import { unsealSnapshot, getOrCreateDeviceKey, getOrCreateDeviceX25519Key } from '@/lib/device-identity';

const enc = new TextEncoder();

function sign(message: string, secretKey: Uint8Array): string {
  return bytesToHex(ed25519.sign(enc.encode(message), secretKey));
}

function nowIso(): string {
  return new Date().toISOString();
}

async function sha256Hex(str: string): Promise<string> {
  const bytes = enc.encode(str);
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(buf));
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
  const json = new TextDecoder().decode(plaintext);
  try {
    return JSON.parse(json) as FocusContext;
  } catch {
    return null;
  }
}

/** Post a sealed command to the relay for the laptop to apply.
 *  The command is sealed by the CALLER with sealToRecipient to the user's X25519 pubkey.
 *  Generates a random commandId. Returns without throwing on relay errors
 *  (commands are best-effort). */
export async function postCommand(
  sealedCommand: string,
  relayUrl?: string,
): Promise<void> {
  const pairing = await getPairing();
  if (!pairing) return;

  const url = relayUrl ?? pairing.relayUrl;
  const { u, devicePubkey } = pairing;

  const deviceKey = await getOrCreateDeviceKey();
  const deviceEdPrivateKey = hexToBytes(deviceKey.devicePrivHex);

  const ts = nowIso();
  const commandId = `cmd-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const sha = await sha256Hex(sealedCommand);
  const sig = sign(
    commandPostMessage(u, devicePubkey, commandId, ts, sha),
    deviceEdPrivateKey,
  );
  try {
    await fetch(`${url}/capture/command?u=${u}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ u, device: devicePubkey, commandId, ts, sig, sealed: sealedCommand }),
    });
  } catch {
    // Best-effort; caller can retry if needed.
  }
}
