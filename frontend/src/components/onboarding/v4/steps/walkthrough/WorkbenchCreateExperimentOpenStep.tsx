/**
 * §6.5 Workbench experiment creation: BeakerBot demos opening + filling
 * the New Experiment modal (experiment-flow fix manager, 2026-05-27).
 *
 * Hand-walk feedback (Grant 2026-05-27): the prior shape opened the
 * modal on a user click and advanced the moment
 * `tour:workbench-experiment-modal-opened` fired, leaving the experiment
 * uncreated. Downstream `experiment-attach-method-*` sub-steps fired
 * against a not-yet-existing experiment, and the project dropdown
 * defaulted to "Miscellaneous (standalone tasks)" instead of the
 * project the user just made in `home-create-project-fill`.
 *
 * Rewrite shape: BEAKERBOT DEMO. The cursor:
 *   1. Clicks "+ New Experiment" so the TaskModal mounts.
 *   2. Changes the Project <select> to the user's most-recently-created
 *      project (read from `projectsApi.list()` at script-build time,
 *      filtering out Miscellaneous + shared projects). Falls back to
 *      leaving the default if no own-project exists.
 *   3. Types the placeholder name "First experiment" into the name input.
 *   4. Clicks Create Experiment.
 *
 * The "+ Link a method (optional)" affordance is intentionally NOT
 * exercised here. Grant wants the method attached LATER in the
 * `experiment-attach-method-attach` sub-step.
 *
 * Completion: `manualAdvance` per the universal pacing rule (Grant
 * 2026-05-22), gated on `tour:experiment-created` so the "Got it, next"
 * button stays disabled until the experiment has actually landed on
 * disk. This fixes Bug C from the hand-walk (the tour used to advance
 * past an unfinished experiment because completion fired the moment the
 * modal opened, not the moment the experiment was created).
 *
 * pageLock: total lock during the demo so the user doesn't accidentally
 * click outside the modal and soft-walk themselves out of the tour.
 * Mirrors `MethodsCreateStep` and `MethodsCategoryStep`.
 *
 * Artifact: `{ type: "experiment", id: "<taskId>", cleanup_default: "keep" }`.
 * The first experiment is useful past the tour.
 */
import {
  cursorScript,
  safeClickAction,
  compactScript,
  callbackAction,
  waitForElement,
  setNativeFieldValue,
  tourClickWithLockBypass,
} from "./lib/cursor-script";
import { manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { TOUR_DOM_EVENTS } from "./lib/tour-events";
import { flushPendingArtifacts, pendingArtifactStore } from "./lib/artifacts";
import {
  ensureFirstProjectExists as canonicalEnsureFirstProjectExists,
  resolveFirstProjectId as canonicalResolveFirstProjectId,
} from "./lib/ensure-helpers";

const STEP_ID = "workbench-create-experiment-open";

/** Placeholder experiment name the cursor types into the Name input.
 *  Exported so the pacing / phrase-pinning tests can assert the exact
 *  string lands in the script. */
export const FIRST_EXPERIMENT_NAME = "First experiment";

/** Read-then-watch pause between cursor beats inside the open-and-create
 *  demo. 800ms matches the cadence used by §6.4d `methods-create` and
 *  §6.10 `ai-helper-size-diff` so the user has a beat to register each
 *  visible action (modal open → project picked → name typed → submit)
 *  before the next one fires. */
export const WORKBENCH_CREATE_PAUSE_MS = 800;

async function pause(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    if (typeof window !== "undefined") {
      window.setTimeout(resolve, ms);
    } else {
      setTimeout(resolve, ms);
    }
  });
}

// experiment-create regression fix 2026-05-27: dedupe with the
// canonical helpers in `./lib/ensure-helpers`. The local copies that
// used to live here (resolveFirstProjectId + ensureFirstProjectExists)
// silently diverged: the canonical lib version learned to invalidate
// the ["projects"] react-query cache after a create so TaskModal's
// `projects` prop reflects the new project, while the local copies
// here did not. The result was the recurring "cursor opens modal,
// types name, but Project stays on Miscellaneous and Create stays
// disabled" symptom Grant kept flagging. Re-exports below keep prior
// callers (and tests that imported from this file) working while
// guaranteeing one source of truth.
export const resolveFirstProjectId = canonicalResolveFirstProjectId;
export const ensureFirstProjectExists = canonicalEnsureFirstProjectExists;

export const workbenchCreateExperimentOpenStep = buildWalkthroughStep({
  id: STEP_ID,
  // Speech pivots from "tell the user to click +New Experiment" to
  // "BeakerBot is opening + filling the form for you". Keeps the
  // workbench intro framing but signals the demo.
  speech: (
    <>
      <p className="mb-2">
        The Workbench is where you log your day-to-day lab work. Every
        experiment you run gets its own entry, with space for notes,
        results, attached methods, and files.
      </p>
      <p className="mb-2">
        Watch. I&apos;ll open <strong>+ New Experiment</strong>, file it
        into the project you just made, give it a placeholder name, and
        save.
      </p>
      <p>
        You can also set the start date and duration of the experiment
        here, or optionally link a method right now. We&apos;ll attach
        one later, so leave that for now.
      </p>
    </>
  ),
  pose: "typing-on-laptop",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchNewExperiment),
  cursorScript: cursorScript(async () => {
    // 1. Click the spotlighted "+ New Experiment" button. The button
    //    exists at build time, so `safeClickAction` resolves
    //    immediately. The handler dispatches
    //    `tour:workbench-experiment-modal-opened`; the TaskModal then
    //    mounts.
    const openClick = await safeClickAction(
      targetSelector(TOUR_TARGETS.workbenchNewExperiment),
      3000,
    );

    // Steps 2-4 (project pick, name type, submit) all need the
    // TaskModal's elements, which DON'T EXIST at build time. The naive
    // `await safe*Action(...)` calls would each call waitForElement
    // synchronously and time out (5000ms each, ~15s blocked) before
    // returning null, producing a cursor with only the openClick.
    //
    // Hand-walk fix 2026-05-27 (second pass): wrap each post-modal
    // action in a callbackAction that resolves at PLAYBACK time, so the
    // selector queries see the just-mounted modal. Uses
    // `setNativeFieldValue` for the select + name input to fire React's
    // controlled onChange path (mirrors safeChangeSelectAction's
    // internal callback shape).

    const pickProject = callbackAction(async () => {
      if (typeof document === "undefined") return;
      // Re-resolve the project id at playback so a project created
      // moments earlier in the tour is in the API list. If none
      // exists (user skipped §6.1 home-create-project via dev tools),
      // create a placeholder one so the demo has a valid target.
      const projectId = await ensureFirstProjectExists();
      if (projectId === null) return;
      // Wait briefly for the select to mount.
      const select = await waitForElement(
        targetSelector(TOUR_TARGETS.workbenchExperimentProjectSelect),
        3000,
      );
      if (!(select instanceof HTMLSelectElement)) return;
      // Wait for the specific option to mount. The TaskModal loads the
      // user's project list async post-mount, so the first paint only
      // includes the Miscellaneous (id=0) option. Setting
      // `select.value` to a value not yet in the options silently
      // no-ops, leaving the select on Miscellaneous. Poll until the
      // option for our projectId exists.
      //
      // Timeout bumped 3s → 6s on 2026-05-27 (Grant hand-walk regression):
      // when ensureFirstProjectExists creates a placeholder project and
      // the canonical helper invalidates the ["projects"] query, react-
      // query's refetch + the workbench page's re-render + the TaskModal's
      // prop propagation can take longer than 3s on slow machines. The
      // extra headroom is cheap (the polling loop short-circuits the
      // moment the option mounts) and prevents the silent-drop symptom
      // Grant kept hitting.
      const optionSelector = `${targetSelector(TOUR_TARGETS.workbenchExperimentProjectSelect)} option[value="${projectId}"]`;
      const option = await waitForElement(optionSelector, 6000);
      if (!option) return;
      setNativeFieldValue(select, String(projectId));
    });

    const typeName = callbackAction(async () => {
      if (typeof document === "undefined") return;
      const input = await waitForElement(
        targetSelector(TOUR_TARGETS.workbenchExperimentNameInput),
        3000,
      );
      if (!(input instanceof HTMLInputElement)) return;
      setNativeFieldValue(input, FIRST_EXPERIMENT_NAME);
    });

    const submit = callbackAction(async () => {
      if (typeof document === "undefined") return;
      const btn = await waitForElement(
        targetSelector(TOUR_TARGETS.workbenchExperimentSubmit),
        3000,
      );
      if (!(btn instanceof HTMLElement)) return;
      // Route through tourClickWithLockBypass so the TourPageLock's
      // __beakerBotCursorClicking flag is set during the click. Raw
      // btn.click() doesn't set the flag, so the page-lock (with
      // allowList: []) blocks the click and the experiment never gets
      // created.
      tourClickWithLockBypass(btn);
    });

    // Interleave 800ms read-then-watch pauses between each visible
    // action so the user can register each beat (modal open → project
    // picked → name typed → submit) before the next one fires.
    return compactScript([
      openClick,
      callbackAction(() => pause(WORKBENCH_CREATE_PAUSE_MS)),
      pickProject,
      callbackAction(() => pause(WORKBENCH_CREATE_PAUSE_MS)),
      typeName,
      callbackAction(() => pause(WORKBENCH_CREATE_PAUSE_MS)),
      submit,
    ]);
  }),
  // Total page-lock during the BeakerBot demo. Cursor clicks pass
  // through via the `__beakerBotCursorClicking` flag; only stray user
  // clicks (outside the speech bubble) are blocked. Prevents the user
  // from accidentally clicking outside the TaskModal and soft-walking
  // themselves out of the tour. Empty allowList = total lock.
  pageLock: {
    allowList: [],
    pillLabel: "BeakerBot is creating the experiment. Hold on a moment.",
  },
  // Universal pacing (Grant 2026-05-22): BeakerBot demo steps wait for
  // the user to click "Got it, next" before advancing. The button is
  // DISABLED until `tour:experiment-created` fires (Bug C in the
  // hand-walk brief), so the user can't advance past an unfinished
  // experiment.
  completion: manualAdvance("Got it, next", {
    disabledUntilEvent: TOUR_DOM_EVENTS.experimentCreated,
    disabledAriaLabel: "BeakerBot is still creating the experiment.",
  }),
  // Capture the created experiment task id out of the
  // `tour:experiment-created` event detail so Phase 4 cleanup grid
  // lists the experiment under "Experiments" with its real id.
  // cleanup_default "keep" because the first experiment is useful past
  // the tour (matches the §6.1 project artifact's keep default).
  onEnter: () => {
    if (typeof window === "undefined") return;
    const handler = (evt: Event) => {
      const id = (evt as CustomEvent<{ id?: number }>).detail?.id;
      if (id === undefined || id === null) return;
      pendingArtifactStore.add(STEP_ID, {
        type: "experiment",
        id: String(id),
        cleanup_default: "keep",
      });
      window.removeEventListener(TOUR_DOM_EVENTS.experimentCreated, handler);
    };
    window.addEventListener(TOUR_DOM_EVENTS.experimentCreated, handler);
  },
  onExit: async () => {
    await flushPendingArtifacts(STEP_ID);
  },
  expectedRoute: "/workbench",
});
