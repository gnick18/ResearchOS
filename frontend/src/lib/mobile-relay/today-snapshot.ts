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

import { fetchAllTasks, methodsApi } from "@/lib/local-api";
import { sealToRecipient } from "@/lib/sharing/encryption";
import { decodePublicKey } from "@/lib/sharing/identity/keys";
import { listDevices, publishSnapshot, type UserCaptureKeys } from "./client";
import type { Task } from "@/lib/types";

/** A single task as it appears in the phone's "today" view. */
export interface SnapshotTask {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  task_type: string;
  /**
   * Name of the first attached method. Only populated for experiment-type tasks
   * that have at least one method attachment. Optional so older phones and all
   * non-experiment tasks are completely unaffected.
   */
  linkedMethodName?: string | null;
  /**
   * Raw method_type of the first attached method (e.g. "pcr", "markdown").
   * Optional companion to linkedMethodName, used by the phone for a type badge.
   * Omitted when the method could not be resolved or the task is not an experiment.
   */
  linkedMethodType?: string | null;
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
 *  buckets only need these fields. method_attachments is included so the
 *  experiment-band resolution can reach the first attached method without a
 *  second full-task fetch. */
interface TaskLike {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  task_type: string;
  is_complete: boolean;
  /** Present on real Task records returned by fetchAllTasks. */
  method_attachments?: Array<{ method_id: number; owner: string | null }>;
  /** Present on real Task records; used as fallback owner for method lookup. */
  owner?: string;
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

/**
 * Resolve the name (and raw method_type) of the first method attachment on an
 * experiment task. Only called for tasks where task_type === "experiment" and
 * method_attachments is non-empty, so the methodsApi.get calls are bounded to
 * the set of active-today experiments, not the whole task list. Returns null
 * when the method cannot be loaded (safe degradation).
 */
async function resolveFirstMethodName(
  t: TaskLike,
): Promise<{ name: string | null; methodType: string | null }> {
  const attachments = t.method_attachments ?? [];
  if (attachments.length === 0) return { name: null, methodType: null };
  const first = attachments[0];
  const lookupOwner = first.owner ?? t.owner ?? undefined;
  try {
    const method = await methodsApi.get(first.method_id, lookupOwner);
    if (!method) return { name: null, methodType: null };
    return {
      name: (method as { name?: string }).name ?? null,
      methodType: (method as { method_type?: string | null }).method_type ?? null,
    };
  } catch {
    return { name: null, methodType: null };
  }
}

/** Reads the connected folder's tasks and builds today's snapshot. */
export async function buildTodaySnapshot(): Promise<TodaySnapshot> {
  const today = localToday();
  const tasks = (await fetchAllTasks()) as unknown as TaskLike[];
  const { active, overdue, upcoming } = classifyToday(tasks, today);

  // Resolve linked method names for experiment-type active tasks only.
  // Non-experiment tasks and experiments with no attachments skip the API call.
  const methodResolutions = new Map<string, { name: string | null; methodType: string | null }>();
  await Promise.all(
    active
      .filter(
        (t) =>
          t.task_type === "experiment" &&
          Array.isArray(t.method_attachments) &&
          t.method_attachments.length > 0,
      )
      .map(async (t) => {
        const resolved = await resolveFirstMethodName(t);
        methodResolutions.set(t.id, resolved);
      }),
  );

  const toSnap = (t: TaskLike): SnapshotTask => {
    const snap: SnapshotTask = {
      id: t.id,
      name: t.name,
      start_date: t.start_date,
      end_date: t.end_date,
      task_type: t.task_type,
    };
    const resolved = methodResolutions.get(t.id);
    if (resolved) {
      snap.linkedMethodName = resolved.name;
      snap.linkedMethodType = resolved.methodType;
    }
    return snap;
  };

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
