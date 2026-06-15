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
  /**
   * Total number of methods attached to this task (>= 1 when linkedMethodName is
   * set). Lets the phone glance show "first method +N more" without resolving
   * every method name. Omitted when no method is attached; treat absent as 1.
   */
  linkedMethodCount?: number | null;
  /**
   * Every method attached to this task, in attachment order (capped). Powers the
   * phone's experiment hub screen (list all methods, then open one). Each entry
   * carries the id + owner so the phone can deep-link to that specific method.
   * Omitted when no method is attached; linkedMethodName/Type/Count are derived
   * from this list's first entry for older phones that ignore the array.
   */
  linkedMethods?: Array<{
    methodId: number;
    owner: string | null;
    name: string | null;
    methodType: string | null;
  }> | null;
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

/** Cap on how many methods per task ride in the snapshot, to bound payload and
 *  the methodsApi.get fan-out. Tasks rarely exceed this; the count above stays
 *  exact even when the listed array is capped. */
const METHODS_PER_TASK_CAP = 12;

type ResolvedMethod = {
  methodId: number;
  owner: string | null;
  name: string | null;
  methodType: string | null;
};

/**
 * Resolve every method attached to a task (name + raw method_type + id/owner),
 * in attachment order, capped at METHODS_PER_TASK_CAP. Only called for tasks
 * with at least one attachment, so the methodsApi.get fan-out is bounded to the
 * active/overdue/upcoming tasks that actually carry methods. Entries that fail
 * to load keep their id/owner with null name (safe degradation, still listable).
 */
async function resolveTaskMethods(t: TaskLike): Promise<ResolvedMethod[]> {
  const attachments = (t.method_attachments ?? []).slice(0, METHODS_PER_TASK_CAP);
  if (attachments.length === 0) return [];
  return Promise.all(
    attachments.map(async (att): Promise<ResolvedMethod> => {
      const lookupOwner = att.owner ?? t.owner ?? null;
      try {
        const method = await methodsApi.get(att.method_id, lookupOwner ?? undefined);
        return {
          methodId: att.method_id,
          owner: lookupOwner,
          name: (method as { name?: string })?.name ?? null,
          methodType: (method as { method_type?: string | null })?.method_type ?? null,
        };
      } catch {
        return { methodId: att.method_id, owner: lookupOwner, name: null, methodType: null };
      }
    }),
  );
}

/** Reads the connected folder's tasks and builds today's snapshot. */
export async function buildTodaySnapshot(): Promise<TodaySnapshot> {
  const today = localToday();
  const tasks = (await fetchAllTasks()) as unknown as TaskLike[];
  const { active, overdue, upcoming } = classifyToday(tasks, today);

  // Resolve every attached method for ANY task (experiment or not) across all
  // three buckets that carries attachments, so the phone's experiment hub works
  // for today, overdue, and upcoming rows alike. Tasks with no attachments skip
  // the API calls entirely. Overdue/upcoming are capped first to bound the
  // fan-out to what actually rides in the snapshot.
  const resolvable = [
    ...active,
    ...overdue.slice(0, LIST_CAP),
    ...upcoming.slice(0, LIST_CAP),
  ].filter(
    (t) => Array.isArray(t.method_attachments) && t.method_attachments.length > 0,
  );
  const methodResolutions = new Map<string, ResolvedMethod[]>();
  await Promise.all(
    resolvable.map(async (t) => {
      methodResolutions.set(t.id, await resolveTaskMethods(t));
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
    const methods = methodResolutions.get(t.id);
    if (methods && methods.length > 0) {
      snap.linkedMethods = methods;
      // Derive the first-method glance fields from the list so older phones that
      // ignore linkedMethods still render the card + "+N more" count.
      snap.linkedMethodName = methods[0].name;
      snap.linkedMethodType = methods[0].methodType;
      snap.linkedMethodCount = t.method_attachments?.length ?? methods.length;
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
