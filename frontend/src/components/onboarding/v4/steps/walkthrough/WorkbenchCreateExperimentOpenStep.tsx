/**
 * §6.5 Workbench experiment creation, USER_ACTION sequence
 * (experiment-create user-action manager 2026-05-27 refactor).
 *
 * Replaces the prior BeakerBot demo (cursor scripted: pick project,
 * type name, click submit) with a four-beat user-driven sequence:
 *
 *   1. workbench-create-experiment-open    (id preserved for migration)
 *      Spotlight the "+ New Experiment" button. Advance on
 *      `tour:workbench-experiment-modal-opened` when the user clicks.
 *
 *   2. workbench-create-experiment-name    (NEW)
 *      Spotlight the Name input. Manual advance ("Got it, next").
 *
 *   3. workbench-create-experiment-project (NEW)
 *      Spotlight the Project dropdown. Manual advance ("Got it, next").
 *      No selection gating, the user can leave it on Miscellaneous if
 *      they want. Speech tells them what that means.
 *
 *   4. workbench-create-experiment-submit  (NEW)
 *      Spotlight the Create Experiment button. Manual advance gated by
 *      `disabledUntilEvent: TOUR_DOM_EVENTS.experimentCreated` so the
 *      "Got it, next" button stays disabled until the experiment lands
 *      on disk (the event is dispatched by TaskModal's handleSubmit on
 *      a successful create).
 *
 * Why this refactor (Grant 2026-05-27): the prior BeakerBot demo kept
 * regressing because the cursor scripting depended on DOM elements,
 * modal-mount timing, react-query cache freshness, and `<option>`
 * rendering races. Each fix was a build-time-vs-playback-time patch
 * on the same brittle path. Flipping to USER_ACTION eliminates the
 * entire class of bugs at the cost of one extra moment of user
 * interaction (the user types instead of watching).
 *
 * The submit beat captures the artifact (the just-created task id)
 * via an onEnter listener on `tour:experiment-created`, then flushes
 * on onExit. The other three beats are pure spotlight-and-advance,
 * with no artifact tracking of their own.
 *
 * Step id `workbench-create-experiment-open` is preserved verbatim for
 * migration continuity (Grant's hand-walk resume mechanism keys off
 * step ids, and the old single-beat id remains the entry point of the
 * new sequence).
 */
import { advanceOnEvent, buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import {
  TOUR_DOM_EVENTS,
  watchWorkbenchExperimentModalOpened,
} from "./lib/tour-events";
import { flushPendingArtifacts, pendingArtifactStore } from "./lib/artifacts";
import {
  closeNotificationsPopup,
  ensureCreateExperimentModalOpen,
  rehydrateExperimentSubmitGate,
  switchWorkbenchTab,
  withCreateExperimentModalOpen,
} from "./lib/on-enter-helpers";
import {
  ensureFirstProjectExists as canonicalEnsureFirstProjectExists,
  resolveFirstProjectId as canonicalResolveFirstProjectId,
} from "./lib/ensure-helpers";

/** Placeholder experiment name carried for §6.11 search-step re-use.
 *  The search step's cursor types a query that may match this name
 *  (substring), so we keep the constant exported even though the
 *  USER_ACTION refactor no longer forces the user to type this exact
 *  string. */
export const FIRST_EXPERIMENT_NAME = "First experiment";

/**
 * Re-exports of the canonical ensure / resolve helpers. The local
 * copies that used to live in this file have been retired (commit
 * 220e28c1 deduplicated them with lib/ensure-helpers.ts). Re-exports
 * keep prior callers (MethodAttachmentAttachStep, tests) importing
 * from this file working.
 */
export const resolveFirstProjectId = canonicalResolveFirstProjectId;
export const ensureFirstProjectExists = canonicalEnsureFirstProjectExists;

/** Beat 1: spotlight the "+ New Experiment" button on the Workbench
 *  Experiments panel. Advances when the user clicks (the panel
 *  dispatches `tour:workbench-experiment-modal-opened` in
 *  WorkbenchExperimentsPanel.tsx's handleCreateExperiment callback).
 *  Auto-navigates to /workbench on resume. */
export const workbenchCreateExperimentOpenStep = buildWalkthroughStep({
  id: "workbench-create-experiment-open",
  speech: (
    <>
      <p className="mb-2">
        The Workbench is where you log your day-to-day lab work. Every
        experiment you run gets its own entry, with space for notes,
        results, attached methods, and files.
      </p>
      <p>
        Let&apos;s create your first experiment. Click{" "}
        <strong>+ New Experiment</strong> to open the form.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchNewExperiment),
  // No cursorScript: USER_ACTION step. The user clicks the spotlighted
  // button themselves.
  //
  // onEnter (tour-workbench-tab-fix bot 2026-06-03): the Workbench now
  // DEFAULTS to the "Projects" tab (de-bloat change), but the
  // "+ New Experiment" button (TOUR_TARGETS.workbenchNewExperiment) only
  // renders on the Experiments sub-tab. Without a switch the spotlight
  // resolves to nothing and the user is stuck with nothing to click.
  // Switch to the Experiments tab in onEnter so the button mounts before
  // the spotlight's MutationObserver looks for it. Also close any
  // lingering Notifications dropdown left open by the §6.3 bell arc
  // (notifications-bell -> silence -> delete) so it doesn't overlap this
  // spotlight. Both helpers are guarded + idempotent + no-op when their
  // target is absent. The downstream name/project/submit beats all happen
  // inside the TaskModal, which is tab-independent, so they need no
  // change. onEnter runs after the pathname settles on /workbench (see
  // TourController), before the spotlight resolves.
  onEnter: () => {
    closeNotificationsPopup();
    switchWorkbenchTab(TOUR_TARGETS.workbenchExperimentsTab);
  },
  completion: advanceOnEvent(watchWorkbenchExperimentModalOpened),
  expectedRoute: "/workbench",
});

/** Beat 2 (NEW): spotlight the Name input. Pure narration + manual
 *  advance, no event gate, no name-content check. The user types
 *  whatever they want, we trust them to follow the prompt. Renaming
 *  later is a one-click affordance on the experiment row, so a typo
 *  or placeholder is recoverable. */
export const workbenchCreateExperimentNameStep = buildWalkthroughStep({
  id: "workbench-create-experiment-name",
  speech:
    "Give your experiment a name. Something descriptive, but it can be short. You can always rename later.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchExperimentNameInput),
  // tour-modal-resilience bot 2026-06-03: this beat spotlights the Name
  // input INSIDE the Create Experiment modal (TaskModal), which a mid-
  // tour refresh closes (portal state, not a route). Reopen it first.
  // The helper suppresses the reopen once an experiment already exists
  // on disk, so it never dumps the user back at a blank form they
  // already submitted; reopening on the pre-create path loses any half-
  // typed name (acceptable, better than a dead spotlight, and this beat
  // asks the user to type a name anyway). No-op on the canonical path.
  onEnter: () => ensureCreateExperimentModalOpen(),
  completion: manualAdvance("Got it, next"),
});

/** Beat 3 (NEW): spotlight the Project dropdown. The speech explains
 *  what skipping the pick means (Standalone) so the user can choose
 *  with full information. No selection gate, the user can leave the
 *  default and move on. */
export const workbenchCreateExperimentProjectStep = buildWalkthroughStep({
  id: "workbench-create-experiment-project",
  speech: (
    <>
      <p className="mb-2">
        Pick the project folder you just made. This keeps your
        experiments organized by research project.
      </p>
      <p>
        If you skip this, the experiment lands in Standalone, which you
        can still see in the Workbench (toggle the Standalone pill) and
        re-file into a project later.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchExperimentProjectSelect),
  // tour-modal-resilience bot 2026-06-03: same as the name beat, this
  // spotlights the Project dropdown INSIDE the Create Experiment modal
  // (TaskModal). Reopen the modal first (suppressed once an experiment
  // exists). No-op on the canonical path.
  onEnter: () => ensureCreateExperimentModalOpen(),
  completion: manualAdvance("Got it, next"),
});

const SUBMIT_STEP_ID = "workbench-create-experiment-submit";

/** Beat 4 (NEW): spotlight the Create Experiment submit button. Manual
 *  advance is GATED on `tour:experiment-created` (dispatched by
 *  TaskModal's handleSubmit on a successful create), so the
 *  "Got it, next" button stays disabled until the experiment actually
 *  lands on disk. The user must click the real Create Experiment
 *  button (or hit Enter on the form) before the tour can move on.
 *
 *  Artifact capture lives here (not on the open / name / project
 *  beats) because this is the beat where the task lands. The onEnter
 *  listener parses the new task id out of the event detail and
 *  stashes it in pendingArtifactStore; onExit flushes the captured
 *  artifact to the sidecar via flushPendingArtifacts.
 *  cleanup_default "keep" because the user's first experiment is
 *  useful past the tour. */
export const workbenchCreateExperimentSubmitStep = buildWalkthroughStep({
  id: SUBMIT_STEP_ID,
  speech: (
    <>
      <p className="mb-2">
        You can set the start date, duration, or link a method here
        too, but we&apos;ll attach a method later, so leave that for now.
      </p>
      <p>
        Click <strong>Create Experiment</strong> to save.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchExperimentSubmit),
  // No cursorScript: USER_ACTION step. The user clicks Create Experiment
  // themselves. The disabledUntilEvent gate prevents racing past the
  // button click via "Got it, next".
  completion: manualAdvance("Got it, next", {
    disabledUntilEvent: TOUR_DOM_EVENTS.experimentCreated,
    disabledAriaLabel:
      "Click Create Experiment to save first, then this will enable.",
  }),
  // Capture the created task id from the `tour:experiment-created`
  // event detail. Same shape as the home-create-project-fill artifact
  // capture (project id from `tour:project-created`).
  // tour-modal-resilience bot 2026-06-03: compose the Create Experiment
  // modal-reopen guard AHEAD of the existing experiment-created listener
  // (mirrors the experiment-popup `withExperimentPopupOpen` composition).
  // The guard reopens ONLY when the modal is closed AND no experiment
  // exists yet, so a refresh AFTER the experiment was created no-ops
  // (no confusing blank-form reopen).
  //
  // tour-submit-gate bot 2026-06-03: closes the gate-persistence gap the
  // modal-resilience bot flagged. The `disabledUntilEvent:
  // experimentCreated` gate does NOT survive a refresh (the event fired
  // before reload), so a refresh on this exact beat AFTER creating the
  // experiment used to leave "Got it, next" permanently disabled even
  // though the work is done = soft-block. After registering the
  // artifact-capture listener below, `rehydrateExperimentSubmitGate()`
  // scans the disk for an existing experiment and, if one is found,
  // re-dispatches `tour:experiment-created` with its real id. That
  // satisfies the controller's gate listener (button enables) AND feeds
  // the artifact-capture listener the same id (deduped on (type, id), so
  // no double artifact). On the CANONICAL fresh run no experiment exists,
  // so it no-ops and the button stays disabled until the user genuinely
  // clicks Create Experiment. The rehydrate runs AFTER the listener is
  // registered (and after an await, so the controller's gate effect has
  // mounted) so the re-dispatch is observed by both listeners.
  onEnter: withCreateExperimentModalOpen(async () => {
    if (typeof window === "undefined") return;
    const handler = (evt: Event) => {
      const id = (evt as CustomEvent<{ id?: number }>).detail?.id;
      if (id === undefined || id === null) return;
      pendingArtifactStore.add(SUBMIT_STEP_ID, {
        type: "experiment",
        id: String(id),
        cleanup_default: "keep",
      });
      window.removeEventListener(TOUR_DOM_EVENTS.experimentCreated, handler);
    };
    window.addEventListener(TOUR_DOM_EVENTS.experimentCreated, handler);
    // Re-hydrate the refresh-after-create gate. No-op on the canonical
    // pre-create path (no experiment on disk yet).
    await rehydrateExperimentSubmitGate();
  }),
  onExit: async () => {
    await flushPendingArtifacts(SUBMIT_STEP_ID);
  },
});
