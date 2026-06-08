// v0 bench photo capture queue. The companion's headline move is snapping a
// bench photo, captioning it, and queuing it to send to the lab. For v0 this is
// intentionally local-only. We persist a small JSON list in AsyncStorage and
// keep each image at the picker's returned uri. No network, no durable file
// copy yet, that is the next increment. House style: no em-dashes, no emojis.
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CAPTURES_KEY = 'researchos.captures.v0';

export type Capture = {
  // Stable id for the row. Generated at call time, see makeId below.
  id: string;
  // The picker's returned local uri. Durable copy is a refine-later item.
  uri: string;
  // Optional caption the user typed. Empty string when none was given.
  caption: string;
  // ISO timestamp of when the capture was queued.
  createdAt: string;
  // v0 only ever queues. Sync flips this later.
  status: 'queued';
};

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
    (value as Capture).status === 'queued'
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

// React hook so screens react to add/remove. Loads on mount and exposes a
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
