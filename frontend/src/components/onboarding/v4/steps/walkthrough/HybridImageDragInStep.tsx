/**
 * §6.7 HE-9 — drag the attached image into the editor body (BeakerBot demo).
 *
 * Hybrid editor manager 2026-05-22. Different beat from HE-8: HE-8
 * attached the image to the experiment; HE-9 demonstrates that the
 * same image can be DROPPED inline into a paragraph chunk inside the
 * editor.
 *
 * Cursor: drags from the image strip (the just-attached selfie) into a
 * new paragraph in the editor. The image then renders inline.
 *
 * R1 fix-pass (Hybrid fix manager R1, 2026-05-22): the previous
 * `safeDragAction` path only dispatched `mousedown` / `mouseup` events
 * and never populated `e.dataTransfer`. The hybrid editor's inline
 * image drop handler reads `getData("application/x-research-os-image")`,
 * so the demo landed no markdown snippet. Switched to
 * `safeDragFileAction` which dispatches a real HTML5 `DragEvent` with
 * a synthesised `DataTransfer` carrying the selfie filename. The
 * editor then inserts the `![](Images/<filename>)` snippet inline and
 * renders the image where the cursor dropped. A fallback
 * `callbackAction` writes the snippet directly via `tasksApi.update`
 * if the DragEvent's payload is dropped by the runtime (e.g. older
 * jsdom).
 *
 * Completion: manual ("Got it, next").
 */
import { projectsApi, tasksApi } from "@/lib/local-api";
import { fileService } from "@/lib/file-system/file-service";
import { taskNotesBase } from "@/lib/tasks/results-paths";
import {
  cursorScript,
  safeDragFileAction,
  callbackAction,
  compactScript,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { SELFIE_FILENAME } from "./lib/on-enter-helpers";

/**
 * Best-effort fallback that writes the inline image markdown snippet
 * directly to the experiment's `notes.md` if the DragEvent path didn't
 * land. Runs AFTER the cursor's drag animation, checks whether the
 * snippet is already present (idempotent), and appends a new paragraph
 * containing the inline image reference if absent. Swallows + logs on
 * failure so a missing experiment / fs mock never wedges the step.
 */
async function ensureInlineImageSnippet(): Promise<void> {
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
    const notesPath = `${taskNotesBase({ id: experiment.id, owner })}/notes.md`;
    let current = "";
    try {
      const f = await fileService.readFileAsBlob(notesPath);
      if (f) current = await f.text();
    } catch {
      current = "";
    }
    const snippet = `![](Images/${SELFIE_FILENAME})`;
    if (current.includes(snippet)) return;
    const next =
      current.length === 0
        ? `${snippet}\n`
        : current.endsWith("\n\n")
          ? `${current}${snippet}\n`
          : current.endsWith("\n")
            ? `${current}\n${snippet}\n`
            : `${current}\n\n${snippet}\n`;
    try {
      await fileService.writeText(notesPath, next);
    } catch {
      // best-effort; swallow.
    }
  } catch (err) {
    console.warn(
      "[onboarding-v4] hybrid-image-drag-in fallback snippet failed",
      err,
    );
  }
}

export const hybridImageDragInStep = buildWalkthroughStep({
  id: "hybrid-image-drag-in",
  speech: (
    <>
      <p className="mb-2">
        An attached image can also be dropped inline into the notes, so
        it renders right where you want it in the writeup.
      </p>
      <p>
        Same image, two places it can show: in the attachments panel,
        and inline.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.hybridEditorTextarea),
  cursorScript: cursorScript(async () => {
    // Synthesised dataTransfer payload — the editor's inline drop
    // handler reads `application/x-research-os-image` and parses
    // `{ filename, caption? }` from it. Same JSON shape the live drag
    // source produces when the user drags a thumbnail from the
    // image strip.
    const dragPayload = {
      mimeType: "application/x-research-os-image",
      data: JSON.stringify({ filename: SELFIE_FILENAME, caption: "" }),
    };
    const drag = await safeDragFileAction(
      `${targetSelector(TOUR_TARGETS.hybridEditorImageStrip)} > *:first-child`,
      targetSelector(TOUR_TARGETS.hybridEditorTextarea),
      dragPayload,
    );
    // Fallback: write the snippet directly to notes.md if the
    // DragEvent path didn't land (idempotent — checks for existing
    // snippet before writing). Runs AFTER the cursor's drag animation
    // completes so the user always sees the cursor motion first.
    const fallback = callbackAction(async () => {
      // Tiny delay to let the editor's drop handler finish writing
      // first; the helper is idempotent so a race is fine.
      await new Promise<void>((r) => setTimeout(r, 150));
      await ensureInlineImageSnippet();
    });
    return compactScript([drag, fallback]);
  }),
  completion: manualAdvance("Got it, next"),
});
