/**
 * §6.5 Workbench experiment creation — USER ACTION sequence
 * (experiment-create user-action manager 2026-05-27 refactor).
 *
 * Replaces the prior BeakerBot demo (cursor scripted: pick project,
 * type name, click submit) with a four-beat user-driven sequence:
 *
 *   1. workbench-create-experiment-open    (THIS FILE'S RETAINED ID)
 *      Spotlight the "+ New Experiment" button. Advance on
 *      `tour:workbench-experiment-modal-opened` when the user clicks.
 *
 *   2. workbench-create-experiment-name    (NEW)
 *      Spotlight the Name input. Manual advance ("Got it, next").
 *
 *   3. workbench-create-experiment-project (NEW)
 *      Spotlight the Project dropdown. Manual advance ("Got it, next").
 *      No selection gating: the user can leave it on Miscellaneous if
 *      they want — the speech tells them what that means.
 *
 *   4. workbench-create-experiment-submit  (NEW)
 *      Spotlight the Create Experiment button. Manual advance, gated by
 *      `disabledUntilEvent: TOUR_DOM_EVENTS.experimentCreated` so the
 *      "Got it, next" button stays disabled until the experiment lands
 *      on disk (dispatched by tasksApi.create in lib/local-api.ts).
 *
 * Why this refactor (Grant 2026-05-27): the prior BeakerBot demo kept
 * regressing because the cursor scripting depended on DOM elements,
 * modal-mount timing, react-query cache freshness, and `<option>`
 * rendering races. Each fix was a play-build-time-vs-playback-time
 * patch on the same brittle path. Flipping the beat to USER_ACTION
 * eliminates the entire class of bugs at the cost of one extra second
 * of user interaction (the user types instead of watching).
 *
 * The submit beat captures the artifact (the just-created task id) via
 * an onEnter listener on `tour:experiment-created`, then flushes on
 * onExit. The open / name / project beats are pure spotlight-and-advance,
 * with no artifact tracking of their own.
 *
 * Step id `workbench-create-experiment-open` is preserved verbatim for
 * migration continuity (Grant's hand-walk resume mechanism keys off
 * step ids, and the old single-beat id remains the entry point of the
 * new sequence).
 */
import { buildWalkthroughStep, advanceOnEvent, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import {
  TOUR_DOM_EVENTS,
  watchWorkbenchExperimentModalOpened,
} from "./lib/tour-events";
import { flushPendingArtifacts, pendingArtifactStore } from "./lib/artifacts";

/** Beat 1: spotlight the "+ New Experiment" button on the Workbench
 *  Experiments panel. Advances when the user clicks (the panel
 *  dispatches `tour:workbench-experiment-modal-opened` in
 *  WorkbenchExperimentsPanel.tsx's handleCreateExperiment callback).
 *  Auto-navigates to /workbench on resume. */
export const workbenchCreateExperimentOpenStep = buildWalkthroughStep({
  id: "workbench-create-experiment-open",
  speech:
    "The Workbench is where you log your day-to-day lab work. Let's create your first experiment. Click + New Experiment to start.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchNewExperiment),
  // No cursorScript: user-action step. The user clicks the spotlighted
  // button themselves.
  completion: advanceOnEvent(watchWorkbenchExperimentModalOpened),
  expectedRoute: "/workbench",
});

/** Beat 2 (NEW): spotlight the Name input. Pure narration + manual
 *  advance — no event gate, no name-content check. The user types
 *  whatever they want; we trust them to follow the prompt. Renaming
 *  later is a one-click affordance on the experiment row, so a typo or
 *  placeholder is recoverable. */
export const workbenchCreateExperimentNameStep = buildWalkthroughStep({
  id: "workbench-create-experiment-name",
  speech:
    "Give your experiment a name. Something descriptive, but it can be short. You can always rename later.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchExperimentNameInput),
  completion: manualAdvance("Got it, next"),
});

/** Beat 3 (NEW): spotlight the Project dropdown. The speech explains
 *  what skipping the pick means (Standalone) so the user can choose
 *  with full information. No selection gate — the user can leave the
 *  default and move on. */
export const workbenchCreateExperimentProjectStep = buildWalkthroughStep({
  id: "workbench-create-experiment-project",
  speech:
    "Pick the project folder you just made. This keeps your experiments organized by research project. If you skip this, the experiment lands in Standalone, which you can still see and re-file later.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchExperimentProjectSelect),
  completion: manualAdvance("Got it, next"),
});

const SUBMIT_STEP_ID = "workbench-create-experiment-submit";

/** Beat 4 (NEW): spotlight the Create Experiment submit button. Manual
 *  advance is GATED on `tour:experiment-created` (dispatched by
 *  tasksApi.create in lib/local-api.ts), so the "Got it, next" button
 *  stays disabled until the experiment actually lands on disk. The user
 *  must click the real Create Experiment button (or hit Enter on the
 *  form) before the tour can move on.
 *
 *  Artifact capture lives here (not on the open / name / project beats)
 *  because this is the beat where the task lands. The onEnter listener
 *  parses the new task id out of the event detail and stashes it in
 *  pendingArtifactStore; onExit flushes the captured artifact to the
 *  sidecar via flushPendingArtifacts. cleanup_default "keep" because
 *  the user's first experiment is useful past the tour. */
export const workbenchCreateExperimentSubmitStep = buildWalkthroughStep({
  id: SUBMIT_STEP_ID,
  speech:
    "Now click Create Experiment to save. You can set the start date, duration, or link a method here too, but we'll attach a method in a later step.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchExperimentSubmit),
  // No cursorScript: user-action step. The user clicks Create Experiment
  // themselves. The disabledUntilEvent gate prevents the user from
  // racing past the button click via "Got it, next".
  completion: manualAdvance("Got it, next", {
    disabledUntilEvent: TOUR_DOM_EVENTS.experimentCreated,
    disabledAriaLabel: "Click Create Experiment to save first, then this will enable.",
  }),
  // Capture the created task id from the `tour:experiment-created`
  // event detail. Same shape as the home-create-project-fill artifact
  // capture (project id from `tour:project-created`). cleanup_default
  // "keep" — the first experiment is useful past the tour. The listener
  // tears itself down after the first event so a back-step + forward-
  // step into this beat re-arms on the next entry.
  onEnter: () => {
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
  },
  onExit: async () => {
    // Flush whatever the onEnter listener captured. Best-effort: missing
    // user / empty pending list both no-op cleanly. Mirrors the
    // home-create-project-fill onExit pattern.
    await flushPendingArtifacts(SUBMIT_STEP_ID);
  },
});
