# BeakerSearch on the Gantt page

This is the exhaustive, build-ready interaction spec for the Gantt page source of
BeakerSearch. It takes the Gantt section of the master proposal
(`docs/proposals/beakersearch-website-wide.md`) from concept depth to a full
spec, grounded in the real code at `frontend/src/app/gantt/page.tsx` and its
components. It assumes the shared `BeakerSearchProvider` and the
`useBeakerSearchSource` contract described in the master doc; only the Gantt
source is specified here.

Voice: no em-dashes, no en-dashes, no emojis, no mid-sentence colons. Where this
doc quotes example palette rows the copy follows the same rules so it can be
pasted into the build.

## 0. Ground truth, what the Gantt page actually is

The Gantt page is `app/gantt/page.tsx` (the `Home` default export). It is NOT a
frappe-gantt instance. `frappe-gantt` is a dependency in `package.json` but the
visible chart is a custom React grid in `components/GanttChart.tsx` (2212 lines)
that lays out week columns and absolutely-positioned task bars itself. This
matters for two things the master doc flagged as open questions, the hovered bar
is a React element we can tag directly, and the timeline window is store state
(`ganttStartDate` + `viewMode`), not a scroll offset frappe owns. Both are
addressed below.

The page composes five surfaces:
- `Toolbar` (project filter dropdown, tag pills, Shared toggle, view-mode
  buttons, Goal button, + Task button, week nav + date picker).
- `GanttChart` (the timeline, task bars, goal bars, dependency drag-to-link, the
  dependency-type popup, the shift-confirm dialog).
- `HighLevelGoalSidebar` (the goals rail on the right).
- `BulkMoveModal` (cascade-shift confirmation, driven by `bulkMoveData`).
- `TaskModal` (create task), `TaskDetailPopup` (open task), `HighLevelGoalModal`
  (create / edit goal).

## 1. Entity model, data sources, composite keys, query keys

### 1.1 Entities held on this page

| Entity | Source hook (in `page.tsx`) | Query key | Shape notes |
| --- | --- | --- | --- |
| Task | `useQuery(fetchAllTasksIncludingShared)` | `["tasks","with-shared",currentUser]` | own + shared-with-me; `id`, `name`, `start_date`, `duration_days`, `end_date` (derived), `project_id`, `owner`, `tags[]`, `is_complete`, `is_high_level`, `task_type` (experiment / purchase / list), `is_shared_with_me`, `shared_permission`, optional `external_project {id, owner}` |
| Project | `useQuery(fetchAllProjectsIncludingShared)` | `["projects",currentUser]` | `id`, `name`, `owner`, `color`, `tags[]`, `is_archived`; page derives `activeProjects` (not archived) |
| High-Level Goal | `useQuery(goalsApi.list)` | `["goals",currentUser]` | `id`, `name`, `project_id` (null = personal), `start_date`, `end_date`, `color`, `smart_goals[]`, `is_complete`, `owner?`, `shared_with?` |
| Dependency | `useQuery(dependenciesApi.list)` | `["dependencies",currentUser]` | `id`, `parent_id`, `child_id`, `dep_type` (FS / SS / SF); page derives `activeDependencies` (both ends in `activeTasks`) |

The current user comes from `useCurrentUser()` (`providerCurrentUser ?? ""`).

### 1.2 Composite keys (the cross-owner disambiguation rule)

Shared-with-me records and own records can share a numeric `id`, so every jump
and lookup uses an `"{owner}:{id}"` composite key.

- Tasks, `taskKey(task)` from `lib/types.ts`. This is the `editingTaskKey` the
  store holds and the value `onTaskClick(key)` passes back to the page.
- Projects, `projectKey(p) = "${p.owner}:${p.id}"` (defined at the top of
  `page.tsx`; mirrored in `Toolbar.tsx`). The project filter array
  (`selectedProjectIds`) holds these keys via `encodeFilterKey(p)` from
  `lib/search/filterKey.ts`, plus the `STANDALONE_FILTER_KEY` sentinel for
  orphan tasks (`project_id` null).
- `projectColors` is keyed by `projectKey`.

BeakerSearch NAVIGATE items and SUGGESTED commands MUST carry these composite
keys, never a bare numeric id. The Gantt source builds them from the same
helpers the page already imports (`taskKey`, the local `projectKey`,
`encodeFilterKey`).

### 1.3 Query keys to invalidate after a palette mutation

Mutating commands run the same APIs the page UI runs, so they reuse the same
refetch set. The canonical sets, lifted from the real handlers:

- Task create / update / move / delete, `refetchQueries(["tasks"])` (prefix
  match catches `["tasks","with-shared",currentUser]`) plus
  `refetchQueries(["task", taskKey(task)])` when a single task is open, and
  `refetchQueries(["dependencies"])` after create (TaskModal does both, see
  `TaskModal.tsx` lines 361 to 362).
- Dependency create, `refetchQueries(["dependencies"])` plus
  `refetchQueries(["tasks"])` (a cascade may have shifted dates).
- Goal create / update / delete, `refetchQueries(["goals"])` (the page's
  `handleDeleteGoal` uses exactly this, `page.tsx` line 215).
- Change-project / unshare, also touch `["projects"]` and
  `["projects","with-shared"]` (TaskDetailPopup lines 445 to 448).

The Gantt source exposes an `invalidate` map per command (section 7) so the
provider fires the right refetch after `run()` resolves.

## 2. Context model, the four signals mapped to Gantt

The master doc defines SELECTED > HOVERED > ON-SCREEN > OPEN/FOCUSED. On the
Gantt:

### 2.1 SELECTED (strongest)

The page has exactly one explicit selection at a time, and it is one of two
mutually-exclusive store fields:
- `editingTaskKey` (string composite key, set by `setEditingTaskKey` via
  `handleTaskClick`). When set, the `TaskDetailPopup` is open. The Gantt source
  resolves it the same way `page.tsx` does, `allTasks.find(t => taskKey(t) ===
  editingTaskKey)`.
- `editingGoal` (a full `HighLevelGoal`, set by `setEditingGoal` from a goal-bar
  click or the sidebar). When set, the `HighLevelGoalModal` is open.

The Gantt source reads both from `useAppStore`. If `editingTaskKey` is set,
SELECTED = that task. Else if `editingGoal` is set, SELECTED = that goal. Else no
selection.

Note, when a detail popup is OPEN, BeakerSearch is realistically opened on top of
it (Cmd-K from inside the modal). The Suggested zone then leads with
selection-aware actions for that task / goal. If the build decides the palette
should not open over a modal, SELECTED still carries through the brief moment
before close; treat it as the freshest signal regardless.

### 2.2 HOVERED (softer)

The chart renders each bar as a tagged React `div` (GanttChart.tsx around line
1923). Today the only hover state captured is `hoveredChainId` (for the chain
ring-highlight). To feed BeakerSearch we add the master doc's app-wide capture,
stamp `data-beaker-target` on the bar wrapper with a serialized ref, and let the
provider track the last-hovered one. Concretely:

- Task bar, add `data-beaker-target={JSON.stringify({ kind: "task", key: tk })}`
  to the bar `div` that already has `ref={registerTaskElement(...)}` and the
  `onClick={() => onTaskClick(tk)}`. `tk` is `taskKey(task)`, already in scope.
- Goal bar, add `data-beaker-target={JSON.stringify({ kind: "goal", id:
  goal.id })}` to the goal bar `div` (the one with
  `onMouseEnter={setHoveredGoal}` near line 1605). Goal id is page-unique within
  the goals list.
- Day cell, OPTIONAL. The empty day cells already drive double-click-to-create
  (`setNewTaskStartDate` + `setIsCreatingTask`). Tagging them with
  `data-beaker-target={ kind: "date", date: ds }` lets "New task on Jun 12"
  pre-fill the hovered date. Lower priority than task / goal hover; ship behind
  the same opt-in.

The provider records the last `data-beaker-target` the cursor was over when the
palette opened (master doc, "Hover is captured app-wide"). The Gantt source's
`context()` reads that record and resolves it to a typed ref (`task` -> lookup
by key, `goal` -> lookup by id, `date` -> raw string). Dependency EDGES are not
hoverable as discrete elements (the chart shows dependencies as chain coloring,
not drawn arrows, see GanttChart comment at line 521), so there is no "hovered
edge" signal; the chain a hovered task belongs to is available via `chainInfo`
if we want "select the whole chain" later, but it is out of scope for v1.

### 2.3 ON-SCREEN (scopes navigation and suggestions)

The visible frame is three store-derived facts:
- Project filter, `projectFilterMode` ("all" or "explicit", NOT the
  "explicit/implicit/off" triad the master doc guessed; the real store only has
  these two) plus `selectedProjectIds` (composite keys, may include
  `STANDALONE_FILTER_KEY`). In "all" mode every project shows; in "explicit"
  mode only the listed keys (empty array = nothing shows, the Clear state).
- Tag filter, `selectedTags` (array of tag strings). A task must match at least
  one selected tag (OR semantics, `page.tsx` line 156).
- Shared visibility, `showShared` (boolean; when false, `is_shared_with_me`
  tasks are filtered out, `page.tsx` line 108).
- Date window, derived from `ganttStartDate` (a `YYYY-MM-DD` Monday or null =
  this week's Monday) and `viewMode` (`weeksToShow`, e.g. 2week -> 2, 3month ->
  13). The visible range is `[start, start + weeksToShow*7 - 1]`. The Toolbar
  already computes `displayDateRange` this way; the Gantt source recomputes it
  from the same two store fields (or reads a small shared helper if we extract
  one).

ON-SCREEN scopes ENTITIES, when the query is empty, "Jump to a task" lists the
visible `filteredTasks` first; widening to all tasks happens when the user types
(master doc, "scoped to on-screen when the query is empty, widened when
typing").

### 2.4 OPEN / FOCUSED (page identity)

The Gantt has no single focused entity the way the sequence editor has one open
sequence. Its identity IS the current scope (the active filters + date window).
So OPEN/FOCUSED maps to the context card's scope summary rather than to one
object. When a detail popup is open, that promotes to SELECTED (2.1), which the
card also reflects.

### 2.5 The context card contents

Empty query, full card. Two stacked lines:
1. Scope line, "Gantt" then the live scope, built from ON-SCREEN:
   - project, "All projects" (mode all) / "<name>" (explicit, single match) /
     "Standalone" (the sentinel) / "N projects" (explicit, many) / "No projects"
     (explicit, empty array). Reuse the exact `projectFilterLabel` logic from
     `Toolbar.tsx` lines 153 to 182.
   - tag, ", tag <#tag>" or ", tags <#a #b>" when `selectedTags` is non-empty.
   - shared, ", incl. shared" only when `showShared` is true AND at least one
     shared task is in view (suppress the noise otherwise).
   - window, ", <Mon DD> to <Mon DD>" from `displayDateRange`.
   - Example, "Gantt, 3 projects, tag PCR, Jun 9 to Jul 20, incl. shared".
2. Selection line (only when SELECTED), the task or goal:
   - task, the name, type icon, "<start> to <end>", a complete check if
     `is_complete`, and a "shared, view only" pill when read-only (2.6).
     Example, "PCR optimization, Jun 12 to Jun 19".
   - goal, the name, "milestone", "<start> to <end>", and the SMART-goal count
     ("3 of 5 done"). Example, "Submit R01 aims, milestone, due Aug 1".

Typed query, the card collapses to one slim line (master doc model), "Gantt,
<scope summary>" with the selection folded in if present, so the user keeps
their bearings while the list below is fuzzy-ranked.

### 2.6 Permission state carried on the context

`readOnly` for a task is computed exactly as `page.tsx` does at the
TaskDetailPopup callsite, `task.is_shared_with_me === true &&
task.shared_permission !== "edit"`. The Gantt source attaches this to the
SELECTED / HOVERED task ref so SUGGESTED can gate mutating commands (section 3).
For goals, a shared goal without edit rights is read-only by the same shape
(`shared_with` + permission); v1 can treat any `is_shared_with_me`-style goal as
read-only for the destructive actions and let owner goals be fully editable.

## 3. SUGGESTED, every contextual variant with its exact handler

Each row below lists, the label (house voice), the selection echo (the `detail`
sub-line), the exact handler / API it wires to, the `enabled` predicate, and the
invalidation. "Open the detail" handlers are pure store writes (no refetch).

### 3.1 A task is SELECTED or HOVERED

Resolve the task ref (SELECTED beats HOVERED). `t` = the task, `key =
taskKey(t)`, `ro` = the read-only predicate from 2.6.

1. Mark complete / Mark incomplete
   - label, `Mark "<name>" complete` (or "incomplete" when `t.is_complete`).
   - echo, the current state, e.g. "currently in progress".
   - handler, `tasksApi.update(t.id, { is_complete: !t.is_complete })` then
     refetch `["tasks"]` + `["task", key]`. This is the exact call in
     `TaskDetailPopup.tsx` line 864.
   - enabled, `!ro`.
   - invalidate, `["tasks"]`, `["task", key]`.

2. Shift its dates
   - label, `Shift "<name>" dates`.
   - echo, "<start> to <end>".
   - handler, opens the date target. v1 simplest, set
     `setEditingTaskKey(key)` to open the detail popup where the date editor
     lives. v2 (nicer), a sub-prompt in the palette that takes a new start date
     and calls `tasksApi.move(t.id, { new_start_date }, t.owner)`. If `move`
     returns `requires_confirmation`, populate `bulkMoveData` ({ taskId,
     newStartDate, affectedCount, warnings }) so the existing `BulkMoveModal`
     handles the cascade, identical to the drag path.
   - enabled, `!ro`.
   - invalidate, `["tasks"]` (and `["dependencies"]` not needed, deps unchanged).

3. Add a dependency from here
   - label, `Add a dependency from "<name>"`.
   - echo, "link to another experiment".
   - handler, the Gantt's link gesture is drag-drop today (`handleDropOnTask` ->
     `showDepPopup`). From the palette we cannot drag, so this command opens a
     two-step picker, step 1 choose the child task (NAVIGATE list scoped to
     experiments, since the chart gates linking to `task_type === "experiment"`
     on both ends, GanttChart comment line 1191), step 2 choose `dep_type` (FS /
     SS / SF, the three buttons in the existing dep popup). On confirm, call
     `dependenciesApi.create({ parent_id: t.id, child_id, dep_type })` reusing
     the same cycle-guard logic `handleCreateDependency` runs. v1 may instead
     just surface "Add a dependency from here" that focuses the bar and tells the
     user to drag, but the picker is the real upgrade.
   - enabled, `!ro && t.task_type === "experiment"`.
   - invalidate, `["dependencies"]`, `["tasks"]`.

4. Open the task
   - label, `Open "<name>"`.
   - echo, "view and edit details".
   - handler, `setEditingTaskKey(key)` (the page's `handleTaskClick`).
   - enabled, always (read-only still opens, popup renders `readOnly`).
   - invalidate, none.

5. Change its project
   - label, `Move "<name>" to a project`.
   - echo, "currently in <project name or Standalone>".
   - handler, opens a project picker (NAVIGATE-style list of `activeProjects` +
     a Standalone option), then `tasksApi.update(t.id, { project_id: chosen ===
     0 ? null : chosen }, t.owner)`. Mirrors the project select in TaskModal /
     TaskDetailPopup.
   - enabled, `!ro`.
   - invalidate, `["tasks"]`, `["task", key]`, `["projects"]`.

6. Delete the task
   - label, `Delete "<name>"`.
   - echo, "moves to Trash".
   - handler, `confirm(...)` then `tasksApi.delete(t.id)`, close any open popup,
     refetch `["tasks"]` + `["task"]`. Same as TaskDetailPopup line 915. Routes
     through Trash (soft delete), so the copy says "moves to Trash", not
     "permanently".
   - enabled, `!ro`.
   - invalidate, `["tasks"]`, `["task"]`, `["dependencies"]`.

For a HOVERED (not selected) task the same six appear but ranked one notch below
a real selection, and the echo reads "the bar you were pointing at" style sub
text so the user knows which task. Read-only tasks show Open only; the mutating
rows render greyed with `enabled: false` and a "shared, view only" hint rather
than vanishing, so the user learns why.

### 3.2 A goal is SELECTED (or hovered)

`g` = the `HighLevelGoal`.

1. Edit the goal, `setEditingGoal(g)` (opens `HighLevelGoalModal`). No refetch.
2. Add a task under it, opens TaskModal pre-scoped to the goal's project,
   `setSelectedProjects([...])` is not it; instead set the create flow,
   `setNewTaskStartDate(g.start_date)` (optional) and `setIsCreatingTask(true)`,
   and if the goal carries a `project_id` pre-select that project in the modal.
   If the modal does not yet accept a forced project, v1 just opens create with
   the goal's start date and the user picks the project. invalidate `["tasks"]`.
3. Mark goal complete / incomplete, `goalsApi.update(g.id, { is_complete:
   !g.is_complete })`, refetch `["goals"]`. enabled when owner-editable.
4. Delete the goal, the page already has `handleDeleteGoal(g)` (confirm ->
   `goalsApi.delete` -> refetch `["goals"]` -> clear `editingGoal`). Wire the
   command straight to it. invalidate `["goals"]`.

### 3.3 A project filter is active, nothing selected

When `projectFilterMode === "explicit"` and `selectedProjectIds.length === 1`
(or a clear single dominant project), resolve `proj` = that project.

1. Add a task to <project>
   - handler, `setIsCreatingTask(true)` and pre-select `proj` in TaskModal. If
     the modal accepts a forced project id, pass it; otherwise open create and
     the modal defaults to the first active project (TaskModal effect line 237),
     so the upgrade is a `setRestrictedProject`-style store field, noted as an
     open question in section 8.
   - invalidate, `["tasks"]`.
2. Add a goal to <project>, `setIsCreatingGoal(true)`; same pre-select caveat.
3. Clear the project filter, `setProjectFilterMode("all")` (resets to all).
   No refetch (pure view state).

When `projectFilterMode === "explicit"` with MANY selected, drop the "Add to
<project>" rows (ambiguous which) and keep "Clear the project filter".

### 3.4 A tag filter is active

`selectedTags` non-empty:
1. Clear tag filter, toggle each off via `toggleTag` for each in
   `selectedTags`, or add a store `clearTags` action (open question). v1 can
   loop `toggleTag`. No refetch.
2. Filter to one tag, if multiple tags are active, offer "Show only #<tag>" per
   tag (clear the rest, keep one). No refetch.

### 3.5 Nothing selected, no dominant filter

The orientation defaults (always present at the bottom even when a selection
exists, just ranked lower):
1. New task, `setIsCreatingTask(true)` (the page's `handleCreateTask`).
2. New high-level goal, `setIsCreatingGoal(true)` (the page's
   `handleCreateGoal`).
3. Clear filters, only shown when any of `projectFilterMode === "explicit"`,
   `selectedTags.length > 0`, or `!showShared` is in effect. Resets all three
   (`setProjectFilterMode("all")`, clear tags, `setShowShared(true)`).
4. Go to today, only shown when `ganttStartDate !== null`; calls
   `setGanttStartDate(null)` (the Toolbar's `handleResetToToday`).

### 3.6 Permission and mode states

- Read-only shared task selected, Open is enabled; Mark complete / Shift / Add
  dependency / Change project / Delete render disabled with "shared, view only".
- Lab mode, the chart can run in Lab Mode (`isLabMode`, user-colored bars, no
  drag, `onTaskClickLab`). When the Gantt is in Lab Mode the bar click routes to
  the lab popup, drag is off, and dependency linking is unavailable. The Gantt
  source detects Lab Mode the same way the chart does and, in that mode, drops
  the drag-dependent "Add a dependency" upgrade and the date-drag wording, while
  keeping Open / Mark complete / navigation (all store / API calls that work
  regardless of drag). This keeps the palette honest in Lab Mode.

## 4. NAVIGATE entities, jump targets

All NAVIGATE items are non-mutating jumps. Fuzzy fields per kind are listed.

1. Jump to a task
   - target, `setEditingTaskKey(taskKey(t))` (opens the detail popup; the chart
     is already showing the bar if in scope, otherwise the popup is the
     destination).
   - scope, empty query lists `filteredTasks` (on-screen) first; typing widens
     to all of `allTasks`.
   - fuzzy fields, `name` (primary), `tags`, the project name, the owner (for
     shared tasks). Echo, "<project>, <start> to <end>".
   - composite key, carries `taskKey(t)` so a shared task opens in the right
     owner namespace.

2. Jump to a project (sets the filter)
   - target, `setSelectedProjects([encodeFilterKey(p)])` which, combined with
     the store's `toggleProject` semantics, scopes the Gantt to that one
     project. To be explicit and deterministic, call
     `setProjectFilterMode("explicit")` then
     `setSelectedProjects([encodeFilterKey(p)])`.
   - fuzzy fields, project `name`, `tags`, `owner`.
   - echo, "scope the timeline to this project". This is NAVIGATE-as-filter, the
     same gesture the Project Surface "View timeline" deep link uses
     (`/gantt?project=<owner>:<id>`, Toolbar lines 99 to 117).

3. Jump to a goal
   - target, `setEditingGoal(g)` (opens the goal modal) OR, if we prefer a
     softer jump, scroll the goals sidebar to it; v1 opens the modal.
   - fuzzy fields, goal `name`, the SMART-goal texts.
   - echo, "milestone, due <end>".

4. Jump to a date in the timeline (pan)
   - target, `setGanttStartDate(<monday of the target>)`. Because the window is
     store-driven (not a scroll position), "pan to a date" is a single store
     write, no DOM scrolling needed. Snap to the Monday of the requested date
     the same way the Toolbar's `handleCalendarChange` does (`getMonday`).
   - input, accept absolute dates ("Jul 1", "2026-07-01") and a few relatives
     ("today" -> `setGanttStartDate(null)`, "next month"). Relative parsing is a
     small helper, reuse whatever date parser Calendar's "next monday" jump uses
     when that source lands, to avoid two parsers.
   - echo, "show the week of <Mon DD>".

NAVIGATE preserves deep-link conventions where they exist. The Gantt already
accepts `?project=<owner>:<id>` and `?createGoal=1`. A cross-page jump INTO the
Gantt (from the global layer) should set `?project=` rather than dropping the
user on a bare `/gantt`, matching the master doc's deep-link rule.

## 5. RESULTS, the "recently edited tasks" substitute

The Gantt has no saved artifacts (no alignments, no reports; that is a Sequences
and Purchases idea). The master doc proposes "Recently edited tasks" as the
RESULTS substitute. This is buildable and worth shipping:

- Source, tasks sorted by recency. Tasks carry version-control attribution
  stamps elsewhere in the app; goals carry `last_edited_at`. If tasks expose a
  comparable `last_edited_at` / updated timestamp, sort by it descending and
  take the top 5 to 8. If no per-task timestamp is reliably present, fall back to
  a lightweight client-side "recently touched in this session" list, the Gantt
  source records the last few `editingTaskKey` values the user opened / the last
  tasks a palette command mutated, capped and de-duplicated, and surfaces those
  as RESULT rows ("Reopen <name>").
- Row, kind RESULT, label the task name, detail "edited <relative time>" or
  "opened just now", `run` = `setEditingTaskKey(taskKey(t))`, hint "Open".
- Empty, when there is no recency signal yet, omit the RESULTS group entirely
  (do not render an empty header).

Recommendation, ship the session-local "recently opened / edited" list in v1
(zero new data plumbing, always correct), and upgrade to a persisted
last-edited sort if and when tasks expose a stable timestamp. This keeps RESULTS
honest rather than faking a "recent" order from array position.

## 6. COMMANDS, the full long-tail set (grouped)

These are always available (the typed-search tail), independent of selection.
Grouped by the master doc's command-group convention. Each lists its handler and
invalidation.

Create
- New task, `setIsCreatingTask(true)`. invalidate `["tasks"]` on save.
- New high-level goal, `setIsCreatingGoal(true)`. invalidate `["goals"]`.
- New task on <hovered date>, only when a date is hovered (2.2),
  `setNewTaskStartDate(ds)` + `setIsCreatingTask(true)`. invalidate `["tasks"]`.

Filter and scope
- Filter by project, opens the project picker, sets `explicit` mode +
  `setSelectedProjects([...])`. No refetch.
- Show all projects, `setProjectFilterMode("all")`. No refetch.
- Show only standalone tasks, `setProjectFilterMode("explicit")` +
  `setSelectedProjects([STANDALONE_FILTER_KEY])`. No refetch.
- Filter by tag, per-tag toggle via `toggleTag(tag)` (one command per known tag,
  built from the page's `allTags`). No refetch.
- Clear all filters, reset project mode to all, clear tags, `showShared` true.
  No refetch.
- Toggle shared tasks, `setShowShared(!showShared)`. No refetch.

Timeline view
- View, 1W / 2W / 3W / 1M / 3M / 6M / 1Y / All, `setViewMode(value)` for each of
  the eight `VIEW_MODES`. No refetch.
- Go forward / back one week, `ganttNavigateWeeks(1)` / `ganttNavigateWeeks(-1)`.
  No refetch.
- Go to a date, prompts for a date, `setGanttStartDate(getMonday(date))`. No
  refetch.
- Go to today, `setGanttStartDate(null)`. No refetch.

Bulk
- Confirm pending bulk move, only present when `bulkMoveData` is set; runs the
  modal's confirm (`tasksApi.move(taskId, { new_start_date, confirmed: true })`
  + refetch `["tasks"]`). This is a convenience mirror of `BulkMoveModal`; v1 may
  omit it since the modal is already on screen.

Export
- There is NO Gantt-specific export in the current code (the Toolbar's old
  animation / export affordances were removed; the legacy `?animations=1` param
  is now just stripped on arrival, Toolbar lines 89 to 98). So no export
  command. If a timeline export ships later it lands here as a RESULT-producing
  command (master doc's generalized Phase 5 idea), not in v1.

Navigate (page-level)
- Go to the full search, "Search everything for <query>" hands off to `/search`
  (the deep faceted task search), per the master doc's global handoff.

## 7. `useBeakerSearchSource` implementation sketch for Gantt

A typed source object the page registers while mounted. It reads the same store
slices and queries the page already reads, and calls the same handlers. Pseudocode
(not final TS), real hooks and handlers named.

```ts
// In app/gantt/page.tsx (or a co-located useGanttBeakerSource hook), called
// after the existing queries + store reads so all data is in scope.
useBeakerSearchSource(useMemo<PaletteSource>(() => ({
  id: "gantt",

  // ---- CONTEXT --------------------------------------------------------------
  context(hover) {
    // hover = the provider's last data-beaker-target record, or undefined.
    const selectedTask = editingTaskKey
      ? allTasks.find((t) => taskKey(t) === editingTaskKey) ?? null
      : null;
    const selectedGoal = editingGoal ?? null;
    const hoveredTask =
      hover?.kind === "task"
        ? allTasks.find((t) => taskKey(t) === hover.key) ?? null
        : null;
    const hoveredGoal =
      hover?.kind === "goal" ? goals.find((g) => g.id === hover.id) ?? null : null;
    const hoveredDate = hover?.kind === "date" ? hover.date : null;

    return {
      focused: undefined, // Gantt has no single focused entity; scope is identity
      selected: selectedTask
        ? { kind: "task", task: selectedTask, readOnly: isTaskReadOnly(selectedTask) }
        : selectedGoal
        ? { kind: "goal", goal: selectedGoal }
        : undefined,
      hovered: hoveredTask
        ? { kind: "task", task: hoveredTask, readOnly: isTaskReadOnly(hoveredTask) }
        : hoveredGoal
        ? { kind: "goal", goal: hoveredGoal }
        : hoveredDate
        ? { kind: "date", date: hoveredDate }
        : undefined,
      onScreen: {
        projectScope: projectScopeLabel(projectFilterMode, selectedProjectIds, activeProjects, projectColors),
        tags: selectedTags,
        showShared,
        window: ganttWindow(ganttStartDate, viewMode), // { start, end } as in Toolbar
      },
      renderHint: "gantt-scope-card",
    };
  },

  // ---- SUGGESTED ------------------------------------------------------------
  suggested(ctx) {
    const out: EditorCommand[] = [];
    const tref = ctx.selected ?? ctx.hovered; // selection beats hover
    if (tref?.kind === "task") {
      const t = tref.task, key = taskKey(t), ro = tref.readOnly;
      out.push(cmd(`Mark "${t.name}" ${t.is_complete ? "incomplete" : "complete"}`,
        t.is_complete ? "currently complete" : "currently in progress",
        async () => { await tasksApi.update(t.id, { is_complete: !t.is_complete }, t.owner);
                      await refetch(["tasks"]); await refetch(["task", key]); }, !ro));
      out.push(cmd(`Shift "${t.name}" dates`, `${t.start_date} to ${t.end_date}`,
        () => setEditingTaskKey(key), !ro)); // v1 opens the date editor in the popup
      out.push(cmd(`Add a dependency from "${t.name}"`, "link to another experiment",
        () => openDependencyPicker(t), !ro && t.task_type === "experiment"));
      out.push(cmd(`Open "${t.name}"`, "view and edit details", () => setEditingTaskKey(key)));
      out.push(cmd(`Move "${t.name}" to a project`, projectOf(t),
        () => openProjectPicker(t), !ro));
      out.push(cmd(`Delete "${t.name}"`, "moves to Trash",
        async () => { if (!confirm(`Delete "${t.name}"? It moves to Trash.`)) return;
                      await tasksApi.delete(t.id, t.owner); setEditingTaskKey(null);
                      await refetch(["tasks"]); await refetch(["dependencies"]); }, !ro));
    } else if (tref?.kind === "goal") {
      const g = tref.goal;
      out.push(cmd("Edit the goal", g.name, () => setEditingGoal(g)));
      out.push(cmd("Add a task under this goal", "new experiment toward it",
        () => { if (g.start_date) setNewTaskStartDate(g.start_date); setIsCreatingGoal(false); setIsCreatingTask(true); }));
      out.push(cmd(`Mark goal ${g.is_complete ? "incomplete" : "complete"}`, "",
        async () => { await goalsApi.update(g.id, { is_complete: !g.is_complete }); await refetch(["goals"]); }));
      out.push(cmd("Delete the goal", "cannot be undone", () => handleDeleteGoal(g)));
    }
    // Filter-active suggestions
    const proj = dominantProject(projectFilterMode, selectedProjectIds, activeProjects);
    if (proj) {
      out.push(cmd(`Add a task to ${proj.name}`, "", () => openCreateInProject(proj)));
      out.push(cmd("Clear the project filter", "show all projects", () => setProjectFilterMode("all")));
    }
    if (selectedTags.length) out.push(cmd("Clear the tag filter", selectedTags.map((t) => `#${t}`).join(" "),
      () => selectedTags.forEach(toggleTag)));
    // Always-on orientation defaults (ranked last)
    out.push(cmd("New task", "", handleCreateTask));
    out.push(cmd("New high-level goal", "", handleCreateGoal));
    if (anyFilterActive()) out.push(cmd("Clear filters", "", clearAllFilters));
    if (ganttStartDate) out.push(cmd("Go to today", "", () => setGanttStartDate(null)));
    return out;
  },

  // ---- ENTITIES -------------------------------------------------------------
  entities(ctx, query) {
    const pool = query.trim() ? allTasks : filteredTasks; // widen on type
    const taskItems = pool.map((t) => nav("task", taskKey(t), t.name,
      `${projectName(t) ?? "Standalone"}, ${t.start_date} to ${t.end_date}`,
      () => setEditingTaskKey(taskKey(t)), [/* fuzzy: */ t.name, ...(t.tags ?? []), projectName(t), t.owner]));
    const projectItems = activeProjects.map((p) => nav("project", encodeFilterKey(p), p.name,
      "scope the timeline", () => { setProjectFilterMode("explicit"); setSelectedProjects([encodeFilterKey(p)]); },
      [p.name, ...(p.tags ?? []), p.owner]));
    const goalItems = goals.map((g) => nav("goal", String(g.id), g.name,
      `milestone, due ${g.end_date}`, () => setEditingGoal(g), [g.name, ...g.smart_goals.map((s) => s.text)]));
    return [...taskItems, ...projectItems, ...goalItems];
  },

  // ---- RESULTS --------------------------------------------------------------
  results() {
    return recentlyTouchedTaskKeys().map((key) => {
      const t = allTasks.find((x) => taskKey(x) === key);
      return t ? result(key, t.name, "opened recently", () => setEditingTaskKey(key)) : null;
    }).filter(Boolean);
  },

  // ---- COMMANDS (long tail) -------------------------------------------------
  commands() {
    return [
      cmd("New task", "", handleCreateTask),
      cmd("New high-level goal", "", handleCreateGoal),
      ...VIEW_MODES.map((vm) => cmd(`View, ${vm.label}`, "", () => setViewMode(vm.value))),
      cmd("Go forward one week", "", () => ganttNavigateWeeks(1)),
      cmd("Go back one week", "", () => ganttNavigateWeeks(-1)),
      cmd("Go to today", "", () => setGanttStartDate(null)),
      cmd("Go to a date", "", () => openDatePrompt()),
      cmd("Show all projects", "", () => setProjectFilterMode("all")),
      cmd("Show only standalone tasks", "", () => { setProjectFilterMode("explicit"); setSelectedProjects([STANDALONE_FILTER_KEY]); }),
      ...allTags.map((tag) => cmd(`Filter by tag #${tag}`, "", () => toggleTag(tag))),
      cmd("Clear all filters", "", clearAllFilters),
      cmd("Toggle shared tasks", showShared ? "currently shown" : "currently hidden", () => setShowShared(!showShared)),
    ];
  },
}), [/* deps: every store slice + query result read above */]));
```

`cmd` / `nav` / `result` are thin builders producing the master doc's item kinds
(COMMAND / NAVIGATE / RESULT) with `iconName` from the verified `<Icon>` library
(task, target / goal, folder / project, calendar / date). `refetch(key)` =
`queryClient.refetchQueries({ queryKey: key })`. The provider owns ranking,
rendering, keyboard, and merging with the global layer.

Invalidation summary by command (what `run` triggers):

| Command | Refetch keys |
| --- | --- |
| Mark complete / incomplete | `["tasks"]`, `["task", key]` |
| Shift dates (move, with cascade) | `["tasks"]` (and `bulkMoveData` route for confirm) |
| Add dependency | `["dependencies"]`, `["tasks"]` |
| Change project | `["tasks"]`, `["task", key]`, `["projects"]` |
| Delete task | `["tasks"]`, `["task"]`, `["dependencies"]` |
| New task (on save) | `["tasks"]`, `["dependencies"]` |
| Goal create / update / complete / delete | `["goals"]` |
| Filter / view / shared / nav commands | none (pure store state) |

## 8. Keyboard, states, edge cases, permissions, open questions

### 8.1 Keyboard

Inherited from the shared provider, Cmd-K opens / closes, up / down move
(skipping disabled and non-selectable rows), Enter runs / navigates / reopens the
highlighted row, Escape closes and restores focus. No Gantt-specific bindings;
the page's own keys (none global today) are untouched.

### 8.2 Empty vs typed

- Empty query, render order, context card (full), Suggested (the contextual
  block from section 3), page Entities (tasks scoped to `filteredTasks`, then
  projects, then goals), Recent results (if any), the page command groups, then
  the slim global section.
- Typed query, the card slims to one line; everything else collapses to one
  fuzzy-ranked list across commands + entities + results + global, grouped by
  kind, per the master doc.

### 8.3 Edge cases

- No tasks loaded yet, `allTasks` empty (the page logs this and renders all
  tasks as a fallback). The source returns no task entities; Suggested still
  offers New task / New goal. The context card shows the scope with no selection
  line.
- Explicit mode with empty `selectedProjectIds`, the Gantt shows nothing (the
  Clear state). The context card scope reads "No projects" and the top Suggested
  surfaces "Show all projects" to recover.
- Shared task whose project lives in another owner's namespace, it bypasses the
  project filter (`page.tsx` line 148) and always shows when `showShared`. The
  source must not try to resolve its project via a local `owner:id` key; use
  `external_project` when present (the chart already prefers the cross-owner
  host, GanttChart line 1789) and otherwise label it by owner.
- A `move` that triggers a cascade, the palette's Shift command must route
  `requires_confirmation` into `bulkMoveData` so the existing `BulkMoveModal`
  takes over, never silently apply a multi-task shift.
- Archived projects, `activeProjects` already excludes them; entities and
  filters built from `activeProjects` inherit that.
- Stale selection, if `editingTaskKey` points at a task no longer in `allTasks`
  (deleted in another tab), `context()` resolves it to null and SELECTED falls
  back to none; no crash.

### 8.4 Permissions and modes

- Read-only shared task, mutating Suggested rows render disabled with "shared,
  view only"; Open and navigation stay enabled. The predicate is exactly
  `is_shared_with_me && shared_permission !== "edit"`.
- Lab Mode, drag-based dependency linking is unavailable and bar click routes to
  the lab popup; the source drops the "Add a dependency" upgrade and the
  drag-flavored wording in that mode (section 3.6).
- Goal permissions, owner goals fully editable; shared goals treated as
  read-only for delete / complete in v1 (refine when goal sharing UI settles).

### 8.5 Gantt-specific open questions

1. Hovered-bar capture, confirmed feasible since bars are React divs we can tag
   with `data-beaker-target`. Decision needed, do we also tag day cells for
   "New task on <date>", or keep hover scoped to task / goal bars in v1.
2. Scroll-to-date, RESOLVED in principle, the window is store state
   (`ganttStartDate` + `viewMode`), so "pan to a date" is `setGanttStartDate`,
   not DOM scrolling. Open, the relative-date parser ("next month", "next
   monday"); share one parser with the Calendar source rather than writing two.
3. Forced-project create, "Add a task to <project>" and "Add a task under this
   goal" want TaskModal to accept a pre-selected project. Today the modal
   defaults to the first active project (TaskModal line 237). Decision, add a
   store field (e.g. `restrictedProjectKey`, mirroring the existing
   `restrictedTaskType` / `newTaskStartDate` pattern) so create commands can
   force the project, or accept that v1 opens create with the right START DATE
   but the user picks the project.
4. The Shift-dates command, v1 opens the detail popup's date editor (safe, no
   new UI). v2 wants an in-palette date sub-prompt that calls `tasksApi.move`
   directly and hands cascades to `BulkMoveModal`. Confirm which ships first.
5. RESULTS recency source, ship the session-local "recently opened / edited"
   list in v1; decide later whether to persist a real last-edited sort if tasks
   expose a stable timestamp.
6. projectFilterMode reality check, the store has only `"all" | "explicit"`
   (NOT the "explicit/implicit/off" triad the master doc sketched). This spec
   uses the real two-mode model; the master doc's Gantt blurb should be reconciled
   to it.
