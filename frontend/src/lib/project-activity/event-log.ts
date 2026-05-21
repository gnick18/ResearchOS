import { fileService } from "@/lib/file-system/file-service";
import { getCurrentUserCached } from "@/lib/storage/json-store";

// Project-scoped activity feed (Project Surface L7). Append-on-mutation
// sidecar at `users/<projectOwner>/projects/<projectId>-activity.json`.
// Mirrors `_shifted-alerts.json` (local-api.ts:3067-3216): read-modify-write,
// missing-file = empty, lazy-prune-on-write at the retention boundary.
//
// The activity log lives in the PROJECT OWNER's directory, not the actor's.
// A receiver with edit permission acting on a shared project emits an event
// that lands in the owner's `<id>-activity.json` — so every collaborator
// sees the same chronological feed when they load the project.
//
// All mutation call sites are best-effort: `recordProjectActivity` swallows
// its own errors so a failed sidecar write never masks a successful mutation.

export interface ProjectActivityEventBase {
  /** UUID — stable across reads, dedup is by id. */
  id: string;
  /** ISO timestamp at emission. */
  ts: string;
  /** Username of the user who took the action. May differ from the project
   *  owner (receivers acting on shared projects). */
  actor: string;
}

export type ProjectActivityEvent = ProjectActivityEventBase & (
  | {
      type: "task_completed";
      task_id: number;
      task_owner: string;
      task_name: string;
    }
  | {
      type: "image_added";
      image_name: string;
      surface: "overview" | "task_notes" | "task_results";
      task_id?: number;
      task_owner?: string;
      task_name?: string;
    }
  | {
      type: "method_added";
      task_id: number;
      task_owner: string;
      task_name?: string;
      method_id: number;
      method_owner: string | null;
      method_name?: string;
    }
  | {
      type: "method_removed";
      task_id: number;
      task_owner: string;
      task_name?: string;
      method_id: number;
      method_owner: string | null;
      method_name?: string;
    }
  | { type: "prose_edited" }
  | {
      type: "project_shared";
      recipient: string;
      permission: "view" | "edit";
    }
  | { type: "project_archived"; archived: boolean }
);

/** Distribute Omit over a discriminated union so each variant keeps its own
 *  payload fields. A naive `Omit<U, K>` over a union collapses to the
 *  intersection of variant fields, which is wrong here — we want callers to
 *  pass exactly one variant's payload. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** Caller passes the event body minus the auto-populated base fields (`id`,
 *  `ts`). `actor` is optional on input; when omitted, the current cached
 *  user is used. */
export type ProjectActivityEventInput = DistributiveOmit<
  ProjectActivityEvent,
  "id" | "ts" | "actor"
> & {
  actor?: string;
};

export interface ProjectActivityFile {
  version: 1;
  events: ProjectActivityEvent[];
}

/** 90-day lazy retention per L7. Older events are dropped on the next write
 *  call — mirrors the shifted-alerts pattern (local-api.ts:3145). */
const RETENTION_DAYS = 90;
const RETENTION_MS = RETENTION_DAYS * 86400 * 1000;

function activityPath(projectOwner: string, projectId: number): string {
  return `users/${projectOwner}/projects/${projectId}-activity.json`;
}

async function readFile(
  projectOwner: string,
  projectId: number,
): Promise<ProjectActivityFile> {
  const data = await fileService.readJson<Partial<ProjectActivityFile>>(
    activityPath(projectOwner, projectId),
  );
  return {
    version: 1,
    events: data?.events ?? [],
  };
}

async function writeFile(
  projectOwner: string,
  projectId: number,
  data: ProjectActivityFile,
): Promise<void> {
  await fileService.writeJson(activityPath(projectOwner, projectId), data);
}

function newEventId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Append a single event to the project's activity sidecar. Lazy-prunes any
 * existing events older than the 90-day retention boundary before writing.
 *
 * Silent no-ops:
 *   - `projectId === 0` (the "no project" sentinel — emitted by task-scoped
 *     call sites for tasks not assigned to any project).
 *   - empty `projectOwner` (defensive — shouldn't happen in normal flow).
 *   - no resolvable actor (no current user logged in).
 *
 * Errors are caught + logged; the call never throws. Mutation call sites
 * must not be gated on activity-feed success.
 */
export async function recordProjectActivity(
  projectOwner: string,
  projectId: number,
  event: ProjectActivityEventInput,
): Promise<void> {
  try {
    if (!projectOwner || projectId === 0) return;
    const actor = event.actor ?? (await getCurrentUserCached());
    if (!actor) return;

    const { actor: _omit, ...rest } = event;
    const entry = {
      id: newEventId(),
      ts: new Date().toISOString(),
      actor,
      ...rest,
    } as ProjectActivityEvent;

    const file = await readFile(projectOwner, projectId);

    // Lazy retention pass: drop entries older than the retention window
    // before appending the new one, so the file stays bounded for long-lived
    // projects. Unparseable timestamps are KEPT (don't lose data over a
    // bad date string) — matches the shifted-alerts pattern.
    const cutoffMs = Date.now() - RETENTION_MS;
    const beforePrune = file.events.length;
    file.events = file.events.filter((e) => {
      const ts = Date.parse(e.ts);
      if (!isFinite(ts)) return true;
      return ts >= cutoffMs;
    });
    const prunedCount = beforePrune - file.events.length;
    if (prunedCount > 0) {
      console.log(
        `[project-activity] pruned ${prunedCount} events older than ${RETENTION_DAYS}d from ${projectOwner}/projects/${projectId}-activity.json`,
      );
    }

    file.events.push(entry);
    await writeFile(projectOwner, projectId, file);
  } catch (err) {
    console.warn("[project-activity] failed to record event:", err);
  }
}

/**
 * Read the project's activity sidecar. Missing file = empty list. Events
 * are returned newest-first; writers don't need to maintain order.
 */
export async function readProjectActivity(
  projectOwner: string,
  projectId: number,
): Promise<ProjectActivityEvent[]> {
  if (!projectOwner || projectId === 0) return [];
  const file = await readFile(projectOwner, projectId);
  return [...file.events].sort((a, b) => b.ts.localeCompare(a.ts));
}
