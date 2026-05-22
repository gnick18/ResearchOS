/**
 * §6.7 HE-11 — file attach (BeakerBot demo + narration, terminal beat).
 *
 * Hybrid editor manager 2026-05-22. Closing beat of the §6.7 cluster.
 * BeakerBot explains that files attach the same way as images (drag
 * in) but render as a download link rather than inline.
 *
 * Optional cursor demo: drops a small canned text file
 * (`/onboarding-v4/protocol.txt`) into the editor body. The file
 * renders as a download chip. If the asset fetch fails, the demo
 * gracefully degrades to pure narration; the speech still lands.
 *
 * Asset: `frontend/public/onboarding-v4/protocol.txt` (committed in
 * this chip).
 *
 * Artifact: file attachment with cleanup_default "discard". The
 * artifact-id encodes filename + task location the same way notes_image
 * does.
 *
 * Completion: manual ("Got it, next").
 */
import { projectsApi, tasksApi } from "@/lib/local-api";
import { fileService } from "@/lib/file-system/file-service";
import { taskNotesBase } from "@/lib/tasks/results-paths";
import {
  cursorScript,
  callbackAction,
  safeGlideToElementAction,
  compactScript,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { encodeTelegramImageId } from "../../../v3/steps/walkthrough/lib/wizard-artifacts";
import { flushPendingArtifacts, pendingArtifactStore } from "./lib/artifacts";

const STEP_ID = "hybrid-file-attach";

/** Public URL of the canned protocol text file. Lives at
 *  `frontend/public/onboarding-v4/protocol.txt`. */
export const PROTOCOL_TXT_URL = "/onboarding-v4/protocol.txt";
export const PROTOCOL_FILENAME = "protocol.txt";

/**
 * Best-effort spawn: fetch the canned protocol.txt file, write it to
 * the active experiment's Notes-tab attachments folder, and capture a
 * matching artifact so Phase 4 cleanup wipes it on tour exit.
 *
 * Mirrors `onEnterHybridEditorImageDrop` for shape: skip silently when
 * no project / experiment exists, swallow + log on fetch / write
 * failure so a missing asset doesn't wedge the tour.
 */
async function attachProtocolFile(): Promise<boolean> {
  try {
    const projects = await projectsApi.list();
    if (!projects.length) return false;
    const sorted = [...projects].sort((a, b) => {
      const cmp = (b.created_at ?? "").localeCompare(a.created_at ?? "");
      if (cmp !== 0) return cmp;
      return b.id - a.id;
    });
    const project = sorted[0];
    if (!project) return false;
    const tasks = await tasksApi.listByProject(project.id);
    const experiments = tasks
      .filter((t) => t.task_type === "experiment")
      .sort((a, b) => b.id - a.id);
    const experiment = experiments[0];
    if (!experiment) return false;
    const owner = experiment.owner || "";
    if (!owner) return false;

    const notesBase = taskNotesBase({ id: experiment.id, owner });
    const targetPath = `${notesBase}/${PROTOCOL_FILENAME}`;
    try {
      const exists = await fileService.fileExists(targetPath);
      if (exists) return false;
    } catch {
      // probe miss is non-fatal; fall through.
    }

    const res = await fetch(PROTOCOL_TXT_URL);
    if (!res.ok) {
      console.warn(
        "[onboarding-v4] hybrid-file-attach: protocol fetch %d",
        res.status,
      );
      return false;
    }
    const text = await res.text();
    await fileService.writeText(targetPath, text);

    // Stash the artifact for the step's onExit flush.
    pendingArtifactStore.add(STEP_ID, {
      type: "notes_file",
      id: encodeTelegramImageId(PROTOCOL_FILENAME, { taskId: experiment.id }),
      cleanup_default: "discard",
    });
    return true;
  } catch (err) {
    console.warn("[onboarding-v4] hybrid-file-attach spawn failed", err);
    return false;
  }
}

export const hybridFileAttachStep = buildWalkthroughStep({
  id: STEP_ID,
  speech: (
    <>
      <p className="mb-2">
        Files attach the same way as images, drag them in.
      </p>
      <p className="mb-2">
        But files don&apos;t get rendered inline. Instead they show up
        as a download link, so the next person can grab them.
      </p>
      <p>
        ResearchOS can open <strong>PDFs and text files</strong>{" "}
        directly. Other formats just download to your computer.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.hybridEditorTextarea),
  cursorScript: cursorScript(async () => {
    // Glide to the editor body, then fire the file-attach side effect
    // via a callback action so the order is: cursor glides → the
    // attach happens → the user sees the download chip land.
    const glide = await safeGlideToElementAction(
      targetSelector(TOUR_TARGETS.hybridEditorTextarea),
      3000,
    );
    const drop = callbackAction(async () => {
      await attachProtocolFile();
    });
    return compactScript([glide, drop]);
  }),
  completion: manualAdvance("Got it, next"),
  onExit: async () => {
    await flushPendingArtifacts(STEP_ID);
  },
});
