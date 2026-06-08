// Mobile DOWNLOAD path, the laptop publisher (piece C).
//
// Builds a small "today" view of the connected folder's tasks and seals it,
// once per paired phone, to that phone's X25519 key before publishing it to the
// capture relay. The relay only ever holds the sealed bytes, so a phone with
// the matching device key is the only thing that can read its own snapshot. The
// seal construction is sealToRecipient from lib/sharing/encryption.ts, the exact
// inverse of what the phone runs (openSealed); see relay/scripts/smoke-snapshot.mjs
// for the full round-trip proof.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { fetchAllTasks } from "@/lib/local-api";
import { sealToRecipient } from "@/lib/sharing/encryption";
import { decodePublicKey } from "@/lib/sharing/identity/keys";
import { listDevices, publishSnapshot, type UserCaptureKeys } from "./client";

/** A single task as it appears in the phone's "today" view. */
export interface SnapshotTask {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  task_type: string;
}

/** The decrypted shape the phone reads after openSealed. */
export interface TodaySnapshot {
  generatedAt: string;
  /** Tasks active today (start_date <= today <= end_date). */
  tasks: SnapshotTask[];
  /** Overdue count, kept for the summary chip. */
  overdue: number;
  /** Upcoming count, kept for the summary chip. */
  upcoming: number;
  /** The overdue tasks themselves (capped), soonest-due first, so the bench
   *  glance can list what is behind, not just a number. */
  overdueTasks: SnapshotTask[];
  /** The next upcoming tasks (capped), soonest-start first. */
  upcomingTasks: SnapshotTask[];
}

/** Cap on how many overdue / upcoming rows ride in the sealed snapshot, to keep
 *  the payload small. The counts above are always exact. */
const LIST_CAP = 20;

/** Local calendar day as YYYY-MM-DD, matching how task dates are stored. */
function localToday(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** A minimal Task shape this module reads. The full Task carries more, but the
 *  buckets only need these fields. */
interface TaskLike {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  task_type: string;
  is_complete: boolean;
}

/**
 * Splits tasks into today's buckets against a fixed `today` (YYYY-MM-DD):
 *   active   = incomplete and start_date <= today <= end_date
 *   overdue  = incomplete and end_date < today
 *   upcoming = incomplete and start_date > today
 * Completed tasks are dropped from every bucket. Exported for unit testing.
 */
export function classifyToday(
  tasks: TaskLike[],
  today: string,
): { active: TaskLike[]; overdue: TaskLike[]; upcoming: TaskLike[] } {
  const active: TaskLike[] = [];
  const overdue: TaskLike[] = [];
  const upcoming: TaskLike[] = [];
  for (const t of tasks) {
    if (t.is_complete) continue;
    if (t.start_date > today) {
      upcoming.push(t);
    } else if (t.end_date < today) {
      overdue.push(t);
    } else {
      // start_date <= today <= end_date
      active.push(t);
    }
  }
  return { active, overdue, upcoming };
}

/** Reads the connected folder's tasks and builds today's snapshot. */
export async function buildTodaySnapshot(): Promise<TodaySnapshot> {
  const today = localToday();
  const tasks = (await fetchAllTasks()) as unknown as TaskLike[];
  const { active, overdue, upcoming } = classifyToday(tasks, today);
  const toSnap = (t: TaskLike): SnapshotTask => ({
    id: t.id,
    name: t.name,
    start_date: t.start_date,
    end_date: t.end_date,
    task_type: t.task_type,
  });
  // Overdue oldest-due first (most behind at the top); upcoming soonest-first.
  const overdueSorted = [...overdue].sort((a, b) =>
    a.end_date.localeCompare(b.end_date),
  );
  const upcomingSorted = [...upcoming].sort((a, b) =>
    a.start_date.localeCompare(b.start_date),
  );
  return {
    generatedAt: new Date().toISOString(),
    tasks: active.map(toSnap),
    overdue: overdue.length,
    upcoming: upcoming.length,
    overdueTasks: overdueSorted.slice(0, LIST_CAP).map(toSnap),
    upcomingTasks: upcomingSorted.slice(0, LIST_CAP).map(toSnap),
  };
}

/**
 * Builds today's snapshot once, then seals + publishes a copy to every paired
 * phone that has an X25519 key on file. Phones registered before the DOWNLOAD
 * path landed have no seal key and are skipped (logged, not an error). Returns
 * how many were published vs skipped.
 */
export async function publishTodayToAllDevices(
  keys: UserCaptureKeys,
): Promise<{ published: number; skipped: number }> {
  const devices = await listDevices(keys);
  if (devices.length === 0) return { published: 0, skipped: 0 };

  const snap = await buildTodaySnapshot();
  const plaintext = new TextEncoder().encode(JSON.stringify(snap));

  let published = 0;
  let skipped = 0;
  for (const device of devices) {
    if (!device.x25519Pubkey) {
      console.info(
        `[today-publisher] skip device ${device.devicePubkey.slice(0, 12)}... (no x25519 seal key)`,
      );
      skipped += 1;
      continue;
    }
    const sealed = sealToRecipient(plaintext, decodePublicKey(device.x25519Pubkey));
    await publishSnapshot(keys, "today", device.devicePubkey, sealed);
    published += 1;
  }
  return { published, skipped };
}
