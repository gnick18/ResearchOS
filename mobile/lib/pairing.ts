// Phone pairing storage (piece C). After the phone verifies a scanned grant and
// registers its device key with the relay, we persist the bound relation: which
// user this phone reports to, the relay base url to upload against, and this
// phone's own device public key. No raw payload is kept; the verified, parsed
// values are the record. House style: no em-dashes, no emojis, no mid-sentence
// colons.
import { useCallback, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

const PAIRING_KEY = 'researchos.pairing.v1';

export type Pairing = {
  // The lab user's identity public key (hex), from the verified grant.
  u: string;
  // The relay base url taken from the grant, never hardcoded.
  relayUrl: string;
  // This phone's device public key (hex), registered with the relay.
  devicePubkey: string;
  // ISO timestamp of when the pairing was saved.
  pairedAt: string;
  // Optional human label carried by the grant, shown on the home tab.
  labName?: string;
};

function isPairing(value: unknown): value is Pairing {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as Pairing).u === 'string' &&
    typeof (value as Pairing).relayUrl === 'string' &&
    typeof (value as Pairing).devicePubkey === 'string' &&
    typeof (value as Pairing).pairedAt === 'string'
  );
}

export async function getPairing(): Promise<Pairing | null> {
  const stored = await SecureStore.getItemAsync(PAIRING_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored);
    if (isPairing(parsed)) {
      return {
        u: parsed.u,
        relayUrl: parsed.relayUrl,
        devicePubkey: parsed.devicePubkey,
        pairedAt: parsed.pairedAt,
        labName: typeof parsed.labName === 'string' ? parsed.labName : undefined,
      };
    }
  } catch {
    // Corrupt record, treat as not paired.
  }
  return null;
}

export async function setPairing(p: {
  u: string;
  relayUrl: string;
  devicePubkey: string;
  pairedAt?: string;
  labName?: string;
}): Promise<Pairing> {
  const pairing: Pairing = {
    u: p.u,
    relayUrl: p.relayUrl,
    devicePubkey: p.devicePubkey,
    pairedAt: p.pairedAt ?? new Date().toISOString(),
    labName: p.labName,
  };
  await SecureStore.setItemAsync(PAIRING_KEY, JSON.stringify(pairing));
  return pairing;
}

export async function clearPairing(): Promise<void> {
  await SecureStore.deleteItemAsync(PAIRING_KEY);
}

// React hook so screens react to pair/unpair. Loads on mount and exposes a
// refresh the caller runs after writing.
export function usePairing() {
  const [pairing, setPairingState] = useState<Pairing | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const current = await getPairing();
      setPairingState(current);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { pairing, loading, refresh };
}
