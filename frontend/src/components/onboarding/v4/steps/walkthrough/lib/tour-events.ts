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
 * Custom DOM event names the §6.1 home-create-project sub-steps listen
 * for. The home page dispatches `tour:home-create-modal-opened` when the
 * user clicks the "+ New Project" affordance (so the second sub-step
 * can advance the moment the form mounts). `projectsApi.create` fires
 * `tour:project-created` on success so the second sub-step doesn't have
 * to wait for the polling tick.
 *
 * We keep these as plain DOM CustomEvent names rather than wiring a
 * dedicated EventTarget bus so the surface that emits (page.tsx /
 * local-api.ts) doesn't have to import this tour-only module. The cost
 * when no tour is active is one `window.dispatchEvent` per modal open
 * (cheap, fires regardless of listeners).
 */
export const TOUR_DOM_EVENTS = {
  homeCreateModalOpened: "tour:home-create-modal-opened",
  projectCreated: "tour:project-created",
} as const;

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
 * Watch for a new project. Resolves via either:
 *   1. the `tour:project-created` custom DOM event dispatched by
 *      `projectsApi.create` on success (fast path, no polling lag), or
 *   2. the polling baseline-grows watcher as a safety net for any code
 *      path that bypasses `projectsApi.create` (e.g. a direct
 *      `projectsStore.create` in a test fixture).
 *
 * Both paths fan into the same `advance` callback, guarded so we only
 * fire once even if both signals race.
 */
export function watchProjectCreated(advance: () => void): () => void {
  let fired = false;
  const fireOnce = () => {
    if (fired) return;
    fired = true;
    advance();
  };

  // 1. DOM event fast path. Browser-only — jsdom in tests supplies
  // `window`, so this works there too.
  let removeListener: (() => void) | undefined;
  if (typeof window !== "undefined") {
    const handler = () => fireOnce();
    window.addEventListener(TOUR_DOM_EVENTS.projectCreated, handler);
    removeListener = () =>
      window.removeEventListener(TOUR_DOM_EVENTS.projectCreated, handler);
  }

  // 2. Polling safety net.
  const stopPolling = watchCountIncrease(
    async () => {
      const projects = await projectsApi.list();
      return projects.length;
    },
    fireOnce,
  );

  return () => {
    removeListener?.();
    stopPolling();
  };
}

/**
 * Watch for the home-page "+ New Project" modal to mount. The home page
 * (`app/page.tsx`) dispatches `tour:home-create-modal-opened` on the
 * window when the user (or the cursor script's synthetic click) flips
 * the form into the visible state. Used by the §6.1 `home-create-project`
 * sub-step so BeakerBot can swap into the fill-form speech the instant
 * the form appears.
 *
 * A second-best fallback watches the DOM for the form node mounting via
 * its `data-tour-target="home-project-create-form"` attribute, so a
 * future refactor that drops the explicit dispatch (e.g. moves the form
 * into a portaled modal) still trips the advance.
 */
export function watchHomeCreateModalOpened(
  advance: () => void,
): () => void {
  let fired = false;
  const fireOnce = () => {
    if (fired) return;
    fired = true;
    advance();
  };

  let removeListener: (() => void) | undefined;
  let mo: MutationObserver | undefined;

  if (typeof window !== "undefined") {
    const handler = () => fireOnce();
    window.addEventListener(TOUR_DOM_EVENTS.homeCreateModalOpened, handler);
    removeListener = () =>
      window.removeEventListener(
        TOUR_DOM_EVENTS.homeCreateModalOpened,
        handler,
      );
  }

  if (typeof document !== "undefined") {
    // DOM-mount fallback. If the form is already on screen (e.g. the
    // tour entered this step after the user opened the modal manually),
    // fire immediately so we don't wait for a second event.
    if (document.querySelector("[data-tour-target=\"home-project-create-form\"]")) {
      fireOnce();
    } else if (typeof MutationObserver !== "undefined") {
      mo = new MutationObserver(() => {
        if (
          document.querySelector(
            "[data-tour-target=\"home-project-create-form\"]",
          )
        ) {
          fireOnce();
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }
  }

  return () => {
    removeListener?.();
    mo?.disconnect();
  };
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
