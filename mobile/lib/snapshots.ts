// E2E snapshot download (piece B). The laptop publishes a small, sealed JSON
// snapshot (for example "today") to the relay, sealed to THIS phone's X25519
// key. The phone fetches it with a device-Ed25519-signed request, unseals it
// locally, and parses the JSON. The relay only ever holds opaque bytes. House
// style: no em-dashes, no emojis, no mid-sentence colons.
import { unsealSnapshot } from '@/lib/device-identity';
import type { Pairing } from '@/lib/pairing';

// ---- Canonical signed-byte string (MUST match relay/scripts/smoke-snapshot.mjs
// and relay/src/worker.ts verbatim). The DEVICE Ed25519 key signs this; "device"
// is the device's Ed25519 pubkey hex. Copied verbatim from the contract. ------

export function snapshotGetMessage(
  u: string,
  name: string,
  device: string,
  ts: string,
): string {
  return `researchos-snapshot-get\nu=${u}\nname=${name}\ndevice=${device}\nts=${ts}`;
}

// One task row as it appears in the "today" snapshot. All fields are tolerated
// missing so a laptop on an older shape never crashes the screen.
export type SnapshotTask = {
  id?: string;
  name?: string;
  start_date?: string;
  end_date?: string;
  task_type?: string;
};

// The decrypted "today" snapshot. generatedAt drives the "last synced" line.
// overdueTasks / upcomingTasks are the actual rows (capped by the laptop); the
// counts stay for the summary chips. Older laptops omit the arrays, so treat
// them as optional and fall back to the counts.
export type TodaySnapshot = {
  generatedAt?: string;
  tasks?: SnapshotTask[];
  overdue?: number;
  upcoming?: number;
  overdueTasks?: SnapshotTask[];
  upcomingTasks?: SnapshotTask[];
};

// Fetch + unseal a named snapshot. GETs the relay's snapshot/get endpoint with a
// device-Ed25519-signed query (device = the phone's Ed25519 pubkey, taken from
// the pairing record), reads the raw sealed bytes on 200, unseals with this
// phone's X25519 key, and JSON-parses the plaintext. Returns null on 404, which
// is the "laptop has not published yet" case. Any other non-200 throws so the
// caller can surface it.
export async function fetchSnapshot(
  name: string,
  pairing: Pairing,
  deviceSign: (message: string) => Promise<string>,
): Promise<any | null> {
  const ts = new Date().toISOString();
  const device = pairing.devicePubkey;
  const sig = await deviceSign(
    snapshotGetMessage(pairing.u, name, device, ts),
  );

  const base = pairing.relayUrl.replace(/\/+$/, '');
  const url =
    `${base}/capture/snapshot/get?u=${pairing.u}` +
    `&name=${encodeURIComponent(name)}` +
    `&device=${device}` +
    `&ts=${encodeURIComponent(ts)}` +
    `&sig=${sig}`;

  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`snapshot fetch failed (status ${res.status})`);
  }

  const sealed = new Uint8Array(await res.arrayBuffer());
  let opened: Uint8Array;
  try {
    opened = await unsealSnapshot(sealed);
  } catch (e) {
    // Unseal (X25519 openSealed) failed. Rare, but worth a clear log for support
    // (usually a device-key mismatch) rather than a generic "could not sync".
    console.warn(
      `[snapshot] unseal failed for "${name}" (sealedBytes=${sealed.length})`,
      e,
    );
    throw e;
  }
  try {
    return JSON.parse(new TextDecoder().decode(opened));
  } catch (e) {
    console.warn(`[snapshot] JSON parse failed for "${name}"`, e);
    throw e;
  }
}
