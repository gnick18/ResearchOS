/**
 * §6.8 lab-only share cluster — 7 step bodies (Gantt redesign 2026-05-22,
 * Gantt manager).
 *
 * Co-located in one file because each step is small and they share the
 * same support helpers (gantt-share-helpers). Splitting into 7 files
 * would make navigating the cluster harder; the registry imports each
 * named export from this module.
 *
 * Cluster shape (per ONBOARDING_V4_GANTT_REDESIGN.md):
 *   1. gantt-share-intro            — narration
 *   2. gantt-share-beakerbot-spawn  — BeakerBot user + coffee experiment
 *   3. gantt-share-beakerbot-shares — share lands on user's Gantt
 *   4. gantt-share-user-explores    — user-action, popup poke (page-lock)
 *   5. gantt-share-user-shares-back — user-action, share chain back (page-lock)
 *   6. gantt-share-profile-switch   — REAL profile switch (or faked fallback)
 *   7. gantt-share-user-sees-edit   — user-action, see BeakerBot's note
 */
import { useEffect, useState } from "react";
import { buildWalkthroughStep, manualAdvance, advanceOnEvent } from "./lib/step-helpers";
import {
  cursorScript,
  safeClickAction,
  compactScript,
} from "./lib/cursor-script";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { useOptionalTourController } from "../../TourController";
import {
  spawnGanttShareBeakerBot,
  shareCoffeeExperimentWithUser,
  SHARE_DEMO_EXPERIMENT_NAME,
} from "./lib/gantt-share-helpers";
import { sharingApi, tasksApi } from "@/lib/local-api";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import { BEAKERBOT_LAB_USERNAME } from "../lab/lib/lab-fake-user";
import { resolveFakeTaskIds } from "./lib/gantt-redesign-helpers";

// =============================================================================
// 1. gantt-share-intro — pure narration
// =============================================================================

export const ganttShareIntroStep = buildWalkthroughStep({
  id: "gantt-share-intro",
  speech: (
    <>
      <p className="mb-2">
        On any experiment you make, you can share it with anyone else in
        your lab.
      </p>
      <p className="mb-2">
        Both people get access to add notes and results. Both see the
        experiment on their Gantt and task lists.
      </p>
      <p>
        Only the creator can delete it. The other person can have
        either edit permission (change dates, add notes) or read-only.
      </p>
    </>
  ),
  pose: "pointing",
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/gantt",
});

// =============================================================================
// 2. gantt-share-beakerbot-spawn — BeakerBot user + coffee experiment
// =============================================================================

export const ganttShareBeakerBotSpawnStep = buildWalkthroughStep({
  id: "gantt-share-beakerbot-spawn",
  speech: (
    <>
      <p className="mb-2">
        For this demo I added a second account to your lab (me,
        BeakerBot), so I have someone to share with. I'll clean up at
        the end.
      </p>
      <p>
        Watch the timeline. My "Make some coffee together" experiment
        will appear in a moment.
      </p>
    </>
  ),
  pose: "cheering",
  onEnter: async (ctx) => {
    if (!ctx.username) {
      console.warn("[gantt-share-beakerbot-spawn] no username; skip spawn");
      return;
    }
    await spawnGanttShareBeakerBot(ctx.username);
  },
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/gantt",
});

// =============================================================================
// 3. gantt-share-beakerbot-shares — share lands on user's Gantt
// =============================================================================

export const ganttShareBeakerBotSharesStep = buildWalkthroughStep({
  id: "gantt-share-beakerbot-shares",
  speech: (
    <>
      <p className="mb-2">
        I just shared "Make some coffee together" with you. See it on
        the timeline?
      </p>
      <p>
        I gave you edit permission, so you can change dates and add
        notes.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.ganttBarSharedExperiment),
  onEnter: async (ctx) => {
    if (!ctx.username) {
      console.warn("[gantt-share-beakerbot-shares] no username; skip share");
      return;
    }
    await shareCoffeeExperimentWithUser(ctx.username);
  },
  cursorScript: cursorScript(async () => {
    const openPopup = await safeClickAction(
      targetSelector(TOUR_TARGETS.ganttBarSharedExperiment),
    );
    return compactScript([openPopup]);
  }),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/gantt",
});

// =============================================================================
// 4. gantt-share-user-explores — user-action, popup poke (page-lock)
// =============================================================================

function ShareExploreSpeech() {
  const controller = useOptionalTourController();
  useEffect(() => {
    if (!controller) return;
    // Allow-list scope: anything inside the task popup. Both Notes +
    // Results tabs are read-only-safe to poke. Gantt fix manager R2:
    // the prior list omitted the Results tab even though the speech
    // bubble invited the user to click it, which tripped the Oops
    // flash on a legitimate path.
    controller.setPageLock(
      [
        TOUR_TARGETS.taskPopupNotesTab,
        TOUR_TARGETS.taskPopupNotesTextarea,
        TOUR_TARGETS.taskPopupClose,
        TOUR_TARGETS.taskPopupEditButton,
        TOUR_TARGETS.taskPopupNameInput,
        TOUR_TARGETS.taskPopupSaveButton,
        TOUR_TARGETS.experimentResultsTab,
      ],
      "Oops, please poke around inside the popup. The rest of the page is locked for now.",
    );
    return () => controller.clearPageLock();
  }, [controller]);
  return (
    <>
      <p className="mb-2">
        This is YOUR view of BeakerBot's experiment. You have edit
        permission, so try adding a note or opening the results tab.
      </p>
      <p className="text-xs text-gray-500">
        It's the same popup as your own experiments. When you're ready,
        click "Got it, next" and I'll take over.
      </p>
    </>
  );
}

export const ganttShareUserExploresStep = buildWalkthroughStep({
  id: "gantt-share-user-explores",
  speech: () => <ShareExploreSpeech />,
  pose: "thinking",
  completion: manualAdvance("Got it, next"),
  // Gantt fix manager R2 (option 1): close BeakerBot's coffee-experiment
  // popup before transitioning. The NEXT step (share-back) is about Fake
  // A, not this shared-to-me experiment — leaving the popup mounted
  // would trip share-back's stage detector (it polls for
  // task-popup-close and flips 1→2 on presence) and the user would be
  // stuck because shared-to-me popups don't render the share button.
  onExit: async () => {
    if (typeof document === "undefined") return;
    const closeBtn = document.querySelector<HTMLElement>(
      '[data-tour-target="task-popup-close"]',
    );
    closeBtn?.click();
  },
  expectedRoute: "/gantt",
});

// =============================================================================
// 5. gantt-share-user-shares-back — user shares own chain back to BeakerBot
// =============================================================================

/** DOM selector for the TaskDetailPopup chrome. Used by `ShareBackSpeech`
 *  to detect when the popup has mounted (the user just clicked Fake A)
 *  vs when the share dialog has mounted (the user just clicked the
 *  share button). Both are distinct surfaces so a presence-check on
 *  each drives the allow-list state machine. */
const TASK_POPUP_DETECT_SELECTOR = '[data-tour-target="task-popup-close"]';
const SHARE_DIALOG_DETECT_SELECTOR = '[data-tour-target="share-dialog"]';

function ShareBackSpeech() {
  const controller = useOptionalTourController();
  // Stage drives the allow-list:
  //   1: timeline — only Fake A's bar is clickable
  //   2: popup    — only the share button (+ close + the bar to re-click)
  //   3: dialog   — share dialog affordances open
  const [stage, setStage] = useState<1 | 2 | 3>(1);

  // Stage transitions: poll the DOM every 350ms for the presence of the
  // popup / share dialog. Cheap and beats wiring a global mount-watcher
  // through the popup component. Once we see the share dialog, we lock
  // into stage 3 (the step's completion poll handles the final advance).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const id = window.setInterval(() => {
      const dialog = document.querySelector(SHARE_DIALOG_DETECT_SELECTOR);
      if (dialog) {
        setStage(3);
        return;
      }
      const popup = document.querySelector(TASK_POPUP_DETECT_SELECTOR);
      if (popup) {
        setStage((cur) => (cur === 1 ? 2 : cur));
      } else {
        // Popup was dismissed — drop back to stage 1 so the user can
        // re-open Fake A if they bailed out by accident.
        setStage((cur) => (cur === 3 ? cur : 1));
      }
    }, 350);
    return () => window.clearInterval(id);
  }, []);

  // Allow-list shifts as the stage progresses. Gantt fix manager R1
  // (P1 #11): the previous static list let the user click ANYTHING in
  // the chain without the lock surfacing "do this next" guidance, and
  // mis-clicks on inactive stages fell through silently. The shifting
  // allow-list also keeps the speech bubble synchronized with the
  // actual current affordance.
  useEffect(() => {
    if (!controller) return;
    const allowByStage: Record<1 | 2 | 3, string[]> = {
      1: [TOUR_TARGETS.ganttBarFakeA],
      2: [
        TOUR_TARGETS.ganttBarFakeA,
        TOUR_TARGETS.taskPopupShareButton,
        TOUR_TARGETS.taskPopupClose,
      ],
      3: [
        TOUR_TARGETS.shareDialog,
        TOUR_TARGETS.shareDialogUserRow,
        TOUR_TARGETS.shareDialogPermissionEdit,
        TOUR_TARGETS.shareDialogConfirm,
        TOUR_TARGETS.taskPopupClose,
      ],
    };
    const flashByStage: Record<1 | 2 | 3, string> = {
      1: "Click the first task in your chain on the timeline.",
      2: "Click the share button on the popup.",
      3: "Pick me (beakerbot) and give me edit permission.",
    };
    controller.setPageLock(allowByStage[stage], flashByStage[stage]);
    return () => controller.clearPageLock();
  }, [controller, stage]);

  return (
    <>
      {stage === 1 ? (
        <p className="mb-2">
          Now share YOUR chain back with me. Click the first task in
          your chain on the timeline.
        </p>
      ) : null}
      {stage === 2 ? (
        <p className="mb-2">Click the share button on the popup.</p>
      ) : null}
      {stage === 3 ? (
        <p className="mb-2">
          Pick me (beakerbot) and give me edit permission.
        </p>
      ) : null}
      <p className="text-xs text-gray-500">
        (I'll keep you on rails. Clicks outside the right affordance
        will be ignored.)
      </p>
    </>
  );
}

export const ganttShareUserSharesBackStep = buildWalkthroughStep({
  id: "gantt-share-user-shares-back",
  speech: () => <ShareBackSpeech />,
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.ganttBarFakeA),
  completion: advanceOnEvent((advance) => {
    // Polling-based completion: detect when Fake A in the user's
    // namespace has BeakerBot in its `shared_with` list with permission
    // === "edit". The current sharing API doesn't dispatch a global
    // event; this poll is the simplest reliable signal.
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const poll = async () => {
      if (cancelled) return;
      try {
        const { fakeAId } = await resolveFakeTaskIds();
        if (!fakeAId) return;
        const task = await tasksApi.get(fakeAId);
        if (!task) return;
        const sharedWith = task.shared_with ?? [];
        const hit = sharedWith.some(
          (s) =>
            (typeof s === "string"
              ? s === BEAKERBOT_LAB_USERNAME
              : s.username === BEAKERBOT_LAB_USERNAME) &&
            (typeof s === "object" ? s.permission === "edit" : true),
        );
        if (hit) {
          cancelled = true;
          if (timer) clearInterval(timer);
          advance();
        }
      } catch (err) {
        console.warn(
          "[gantt-share-user-shares-back] share-poll failed",
          err,
        );
      }
    };

    timer = setInterval(poll, 500);
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }),
  expectedRoute: "/gantt",
});

// =============================================================================
// 6. gantt-share-profile-switch — REAL profile switch (with faked fallback)
// =============================================================================
//
// Re-exported from its own file because the implementation is large
// enough to warrant separation.
export { ganttShareProfileSwitchStep } from "./GanttShareProfileSwitchStep";

// =============================================================================
// 7. gantt-share-user-sees-edit — user-action, see BeakerBot's note
// =============================================================================

function ShareSeesEditSpeech() {
  const controller = useOptionalTourController();
  useEffect(() => {
    if (!controller) return;
    // Gantt fix manager R2 (P0): the note BeakerBot writes during the
    // profile-switch step lands on FAKE A in the user's chain (see
    // appendBeakerBotNote in gantt-share-helpers.ts → resolves
    // fakeAId → appendNoteToTaskNotes(fakeAId, ...)). The previous
    // allow-list pointed at the shared-coffee experiment, so the user
    // couldn't even open the right bar to see the note.
    controller.setPageLock(
      [
        TOUR_TARGETS.taskPopupNotesTab,
        TOUR_TARGETS.taskPopupNotesTextarea,
        TOUR_TARGETS.taskPopupClose,
        TOUR_TARGETS.ganttBarFakeA,
      ],
      "Oops, open the popup and check the notes tab. The rest of the page is locked for now.",
    );
    return () => controller.clearPageLock();
  }, [controller]);
  return (
    <>
      <p className="mb-2">
        Open Fake A on the timeline, then click the notes tab. You
        should see BeakerBot's edit.
      </p>
      <p className="text-xs text-gray-500">
        Take a look around when you're ready, then click "Got it, next".
      </p>
    </>
  );
}

export const ganttShareUserSeesEditStep = buildWalkthroughStep({
  id: "gantt-share-user-sees-edit",
  speech: () => <ShareSeesEditSpeech />,
  pose: "thinking",
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/gantt",
});

// Hoist unused import guard — we import these for type / future use.
void SHARE_DEMO_EXPERIMENT_NAME;
void sharingApi;
void getCurrentUserCached;
