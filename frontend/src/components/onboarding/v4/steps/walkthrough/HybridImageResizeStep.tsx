/**
 * §6.7 HE-10 — image resize (BeakerBot demo).
 *
 * Hybrid editor manager 2026-05-22. Same shape as the retired
 * `hybrid-editor-resize` step, minus the notes-vs-results coda (which
 * moved to HE-0 at the top of the §6.7 cluster).
 *
 * Cursor clicks the inline image to open the size picker, then clicks
 * the 50% (default) option. The click-and-pick popover is the canonical
 * resize affordance.
 *
 * Artifact: still records a `notes_content` artifact at this terminal
 * step so the Phase 4 cleanup grid has a row for everything BeakerBot
 * typed during the HE-5 / HE-6 demos. Default `keep` — the
 * cleanup-execution.ts notes-content case is a no-op (reverting per-
 * keystroke edits is out of scope) so the row exists in the Phase 4
 * grid as a UX-honest record rather than a destructive cleanup.
 */
import { projectsApi, tasksApi } from "@/lib/local-api";
import { fileService } from "@/lib/file-system/file-service";
import { taskNotesBase } from "@/lib/tasks/results-paths";
import {
  cursorScript,
  safeClickAction,
  compactScript,
  waitForElement,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { flushPendingArtifacts, pendingArtifactStore } from "./lib/artifacts";

const STEP_ID = "hybrid-image-resize";

export const hybridImageResizeStep = buildWalkthroughStep({
  id: STEP_ID,
  speech: (
    <p>
      Click an image to resize it. Small, medium, large, or original.
    </p>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.hybridEditorEmbeddedImage),
  cursorScript: cursorScript(async () => {
    // The popover is click-to-pick-percentage. Cursor clicks the
    // embedded image to open the popover, then clicks 50%. No drag
    // primitive needed.
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
  onEnter: async () => {
    // R1 fix-pass (verifier A P2-14): only capture the notes_content
    // artifact when something was actually authored. Reading the
    // experiment's notes.md and gating on a non-empty body keeps the
    // Phase 4 cleanup grid from showing a noisy "your notes content"
    // row when the user advanced past every typing beat without
    // anything landing (e.g. HE-5 / HE-6 page-lock pacing race where
    // the cursor didn't reach the typed-character commit before the
    // user clicked Got-it-next).
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
      const owner = experiment.owner || "";
      if (!owner) return;

      // Probe notes.md for actual content before adding the artifact.
      const notesPath = `${taskNotesBase({ id: experiment.id, owner })}/notes.md`;
      let body = "";
      try {
        const f = await fileService.readFileAsBlob(notesPath);
        if (f) body = await f.text();
      } catch {
        body = "";
      }
      // Trim then check — a notes.md containing only whitespace /
      // empty paragraphs shouldn't count as "user typed something".
      if (body.trim().length === 0) return;

      pendingArtifactStore.add(STEP_ID, {
        type: "notes_content",
        id: String(experiment.id),
        cleanup_default: "keep",
      });
    } catch (err) {
      console.warn(
        "[onboarding-v4] hybrid-image-resize artifact capture failed",
        err,
      );
    }
  },
  onExit: async () => {
    await flushPendingArtifacts(STEP_ID);
  },
});
