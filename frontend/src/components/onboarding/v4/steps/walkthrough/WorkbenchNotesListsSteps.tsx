"use client";

/**
 * §6.7b Workbench Notes + Lists expansion (Workbench expansion manager
 * 2026-05-22).
 *
 * Six new tour steps that sit between §6.7 hybrid editor (last step
 * `hybrid-file-attach`) and §6.8 Gantt (first step `gantt-intro`).
 * Teaches the standalone Notes panel + the Lists panel on the
 * Workbench page. All steps are universal (no `conditionalOn`); all are
 * BeakerBot demo with manual advance ("Got it, next").
 *
 * Step order (matches TOUR_STEP_ORDER insertion):
 *   1. workbench-notes-intro       — cursor clicks Notes tab, narrate
 *   2. workbench-notes-create      — cursor demo creates a standalone
 *                                    note via notesApi (lab-recipe body)
 *   3. workbench-lists-intro       — cursor clicks Lists tab, narrate
 *   4. workbench-list-create-shell — cursor opens TaskModal, types
 *                                    "Coffee restock - grocery run",
 *                                    saves the empty list shell
 *   5. workbench-list-add-items    — cursor clicks first list card to
 *                                    open the popup, types 3 items,
 *                                    Enter-key dispatch between each
 *   6. workbench-list-mark-done    — cursor checks one sub-task, then
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
 * Why a single file: the six steps share helpers (today date format,
 * default item names, the "find latest note / list" probe used by
 * onExit). Splitting them across six files would scatter the same
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
  deferredClickAction,
  safeClickAction,
  safeGlideToElementAction,
  safeTypeAction,
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
export const NOTE_TITLE = "Notes from ASBMB 2026 — Smith lab heat-shock talk";
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
export const LIST_ADD_ITEMS_STEP_ID = "workbench-list-add-items";
export const LIST_MARK_DONE_STEP_ID = "workbench-list-mark-done";

// ---------------------------------------------------------------------------
// 1. workbench-notes-intro — narration, cursor clicks Notes tab
// ---------------------------------------------------------------------------

export const workbenchNotesIntroStep = buildWalkthroughStep({
  id: NOTES_INTRO_STEP_ID,
  speech: (
    <>
      <p className="mb-2">
        The Workbench has three tabs. We&apos;ve covered Experiments.
        This middle one is <strong>Notes</strong>: general scratch notes
        that don&apos;t belong to any single experiment or project.
      </p>
      <p>
        Two flavors: single notes for one-off thoughts (like a quick
        note after a conference talk), and running logs that grow over
        time (think a recurring 1-on-1 with your PI: title it
        &quot;Student / PI 1-on-1, Fall 2026&quot;, then add an entry
        each week. One thing to find, not 15).
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
    <p>
      I&apos;ll make a single note as an example. Same editor as your
      experiment notes, full markdown support.
    </p>
  ),
  pose: "typing-on-laptop",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchNewNoteButton),
  cursorScript: cursorScript(async () => {
    // The "+ New Note" button opens a dropdown (Single Note / Running
    // Log). For the demo we glide to the button, then run the spawn
    // programmatically — typing into NoteDetailPopup's title +
    // description inputs would require multi-step popup typing that
    // adds little to the teaching ("standalone notes have title +
    // body"). Glide alone reads as the cursor "creating" the note.
    const glide = await safeGlideToElementAction(
      targetSelector(TOUR_TARGETS.workbenchNewNoteButton),
      3000,
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
    return compactScript([glide, spawn]);
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
      <p className="mb-2">
        Lists are like experiments, but for everyday stuff. A daily
        checklist of things to do. Different from a full experiment,
        where you&apos;ve got methods plus notes plus results.
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
// 4. workbench-list-create-shell — BeakerBot demo: create the list shell
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

export const workbenchListCreateShellStep = buildWalkthroughStep({
  id: LIST_CREATE_SHELL_STEP_ID,
  speech: (
    <>
      <p className="mb-2">
        Sticking with our coffee theme. I&apos;ll make a grocery list
        for the lab&apos;s coffee restock.
      </p>
      <p>
        Same shape as an experiment: a name, a date. The items live
        inside, you add those next.
      </p>
    </>
  ),
  pose: "typing-on-laptop",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchNewListButton),
  cursorScript: cursorScript(async () => {
    const glide = await safeGlideToElementAction(
      targetSelector(TOUR_TARGETS.workbenchNewListButton),
      3000,
    );
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
    return compactScript([glide, spawn]);
  }),
  completion: manualAdvance("Got it, next"),
  onExit: async () => {
    await flushPendingArtifacts(LIST_CREATE_SHELL_STEP_ID);
  },
  expectedRoute: "/workbench",
});

// ---------------------------------------------------------------------------
// 5. workbench-list-add-items — BeakerBot demo: add 3 items
// ---------------------------------------------------------------------------

/**
 * Look up the demo list task (created in the prior step) so we can
 * append items via API. Cursor types the item names into the popup's
 * "Add item..." input for the visual beat; the actual sub-task append
 * happens via tasksApi.update inside a callbackAction so the items
 * persist regardless of whether the keydown synthesis lands.
 */
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
      "[onboarding-v4] workbench-list-add-items append failed",
      err,
    );
  }
}

export const workbenchListAddItemsStep = buildWalkthroughStep({
  id: LIST_ADD_ITEMS_STEP_ID,
  speech: (
    <>
      <p className="mb-2">
        Now the items. Click the list to expand it, then add line items
        one at a time.
      </p>
      <p>
        Beans, filters, and a better grinder, because the current one
        sounds like a fax machine.
      </p>
    </>
  ),
  pose: "typing-on-laptop",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchListCardFirst),
  cursorScript: cursorScript(async () => {
    // 1. Click the first list card to open TaskDetailPopup.
    const openCard = await safeClickAction(
      targetSelector(TOUR_TARGETS.workbenchListCardFirst),
      4000,
    );

    // 2-4. For each item: type into the Add-item input, then dispatch a
    //      callbackAction that fires the matching tasksApi.update.
    //      The input element resolves at PLAYBACK time (deferred to
    //      after the popup mount), so we use the safe* helpers from
    //      inside callbackActions for items 2 + 3 — by then the popup
    //      is mounted and `waitForElement` finds the input.
    //
    // The Enter keypress that the input expects (onKeyDown) isn't
    // synthesized here because the callback fallback handles the
    // real persistence. Cursor types the visible text; the
    // callback writes the data.
    const typeBeans = callbackAction(async () => {
      const input = await waitForElement(
        targetSelector(TOUR_TARGETS.workbenchListAddItemInput),
        4000,
      );
      if (input instanceof HTMLInputElement) {
        input.focus();
        // Set the value via the React-safe setter so the dispatched
        // input event lands in the controlled state. Mirrors
        // setNativeInputValue in BeakerBotCursor.
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        if (setter) setter.call(input, LIST_ITEM_BEANS);
        else input.value = LIST_ITEM_BEANS;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await appendDemoListItem(LIST_ITEM_BEANS);
    });
    const typeFilters = callbackAction(async () => {
      const input = await waitForElement(
        targetSelector(TOUR_TARGETS.workbenchListAddItemInput),
        2000,
      );
      if (input instanceof HTMLInputElement) {
        input.focus();
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        if (setter) setter.call(input, LIST_ITEM_FILTERS);
        else input.value = LIST_ITEM_FILTERS;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await appendDemoListItem(LIST_ITEM_FILTERS);
    });
    const typeGrinder = callbackAction(async () => {
      const input = await waitForElement(
        targetSelector(TOUR_TARGETS.workbenchListAddItemInput),
        2000,
      );
      if (input instanceof HTMLInputElement) {
        input.focus();
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        if (setter) setter.call(input, LIST_ITEM_GRINDER);
        else input.value = LIST_ITEM_GRINDER;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await appendDemoListItem(LIST_ITEM_GRINDER);
    });

    return compactScript([openCard, typeBeans, typeFilters, typeGrinder]);
  }),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/workbench",
});

// ---------------------------------------------------------------------------
// 6. workbench-list-mark-done — BeakerBot demo: check one + mark whole done
// ---------------------------------------------------------------------------

export const workbenchListMarkDoneStep = buildWalkthroughStep({
  id: LIST_MARK_DONE_STEP_ID,
  speech: (
    <>
      <p className="mb-2">
        Two moves worth knowing. You can check off individual items as
        you do them, useful mid-run.
      </p>
      <p>
        And when the whole list is wrapped, mark the LIST itself as
        done. Keeps your view clean, the list moves to your completed
        section.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchListItemCheckbox),
  cursorScript: cursorScript(async () => {
    // 1. Click the first sub-task checkbox. Wait up to 4s for the
    //    popup to be mounted (it was opened in the previous step).
    const checkItem = await safeClickAction(
      targetSelector(TOUR_TARGETS.workbenchListItemCheckbox),
      4000,
    );

    // 2. Pause ~800ms for the read-then-watch beat — the cursor's
    //    glide to the mark-complete button gives the user time to
    //    register the checkbox flip. Built via the glide that
    //    resolves the button + a deferredClick to bias toward late
    //    DOM resolution (the SimpleTaskChecklist re-renders on the
    //    sub-task update; the header button is stable but a deferred
    //    click is the safer choice).
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
