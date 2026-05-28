/**
 * §6.5 Workbench experiment creation — RETIRED BeakerBot demo body.
 *
 * @deprecated 2026-05-27 (experiment-create user-action manager). The
 * prior single-step BeakerBot demo (cursor scripted: type name, click
 * Save) is replaced by a four-beat USER_ACTION sequence in
 * WorkbenchCreateExperimentOpenStep.tsx (the open beat + three NEW
 * beats: name, project, submit). The cursor scripting depended on DOM
 * elements, modal-mount timing, react-query cache freshness, and
 * `<option>` rendering races, all of which kept regressing across
 * unrelated changes elsewhere in the app. Flipping the beat to
 * USER_ACTION eliminated the entire class of bugs.
 *
 * The `workbench-create-experiment` step id is no longer present in
 * TOUR_STEP_ORDER. The body export below is retained ONLY so older
 * code paths importing it continue to type-check; new code should
 * import the four beat exports from WorkbenchCreateExperimentOpenStep.tsx
 * (`workbenchCreateExperimentOpenStep` +
 * `workbenchCreateExperimentNameStep` +
 * `workbenchCreateExperimentProjectStep` +
 * `workbenchCreateExperimentSubmitStep`).
 *
 * `PLACEHOLDER_EXPERIMENT_NAME` remains live: the §6.11 search step's
 * cursor-typed query still references it. Search may match a partial
 * substring of whatever name the user picks (e.g. "Demo" / "Western"),
 * so the constant is documentation of "what the search demo looks
 * for"; we no longer FORCE the user to type this exact name.
 */
import { manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

/**
 * Placeholder experiment name. Used to seed the §6.11 search step's
 * cursor-typed query so the demo has a deterministic string. The user-
 * driven §6.5 sequence does NOT type this verbatim any more; the user
 * picks whatever name they like. The search step is robust to partial
 * matches against either the placeholder or the user's actual name.
 */
export const PLACEHOLDER_EXPERIMENT_NAME = "Demo Experiment One";

/**
 * @deprecated 2026-05-27. Retained for back-compat with importers that
 * still reference the legacy demo step. NOT wired into TOUR_STEP_ORDER
 * or the step registry. New code should import the four beat exports
 * from WorkbenchCreateExperimentOpenStep.tsx.
 */
export const workbenchCreateExperimentStep = buildWalkthroughStep({
  id: "workbench-create-experiment",
  speech: "(Retired §6.5 BeakerBot demo. See workbench-create-experiment-* USER_ACTION beats.)",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchExperimentNameInput),
  completion: manualAdvance("Got it, next"),
});
