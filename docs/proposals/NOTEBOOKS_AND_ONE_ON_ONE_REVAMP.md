# Notebooks + Lab-head/member 1:1 revamp (UI replan)

Author: orchestrator (master bot), 2026-06-06
Status: DRAFT. Design forks answered by Grant (2026-06-06). No code until the
nav-placement, naming, and migration decisions below are signed off.

Supersedes the "shared notebook = PI/student 1:1 with weekly tasks" concept in
`SHARED_NOTEBOOKS_PROPOSAL.md`, and corrects `NOTEBOOKS_GENERALIZATION_PROPOSAL.md`
(which folded the structured 1:1 into the generic shared-notebook path). Phases 1
and 2 of the generalization already shipped; this doc is the course correction.

## The problem

The code conflates three different things under one "shared notebook":
- The `SharedNotebookView` renders Weekly tasks + Notes.
- `notebooksApi` has `createWeeklyTask`.
So a plain "we both have this" peer share wrongly inherits the PI/student
weekly-meeting machinery. Grant: the lab-head/member relationship is a real
platform, not just a shared key.

## The corrected model (three clearly separate things)

1. PERSONAL NOTEBOOK. One member (you). Groups your notes. (Shipped.)
2. GENERIC SHARED NOTEBOOK. A plain shared container of notes between any
   people. Symmetric, "we both have this." NO weekly goals, NO meeting
   structure, NO tasks. Just shared notes. (Strip the weekly machinery out.)
3. LAB-HEAD <-> MEMBER 1:1. Its OWN distinct surface (NOT a notebook, NOT in the
   notebook rail). A purpose-built advising workspace both people type in.

Notebooks (1 + 2) stay in the Notes-tab left rail. The 1:1 (3) moves out to its
own surface.

## Locked decisions (Grant, 2026-06-06)

- The 1:1 is its OWN distinct surface, not a notebook variant.
- The 1:1 platform contains ALL of: weekly goals (both edit), weekly meeting
  notes (both type), plain shared notes, and an agenda / action-items area.
- The lab head sets up a 1:1 per member (the member then sees it and uses it).
- Generic shared notebooks keep NO weekly/task structure, just shared notes.

## The 1:1 surface (the new platform)

Working name: "1:1s" (final name is an open question below). One 1:1 per
lab-head/member pair. The surface has four areas, all shared between exactly the
two people at edit:

- WEEKLY GOALS. A per-week shared checklist either person can add to and check
  off. Reuses the existing `WeeklyGoal` record (already `week_of` + `is_complete`
  + shared). Typical flow: lab head assigns, member checks off.
- WEEKLY MEETING NOTES. A shared running log organized by meeting date/week,
  both type into. One entry per meeting. (Reuse a running-log Note shape keyed to
  the 1:1, or a dedicated per-week entry list. Decide in Phase 1.)
- SHARED NOTES. Freeform shared notes scoped to the 1:1 (beyond the weekly
  structure), for anything that is not a goal or a meeting note.
- AGENDA / ACTION ITEMS. A running agenda for the NEXT meeting plus tracked
  action items that carry between meetings until done.

Both members reach their 1:1(s) from the same surface (symmetric access): a lab
head sees a list of their per-member 1:1s; a member sees the 1:1(s) they are in.

## Data model

### 1:1 record (new, distinct from Notebook)
```
export interface OneOnOne {
  id: string;              // crypto.randomUUID, globally unique
  labHead: string;         // the lab-head username (creator/owner)
  member: string;          // the member username
  created_by: string;      // = labHead (lab head sets it up)
  created_at: string;
  owner: string;           // = labHead, drives canRead/canWrite owner branch
  shared_with: SharedUser[]; // membersSharedWith([labHead, member]) - both edit
}
```
Stored at `users/<labHead>/one_on_ones/<uuid>.json` via the same thin
string-keyed store pattern. DATA-SHAPE FLAG: new on-disk shape.

### Item scoping
The four areas attach to a 1:1 via a `one_on_one_id`:
- Weekly goals: add `one_on_one_id?: string` to `WeeklyGoal` (the existing
  `notebook_id` on WeeklyGoal was only ever used for the 1:1; rename it
  `one_on_one_id` with a lazy-normalize that reads the old key).
- Weekly meeting notes + shared notes: `Note.one_on_one_id?: string` (and keep
  `notebook_id` purely for notebooks 1 + 2). A meeting note vs a freeform shared
  note is distinguished by a small `note_kind?: "meeting" | "note"` (or by the
  running-log flag). Decide in Phase 1.
- Agenda / action items: a new lightweight `OneOnOneActionItem { id,
  one_on_one_id, text, is_done, created_by, created_at }` (small dedicated
  store), plus a freeform agenda field on the OneOnOne or a pinned note.

All items carry `shared_with = membersSharedWith([labHead, member])`, both at
edit, exactly as today.

## Migration: NONE (Grant, 2026-06-07)

No one is using this yet and the whole site is in maintenance mode, so we do NOT
migrate. Rip the conflated machinery out and build the clean model. No
lazy-normalize, no Settings repair button, no backward-compat for the old
"shared notebook = 1:1 with weekly tasks" on-disk usage. Concretely:
- Delete `createWeeklyTask` / the weekly-task + meeting framing from the
  notebook path (`SharedNotebookView`, `notebooksApi`).
- The generic shared notebook becomes a plain note container.
- Build the `OneOnOne` surface fresh. Any stray old on-disk records can be
  ignored (maintenance mode, not in real use).

## UI replan

### Notes tab (notebooks only now)
The left rail keeps All / Unfiled / My notebooks / Shared, but SHARED notebooks
become plain note containers. Remove from the shared-notebook view: weekly
tasks, the weekly-meeting framing, `createWeeklyTask` calls. `SharedNotebookView`
becomes "a note grid filtered to this notebook" like the personal view, just
with a members chip and the cross-member aggregation it already does.

### New 1:1 surface
A distinct surface (placement is an open question below). Layout: a left list of
1:1s (for a lab head, one row per member; for a member, their 1:1s), and a main
pane with the four areas as tabs or stacked sections (Weekly goals / Meeting
notes / Notes / Agenda + action items). Lab head gets a "New 1:1" action that
picks a member. House style applies (no em-dashes, no emojis, `<Icon>` from the
registry, brand tokens, `<Tooltip>`).

## Locked decisions, round 2 (Grant, 2026-06-07)

- PLACEMENT: a TAB inside the Workbench, next to Projects / Experiments / Notes /
  Lists.
- NAME is ROLE-RELATIVE and names the counterpart (no fixed "1:1s" label):
  - Lab-head perspective uses the "Mentoring" framing, labeled by the member,
    e.g. a 1:1 with Alex reads "Alex - Mentoring"; the Workbench tab for a lab
    head reads "Mentoring".
  - Member perspective uses the "Check-ins" framing, labeled by the lab head,
    e.g. "Dr. Lee - Check-ins"; the Workbench tab for a member reads
    "Check-ins".
  - Implement with one helper, `oneOnOneLabel(viewer, oneOnOne)`, so the label
    derives from who is looking. Tab label = role word; each 1:1 entry =
    counterpart name + role word.
- A lab head and member CAN have both a structured 1:1 AND generic shared
  notebooks; a shared notebook is just a note container regardless of who is in
  it. The two are independent.
- MIGRATION: none (see the Migration section above).

## Phasing (after sign-off)

- Phase A (data): `OneOnOne` record + store, `one_on_one_id` on WeeklyGoal/Note
  (+ lazy-normalize of the old `notebook_id` 1:1 usage), action-items store,
  `oneOnOnesApi` (create/list/discover + the four item APIs). FLAG data shape.
- Phase B (1:1 surface): the new surface + the four areas.
- Phase C (strip notebooks): remove weekly machinery from the generic
  shared-notebook view; Settings repair button for migration.
- Phase D (polish + wiki): empty states, lab-head onboarding pointer, wiki pages.
