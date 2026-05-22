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
import { useEffect } from "react";
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
        I just created my own account in your lab so I can show you how
        this works.
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
    // Allow-list scope: anything inside the task popup. The popup root
    // carries the popup-close attribute among its descendants; we use
    // a generic popup-scope attribute to capture the whole surface.
    controller.setPageLock(
      [
        TOUR_TARGETS.taskPopupNotesTab,
        TOUR_TARGETS.taskPopupNotesTextarea,
        TOUR_TARGETS.taskPopupClose,
        TOUR_TARGETS.taskPopupEditButton,
        TOUR_TARGETS.taskPopupNameInput,
        TOUR_TARGETS.taskPopupSaveButton,
      ],
      "Oops, please poke around inside the popup. The rest of the page is locked for now.",
    );
    return () => controller.clearPageLock();
  }, [controller]);
  return (
    <>
      <p className="mb-2">
        Poke around. Try adding a note or expanding any tab.
      </p>
      <p className="text-xs text-gray-500">
        When you're ready, click "Got it, next" and I'll take over.
      </p>
    </>
  );
}

export const ganttShareUserExploresStep = buildWalkthroughStep({
  id: "gantt-share-user-explores",
  speech: () => <ShareExploreSpeech />,
  pose: "thinking",
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/gantt",
});

// =============================================================================
// 5. gantt-share-user-shares-back — user shares own chain back to BeakerBot
// =============================================================================

function ShareBackSpeech() {
  const controller = useOptionalTourController();
  useEffect(() => {
    if (!controller) return;
    // The page-lock allow-list shifts as the user progresses through
    // the multi-click sequence. First click: Fake A's bar to open the
    // popup. Second: the share button inside the popup. Third: the
    // share dialog's user-row + permission-edit radio + confirm.
    // We start with the broadest set so the user can advance through
    // the natural flow without us micro-managing each click.
    controller.setPageLock(
      [
        TOUR_TARGETS.ganttBarFakeA,
        TOUR_TARGETS.taskPopupShareButton,
        TOUR_TARGETS.shareDialog,
        TOUR_TARGETS.shareDialogUserRow,
        TOUR_TARGETS.shareDialogPermissionEdit,
        TOUR_TARGETS.shareDialogConfirm,
        TOUR_TARGETS.taskPopupClose,
      ],
      "Oops, click the first task in your chain, then the share button, then pick beakerbot.",
    );
    return () => controller.clearPageLock();
  }, [controller]);
  return (
    <>
      <p className="mb-2">
        Now share YOUR chain back with me. Click the first task in your
        chain on the timeline.
      </p>
      <p className="text-xs text-gray-500">
        Then click the share button on the popup, pick beakerbot, and
        give me edit permission.
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
    controller.setPageLock(
      [
        TOUR_TARGETS.taskPopupNotesTab,
        TOUR_TARGETS.taskPopupNotesTextarea,
        TOUR_TARGETS.taskPopupClose,
        TOUR_TARGETS.ganttBarSharedExperiment,
      ],
      "Oops, open the popup and check the notes tab. The rest of the page is locked for now.",
    );
    return () => controller.clearPageLock();
  }, [controller]);
  return (
    <>
      <p className="mb-2">
        Open the notes tab. You should see BeakerBot's edit.
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
