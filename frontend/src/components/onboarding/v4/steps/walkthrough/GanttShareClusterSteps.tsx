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
import TourSpotlight from "@/components/TourSpotlight";
import { buildWalkthroughStep, manualAdvance, advanceOnEvent } from "./lib/step-helpers";
import {
  cursorScript,
  safeClickAction,
  compactScript,
  tourClickWithLockBypass,
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
import {
  resolveFakeTaskIds,
  spawnGanttRedesignFakeTasks,
} from "./lib/gantt-redesign-helpers";
import { ensureFirstExperimentExists } from "./lib/ensure-helpers";

// =============================================================================
// 1. gantt-share-intro — pure narration
// =============================================================================

export const ganttShareIntroStep = buildWalkthroughStep({
  id: "gantt-share-intro",
  speech: (
    <>
      <p className="mb-2">
        When two people are running an experiment together, both of you
        need to see it on your own timeline and both of you need to be
        able to add notes as the work happens. That's what sharing is
        for.
      </p>
      <p>
        Share an experiment with anyone in your lab and it shows up on
        their Gantt chart alongside yours. You decide whether they can
        just read it or actually edit notes and dates.
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
        For this demo, I added a second account to your lab so I have
        someone to share with.
      </p>
      <p>
        Watch the timeline. My "Make some coffee together" experiment
        will appear in a moment.
      </p>
    </>
  ),
  pose: "cheering",
  // gantt cluster consolidation manager (2026-05-27, Bug #31): the spawn
  // step's speech invites the user to watch the timeline while the
  // experiment lands. The prior implementation spawned the experiment
  // in BeakerBot's namespace here but waited for the NEXT step's
  // onEnter (gantt-share-beakerbot-shares) to issue the share, so the
  // user's Gantt stayed empty during this step's read time. Both
  // helpers are idempotent on names — `spawnGanttShareBeakerBot` reuses
  // an existing experiment if one is found, and
  // `shareCoffeeExperimentWithUser` reuses an existing share — so
  // chaining them here doesn't double-spawn on re-runs. The next step
  // still calls the share helper as a safety net (it no-ops idempotently
  // when the share already exists).
  onEnter: async (ctx) => {
    if (!ctx.username) {
      console.warn("[gantt-share-beakerbot-spawn] no username; skip spawn");
      return;
    }
    // Tour robustification 2026-05-27 (tour robustification manager):
    // ensure the user-experiment + Fake A/B chain is in place BEFORE
    // BeakerBot's share lands. The downstream user-shares-back step
    // requires Fake A on the user's timeline, and on a seed-jump past
    // the universal deps cluster Fake A would be missing. All helpers
    // are idempotent on name; canonical flow no-ops.
    await ensureFirstExperimentExists();
    await spawnGanttRedesignFakeTasks(ctx);
    await spawnGanttShareBeakerBot(ctx.username);
    await shareCoffeeExperimentWithUser(ctx.username);
  },
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/gantt",
});

// =============================================================================
// 3. gantt-share-beakerbot-shares — share lands on user's Gantt
// =============================================================================

export const ganttShareBeakerBotSharesStep = buildWalkthroughStep({
  id: "gantt-share-beakerbot-shares",
  speech:
    "I just shared \"Make some coffee together\" with you. I gave you edit permission, so you can change dates and add notes.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.ganttBarSharedExperiment),
  // gantt cluster consolidation manager (2026-05-27, Bug #31): the spawn
  // step now performs both spawn + share so the experiment lands during
  // the user's read time on the spawn-step speech. This step's onEnter
  // call is a safety net (idempotent share-upsert) for the rare path
  // where the spawn step's share failed (e.g. transient I/O blip), and
  // also re-invalidates the tasks query so the spotlight has a chance
  // to anchor onto the newly-visible bar.
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
  // gantt cluster consolidation manager (2026-05-27, Bug #33): dropped
  // the page-lock for this step. The speech invites "Try adding a note
  // or opening the results tab" — both of which require clicking
  // affordances inside the TaskDetailPopup. The prior allow-list listed
  // the obvious data-tour-target buttons (notes tab, results tab, save,
  // close, edit) but missed the "Save notes" button at the bottom of
  // the Lab Notes tab (which has no data-tour-target attribute, lives
  // inside TaskDetailPopup which is owned by a parallel sweep bot, and
  // therefore can't be stamped from here). Without a target attr on
  // every affordance the user is invited to use, the page-lock
  // surfaces a wrong-click flash on legitimate clicks and confuses
  // the user. The step is purely "explore the shared experiment" with
  // a manualAdvance "Got it, next" gate — no destructive action is
  // possible from inside the popup, so dropping the lock is safe.
  //
  // FLAG: the TaskDetailPopup "Save notes" button (around L3786) needs
  // a `data-tour-target="task-popup-notes-save"` attribute the next
  // time the popup file is touched. If/when that lands, this step
  // could opt back into a tight allow-list.
  return (
    <>
      <p className="mb-2">
        This is your view of my shared experiment. Try adding a note or
        opening the results tab to see how the access works.
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
    // §6.2b R4 fix (2026-05-25): route through tourClickWithLockBypass
    // so the InputLockOverlay's capture-phase blocker (which may be
    // armed for the next step's cursor script by the time onExit
    // fires) doesn't swallow the click.
    if (closeBtn) tourClickWithLockBypass(closeBtn);
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
  // Bug-squad fix bot 2026-05-26 (Bug 3 family): same pattern.
  const setPageLock = controller?.setPageLock;
  const clearPageLock = controller?.clearPageLock;
  useEffect(() => {
    if (!setPageLock || !clearPageLock) return;
    const allowByStage: Record<1 | 2 | 3, string[]> = {
      1: [TOUR_TARGETS.ganttBarFakeA],
      2: [
        TOUR_TARGETS.ganttBarFakeA,
        TOUR_TARGETS.taskPopupShareButton,
        TOUR_TARGETS.taskPopupClose,
      ],
      // Stage 3 allow-list: the share-dialog affordances the user
      // needs to click in sequence. The "Add" button is required
      // because the user MUST move BeakerBot into the share list
      // before Confirm becomes meaningful (the prior list omitted
      // it and the permission radio it referenced wasn't stamped on
      // any product surface, so clicks on Add tripped the wrong-
      // click handler). Walkthrough audit fix manager (2026-05-25).
      3: [
        TOUR_TARGETS.shareDialog,
        TOUR_TARGETS.shareDialogUserRow,
        TOUR_TARGETS.shareDialogAdd,
        TOUR_TARGETS.shareDialogConfirm,
        TOUR_TARGETS.taskPopupClose,
      ],
    };
    const flashByStage: Record<1 | 2 | 3, string> = {
      1: "Click the first task in your chain on the timeline.",
      2: "Click the share button on the popup.",
      3: "Pick me (beakerbot) and give me edit permission.",
    };
    setPageLock(allowByStage[stage], flashByStage[stage]);
    return () => clearPageLock();
  }, [setPageLock, clearPageLock, stage]);

  // gantt cluster consolidation manager (2026-05-27, Bug #34): per-stage
  // spotlight. The previous step had a static `targetSelector` set to
  // Fake A's bar, which left stages 2 + 3 with a stale spotlight floating
  // over the timeline corner while the user was reading "Click the share
  // button on the popup" / "Pick me and give me edit permission". The
  // step config now leaves targetSelector unset; the body renders its
  // own TourSpotlight component pointed at the right surface per stage.
  // When the target attr isn't present yet (popup mid-mount), TourSpotlight
  // silently no-ops via its internal MutationObserver and picks up the
  // anchor the moment it lands.
  const spotlightTarget =
    stage === 1
      ? targetSelector(TOUR_TARGETS.ganttBarFakeA)
      : stage === 2
        ? targetSelector(TOUR_TARGETS.taskPopupShareButton)
        : targetSelector(TOUR_TARGETS.shareDialogUserRow);

  return (
    <>
      <TourSpotlight target={spotlightTarget} />
      {stage === 1 ? (
        <p className="mb-2">
          Now share your chain back with me. Click the first task in
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
  // Tour robustification 2026-05-27 (tour robustification manager):
  // ensure Fake A exists so the user has a bar to click on the
  // timeline. Seed-jump path: a user lands here without the universal
  // deps cluster ever having spawned Fake A/B. Idempotent helpers.
  onEnter: async (ctx) => {
    await ensureFirstExperimentExists();
    await spawnGanttRedesignFakeTasks(ctx);
  },
  // gantt cluster consolidation manager (2026-05-27, Bug #34): no static
  // targetSelector — ShareBackSpeech renders its own per-stage TourSpotlight
  // so the highlight ring tracks stage 1 (timeline bar) → stage 2 (share
  // button in popup) → stage 3 (share dialog user row). A static selector
  // would lock the ring on stage 1's bar and leave the user without a
  // visual cue for the popup + dialog clicks the speech invites.
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
  // Bug-squad fix bot 2026-05-26 (Bug 3 family): same pattern.
  const setPageLock = controller?.setPageLock;
  const clearPageLock = controller?.clearPageLock;
  useEffect(() => {
    if (!setPageLock || !clearPageLock) return;
    // Gantt fix manager R2 (P0): the note BeakerBot writes during the
    // profile-switch step lands on FAKE A in the user's chain (see
    // appendBeakerBotNote in gantt-share-helpers.ts → resolves
    // fakeAId → appendNoteToTaskNotes(fakeAId, ...)). The previous
    // allow-list pointed at the shared-coffee experiment, so the user
    // couldn't even open the right bar to see the note.
    setPageLock(
      [
        TOUR_TARGETS.taskPopupNotesTab,
        TOUR_TARGETS.taskPopupNotesTextarea,
        TOUR_TARGETS.taskPopupClose,
        TOUR_TARGETS.ganttBarFakeA,
      ],
      "Oops, open the popup and check the notes tab. The rest of the page is locked for now.",
    );
    return () => clearPageLock();
  }, [setPageLock, clearPageLock]);
  return (
    <>
      <p className="mb-2">
        Open Fake A on the timeline and check the notes tab. You should
        see the edit I just made.
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
  // Tour robustification 2026-05-27 (tour robustification manager):
  // ensure Fake A exists so the user can open the popup and check the
  // notes tab BeakerBot wrote to. Seed-jump path covered.
  onEnter: async (ctx) => {
    await ensureFirstExperimentExists();
    await spawnGanttRedesignFakeTasks(ctx);
  },
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/gantt",
});

// Hoist unused import guard — we import these for type / future use.
void SHARE_DEMO_EXPERIMENT_NAME;
void sharingApi;
void getCurrentUserCached;
