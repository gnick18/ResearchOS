# Shared 1:1 Notebooks (PI <-> student) Proposal

Author: orchestrator (master bot), 2026-06-02
Status: design locked + data model APPROVED by Grant (2026-06-02). Phase 1
(data + API) DISPATCHED as notebooks-data bot (verify before merge). Phases 2-5
follow after Phase 1 lands.

## Motivation

Grant (a PI) looked for a way to set up note-taking + weekly tasks with a
student and could not find it on the notes page. Today the only path is opt-in
dashboard widgets (member adds a "Weekly goals" widget; PI adds a PI-only
"Trainee notes & goals" widget), with goals shared whole-lab. Grant wants a
real, set-up-able workflow with a permanent home on the notes page, serving the
student too, not just the PI.

## Concept

A dedicated SHARED 1:1 NOTEBOOK between two people (typically a PI and a
student). Everything in it is ALWAYS shared between exactly those two members
(not per-item toggles, not whole-lab). It holds notes AND weekly tasks. It has
a permanent home on each member's notes page, and can optionally be added as a
home-page widget.

## Locked decisions (Grant, 2026-06-02)

- SHARING: everything in a notebook is always shared between exactly its two
  members. Pair-scoped, always-on, no toggle, not whole-lab.
- SETUP: EITHER the PI or the student can create a notebook (pick the other
  person). The other gets the permanent home once it exists.
- PI SURFACE: SYMMETRIC. Both members access notebooks from their own notes
  page. A PI sees a list of their per-student notebooks; a student sees the
  notebook(s) they are in. (A home-page widget is an optional add for either.)
- TASKS: BOTH members can add weekly tasks. Typical use: the PI assigns tasks
  in the 1:1, the student checks them off and adds notes. A true shared
  workspace, not top-down-only and not bottom-up-only.
- PLACEMENT: a SECTION within the notes page (the workbench Notes tab), NOT a
  4th top-level tab. It becomes a permanent home once a notebook exists. Can
  also be added as a home-page widget if the user wants the glanceable version.

## Data model (grounded; the FLAGGED data-shape work, needs sign-off)

Good news: minimal. The existing unified sharing already does the hard part.
- `shared_with` (SharedUser[]) already supports EXPLICIT usernames, and
  `canRead`/`canWrite` (frontend/src/lib/sharing/unified.ts) already honor an
  explicit list + the edit level. So "always shared between A and B" is just
  `shared_with: [{username: A, level: "edit"}, {username: B, level: "edit"}]`.
  No new sharing infra, no migration.

Proposed additions (all additive / backward-compatible):
1. New record type `SharedNotebook { id, members: [string, string],
   created_by, created_at, title? }`, in a new per-user store `shared_notebooks`,
   owned by the creator and `shared_with` both members. Discovered the same way
   notes are: aggregate across users, filter by `canRead`. "My notebooks" = the
   notebook records where I am a member.
2. Notes gain an optional `notebook_id` so a note can belong to a notebook
   (absent = personal note, unchanged).
3. Weekly tasks inside a notebook: reuse the existing WeeklyGoal record with an
   added optional `notebook_id` (and treat it as a shared task), OR a small new
   `WeeklyTask` type. Decide in Phase 1; reuse is preferred if WeeklyGoal fits.
4. Notebook items (notes + tasks) carry `shared_with: [both members, edit]` via
   a helper `pairingSharedWith(a, b)` in unified.ts.

No lab-level store, no migration, no change to the personal-notes path. The
roster comes from the existing `discoverUsers()`; the PI is `account_type:
"lab_head"`, a member is `"lab"`.

## Architecture

- NOTES TAB becomes notebook-aware: a switcher lists "Personal" (today's notes,
  unchanged) plus each shared notebook. Selecting a shared notebook shows its
  notes + weekly tasks with an "Always shared with <other member>" banner; both
  members can add/edit.
- SETUP: a "Start a shared notebook" action opens a person picker (lab roster
  via discoverUsers); either role can create. Creates the SharedNotebook record
  shared with both.
- OPTIONAL HOME WIDGET: a widget that surfaces a chosen shared notebook
  (glanceable notes + tasks), added via the (now redesigned) widget store. The
  existing per-account widget enablement applies.

## Phasing

1. DATA + API: SharedNotebook store + record type, `notebook_id` on notes (and
   weekly tasks), `pairingSharedWith` helper, list-my-notebooks aggregation,
   reuse canRead/canWrite. Backend/data-shape: VERIFY before merge, do NOT
   merge on report. Pre-flagged.
2. NOTES-PAGE UI: notebook switcher in the Notes tab, shared-notebook view
   (notes + tasks), and the setup/person-picker flow. UI can merge on report.
3. WEEKLY TASKS in-notebook: both-add, PI-assign / student-complete interaction,
   done/undone, ordering.
4. OPTIONAL HOME WIDGET surfacing a notebook.
5. Standard 3-verifier loop (mechanics + spec + fresh-eyes), with a PI account
   and a student account, exercising the symmetric access + always-shared
   semantics.

## Open for Grant sign-off

The data-model section is a data-shape touch (new SharedNotebook record/store,
`notebook_id` on notes + weekly tasks). Per project rule, confirm the approach
(reuse `shared_with` + a new `shared_notebooks` store, reuse WeeklyGoal for
tasks) before Phase 1 builds.
