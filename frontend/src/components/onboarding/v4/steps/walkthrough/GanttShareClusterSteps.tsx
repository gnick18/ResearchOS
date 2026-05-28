/**
 * §6.8 lab-only share cluster step bodies (Gantt redesign 2026-05-22,
 * Gantt manager). The single share-back step was split into a 3-beat
 * USER_ACTION cluster on 2026-05-28 (share-back user-action manager), then
 * the dialog beat was itself split into Add + Save beats on 2026-05-28
 * (share-dialog manager), so the file now exports 10 step constants.
 *
 * Co-located in one file because each step is small and they share the
 * same support helpers (gantt-share-helpers). Splitting into separate
 * files would make navigating the cluster harder; the registry imports
 * each named export from this module.
 *
 * Cluster shape (per ONBOARDING_V4_GANTT_REDESIGN.md):
 *   1.  gantt-share-intro            : narration
 *   2.  gantt-share-beakerbot-spawn  : BeakerBot user + coffee experiment
 *   3.  gantt-share-beakerbot-shares : share lands on user's Gantt
 *   4.  gantt-share-user-explores    : user-action, popup poke
 *   5a. gantt-share-user-shares-back : user-action, click Fake A to open
 *   5b. gantt-share-user-clicks-share: user-action, click Share on popup
 *   5c. gantt-share-user-fills-dialog: user-action, pick beakerbot + edit, Add
 *   5d. gantt-share-user-saves-dialog: user-action, click Save to persist
 *   6.  gantt-share-profile-switch   : REAL profile switch (or faked fallback)
 *   7.  gantt-share-user-sees-edit   : user-action, see BeakerBot's note
 */
import { useEffect } from "react";
import { buildWalkthroughStep, manualAdvance, advanceOnEvent } from "./lib/step-helpers";
import {
  cursorScript,
  safeClickAction,
  compactScript,
  tourClickWithLockBypass,
} from "./lib/cursor-script";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import {
  watchExperimentPopupOpenedFor,
  watchShareDialogOpened,
  watchShareUserAdded,
} from "./lib/tour-events";
import { useOptionalTourController } from "../../TourController";
import {
  spawnGanttShareBeakerBot,
  shareCoffeeExperimentWithUser,
  ensureBeakerBotUser,
  SHARE_DEMO_EXPERIMENT_NAME,
} from "./lib/gantt-share-helpers";
import { closeAnyOpenTaskPopup } from "./lib/on-enter-helpers";
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
// 5. gantt-share-user-shares-back CLUSTER (3 USER_ACTION beats)
//    (share-back user-action manager 2026-05-28 refactor).
//
// Replaces the prior BeakerBot cursor demo (glide to Fake A, dispatch
// tour:open-task-popup, deferred-click the share button) plus its
// stage-machine page-lock and DOM-poll stage detector with a three-beat
// user-driven sequence, mirroring the §6.5 experiment-create refactor
// (WorkbenchCreateExperimentOpenStep.tsx, commit 5bae5c8d):
//
//   5a. gantt-share-user-shares-back (id PRESERVED for migration)
//       Spotlight Fake A's Gantt bar. Speech tells the user to click it.
//       Advance on `tour:experiment-popup-opened` when the popup mounts.
//
//   5b. gantt-share-user-clicks-share (NEW)
//       Spotlight the Share button in the popup header. User clicks it.
//       Advance on `tour:share-dialog-opened` when the dialog mounts.
//
//   5c. gantt-share-user-fills-dialog (NEW)
//       Spotlight the "Pick a user" dropdown. Speech guides "pick
//       beakerbot, leave permission on edit, click Add." Advance on
//       `tour:share-user-added` (filtered to beakerbot) when the user is
//       added to the in-dialog list (the Add button is local state only).
//
//   5d. gantt-share-user-saves-dialog (NEW, share-dialog manager 2026-05-28)
//       Spotlight the Save button. Speech guides "click Save to persist
//       and head back to the Gantt." Advance on the share-completion poll
//       (Fake A's shared_with carries BeakerBot @ permission "edit"),
//       moved verbatim from the prior fills-dialog completion. Save is
//       the button that actually writes the share to disk.
//
// Why this refactor (Grant 2026-05-28): the cursor demo kept regressing.
// The synthetic bar click did not reliably fire the bar's React onClick,
// so the popup often stayed closed; the cascade step moves Fake A so the
// build-time bar rect went stale and the cursor aimed at the wrong bar;
// and the deferred share-button click depended on popup-mount timing.
// Flipping to USER_ACTION eliminates that whole brittle path: the user
// clicks the spotlighted real affordances and each beat advances on a
// real DOM signal.
//
// Each beat declares a static `pageLock.allowList` (raw data-tour-target
// names, matched by TourPageLock) instead of the old controller-driven
// shifting stage machine. The lists stay loose enough to cover the
// brief mount windows (e.g. beat 5a keeps Fake A's bar allowed, beat 5b
// keeps Fake A harmless so a re-click after an accidental popup close is
// not flashed). No cursorScript on any beat.
// =============================================================================

const SHARE_BACK_OPEN_STEP_ID = "gantt-share-user-shares-back";
const SHARE_BACK_CLICK_SHARE_STEP_ID = "gantt-share-user-clicks-share";
const SHARE_BACK_FILL_DIALOG_STEP_ID = "gantt-share-user-fills-dialog";
const SHARE_BACK_SAVE_DIALOG_STEP_ID = "gantt-share-user-saves-dialog";

/** Beat 5a (id PRESERVED): spotlight Fake A's Gantt bar. The user clicks
 *  it to open the TaskDetailPopup; `TaskDetailPopup` dispatches
 *  `tour:experiment-popup-opened` on mount, which advances this beat.
 *
 *  onEnter ensures the prerequisite chain is in place (Fake A on the
 *  user's timeline) so a seed-jump past the universal deps cluster does
 *  not leave the user staring at an empty timeline. Both helpers are
 *  idempotent on name so the canonical flow no-ops. */
export const ganttShareUserSharesBackStep = buildWalkthroughStep({
  id: SHARE_BACK_OPEN_STEP_ID,
  speech: (
    <>
      <p className="mb-2">
        Now share your chain back with me. Click{" "}
        <strong>Fake experiment A</strong> on the timeline to open it.
      </p>
      <p className="text-xs text-gray-500">
        (I'll keep you on rails. Clicks outside the highlighted bar will
        be ignored.)
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.ganttBarFakeA),
  // No cursorScript: USER_ACTION beat. The user clicks the spotlighted
  // Fake A bar themselves.
  onEnter: async (ctx) => {
    // gantt-share-robust manager (BUG A): close any stale task popup
    // BEFORE the ensure/spawn calls so a leftover / re-mounted popup
    // (e.g. the coffee experiment from the earlier explore beat) cannot
    // fire `tour:experiment-popup-opened` and auto-advance this beat to
    // 5b before the user has clicked Fake A. Safe / idempotent when no
    // popup is open.
    closeAnyOpenTaskPopup();
    // gantt-share-robust manager (BUG B): seed the BeakerBot lab user so
    // it is in the share dialog's "Pick a user" dropdown even when a
    // Settings re-run jumped past the spawn beat that normally creates
    // it. Idempotent; canonical flow no-ops.
    await ensureBeakerBotUser();
    await ensureFirstExperimentExists();
    await spawnGanttRedesignFakeTasks(ctx);
  },
  // gantt-share-robust manager (BUG A): filter the popup-opened event to
  // Fake A's id so ONLY the user opening Fake A advances this beat. The
  // bare `watchExperimentPopupOpened` advanced on ANY popup-open event,
  // so a stale popup left the user stranded on 5b ("click Share") with no
  // popup open. The popup stays open after it fires, so the async resolve
  // in the handler is harmless.
  completion: advanceOnEvent((advance) =>
    watchExperimentPopupOpenedFor((detail) => {
      void (async () => {
        const { fakeAId } = await resolveFakeTaskIds();
        if (fakeAId != null && detail?.experimentId === fakeAId) advance();
      })();
    }),
  ),
  // Allow-list: Fake A's bar (the click that opens the popup). The
  // popup share button is included so a fast user who reaches for Share
  // before the experimentPopupOpened event has advanced this beat (the
  // event + the next beat's lock arming have a sub-frame gap) does not
  // trip the wrong-click flash on a legitimate click.
  pageLock: {
    allowList: [
      TOUR_TARGETS.ganttBarFakeA,
      TOUR_TARGETS.taskPopupShareButton,
      TOUR_TARGETS.taskPopupClose,
    ],
    pillLabel: "Click Fake experiment A on the timeline to open it.",
  },
  expectedRoute: "/gantt",
});

/** Beat 5b (NEW): spotlight the Share button in the popup header. The
 *  button renders only for owned, non-shared tasks (Fake A is
 *  user-owned, so it is present). When the user clicks it, the
 *  ShareDialog opens and dispatches `tour:share-dialog-opened`, which
 *  advances this beat. */
export const ganttShareUserClicksShareStep = buildWalkthroughStep({
  id: SHARE_BACK_CLICK_SHARE_STEP_ID,
  speech: (
    <>
      <p className="mb-2">
        Now click the <strong>Share</strong> button up top.
      </p>
      <p className="text-xs text-gray-500">
        (It is the little share icon in the popup header.)
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.taskPopupShareButton),
  // No cursorScript: USER_ACTION beat. The user clicks Share themselves.
  completion: advanceOnEvent(watchShareDialogOpened),
  // Allow-list: the share button (the click that opens the dialog).
  // Fake A's bar stays allowed (harmless once the popup is up) so a user
  // who accidentally closed the popup can re-open it without a flash;
  // the share dialog affordances are pre-allowed to cover the sub-frame
  // window before the next beat's lock arms.
  pageLock: {
    allowList: [
      TOUR_TARGETS.taskPopupShareButton,
      TOUR_TARGETS.ganttBarFakeA,
      TOUR_TARGETS.taskPopupClose,
      TOUR_TARGETS.shareDialog,
      TOUR_TARGETS.shareDialogUserRow,
      TOUR_TARGETS.shareDialogAdd,
      TOUR_TARGETS.shareDialogConfirm,
    ],
    pillLabel: "Click the Share button in the popup header.",
  },
  expectedRoute: "/gantt",
});

/** Beat 5c (REWORKED, share-dialog manager 2026-05-28): spotlight the
 *  "Pick a user" dropdown (not the whole dialog). Speech guides the user
 *  to pick BeakerBot, leave the permission on Edit, and click Add. The
 *  Add button only mutates the dialog's local "Currently shared with"
 *  list (it does NOT persist), so the prior disk-poll completion could
 *  not fire here. This beat now advances on `tour:share-user-added`
 *  (dispatched by ShareDialog.handleAdd), filtered to beakerbot. The
 *  follow-up 5d beat guides the Save that actually writes to disk and
 *  owns the disk-poll (moved there verbatim). */
export const ganttShareUserFillsDialogStep = buildWalkthroughStep({
  id: SHARE_BACK_FILL_DIALOG_STEP_ID,
  speech: (
    <>
      <p className="mb-2">
        Your turn. Pick me (<strong>beakerbot</strong>) from the dropdown,
        leave the permission on <strong>Edit</strong>, and click{" "}
        <strong>Add</strong>.
      </p>
      <p className="text-xs text-gray-500">
        Adding me puts me on the share list. We will save it next.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.shareDialogUserRow),
  // gantt-share-robust manager (BUG B): seed the BeakerBot lab user here
  // too so it is in the "Pick a user" dropdown no matter how the user
  // reached the share-back sequence (canonical flow, Settings re-run, or
  // skip). Idempotent; canonical flow no-ops.
  onEnter: async () => {
    await ensureBeakerBotUser();
  },
  // No cursorScript: USER_ACTION beat. The user drives the dialog.
  completion: advanceOnEvent((advance) =>
    watchShareUserAdded((detail) => {
      if (detail?.username === BEAKERBOT_LAB_USERNAME) advance();
    }),
  ),
  // Allow-list: the share dialog affordances the user clicks in
  // sequence. shareDialogConfirm (Save) stays allowed so a fast user who
  // reaches for Save before this beat advances on the Add event does not
  // trip the wrong-click flash; taskPopupClose stays allowed so closing
  // the underlying popup is not flashed.
  pageLock: {
    allowList: [
      TOUR_TARGETS.shareDialog,
      TOUR_TARGETS.shareDialogUserRow,
      TOUR_TARGETS.shareDialogAdd,
      TOUR_TARGETS.shareDialogConfirm,
      TOUR_TARGETS.taskPopupClose,
    ],
    pillLabel: "Pick beakerbot, leave it on Edit, then click Add.",
  },
  expectedRoute: "/gantt",
});

/** Beat 5d (NEW, share-dialog manager 2026-05-28): spotlight the Save
 *  button. After 5c's Add put BeakerBot on the in-dialog list, this beat
 *  guides the user to click Save, which persists the share to disk and
 *  closes the dialog. Completion is the share-completion poll moved
 *  verbatim from the prior fills-dialog beat: it detects when Fake A in
 *  the user's namespace has BeakerBot in its `shared_with` list with
 *  permission === "edit". The sharing API does not dispatch a global
 *  event, so this poll is the simplest reliable final signal — and it
 *  only trips once Save has actually written the share. */
export const ganttShareUserSavesDialogStep = buildWalkthroughStep({
  id: SHARE_BACK_SAVE_DIALOG_STEP_ID,
  speech: (
    <>
      <p className="mb-2">
        Nice, you added me with edit access. Now click <strong>Save</strong>{" "}
        to share it and head back to the Gantt.
      </p>
      <p className="text-xs text-gray-500">
        Save writes the share and closes the dialog.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.shareDialogConfirm),
  // No cursorScript: USER_ACTION beat. The user clicks Save themselves.
  completion: advanceOnEvent((advance) => {
    // Polling-based completion: detect when Fake A in the user's
    // namespace has BeakerBot in its `shared_with` list with permission
    // === "edit". The current sharing API doesn't dispatch a global
    // event; this poll is the simplest reliable signal. Moved verbatim
    // from the prior fills-dialog beat (it only fires once Save persists).
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
          "[gantt-share-user-saves-dialog] share-poll failed",
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
  // Allow-list: the share dialog affordances the user clicks. Save
  // (shareDialogConfirm) is the action; the picker + Add stay allowed so
  // a user who needs to re-add beakerbot before saving is not flashed;
  // taskPopupClose stays allowed so closing the underlying popup after
  // the share lands is not flashed.
  pageLock: {
    allowList: [
      TOUR_TARGETS.shareDialog,
      TOUR_TARGETS.shareDialogConfirm,
      TOUR_TARGETS.shareDialogUserRow,
      TOUR_TARGETS.shareDialogAdd,
      TOUR_TARGETS.taskPopupClose,
    ],
    pillLabel: "Click Save to share and return to the Gantt.",
  },
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
  //
  // gantt-share fix manager (BUG 1): close any task-detail popup that is
  // STILL OPEN from the share-back cluster before this step's speech
  // shows. Fake A's popup stays mounted from `gantt-share-user-shares-back`
  // (the Share dialog renders INSIDE it) all the way through the
  // profile-switch step. Its LabNotesTab loaded notes.md ONCE on mount,
  // back when the file did not yet exist (scaffold-in-state, nothing on
  // disk). BeakerBot's note is written to disk during profile-switch, but
  // the tab's load effect is keyed on [task.id, task.owner, ...] which do
  // not change on a query refetch, so the open tab never re-reads and the
  // user keeps seeing the empty scaffold. The write path and read path
  // already agree (users/<owner>/results/task-<id>/notes.md); the failure
  // was a stale in-memory read. Forcing the popup closed here means the
  // speech's "Open Fake A on the timeline" makes the user re-open it,
  // which freshly mounts LabNotesTab and reads the just-written note off
  // disk. Idempotent / safe when nothing is open (querySelector returns
  // null). Routed through tourClickWithLockBypass so the InputLockOverlay
  // capture-phase blocker does not swallow the X.
  onEnter: async (ctx) => {
    if (typeof document !== "undefined") {
      const closeBtn = document.querySelector<HTMLElement>(
        '[data-tour-target="task-popup-close"]',
      );
      if (closeBtn) tourClickWithLockBypass(closeBtn);
    }
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
