// v0 phone pairing storage. The companion pairs the phone to the user's lab.
// For v0 this is intentionally simple: we store whatever payload was scanned
// (or typed) plus a timestamp. No crypto, no device keys, no network yet, that
// is the next increment. House style: no em-dashes, no emojis.
import { useCallback, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

const PAIRING_KEY = 'researchos.pairing.v0';

export type Pairing = {
  // The raw scanned (or typed) payload, stored verbatim.
  raw: string;
  // ISO timestamp of when the pairing was saved.
  pairedAt: string;
  // Parsed from the payload when it is JSON with a labName field, else undefined.
  labName?: string;
};

// Pull a human label out of the payload if it happens to be JSON carrying one.
// Anything that is not JSON-with-labName stays as a bare raw payload.
function parseLabName(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { labName?: unknown }).labName === 'string'
    ) {
      const name = (parsed as { labName: string }).labName.trim();
      return name.length > 0 ? name : undefined;
    }
  } catch {
    // Not JSON, that is fine for v0. Keep the raw payload.
  }
  return undefined;
}

export async function getPairing(): Promise<Pairing | null> {
  const stored = await SecureStore.getItemAsync(PAIRING_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<Pairing>;
    if (parsed && typeof parsed.raw === 'string' && typeof parsed.pairedAt === 'string') {
      return {
        raw: parsed.raw,
        pairedAt: parsed.pairedAt,
        labName: typeof parsed.labName === 'string' ? parsed.labName : undefined,
      };
    }
  } catch {
    // Corrupt record, treat as not paired.
  }
  return null;
}

// Accepts either a full Pairing or just the parts the caller knows; labName is
// derived from raw when not supplied so callers only have to pass the payload.
export async function setPairing(
  p: { raw: string; pairedAt?: string; labName?: string },
): Promise<Pairing> {
  const pairing: Pairing = {
    raw: p.raw,
    pairedAt: p.pairedAt ?? new Date().toISOString(),
    labName: p.labName ?? parseLabName(p.raw),
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
