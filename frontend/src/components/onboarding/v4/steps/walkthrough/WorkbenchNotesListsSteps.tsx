"use client";

/**
 * §6.7b Workbench Notes + Lists expansion (Workbench expansion manager
 * 2026-05-22; collapsed to 5 beats by Workbench fix manager R1
 * 2026-05-22; speech rewritten Wave 2C 2026-05-27 by v4 tour speech
 * manager — C per Grant's BEAKERBOT_TOUR_SCRIPT_REWRITE_2026-05-27.md).
 *
 * Five new tour steps that sit between §6.7 hybrid editor (last step
 * `hybrid-file-attach`) and §6.8 Gantt (first step `gantt-intro`).
 * Teaches the standalone Notes panel + the Lists panel on the
 * Workbench page. All steps are universal (no `conditionalOn`); all are
 * BeakerBot demo with manual advance ("Got it, next").
 *
 * Step order (matches TOUR_STEP_ORDER insertion):
 *   1. workbench-notes-intro       — cursor clicks Notes tab, narrate
 *   2. workbench-notes-create      — cursor demo creates a standalone
 *                                    note via notesApi (lab-recipe body).
 *                                    Visible click on +New Note for the
 *                                    BeakerBot-caused beat (R1 fix).
 *   3. workbench-lists-intro       — cursor clicks Lists tab, narrate
 *   4. workbench-list-create-shell — combined beat: cursor ensures the
 *                                    Lists tab is active, clicks +New
 *                                    List Task (opens TaskModal), picks
 *                                    the user's first project, types
 *                                    the list name + each of the three
 *                                    items into the modal's list-mode
 *                                    body, then clicks Create List. The
 *                                    prior `workbench-list-add-items`
 *                                    beat was folded into this one (R1
 *                                    pacing fix) to drop a no-teaching
 *                                    "Got it, next" click. Rewritten
 *                                    2026-05-27 (workbench-list create-
 *                                    shell fix manager) to drive the
 *                                    TaskModal end-to-end: the prior
 *                                    shape spawned the list via
 *                                    tasksApi.create after clicking
 *                                    +New, but +New now opens TaskModal
 *                                    and the modal hides the workbench
 *                                    panel, so the in-card cursor steps
 *                                    timed out and the demo stalled.
 *   5. workbench-list-mark-done    — cursor checks one sub-task, then
 *                                    clicks the parent task's mark-
 *                                    complete button
 *
 * Artifacts (auto-cleanup picks these up by type):
 *   - note          (id = noteId)         cleanup_default: "discard"
 *   - task (list)   (id = taskId)         cleanup_default: "discard"
 *
 * cleanup_default flags are retained for back-compat with the legacy
 * Phase 4 grid; the in-flight auto-cleanup sub-bot (aae25600) ignores
 * the flag and wipes everything except the user's first project.
 *
 * Why a single file: the five steps share helpers (today date format,
 * default item names, the "find latest note / list" probe used by
 * onExit). Splitting them across five files would scatter the same
 * skeleton.
 *
 * Coordination:
 *   - Auto-cleanup sub-bot in flight at aae25600 — owns Phase 4
 *     replacement. We only use the standard appendArtifact path.
 *   - Demo-content sub-bots a45006605319ef86a + a291d91a9f82518d9 in
 *     flight — touch demo-data fixtures, not /workbench page UI.
 *   - The Workbench page tabs ALREADY ship: tab buttons live on
 *     `workbench/page.tsx`; we stamp them with data-tour-target via
 *     the same chip. The Notes panel + Lists panel were already
 *     mounted before this chip; we just stamp their create buttons.
 */
import { notesApi, projectsApi, tasksApi } from "@/lib/local-api";
import {
  cursorScript,
  callbackAction,
  compactScript,
  safeClickAction,
  safeChangeSelectAction,
  safeTypeAction,
  safeGlideToElementAction,
  deferredClickAction,
  waitForElement,
  setNativeFieldValue,
  tourClickWithLockBypass,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { targetSelector, TOUR_TARGETS } from "./lib/targets";
import { flushPendingArtifacts, pendingArtifactStore } from "./lib/artifacts";

// ---------------------------------------------------------------------------
// Sample content (Grant 2026-05-22 spec values, lab-recipe note style)
// ---------------------------------------------------------------------------

/** Today's date in `YYYY-MM-DD` (local tz, mirrors the
 *  `WorkbenchListsPanel` convention). Re-resolved per step entry so a
 *  back-step + forward-step that crosses midnight gets the new date. */
function todayIso(): string {
  return new Date().toLocaleDateString("en-CA");
}

/** Single-note demo content (Grant 2026-05-22 R2 spec). Conference-talk
 *  notes in lab-recipe markdown style: key claim, takeaways with
 *  reagent / time-point specifics, follow-ups. NOT prose paragraphs. */
export const NOTE_TITLE = "Notes from ASBMB 2026, Smith lab heat-shock talk";
/** Retained title prefix for back-compat with the idempotent-spawn probe
 *  (`findPriorNotesCreateNoteId`). The probe looks for ANY note whose
 *  title startsWith this string; the full demo title above does. */
export const NOTE_TITLE_PREFIX = "Notes from ASBMB 2026";
export const NOTE_BODY_LAB_RECIPE = `# Key claim
Heat-shock factor binding cooperatively drives the bistability we see in our GAL1 reporter.

## Takeaways
- **HSF1** is the limiting factor, not the chromatin context
- ChIP-seq at 1, 5, 30 min post-induction
- Use *short* induction windows for kinetic measurements

## Follow-ups
- Email Smith about their HSF1-tagged strain
- Check if our GAL1::flbA strain shows the same bistability signature`;

/** List task name + 3 items (per spec). Coffee theme continued from
 *  §6.14 Purchases demo so the user reads the two clusters as part of
 *  the same demo story. */
export const LIST_NAME = "Coffee restock, grocery run";
export const LIST_ITEM_BEANS = "Get more coffee beans";
export const LIST_ITEM_FILTERS = "Filter papers";
export const LIST_ITEM_GRINDER = "Find a better grinder";

// Step ids — module-level so the tests can import without hard-coding strings.
export const NOTES_INTRO_STEP_ID = "workbench-notes-intro";
export const NOTES_CREATE_STEP_ID = "workbench-notes-create";
export const LISTS_INTRO_STEP_ID = "workbench-lists-intro";
export const LIST_CREATE_SHELL_STEP_ID = "workbench-list-create-shell";
export const LIST_MARK_DONE_STEP_ID = "workbench-list-mark-done";

// ---------------------------------------------------------------------------
// 1. workbench-notes-intro — narration, cursor clicks Notes tab
// ---------------------------------------------------------------------------

export const workbenchNotesIntroStep = buildWalkthroughStep({
  id: NOTES_INTRO_STEP_ID,
  speech: (
    // Wave 2C speech rewrite (v4 tour speech manager — C, 2026-05-27):
    // applies Grant's new script copy. Frames the Notes tab via the
    // "not everything you write belongs to a specific experiment" lead,
    // then introduces Single Notes vs Running Logs with conference
    // examples. Replaces the prior PI 1-on-1 framing.
    <>
      <p className="mb-2">
        Not everything you write down belongs to a specific experiment.
        Conference takeaways, meeting notes, a paper you want to
        remember. The middle <strong>Notes</strong> tab in your
        Workbench is for that. Click it now.
      </p>
      <p>
        Two flavors live here. <strong>Single Notes</strong> are
        one-offs: a meeting, a paper summary, a stray idea.{" "}
        <strong>Running Logs</strong> are for things that grow over
        time. One log per conference, one entry per talk, everything in
        one file instead of scattered across ten notes.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchNotesTab),
  cursorScript: cursorScript(async () => {
    const click = await safeClickAction(
      targetSelector(TOUR_TARGETS.workbenchNotesTab),
      3000,
    );
    return compactScript([click]);
  }),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/workbench",
});

// ---------------------------------------------------------------------------
// 2. workbench-notes-create — BeakerBot demo: create a standalone note
// ---------------------------------------------------------------------------

/**
 * Idempotent: list existing notes, look for a previously-spawned
 * shell title. Returns the prior note's id when present, null when
 * absent. A back-step + forward-step into this step therefore reuses
 * the same note rather than creating doubles.
 */
async function findPriorNotesCreateNoteId(): Promise<number | null> {
  try {
    const notes = await notesApi.list();
    for (const n of notes) {
      if (n.title.startsWith(NOTE_TITLE_PREFIX)) return n.id;
    }
  } catch {
    // best-effort probe
  }
  return null;
}

/**
 * Programmatic spawn of the standalone note. Idempotency: if a prior
 * note created by this step already exists, just update its title +
 * body (cheap) and return its id. Otherwise create a fresh note.
 *
 * The note carries a single entry — `notesApi.create` accepts an
 * entries array; passing the lab-recipe body there means the note
 * card renders the body content directly without an extra round-trip.
 */
async function spawnDemoNote(): Promise<number | null> {
  const today = todayIso();
  const title = NOTE_TITLE;
  const existingId = await findPriorNotesCreateNoteId();
  try {
    if (existingId !== null) {
      await notesApi.update(existingId, {
        title,
        description: NOTE_BODY_LAB_RECIPE,
      });
      return existingId;
    }
    const created = await notesApi.create({
      title,
      description: NOTE_BODY_LAB_RECIPE,
      is_running_log: false,
      is_shared: false,
      entries: [
        {
          title: "Note",
          date: today,
          content: NOTE_BODY_LAB_RECIPE,
        },
      ],
    });
    return created.id;
  } catch (err) {
    console.warn("[onboarding-v4] workbench-notes-create spawn failed", err);
    return null;
  }
}

export const workbenchNotesCreateStep = buildWalkthroughStep({
  id: NOTES_CREATE_STEP_ID,
  speech: (
    // Wave 2C speech rewrite (v4 tour speech manager — C, 2026-05-27):
    // applies Grant's tight one-sentence framing for the materialised
    // conference note + same-editor callback.
    <p>
      Here is an example of a single note for conference takeaways. It
      uses the exact same text editor you just learned.
    </p>
  ),
  pose: "typing-on-laptop",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchNewNoteButton),
  cursorScript: cursorScript(async () => {
    // Workbench fix manager R1 2026-05-22 (Verify-A P1-4): the previous
    // script glided to the +New Note button and then spawned the note
    // via API. The user saw the cursor park on the button without
    // clicking. Add a visible click between the glide and the spawn so
    // BeakerBot's "I'll make a single note" reads as a caused action.
    // The underlying note creation is still the programmatic spawn
    // (faster + more reliable than driving NoteDetailPopup's form).
    const glide = await safeGlideToElementAction(
      targetSelector(TOUR_TARGETS.workbenchNewNoteButton),
      3000,
    );
    const fakeClick = await safeClickAction(
      targetSelector(TOUR_TARGETS.workbenchNewNoteButton),
      1500,
    );
    const spawn = callbackAction(async () => {
      const id = await spawnDemoNote();
      if (id !== null) {
        pendingArtifactStore.add(NOTES_CREATE_STEP_ID, {
          type: "note",
          id: String(id),
          cleanup_default: "discard",
        });
      }
    });
    return compactScript([glide, fakeClick, spawn]);
  }),
  completion: manualAdvance("Got it, next"),
  onExit: async () => {
    await flushPendingArtifacts(NOTES_CREATE_STEP_ID);
  },
  expectedRoute: "/workbench",
});

// ---------------------------------------------------------------------------
// 3. workbench-lists-intro — narration, cursor clicks Lists tab
// ---------------------------------------------------------------------------

export const workbenchListsIntroStep = buildWalkthroughStep({
  id: LISTS_INTRO_STEP_ID,
  speech: (
    // Wave 2C speech rewrite (v4 tour speech manager — C, 2026-05-27):
    // applies Grant's new script lead. Frames a list as a "lightweight
    // task with a checklist inside", with reagent-restock /
    // errands-before-deadline / conference-prep examples.
    <>
      <p className="mb-2">
        Last tab on the Workbench is <strong>Lists</strong>.
      </p>
      <p className="mb-2">
        A list is a lightweight task with a checklist inside. Reach for
        one when the work is just &quot;do these things and check them
        off&quot;: a reagent restock, errands before a deadline, items
        to bring to a conference.
      </p>
      <p>No protocol, no results section. Just a name and a set of boxes to tick.</p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchListsTab),
  cursorScript: cursorScript(async () => {
    const click = await safeClickAction(
      targetSelector(TOUR_TARGETS.workbenchListsTab),
      3000,
    );
    return compactScript([click]);
  }),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/workbench",
});

// ---------------------------------------------------------------------------
// 4. workbench-list-create-shell — combined BeakerBot demo: open the
//    TaskModal via +New List Task, fill the name + three items in the
//    modal's list-mode body, then Create List to close the modal and
//    drop the new card into the Lists panel.
//
//    History: the prior shape clicked +New List, then spawned the list
//    via tasksApi.create and typed items into the in-card inline
//    ExpandableListCard add-input. That broke when +New List was
//    re-wired through TaskModal (Workbench fix manager 2026-05-26?):
//    the modal opens in front of the workbench panel and hides the
//    list card, so the cursor's glide-to-card step timed out and the
//    demo stalled mid-speech (workbench-list create-shell fix manager
//    hand-walk, 2026-05-27). The fix below drives the modal end-to-end
//    via cursor, matching the §6.5 experiment-create pattern.
// ---------------------------------------------------------------------------

/**
 * Resolve the project id the demo list should land in. Picks the
 * most-recently-created own (non-shared) non-Miscellaneous project.
 * Returns `null` if no qualifying project exists so the cursor leaves
 * the dropdown on its TaskModal default.
 *
 * Mirrors `WorkbenchCreateExperimentOpenStep.resolveFirstProjectId`
 * (kept as a sibling helper rather than imported to keep the §6.7b
 * step file self-contained — the two flows happen on the same page
 * and use the same logic, but cross-imports between step bodies make
 * the dependency graph harder to read).
 */
async function resolveFirstProjectId(): Promise<number | null> {
  try {
    const projects = await projectsApi.list();
    const eligible = projects.filter(
      (p) =>
        !p.is_archived &&
        !p.is_shared_with_me &&
        p.name !== "Miscellaneous",
    );
    if (eligible.length === 0) return null;
    eligible.sort((a, b) => b.id - a.id);
    return eligible[0].id;
  } catch {
    return null;
  }
}

/** Look up the demo list task (by name) once the modal has closed +
 *  the tasksApi.create has resolved. Used to register the cleanup
 *  artifact without listening for a tour event (TaskModal only
 *  dispatches `tour:experiment-created` for the experiment branch). */
async function findDemoListTaskId(): Promise<number | null> {
  try {
    const projects = await projectsApi.list();
    for (const p of projects) {
      const tasks = await tasksApi.listByProject(p.id);
      const hit = tasks.find(
        (t) => t.task_type === "list" && t.name === LIST_NAME,
      );
      if (hit) return hit.id;
    }
    // Standalone (project_id null) tasks land under id 0 in the local
    // index. Probe that bucket too.
    const standalone = await tasksApi.listByProject(0);
    const standaloneHit = standalone.find(
      (t) => t.task_type === "list" && t.name === LIST_NAME,
    );
    return standaloneHit?.id ?? null;
  } catch {
    return null;
  }
}

/** Wait up to `timeoutMs` for the new list task to appear, polling
 *  every 200ms. Returns the task id or null on timeout. */
async function waitForDemoListTaskId(timeoutMs = 4000): Promise<number | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const id = await findDemoListTaskId();
    if (id !== null) return id;
    await new Promise<void>((resolve) => {
      if (typeof window !== "undefined") window.setTimeout(resolve, 200);
      else setTimeout(resolve, 200);
    });
  }
  return null;
}

/** Read-then-watch pause between modal beats. Matches §6.5
 *  WORKBENCH_CREATE_PAUSE_MS so the user has the same cadence on the
 *  experiment-create and list-create demos. */
const WORKBENCH_LIST_PAUSE_MS = 600;

async function pause(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    if (typeof window !== "undefined") window.setTimeout(resolve, ms);
    else setTimeout(resolve, ms);
  });
}

export const workbenchListCreateShellStep = buildWalkthroughStep({
  id: LIST_CREATE_SHELL_STEP_ID,
  speech: (
    // Wave 2C speech rewrite (v4 tour speech manager — C, 2026-05-27):
    // applies Grant's "quick example: coffee restock" copy.
    <p>
      Quick example: a coffee restock list for the lab. A list just
      needs a name and the items you want to track. I&apos;ll add a few
      now.
    </p>
  ),
  pose: "typing-on-laptop",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchNewListButton),
  cursorScript: cursorScript(async () => {
    // Defensive: activate the Lists tab in case the user back-stepped
    // off another tab. Clicking an already-active tab is a no-op.
    const ensureListsTab = await safeClickAction(
      targetSelector(TOUR_TARGETS.workbenchListsTab),
      2000,
    );

    // 1. Open the modal by clicking +New List Task. The button exists
    //    at build time so safeClickAction resolves immediately.
    const openClick = await safeClickAction(
      targetSelector(TOUR_TARGETS.workbenchNewListButton),
      3000,
    );

    // Steps 2-5 (pick project, type name, type+add items, submit) all
    // need the TaskModal's elements, which DON'T EXIST at build time.
    // The prior `await safe*Action(selector)` calls each ran
    // waitForElement at build time and timed out (5000ms each, ~30s
    // blocked total) before returning null, leaving the script with
    // just openClick. Hand-walk fix 2026-05-27 (mirrors the
    // workbench-create-experiment-open fix at commit 20ceb521): wrap
    // each post-modal action in a callbackAction that resolves at
    // PLAYBACK time so the selector sees the just-mounted modal.

    const pickProject = callbackAction(async () => {
      if (typeof document === "undefined") return;
      const projectId = await resolveFirstProjectId();
      if (projectId === null) return;
      const select = await waitForElement(
        targetSelector(TOUR_TARGETS.workbenchExperimentProjectSelect),
        3000,
      );
      if (!(select instanceof HTMLSelectElement)) return;
      // Wait for the option to mount (project list loads async after
      // modal mount).
      const optionSelector = `${targetSelector(TOUR_TARGETS.workbenchExperimentProjectSelect)} option[value="${projectId}"]`;
      const option = await waitForElement(optionSelector, 3000);
      if (!option) return;
      setNativeFieldValue(select, String(projectId));
    });

    const typeName = callbackAction(async () => {
      if (typeof document === "undefined") return;
      const input = await waitForElement(
        targetSelector(TOUR_TARGETS.workbenchExperimentNameInput),
        3000,
      );
      if (!(input instanceof HTMLInputElement)) return;
      setNativeFieldValue(input, LIST_NAME);
    });

    const addItemCallback = (text: string) =>
      callbackAction(async () => {
        if (typeof document === "undefined") return;
        const input = await waitForElement(
          targetSelector(TOUR_TARGETS.workbenchListModalItemInput),
          3000,
        );
        if (!(input instanceof HTMLInputElement)) return;
        setNativeFieldValue(input, text);
        // Brief settle before clicking Add — controlled state needs to
        // commit so the Add button enables.
        await new Promise((resolve) => setTimeout(resolve, 100));
        const addBtn = await waitForElement(
          targetSelector(TOUR_TARGETS.workbenchListModalItemAdd),
          3000,
        );
        if (!(addBtn instanceof HTMLElement)) return;
        tourClickWithLockBypass(addBtn);
      });

    const submit = callbackAction(async () => {
      if (typeof document === "undefined") return;
      const btn = await waitForElement(
        targetSelector(TOUR_TARGETS.workbenchExperimentSubmit),
        3000,
      );
      if (!(btn instanceof HTMLElement)) return;
      tourClickWithLockBypass(btn);
    });

    // 6. After submit resolves, query the newly-created task by name
    //    and register the artifact. We can't listen for
    //    `tour:experiment-created` here (TaskModal only fires it for
    //    experiment-type tasks); polling tasksApi is the cheaper
    //    alternative for the universal-cleanup grid handoff.
    const registerArtifact = callbackAction(async () => {
      const id = await waitForDemoListTaskId();
      if (id !== null) {
        pendingArtifactStore.add(LIST_CREATE_SHELL_STEP_ID, {
          type: "task",
          id: String(id),
          cleanup_default: "discard",
        });
      }
    });

    return compactScript([
      ensureListsTab,
      openClick,
      callbackAction(() => pause(WORKBENCH_LIST_PAUSE_MS)),
      pickProject,
      callbackAction(() => pause(WORKBENCH_LIST_PAUSE_MS)),
      typeName,
      callbackAction(() => pause(WORKBENCH_LIST_PAUSE_MS)),
      addItemCallback(LIST_ITEM_BEANS),
      callbackAction(() => pause(400)),
      addItemCallback(LIST_ITEM_FILTERS),
      callbackAction(() => pause(400)),
      addItemCallback(LIST_ITEM_GRINDER),
      callbackAction(() => pause(WORKBENCH_LIST_PAUSE_MS)),
      submit,
      registerArtifact,
    ]);
  }),
  // Total page-lock during the modal demo so a stray user click outside
  // the modal doesn't soft-walk them out of the tour. Mirrors §6.5
  // workbench-create-experiment-open.
  pageLock: {
    allowList: [],
    pillLabel: "BeakerBot is creating the list. Hold on a moment.",
  },
  completion: manualAdvance("Got it, next"),
  onExit: async () => {
    await flushPendingArtifacts(LIST_CREATE_SHELL_STEP_ID);
  },
  expectedRoute: "/workbench",
});

// ---------------------------------------------------------------------------
// 5. workbench-list-mark-done — BeakerBot demo: check one + mark whole done
// ---------------------------------------------------------------------------

export const workbenchListMarkDoneStep = buildWalkthroughStep({
  id: LIST_MARK_DONE_STEP_ID,
  speech: (
    // Wave 2C speech rewrite (v4 tour speech manager — C, 2026-05-27):
    // applies Grant's new script copy. Two paragraphs: check items
    // mid-run, then mark the whole list done so it drops out of the
    // active view.
    <>
      <p className="mb-2">
        You can check off individual items as you work.
      </p>
      <p>
        Once everything is done, mark the list itself complete. That
        drops it out of your active view so it stops competing for
        your attention.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchListItemCheckbox),
  cursorScript: cursorScript(async () => {
    // Hand-walk fix 2026-05-27: the prior list-create-shell modal flow
    // no longer leaves the card expanded by default (the card is
    // collapsed when the modal closes). The cursor MUST click the
    // card header first to expand it; only then does the
    // ExpandableListCard panel mount and the item checkbox become
    // findable.
    //
    // The card and its descendants mount AFTER the modal closes, so
    // we wrap each action in a callbackAction that resolves selectors
    // at PLAYBACK time. Same defer-to-playback pattern as
    // workbench-create-experiment-open.

    // 1. Expand the list card. The card-first data-tour-target sits
    //    on an OUTER wrapper div; the expand toggle's onClick is on
    //    an INNER role="button" header inside the ExpandableListCard
    //    body. Native clicks on the wrapper don't propagate to
    //    descendants' handlers, so we have to target the inner button
    //    directly. aria-expanded is present on the header (true/false),
    //    so the combined selector picks it precisely.
    const expandCard = callbackAction(async () => {
      if (typeof document === "undefined") return;
      const headerSelector = `${targetSelector(TOUR_TARGETS.workbenchListCardFirst)} [role="button"][aria-expanded]`;
      const header = await waitForElement(headerSelector, 4000);
      if (!(header instanceof HTMLElement)) return;
      // Only click if not already expanded — toggle would collapse.
      if (header.getAttribute("aria-expanded") === "true") return;
      tourClickWithLockBypass(header);
    });

    // 2. Click the first sub-task checkbox. waitForElement gives the
    //    expand re-render a chance to mount the checkbox.
    const checkItem = callbackAction(async () => {
      if (typeof document === "undefined") return;
      const checkbox = await waitForElement(
        targetSelector(TOUR_TARGETS.workbenchListItemCheckbox),
        4000,
      );
      if (!(checkbox instanceof HTMLElement)) return;
      tourClickWithLockBypass(checkbox);
    });

    // 3. Click the mark-complete button.
    const clickMark = callbackAction(async () => {
      if (typeof document === "undefined") return;
      const btn = await waitForElement(
        targetSelector(TOUR_TARGETS.workbenchListMarkCompleteButton),
        4000,
      );
      if (!(btn instanceof HTMLElement)) return;
      tourClickWithLockBypass(btn);
    });

    return compactScript([
      expandCard,
      callbackAction(() => pause(500)),
      checkItem,
      callbackAction(() => pause(500)),
      clickMark,
    ]);
  }),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/workbench",
});
