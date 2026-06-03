/**
 * Onboarding v4 universal-walkthrough `onEnter` side-effects.
 *
 * Two §6.10 step bodies promise BeakerBot-led demo spawns in their
 * speech ("I made three throwaway tasks", "here's my selfie") but the
 * spawn helpers themselves need the active project / experiment id,
 * which the step body can't resolve in isolation. The registry binding
 * wires those spawns via the step's `onEnter` slot using the helpers
 * here.
 *
 * Why a separate file:
 *   - `step-registry.ts` stays a flat id-to-body map plus a small
 *     conditional patch list; adding two ~30-line spawn closures there
 *     would balloon it.
 *   - Both helpers re-derive the "active project / experiment" via
 *     `projectsApi.list()` / `tasksApi.listByProject()` because the
 *     TourController state doesn't track `activeProjectId` yet (per
 *     the walkthrough docstrings, the active project is implicit:
 *     §6.1 created exactly one project, so "most recently created" is
 *     unambiguous during the walkthrough).
 *   - Each spawn is IDEMPOTENT: a refresh between steps re-fires
 *     onEnter, and we'd double up demo tasks / images otherwise.
 *
 * The TourController catches throws from `onEnter` and logs them at
 * warn level (see TourController.tsx ~line 640). Helpers below also
 * swallow + log internally so a partial failure (e.g. fileService
 * mocked out under jsdom) never wedges the step transition. Worst
 * case: the demo data doesn't appear but the tour keeps moving.
 *
 * HR-dispatched: v4 onEnter wiring sub-bot 2026-05-21.
 */
import {
  dependenciesApi,
  fetchAllTasks,
  goalsApi,
  projectsApi,
  tasksApi,
} from "@/lib/local-api";
import { patchOnboarding } from "@/lib/onboarding/sidecar";
import { appQueryClient } from "@/lib/query-client";
import type { Project, Task } from "@/lib/types";
import {
  DEP_CHAIN_NAMES,
  spawnDemoDependencyTasks,
} from "../GanttDependenciesStep";
import { appendArtifact } from "./artifacts";
import { tourClickWithLockBypass, waitForElement } from "./cursor-script";
import { ensureFirstExperimentExists } from "./ensure-helpers";
import { TOUR_TARGETS, targetSelector } from "./targets";
import type { TourTargetName } from "./targets";

/**
 * Close any open task-detail popup before the goals step's speech runs.
 *
 * gantt-share fix manager (BUG 2): the prior `gantt-share-user-sees-edit`
 * step leaves the user with Fake A's TaskDetailPopup open. The goals
 * step's authored body (GanttGoalsStep.tsx) declared an `onEnter` that
 * closed it, but the registry binding overrides that `onEnter` with
 * `onEnterGanttGoalsOverview` (the demo-goal spawn), so the close never
 * fired and the goals speech showed on top of the stale popup. Folding
 * the close here keeps both behaviors (close + spawn) on the single
 * onEnter the registry actually wires up, so it cannot regress again.
 *
 * Idempotent / safe when no popup is open: the query returns null and we
 * no-op. Routed through `tourClickWithLockBypass` so the
 * InputLockOverlay's capture-phase blocker (which may be armed for the
 * next step's lock by the time onEnter fires) does not swallow the X.
 *
 * gantt-share-robust manager (BUG A): also reused by the §6.8 share-back
 * open beat (`gantt-share-user-shares-back`) to close any stale popup
 * before the beat arms, so a leftover popup can't fire
 * `tour:experiment-popup-opened` and auto-advance the beat before the
 * user clicks Fake A.
 */
export function closeAnyOpenTaskPopup(): void {
  if (typeof document === "undefined") return;
  const closeBtn = document.querySelector<HTMLElement>(
    '[data-tour-target="task-popup-close"]',
  );
  if (closeBtn) tourClickWithLockBypass(closeBtn);
}

/**
 * Switch the Workbench page to a specific tab by DOM-clicking the tab
 * button that carries the given `data-tour-target` (e.g.
 * `workbench-experiments-tab`, `workbench-notes-tab`,
 * `workbench-lists-tab`).
 *
 * Why this exists (tour-workbench-tab-fix bot 2026-06-03): the de-bloat
 * pass made "Projects" the DEFAULT Workbench tab. Several walkthrough
 * beats spotlight elements that only render on a DIFFERENT sub-tab — the
 * "+ New Experiment" button lives on the Experiments tab, the +New Note
 * button on the Notes tab, etc. On the default Projects tab those targets
 * are absent, so the spotlight resolves to nothing and the user is stuck.
 * Firing this in the beat's `onEnter` switches to the required tab BEFORE
 * the spotlight's MutationObserver looks for the target, so the element
 * mounts and the spotlight lands.
 *
 * Robustness: guarded by `typeof window`, wrapped in try/catch, and a
 * no-op when the tab button is absent (wrong page / already-correct tab /
 * jsdom test harness without the workbench mounted). Clicking an
 * already-active tab is a harmless no-op on the page side. We dispatch a
 * real `click` rather than routing through the lock-bypass helper because
 * tab switching is a plain button onClick with no capture-phase blocker
 * to defeat, and these onEnter beats run on user-action steps that do not
 * arm the page lock.
 */
export function switchWorkbenchTab(tabTarget: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  try {
    const tabBtn = document.querySelector<HTMLElement>(
      `[data-tour-target="${tabTarget}"]`,
    );
    if (tabBtn) tabBtn.click();
  } catch (err) {
    console.warn(
      `[onboarding-v4] switchWorkbenchTab("${tabTarget}") failed`,
      err,
    );
  }
}

/**
 * Close the Notifications dropdown if it is open.
 *
 * Why (tour-workbench-tab-fix bot 2026-06-03): the §6.3 `notifications-bell`
 * beat has the user click the bell, which opens NotificationPopup; the
 * silence + delete beats operate on rows inside it, so it must stay open
 * through `notifications-delete`. But once that arc ends the dropdown
 * lingers and overlaps the following `workbench-create-experiment-open`
 * spotlight. NotificationPopup closes itself on a `mousedown` whose target
 * is OUTSIDE its container (the standard click-outside pattern, see
 * NotificationPopup.tsx). We reproduce exactly that real close path by
 * dispatching a synthetic `mousedown` on `document.body` (always outside
 * the absolutely-positioned popup), so `handleClickOutside` -> `onClose`
 * runs and React unmounts the popup. We touch no app-component state
 * directly.
 *
 * Robustness: guarded + try/catch; harmless no-op when the popup is closed
 * (the click-outside listener is only registered while open) or when the
 * bell isn't mounted (other pages, jsdom harness).
 */
export function closeNotificationsPopup(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  try {
    // Only act when the popup is actually open: its container is rendered
    // as a sibling of the bell button and the silence/delete row targets
    // only exist while it is open. Probing for the bell wrapper keeps this
    // a no-op outside the AppShell.
    const bell = document.querySelector('[data-tour-target="notifications-bell"]');
    if (!bell) return;
    const evt = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      view: window,
    });
    document.body.dispatchEvent(evt);
  } catch (err) {
    console.warn("[onboarding-v4] closeNotificationsPopup failed", err);
  }
}

/**
 * Selector that matches ANY of the experiment TaskDetailPopup's
 * tab-strip anchors. The experiment popup always renders this tab strip
 * (TaskDetailPopup.tsx ~line 1520: `experiment-tab-container` wraps the
 * per-tab buttons, each stamped `experiment-notes-tab` /
 * `experiment-methods-tab` / `experiment-results-tab`). None of these
 * anchors exist anywhere else in the app, and the popup is the ONLY
 * surface that mounts them, so the presence of any one is a reliable,
 * stable "the experiment popup is open" marker. We deliberately do NOT
 * add a dedicated `data-tour-popup` attribute to the popup component —
 * these existing anchors already give us a non-invasive open-marker.
 */
const EXPERIMENT_POPUP_OPEN_SELECTOR = [
  targetSelector(TOUR_TARGETS.experimentTabContainer),
  targetSelector(TOUR_TARGETS.experimentNotesTab),
  targetSelector(TOUR_TARGETS.experimentMethodsTab),
  targetSelector(TOUR_TARGETS.experimentResultsTab),
].join(", ");

/** True when the experiment TaskDetailPopup is currently mounted. */
function isExperimentPopupOpen(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector(EXPERIMENT_POPUP_OPEN_SELECTOR) !== null;
}

/**
 * Reopen the experiment TaskDetailPopup if a mid-tour refresh closed it.
 *
 * tour-popup-resilience bot 2026-06-03: the §6.6 `experiment-attach-
 * method-open` step is the ONE step that mounts the experiment popup;
 * every §6.6/§6.7/§6.7d step after it spotlights / clicks elements that
 * live INSIDE that popup (the Methods tab, the Notes/Results tabs, the
 * inline editor surface, the focus-mode toggles, the variation-notes
 * field). The popup is portal state, not a route, so a browser refresh
 * mid-sequence closes it. The tour then resumes on a popup-dependent
 * step whose target no longer exists and the spotlight/cursor fire into
 * the void. Grant's fix: REOPEN the experiment instead of failing.
 *
 * This helper is the shared `onEnter` side-effect wired onto every
 * popup-dependent step (NOT onto `experiment-attach-method-open`, which
 * already opens it). It:
 *   1. No-ops when the popup is already open (the canonical, non-refresh
 *      path: the prior step's cursor left the popup mounted).
 *   2. When closed, REUSES the documented open path
 *      (`experiment-attach-method-open`): switch to the Experiments
 *      sub-tab so the row renders, ensure a first experiment exists
 *      (idempotent — canonical flow no-ops), then DOM-click the
 *      experiment row to mount the popup, and await the tab strip
 *      appearing so the step's spotlight/cursor resolve against a
 *      present DOM.
 *
 * Idempotent + best-effort: guarded by `typeof window`, wrapped in
 * try/catch, tolerant of the row not being present yet (waitForElement
 * times out → we return without throwing). A failure here degrades to
 * the pre-existing "spotlight finds nothing" behavior rather than
 * wedging the tour; the TourController also catches onEnter throws.
 *
 * Note (focus mode): reopening restores the popup, NOT the transient
 * focus-mode overlay that `hybrid-focus-enter` toggles. The two
 * focus-mode beats' cursor clicks gracefully no-op when the focus
 * control is absent (safeClickAction → null → compactScript drops it),
 * and their manual "Got it, next" still advances, so popup-level
 * resilience is the correct scope.
 *
 * Optional `tabTarget`: the experiment popup mounts on its Details tab by
 * default (TaskDetailPopup.tsx ~line 145). Steps whose spotlight lives on
 * a DIFFERENT tab (e.g. `inline-editor` spotlights the Notes-tab editor
 * surface; the §6.7d notes beat spotlights the Methods tab) pass the
 * tab's `data-tour-target` so the right surface is showing after a
 * reopen. We only switch the tab when we ACTUALLY reopened — if the popup
 * was already open we leave the user's current tab alone so the canonical
 * (non-refresh) path isn't disrupted. Steps that drive the tab switch via
 * their own cursor script (e.g. `hybrid-notes-vs-results` clicks Notes)
 * don't need to pass this.
 */
export async function ensureExperimentPopupOpen(
  tabTarget?: TourTargetName,
): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  try {
    if (isExperimentPopupOpen()) return;
    // Closed (refresh mid-sequence). Reopen via the documented open path.
    switchWorkbenchTab(TOUR_TARGETS.workbenchExperimentsTab);
    // Make sure there's a row to click. Idempotent: canonical flow's §6.5
    // experiment is reused; a seed-jump past §6.5 mints a placeholder.
    await ensureFirstExperimentExists();
    const row = await waitForElement(
      "[data-tour-target^='workbench-experiment-row-']",
      3000,
    );
    if (!(row instanceof HTMLElement)) return;
    // Mounting the popup also dispatches `tour:experiment-popup-opened`,
    // matching the canonical open path exactly.
    row.click();
    // Wait for the popup's tab strip so the step's spotlight + cursor
    // script (which run after onEnter) resolve against a present DOM.
    await waitForElement(EXPERIMENT_POPUP_OPEN_SELECTOR, 3000);
    // The popup opens on Details by default. If this step's spotlight
    // lives on another tab, switch to it now (only on the reopen path).
    if (tabTarget) {
      const tab = await waitForElement(targetSelector(tabTarget), 3000);
      if (tab instanceof HTMLElement) tab.click();
    }
  } catch (err) {
    console.warn("[onboarding-v4] ensureExperimentPopupOpen failed", err);
  }
}

/**
 * Compose a popup-reopen guard ahead of an existing step `onEnter`.
 *
 * tour-popup-resilience bot 2026-06-03: several popup-dependent steps
 * already declare an `onEnter` (e.g. the attach / notes beats run the
 * `ensureFirst*` artifact guards). This wrapper runs
 * `ensureExperimentPopupOpen()` FIRST (so the popup is back before the
 * existing logic resolves popup-internal artifacts / anchors), then the
 * step's original `onEnter`. Both are best-effort: a reopen failure
 * never blocks the original hook, and vice versa.
 */
export function withExperimentPopupOpen(
  inner?: (ctx: { username: string | null }) => void | Promise<void>,
): (ctx: { username: string | null }) => Promise<void> {
  return async (ctx) => {
    await ensureExperimentPopupOpen();
    if (inner) await inner(ctx);
  };
}

// ─────────────────────────────────────────────────────────────────────
// tour-modal-resilience bot 2026-06-03: the experiment TaskDetailPopup
// resilience above (ensureExperimentPopupOpen) hardened ONE modal against
// the mid-tour-refresh soft-block (a refresh closes the portal-rendered
// modal, the next step spotlights an element inside it, the spotlight
// fires into nothing). Grant approved a single comprehensive pass to do
// the SAME for every other reopenable walkthrough modal. Each helper
// below mirrors ensureExperimentPopupOpen's shape exactly:
//   - typeof-window guard + try/catch (best-effort; never wedge the tour)
//   - detect-open by querying a stable DOM anchor the modal stamps
//   - when closed, REOPEN by reusing the same trigger the tour's "open"
//     bridge step uses (navigate to the surface, click the open trigger,
//     await the anchor)
//   - a `withXModalOpen(inner)` composer mirroring withExperimentPopupOpen
//     so dependent steps that already declare an onEnter compose cleanly.
// ─────────────────────────────────────────────────────────────────────

/**
 * Detect-open anchor for the §6.4 New Method modal (CreateMethodModal).
 * The modal's outer card stamps `methods-create-form`
 * (CreateMethodModal.tsx ~line 767) and that anchor exists nowhere else.
 * It is present the WHOLE time the modal is open — from the type-picker
 * stage through the per-type form — so it is a reliable open-marker for
 * both `methods-open-picker` (picker) and `methods-create` (markdown
 * form) dependents.
 */
const NEW_METHOD_MODAL_OPEN_SELECTOR = targetSelector(
  TOUR_TARGETS.methodsCreateForm,
);

/** True when the New Method modal (CreateMethodModal) is mounted. */
function isNewMethodModalOpen(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector(NEW_METHOD_MODAL_OPEN_SELECTOR) !== null;
}

/**
 * Reopen the §6.4 New Method modal if a mid-tour refresh closed it.
 *
 * THE MODAL GRANT HIT (2026-06-03 live walk): `methods-open-picker`
 * (MethodsOpenPickerStep) is the bridge step that opens the modal by
 * clicking `methods-new-method-button`. Every dependent beat after it
 * lives INSIDE the modal: `methods-type-tour` / `methods-pcr-*` /
 * `methods-lc-demo` exercise the type-picker + per-type builders, and
 * `methods-create` (MethodsCreateStep) spotlights `methods-create-form`
 * and drives the whole markdown form. The modal is portal state, not a
 * route, so a refresh closes it and the dependent step's spotlight /
 * cursor fire into nothing.
 *
 * Reopen path mirrors the bridge step exactly: ensure we are on
 * `/methods` is implicit (the dependent steps all declare
 * `expectedRoute: "/methods"`, so the TourController has already
 * navigated there before onEnter runs), then DOM-click the
 * `methods-new-method-button` trigger (same one `methods-open-picker`'s
 * cursor clicks) and await `methods-create-form`.
 *
 * No-op when the modal is already open (canonical, non-refresh path).
 * Best-effort: guarded + try/catch + tolerant of a missing trigger
 * (waitForElement times out -> return quietly). A failure degrades to
 * the pre-existing "spotlight finds nothing" behavior; it never throws
 * into the TourController (which also catches onEnter throws).
 */
export async function ensureNewMethodModalOpen(): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  try {
    if (isNewMethodModalOpen()) return;
    // Closed (refresh mid-sequence). Reopen via the documented bridge
    // path: click the "+ New Method" button the methods-open-picker step
    // uses. The button only renders on /methods; the dependent steps'
    // expectedRoute has already settled the route before onEnter runs.
    const trigger = await waitForElement(
      targetSelector(TOUR_TARGETS.methodsNewMethodButton),
      3000,
    );
    if (!(trigger instanceof HTMLElement)) return;
    trigger.click();
    // Await the modal card so the dependent step's spotlight + cursor
    // (which run after onEnter) resolve against a present DOM.
    await waitForElement(NEW_METHOD_MODAL_OPEN_SELECTOR, 3000);
  } catch (err) {
    console.warn("[onboarding-v4] ensureNewMethodModalOpen failed", err);
  }
}

/**
 * Compose the New Method modal reopen-guard ahead of an existing step
 * `onEnter`. Mirrors withExperimentPopupOpen: reopen FIRST (so the modal
 * is back before the original hook resolves modal-internal anchors),
 * then run the step's original onEnter. Both best-effort.
 */
export function withNewMethodModalOpen(
  inner?: (ctx: { username: string | null }) => void | Promise<void>,
): (ctx: { username: string | null }) => Promise<void> {
  return async (ctx) => {
    await ensureNewMethodModalOpen();
    if (inner) await inner(ctx);
  };
}

/**
 * Detect-open anchor for the §6.4 New Category modal (the inline
 * `CategoryModal` in app/methods/page.tsx). The modal stamps its name
 * input `methods-category-name-input` (page.tsx ~line 1196); that anchor
 * exists nowhere else and only while the modal is open, so it is a
 * reliable open-marker.
 */
const CATEGORY_MODAL_OPEN_SELECTOR = targetSelector(
  TOUR_TARGETS.methodsCategoryNameInput,
);

/** True when the New Category modal is mounted. */
function isCategoryModalOpen(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector(CATEGORY_MODAL_OPEN_SELECTOR) !== null;
}

/**
 * Reopen the §6.4 New Category modal if a mid-tour refresh closed it.
 *
 * `methods-category-open` (MethodsCategoryOpenStep) is the bridge step:
 * the user clicks `methods-add-category` ("+ New Category"), which sets
 * `creatingCategory` and dispatches `tour:methods-category-modal-opened`.
 * The dependent beats `methods-category` (MethodsCategoryStep: cursor
 * types the picked label + clicks Create Empty, spotlights
 * `methods-category-name-input`) and `methods-category-prompt`
 * (MethodsCategoryPromptStep) assume the modal is up. A refresh closes
 * the modal (local React state, not a route).
 *
 * Reopen path mirrors the bridge: the dependent steps declare
 * `expectedRoute: "/methods"` (so the route is already settled), then
 * DOM-click `methods-add-category` (the same trigger the bridge step's
 * spotlight points at) and await the name input. Clicking the trigger
 * also re-dispatches `tour:methods-category-modal-opened`, matching the
 * canonical open path exactly.
 *
 * No-op when already open. Best-effort guarded / try-catch / tolerant
 * of a missing trigger.
 */
export async function ensureCategoryModalOpen(): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  try {
    if (isCategoryModalOpen()) return;
    const trigger = await waitForElement(
      targetSelector(TOUR_TARGETS.methodsAddCategory),
      3000,
    );
    if (!(trigger instanceof HTMLElement)) return;
    trigger.click();
    await waitForElement(CATEGORY_MODAL_OPEN_SELECTOR, 3000);
  } catch (err) {
    console.warn("[onboarding-v4] ensureCategoryModalOpen failed", err);
  }
}

/**
 * Compose the New Category modal reopen-guard ahead of an existing step
 * `onEnter`. Mirrors withExperimentPopupOpen.
 */
export function withCategoryModalOpen(
  inner?: (ctx: { username: string | null }) => void | Promise<void>,
): (ctx: { username: string | null }) => Promise<void> {
  return async (ctx) => {
    await ensureCategoryModalOpen();
    if (inner) await inner(ctx);
  };
}

/**
 * Detect-open anchor for the §6.5 Create Experiment modal (TaskModal).
 * The modal's name input stamps `workbench-experiment-name-input`
 * (TaskModal.tsx ~line 681); the input exists only while the create-task
 * modal is open, so it is a reliable open-marker for the
 * name / project / submit dependent beats.
 */
const CREATE_EXPERIMENT_MODAL_OPEN_SELECTOR = targetSelector(
  TOUR_TARGETS.workbenchExperimentNameInput,
);

/** True when the Create Experiment modal (TaskModal) is mounted. */
function isCreateExperimentModalOpen(): boolean {
  if (typeof document === "undefined") return false;
  return (
    document.querySelector(CREATE_EXPERIMENT_MODAL_OPEN_SELECTOR) !== null
  );
}

/**
 * True when the user already has an experiment task on disk. Used to
 * SUPPRESS a confusing reopen on the §6.5 create-experiment beats: if a
 * mid-tour refresh happened AFTER the experiment was created, reopening
 * a fresh empty modal would dump the user back at a blank form they
 * already finished. Scans ALL of the user's own tasks (not just the
 * active project) because the §6.5 user-action flow lets the experiment
 * land in a project, Miscellaneous, OR Standalone. Best-effort: a list
 * failure returns false so the caller falls back to the reopen branch
 * (better a spurious reopen than a wedged dead step on the canonical
 * pre-create path).
 */
async function anyExperimentExists(): Promise<boolean> {
  try {
    const all = await fetchAllTasks();
    return all.some(
      (t) => t.task_type === "experiment" && !t.is_shared_with_me,
    );
  } catch (err) {
    console.warn("[onboarding-v4] anyExperimentExists probe failed", err);
    return false;
  }
}

/**
 * Resolve the id of the user's existing experiment, scanning ALL of the
 * user's own tasks (project-agnostic, like {@link anyExperimentExists}),
 * not just the active project. Returns the most-recently-created
 * (max id) experiment's id, or `null` when none exists or the list
 * fails. Project-agnostic because the §6.5 user-action flow lets the
 * experiment land in a project, Miscellaneous, OR Standalone.
 *
 * Shares the same filter as `anyExperimentExists` (own, type
 * "experiment") so the two agree on existence; this one additionally
 * surfaces the id so a caller can re-dispatch `tour:experiment-created`
 * with the real id (the refresh-after-create gate-rehydration path).
 */
async function resolveExistingExperimentId(): Promise<number | null> {
  try {
    const all = await fetchAllTasks();
    const experiments = all.filter(
      (t) => t.task_type === "experiment" && !t.is_shared_with_me,
    );
    if (experiments.length === 0) return null;
    const sorted = [...experiments].sort((a, b) => b.id - a.id);
    return sorted[0]?.id ?? null;
  } catch (err) {
    console.warn("[onboarding-v4] resolveExistingExperimentId probe failed", err);
    return null;
  }
}

/**
 * Re-hydrate the §6.5d `workbench-create-experiment-submit` gate after a
 * refresh that happened AFTER the experiment was already created.
 *
 * The submit beat's "Got it, next" manual-advance is gated on
 * `disabledUntilEvent: tour:experiment-created`. That event fires once,
 * from `tasksApi.create` in local-api, at the moment the experiment
 * lands on disk. If the user refreshes ON this beat AFTER creating the
 * experiment, the event already fired pre-reload, so on reload the gate
 * never satisfies and the button stays permanently disabled = soft
 * block.
 *
 * Fix: on step enter, if an experiment already exists on disk, re-DISPATCH
 * `tour:experiment-created` with the existing experiment's real id. This
 * reuses the existing plumbing end-to-end:
 *   - the controller's overlay gate listener flips `eventFired` -> the
 *     button enables (the soft-block is cleared),
 *   - the submit step's own artifact-capture listener records the same
 *     id into pendingArtifactStore. Because `appendArtifact` dedupes on
 *     `(type, id)`, recording the SAME id never double-counts an artifact
 *     even if the live event had also fired this run (it won't, on the
 *     refresh path),
 *   - the controller's detach-recovery watcher suppresses the false
 *     "Looks like that closed" hint.
 *
 * CANONICAL-PATH SAFETY: on a fresh run where no experiment exists yet,
 * `resolveExistingExperimentId()` returns null and we DO NOT dispatch, so
 * the button stays disabled until the user genuinely clicks Create
 * Experiment and `tasksApi.create` fires the real event. This only
 * un-gates when an experiment genuinely already exists on disk.
 *
 * Caller must invoke this AFTER registering its own listeners (the await
 * inside guarantees the synchronous render + effects have flushed, so the
 * controller's gate listener is already subscribed when we dispatch).
 * Best-effort: SSR-safe + swallow/log internally so it never wedges the
 * step.
 */
export async function rehydrateExperimentSubmitGate(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const id = await resolveExistingExperimentId();
    if (id === null) return;
    window.dispatchEvent(
      new CustomEvent("tour:experiment-created", { detail: { id } }),
    );
  } catch (err) {
    console.warn("[onboarding-v4] rehydrateExperimentSubmitGate failed", err);
  }
}

/**
 * Reopen the §6.5 Create Experiment modal (TaskModal) if a mid-tour
 * refresh closed it.
 *
 * `workbench-create-experiment-open` (WorkbenchCreateExperimentOpenStep
 * beat 1) is the bridge step: the user clicks `workbench-new-experiment`
 * ("+ New Experiment") on the Experiments sub-tab, which opens TaskModal
 * with the task type restricted to "experiment". The dependent beats
 * `workbench-create-experiment-name` / `-project` spotlight inputs INSIDE
 * that modal. The modal is portal state, not a route, so a refresh
 * closes it.
 *
 * CAUTION (per the brief): these are USER-ACTION beats and the §6.5d
 * `-submit` beat is gated on `tour:experiment-created`. Reopening a
 * FRESH modal after the experiment was already created would be
 * confusing (blank form the user already submitted). So this helper
 * reopens ONLY when the modal is closed AND no experiment exists yet.
 * When an experiment already exists, we no-op: the user is past the
 * create and the reopen would be noise. Reopening a fresh modal does
 * lose any half-typed name on the pre-create path, but that is strictly
 * better than a dead spotlight (the user just retypes a name, which is
 * exactly what the name beat asks for).
 *
 * Reopen path mirrors the bridge: switch to the Experiments sub-tab
 * (the "+ New Experiment" button only renders there — see
 * WorkbenchCreateExperimentOpenStep's own onEnter), DOM-click
 * `workbench-new-experiment`, await the name input. The dependent beats
 * inherit `/workbench` so the route is already settled.
 *
 * No-op when already open. Best-effort guarded / try-catch / tolerant of
 * a missing trigger.
 */
export async function ensureCreateExperimentModalOpen(): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  try {
    if (isCreateExperimentModalOpen()) return;
    // Suppress the reopen once the experiment is created: the user is
    // past the form and a fresh blank modal would only confuse.
    if (await anyExperimentExists()) return;
    // Closed AND no experiment yet (refresh on the pre-create beats).
    // Reopen via the bridge path: the + New Experiment button only
    // renders on the Experiments sub-tab.
    switchWorkbenchTab(TOUR_TARGETS.workbenchExperimentsTab);
    const trigger = await waitForElement(
      targetSelector(TOUR_TARGETS.workbenchNewExperiment),
      3000,
    );
    if (!(trigger instanceof HTMLElement)) return;
    trigger.click();
    await waitForElement(CREATE_EXPERIMENT_MODAL_OPEN_SELECTOR, 3000);
  } catch (err) {
    console.warn("[onboarding-v4] ensureCreateExperimentModalOpen failed", err);
  }
}

/**
 * Compose the Create Experiment modal reopen-guard ahead of an existing
 * step `onEnter`. Mirrors withExperimentPopupOpen.
 */
export function withCreateExperimentModalOpen(
  inner?: (ctx: { username: string | null }) => void | Promise<void>,
): (ctx: { username: string | null }) => Promise<void> {
  return async (ctx) => {
    await ensureCreateExperimentModalOpen();
    if (inner) await inner(ctx);
  };
}

// ─────────────────────────────────────────────────────────────────────
// gantt-share-resilience bot 2026-06-03: §6.8 lab-mode share cluster.
// The mid-cluster surfaces are a Gantt TaskDetailPopup (opened from a
// Gantt bar) and the ShareDialog opened from inside that popup. Both are
// portal / React state, not routes, so a mid-cluster refresh closes them
// and the next step's spotlight fires into nothing. These helpers mirror
// ensureExperimentPopupOpen's shape exactly:
//   - typeof-window guard + try/catch (best-effort; never wedge the tour)
//   - detect-open by querying a stable DOM anchor the surface stamps
//   - when closed, REOPEN by reusing the same trigger the cluster's "open"
//     step uses (click the Gantt bar; click the popup's Share button)
//   - a `withXOpen(inner)` composer mirroring withExperimentPopupOpen so
//     dependent steps that already declare an onEnter compose cleanly.
// The cluster's open trigger is a Gantt bar's React onClick (GanttChart
// lab-mode → onTaskClickLab → mounts TaskDetailPopup). A synthetic
// `.click()` on the bar element fires that same onClick.
// ─────────────────────────────────────────────────────────────────────

/**
 * Detect-open anchor for the §6.8 Gantt TaskDetailPopup. The popup
 * header always renders its close button (`task-popup-close`,
 * TaskDetailPopup.tsx ~line 1449) for every task — owned, shared,
 * experiment, or list — so it is the one anchor reliably present the
 * whole time ANY task popup is open. We deliberately do NOT key off the
 * share button (`task-popup-share-button`), which only renders for owned,
 * non-shared tasks: the §6.8 explore beat opens the SHARED-to-me coffee
 * experiment, whose popup has no share button.
 */
const GANTT_SHARE_POPUP_OPEN_SELECTOR = targetSelector(
  TOUR_TARGETS.taskPopupClose,
);

/** True when a Gantt TaskDetailPopup is currently mounted. */
function isGanttSharePopupOpen(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector(GANTT_SHARE_POPUP_OPEN_SELECTOR) !== null;
}

/**
 * Reopen a §6.8 Gantt TaskDetailPopup if a mid-cluster refresh closed it.
 *
 * The cluster opens these popups by clicking a Gantt bar:
 *   - `gantt-share-user-explores` (beat 4) reads on the SHARED coffee
 *     experiment's popup, opened by `gantt-share-beakerbot-shares`'s
 *     cursor click on `gantt-bar-shared-experiment`.
 *   - `gantt-share-user-clicks-share` (5b) spotlights the Share button in
 *     FAKE A's popup, opened when the user clicks `gantt-bar-fake-a` in 5a.
 *
 * A refresh on 4 / 5b lands the tour on a popup-dependent step with the
 * popup closed. This helper reopens it by DOM-clicking the bar that the
 * cluster's open step uses (`barTarget`), which fires the bar's real
 * React onClick → `onTaskClickLab` → TaskDetailPopup mounts. The caller
 * is responsible for first re-running the idempotent spawn/share helpers
 * so the bar actually exists (the beats already do this in their onEnter).
 *
 * No-op when a popup is already open (canonical, non-refresh path: the
 * prior beat's click left it mounted). Best-effort: guarded + try/catch +
 * tolerant of a missing bar (waitForElement times out → return quietly).
 * A failure degrades to the pre-existing "spotlight finds nothing"
 * behavior rather than wedging the tour.
 *
 * @param barTarget the Gantt bar's `data-tour-target` (e.g.
 *   `gantt-bar-fake-a` or `gantt-bar-shared-experiment`).
 */
export async function ensureGanttSharePopupOpen(
  barTarget: TourTargetName,
): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  try {
    if (isGanttSharePopupOpen()) return;
    // Closed (refresh mid-cluster). Reopen by clicking the same Gantt bar
    // the cluster's open step clicks. The bars only render on /gantt; the
    // dependent beats declare `expectedRoute: "/gantt"` so the route is
    // already settled before onEnter runs.
    const bar = await waitForElement(targetSelector(barTarget), 3000);
    if (!(bar instanceof HTMLElement)) return;
    // The bar's onClick is a plain React handler with no capture-phase
    // blocker, but these are USER_ACTION beats whose page lock may be
    // arming; route through the lock-bypass click so the InputLockOverlay
    // doesn't swallow the synthetic click.
    tourClickWithLockBypass(bar);
    // Await the popup header's close button so the step's spotlight (which
    // runs after onEnter) resolves against a present DOM.
    await waitForElement(GANTT_SHARE_POPUP_OPEN_SELECTOR, 3000);
  } catch (err) {
    console.warn("[onboarding-v4] ensureGanttSharePopupOpen failed", err);
  }
}

/**
 * Detect-open anchor for the §6.8 ShareDialog. The dialog stamps
 * `share-dialog` on its root (ShareDialog.tsx) and that anchor exists
 * nowhere else, present the whole time the dialog is open.
 */
const SHARE_DIALOG_OPEN_SELECTOR = targetSelector(TOUR_TARGETS.shareDialog);

/** True when the §6.8 ShareDialog is currently mounted. */
function isShareDialogOpen(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector(SHARE_DIALOG_OPEN_SELECTOR) !== null;
}

/**
 * Reopen the §6.8 ShareDialog (over FAKE A's popup) if a mid-cluster
 * refresh closed it.
 *
 * The dialog is opened by `gantt-share-user-clicks-share` (5b): the user
 * clicks the Share button in Fake A's popup, which sets `showSharePopup`
 * and mounts ShareDialog. The dependent beats `gantt-share-user-fills-
 * dialog` (5c) and `gantt-share-user-saves-dialog` (5d) spotlight the
 * picker / Add / Save affordances INSIDE the dialog. A refresh on 5c / 5d
 * closes both the dialog AND the underlying popup.
 *
 * Reopen path mirrors the cluster's open chain exactly: first ensure Fake
 * A's popup is open (reuse `ensureGanttSharePopupOpen(gantt-bar-fake-a)`),
 * then DOM-click the popup's Share button (`task-popup-share-button`, the
 * same trigger 5b's spotlight points at), then await the `share-dialog`
 * anchor. Clicking the Share button also re-dispatches
 * `tour:share-dialog-opened`, matching the canonical open path.
 *
 * No-op when the dialog is already open (canonical, non-refresh path).
 * Best-effort: guarded + try/catch + tolerant of a missing trigger.
 */
export async function ensureShareDialogOpen(): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  try {
    if (isShareDialogOpen()) return;
    // The dialog lives inside Fake A's popup — make sure that popup is up
    // first (reopens it via the Gantt bar if a refresh closed it too).
    await ensureGanttSharePopupOpen(TOUR_TARGETS.ganttBarFakeA);
    // Re-check: a failed popup reopen means we cannot reach the Share
    // button. Degrade quietly rather than clicking into nothing.
    if (!isGanttSharePopupOpen()) return;
    const shareBtn = await waitForElement(
      targetSelector(TOUR_TARGETS.taskPopupShareButton),
      3000,
    );
    if (!(shareBtn instanceof HTMLElement)) return;
    tourClickWithLockBypass(shareBtn);
    await waitForElement(SHARE_DIALOG_OPEN_SELECTOR, 3000);
  } catch (err) {
    console.warn("[onboarding-v4] ensureShareDialogOpen failed", err);
  }
}

/**
 * Compose the Gantt-share popup reopen-guard ahead of an existing step
 * `onEnter`. Mirrors withExperimentPopupOpen: reopen FIRST (so the popup
 * is back before the original hook resolves popup-internal anchors), then
 * run the step's original onEnter. Both best-effort.
 *
 * Note: the dependent beats' existing onEnter ALSO re-runs the idempotent
 * spawn/ensure helpers (closeAnyOpenTaskPopup is the exception — the OPEN
 * beat 5a uses that, and is NOT wrapped here). The composer runs the
 * reopen first so the bar exists by the time it clicks; the beats that
 * spawn the bar in their inner onEnter are wrapped with the spawn running
 * BEFORE via a custom closure rather than this generic composer.
 */
export function withGanttSharePopupOpen(
  barTarget: TourTargetName,
  inner?: (ctx: { username: string | null }) => void | Promise<void>,
): (ctx: { username: string | null }) => Promise<void> {
  return async (ctx) => {
    await ensureGanttSharePopupOpen(barTarget);
    if (inner) await inner(ctx);
  };
}

/**
 * Compose the ShareDialog reopen-guard ahead of an existing step
 * `onEnter`. Mirrors withExperimentPopupOpen.
 */
export function withShareDialogOpen(
  inner?: (ctx: { username: string | null }) => void | Promise<void>,
): (ctx: { username: string | null }) => Promise<void> {
  return async (ctx) => {
    await ensureShareDialogOpen();
    if (inner) await inner(ctx);
  };
}

/**
 * Resolve the "active project" for the walkthrough by listing all
 * projects and returning the most-recently-created one. Returns `null`
 * when no project exists (e.g. the user skipped §6.1, the test
 * harness mocks an empty store, etc.). Caller treats null as "skip the
 * spawn"; the tour still advances on the step's own completion path.
 */
async function getActiveProject(): Promise<Project | null> {
  try {
    const projects = await projectsApi.list();
    if (!projects.length) return null;
    // Sort descending by created_at; ties broken by id (newer ids = later).
    const sorted = [...projects].sort((a, b) => {
      const cmp = (b.created_at ?? "").localeCompare(a.created_at ?? "");
      if (cmp !== 0) return cmp;
      return b.id - a.id;
    });
    return sorted[0] ?? null;
  } catch (err) {
    console.warn("[onboarding-v4] getActiveProject failed", err);
    return null;
  }
}

/**
 * Resolve the "active experiment" inside the active project. Picks the
 * most-recently-created `task_type === "experiment"` task. Returns
 * `null` when none exists.
 */
async function getActiveExperiment(projectId: number): Promise<Task | null> {
  try {
    const tasks = await tasksApi.listByProject(projectId);
    const experiments = tasks.filter((t) => t.task_type === "experiment");
    if (!experiments.length) return null;
    // Use task id as the recency proxy: per-user ids are monotonic.
    const sorted = [...experiments].sort((a, b) => b.id - a.id);
    return sorted[0] ?? null;
  } catch (err) {
    console.warn("[onboarding-v4] getActiveExperiment failed", err);
    return null;
  }
}

/**
 * §6.10 `gantt-chained-deps` onEnter.
 *
 * Spawns three throwaway demo tasks (BeakerBot Boil / Brew / Sip) so
 * BeakerBot's "I made three throwaway tasks for you" speech matches
 * what the user sees in the Gantt. Idempotency check: if any task in
 * the active project already has a name in `DEP_CHAIN_NAMES`, skip
 * the spawn entirely. A second visit to the step (refresh mid-tour)
 * therefore reuses the same three tasks instead of producing six.
 *
 * Returns the list of task ids spawned this run (empty array on
 * skip-due-to-idempotency, empty array on missing-project). The
 * registry binding ignores the return; the value is exposed so a
 * future P12 patch can record artifact ids into the sidecar.
 */
export async function onEnterGanttChainedDeps(ctx: {
  username: string | null;
}): Promise<number[]> {
  const project = await getActiveProject();
  if (!project) {
    console.warn(
      "[onboarding-v4] gantt-chained-deps: no active project; skip spawn",
    );
    return [];
  }
  try {
    const existing = await tasksApi.listByProject(project.id);
    const demoNameSet = new Set<string>(DEP_CHAIN_NAMES);
    const alreadyPresent = existing.some((t) => demoNameSet.has(t.name));
    if (alreadyPresent) return [];
    const spawned = await spawnDemoDependencyTasks(project.id);
    // v4 §6.8 cascade polish sub-bot 2026-05-21: create the A→B and
    // B→C dependency edges here, NOT via cursor drags. BeakerBotCursor's
    // `dragFromTo` primitive dispatches mouse events; the Gantt's
    // bar-onto-bar drop handler (`handleDropOnTask`) listens for HTML5
    // DragEvents, so the cursor's visual drag would not actually create
    // the dep records. Without real edges, the third cursor drag (A
    // onto a later date) would move A in isolation and B + C would
    // stay put — defeating the cascade demo. Creating the edges here
    // means the cursor's first two drags read as "watch me wire these
    // up" while the data is already in place.
    //
    // `dep_type: "FS"` (Finish-to-Start) matches the default branch the
    // user would pick from the dependency-creation popup if they were
    // doing it by hand — see GanttChart's depPopup branches; "FS" is
    // labelled "Start after" which is the most intuitive default for
    // the demo's narrative ("chains move as a unit when you reschedule").
    if (spawned.length === 3) {
      // Wave 1 sidecar hardening manager (v2): destructure into named
      // locals + explicit truthy checks. spawnDemoDependencyTasks types
      // its return as `number[]`; a partial-failure path could still
      // hand us `[undefined, undefined, undefined]` if a downstream
      // refactor stops filtering. Guarding the IDs here means the dep
      // create call below never gets a falsy parent_id / child_id.
      const [aId, bId, cId] = spawned;
      if (!aId || !bId || !cId) {
        console.warn(
          "[onboarding-v4] gantt-chained-deps: spawned ids missing; skip dep create",
          { aId, bId, cId },
        );
      } else {
        try {
          await dependenciesApi.create({
            parent_id: aId,
            child_id: bId,
            dep_type: "FS",
          });
          await dependenciesApi.create({
            parent_id: bId,
            child_id: cId,
            dep_type: "FS",
          });
          // Refresh the Gantt's task + dependency queries so the bars
          // and chain accents mount BEFORE the cursor's first visual
          // drag fires. Without this refetch, the user would briefly
          // see three unlinked bars (then a delayed chain render) which
          // breaks the "I wired them up" narrative.
          await Promise.all([
            appQueryClient.refetchQueries({ queryKey: ["tasks"] }),
            appQueryClient.refetchQueries({ queryKey: ["dependencies"] }),
          ]);
        } catch (err) {
          // Dependency creation failure is non-fatal: the demo still
          // shows three bars, just without the cascade. Surface in the
          // console so authors can spot it during dev.
          console.warn(
            "[onboarding-v4] gantt-chained-deps: dep create failed",
            err,
          );
        }
      }
    } else {
      // Wave 1 sidecar hardening manager (v2): explicit log on the
      // partial-spawn path. Previously a < 3 result silently dropped
      // the dependency-edge creation, leaving the user with N bars and
      // no cascade — defeating the demo with no console trail.
      console.warn(
        "[onboarding-v4] gantt-chained-deps: expected 3 spawned tasks, got",
        spawned.length,
      );
    }
    // Record one `task` artifact per spawned demo so the Phase 4
    // cleanup grid shows three rows under "Tasks" with
    // cleanup_default "discard". Type stays `task` (the brief reconciled
    // the docstring's hypothetical `demo_dep_task` to the canonical
    // `task` type — Phase4CleanupStep groups by type and a one-off
    // `demo_dep_task` would land in the tail "Other" section).
    // Username-gated: a missing user is best-effort, the spawn still
    // ran. cleanup-execution.ts `case "task"` already routes to
    // tasksApi.delete.
    if (ctx.username) {
      for (const taskId of spawned) {
        try {
          await patchOnboarding(ctx.username, (cur) =>
            appendArtifact(cur, {
              type: "task",
              id: String(taskId),
              cleanup_default: "discard",
            }),
          );
        } catch (err) {
          console.warn(
            "[onboarding-v4] gantt-chained-deps artifact persist failed",
            err,
          );
        }
      }
    }
    return spawned;
  } catch (err) {
    console.warn(
      "[onboarding-v4] gantt-chained-deps onEnter spawn failed",
      err,
    );
    return [];
  }
}

/**
 * §6.8 `gantt-goals-overview` placeholder-goal name. Exported for the
 * sub-bot test seam (and so the audit can grep one canonical constant
 * rather than a string scattered across step + cleanup code).
 *
 * The Phase 4 cleanup grid resolves the goal by id (from the artifact
 * entry), not by name; the name is only used here for idempotency
 * (don't double-spawn on a refresh between steps) and for the actual
 * goal label the user sees in the Gantt overlay.
 */
export const GANTT_DEMO_GOAL_NAME = "BeakerBot demo goal";

/**
 * §6.8 `gantt-goals-overview` onEnter.
 *
 * The step's speech promises "Goals visualize over the Gantt" and the
 * cursor clicks the goals affordance. Without a seeded goal, the
 * overlay opens empty and the speech reads as a broken promise. This
 * helper spawns a placeholder personal goal (project-scoped to the
 * active project, NOT lab-wide — keeps the demo scoped to the user's
 * own data) spanning today through ~3 days from today so the goal's
 * Gantt bar overlaps the timeline window the user is looking at.
 *
 * Why project-scoped instead of personal (`project_id: null`):
 *   - Phase 4 cleanup defaults to "discard" for this artifact (the
 *     demo goal isn't useful beyond the tour), and a project-scoped
 *     goal disappears alongside the demo project if the user discards
 *     the whole project tree.
 *   - The Gantt's goal overlay shows project-scoped goals when the
 *     active project filter matches; a `null`-project personal goal
 *     would only show on the "All" filter, which the §6.8 cursor
 *     script doesn't switch to. Project-scope keeps the overlay
 *     visible no matter where the user is in the project filter.
 *
 * Idempotency: skip the spawn if a goal named `GANTT_DEMO_GOAL_NAME`
 * already exists for the active project. A refresh mid-tour re-fires
 * onEnter, so without this guard the user would end up with two,
 * three, N identical placeholder goals.
 *
 * Artifact: appended to the wizard sidecar's `artifacts_created`
 * under `{ type: "goal", id: <goalId>, cleanup_default: "discard" }`
 * so Phase 4 cleanup's existing `case "goal"` branch (see
 * cleanup-execution.ts ~line 200) can delete it on tour exit. The
 * artifact write is guarded by `ctx.username` — without a username
 * we can't address the sidecar, so we skip the artifact write (the
 * goal still spawns; worst-case it sticks around as orphaned demo
 * data, which the user can delete manually).
 *
 * Returns the created goal id (or `null` when skipped / failed).
 * Caller ignores; exposed for the test seam + a future audit pass
 * that wants to confirm the spawn ran.
 */
export async function onEnterGanttGoalsOverview(ctx: {
  username: string | null;
}): Promise<number | null> {
  // gantt-share fix manager (BUG 2): close the leftover Fake A popup from
  // the prior sees-edit step BEFORE the goals speech shows. See
  // closeAnyOpenTaskPopup for why this lives here (registry override).
  closeAnyOpenTaskPopup();
  const project = await getActiveProject();
  if (!project) {
    console.warn(
      "[onboarding-v4] gantt-goals-overview: no active project; skip spawn",
    );
    return null;
  }
  // Idempotency probe: a refresh between steps re-fires onEnter, so
  // we look for an existing demo goal scoped to this project before
  // creating another one.
  try {
    const existing = await goalsApi.list();
    const alreadyPresent = existing.find(
      (g) => g.project_id === project.id && g.name === GANTT_DEMO_GOAL_NAME,
    );
    if (alreadyPresent) return alreadyPresent.id;
  } catch (err) {
    // List failures are not fatal; fall through to create. Worst-
    // case: a duplicate goal lands; cleanup will still wipe whichever
    // id we record in the artifact below.
    console.warn(
      "[onboarding-v4] gantt-goals-overview: goals list probe failed",
      err,
    );
  }

  // Date range: today through today+3 days. Three days is short
  // enough to fit comfortably in the user's current Gantt viewport
  // (most users see a one- to two-week window) but long enough that
  // the goal bar reads as a meaningful range rather than a single-day
  // tick. ISO `YYYY-MM-DD` matches HighLevelGoal.start_date / end_date
  // shape used elsewhere in the app.
  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 3);
  const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);

  let createdId: number | null = null;
  try {
    const goal = await goalsApi.create({
      project_id: project.id,
      name: GANTT_DEMO_GOAL_NAME,
      start_date: toIsoDate(today),
      end_date: toIsoDate(endDate),
      // Sky-blue palette nod to BeakerBot. Color is optional; passing
      // an explicit value keeps the demo goal visually consistent
      // across runs instead of inheriting whatever the goal overlay
      // assigns by default.
      color: "#38bdf8",
    });
    createdId = goal.id;
  } catch (err) {
    console.warn(
      "[onboarding-v4] gantt-goals-overview: goal create failed",
      err,
    );
    return null;
  }

  // Record the artifact so Phase 4 cleanup can wipe it on tour exit.
  // Guarded by username because the sidecar I/O is per-user; without
  // a username we have no address to write to. Skipping the artifact
  // write doesn't roll back the spawn — the goal stays in the user's
  // store and they can delete it manually if cleanup doesn't reach
  // it — which matches the brief's "best-effort" contract for
  // onEnter helpers. Wave 1 sidecar hardening manager (v2): also guard
  // on `createdId !== null` so a successful spawn with a falsy id
  // (defensive: shouldn't happen with the early-return above, but the
  // typed signature permits it) doesn't append `"null"` to the
  // sidecar's artifact list.
  if (ctx.username && createdId !== null) {
    try {
      await patchOnboarding(ctx.username, (cur) =>
        appendArtifact(cur, {
          type: "goal",
          id: String(createdId),
          // §6.8: demo goal is throwaway; default to discard so the
          // Phase 4 cleanup grid pre-checks it for removal. The user
          // can still flip it to keep at the grid if they want.
          cleanup_default: "discard",
        }),
      );
    } catch (err) {
      console.warn(
        "[onboarding-v4] gantt-goals-overview: artifact persist failed",
        err,
      );
    }
  } else if (ctx.username && createdId === null) {
    console.warn(
      "[onboarding-v4] gantt-goals-overview: createdId null after spawn; skip artifact persist",
    );
  }

  return createdId;
}
