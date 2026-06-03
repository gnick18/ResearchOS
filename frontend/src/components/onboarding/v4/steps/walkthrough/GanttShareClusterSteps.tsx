/**
 * §6.8 lab-only share cluster step bodies (Gantt redesign 2026-05-22,
 * Gantt manager). Tour simplification pass 4 2026-06-03 (HR /
 * tour-simplification): collapsed 10 to 6. The redundant
 * `gantt-share-beakerbot-shares` popup-open beat was cut (the explore beat
 * already reopens the shared popup in its onEnter), and the 3-beat
 * share-dialog field walk (clicks-share / fills-dialog / saves-dialog) was
 * merged back into the single user-action `gantt-share-user-shares-back`
 * beat, which now owns the share-completion poll plus the
 * ensureBeakerBotUser + spawnGanttRedesignFakeTasks guards. The file now
 * exports 6 step constants (5 here + the re-exported profile-switch).
 *
 * Co-located in one file because each step is small and they share the
 * same support helpers (gantt-share-helpers). Splitting into separate
 * files would make navigating the cluster harder; the registry imports
 * each named export from this module.
 *
 * Cluster shape (per ONBOARDING_V4_GANTT_REDESIGN.md):
 *   1. gantt-share-intro            : narration
 *   2. gantt-share-beakerbot-spawn  : BeakerBot user + coffee experiment + share
 *   3. gantt-share-user-explores    : user-action, popup poke
 *   4. gantt-share-user-shares-back : user-action, share a chain back (poll-gated)
 *   5. gantt-share-profile-switch   : REAL profile switch (or faked fallback)
 *   6. gantt-share-user-sees-edit   : user-action, see BeakerBot's note
 */
import { useEffect } from "react";
import { buildWalkthroughStep, manualAdvance, advanceOnEvent } from "./lib/step-helpers";
import { tourClickWithLockBypass } from "./lib/cursor-script";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { watchExperimentPopupOpenedFor } from "./lib/tour-events";
import { useOptionalTourController } from "../../TourController";
import {
  spawnGanttShareBeakerBot,
  shareCoffeeExperimentWithUser,
  ensureBeakerBotUser,
  appendBeakerBotNote,
  SHARE_DEMO_EXPERIMENT_NAME,
} from "./lib/gantt-share-helpers";
import {
  closeAnyOpenTaskPopup,
  ensureGanttSharePopupOpen,
} from "./lib/on-enter-helpers";
import { sharingApi, tasksApi } from "@/lib/local-api";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import { BEAKERBOT_LAB_USERNAME } from "../lab/lib/lab-fake-user";
import {
  resolveFakeTaskIds,
  spawnGanttRedesignFakeTasks,
} from "./lib/gantt-redesign-helpers";
import { ensureFirstExperimentExists } from "./lib/ensure-helpers";
import { BEAKERBOT_NOTE_TEXT } from "./GanttShareProfileSwitchStep";

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
// 2. gantt-share-beakerbot-spawn — BeakerBot user + coffee experiment + share
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
  // experiment lands, so this step performs BOTH the spawn and the share
  // here (rather than deferring the share to a follow-up beat) so the bar
  // lands during this step's read time. Both helpers are idempotent on
  // names — `spawnGanttShareBeakerBot` reuses an existing experiment if
  // one is found, and `shareCoffeeExperimentWithUser` reuses an existing
  // share — so chaining them here doesn't double-spawn on re-runs.
  //
  // Tour simplification pass 4 2026-06-03 (HR / tour-simplification): the
  // follow-up `gantt-share-beakerbot-shares` beat that used to re-issue
  // the share as a safety net was cut. The next beat
  // (`gantt-share-user-explores`) still calls the share helper in its
  // onEnter (it no-ops idempotently when the share already exists), so the
  // safety net survives.
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
// 3. gantt-share-user-explores — user-action, popup poke (page-lock)
//
// Tour simplification pass 4 2026-06-03 (HR / tour-simplification): the
// prior `gantt-share-beakerbot-shares` beat (which only cursor-clicked the
// already-spawned shared bar to open its popup) was cut. This explore beat
// already reopens the shared popup in its onEnter via
// `ensureGanttSharePopupOpen`, so the popup-open beat was redundant. The
// spawn beat (#2) performs both the spawn and the share, so the shared bar
// is already on the timeline by the time this beat runs.
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
      <p className="text-meta text-gray-500">
        When you're ready, click "Got it, next" and I'll take over.
      </p>
    </>
  );
}

export const ganttShareUserExploresStep = buildWalkthroughStep({
  id: "gantt-share-user-explores",
  speech: () => <ShareExploreSpeech />,
  pose: "thinking",
  // gantt-share-resilience bot 2026-06-03: POPUP GUARD. This step's
  // speech ("this is your view of my shared experiment") assumes the
  // SHARED coffee experiment's TaskDetailPopup is open. Tour simplification
  // pass 4 2026-06-03 cut the prior `gantt-share-beakerbot-shares` beat
  // that used to cursor-click the shared bar open, so this onEnter is now
  // the sole owner of opening that popup (and also covers a mid-cluster
  // refresh that lands here with the popup closed, since portal state is
  // not a route). Re-establish the prerequisite chain (BeakerBot + coffee
  // experiment + the share, all idempotent on name) so the shared bar
  // exists, then open the popup by clicking the `gantt-bar-shared-
  // experiment` bar. On a re-entry where the popup is already mounted the
  // reopen no-ops. Best-effort: a failure degrades to the pre-existing
  // "explore the timeline" read; the manualAdvance still advances.
  onEnter: async (ctx) => {
    if (!ctx.username) return;
    await spawnGanttShareBeakerBot(ctx.username);
    await shareCoffeeExperimentWithUser(ctx.username);
    await ensureGanttSharePopupOpen(TOUR_TARGETS.ganttBarSharedExperiment);
  },
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
// 4. gantt-share-user-shares-back — single USER_ACTION beat (poll-gated)
//
// Tour simplification pass 4 2026-06-03 (HR / tour-simplification): the
// 4-beat share-dialog field walk (this beat + the prior -clicks-share,
// -fills-dialog, -saves-dialog beats) collapsed back into THIS single
// user-action beat. Awareness speech replaces the field-by-field
// hand-holding: the user opens an experiment they own, clicks Share in the
// popup header, picks a labmate, chooses view or edit, and saves. We do
// NOT spotlight each affordance in turn anymore; the user drives the whole
// dialog themselves.
//
// The beat advances on the SAME share-completion poll the prior
// -saves-dialog beat used (Fake A's `shared_with` carries BeakerBot @
// permission "edit"), moved here verbatim. The sharing API does not
// dispatch a global event, so this poll is the simplest reliable final
// signal — and it only trips once Save has actually written the share to
// disk. Advancing on it preserves the downstream dependency: both
// `gantt-share-profile-switch` (which writes BeakerBot's note onto Fake A)
// and `gantt-share-user-sees-edit` require the user to have shared Fake A
// back, and this poll verifies exactly that persisted share.
//
// The onEnter guards from the cut beats are consolidated here so the
// prerequisite chain (Fake A on the user's timeline + the BeakerBot lab
// user in the share dialog's "Pick a user" dropdown) is in place before
// the user shares back, no matter how they reached this beat (canonical
// flow, Settings re-run, or a seed-jump past the spawn cluster). All
// helpers are idempotent on name so the canonical flow no-ops.
//
// The static `pageLock.allowList` (raw data-tour-target names, matched by
// TourPageLock) unions every affordance the user clicks across the whole
// self-driven sequence: Fake A's bar opens the popup, the popup's Share
// button opens the dialog, then the dialog's picker / Add / Save persist
// the share. taskPopupClose stays allowed so closing the popup is never
// flashed. No cursorScript: the user clicks the real affordances.
// =============================================================================

const SHARE_BACK_STEP_ID = "gantt-share-user-shares-back";

export const ganttShareUserSharesBackStep = buildWalkthroughStep({
  id: SHARE_BACK_STEP_ID,
  speech: (
    <>
      <p className="mb-2">
        Sharing goes both ways. Open an experiment you own, click{" "}
        <strong>Share</strong> in the popup header, pick a labmate, choose
        view or edit, and save. Try sharing your chain back to me.
      </p>
      <p className="text-meta text-gray-500">
        (I'll keep you on rails. Clicks outside the share flow will be
        ignored.)
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.ganttBarFakeA),
  // No cursorScript: USER_ACTION beat. The user drives the whole share
  // flow themselves (open Fake A, Share, pick beakerbot, Add, Save).
  //
  // onEnter guards consolidated from the cut -clicks-share / -fills-dialog
  // / -saves-dialog beats:
  //   - closeAnyOpenTaskPopup(): close any stale task popup (e.g. the
  //     coffee experiment from the earlier explore beat) before the
  //     ensure/spawn calls so a leftover popup cannot confuse the share
  //     flow. Safe / idempotent when no popup is open.
  //   - ensureBeakerBotUser(): seed the BeakerBot lab user so it is in the
  //     share dialog's "Pick a user" dropdown even when a Settings re-run
  //     jumped past the spawn beat that normally creates it.
  //   - ensureFirstExperimentExists() + spawnGanttRedesignFakeTasks():
  //     ensure Fake A is on the user's timeline so a seed-jump past the
  //     universal deps cluster does not leave the user staring at an empty
  //     timeline. All idempotent on name; the canonical flow no-ops.
  onEnter: async (ctx) => {
    closeAnyOpenTaskPopup();
    await ensureBeakerBotUser();
    await ensureFirstExperimentExists();
    await spawnGanttRedesignFakeTasks(ctx);
  },
  completion: advanceOnEvent((advance) => {
    // Polling-based completion: detect when Fake A in the user's
    // namespace has BeakerBot in its `shared_with` list with permission
    // === "edit". The current sharing API doesn't dispatch a global
    // event; this poll is the simplest reliable signal. Moved verbatim
    // from the cut -saves-dialog beat (it only fires once Save persists
    // the share to disk).
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
  // Allow-list: the union of every affordance the user clicks across the
  // self-driven share flow. Fake A's bar opens the popup; the popup Share
  // button opens the dialog; the dialog picker / Add / Save persist the
  // share. taskPopupClose stays allowed so closing the popup is not
  // flashed.
  pageLock: {
    allowList: [
      TOUR_TARGETS.ganttBarFakeA,
      TOUR_TARGETS.taskPopupShareButton,
      TOUR_TARGETS.taskPopupClose,
      TOUR_TARGETS.shareDialog,
      TOUR_TARGETS.shareDialogUserRow,
      TOUR_TARGETS.shareDialogAdd,
      TOUR_TARGETS.shareDialogConfirm,
    ],
    pillLabel: "Open an experiment, click Share, pick a labmate, then save.",
  },
  expectedRoute: "/gantt",
});

// =============================================================================
// 5. gantt-share-profile-switch — REAL profile switch (with faked fallback)
// =============================================================================
//
// Re-exported from its own file because the implementation is large
// enough to warrant separation.
export { ganttShareProfileSwitchStep } from "./GanttShareProfileSwitchStep";

// =============================================================================
// 6. gantt-share-user-sees-edit — user-action, see BeakerBot's note
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
      <p className="text-meta text-gray-500">
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
  //
  // gantt-share-resilience bot 2026-06-03: TAIL GRACEFUL RECOVERY. This is
  // the profile-switch tail. The note BeakerBot "writes" lives on Fake A's
  // notes.md / results.md (appendBeakerBotNote, fired during
  // `gantt-share-profile-switch`). On the canonical path that write has
  // already landed before this step. But a mid-cluster refresh that
  // resumes the tour DIRECTLY on this step (or a seed-jump that skipped the
  // profile-switch beat) would leave the promised note absent and the
  // user's "you should see the edit I just made" read into an empty notes
  // tab. Rather than a fragile cross-mount restore of the faked switch, we
  // RE-ESTABLISH what is reconstructable: re-run the idempotent
  // `appendBeakerBotNote` here so the note genuinely exists on disk before
  // the user reopens Fake A. The write skips when the note text is already
  // present (idempotency contract), so the canonical path is a cheap
  // no-op. This step's completion is a bare `manualAdvance` (no
  // disabledUntilEvent), so the user can ALWAYS advance — the tail can
  // never soft-block, even if the note write best-effort-fails.
  onEnter: async (ctx) => {
    if (typeof document !== "undefined") {
      const closeBtn = document.querySelector<HTMLElement>(
        '[data-tour-target="task-popup-close"]',
      );
      if (closeBtn) tourClickWithLockBypass(closeBtn);
    }
    await ensureFirstExperimentExists();
    await spawnGanttRedesignFakeTasks(ctx);
    // Best-effort: re-establish BeakerBot's note so the "see my edit"
    // promise holds on a refresh/seed-jump that landed here without the
    // profile-switch write having run. Idempotent on the note text.
    await appendBeakerBotNote(BEAKERBOT_NOTE_TEXT);
  },
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/gantt",
});

// Hoist unused import guard — we import these for type / future use.
void SHARE_DEMO_EXPERIMENT_NAME;
void sharingApi;
void getCurrentUserCached;
