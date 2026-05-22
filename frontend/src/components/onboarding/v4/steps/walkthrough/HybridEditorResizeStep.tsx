/**
 * §6.7 Hybrid editor — resize demo + notes/results storage mental
 * model. Final of four hybrid-editor sub-steps.
 *
 * Cursor hovers the embedded image; the resize handle appears. Cursor
 * drags the corner to resize.
 *
 * Multi-paragraph speech bubble (mental model):
 *   "You can resize images inline, useful when a gel image is huge.
 *
 *    One more thing: notes-tab images and results-tab images are
 *    stored separately even though they're both linked to the same
 *    experiment. Notes are your working scratch; results are the
 *    published output."
 *
 * Per §6.7 completion is manual "Got it, next" — the resize is a
 * one-shot demo with no clean API event to wait for.
 *
 * Artifact:
 *   { type: "notes_content", id: "<taskId>", cleanup_default: "discard" }
 *
 * Cleanup default discard — the notes content was BeakerBot's typing,
 * not the user's research.
 *
 * Classification: BEAKERBOT DEMO (per Grant's design correction
 * 2026-05-21). Speech describes the inline-resize behavior; the cursor
 * demos it by dragging the resize handle. The speech doesn't direct
 * the user ("Drag the handle to resize"): it explains a capability,
 * and the cursor demonstrates. Cursor keeps the drag.
 */
import { projectsApi, tasksApi } from "@/lib/local-api";
import {
  cursorScript,
  safeClickAction,
  compactScript,
  waitForElement,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { flushPendingArtifacts, pendingArtifactStore } from "./lib/artifacts";

const STEP_ID = "hybrid-editor-resize";

export const hybridEditorResizeStep = buildWalkthroughStep({
  id: STEP_ID,
  speech: (
    <>
      <p className="mb-2">
        You can resize embedded images. I&apos;ll click the selfie and
        pick 50% from the popover.
      </p>
      <p>
        One more thing: notes-tab images and results-tab images are
        stored separately even though they&apos;re both linked to the same
        experiment. Notes are your working scratch; results are the
        published output.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.hybridEditorEmbeddedImage),
  cursorScript: cursorScript(async () => {
    // Grant 2026-05-21: the popover is click-to-pick-percentage, not a
    // drag-corner handle. Cursor clicks the embedded image to open the
    // popover, then clicks 50%. No drag primitive needed.
    const image = await waitForElement(
      targetSelector(TOUR_TARGETS.hybridEditorEmbeddedImage),
      3000,
    );
    if (!image) return [];
    const clickImage = await safeClickAction(
      targetSelector(TOUR_TARGETS.hybridEditorEmbeddedImage),
      2000,
    );
    const clickFifty = await safeClickAction(
      targetSelector(TOUR_TARGETS.hybridEditorResizePercent50),
      3000,
    );
    return compactScript([clickImage, clickFifty]);
  }),
  completion: manualAdvance("Got it, next"),
  // Track the experiment whose notes BeakerBot edited during the §6.7
  // arc. Active experiment = most-recently-created experiment in the
  // most-recently-created project (mirrors `getActiveExperiment` in
  // on-enter-helpers.ts). Records a `notes_content` artifact with
  // cleanup_default "keep" per L24 default-keep + the brief — the
  // cleanup-execution.ts notes-content case is a no-op (reverting
  // per-keystroke edits is out of scope) so this row exists in the
  // Phase 4 grid as a UX-honest record of what happened rather than a
  // destructive cleanup.
  onEnter: async () => {
    try {
      const projects = await projectsApi.list();
      if (!projects.length) return;
      const sorted = [...projects].sort((a, b) => {
        const cmp = (b.created_at ?? "").localeCompare(a.created_at ?? "");
        if (cmp !== 0) return cmp;
        return b.id - a.id;
      });
      const project = sorted[0];
      if (!project) return;
      const tasks = await tasksApi.listByProject(project.id);
      const experiments = tasks
        .filter((t) => t.task_type === "experiment")
        .sort((a, b) => b.id - a.id);
      const experiment = experiments[0];
      if (!experiment) return;
      pendingArtifactStore.add(STEP_ID, {
        type: "notes_content",
        id: String(experiment.id),
        cleanup_default: "keep",
      });
    } catch (err) {
      console.warn(
        "[onboarding-v4] hybrid-editor-resize artifact capture failed",
        err,
      );
    }
  },
  onExit: async () => {
    await flushPendingArtifacts(STEP_ID);
  },
});
