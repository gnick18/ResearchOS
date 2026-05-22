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
  /**
   * Dispatched by `ProjectRoute.tsx` on mount. The §6.2 walkthrough splits
   * into a NAV sub-step (cursor clicks the project card on home) plus a
   * PROSE sub-step (cursor types into the Overview textarea on the project
   * page). The NAV step advances on this event so the PROSE step's cursor
   * script starts AFTER the route change, not before. A single cursor
   * script can't span a navigation because `InProductWalkthroughOverlay`
   * unmounts on route change, cancelling the in-flight `runScript`.
   */
  projectRouteEntered: "tour:project-route-entered",
  /**
   * Dispatched by `CreateMethodModal.tsx` on mount (the picker is the
   * first thing the modal renders, so a mount-effect fires the moment
   * the picker is on screen). The `methods-open-picker` sub-step
   * advances on this event so the follow-up type-tour body kicks in
   * only after the picker is actually visible.
   */
  methodsPickerOpened: "tour:methods-picker-opened",
  /**
   * Dispatched by `app/methods/page.tsx` from its handleCategoryCreated
   * callback. The `methods-category` demo step listens on this event
   * for completion. Categories are local-state only (no API count to
   * poll), so this event is the only completion signal.
   */
  methodsCategoryCreated: "tour:methods-category-created",
  /**
   * Dispatched by methods/page.tsx when the user clicks "+ New Category"
   * and the New Category modal mounts. The §6.4 methods-category-open
   * user-action sub-step (Grant 2026-05-21 follow-up) listens on this
   * to advance into the type+submit demo step.
   */
  methodsCategoryModalOpened: "tour:methods-category-modal-opened",
  /**
   * Dispatched by WorkbenchExperimentsPanel.tsx when the user clicks
   * "+ New Experiment" (the TaskModal mounts via setIsCreatingTask). The
   * §6.5 workbench-create-experiment-open user-action sub-step (Grant
   * 2026-05-21 split) listens on this to advance into BeakerBot's
   * type+submit demo step.
   */
  workbenchExperimentModalOpened: "tour:workbench-experiment-modal-opened",
  /**
   * Dispatched by `CreateMethodModal.tsx` after a successful save (both
   * plain Create and Save-and-extend). The §6.4d `methods-create` demo
   * step listens on this so the cursor's typed-then-Save sequence
   * advances the instant the row lands, instead of waiting for the
   * methodsApi.list polling tick. Mirrors `tour:project-created` from
   * local-api.ts projectsApi.create.
   */
  methodCreated: "tour:method-created",
  /**
   * Dispatched by NotificationPopup.tsx on open. The §6.3 bell sub-step
   * advances on this so the silence sub-step's spotlight lands AFTER
   * the popup is on screen.
   */
  notificationsPopupOpened: "tour:notifications-popup-opened",
  /**
   * Dispatched by NotificationPopup.tsx when the row's Mark-as-read
   * button fires. §6.3 silence sub-step advances on this.
   */
  notificationSilenced: "tour:notification-silenced",
  /**
   * Dispatched by NotificationPopup.tsx when the row's Dismiss (X)
   * fires. §6.3 delete sub-step advances on this.
   */
  notificationDeleted: "tour:notification-deleted",
  /**
   * Dispatched by `TaskDetailPopup.tsx` on mount when the task is an
   * experiment. The §6.6 walkthrough splits the original
   * `experiment-attach-method` step into four sub-steps because the
   * popup mounts mid-script (same class of bug as §6.2's route-spanning
   * cursor script). The `experiment-attach-method-open` sub-step's
   * cursor clicks the workbench experiment row; this event lets the
   * follow-up `experiment-attach-method-tab` sub-step start its own
   * cursor script AFTER the popup is on screen.
   */
  experimentPopupOpened: "tour:experiment-popup-opened",
  /**
   * Dispatched by `TaskDetailPopup.tsx` when `selectTab("method")` runs.
   * The `experiment-attach-method-tab` sub-step's cursor clicks the
   * Methods tab; this event signals "the Methods tab body is now
   * rendered" so the follow-up `experiment-attach-method-attach`
   * sub-step's cursor script can resolve the Attach button selector.
   */
  experimentMethodsTabActive: "tour:experiment-methods-tab-active",
  /**
   * Dispatched by `NewPurchaseModal.tsx` after the parent task + line
   * item save succeeds. The §6.14 `purchases` cursor-driven demo step
   * captures the task id, line item id, and the typed funding string
   * out of `detail` so the three artifacts (purchase, purchase_item,
   * funding_string) land in `wizard_resume_state.artifacts_created`
   * for Phase 4 cleanup. Re-dispatched on every save so a refresh
   * mid-tour that re-opens the modal can re-flush the artifact list
   * idempotently via `appendArtifact`.
   */
  purchaseCreated: "tour:purchase-created",
  /**
   * Onboarding v4 §6.14 Purchases redesign 2026-05-22 (Purchases
   * manager). Dispatched by the `purchases-demo-warp-prompt` step body
   * when the user clicks "Take me to the demo page". The /purchases
   * page listens and toggles its `DemoPurchasesViewer` overlay on top of
   * the user's real surface — no route change, so the tour controller's
   * step state survives.
   */
  demoPurchasesViewerOpen: "tour:demo-purchases-viewer-open",
  /**
   * Companion to `demoPurchasesViewerOpen`. Dispatched by the
   * `purchases-back-to-real` step body when the user clicks "Back to my
   * page". The /purchases page closes the overlay; the tour advances to
   * the next phase via the same click handler that dispatches the event.
   */
  demoPurchasesViewerClose: "tour:demo-purchases-viewer-close",
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
 * Watch for the project route to mount. `ProjectRoute.tsx` dispatches
 * `tour:project-route-entered` on mount, so the §6.2 NAV sub-step
 * (`project-overview-nav`) can advance the moment the cursor's click on
 * the home-page project card lands on `/workbench/projects/<id>`. The
 * follow-up PROSE sub-step (`project-overview-prose`) then runs its
 * typing cursor script on the project page, with a fresh
 * `InProductWalkthroughOverlay` mount and a fresh cursor ref. This is
 * the same trigger-then-action split §6.1 used to dodge the
 * cursor-cannot-cross-navigation problem.
 *
 * A DOM-mount fallback watches for the Overview textarea anchor so a
 * future refactor that drops the explicit dispatch (e.g. moves the route
 * detail into a subtree that re-uses a parent layout) still trips the
 * advance.
 */
export function watchProjectRouteEntered(advance: () => void): () => void {
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
    window.addEventListener(TOUR_DOM_EVENTS.projectRouteEntered, handler);
    removeListener = () =>
      window.removeEventListener(
        TOUR_DOM_EVENTS.projectRouteEntered,
        handler,
      );
  }

  if (typeof document !== "undefined") {
    // DOM-mount fallback. If the Overview textarea is already on screen
    // (e.g. the tour entered this step after the user manually navigated
    // to the project page), fire immediately so we don't wait for a second
    // event.
    if (
      document.querySelector(
        "[data-tour-target=\"project-overview-textarea\"]",
      )
    ) {
      fireOnce();
    } else if (typeof MutationObserver !== "undefined") {
      mo = new MutationObserver(() => {
        if (
          document.querySelector(
            "[data-tour-target=\"project-overview-textarea\"]",
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
 * Watch for a new method. Same shape as `watchProjectCreated`:
 *   1. DOM event fast path via `tour:method-created` (dispatched by
 *      `CreateMethodModal.tsx` on save success).
 *   2. Polling baseline-grows watcher as a safety net.
 *
 * Both paths fan into the same `advance` callback, guarded so we only
 * fire once. The §6.4d methods-create cursor demo relies on the DOM
 * event path (the polling tick can be slower than the typed body the
 * user just watched, so the spotlight wouldn't release in time without
 * the event).
 */
export function watchMethodCreated(advance: () => void): () => void {
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
    window.addEventListener(TOUR_DOM_EVENTS.methodCreated, handler);
    removeListener = () =>
      window.removeEventListener(TOUR_DOM_EVENTS.methodCreated, handler);
  }

  // 2. Polling safety net.
  const stopPolling = watchCountIncrease(
    async () => {
      const methods = await methodsApi.list();
      return methods.length;
    },
    fireOnce,
  );

  return () => {
    removeListener?.();
    stopPolling();
  };
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
 * Watch for the New Method picker modal to mount. `CreateMethodModal`
 * dispatches `tour:methods-picker-opened` on mount, so the §6.4
 * `methods-open-picker` sub-step can advance the moment the picker is
 * visible. A DOM-mount fallback watches for the picker anchor so a
 * future refactor that drops the explicit dispatch still trips the
 * advance.
 *
 * Mirrors `watchHomeCreateModalOpened` shape since the use case is
 * identical: BeakerBot's cursor clicks the affordance that opens a
 * modal, and we want the controller to advance the instant the modal
 * is on screen.
 */
export function watchMethodsPickerOpened(
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
    window.addEventListener(TOUR_DOM_EVENTS.methodsPickerOpened, handler);
    removeListener = () =>
      window.removeEventListener(
        TOUR_DOM_EVENTS.methodsPickerOpened,
        handler,
      );
  }

  if (typeof document !== "undefined") {
    if (
      document.querySelector('[data-tour-target="methods-type-picker"]')
    ) {
      fireOnce();
    } else if (typeof MutationObserver !== "undefined") {
      mo = new MutationObserver(() => {
        if (
          document.querySelector(
            '[data-tour-target="methods-type-picker"]',
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
 * Watch for the §6.4 methods-category-demo step to complete. The methods
 * page dispatches `tour:methods-category-created` from its
 * handleCategoryCreated callback after the New Category modal saves.
 * No polling fallback: categories are local-state only.
 */
export function watchMethodsCategoryCreated(
  advance: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  let fired = false;
  const handler = () => {
    if (fired) return;
    fired = true;
    advance();
  };
  window.addEventListener(TOUR_DOM_EVENTS.methodsCategoryCreated, handler);
  return () => {
    window.removeEventListener(
      TOUR_DOM_EVENTS.methodsCategoryCreated,
      handler,
    );
  };
}

/**
 * Watch for the §6.4 user-action open-step to complete. methods/page.tsx
 * dispatches `tour:methods-category-modal-opened` when the user clicks
 * "+ New Category". DOM-mount fallback so the watcher also trips if the
 * modal is already on screen when the step mounts (eg. the user clicked
 * the button during the picker prompt before this step took over).
 */
export function watchMethodsCategoryModalOpened(
  advance: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    advance();
  };
  // Mount fallback: if the name input is already in the DOM, the modal
  // is already open and we advance immediately.
  if (
    document.querySelector(
      "[data-tour-target=\"methods-category-name-input\"]",
    )
  ) {
    fire();
    return () => {};
  }
  const handler = () => fire();
  window.addEventListener(TOUR_DOM_EVENTS.methodsCategoryModalOpened, handler);
  return () => {
    window.removeEventListener(
      TOUR_DOM_EVENTS.methodsCategoryModalOpened,
      handler,
    );
  };
}

/**
 * Watch for the §6.5 user-action open-step to complete.
 * WorkbenchExperimentsPanel.tsx dispatches
 * `tour:workbench-experiment-modal-opened` when the user clicks
 * "+ New Experiment". DOM-mount fallback so the watcher also trips if
 * the modal is already on screen when the step mounts (eg. the user
 * clicked the button during the prior methods-create step before this
 * step took over). Mirrors `watchMethodsCategoryModalOpened`.
 */
export function watchWorkbenchExperimentModalOpened(
  advance: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    advance();
  };
  // Mount fallback: if the name input is already in the DOM, the modal
  // is already open and we advance immediately.
  if (
    document.querySelector(
      "[data-tour-target=\"workbench-experiment-name-input\"]",
    )
  ) {
    fire();
    return () => {};
  }
  const handler = () => fire();
  window.addEventListener(
    TOUR_DOM_EVENTS.workbenchExperimentModalOpened,
    handler,
  );
  return () => {
    window.removeEventListener(
      TOUR_DOM_EVENTS.workbenchExperimentModalOpened,
      handler,
    );
  };
}

/**
 * Watch for the notifications popup to open. NotificationPopup.tsx
 * dispatches `tour:notifications-popup-opened` on mount so the §6.3
 * bell sub-step can advance the moment the inbox panel appears.
 *
 * DOM-mount fallback watches for the popup's silence-button anchor.
 */
export function watchNotificationsPopupOpened(
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
    window.addEventListener(TOUR_DOM_EVENTS.notificationsPopupOpened, handler);
    removeListener = () =>
      window.removeEventListener(
        TOUR_DOM_EVENTS.notificationsPopupOpened,
        handler,
      );
  }

  if (typeof document !== "undefined") {
    if (
      document.querySelector("[data-tour-target=\"notification-silence\"]")
    ) {
      fireOnce();
    } else if (typeof MutationObserver !== "undefined") {
      mo = new MutationObserver(() => {
        if (
          document.querySelector(
            "[data-tour-target=\"notification-silence\"]",
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
 * Watch for the row-level "Mark as read" button to fire. The popup
 * dispatches `tour:notification-silenced` from inside `handleMarkRead`.
 */
export function watchNotificationSilenced(
  advance: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  let fired = false;
  const handler = () => {
    if (fired) return;
    fired = true;
    advance();
  };
  window.addEventListener(TOUR_DOM_EVENTS.notificationSilenced, handler);
  return () => {
    window.removeEventListener(TOUR_DOM_EVENTS.notificationSilenced, handler);
  };
}

/**
 * Watch for the row-level "Dismiss" (X) button to fire. The popup
 * dispatches `tour:notification-deleted` from inside `handleDismiss`.
 */
export function watchNotificationDeleted(
  advance: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  let fired = false;
  const handler = () => {
    if (fired) return;
    fired = true;
    advance();
  };
  window.addEventListener(TOUR_DOM_EVENTS.notificationDeleted, handler);
  return () => {
    window.removeEventListener(TOUR_DOM_EVENTS.notificationDeleted, handler);
  };
}

/**
 * Watch for the experiment detail popup to mount. `TaskDetailPopup.tsx`
 * dispatches `tour:experiment-popup-opened` on mount when the task is an
 * experiment, so the §6.6 `experiment-attach-method-open` sub-step can
 * advance the moment the popup is on screen. Follow-up sub-steps then
 * run their cursor scripts against the now-mounted popup DOM with a
 * fresh overlay mount + cursor ref. A single cursor script can't span
 * the popup-mount boundary (the targets don't exist until the popup
 * renders, and the cursor script's `safeClickAction` timeouts before the
 * popup paints in some cases).
 *
 * DOM-mount fallback watches for the popup's methods-tab anchor so a
 * future refactor that drops the explicit dispatch still trips the
 * advance.
 */
export function watchExperimentPopupOpened(
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
    window.addEventListener(TOUR_DOM_EVENTS.experimentPopupOpened, handler);
    removeListener = () =>
      window.removeEventListener(
        TOUR_DOM_EVENTS.experimentPopupOpened,
        handler,
      );
  }

  if (typeof document !== "undefined") {
    // DOM-mount fallback. The popup's Methods tab carries
    // `data-tour-target="experiment-methods-tab"` (wired by sub-bot
    // a97cdccfcd914de7b's product-surface attr work). If it's already
    // rendered (e.g. tour resumed after the user opened the popup
    // manually), fire immediately so we don't wait for a second event.
    if (
      document.querySelector(
        "[data-tour-target=\"experiment-methods-tab\"]",
      )
    ) {
      fireOnce();
    } else if (typeof MutationObserver !== "undefined") {
      mo = new MutationObserver(() => {
        if (
          document.querySelector(
            "[data-tour-target=\"experiment-methods-tab\"]",
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
 * Watch for the experiment popup's Methods tab to become active.
 * `TaskDetailPopup.tsx` dispatches `tour:experiment-methods-tab-active`
 * from `selectTab` when the new tab is `"method"`. The §6.6
 * `experiment-attach-method-tab` sub-step advances on this so the
 * follow-up `experiment-attach-method-attach` sub-step's cursor script
 * runs once the Methods tab body has rendered.
 *
 * DOM-mount fallback watches for the Attach Method anchor so a future
 * refactor that drops the explicit dispatch still trips the advance.
 */
export function watchExperimentMethodsTabActive(
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
    window.addEventListener(
      TOUR_DOM_EVENTS.experimentMethodsTabActive,
      handler,
    );
    removeListener = () =>
      window.removeEventListener(
        TOUR_DOM_EVENTS.experimentMethodsTabActive,
        handler,
      );
  }

  if (typeof document !== "undefined") {
    if (
      document.querySelector(
        "[data-tour-target=\"experiment-attach-method\"]",
      )
    ) {
      fireOnce();
    } else if (typeof MutationObserver !== "undefined") {
      mo = new MutationObserver(() => {
        if (
          document.querySelector(
            "[data-tour-target=\"experiment-attach-method\"]",
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
