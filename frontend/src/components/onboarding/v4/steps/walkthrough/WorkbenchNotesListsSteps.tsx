"use client";

/**
 * §6.7b Workbench Notes + Lists expansion (Workbench expansion manager
 * 2026-05-22; collapsed to 5 beats by Workbench fix manager R1
 * 2026-05-22).
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
 *                                    Lists tab is active (R1 defensive
 *                                    re-click), clicks +New List Task,
 *                                    spawns the shell via tasksApi,
 *                                    clicks the just-created card to
 *                                    expand it, then types 3 items into
 *                                    the inline Add-item input. The
 *                                    prior `workbench-list-add-items`
 *                                    beat was folded into this one (R1
 *                                    pacing fix) to drop a no-teaching
 *                                    "Got it, next" click.
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
import { notesApi, tasksApi } from "@/lib/local-api";
import {
  cursorScript,
  callbackAction,
  compactScript,
  safeClickAction,
  safeGlideToElementAction,
  deferredClickAction,
  waitForElement,
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
    <>
      {/* Workbench fix manager R1 2026-05-22 (Verify-C G1 + G2 + T1):
          Beat 1 now bridges from §6.7 ("Those notes lived inside one
          experiment...") and lifts the running-log "one thing to find,
          not 15" payoff to the front. */}
      <p className="mb-2">
        Those notes lived inside one experiment. There&apos;s also a
        place for notes that DON&apos;T belong to any one experiment.
      </p>
      <p className="mb-2">
        The Workbench has three tabs across the top. We just spent time
        on the Experiments tab. This middle one is{" "}
        <strong>Notes</strong>, for general scratch that isn&apos;t tied
        to one experiment.
      </p>
      <p>
        Two flavors. Single notes are one-off, like a quick takeaway
        from a conference talk. Running logs grow over time, one entry
        per session. A weekly PI 1-on-1 is a perfect fit: one note
        titled &quot;Student / PI 1-on-1, Fall 2026&quot;, a new entry
        each week. One file to find later, not fifteen.
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
    // Workbench fix manager R1 2026-05-22 (Verify-C G3): tighten to a
    // single sentence + call out the markdown rendering as a single
    // note materializes. Drops the prior two-sentence framing that
    // restated information from Beat 1.
    //
    // R2 chip C 2026-05-22 copy fix: dropped the "watch as the note
    // saves" framing. The note is created via a direct API call
    // (`notesApi.create`), there's no visible "render as it saves"
    // moment for the user to watch. The new copy keeps the editor-
    // continuity callback without making a false rendering promise.
    <p>
      Single note example, conference takeaways. Same editor you just
      used, with headings, bold, and bullets ready to go.
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
    <>
      <p className="mb-2">
        Last tab on the Workbench: <strong>Lists</strong>.
      </p>
      {/* Workbench fix manager R1 2026-05-22 (Verify-C G4): tighten the
          lists-vs-experiments comparison. "Lighter cousin of an
          experiment" replaces the prior bulkier "Lists are like
          experiments, but for everyday stuff..." framing. */}
      <p className="mb-2">
        A list is a checklist task. No method, no results section, just
        items to tick off. The lighter cousin of an experiment.
      </p>
      <p>Think: grocery runs, reagent restocks, daily to-dos.</p>
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
// 4. workbench-list-create-shell — combined BeakerBot demo: create the
//    list shell AND populate its three items in one continuous cursor
//    script (folded from the prior workbench-list-add-items beat;
//    Workbench fix manager R1 2026-05-22 pacing fix).
// ---------------------------------------------------------------------------

/**
 * Idempotent spawn of the demo list task. Returns the new (or pre-
 * existing) task id. Tasks are scoped to project_id 0 (Miscellaneous /
 * standalone bucket) per WorkbenchListsPanel's `handleCreateListTask`
 * default. The auto-cleanup sub-bot wipes everything that isn't the
 * user's first project, so the bucket choice doesn't affect cleanup.
 *
 * Why programmatic and not cursor-into-TaskModal: TaskModal is a
 * heavy form with task-type toggles, scheduling mode toggles, project
 * dropdown, and a Cancel/Submit row. Driving it via cursor would
 * triple the steps and the user's attention. The cursor's role here
 * is "glide to the + New List Task button" — the actual create then
 * happens programmatically, and the list card appears in the Lists
 * panel below.
 */
async function spawnDemoListShell(): Promise<number | null> {
  const today = todayIso();
  try {
    const tasks = await tasksApi.listByProject(0);
    const existing = tasks.find(
      (t) => t.task_type === "list" && t.name === LIST_NAME,
    );
    if (existing) return existing.id;
    const created = await tasksApi.create({
      project_id: 0,
      name: LIST_NAME,
      start_date: today,
      duration_days: 1,
      task_type: "list",
      sub_tasks: [],
    });
    return created.id;
  } catch (err) {
    console.warn(
      "[onboarding-v4] workbench-list-create-shell spawn failed",
      err,
    );
    return null;
  }
}

/** Look up the demo list task (by name) so we can append items via
 *  API. The cursor types the item names into the inline Add-item input
 *  for the visual beat; the actual sub-task append happens via
 *  tasksApi.update inside a callbackAction so the items persist
 *  regardless of whether the keydown synthesis lands. */
async function findDemoListTaskId(): Promise<number | null> {
  try {
    const tasks = await tasksApi.listByProject(0);
    const hit = tasks.find(
      (t) => t.task_type === "list" && t.name === LIST_NAME,
    );
    return hit?.id ?? null;
  } catch {
    return null;
  }
}

/** Append a sub-task to the demo list. Idempotent on item text — if the
 *  list already has a sub-task with the same text, skip the append. */
async function appendDemoListItem(text: string): Promise<void> {
  const id = await findDemoListTaskId();
  if (id === null) return;
  try {
    const task = await tasksApi.get(id);
    if (!task) return;
    const existing = task.sub_tasks ?? [];
    if (existing.some((st) => st.text === text)) return;
    const next = [
      ...existing,
      {
        id: `st-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        is_complete: false,
      },
    ];
    await tasksApi.update(id, { sub_tasks: next });
  } catch (err) {
    console.warn(
      "[onboarding-v4] workbench-list-create-shell append failed",
      err,
    );
  }
}

/** Type a string into the (just-mounted) Add-item input via the
 *  React-safe setter so the controlled state lands the keystroke. */
function typeIntoAddItemInput(text: string): void {
  const input = document.querySelector(
    targetSelector(TOUR_TARGETS.workbenchListAddItemInput),
  );
  if (!(input instanceof HTMLInputElement)) return;
  input.focus();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (setter) setter.call(input, text);
  else input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export const workbenchListCreateShellStep = buildWalkthroughStep({
  id: LIST_CREATE_SHELL_STEP_ID,
  speech: (
    <>
      <p className="mb-2">
        Sticking with our coffee theme. I&apos;ll make a grocery list
        for the lab&apos;s coffee restock, then drop the items in.
      </p>
      <p>
        Same shape as an experiment: a name, a date. Items live inside,
        check them off as you grab each one.
      </p>
    </>
  ),
  pose: "typing-on-laptop",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchNewListButton),
  cursorScript: cursorScript(async () => {
    // Workbench fix manager R1 2026-05-22 (Verify-A P1-3): defensively
    // activate the Lists tab before gliding to the + New List button.
    // Clicking an already-active tab is a no-op, so this is safe in the
    // happy path AND covers back-step / resume scenarios where the
    // Lists tab somehow isn't active.
    const ensureListsTab = await safeClickAction(
      targetSelector(TOUR_TARGETS.workbenchListsTab),
      2000,
    );

    // Glide to the +New List button + visible click (matches the
    // "BeakerBot caused this" beat we apply on the Notes side).
    const glideNew = await safeGlideToElementAction(
      targetSelector(TOUR_TARGETS.workbenchNewListButton),
      3000,
    );
    const clickNew = await safeClickAction(
      targetSelector(TOUR_TARGETS.workbenchNewListButton),
      1500,
    );

    // Spawn the shell programmatically (TaskModal is too heavy to drive
    // via cursor for the teaching value it adds). The list card appears
    // in the Lists panel under the +New List Task button.
    const spawn = callbackAction(async () => {
      const id = await spawnDemoListShell();
      if (id !== null) {
        pendingArtifactStore.add(LIST_CREATE_SHELL_STEP_ID, {
          type: "task",
          id: String(id),
          cleanup_default: "discard",
        });
      }
    });

    // Wait for the new list card to mount + glide-click it to expand
    // the inline ExpandableListCard panel (where the Add-item input
    // lives). `deferredClickAction` resolves the selector at playback
    // time, which is what we want here because the card is created by
    // the prior callback.
    const glideCard = await safeGlideToElementAction(
      targetSelector(TOUR_TARGETS.workbenchListCardFirst),
      4000,
    );
    const clickCard = deferredClickAction(
      targetSelector(TOUR_TARGETS.workbenchListCardFirst),
      4000,
    );

    // For each of the 3 items: wait for the Add-item input to mount
    // (only present once the card is expanded), type the visible value
    // into it, then dispatch the matching tasksApi.update so the
    // sub-task persists regardless of keydown synthesis.
    const typeBeans = callbackAction(async () => {
      await waitForElement(
        targetSelector(TOUR_TARGETS.workbenchListAddItemInput),
        4000,
      );
      typeIntoAddItemInput(LIST_ITEM_BEANS);
      await appendDemoListItem(LIST_ITEM_BEANS);
    });
    const typeFilters = callbackAction(async () => {
      await waitForElement(
        targetSelector(TOUR_TARGETS.workbenchListAddItemInput),
        2000,
      );
      typeIntoAddItemInput(LIST_ITEM_FILTERS);
      await appendDemoListItem(LIST_ITEM_FILTERS);
    });
    const typeGrinder = callbackAction(async () => {
      await waitForElement(
        targetSelector(TOUR_TARGETS.workbenchListAddItemInput),
        2000,
      );
      typeIntoAddItemInput(LIST_ITEM_GRINDER);
      await appendDemoListItem(LIST_ITEM_GRINDER);
    });

    return compactScript([
      ensureListsTab,
      glideNew,
      clickNew,
      spawn,
      glideCard,
      clickCard,
      typeBeans,
      typeFilters,
      typeGrinder,
    ]);
  }),
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
    <>
      <p className="mb-2">
        Two moves worth knowing. You can check off individual items as
        you do them, useful mid-run.
      </p>
      {/* Workbench fix manager R1 2026-05-22 (Verify-C G5): explain the
          WHY of marking the whole list done — it drops out of the
          active Overdue/Doing/Upcoming buckets so it stops competing
          for attention. Replaces the prior "keeps your view clean"
          framing which under-sold the value. */}
      <p>
        And when every item is wrapped, mark the LIST itself complete.
        That drops it out of your active Overdue/Doing/Upcoming buckets
        so it stops competing for your attention with real work.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchListItemCheckbox),
  cursorScript: cursorScript(async () => {
    // 1. Click the first sub-task checkbox. Wait up to 4s for the
    //    ExpandableListCard panel to be mounted (the prior combined
    //    beat expanded the card and added the items).
    const checkItem = await safeClickAction(
      targetSelector(TOUR_TARGETS.workbenchListItemCheckbox),
      4000,
    );

    // 2. Glide to the mark-complete button, then deferred-click it.
    //    The header button is stable but ExpandableListCard re-renders
    //    on the sub-task update, so deferred resolution is the safer
    //    choice.
    const glideToMark = await safeGlideToElementAction(
      targetSelector(TOUR_TARGETS.workbenchListMarkCompleteButton),
      4000,
    );
    const clickMark = deferredClickAction(
      targetSelector(TOUR_TARGETS.workbenchListMarkCompleteButton),
      4000,
    );

    return compactScript([checkItem, glideToMark, clickMark]);
  }),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/workbench",
});
