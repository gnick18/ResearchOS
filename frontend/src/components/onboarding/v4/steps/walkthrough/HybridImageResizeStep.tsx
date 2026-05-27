/**
 * §6.7 HE-10 — image resize (USER action, Grant 2026-05-26 conversion).
 *
 * Originally a BeakerBot cursor demo (clicked the image, then 50% in
 * the popover). Grant 2026-05-26: "we can have them try to do it. We
 * can tell them to try to resize the image to fifty percent. And to
 * click on it next when they're ready to move on."
 *
 * Wave 2C speech rewrite (v4 tour speech manager — C, 2026-05-27):
 * applies Grant's BEAKERBOT_TOUR_SCRIPT_REWRITE_2026-05-27.md copy —
 * one tight sentence describing the click-to-resize affordance.
 *
 * Shape: spotlight the embedded image (the one the user just dropped in
 * during HE-9, which is also now user-driven), the speech tells them
 * the resize lives in the pop-up menu when they click the image. Manual
 * advance on "Got it, next" — the user performs the action, then
 * advances when satisfied. No cursorScript.
 *
 * Artifact tracking preserved: a `notes_content` row is captured on
 * step entry so the Phase 4 cleanup grid sees the experiment whose
 * notes were edited during §6.7. Cleanup-execution.ts notes-content
 * is a no-op (the per-keystroke edits aren't reversible), so the
 * artifact exists as a UX-honest record rather than a destructive
 * cleanup target.
 */
import { projectsApi, tasksApi } from "@/lib/local-api";
import { fileService } from "@/lib/file-system/file-service";
import { taskNotesBase } from "@/lib/tasks/results-paths";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { flushPendingArtifacts, pendingArtifactStore } from "./lib/artifacts";

const STEP_ID = "hybrid-image-resize";

export const hybridImageResizeStep = buildWalkthroughStep({
  id: STEP_ID,
  speech: (
    <p>
      You can click any image to resize it directly from the pop-up
      menu.
    </p>
  ),
  pose: "pointing",
  // Spotlight the embedded image so the user knows what to click.
  // Without a cursor demo this is the only visual cue.
  targetSelector: targetSelector(TOUR_TARGETS.hybridEditorEmbeddedImage),
  // No cursorScript: the user performs the click + pick themselves.
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
