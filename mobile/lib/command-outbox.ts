// Command outbox (companion, 2026-06-13). Bench writes are sealed commands
// posted to the relay for the laptop to apply (variation notes today, method
// checklist state next). The phone is often offline at the bench, so a post
// that fails is QUEUED here in AsyncStorage and flushed automatically when the
// network comes back, instead of being silently lost. Mirrors the photo capture
// outbox in captures.ts.
//
// Each item keeps a STABLE commandId so a retry re-uses the same id and the
// laptop poller can dedupe (it must never apply the same variation twice). The
// blobs are already sealed and signed at post time, so the queue only stores
// ciphertext.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { postCommand } from '@/lib/focus-context';

const OUTBOX_KEY = 'ros.command.outbox.v1';

export type OutboxItem = {
  id: string; // stable commandId, reused across retries for laptop dedupe
  sealedHex: string; // the sealed command blob (ciphertext)
  relayUrl?: string; // explicit relay override, else the pairing default
  kind: string; // 'add-variation' | 'method-check', for display and debugging
  at: string; // ISO enqueue time
};

let counter = 0;
function makeId(kind: string): string {
  counter += 1;
  return `cmd_${Date.now().toString(36)}_${counter}_${kind}`;
}

async function read(): Promise<OutboxItem[]> {
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as OutboxItem[]) : [];
  } catch {
    return [];
  }
}

async function write(items: OutboxItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
  } catch {
    // Best-effort; losing the write only means a retry on the next flush.
  }
}

/** How many commands are still waiting to sync. For a "N pending" cue. */
export async function pendingCommandCount(): Promise<number> {
  return (await read()).length;
}

/**
 * Try to deliver a sealed command now; if the post fails (offline or relay
 * down), store it to retry on the next reconnect. Returns 'sent' when the relay
 * accepted it and 'queued' when it was stored, so the caller can tell the user
 * "synced" vs "saved, will sync when connected".
 */
export async function sendOrQueueCommand(
  sealedHex: string,
  kind: string,
  relayUrl?: string,
): Promise<'sent' | 'queued'> {
  const id = makeId(kind);
  const ok = await postCommand(sealedHex, relayUrl, id);
  if (ok) return 'sent';
  const items = await read();
  items.push({ id, sealedHex, relayUrl, kind, at: new Date().toISOString() });
  await write(items);
  return 'queued';
}

let flushing = false;

/**
 * Try to deliver every queued command, keeping the ones that still fail. Safe
 * to call repeatedly and concurrently (guards against overlapping runs and
 * early-returns when the queue is empty).
 */
export async function flushCommandOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const items = await read();
    if (items.length === 0) return;
    const remaining: OutboxItem[] = [];
    for (const item of items) {
      const ok = await postCommand(item.sealedHex, item.relayUrl, item.id);
      if (!ok) remaining.push(item);
    }
    await write(remaining);
  } finally {
    flushing = false;
  }
}

/**
 * Start auto-flushing: flush once now (in case the app was reopened with a
 * pending queue) and again whenever NetInfo reports the network is up. The
 * flush early-returns when the queue is empty, so reacting to every connected
 * event is cheap. Call once at the app root; returns an unsubscribe.
 */
export function startCommandOutboxAutoFlush(): () => void {
  void flushCommandOutbox();
  const unsub = NetInfo.addEventListener((s) => {
    if (s.isConnected !== false) void flushCommandOutbox();
  });
  return unsub;
}
