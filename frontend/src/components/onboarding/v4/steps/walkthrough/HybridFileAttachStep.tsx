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
 * the active experiment's Notes-tab attachments folder, AND append a
 * file-chip markdown link to the experiment's notes.md so the user
 * sees a download chip rendered in the editor body. Captures a
 * matching artifact so Phase 4 cleanup wipes it on tour exit.
 *
 * R1 fix-pass (Hybrid fix manager R1, 2026-05-22): the previous
 * version wrote the file to the attachments folder but never mutated
 * the markdown, so HE-11's "non-image files render as download chips"
 * teaching beat had no visible chip in the document body. Now the
 * helper appends `[protocol.txt](Files/protocol.txt)` to notes.md
 * (idempotent — skips when the snippet is already present), so the
 * chip renders inline the next time the editor re-reads.
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
    // Files live under `Files/` inside the notes-tab base; that's the
    // path the editor's file-chip link resolver looks up.
    const targetPath = `${notesBase}/Files/${PROTOCOL_FILENAME}`;
    let needsWrite = true;
    try {
      const exists = await fileService.fileExists(targetPath);
      if (exists) needsWrite = false;
    } catch {
      // probe miss is non-fatal; fall through.
    }

    if (needsWrite) {
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
    }

    // Append the file-chip markdown snippet to notes.md so the user
    // sees the chip render in the editor body. Idempotent: skip when
    // the snippet is already present.
    const notesPath = `${notesBase}/notes.md`;
    let current = "";
    try {
      const f = await fileService.readFileAsBlob(notesPath);
      if (f) current = await f.text();
    } catch {
      current = "";
    }
    const snippet = `[${PROTOCOL_FILENAME}](Files/${PROTOCOL_FILENAME})`;
    if (!current.includes(snippet)) {
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
        // best-effort.
      }
    }

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
      <p>
        Non-image files (CSVs, PDFs, protocol docs) also drag in. The
        editor renders images inline, but everything else becomes a
        download chip, so the next person can grab the file without
        losing the writeup around it.
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
