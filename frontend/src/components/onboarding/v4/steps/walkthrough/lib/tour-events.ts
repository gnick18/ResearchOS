/**
 * Lightweight event bus + polling helpers the Onboarding v4 walkthrough
 * step bodies (P5 — see ONBOARDING_V4_PROPOSAL.md §6) use to detect
 * step-completion signals on real API surfaces.
 *
 * Two flavours:
 *
 *  1. **Direct EventTarget bus** — mirrors the existing `imageEvents` /
 *     `fileEvents` pattern. Steps that touch surfaces which already
 *     emit (image strip, file attach) hook those buses directly.
 *
 *  2. **Polling watcher** — for `projectsApi.create` / `methodsApi.create`
 *     / `tasksApi.create`, the underlying API doesn't emit an event
 *     today. Patching the API to emit would either (a) touch the
 *     production surface for a tutorial-only feature or (b) need a
 *     wrapper layer that risks drift. Instead, the step listener
 *     records the pre-step entity count (or last-id), then polls every
 *     `pollIntervalMs` until the count grows. When it does, the
 *     completion fires.
 *
 *     The poller stops when the controller calls the unsubscribe
 *     function (returned from each `watch*` helper) — so a step that
 *     skips or back-steps doesn't leak a setInterval.
 *
 * Pollers default to 500ms intervals — fast enough to feel responsive,
 * slow enough that even thousands of polled-and-discarded reads over a
 * 12-minute tour cost milliseconds of CPU total.
 *
 * **Why not a CustomEvent on the API call site?** The proposal §4.4
 * mentions `tourEvents` as a possibility "per project-activity precedent."
 * The polling alternative is simpler, has zero blast radius on the API
 * layer, and is fast enough for a tutorial workflow. If a future arc
 * adds a `tourEvents.projectCreated` bus, individual step bodies can be
 * swapped to listen on it without changing their public completion
 * shape.
 */
import { methodsApi, projectsApi, tasksApi } from "@/lib/local-api";

const DEFAULT_POLL_INTERVAL_MS = 500;

/**
 * Generic count-based poller. Resolves via `onIncrease` when the count
 * returned by `read()` grows above the baseline. Returns an unsubscribe
 * function (matches the shape the TourStep `eventListener` callback
 * expects).
 */
function watchCountIncrease(
  read: () => Promise<number>,
  onIncrease: () => void,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
): () => void {
  let baseline: number | null = null;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firing = false;

  const tick = async (): Promise<void> => {
    if (cancelled || firing) return;
    firing = true;
    try {
      const current = await read();
      if (cancelled) return;
      if (baseline === null) {
        baseline = current;
      } else if (current > baseline) {
        cancelled = true;
        onIncrease();
        return;
      }
    } catch {
      // Read failed (e.g., user mid-folder-switch). Skip this tick and
      // try again — pollers are forgiving of transient failures.
    } finally {
      firing = false;
    }
    if (!cancelled) {
      timer = setTimeout(() => {
        void tick();
      }, pollIntervalMs);
    }
  };

  void tick();

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}

/**
 * Watch for a new project. Calls `advance` when `projectsApi.list()`
 * grows above the baseline observed at subscription time.
 */
export function watchProjectCreated(advance: () => void): () => void {
  return watchCountIncrease(
    async () => {
      const projects = await projectsApi.list();
      return projects.length;
    },
    advance,
  );
}

/**
 * Watch for a new method. Same shape as `watchProjectCreated`.
 */
export function watchMethodCreated(advance: () => void): () => void {
  return watchCountIncrease(
    async () => {
      const methods = await methodsApi.list();
      return methods.length;
    },
    advance,
  );
}

/**
 * Watch for a new task (experiment / list / project task type) in the
 * given project. When `projectId` is undefined, watches the
 * sentinel-0 "no project" bucket — useful when the walkthrough's prior
 * step was skipped and the experiment lands without a project.
 *
 * Uses `tasksApi.listByProject(projectId)` rather than a global list
 * because the public API doesn't expose a list-all surface — task data
 * is naturally project-scoped in the v4 product.
 */
export function watchTaskCreated(
  advance: () => void,
  projectId?: number,
): () => void {
  return watchCountIncrease(
    async () => {
      const tasks = await tasksApi.listByProject(projectId ?? 0);
      return tasks.length;
    },
    advance,
  );
}

/**
 * Watch for an `imageEvents.attached` fire — used by §6.7 hybrid editor
 * step (selfie image drop) + §6.13 telegram inbox step. We listen
 * dynamically to avoid coupling this module's import to the image-events
 * surface at module load.
 */
export function watchImageAttached(advance: () => void): () => void {
  let unsubscribed = false;
  let unsubscribe: (() => void) | null = null;
  // Dynamic import keeps this module's top-level import graph lean.
  void import("@/lib/attachments/image-events").then(({ imageEvents }) => {
    if (unsubscribed) return;
    unsubscribe = imageEvents.onAttached(() => {
      if (!unsubscribed) advance();
    });
  });
  return () => {
    unsubscribed = true;
    if (unsubscribe) {
      try {
        unsubscribe();
      } catch {
        /* ignore */
      }
    }
  };
}
