# Lists-as-Workbench-tab redesign — proposal

## Context

Grant flagged a direction shift mid-rollout of the `/results` kill (`AGENTS.md` §8 entry at line 395): completed list tasks shouldn't live as a small accordion bolted to the bottom of the Workbench Experiments tab — they belong in their **own Workbench tab**, sitting alongside Experiments and Notes. The chip-3 accordion at [WorkbenchExperimentsPanel.tsx:164,301-314,726-788](frontend/src/components/workbench/WorkbenchExperimentsPanel.tsx:164) was a transitional staging area. This proposal designs its replacement. Purchases stays as its own top-level `/purchases` page (chip 2 of the /results kill, see [AGENTS.md:377](AGENTS.md:377)) — no consolidation pressure from this work.

This proposal is the fourth in a series of UX-thesis exercises and follows the same pattern as the prior three:

- **[EXPERIMENTS_REDESIGN_PROPOSAL.md](EXPERIMENTS_REDESIGN_PROPOSAL.md)** turned `/lab` Experiments into an outcomes-first gallery (Fresh / Active / Awaiting / Earlier, hero thumbnails, method comparisons). Shipped at `761dd90d` via [LabExperimentsPanel.tsx](frontend/src/components/LabExperimentsPanel.tsx).
- **[EXPERIMENTS_STANDALONE_PROPOSAL.md](EXPERIMENTS_STANDALONE_PROPOSAL.md)** reshaped the single-user `/experiments` page into a stages-based decision queue (Ready → Blocked → Running → Awaiting writeup → Recent results → Earlier) and renamed the route to `/workbench`. Shipped at `d4030e3b`.
- **RESULTS_PAGE_PROPOSAL.md** (committed in-tree at `ba8d10f4`, file removed after the kill landed) recommended killing `/results` and folding its three jobs into Workbench's Earlier section, a new `/purchases` Earlier accordion, and a `<ProjectDetailPopup>` "Recently completed" line. Fully shipped across chips 1–4 (`c83528aa`, `46683036`, `48a6e456`, `5b237d92`).

That third arc just stabilized — the working tree is in a clean post-kill state, every absorbing surface is on local main, and the four-chip rollout was logged in `AGENTS.md` §8 at `66206833`. This is the right moment to plan the next Workbench tab: the codebase is settled, the patterns for adding tabs to Workbench are now well-trodden, and there's no in-flight work in the Workbench tree that this proposal would collide with.

**LOCKED decision per master 4.0:** The chip-3 list-task accordion at [WorkbenchExperimentsPanel.tsx:726-788](frontend/src/components/workbench/WorkbenchExperimentsPanel.tsx:726) is being removed in this redesign. The temporary-accordion state is documented in `AGENTS.md` §8 at commit `66206833` (line 395). This proposal designs the **replacement home** — not whether to replace it. The structural "no Lists tab" option below treats the accordion's content as something it must explicitly relocate, not preserve.

The data model already supports the redesign: `Task.task_type` carries `"experiment" | "purchase" | "list"` ([types.ts:200](frontend/src/lib/types.ts:200)), `Task.sub_tasks: SubTask[] | null` holds the checkbox children ([types.ts:207](frontend/src/lib/types.ts:207)), and `SubTask = { id, text, is_complete }` ([types.ts:171-175](frontend/src/lib/types.ts:171)) is what `<TaskDetailPopup>`'s sub-tasks panel renders today. There's no priority field, no separate deadline field — `start_date` + `duration_days` (and the derived `end_date`) are the only date signals. That data-shape constraint shapes every proposal below.

## Current state — where list tasks live today

Inventory of every place a list task currently renders in the frontend, verified by reading each file. The chip-3 accordion is the only surface dedicated to list tasks; every other one mixes types.

- **Home (`/`)** at [page.tsx:474-492](frontend/src/app/page.tsx:474) — list tasks appear in each project card's "Next Up" upcoming list, filtered by `!t.is_complete && t.start_date >= today`. **No task-type discriminator** — list and experiment rows render identically except experiments get a purple vertical bar from `experiment_color` and list tasks get no indicator at all. Visual parity gap: a researcher scanning Home can't tell from the row face whether a "Next Up" item is a 3-day PCR run or a 5-minute reading checkbox.
- **`/gantt`** at [GanttChart.tsx:545](frontend/src/components/GanttChart.tsx:545) — list tasks are **excluded** from the main timeline view (`task_type !== "list"`). When they do render (lab-mode override paths), they get a thin white border + checklist icon — a deliberately weak treatment because the Gantt bets list work isn't timeline-shaped.
- **Lab Gantt** at [LabGanttChart.tsx:245](frontend/src/components/LabGanttChart.tsx:245) — same exclusion, hard-filtered.
- **`<ProjectDetailPopup>`** at [ProjectDetailPopup.tsx:611-729](frontend/src/components/ProjectDetailPopup.tsx:611) — four sections, all mix task types: **In Progress** (line 615, all types, no type indicator on list rows), **Upcoming** (line 671, same), **Recently completed** (line 700, 30-day window, all types, list rows get a gray fallback bar from the otherwise-experiment-color treatment at line 715), **Hosted from others** (line 741, cross-owner tasks). The popup is the closest thing list tasks have to a dedicated home today, but it's per-project and the rows are visually equivalent to experiments.
- **`<TaskDetailPopup>`** at [TaskDetailPopup.tsx:75,1806-1888](frontend/src/components/TaskDetailPopup.tsx:75) — the **sub-tasks panel** (progress bar, checkboxes, add/remove sub-task affordances) only renders when `task.task_type === "list"`. This is the single editorial surface for sub-tasks; nowhere else exposes the checkbox progress.
- **`<TaskModal>`** at [TaskModal.tsx:68,203,442,518](frontend/src/components/TaskModal.tsx:68) — create-task form defaults to `taskType = "list"` and shows the sub-task input when that's selected. List tasks are the default new-task shape; this is a deliberate signal about how common they are.
- **Workbench Experiments tab** at [WorkbenchExperimentsPanel.tsx:301-314,726-788](frontend/src/components/workbench/WorkbenchExperimentsPanel.tsx:301) — **the chip-3 transitional accordion.** State variable `listArchiveOpen` at line 164. The `completedListTasks` memo at lines 301-314 filters `task_type === "list" && is_complete`, sorts newest-first by `end_date`. The accordion itself spans lines 726-788: a single chevron toggle ("Completed list tasks (N)"), and on expand a flat `<ul>` of rows — project color dot, task name, project name, end date. Clicks open `<TaskDetailPopup>`. **This is the locked-removal target.**
- **`/calendar`** at [calendar/page.tsx](frontend/src/app/calendar/page.tsx) — verified: the calendar fetches events only (no `tasks` query in the file). No task rendering of any type. Not a competitor.
- **`/links`** at [links/page.tsx](frontend/src/app/links/page.tsx) — links are a separate entity (`LabLink`, no `task_type` field). Hyperlinks + reference URLs. Not a competitor for list tasks.
- **`/purchases`** at [purchases/page.tsx](frontend/src/app/purchases/page.tsx) — pipeline + Earlier accordion (chip 2 of /results kill). Purchase-typed only. Per Grant's direction (`AGENTS.md` §8 line 395), this stays separate from the Lists tab. The parallel structure is interesting — both Purchases and Lists are "this task type's dedicated surface" — but they don't consolidate.

**Fixture coverage today** (verified by `grep -l '"task_type": "list"'` against `frontend/public/demo-data/users/*/tasks/*.json`):

| User | Task id | Name | `is_complete` | Sub-tasks |
|---|---|---|---|---|
| alex | 1 | Design pYES-GAL1::flbA construct | **true** | yes |
| alex | 6 | Send sequencing — top 4 | false | (check) |
| alex | 12 | Compile growth-curve results | false | (check) |
| alex | 13 | Update lab onboarding doc | false | (check) |
| alex | 14 | Review morgan's draft figures | false | (check) |
| alex | 20 | Set up demo lab onboarding doc skeleton | **true** | yes |
| morgan | 4 | Draft Chapter 2 outline | false | (check) |
| morgan | 5 | Send draft figures to alex | false | (check) |

Eight total list-task fixtures: 2 completed (chip 3's additions — `alex/1.json` and `alex/20.json`, both carry `sub_tasks`), 6 active. The active fixtures are mostly clustered around `start_date: 2026-05-14` — there's no "Overdue by 5 days" fixture, no "Upcoming next month" fixture, and no list task shared between users. This shapes the fixture-work delta below.

**What the data model carries** (Task / SubTask shapes, [types.ts:171-225](frontend/src/lib/types.ts:171)):

- `task_type: "experiment" | "purchase" | "list"` — the discriminator.
- `name: string` — the task title.
- `start_date: string` (ISO YYYY-MM-DD), `duration_days: number`, `end_date: string` (derived/cached) — the only date signals. No separate `deadline` or `due_date` field.
- `is_complete: boolean` — top-level completion. Independent of `sub_tasks[].is_complete`.
- `sub_tasks: SubTask[] | null` — `{ id: string, text: string, is_complete: boolean }` per child.
- `tags: string[] | null`, `sort_order: number`.
- `owner: string`, `shared_with: SharedUser[]`, `is_shared_with_me?: boolean`, `external_project?` — sharing model is identical to experiments + purchases.
- **No priority field. No urgency. No deadline distinct from `end_date`.** Any thesis that wants priority-shaped stages needs a data-model addition.

## Differentiation analysis

For each adjacent surface, what it owns and where the Lists tab would overlap. File paths verified.

| Surface | What it owns (one sentence) | Overlap with Lists tab? |
|---|---|---|
| **Workbench Experiments tab** ([WorkbenchExperimentsPanel.tsx](frontend/src/components/workbench/WorkbenchExperimentsPanel.tsx)) | Stage-organized decision queue for experiments only — Ready / Blocked / Running / Awaiting writeup / Recent results / Earlier, hero thumbnails, method chips, dep-graph "Blocked by:" / "Next:" callouts. | **Conceptual neighbor only.** Different task type. The stage thesis transfers (Workbench has shown stages can land); the rich card primitive (`<ExperimentResultCard>` with hero images + method chips) does not transfer to list tasks. Lists need their own lighter primitive. |
| **Workbench Notes tab** ([NotesPanel.tsx](frontend/src/components/NotesPanel.tsx)) | Single-user notes — meeting minutes, running logs, free-form text. Two filter modes (`single` vs `running`) for one-off vs. ongoing log. Search by title. | **Low overlap.** Notes are free-form text-blob items; list tasks are structured-checkbox items. Mentally adjacent (both "non-experiment writing surfaces") but conceptually distinct. Notes don't have dates, projects, or completion states the way list tasks do. |
| **`<ProjectDetailPopup>`** ([ProjectDetailPopup.tsx:611-729](frontend/src/components/ProjectDetailPopup.tsx:611)) | Per-project task surface — In Progress / Upcoming / Recently completed (30d, all types) / Hosted from others. Mixed task types within each section, lightly visually differentiated. | **High overlap on a per-project basis.** Active list tasks already appear here today, mixed with experiments. The unique signal a Lists tab adds vs. the project popup is **cross-project view** — "what list work do I have across all my projects" — which the popup can't answer (it's project-scoped). |
| **Home `/`** ([page.tsx:474-492](frontend/src/app/page.tsx:474)) | Per-project progress glance — completion percentage, in-progress / overdue / upcoming counts, "Next Up" task list (mixed types). Click → `<ProjectDetailPopup>`. | **Medium overlap on active list tasks.** Home's "Next Up" lists already surface list tasks alongside experiments. The unique Lists-tab signal is type-isolation (filter view to lists only) + the cross-project unified view + the sub-task progress reveal that Home doesn't carry. |
| **`/gantt`** ([GanttChart.tsx:545](frontend/src/components/GanttChart.tsx:545)) | Timeline-shaped, list-tasks **excluded**. | **No overlap by design.** The Gantt's bet is list work isn't timeline-shaped; the Lists tab's bet is list work isn't time-axis-shaped either — it's checkbox-shaped. The two views are complementary, not redundant. |
| **`/calendar`** ([calendar/page.tsx](frontend/src/app/calendar/page.tsx)) | External ICS feeds + calendar events. No task rendering at all. | **No overlap.** Confirmed — verified no `tasks` query in the file. |
| **`/links`** ([links/page.tsx](frontend/src/app/links/page.tsx)) | URL/reference cards with categories + previews. Separate data shape (`LabLink`, not `Task`). | **No overlap.** Different entity. Worth noting because the chip-3 brief flagged it as a possible competitor — it isn't. |
| **`/purchases`** ([purchases/page.tsx](frontend/src/app/purchases/page.tsx)) | Order-pipeline + Earlier accordion for `task_type === "purchase"`. | **Structural parallel, no data overlap.** Both Purchases and Lists are "this task type's dedicated surface." Different data, different lifecycle, no need to share rendering or routing. The pattern is the same — that's it. |

**Unique signal the Lists tab adds:** the **cross-project, list-tasks-only browse view** with checkbox progress visible at row level. Today there's no single surface that says "show me every list task I have across every project." `<ProjectDetailPopup>` is per-project. Home buries lists inside per-project "Next Up." The Gantt excludes them. The chip-3 accordion only shows completed ones. The Lists tab fills that gap.

**Where the Lists tab might fail to differentiate** (honest):

- If a user thinks "list work is just per-project admin," the project popup already covers them and a Lists tab is over-architecture. This is the load-bearing assumption of the structural "no Lists tab" option below.
- The cross-project unified browse pattern was rejected for completed *experiments* in the /results kill (the cross-type unification gap in [RESULTS_PAGE_PROPOSAL.md](RESULTS_PAGE_PROPOSAL.md) Proposal A). If that workflow isn't valued for experiments, it's worth asking whether it's valued for lists. The honest difference: list tasks have **far less per-item depth** than experiments (no results.md, no images, no methods) — so the cost of browsing them across projects is much lower, and the value of seeing "what admin work is on my plate" cross-project is plausibly higher because admin work is fungible across projects.

## Candidate theses considered

Seven theses evaluated. Theses A, B, and F (the structural option) are fleshed out below. The rest are rejected with reasoning.

1. **Stage-lite queue mirroring Experiments.** Sections like Overdue / Doing / Upcoming / Recently done / Earlier — fewer stages than Experiments because list tasks don't have "Awaiting writeup" or rich "Blocked" semantics (no dep graph for list tasks). Fleshed out as **Proposal A (recommended)**.

2. **Flat checkable list grouped by project + collapsed Earlier accordion.** Simpler, scannable, matches how todo lists naturally read. Fleshed out as **Proposal B**.

3. **STRUCTURAL: don't add a Lists tab.** Active list tasks stay in `<ProjectDetailPopup>` (where they already are); completed list tasks fold into the popup's "Recently completed" section (already covers them today, no time cap needed). The chip-3 accordion's content gets absorbed into the project popup, not preserved as a standalone surface. Fleshed out as **Proposal F**.

4. **Kanban board — To Do / Doing / Done columns, drag-to-update.** *Considered, rejected.* Kanban is a heavyweight UI for a simple list. List tasks rarely transition states the way Kanban cards do — there's no "in review" or "approved" intermediate state, just "started" and "done." Drag-to-update doesn't map cleanly to `start_date` / `is_complete` either; the user would have to drag a card from To Do to Doing to fire `start_date = today`, which is non-obvious. Visual weight (three columns of rectangular cards) is excessive for what's usually 10–30 items. The Workbench Experiments tab has already established the convention "sections-stacked-vertically, not columns" — Kanban breaks that. Rejected.

5. **Priority-shaped — Urgent / Soon / Whenever / Done.** *Considered, rejected because the data model doesn't carry priority.* Implementing this would require adding a `priority: "urgent" | "soon" | "whenever"` field to `Task`, which is a data-model migration with all the costs that implies: migration script for existing tasks, UI in `<TaskModal>` for setting priority, sort-order interactions, possibly a per-user default-priority preference. The cost-to-value ratio isn't favorable: priority is fundamentally subjective, users diverge on what "urgent" means, and the alternative — date-anchored signals from `start_date` / `end_date` — already conveys urgency without new metadata. If priority emerges as a real need *after* the Lists tab lands, it can be retrofit then.

6. **Date-anchored — due-this-week / due-this-month / overdue.** *Considered, mostly subsumed by Proposal A.* Date-anchoring is the spine of Proposal A's stage assignment (a task is "Overdue" if `end_date < today && !is_complete`, "Doing" if `start_date <= today <= end_date`, etc.). A pure date-anchored proposal that ignored sub-task progress and shared-task visibility would be strictly worse than Proposal A — the only differences would be cosmetic (date-grouped headers like "This week" instead of stage-named headers like "Doing"). Folded into Proposal A.

7. **Sub-task-flattened (every open sub-task as its own row).** *Considered, rejected as the primary thesis.* Tempting because list tasks' real atomic unit is the sub-task, not the parent. But flattening loses parent context — three sub-tasks of "Update lab onboarding doc" become three separate rows competing with "Send draft figures to alex" as if they were sibling tasks, when they're actually one parent's children. Also collides with `<TaskDetailPopup>`'s sub-task panel as the editorial home — if sub-tasks have their own rows in the Lists tab, where do you check them off (the Lists tab row, the popup, both)? Rejected as primary thesis but worth borrowing one piece: each parent row should show a sub-task progress hint (`☐ ☑ ☑ 2/3 done`) so the checkbox-shaped data is visible at-a-glance.

---

## Proposal A — Stage-lite queue (recommended)

**One-sentence pitch:** A third Workbench tab labeled **Lists** that organizes the current user's list tasks into a smaller set of stages than Experiments — **Overdue / Doing / Upcoming / Recently done / Earlier** — using a lightweight `<ListTaskRow>` primitive that surfaces parent name, project, sub-task progress, date signal, and a one-tap completion checkbox; clicks open `<TaskDetailPopup>` for the editorial view.

**Core user question answered:** *"What admin / list work is on my plate right now across every project, and what's slipping?"*

**What it shows / what it deliberately hides:**

- **Shows:** every list task owned by or shared with the current user, organized into five stage sections (defined precisely below); sub-task progress at row level (`2/3 done`); date signal at row level (`Started 2d ago`, `Due in 4d`, `Done yesterday`); the global project-filter pill strip; a `+ New List Task` button.
- **Hides (vs. today's scattered state):**
  - The chip-3 accordion (deleted; its content lives in the new Recently done / Earlier sections).
  - The home-page mixed surfacing of list tasks alongside experiments in "Next Up" — those rows still show on Home, but Home is no longer the only place to find them.
  - The `<ProjectDetailPopup>`'s implicit "you might have list tasks scattered across projects" pressure — explicit per-project context is preserved, but the cross-project glance is now in the Lists tab.
- **Does NOT show:** archived/deleted list tasks (already filtered upstream by the standard task loader); list tasks owned by other lab members that aren't shared with you (mirrors the single-user scope of the Experiments tab — there is no Lab Lists view in this proposal).

**Stage definitions** (precise — these go into a `frontend/src/lib/workbench/listSectionAssignment.ts` helper, mirroring the pattern at [sectionAssignment.ts](frontend/src/lib/workbench/sectionAssignment.ts)):

1. **Overdue** — `!is_complete && end_date < today`. Sorted by `end_date` ascending (oldest-overdue first). Forcing-function section: empty when clean, conspicuous when not.
2. **Doing** — `!is_complete && start_date <= today <= end_date`. Sorted by `start_date` descending (most-recently-started first). The "currently happening" slice.
3. **Upcoming** — `!is_complete && start_date > today`. Capped at 14 days out by default; older ones drop to a "Scheduled later (N)" footer hint matching the Experiments tab pattern. Sorted by `start_date` ascending.
4. **Recently done** — `is_complete && end_date >= today - 30 days`. Sorted by `end_date` descending (newest-first). Visible by default; rows render with a strikethrough on `name` + a muted check icon.
5. **Earlier** — `is_complete && end_date < today - 30 days`. Collapsed accordion by default (chevron + count); no time cap on expand. Matches the Experiments tab's Earlier section pattern but lighter — no project-grouping toggle since list-row density is already low.

If `is_complete && end_date` is null/invalid, the task lands in Recently done with `null` sort key (renders at the bottom of that section).

**ASCII wireframe:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Workbench                                                                  │
│  4 list tasks awaiting completion                                           │
│                                                                             │
│  ┌──────────┐ ┌──────────┐ ┌────────────┐                                   │
│  │ Experim. │ │  Notes   │ │   Lists ●  │   (active tab — emerald-like)     │
│  └──────────┘ └──────────┘ └────────────┘                                   │
│  ───────────────────────────────────────────────────────────────────────    │
│                                                                             │
│  [ Aging study ] [ Cardio cells ] [ Pilot data ]      [ + New List Task ]   │
│                                                                             │
│  ── OVERDUE (1) ──────────────────────────  end_date past, not complete ── │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ ☐  Send sequencing — top 4                  ☐ ☐ ☐ ☑     0/4 done    │    │
│  │    Cardio cells · Due 3d ago         (red chip: ⚠ 3d overdue)       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  ── DOING (2) ────────────────────────────────  in progress today ────────  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ ☐  Review morgan's draft figures           ☑ ☐                 1/2  │    │
│  │    Pilot data · Started today                                       │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │ ☐  Update lab onboarding doc               ☑ ☑ ☐ ☐             2/4  │    │
│  │    Aging study · Started yesterday                                  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  ── UPCOMING (1) ─────────────────────────  scheduled within 14d ─────────  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ ☐  Compile growth-curve results                              0/0    │    │
│  │    Cardio cells · Starts in 5d                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  ── RECENTLY DONE (2) ──────────────────────  completed in last 30d ────    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ ☑  ̶D̶e̶s̶i̶g̶n̶ ̶p̶Y̶E̶S̶-̶G̶A̶L̶1̶:̶:̶f̶l̶b̶A̶ ̶c̶o̶n̶s̶t̶r̶u̶c̶t̶    ̶☑̶ ̶☑̶ ̶☑̶  3/3       │    │
│  │    Aging study · Done 8d ago                                        │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │ ☑  ̶R̶e̶v̶i̶e̶w̶ ̶p̶r̶e̶v̶i̶o̶u̶s̶ ̶a̶s̶s̶a̶y̶ ̶d̶a̶t̶a̶          ̶☑̶ ̶☑̶      2/2          │    │
│  │    Pilot data · Done 2d ago      (shared by morgan: amber pill)     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  > Earlier (12)  ←  collapsed accordion, click chevron to expand            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

Legend: `☐` = unchecked sub-task; `☑` = checked sub-task; `̶t̶e̶x̶t̶` = strikethrough on completed parent. The amber "shared by morgan" pill matches the existing `<SharedFromPill>` at [WorkbenchExperimentsPanel.tsx:135](frontend/src/components/workbench/WorkbenchExperimentsPanel.tsx:135).

**Key interactions:**

1. **Click anywhere on a row** → opens `<TaskDetailPopup>` (same launch contract every other surface uses), defaulting to the sub-tasks panel.
2. **Click the top-level checkbox** (the `☐` at the left of the row) → toggles `is_complete` on the parent task via `tasksApi.update`, optimistically updates the row's section assignment (a "Doing" row moves to "Recently done" with a fade transition). No popup opens. This is the one-tap completion path that doesn't exist on any other surface today.
3. **Hover the sub-task progress indicator** → renders a small popover listing each sub-task with its check state. **Read-only** in v1 — checking from the popover would require keystroke-shaped state management that's not justified for the marginal time saved. Sub-tasks are still checked from the popup.
4. **Click a project pill** → soft-toggles the global `selectedProjectIds` filter (same store used by Workbench Experiments).
5. **Click `+ New List Task`** → opens `<TaskModal>` with `restrictedTaskType = "list"` (the modal already supports this — see [TaskModal.tsx:68,203](frontend/src/components/TaskModal.tsx:68)). No `start_date` injection (unlike Experiments' "+ New Experiment", which seeds today's date) — leave the date picker blank because list tasks are often "no firm start date, just on my plate."
6. **Click the Earlier chevron** → expands the accordion in place. No time cap on expanded content; client-side render of however many earlier completed list tasks exist.

**Differentiation from sibling surfaces:**

The Lists tab is the only surface that (a) shows list tasks isolated from other task types, (b) shows them cross-project in one view, (c) surfaces sub-task progress at row level instead of behind a popup click, and (d) provides one-tap parent-completion without opening a popup. Workbench Experiments shares the stage thesis but is experiments-only; `<ProjectDetailPopup>` shares the row-level visibility but is per-project; Home shows scattered list rows mixed with experiments and without sub-task progress. None of the four sibling surfaces is the same view.

The shared shell (the Workbench tab bar at [workbench/page.tsx:14,57-84](frontend/src/app/workbench/page.tsx:14)) means a user who's already learned the Experiments tab's mental model — "stages of work, scroll top to bottom" — gets the Lists tab nearly for free. Same project-filter strip, same `<TaskDetailPopup>` launch on click, same `+ New X Task` affordance on the right of the filter row.

**Shared primitives consumed:**

- The Workbench tab shell at [workbench/page.tsx](frontend/src/app/workbench/page.tsx) — the `TabType` discriminator widens from `"experiments" | "notes"` to `"experiments" | "notes" | "lists"`, one more button added to the tab bar at lines 71-83. Mirrors the existing Notes button's icon + color treatment (a different accent color for visual differentiation — emerald is taken by Notes, suggest indigo or violet for Lists).
- `<TaskDetailPopup>` from [TaskDetailPopup.tsx](frontend/src/components/TaskDetailPopup.tsx) — unchanged. The sub-tasks panel inside the popup is still the editorial home.
- `<TaskModal>` from [TaskModal.tsx](frontend/src/components/TaskModal.tsx) — unchanged, consumed via the existing `restrictedTaskType` mechanism.
- `<SharedFromPill>` at [WorkbenchExperimentsPanel.tsx:135-157](frontend/src/components/workbench/WorkbenchExperimentsPanel.tsx:135) — should be lifted to a shared component (`frontend/src/components/SharedFromPill.tsx`) since both Experiments and Lists tabs need it. The pill itself is 22 LOC; extraction is trivial.
- `useAppStore`'s `selectedProjectIds`, `toggleProject`, `setIsCreatingTask`, `setRestrictedTaskType` — same store hooks the Experiments tab uses, no additions needed.
- `fetchAllTasksIncludingShared` from [local-api](frontend/src/lib/local-api.ts) — canonical merged-view loader (decorates `is_shared_with_me`, surfaces hosted tasks, composite-keys for dedup). Same query the rest of Workbench shares (`queryKey: ["tasks", currentUser]`).

**New primitives needed:**

- `<ListTaskRow>` at `frontend/src/components/workbench/ListTaskRow.tsx`. A horizontal row with: leading checkbox (toggles parent `is_complete`), task name (strikethrough when complete), project name + color dot, date signal text, sub-task progress indicator (`☐☐☑ 1/3`), optional shared-from pill on the right. Approximately 100 LOC. NOT a card primitive — list tasks don't justify the card weight that `<ExperimentResultCard>` carries. Specifically does NOT consume `<ExperimentResultCard>` — that primitive's hero-thumbnail + method-chips + freshness-tag treatment is over-built for a 1-line checkbox row.
- `listSectionAssignment.ts` helper at `frontend/src/lib/workbench/listSectionAssignment.ts`. Simpler than the experiment counterpart at [sectionAssignment.ts](frontend/src/lib/workbench/sectionAssignment.ts) — no dependency graph, no result-probe needed. ~40 LOC: a single `assignListSection(task, { today }): "overdue" | "doing" | "upcoming" | "recent" | "earlier"` function.
- `<WorkbenchListsPanel>` at `frontend/src/components/workbench/WorkbenchListsPanel.tsx`. The panel component the Workbench page mounts when `activeTab === "lists"`. Approximately 250 LOC: fetches tasks, filters to lists, runs section assignment, renders the project-filter strip + section stack. Mirrors the structure of `<WorkbenchExperimentsPanel>` but much thinner (no probe pass, no method lookup, no dep graph).

**Data model implications:** None. The proposal works against today's `Task` + `SubTask` shape. No new fields, no migration. The sub-task progress indicator is a render-time `task.sub_tasks?.filter(s => s.is_complete).length` calculation — no caching needed for the volumes a single user will have (rarely more than ~50 list tasks total). If someday a user has thousands of list tasks, the calculation could be memoized; not justified for v1.

**Fixture work required:**

Current fixture set is thin for showcasing all five stages. Specifically:

- **Overdue section** has no fixture today — all 6 active list tasks have `end_date >= 2026-05-06` and "today" in `?wikiCapture=1` mode is `2026-05-14`, so most active fixtures are currently in Doing or Upcoming. Need at least **1 overdue list task** to populate the section in the empty-state-anchored screenshot (e.g. `alex/21.json`: `start_date: 2026-05-08`, `end_date: 2026-05-10`, `is_complete: false`, sub_tasks 1/3 done — a "Send paperwork — overdue" archetype).
- **Upcoming section** could use **1 fixture more than 14 days out** to demonstrate the "Scheduled later (N)" footer hint (e.g. `alex/22.json`: `start_date: 2026-06-15`, `is_complete: false` — a paper-prep milestone).
- **Recently done section** has 2 today (`alex/1.json` and `alex/20.json` from chip 3); both have `is_complete: true` and `sub_tasks` populated. Could add **1 more** to make the section visibly multi-row, but the existing 2 are workable.
- **Earlier section** has 0 fixtures (no completed list tasks past 30 days). Need **2 fixtures with `end_date` past 30 days ago** to demonstrate the collapsed-by-default Earlier accordion has content. (e.g. `morgan/8.json` and `alex/23.json` both with `end_date: 2026-04-01`).
- **Shared list task** — chip 3 added 5 demo fixture entries but the `?wikiCapture=1` mode currently has zero list tasks shared between alex and morgan, so the `<SharedFromPill>` path is uncovered. Need **1 shared list task** (e.g. `morgan/9.json` with `shared_with: [{ "username": "alex", "permission": "edit" }]` and `is_complete: true`, end_date within 30 days, to render on alex's Recently done section).

**Total fixture delta: ~5 new task fixtures** (1 overdue + 1 scheduled-later + 1 recent-done + 2 earlier + 1 shared = 5 net new — overlaps consolidate to 5). Generation effort: ~30 minutes of `scripts/generate-demo-data.mjs` editing + a `demo:images` + `demo:zip` regenerate per the [27aa8204 playbook](AGENTS.md#L399). Plus 1 wiki screenshot capture (`workbench-lists.png`) via `?wikiCapture=1` mode per the [Screenshot privacy memory](file://memory).

**Implementation effort estimate: M.**

- New files: `<WorkbenchListsPanel>` (~250 LOC), `<ListTaskRow>` (~100 LOC), `listSectionAssignment.ts` (~40 LOC), `<SharedFromPill>` extraction (~25 LOC, moved from WorkbenchExperimentsPanel). New total: ~415 LOC.
- Modified files: `workbench/page.tsx` (tab bar widens to 3 buttons, `activeTab` state widens; ~30 LOC delta). `WorkbenchExperimentsPanel.tsx` (remove `listArchiveOpen`, `completedListTasks` memo, accordion section at lines 726-788, `SharedFromPill` lift; **-90 LOC net**). Total modified delta: ~-60 LOC net.
- Fixture work: 5 new `tasks/*.json` files (~30 lines each = ~150 lines), updates to `scripts/generate-demo-data.mjs` to seed them (~50 LOC), `demo:images` + `demo:zip` regenerate.
- Wiki: a new page at `frontend/src/app/wiki/features/lists/page.tsx` (~120 LOC, mirroring the structure of `frontend/src/app/wiki/features/experiments/page.tsx`), one new screenshot `workbench-lists.png` (~250 KB). Update `frontend/src/lib/wiki/nav.ts` to add the new wiki entry. Update `WIKI_SCREENSHOTS.md` script reference.
- Tests: a unit test for `listSectionAssignment.ts` (~80 LOC, mirrors [sectionAssignment.test.ts](frontend/src/lib/workbench/sectionAssignment.test.ts) if that exists; otherwise a fresh test file). Snapshot or integration test for `<WorkbenchListsPanel>` rendering is optional for v1.
- **Total: ~600 LOC across panel + row + section logic + tests + wiki page, plus ~200 lines of fixture JSON, plus regenerate step.** Single chip, roughly an afternoon if the implementer is fluent in the Workbench tab pattern.

**Risks / open questions:**

- **One-tap completion checkbox conflict.** Today, ticking a sub-task happens in the popup. The Lists-tab proposes ticking the *parent* `is_complete` at row level. If a user has 1/3 sub-tasks done and clicks the row-level checkbox, do we (a) just mark parent complete and leave sub-tasks 1/3, (b) mark parent + all-unfinished sub-tasks as complete (cascade), (c) refuse to complete if sub-tasks remain (forcing-function). Recommend (a) for v1 — minimal change, most reversible, no opinion on data integrity. Open question for Grant: does (b) or (c) match how you think about list-task completion?
- **The 14-day Upcoming cap.** Borrowed from Experiments tab's "Scheduled later" pattern. For list tasks the natural horizon might be longer (paper-prep milestones can be 6 weeks out, conference-deadline lists 3 months out). 14 days might be too tight; 30 might fit better. Open question.
- **No Lab Lists view.** Proposal is single-user; doesn't add a counterpart in `/lab` the way Lab Experiments mirrors single-user Experiments. The thesis here is that list work is administrative and per-user — labmates don't need to scan each other's todo lists. If that's wrong, a Lab Lists view becomes a sibling chip.
- **The strikethrough treatment on completed rows.** Visually heavier than the muted-row pattern Workbench Experiments uses for "Recent results" cards (which doesn't strikethrough — completion is implied by being in the section). Strikethrough is a stronger checkbox-list convention. Worth committing to one — proposal says yes-strikethrough but flagging as a small visual call.
- **Project-filter pill strip duplication.** Each Workbench tab renders its own copy of the strip today (Experiments at lines 506-536, Notes doesn't filter by project). Lists would too. As Workbench grows, the strip should probably lift to `<WorkbenchPage>` itself (above the tab bar), not duplicate per tab. Out of scope for this chip; flag as follow-up.

---

## Proposal B — Flat checkable list grouped by project + Earlier accordion

**One-sentence pitch:** A third Workbench tab labeled **Lists** that renders all active list tasks grouped by project (matching how todo-style work is mentally organized — "what do I need to do for the Aging study?"), with a `<ListTaskRow>` row primitive identical to Proposal A's, and a single collapsed-by-default Earlier accordion at the bottom for completed-and-archived items. No stage sections.

**Core user question answered:** *"What's on my plate for each project, top to bottom?"*

**What it shows / what it deliberately hides:**

- **Shows:** all active list tasks grouped by project, each group a small block with a project-colored header; within each group, rows sorted by `start_date` ascending. A "Recently done" inline strip per project below each group (last 30 days, no stage section). A single Earlier accordion at the bottom collecting *all* completed list tasks past 30 days across projects.
- **Hides:** the stage thesis from Experiments. Lists are simpler — done or not — so the date-anchored stage assignment in Proposal A is over-architected for them. Specifically hides Overdue as a dedicated section (overdue rows still render in their project group, just with a red date chip).
- **Does NOT show:** anything else differently from Proposal A — same scope (single-user, list-only, cross-project), same row primitive, same one-tap completion.

**ASCII wireframe:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Workbench   →  Lists tab                                                   │
│                                                                             │
│  [ Aging study ] [ Cardio cells ] [ Pilot data ]      [ + New List Task ]   │
│                                                                             │
│  ── ● AGING STUDY (3 open, 2 done) ────────────────────────────────────     │
│                                                                             │
│  ☐  Update lab onboarding doc                ☑ ☑ ☐ ☐         2/4 done       │
│      Started yesterday                                                      │
│  ☐  Compile growth-curve results                            0/0             │
│      Starts in 5d                                                           │
│  ☐  Send sequencing — top 4                  ☐ ☐ ☐ ☑        1/4             │
│      ⚠ 3d overdue                                                           │
│                                                                             │
│  ↳ Recently done: ̶D̶e̶s̶i̶g̶n̶ ̶p̶Y̶E̶S̶-̶G̶A̶L̶1̶:̶:̶f̶l̶b̶A̶ (8d ago) · ̶S̶e̶t̶ ̶u̶p̶ ̶d̶o̶c̶ (102d ago)  │
│                                                                             │
│  ── ● CARDIO CELLS (1 open, 0 done) ───────────────────────────────────     │
│                                                                             │
│  ☐  Review morgan's draft figures            ☑ ☐              1/2           │
│      Started today          (shared by morgan)                              │
│                                                                             │
│  ── ● PILOT DATA (0 open, 0 done) ─────────────────────────────────────     │
│                                                                             │
│      No list tasks for this project yet.                                    │
│                                                                             │
│  > Earlier (12 completed list tasks past 30 days)  ←  click to expand       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

Legend same as Proposal A. The per-project "Recently done" inline strip is a small footnote-style line inside each project block, not a separate section.

**Key interactions:** Identical to Proposal A on row click, checkbox click, project-pill toggle, `+ New List Task`. Different: no stage navigation, and the per-project inline "Recently done" strip is a hover-to-expand tooltip-y treatment rather than a fully rendered subsection.

**Differentiation from sibling surfaces:**

The project-grouped structure overlaps **heavily** with `<ProjectDetailPopup>` (which is also project-grouped, also shows In Progress / Upcoming / Recently completed for that project). The unique signal vs. the popup is (a) cross-project scrollable view in one screen, (b) list-tasks-only filter, (c) sub-task progress at row level. But the structural similarity is real — a critic could argue the Lists tab in this proposal is "the project popup, opened on all projects at once, filtered to list tasks." That's a fair description; the bet is the cross-project glance is worth its own surface.

**Shared primitives consumed:** Identical to Proposal A — `<TaskDetailPopup>`, `<TaskModal>`, `useAppStore` filter hooks, `fetchAllTasksIncludingShared`, lifted `<SharedFromPill>`. Same Workbench tab shell changes.

**New primitives needed:**

- `<ListTaskRow>` — same primitive as Proposal A. Reuse 100%.
- `<WorkbenchListsPanel>` — the project-grouped variant. Approximately 200 LOC (smaller than Proposal A because no stage-assignment helper). Mirrors the project-grouped Earlier section pattern at [WorkbenchExperimentsPanel.tsx:678-722](frontend/src/components/workbench/WorkbenchExperimentsPanel.tsx:678).
- No `listSectionAssignment.ts` helper needed (just group by `project_id` directly in the panel).

**Data model implications:** None.

**Fixture work required:** Smaller than Proposal A because there are no Overdue / Upcoming sections needing dedicated fixtures. Still need:

- 2 completed-past-30-days fixtures for the Earlier accordion (same as Proposal A).
- 1 shared list task for the `<SharedFromPill>` path (same as Proposal A).
- 1 overdue-in-a-project fixture so the red date chip is captured in the screenshot (same task as Proposal A's overdue, just rendered inline rather than in a separate section).

**Total fixture delta: ~4 new task fixtures** (versus 5 in Proposal A — saves the "Scheduled later" fixture since there's no Upcoming cap to demonstrate). Same ~30 min generation effort.

**Implementation effort estimate: S/M.**

- New files: `<WorkbenchListsPanel>` (~200 LOC), `<ListTaskRow>` (~100 LOC), `<SharedFromPill>` extraction (~25 LOC). Total: ~325 LOC. About 70 LOC lighter than Proposal A.
- Modified files: same as Proposal A (tab bar widens, chip-3 accordion removed, ~-60 LOC net).
- Fixture work: 4 new fixtures (~120 lines), generator updates (~40 LOC), regenerate.
- Wiki: same as Proposal A.
- Tests: lighter — no section-assignment unit test. Optional snapshot test only.
- **Total: ~450 LOC across panel + row + tests, plus ~160 lines of fixture JSON, plus regenerate step.** Single chip, roughly half a day.

**Risks / open questions:**

- **Project popup redundancy.** Hardest critique: this view is structurally close to "open every project popup at once, filtered to list tasks." If users already use project popups for their list work, the Lists tab adds the cross-project scroll but loses the per-project deep context (the popup's In Progress / Upcoming / Hosted-from-others / Recently completed sections all show). The bet is that scrolling beats clicking through 5 popups.
- **Stage signal loss.** Overdue rows don't get a dedicated section — they sit inside their project block with a red chip. For a user with 3 overdue list tasks spread across 3 projects, the overdue rows are visually scattered. Proposal A's dedicated Overdue section is a stronger forcing function. The honest tradeoff: B is simpler, A is more action-oriented.
- **Empty-project blocks.** A project with zero list tasks gets a "No list tasks for this project yet" stub block. With many projects this is noisy. Mitigation: hide empty blocks by default, add a "Show all projects" toggle. Adds ~20 LOC. Worth doing for v1.
- **Per-project "Recently done" inline strip is the awkward part.** The wireframe shows it as a single muted line per project block. In practice, with 5+ recently-done items per project, this either grows unwieldy or has to truncate. Truncation introduces "+ 3 more" affordances which are an extra UI primitive. Proposal A handles this cleaner with a dedicated cross-project Recently done section.

---

## Proposal F — STRUCTURAL: no Lists tab

**One-sentence pitch:** Don't add a Lists tab to Workbench. The chip-3 accordion gets removed (still locked); its content (completed list tasks) folds into `<ProjectDetailPopup>`'s "Recently completed" section, which already exists and already covers list tasks (`AGENTS.md` §8 line 380). Active list tasks stay where they are today — scattered across Home, project popups, and (newly proposed here) a per-project "Open list tasks" sub-section inside the project popup. No cross-project Lists browse view ships; the bet is no one actually needs it.

**Core user question answered:** *"Is the cross-project list-tasks-only view actually a workflow, or is it imagined?"* This proposal's bet is the latter.

**What it shows / what it deliberately hides:**

The structural option removes the existing chip-3 accordion but adds **no new top-level surface**. The replacement work happens entirely inside `<ProjectDetailPopup>`:

- **Inside `<ProjectDetailPopup>`**, a new "Open list tasks" section is added between "Upcoming" and "Recently completed" (at approximately [ProjectDetailPopup.tsx:670](frontend/src/components/ProjectDetailPopup.tsx:670)). Filters `t.task_type === "list" && !t.is_complete`. Renders the same `<ListTaskRow>` primitive Proposal A/B would have used. **Per-project scope.** This is the only new code path.
- **The popup's existing "Recently completed" section** (at line 700, 30-day cap, all task types) already covers completed list tasks. The chip-3 accordion was redundant with this even when it landed.
- **Active list tasks scattered across the rest of the app** stay scattered: Home's "Next Up" lists mix them with experiments; the Gantt continues to exclude them; the project popup's In Progress / Upcoming sections continue to mix types. No changes to those surfaces.

**ASCII wireframe** (focused on the one new surface — the project popup's new section):

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  AGING STUDY                                                       [×]      │
│  ────────────────────────────────────────────────                           │
│  Progress: ████████░░░░░░░░ 42%                                             │
│  18 tasks · 8 complete · 2 overdue · 8 upcoming                             │
│                                                                             │
│  ▸ In Progress (3)                                                          │
│    ● PCR optimization run 2 (started 2d ago)                                │
│    ● ☐ Update lab onboarding doc (started yesterday)                        │
│    ● Cell viability assay r1 (started today)                                │
│                                                                             │
│  ▸ Upcoming (4)                                                             │
│    ...                                                                      │
│                                                                             │
│  ▸ Open list tasks (2)                                       ← NEW SECTION  │
│    ☐  Send sequencing — top 4               ☐ ☐ ☐ ☑   ⚠ 3d overdue           │
│    ☐  Compile growth-curve results          0/0         Starts in 5d        │
│                                                                             │
│  ▸ Recently completed (4)                                                   │
│    ☑  Design pYES-GAL1::flbA construct  · Done 8d ago                       │
│    ● PCR optimization run 1 · Done 12d ago                                  │
│    ...                                                                      │
│                                                                             │
│  ▸ Hosted from others (1)                                                   │
│    ...                                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

The new "Open list tasks" section lives only inside the popup; nothing changes outside of it. Active list tasks still appear in "In Progress" / "Upcoming" too (those sections don't filter out list tasks today), so there's intentional duplication — a list task that's "In Progress" appears both there AND in "Open list tasks." The bet: the duplication is fine because users will use one section or the other, not both.

**Where the chip-3 accordion's content goes:** Completed list tasks were the accordion's only content. They live in two places after this proposal lands:

1. **`<ProjectDetailPopup>`'s existing "Recently completed" section** ([ProjectDetailPopup.tsx:700](frontend/src/components/ProjectDetailPopup.tsx:700)) — already shows completed list tasks today (all task types, 30-day window, gray fallback bar for non-experiment/non-purchase). No change needed; the chip-3 accordion was always redundant with this.
2. **Nowhere else.** The chip-3 accordion's cross-project completed-list-tasks browse view (no time cap, scrollable) is dropped. The bet: this archive was a "by the way you also have these" footer, not a workflow.

**Gap analysis** (the actual decision point):

| Use case the Lists tab would serve | Covered after F by | Quality of coverage |
|---|---|---|
| "What admin work is on my plate cross-project?" | No replacement. Users open each project popup and scan. | **Worse.** This is the only real workflow gap. |
| "What's overdue across my projects?" | Home's per-project overdue count + project popup's overdue rows. | **Equal.** Same coverage as today. |
| "Did I finish that reading task last week?" | Project popup's "Recently completed" section (already covers list tasks today, 30-day window). | **Equal.** Same as today; the chip-3 accordion was redundant with this. |
| "Show me my full completed-list-tasks archive ever" | No replacement. Falls back to `/search` with `task_type: list && completionStatus: complete`. | **Worse, but maybe trivia.** Cross-project all-time list-task archives are exactly the "list-task trivia" the /results kill recommendation dismissed in [RESULTS_PAGE_PROPOSAL.md](RESULTS_PAGE_PROPOSAL.md) Proposal A. |
| "Tick a list task complete without opening the popup" | No replacement. Today, all list-task completion happens through `<TaskDetailPopup>`. | **Worse.** The one-tap completion affordance the Lists tab would offer is lost. |
| "See sub-task progress at-a-glance without opening" | No replacement. Sub-task counts only visible inside the popup. | **Worse.** A real signal-density loss. |

**The structural option's load-bearing assumption:** the cross-project list-tasks-only browse view is **not** a real workflow. If that assumption is wrong, F's gaps add up to a worse user experience than Proposals A or B. The /results kill rolled forward a similar bet for completed experiments (the cross-type unification was deemed not a real workflow), and Grant validated that bet via the clickable-questions decision logged at [AGENTS.md:379](AGENTS.md:379). The Lists question is structurally analogous but the answer might differ: experiments are deep work (rich per-item content), so a unified browse view across projects has diminishing returns. List tasks are shallow work — the value of a unified view per item is lower, but the value of "what admin do I have to do today" cross-project is higher.

**Shared primitives consumed:** `<ProjectDetailPopup>` itself (modified). `<ListTaskRow>` (new — same as Proposal A/B but consumed only by the popup, not a tab). `<TaskDetailPopup>` for clicks. No tab-shell changes — `WorkbenchPage` stays at 2 tabs.

**Data model implications:** None.

**Fixture work required:** Smaller still than Proposal B. The new popup section needs to render plausibly:

- 1 overdue list task per popular project (chip 3's existing fixtures cover the project distribution acceptably).
- The 2 completed list tasks already on disk (chip 3's `alex/1.json` + `alex/20.json`) populate Recently completed via the existing 30-day section.
- 1 shared list task to demonstrate the shared-task path through the popup (could overlap with Proposal A/B's shared fixture).

**Total fixture delta: ~2 new task fixtures** (1 overdue + 1 shared). Even smaller than B.

**Implementation effort estimate: S.**

- New files: `<ListTaskRow>` (~100 LOC).
- Modified files: `<ProjectDetailPopup>` (~80 LOC added for the new section + filter logic + `<ListTaskRow>` integration). `WorkbenchExperimentsPanel.tsx` (chip-3 accordion removal, **-90 LOC net**).
- Fixture work: 2 new fixtures.
- Wiki: no new page. Possibly a small `/wiki/features/lists` page noting where list tasks live (~40 LOC), or fold the explanation into the existing `/wiki/features/experiments` page where Workbench is documented. Recommend the latter — it's an explicit "we considered a Lists tab, here's where list tasks live instead" paragraph.
- Tests: none new beyond what's already covered.
- **Total: ~100 new LOC, ~80 modified LOC, ~-90 LOC from the chip-3 accordion removal = +90 net LOC.** Half a day at most.

**Risks / open questions:**

- **The cross-project glance is the assumption.** If Grant routinely opens 3+ project popups looking for "what list work do I have to do," F is wrong — he'd be better served by the Lists tab. Honest question: is the cross-project workflow you use a real workflow, or a hypothesized one? Master 4.0 should ask Grant directly.
- **Active list tasks remain visually undifferentiated on Home.** The visual parity gap on `/` (experiments get a purple bar, list tasks don't) stays. Could be patched independently with a thin gray bar for list tasks (~5 LOC tweak), but it's out of scope of this proposal.
- **One-tap parent completion not added.** The convenience win that Proposal A's row-level checkbox provides is foregone. If you tend to mark list tasks complete in bulk ("did 4 admin things today, tick tick tick tick"), F is more friction than A.
- **Workbench stays at 2 tabs forever-ish.** The Workbench shell ends up Experiments-and-Notes-only. Conceptually cleaner (Workbench = decision queue + writing surface = a 2-mode mental model), but loses the option to grow into a third mode later without a bigger shell change.
- **Wiki implication is real.** Today the Workbench wiki page documents Experiments + Notes tabs. Either we add a "Where list tasks live" section to that page (small) or we add a separate `/wiki/features/lists` page anyway (which contradicts F's "no Lists tab" thesis a little).

---

## Recommendation

**Ship Proposal A — Stage-lite queue.**

Three factors swung the choice.

First, **the structural option (F) makes a load-bearing assumption with no evidence.** F's bet is that cross-project list-task browsing isn't a real workflow. There's no way to know that without shipping the Lists tab and seeing whether anyone uses it. The cost of being wrong on F is much higher than the cost of being wrong on A — F leaves a real gap (the cross-project glance) that Proposal A fills cheaply, while A's downside (a redundant tab if no one uses it) is a small UI cost that's reversible. Grant has been clear (`AGENTS.md` §8 line 395) that he wants the Lists tab — that's the direction signal. F evaluates it honestly anyway, and the conclusion is that the directional pull plus the cheap upside of A both point the same way.

Second, **A's stage-lite thesis is the right inheritance from Workbench Experiments.** The Workbench Experiments redesign committed to stages-based decision queues as the right mental model for a Workbench tab. A inherits that pattern faithfully and adapts it: Overdue / Doing / Upcoming / Recently done / Earlier is exactly the analog of Experiments' Ready / Blocked / Running / Awaiting writeup / Recent / Earlier, simplified where list tasks lack the corresponding semantics (no dep graph → no Blocked, no results probe → no Awaiting). The Workbench tab bar implies "each tab is a decision queue for its task type." Proposal B abandons that thesis in favor of project-grouping — which is fine in isolation but inconsistent with the sibling tab. The user who learns Experiments learns Lists nearly for free under A; under B they learn a different organizing principle.

Third, **A's Overdue section is a real forcing function.** The single most useful piece of /results today was the "No results yet" pill — the "which experiments haven't been written up?" nag. The Workbench redesign foregrounded that as "Awaiting writeup" and it was a strict upgrade. The Lists-tab analog is Overdue: a dedicated section that's empty when clean and conspicuous when not. Proposal B can render the same red chip on a row but loses the section-level visual nag. Proposal F loses both. The forcing function is worth shipping.

**Proposal B (flat by project) is rejected because of a single biggest gap: the Overdue forcing function is buried inside per-project blocks rather than foregrounded as its own section.** A user with 3 overdue list tasks spread across 3 projects sees them scattered across 3 separate visual blocks in B; under A they cluster in a single Overdue section that says "fix these first." That's the same upgrade Workbench Experiments' "Awaiting writeup" section delivered — surfacing the actionable case as its own block rather than burying it. B is the smaller chip and consistent with the project-shaped mental model `<ProjectDetailPopup>` uses, but the forcing-function loss is the right thing to weigh against, and A wins on it.

**Proposal F (no Lists tab) is rejected because of a single biggest gap: the cross-project list-task browse view that Grant explicitly asked for (`AGENTS.md` §8 line 395) doesn't get built.** The structural option absorbs the chip-3 accordion's content into `<ProjectDetailPopup>`'s existing "Recently completed" section (which already covers it — F is essentially "delete the accordion, change nothing else"). That's an honest, minimal-cost option, but it ignores the directional ask. If Grant's later judgment is that the cross-project Lists view isn't actually useful, the Lists tab is easy to remove (one tab-bar button + one panel file). Reversal cost is small.

**Specific chips for HR to coordinate:**

1. **One implementation chip** for the full Lists tab landing: `<WorkbenchListsPanel>`, `<ListTaskRow>`, `<SharedFromPill>` extraction, `listSectionAssignment.ts`, Workbench tab-bar widening, chip-3 accordion removal at [WorkbenchExperimentsPanel.tsx:164,301-314,726-788](frontend/src/components/workbench/WorkbenchExperimentsPanel.tsx:164). Single coherent chip — splitting risks an intermediate state where the new tab exists but the old accordion still does too.
2. **Fixture-and-screenshot follow-up chip** for the 5 new fixture tasks + `workbench-lists.png` capture + `wiki:coverage` updates. Independent — can land before, during, or after the implementation chip if `?wikiCapture=1` mode is fine with the existing fixtures during the gap.
3. **Wiki chip** for `/wiki/features/lists` page + nav entry. Independent of (1) but should land soon after. The wiki manager has related work backlogged ([AGENTS.md:475](AGENTS.md:475) on the `workbench-earlier.png` capture); flag whether this rolls into that update or stays separate.

**Recommendation requires no new metadata on the Task data model.** All proposals work against today's `Task` + `SubTask` shape. No migration, no field addition.

**Shared primitives the recommendation consumes:** Workbench tab shell ([workbench/page.tsx](frontend/src/app/workbench/page.tsx)), `<TaskDetailPopup>`, `<TaskModal>` with `restrictedTaskType`, `useAppStore`'s filter + create-task hooks, `fetchAllTasksIncludingShared`, the lifted `<SharedFromPill>`. New primitives introduced are deliberately list-task-shaped (`<ListTaskRow>`, `listSectionAssignment.ts`, `<WorkbenchListsPanel>`) — explicitly NOT consuming `<ExperimentResultCard>` because that primitive's hero-image + method-chip treatment is too heavy for a 1-line checkbox row.

## Migration / rollout notes

- **chip-3 accordion removal — locked.** Specific deletions in [WorkbenchExperimentsPanel.tsx](frontend/src/components/workbench/WorkbenchExperimentsPanel.tsx):
  - Line 164: remove `const [listArchiveOpen, setListArchiveOpen] = useState(false);`.
  - Lines 301-314: remove the `completedListTasks` `useMemo` block.
  - Lines 726-788: remove the entire `{completedListTasks.length > 0 && (<section>...)` block including the chevron toggle and `<ul>` of rows.
  - Total: ~90 LOC removed. The remaining file shrinks from 816 to ~726 LOC.
- **Fixture coverage (chip 3 added 2 completed list tasks at [alex/1.json](frontend/public/demo-data/users/alex/tasks/1.json) + [alex/20.json](frontend/public/demo-data/users/alex/tasks/20.json)):** preserve both (still used by Recently done in the new tab). Plus add **5 net new fixture entries** per the Proposal A fixture-work breakdown above: 1 overdue, 1 scheduled-later, 1 recent-done, 2 earlier, 1 shared (last item overlaps recent-done). All landed via `scripts/generate-demo-data.mjs` updates + `demo:images` + `demo:zip` regenerate per the [27aa8204 playbook](AGENTS.md#L399).
- **Nav implications:** no top-level nav changes. The Workbench tab bar widens from 2 buttons to 3 ([workbench/page.tsx:14,57-84](frontend/src/app/workbench/page.tsx:14)). The `TabType` union widens from `"experiments" | "notes"` to `"experiments" | "notes" | "lists"`. The header subtitle at line 49 widens too: `${upcomingCount} experiment${...} in flight` / `Meeting notes...` becomes a 3-way switch including `${listCount} list task${...} in flight` (or similar — let the implementation chip pick the exact copy).
- **Routing:** in-tab React state (the existing `useState<TabType>` pattern). No URL like `/workbench/lists`. Rationale: the existing tabs don't have URL state either, and adding it now would be inconsistent. If a per-tab URL pattern is ever desirable (deep-linking from the wiki, e.g.), it can be retrofit across all three tabs simultaneously.
- **Empty-state behavior:** when the user has zero list tasks (or zero matching the project filter), the panel renders an empty-state mirroring the Experiments panel's pattern at [WorkbenchExperimentsPanel.tsx:538-550](frontend/src/components/workbench/WorkbenchExperimentsPanel.tsx:538): centered "No list tasks yet" headline + smaller "Create one to see it here" subline + a `+ New List Task` button. When stages are individually empty (e.g. nothing Overdue but Doing has content), the empty stage simply doesn't render (matches the Experiments pattern of conditional section rendering — see `SECTION_ORDER.map` at lines 553-555).
- **Wiki implications:** new page at `frontend/src/app/wiki/features/lists/page.tsx` (~120 LOC, mirroring [experiments wiki page](frontend/src/app/wiki/features/experiments/page.tsx)). New screenshot `workbench-lists.png` via `?wikiCapture=1` fixture mode per [Screenshot privacy memory](file://memory). Add entry to `frontend/src/lib/wiki/nav.ts` under "Features". Update [scripts/check-wiki-coverage.mjs](scripts/check-wiki-coverage.mjs) only if the existing pattern requires it (the route is `/workbench` not `/lists`, so likely no coverage entry needed — verify during the wiki chip).

  Note: the wiki manager has backlog items relating to the prior Workbench tab (`workbench-earlier.png` capture + the post-/results-kill wiki refresh, see [AGENTS.md:475](AGENTS.md:475)). Coordinate whether the Lists wiki page rolls into that refresh as a single wiki chip or stays separate. Recommendation: roll in — both chips capture `?wikiCapture=1` shots of Workbench and share fixture-set state.

## What this proposal does NOT decide

- The exact accent color for the Lists tab button (Notes is emerald, Experiments is blue — Lists could be indigo, violet, amber). Pick during implementation; should match the rest of the tab bar's pastel palette.
- Whether the row-level top-level checkbox cascades to sub-tasks or not (the (a)/(b)/(c) choice in Proposal A risks). Recommendation: (a) — minimal, reversible, no opinion. Implementer can choose.
- Whether the 14-day Upcoming cap is right (Proposal A risks). Recommendation: ship at 14 days, revisit if it's tight.
- Whether the project-filter pill strip should lift from per-tab to Workbench-shell-level. Out of scope for this chip.
- Whether to add a Lab Lists view in `/lab` alongside Lab Experiments. Recommendation: no for v1; revisit if it's missed.
- Whether sub-task progress should also surface on the home-page "Next Up" rows (visual parity patch for list tasks). Out of scope; flag for follow-up.
- Whether the wiki Workbench page rewrite happens in this chip or the wiki-manager's pending refresh. Recommend rolling in.

## Open questions for Grant

1. **Section organization — A vs. B vs. F.** Does the stage-lite queue (A — recommended) match how you think about list work, or does the flat-by-project layout (B) fit better? The stages are: Overdue / Doing / Upcoming / Recently done / Earlier. The flat alternative is: project blocks with rows sorted by start_date, plus a single Earlier accordion. Pick the one that matches your mental model. **This is the single biggest decision-fork-y question** — it picks the proposal.

2. **Cascade-on-completion.** When you click the row-level top-level checkbox on a list task that has 1/3 sub-tasks done, should we (a) just mark the parent complete, leaving sub-tasks 1/3, (b) mark parent and all unfinished sub-tasks complete, or (c) refuse to complete until all sub-tasks are done? Recommendation is (a) — most reversible — but if you have a strong preference for (b) or (c), say so.

3. **Upcoming horizon.** Proposal A caps "Upcoming" at 14 days out, with older items dropping to a "Scheduled later (N)" footer. Does 14 days fit your list-work rhythm, or do you want 30, or 7?

4. **One-tap completion.** Proposal A adds a row-level checkbox that toggles parent `is_complete` without opening the popup. Useful or visually noisy? Today every completion path is popup-based.

5. **Wiki page scope.** New dedicated `/wiki/features/lists` page, or a section added to the existing `/wiki/features/experiments` page (which today documents Workbench)? The wiki manager has a related Workbench-refresh backlog item; coordinate scope.

6. **Lab Lists view.** Should there be a counterpart in `/lab` (a Lab Lists view mirroring Lab Experiments), or are list tasks definitionally single-user / not shared? Recommendation is no Lab Lists view in v1; revisit if you miss it.
