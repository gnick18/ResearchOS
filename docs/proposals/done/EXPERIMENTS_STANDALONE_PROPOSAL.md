# Standalone /experiments page redesign — proposal

## Context

The `/experiments` route (`frontend/src/app/experiments/page.tsx`, 793 lines) is the single-user counterpart to the `/lab` Experiments sub-tab. It is the same content type — `task_type === "experiment"` rows — but viewed in a completely different mode: only the current user's data, writable (the page has a `+ New Experiment` button that opens `TaskModal` directly), and project-filtered through the global `selectedProjectIds` store rather than a user-filter chip. The nav labels it **"Lab Notes"** (`frontend/src/lib/nav.ts:13`) — not "Experiments" — because the page is actually two sub-tabs in a trench coat: an "Experiments" pane (the bulk of the 793 lines) and a "Notes" pane that mounts `<NotesPanel />` for meeting notes. So when this proposal says "the /experiments page" it is really talking about the Experiments sub-tab of the Lab Notes route; the Notes sub-tab is a separate concern addressed in the rollout notes.

A sibling planning agent has already produced [EXPERIMENTS_REDESIGN_PROPOSAL.md](EXPERIMENTS_REDESIGN_PROPOSAL.md) for the `/lab` Experiments sub-tab. That proposal recommends an outcomes-first results gallery whose core question is *"what did the lab actually figure out this week?"* — a read-only view for a PI walking up to Lab Mode. The standalone `/experiments` page serves an audience that asks an almost opposite question: *"what should I run next, what's stuck, and which of my finished experiments still needs a writeup?"* — a writable workbench for a single researcher's morning planning ritual. The two pages share a `Task` model and a few primitives (`<TaskDetailPopup>`, project-color palettes, `taskKey`), but their theses diverge sharply enough that a one-size-fits-both redesign would short-change both.

The sibling agent flagged as a "surprise" that this single-user page is much more polished than the Lab sub-tab — project-grouped cards, stacked-card dependency visuals, status-colored borders, in-progress progress bars. That is true at the **CSS level**: the page is prettier. But the polish is mostly decorative. The cards carry only `name`, `start_date`, `duration_days`, a status badge derived from `end_date < today`, and a binary "Has Method" chip — the same information density as the Lab sub-tab's grouped view, just wrapped in nicer chrome. The data model gives us per-task `sub_tasks[]`, `tags[]`, `method_attachments[].variation_notes`, `deviation_log`, dependency edges, and the per-task `results/task-<id>/` directory with `notes.md` / `results.md` / `Images/` / `Files/`. Almost none of it reaches the screen. The page looks finished while quietly answering a thinner question than the page's prominence in the nav (second tab from the left) implies.

## Current state

Inventory of what `frontend/src/app/experiments/page.tsx` renders today:

- **Top-level layout** (`frontend/src/app/experiments/page.tsx:393-436`): page header `<h2>Lab Notes</h2>` with a count of upcoming experiments, then a two-button tab row — **Experiments** (blue) and **Notes** (emerald).
- **Notes sub-tab** (`frontend/src/app/experiments/page.tsx:438-441`): mounts `<NotesPanel />` and nothing else. Out of scope for the Experiments redesign but in scope for the rollout (see Migration).
- **Experiments sub-tab — project filter** (`frontend/src/app/experiments/page.tsx:447-477`): horizontal pill row of every project (own + shared), driven by `selectedProjectIds` in `useAppStore`. Plus a `+ New Experiment` button that opens `TaskModal` pre-restricted to `task_type === "experiment"`.
- **Upcoming experiments**, grouped by project (`frontend/src/app/experiments/page.tsx:480-652`): one section per project, each with a colored dot + uppercase tracking-widest project name + count chip ("3 experiments in 2 chains"). Underneath, a 3-column responsive grid of "chain cards." Each card represents the **root task** of a dependency chain (`experimentChains`/`groupedChains` at `frontend/src/app/experiments/page.tsx:139-358`).
  - Each card carries: the root task name (`line-clamp-2`), an "Overdue" / "In Progress" badge, a status-colored border (red-200 / emerald-200 / gray-200), the start date + duration ("2026-05-10 · 7d"), and a `Has Method` purple chip if `method_ids.length > 0` (`frontend/src/app/experiments/page.tsx:629-633`).
  - **For in-progress cards only**: a green-gradient progress bar (`frontend/src/app/experiments/page.tsx:570-582`) computing day X of Y from `start_date` and `duration_days`, and a "Day 3 of 7" label.
  - **For chains (`chainLength > 1`)**: two pseudo-cards stacked underneath via `absolute top-{1,2} left-{1,2}` divs (`frontend/src/app/experiments/page.tsx:548-554`) — purely visual, no per-child-task data is on the face of the card; a `Click to view chain →` footer hint and a `{chainLength} tasks` blue chip in the header.
- **Completed experiments dropdown** (`frontend/src/app/experiments/page.tsx:654-771`): a collapsed-by-default accordion. When open, repeats the same project-grouped chain-card layout but with `bg-gray-50` faded cards and a "Finished {end_date}" line. No further surfacing of results, attachments, or writeup status.
- **TaskDetailPopup** (`frontend/src/app/experiments/page.tsx:776-787`): clicking any card opens the full popup in editable mode (writable, in contrast to Lab Mode's read-only popup).

What the page **does not** surface, despite having the data available:

- `notes.md` / `results.md` presence or content. The single biggest gap: every experiment has a `users/<owner>/results/task-<id>/` directory (`frontend/src/lib/tasks/results-paths.ts`), and on a completed experiment the presence-or-absence of `results.md` is the most actionable signal in the data model — "I finished this 5 days ago and never wrote it up." It is invisible here.
- `sub_tasks[]` progress. A 5-step protocol with 3 sub-tasks done would show "3/5" — never rendered.
- Method names. The page shows a "Has Method" yes/no chip; the actual method names from `method_ids` + `methods` join are right there in the data hook but discarded.
- `tags[]`. No tag chips anywhere.
- `method_attachments[].variation_notes` or task-level `deviation_log`. Both signal "this run deviated from the protocol" — material information for someone planning the next replicate, and invisible.
- Blockers. A task whose parent in `dependencies` is incomplete is "blocked" — not surfaced. The dep-chain stacked visual hints at parent/child but says nothing about whether the parent has actually finished.
- Days-since-completion on the completed accordion. The card says "Finished 2026-05-08" but never "3 days ago"; for a "needs writeup" cue, the **time elapsed** is the actionable number.
- `experiment_color`. The field exists on the task; the card uses project color for the border, not the experiment's own color.
- Files / Images count on the per-task results dir. `/results` already walks that directory (`frontend/src/app/results/page.tsx:100-137`); `/experiments` doesn't.

**What the polish is achieving (the parts worth keeping):**

- The stacked-card dependency hint is a unique signal in the app — it's the only place a chain visually reads as a chain.
- The status-colored borders (red / emerald / gray) give an at-a-glance scan that the Lab Experiments sub-tab lacks.
- The "Day 3 of 7" progress bar on running experiments is the single most useful piece of derived data on the current page — exactly the kind of signal a planning view should carry.

**What the polish is masking (the parts that are incidental complexity):**

- The "Has Method" boolean chip is decoration; without method names it tells the user nothing they couldn't infer from "this is an experiment."
- The Completed accordion is "out of sight, out of mind" — collapsing the most actionable section (recently-finished-but-undocumented experiments) defeats its own purpose.
- The chain visual is a hint, not a tool: it implies a chain exists but offers no way to see the next-step task without opening the popup.

## How this differs from the /lab Experiments view

| Axis | `/experiments` (this page) | `/lab` Experiments (sibling proposal) |
|---|---|---|
| **Primary audience** | The researcher themselves, doing daily planning. | A PI or labmate doing read-only browsing of the whole lab. |
| **User scope** | Single user (current user only). | Cross-user (every researcher in the lab, filtered by user-chip selection). |
| **Mode** | Writable. `+ New Experiment`, full edit popup, drag-to-add anywhere. | Read-only. Every popup opens with `readOnly={true}`. |
| **Tense** | Forward-looking (default view is upcoming). Completed is a collapsed accordion. | Backward-looking (sibling proposal sections: Fresh results / Active / Awaiting / Earlier). Outcomes lead. |
| **Foregrounded question** | "What should I do next, and what's stuck?" | "What did the lab figure out, and who hasn't written up their finished work?" |
| **Foregrounded data** | Dates, dependency chains, status. (Today.) Should become: stage + blockers + writeup status. (Proposed.) | Hero images, `results.md` previews, freshness tags, contributor avatars. |
| **Filtering primitive** | Global `selectedProjectIds` (project chips). | Global user-filter chip (which lab members are included). |
| **Default sort** | Start date ascending (chronological forward). | Freshness of result (most-recent-result first). |
| **Notes sub-tab** | Yes (`<NotesPanel />` rendered as second sub-tab). | No — Lab Mode has a separate top-level Notes tab. |
| **Where it lives in nav** | Second tab (`/experiments`, labeled "Lab Notes" in `nav.ts:13`). | Sub-tab inside `/lab`. |

**Where the two views duplicate functionality today:** both render an experiment-only filtered task list. Both use the same `<TaskDetailPopup>` and the same color palette. Both group by project (in `/lab`'s grouped view) or have a project filter (in `/experiments`).

**Where they are genuinely distinct:** the audience is different (self vs others), the mode is different (write vs read), and the actionable signals are different (next-action planning vs outcome-browsing). Even with both pages rebuilt around their best theses, there is real reason to keep them separate — see the Recommendation for whether they should share components.

## What other views own

| View | Thesis (one sentence) | Data it foregrounds |
|---|---|---|
| `/` Home (`frontend/src/app/page.tsx`) | "Where do I stand on each project?" | Project cards with progress bar, active/overdue/upcoming counts, top-5 "Next Up" tasks (any type). |
| `/gantt` (`frontend/src/app/gantt/page.tsx`) | "When does everything happen, and how do I reshuffle it?" | Editable time axis with drag-shift, dependency cascade, high-level goal sidebar. |
| `/calendar` (`frontend/src/app/calendar/page.tsx`) | "What's today / this week, with my external feeds overlaid." | Date grid + ICS subscriptions; **no task data on the page at all**. |
| `/methods` (`frontend/src/app/methods/page.tsx`) | "Manage and edit my protocol library." | Folder tree of methods, markdown editor, PCR builder. |
| `/purchases` (`frontend/src/app/purchases/page.tsx`) | "Track items I've ordered." | Purchase task rows with vendor, cost, status. |
| `/results` (`frontend/src/app/results/page.tsx`) | "Browse my completed work with attachment + notes counts." | Project-grouped cards for `is_complete \|\| deviation_log` tasks; has-notes flag + attachment count. |
| `/search` (`frontend/src/app/search/page.tsx`) | "Find a specific thing in my data." | Free-text + structured filter results. |
| `/links` (`frontend/src/app/links/page.tsx`) | "Curated external links / Lab Links." | URL list, not relevant to tasks. |
| `/lab` Experiments (sibling proposal) | "What did the lab figure out this week?" | Hero thumbnails, `results.md` previews, freshness tags, awaiting-results section. |

The two closest neighbors in the single-user space are **Home** (project-organized planning across all task types) and **/results** (project-organized backward-looking completed work). The standalone `/experiments` page sits awkwardly between them: project-grouped like both, planning-oriented like Home, experiment-typed like /results, but not as clearly motivated as either.

## Candidate theses considered

Seven theses were evaluated. Proposals A, B, and the structural kill option (C) are fleshed out below.

1. **Stages-based decision queue.** (Fleshed out as Proposal A — recommended.) Replace the project-grouped "upcoming / completed accordion" structure with stage-organized sections: Ready to start → Running → Awaiting writeup → Recent results. Each section foregrounds the signal that's most actionable at that stage. Answers "what's my next move on each experiment?"

2. **Dependency-first DAG view.** (Fleshed out as Proposal B.) Turn the page into a graphical dependency DAG — each experiment a node, parents/children connected by edges, click-to-expand details. Answers "what's blocking my paper figure?" The current stacked-card chain hint becomes the explicit thesis.

3. **STRUCTURAL: kill `/experiments`.** (Fleshed out as Proposal C.) Delete the route. Fold "upcoming experiments" into Home's project cards with a richer per-project section. Fold "completed experiments" into `/results`. Move the Notes sub-tab to its own `/notes` route. Rebrand the "Lab Notes" tab as gone-and-redistributed.

4. **Hybrid: same gallery as the sibling's `/lab` Experiments, filtered to current user.** *Considered, rejected.* The sibling's recommendation is an outcomes-first gallery of `results.md` + `Images/` thumbnails. For a single user, that exact view **already exists at `/results`** (`frontend/src/app/results/page.tsx`) — completed tasks grouped by project, has-notes flag, attachment count. Building a second one filtered from the cross-user gallery would mean two near-identical single-user backward-looking views. The single-user audience does not need a *second* outcomes gallery; they need a forward-looking planning view that `/results` doesn't do.

5. **Lab-notebook chronological timeline.** *Considered, rejected.* A single timestamped feed of past + future entries ("ran X yesterday, plan to run Y on Friday"). The forward half of this is what `/gantt` already does (time axis with editable shift); the backward half is what the existing Activity panel in `/lab` does and what `/results` does for completed work. Adding a third chronological surface dilutes both.

6. **Project-progress dashboard.** *Considered, rejected.* Group experiments by project, show project-level progress bars + status rollups. This is **literally what `/` Home does today** (`frontend/src/app/page.tsx:411-431` — Active / Overdue / Upcoming counts plus a top-5 "Next Up" list per project). The only delta would be filtering to `task_type === "experiment"`, which is a 1-line change to Home, not a 793-line redesign of a separate page.

7. **Kanban swim-lanes with drag-to-update.** *Considered, rejected.* The most-natural redesign of "list of experiments with implicit stages" is a Kanban board with drag interactions. It is a viable interaction here (this view is writable; the sibling's Lab Mode is not), but **the data model has no stored status enum to drag against.** Stages are derived from `is_complete` + `start_date` / `end_date` + `results.md` presence. Dragging "Ready to start" → "Running" doesn't flip any field — those bins are computed from dates. The only real state change drag can trigger is "mark complete" (toggle `is_complete`), which is one transition out of four. Proposal A captures the same stage thesis without the drag overhead, and uses sections (full-width, more density per card) instead of narrow columns. Kanban is a flavor of A that pays a visual cost for an interaction the data model can't honor.

## Proposal A — Stages-based decision queue (recommended)

**One-sentence pitch:** Reorganize `/experiments` from "upcoming grouped by project, completed in an accordion" into "stages: Ready to start → Running → Awaiting writeup → Recent results," each section showing the signals that are most actionable at that stage and surfacing blockers / writeup gaps that today are invisible.

**Core user question answered:** *"What experiment should I work on right now, and what's stuck waiting on me?"*

**What it shows** (the four stage sections, top to bottom):

1. **Ready to start.** Experiments whose `start_date <= today` AND `!is_complete` AND every dependency parent in `dependencies` is `is_complete`. The "go" pile. Cards in this section foreground: experiment name, project (colored chip), method name(s) attached, days since `start_date` (a "should have started 3 days ago" cue if late), sub-task count if any, and a small `Start` action button that opens the popup. Default sort: oldest `start_date` first (most overdue starts ascend to top).
2. **Blocked.** Experiments whose `start_date <= today` AND `!is_complete` AND **at least one dependency parent is not complete**. Same card shape as Ready, but with a yellow border and an explicit "Blocked by: {parent task name}" line listing the unfinished parents. This is the single most useful signal the current page doesn't surface — today a blocked task and a ready task look identical.
3. **Running.** Experiments where `start_date <= today <= end_date` AND `!is_complete`. The "in flight" pile. Cards in this section foreground: experiment name, project, method names, **the existing Day X of Y progress bar (kept — this is the one piece of the current page worth preserving)**, sub-task progress ("3 of 5 sub-tasks done") if `sub_tasks[]` exists, a `deviation_log` indicator if non-empty (a small "⚠ deviated" chip), and a `notes.md` last-edited cue ("notes updated 2d ago") if the file exists. Default sort: most-recently-started (so the latest active work is at the top).
4. **Awaiting writeup.** Experiments where `is_complete` AND `end_date < today` AND (`results.md` missing or empty) AND (`Images/` empty). The "you finished it but didn't document it" pile — the forcing function. Cards in this section foreground: experiment name, project, methods used, **days-since-completion in red** ("completed 8d ago, no result logged"), and a `Write up` action button that opens the popup with a hint to the results editor. Default sort: oldest-completed-without-writeup first (i.e. the most-overdue writeup floats to the top). When this section is empty, render a single small green "✓ All recent experiments have results logged" line — the absence of work is itself the signal.
5. **Recent results.** Experiments completed in the last 30 days that have `results.md` content or `Images/` content. Cards in this section foreground: experiment name, project, completion date, attachment count, a thumbnail or markdown preview (same logic the sibling proposal uses for the Lab gallery, scoped to current user). Default sort: most-recently-completed first.

Below those five sections, an `── Earlier ──` collapsed accordion holds older completed-with-results experiments (same as today's collapsed completed accordion, but only for experiments that *have* results — the writeup-missing ones live in section 4 where they can't be ignored).

**What it deliberately hides:**

- **The project-grouped layout.** Today's page leads with project; this redesign leads with stage. Project becomes a colored chip on each card and a project-filter pill row above (unchanged from today). The thesis "where am I in my workflow" beats "which project is this in" for a planning view — Home is already the project-progress page.
- **The "Has Method" boolean chip.** Replaced with named method chips ("PCR-GFP-v2", "MTT-assay") that link into `/methods` on click.
- **The collapsed Completed accordion in its current form.** Split into "Awaiting writeup" (always visible — the actionable half) and "Earlier" (collapsed accordion — the inactionable archive).
- **The stacked-card chain visual.** Removed in favor of an explicit "Blocked by: X" line on Blocked-section cards and a "Next: Y" line on Running-section cards. The stacked visual is decorative; the explicit textual link is data.

**ASCII wireframe of the main view:**

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Lab Notes                                                                │
│  My workbench · 12 experiments in flight                                  │
│  [ Experiments ] [ Notes ]                                                │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Filter: [ Aging study ] [ Cardio cells ] [ Pilot data ]  + New Experiment│
│                                                                           │
│  ── READY TO START ──────────────────────────────────  (2 experiments)    │
│                                                                           │
│  ┌─────────────────────────────────┐ ┌─────────────────────────────────┐  │
│  │ ● PCR optimization run 4        │ │ ● Cell viability replicate 2    │  │
│  │ Aging study · ▣ PCR-GFP-v2      │ │ Cardio cells · ▣ MTT-assay      │  │
│  │ Sub-tasks: 0/4                  │ │ Sub-tasks: 0/6                  │  │
│  │ Should have started 3 days ago  │ │ Starts today                    │  │
│  │                       [ Start ]│ │                       [ Start ] │  │
│  └─────────────────────────────────┘ └─────────────────────────────────┘  │
│                                                                           │
│  ── BLOCKED ────────────────────────────────────────────  (1 experiment)  │
│                                                                           │
│  ┌─────────────────────────────────┐                                      │
│  │ ⚠ Western blot 3                │                                      │
│  │ Cardio cells · ▣ WB-standard    │                                      │
│  │ Blocked by:                     │                                      │
│  │   ◌ Cell lysate prep (running)  │                                      │
│  │                       [ Open ] │                                       │
│  └─────────────────────────────────┘                                      │
│                                                                           │
│  ── RUNNING ────────────────────────────────────────────  (3 experiments) │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │ ● Imaging assay (confocal Z)                                        │  │
│  │ Cardio cells · ▣ Confocal-Z                                         │  │
│  │ [▰▰▰▰▰▰▰▱▱▱]  Day 7 of 10                                          │  │
│  │ Sub-tasks: 4/8 · notes.md updated 1d ago · ⚠ deviated               │  │
│  │ Next: Image quantification (starts 5/20)                            │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │ ● PCR optimization run 3                                            │  │
│  │ Aging study · ▣ PCR-GFP-v2                                          │  │
│  │ [▰▰▰▱▱▱▱]  Day 3 of 7                                              │  │
│  │ Sub-tasks: 1/4                                                      │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│  ┌── one more running card ─────────────────────────────────────────────┐ │
│                                                                           │
│  ── AWAITING WRITEUP ───────────────────────────────────  (2 experiments) │
│                                                                           │
│  ┌─────────────────────────────────┐ ┌─────────────────────────────────┐  │
│  │ ⏵ Plasmid prep #4               │ │ ⏵ Toxicity screen pilot         │  │
│  │ Cardio cells · ▣ Mini-prep      │ │ Aging study · ▣ MTT-assay       │  │
│  │ Completed 8 days ago            │ │ Completed 3 days ago            │  │
│  │   no result logged              │ │   no result logged              │  │
│  │                  [ Write up ]   │ │                  [ Write up ]   │  │
│  └─────────────────────────────────┘ └─────────────────────────────────┘  │
│                                                                           │
│  ── RECENT RESULTS ─────────────────────────  (last 30 days · 4 results)  │
│                                                                           │
│  ┌─────────────────────────────────┐ ┌─────────────────────────────────┐  │
│  │ ░░░░░░░░░ thumb ░░░░░░░░░░░░░░░  │ │ ▌▌▌ results.md preview ▌▌▌▌▌▌ │  │
│  ├─────────────────────────────────┤ ├─────────────────────────────────┤  │
│  │ ● Cell viability run 1          │ │ ● PCR optimization run 2        │  │
│  │ Cardio cells · ▣ MTT-assay      │ │ Aging study · ▣ PCR-GFP-v2      │  │
│  │ Completed 2d ago · 7 files      │ │ Completed 5d ago · 3 files      │  │
│  └─────────────────────────────────┘ └─────────────────────────────────┘  │
│  ┌── two more recent-result cards ───────────────────────────────────────┐│
│                                                                           │
│  ── Earlier ─── (24 older results — click to expand) ──                   │
└───────────────────────────────────────────────────────────────────────────┘
```

Legend: `●` = project color dot, `▣` = method chip with name, `⚠` = blocked / deviated indicator, `⏵` = awaiting writeup cue, `◌` = incomplete parent task, `▰` = progress bar fill, `░` = image thumbnail area, `▌` = markdown preview area.

**Key interactions:**

1. **Click any card** → opens `<TaskDetailPopup>` (writable, since this is a single-user page). Same primitive as today.
2. **Click `[ Start ]` on a Ready card** → opens the popup with the focus on the sub-task list and an optional small "Are you starting this now?" affordance (no schema change, just a UX nudge to mark a sub-task done or update `notes.md`).
3. **Click `[ Write up ]` on an Awaiting card** → opens the popup with the Results editor tab pre-selected (the popup already has a results editor; the link just defaults its inner tab state).
4. **Click `[ Open ]` on a Blocked card** → opens the popup; the popup already shows dependencies in its detail view.
5. **Click a method chip on any card** → navigates to `/methods` with the method auto-expanded (the same pattern `/methods` already supports).
6. **Click `Next: X` on a Running card** → opens the popup for the next task in the chain.
7. **Click a blocked-parent name (`◌ Cell lysate prep`)** → opens the popup for that parent task — so the user can drill straight into the blocker.
8. **Click `+ New Experiment`** → opens `TaskModal` pre-restricted to `task_type === "experiment"`, identical to today's behavior.
9. **Hover any card** → no overlay popup (in contrast to Lab Mode's hover-preview). This is the user's own workbench; they can click straight into edit mode.

**Filter / sort surface** (the bar above the sections):

- **Project filter pills** — kept exactly as today (`selectedProjectIds` toggle, `frontend/src/app/experiments/page.tsx:447-470`).
- **Tag filter** — small dropdown of `tags[]` values across the user's experiments. Today's page ignores tags entirely.
- **Search box** — free-text match on experiment name. Optional; matches the search bar pattern from `/search`.

No "sort" dropdown — the section ordering *is* the sort (stages, then within-stage by the per-stage default I described above). A "sort by start date / completion date" toggle would re-introduce the page-wide chronological framing the redesign is trying to break.

**Differentiation from `/`, `/gantt`, `/results`, and the sibling's `/lab` Experiments:**

- **vs. `/` Home**: Home is **project-organized**; this is **stage-organized**. Home shows top-5 upcoming tasks of *any type*; this is experiments-only with full stage breakdown. Home doesn't surface blockers or writeup status. A user opening Home asks "where do my projects stand?"; a user opening this page asks "what's the next move?"
- **vs. `/gantt`**: Gantt is the calendar surface — schedule, drag, shift. This is the action surface — what state is each thing in, what's blocking me, what's owed. The two are complementary: Gantt for *when*, this for *what next*.
- **vs. `/results`**: `/results` is a flat project-grouped gallery of all completed work (every task type, not just experiments). It's a browsing surface. The "Recent results" section in this redesign overlaps with `/results` for experiments only and for the last 30 days only — a deliberate narrow overlap, since the user wants to see their own recent outcomes in the same place they plan the next one. (See Recommendation for whether to fold `/results` into this view entirely.)
- **vs. sibling's `/lab` Experiments**: The sibling's gallery is read-only and outcome-led (hero images, freshness tags, contributor avatars). This is writable and stage-led. The "Awaiting writeup" section *also* exists in the sibling's proposal as "Awaiting results" — but in Lab Mode it's a nag for the PI to ask about; here it's a nag for the person who *can fix it.* Same data signal, different action.

**Implementation effort estimate:** **M.** Most of the structural plumbing already exists — `useQuery` hooks for tasks + projects + dependencies, the chain-building logic at `frontend/src/app/experiments/page.tsx:139-302` can be partially reused for the "Next: X" computation, project-color and `taskKey` primitives stay. The new work is: (a) a stage-bucketing function (~120 LOC) that takes `(task, dependencies, results-dir-state)` and returns one of {ready, blocked, running, awaiting, recent, earlier}; (b) an async results-dir presence probe (mirror of `/results`'s `countDir` / `findExistingTaskResultsBase` at `frontend/src/app/results/page.tsx:100-137`) — same file-system pattern, no new APIs needed; (c) a per-stage `<StageCard>` variant component (~250 LOC across stages, since each stage has different fields foregrounded); (d) drop the project-grouped iteration and the stacked-card visual (~150 LOC removed). Estimate **~600 LOC net add** after the deletions, contained to the page and one new component file.

**Risks / open questions:**

- **"Blocked" detection requires running dependency parent-completeness across every Ready candidate** on each render. With 50 experiments and a few dep edges each, that's ~hundreds of map lookups per filter change — well within budget, but worth memoizing on `(tasks, dependencies)`.
- **"Awaiting writeup" detection requires async file-system probes** for `results.md` and `Images/` per recently-completed task. `/results` already does this pattern (`frontend/src/app/results/page.tsx:99-140`) — scope here is the same (only completed experiments, capped by date or count). Lazy-load past a small initial batch.
- **The "30 days" window for Recent results is arbitrary.** Worth confirming with Grant whether 14 / 30 / 60 days reads better for this lab's cadence.
- **The page is labeled "Lab Notes" in nav** (`frontend/src/lib/nav.ts:13`). The redesigned page is no longer about Notes — Notes is one sub-tab. The label should change. Suggested rename: **"Workbench"** (the framing the proposal uses internally). Alternative: split Notes into its own `/notes` route and rename this page to **"Experiments"**. Either is a defensible call — see Migration.
- **Notes sub-tab.** Out of scope for this redesign but in scope for the rollout. The cleanest landing is probably to extract Notes into its own top-level `/notes` route so each route has one thesis. That's a small standalone change.
- **`/results` overlap.** The "Recent results" section in this redesign covers the most recent 30 days of one user's results. `/results` covers the same data, all time, all task types. There's a real question whether `/results` should be folded into this page — see Recommendation.
- **Empty-state design.** A new user has zero ready / running / awaiting / recent — the page would be five empty sections. The single big `+ New Experiment` button on an otherwise-empty state is the right answer, mirrored from today's empty state at `frontend/src/app/experiments/page.tsx:481-492`.

---

## Proposal B — Dependency-first DAG view

**One-sentence pitch:** Replace the project-grouped card grid with an interactive directed acyclic graph of experiments — each experiment a node, parent→child dependencies as edges, with the chain visualization that today's page only hints at via stacked cards becoming the explicit thesis of the page.

**Core user question answered:** *"What is blocking my next paper figure, and what's the shortest path through the experiments I haven't done yet?"*

**What it shows:**

- A pannable / zoomable canvas. Each node is a compact experiment card with: project-colored dot, name, status (running / done / not started / blocked), method count chip, and an at-a-glance progress indicator.
- Edges connect parent-task → child-task pairs from the `dependencies` store. Edges are colored by whether the parent is complete (green = unblocked path) or incomplete (gray = path waits on parent).
- The graph auto-layouts roots-at-left, leaves-at-right (dagre-style). Multiple disconnected sub-graphs sit in a vertical stack of swim-lanes — one per chain or standalone experiment.
- A sidebar on the right shows "Critical path to selected goal" if the user clicks a leaf — backtracing from a target experiment, listing every parent task, marking which are complete and which are blocking.
- A small `Standalone experiments` strip at the bottom holds experiments that have no incoming or outgoing deps — they would otherwise sit as isolated nodes cluttering the canvas.

**What it deliberately hides:**

- The four-section stage layout. Stages are visible per-node (status colors) but not the page's organizing principle.
- The project-grouped card grid.
- The completed accordion. Completed experiments stay as muted nodes in the graph (visual context for "what came before this") with an option to fade them entirely.
- The Notes sub-tab still mounts but is structurally orthogonal — same as today.

**ASCII wireframe of the main view:**

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Lab Notes                                                                │
│  Dependency graph · 18 experiments in 4 chains + 3 standalone             │
│  [ Experiments ] [ Notes ]      [ Stages ▼  DAG ◉  List ]                 │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Filter: [ Aging study ] [ Cardio cells ]   Goal: [ Paper Fig 3 ▼ ]       │
│                                                                           │
│ ┌───────────────────────────────────────────────────────────────────────┐ │
│ │  Cardio cells lane                                                    │ │
│ │                                                                       │ │
│ │   ╔════════╗                                                          │ │
│ │   ║ Plas-  ║──┐                                                       │ │
│ │   ║ mid    ║  │      ╔══════╗      ╔══════╗      ╔══════╗             │ │
│ │   ║ prep ✓ ║  └─►   ║ Cell ║──┐  ║ Conf ║──┐  ║ Quant ║              │ │
│ │   ╚════════╝         ║ via- ║  └─►║ ocal ║  └─►║       ║              │ │
│ │                      ║ bility║    ║ run ◐║    ║       ║              │ │
│ │   ╔════════╗         ║   ✓  ║    ║      ║    ║       ║              │ │
│ │   ║ Cell   ║─────────╚══════╝    ╚══════╝    ╚══════╝              │ │
│ │   ║ lysate ║                                                          │ │
│ │   ║  ◐     ║──────────►   (blocks Western blot 3 below)               │ │
│ │   ╚════════╝                                                          │ │
│ │                                                                       │ │
│ │   ╔════════╗                                                          │ │
│ │   ║ West   ║  ← blocked: Cell lysate ◐ (running, 3 days left)         │ │
│ │   ║ blot 3 ║                                                          │ │
│ │   ║        ║                                                          │ │
│ │   ╚════════╝                                                          │ │
│ └───────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│ ┌───────────────────────────────────────────────────────────────────────┐ │
│ │  Aging study lane                                                     │ │
│ │   ╔════╗ → ╔════╗ → ╔════╗ → ╔════╗                                   │ │
│ │   ║run1║   ║run2║   ║run3║   ║run4║                                   │ │
│ │   ║ ✓  ║   ║ ✓  ║   ║ ◐  ║   ║ □  ║                                   │ │
│ │   ╚════╝   ╚════╝   ╚════╝   ╚════╝                                   │ │
│ └───────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│  ── Standalone experiments (no chain) ──                                  │
│  [ ▢ Pilot scoping ]  [ ▢ Quick MTT check ]  [ ▢ Stain test ]             │
│                                                                           │
│  Selected: "Conf ocal run"  (right sidebar)                               │
│    ↘ Parents: Cell viability ✓                                            │
│    ↘ Children: Quant (not started)                                        │
│    Status: running, day 5 of 8                                            │
│    Method: ▣ Confocal-Z                                                   │
│    [ Open in popup ]                                                      │
└───────────────────────────────────────────────────────────────────────────┘
```

Node legend: `✓` complete, `◐` running, `□` ready to start, `▢` standalone with no chain.

**Key interactions:**

1. **Click a node** → opens `<TaskDetailPopup>` (same primitive as today).
2. **Click an edge** → no-op, but on hover shows "{parent} → {child}" in a tooltip with both task names and the parent's completion status.
3. **Click a goal in the dropdown ("Paper Fig 3")** → highlights the critical path from any roots to that goal's terminal node. Goals reuse the existing `HighLevelGoal` model (`frontend/src/lib/types.ts` — used today by Gantt's goal sidebar). If a user has no goals, the dropdown is empty and this feature is dormant.
4. **Drag a node** → no-op for v1. Reshuffling the graph layout is destabilizing; users who want to reschedule go to Gantt. (Drag is a real Gantt-overlap risk and best avoided.)
5. **Right-click a node** → small context menu: Open / Start / Mark complete / Add child.
6. **The `Stages / DAG / List` toggle** in the header swaps between Proposal A (Stages), this (DAG), and today's existing project-grouped list — letting power users pick their lens. If we ship both A and B, this toggle is the integration point.

**Differentiation from `/gantt`, `/`, `/results`, and `/lab` Experiments:**

- **vs. `/gantt`**: Gantt is a time axis (when). DAG is a relationship axis (what depends on what). Distinct enough — Gantt with dependency arrows still answers "when," not "what's the shortest path through what I haven't done yet."
- **vs. `/`**: Home is project-organized, not graph-organized. The two share almost no thesis.
- **vs. `/results`**: Different tense (forward vs backward), different mode (planning vs browsing).
- **vs. `/lab` Experiments**: Different scope (single-user vs multi-user), different mode (write vs read), different format (graph vs gallery). The sibling proposal rejected a chronological-feed thesis as too close to Activity; this proposal is structurally orthogonal to all the existing Lab Mode sub-tabs.

**Implementation effort estimate:** **L.** A real DAG view needs a graph layout engine (dagre, elkjs, or react-flow) — the codebase doesn't have one yet. Approx breakdown: (a) library integration + layout pipeline ~200 LOC; (b) node component ~150 LOC; (c) edge rendering + tooltip ~100 LOC; (d) sidebar with critical-path computation ~200 LOC; (e) goal-anchored highlighting ~80 LOC. Plus the new dependency in `package.json` (~80 KB gzipped for react-flow, smaller for dagre + manual SVG). Estimate **~750-900 LOC net** plus a new dep. Substantially heavier than Proposal A.

**Risks / open questions:**

- **Most experiments in most labs are not in chains.** A quick look at `experimentChains` logic (`frontend/src/app/experiments/page.tsx:139-222`) confirms that "standalone single-task chains" is the common case — a chain of length > 1 is the exception. A DAG view of mostly-singleton nodes is a *worse* layout than a card grid. The "Standalone experiments" catch-all strip at the bottom of the wireframe is the honest acknowledgment of this. If 80% of a user's experiments end up in that strip, the DAG is decoration over a grid.
- **The current stacked-card chain visual is already a 90% solution for the dep-chain question** — it tells you "this is a chain" at a glance. Going from there to a full DAG canvas is a heavy lift for marginally more clarity, unless the user genuinely has multi-branch graphs (which would be rare for an experimental science workflow — most chains are linear).
- **Critical-path highlighting is genuinely valuable** if users have goals and goals are linked to terminal experiments. But that linkage isn't on the data model today — goals can be tagged with projects, not specific experiments. Either the design needs a "this experiment delivers goal X" field added (out of scope) or the critical-path feature degrades to "show me the whole chain" (which is what the stacked-card visual already implies).
- **Pannable canvas is hostile to keyboard users** unless explicitly designed for tab-cycling through nodes. Accessibility cost is real.
- **`/gantt` already shows dependency arrows.** If a user wants graph-shaped insight, they can already get a partial version from Gantt. The DAG view's marginal value is "graph without time, layout for clarity not for schedule" — defensible but narrow.

---

## Proposal C — STRUCTURAL: kill the `/experiments` page

**One-sentence pitch:** Delete the `/experiments` route. Fold "what's coming up" into Home's existing project cards (which already render a small "Next Up" list). Fold "what's completed" into `/results`. Extract the Notes sub-tab into its own `/notes` route. The "Lab Notes" tab evaporates, the nav goes from 9 items to 9 items (gaining `/notes`, losing `/experiments`), and the app gets smaller.

**Core user question answered:** *"Was this tab pulling its weight?"* This proposal's bet is no — every job it does is either duplicated elsewhere or could be absorbed by a small enhancement to a neighbor.

**What it shows:** This proposal deletes a thing. The "showing" replacement is spread across three views that already exist:

- **`/` Home** gains an "Experiments only" toggle on each project card. With the toggle on, the project card's "Next Up" list (`frontend/src/app/page.tsx:434-462`) filters to `task_type === "experiment"`, sorted by start date, capped at 5 items (matching today's pattern). The progress bar additionally factors in only experiments instead of all tasks. With the toggle off, today's behavior. The toggle is per-card so a user with mixed work in one project can see all tasks, while a user with experiment-heavy work in another project can focus.
- **`/` Home** also gains a small "Blocked" line under the existing Active / Overdue / Upcoming counts row (`frontend/src/app/page.tsx:411-431`) — same blocked-detection logic Proposal A specifies, applied to all task types. This surfaces the "stuck" signal the current `/experiments` page misses entirely *and* lifts it into the more prominent Home view.
- **`/results`** gains an "Awaiting results" filter pill at the top of its existing project filter row (`frontend/src/app/results/page.tsx:181-205`). The filter swaps `is_complete \|\| deviation_log` for "is_complete AND no results.md content AND empty Images/". The same forcing-function signal Proposal A surfaces, but in the page where completed work already lives.
- **A new `/notes` route** receives the Notes sub-tab's `<NotesPanel />` mount. The nav loses "Lab Notes," gains "Notes." No content change — just a relocated entry point.

**What it deliberately hides:** The `/experiments` route itself, including its project-grouped chain-card view, the stacked-card chain visual, the in-progress green progress bar, and the collapsed-completed accordion.

**Gap analysis (this is the actual decision point):**

For the kill option to be safe, Home + Gantt + `/results` + Notes-as-its-own-route must together cover every job the current page is doing. Honest table:

| Use case the current page serves | Covered after kill by | Quality of coverage |
|---|---|---|
| "What experiments am I about to start" | Home `Next Up` list + experiments-only toggle | **Equal.** Same data, less polish; Home's "Next Up" is already 5 most-upcoming-by-start-date. |
| "What experiments are running today" | Gantt (time bar straddling today) + Home's "Active" count | **Slightly worse.** No single surface with the "Day 3 of 7" progress bar — the most useful piece of the current page disappears unless we add that signal to Home's "Next Up" list (~30 LOC). |
| "What experiments are stuck on a dependency" | Home's proposed "Blocked" line under counts | **Better** than today. Today this is invisible; the kill option makes it surface-level on Home. |
| "What experiments did I finish but never write up" | `/results` proposed "Awaiting results" filter | **Better** than today. Today the completed accordion is collapsed and silent; the kill option turns this into an opt-in filter on the page that already lists completed work. |
| "Visualize a dependency chain" | The stacked-card visual disappears. Gantt's dep arrows partly cover it. | **Worse.** This is the single biggest gap — the chain visual is the one thing on today's page that's genuinely novel. |
| "Group experiments by project" | Home already groups by project, but mixed with non-experiment tasks unless toggle is on | **Equal-ish.** Less single-purpose, but discoverable via the toggle. |
| "+ New Experiment shortcut" | Lives wherever the user is — Gantt's "+ New Task" with type=experiment, or a new "+ New Experiment" button on Home's project cards | **Equal.** Same modal, different launch points. |
| "Notes sub-tab" | Move to `/notes` route | **Equal.** Same panel, different route. |

The single biggest gap is the **dependency-chain visualization**. The stacked-card visual is the one thing the current page does that no other view does. The kill option loses it. To honestly close the gap, the proposal would need to either (a) port the stacked-card visual onto Home's project cards (a fair amount of layout work for a niche feature), or (b) lean harder on Gantt's existing dep-arrow rendering as the canonical chain visualization — which means users have to know to switch to Gantt to see chains, which they currently don't have to do.

The secondary gap is the **"Day X of Y" progress bar** for running experiments. It's just a derived computation, easily portable to any other view, but worth ensuring the kill option actually ports it rather than just losing it.

**Gap-filling additions if we go this route** (file pointers):

- `frontend/src/app/page.tsx:411-431` — add Blocked count to the project-card stats row. ~25 LOC.
- `frontend/src/app/page.tsx:434-462` — add `Experiments only` toggle, filtered `Next Up`, and the Day-X-of-Y progress bar for any in-progress experiment surfaced in `Next Up`. ~80 LOC.
- `frontend/src/app/page.tsx` — `+ New Experiment` quick button on the project card header. ~20 LOC.
- `frontend/src/app/results/page.tsx:181-205` — add the "Awaiting results" filter pill. ~40 LOC.
- `frontend/src/app/results/page.tsx:50-65` — extend the `resultTasks` filter to include "completed but no result content" for the new filter. ~30 LOC.
- New file: `frontend/src/app/notes/page.tsx` — thin wrapper mounting `<NotesPanel />`. ~25 LOC.
- `frontend/src/lib/nav.ts` — drop `{ href: "/experiments", label: "Lab Notes" }`, add `{ href: "/notes", label: "Notes" }`. 2 lines.
- `frontend/src/app/wiki/features/experiments/page.tsx` — rewrite or delete. The wiki has a dedicated page; killing the route means the wiki page either rewrites to point users to Home + `/results` or disappears.
- Add a one-time redirect from `/experiments` → `/` for users who have it bookmarked. ~10 LOC in middleware or a top-level `useEffect`.

**Implementation effort estimate:** **M.** Deletes ~793 LOC (the page), adds ~230 LOC across Home + `/results` + new `/notes` route + nav, removes one nav entry, adds one redirect. **Net negative LOC.** The lowest-risk option for the codebase.

**Differentiation from neighbors:** N/A by construction — this proposal's whole bet is that there's nothing left to differentiate, every job already has a better home.

**Risks / open questions:**

- **The dependency-chain visual gap is the killer.** Either we accept its loss (and trust Gantt's dep arrows to cover the few users who care), or we port it — porting it adds work that erodes the "smaller app" pitch. Honest read: most labs run mostly-linear chains and could live without the visual; but the labs that DO have branching experiment graphs will feel the loss.
- **Home becomes more loaded.** Adding Blocked counts, an experiments-only toggle, and a Day-X-of-Y progress bar to each project card pushes Home toward kitchen-sink territory. Home is currently a clean "where do my projects stand" surface; the kill option dilutes that thesis.
- **The "Lab Notes" name in nav has been around long enough that some users will be confused by its disappearance.** A one-time "we moved this" toast on first hit covers most of it but not all.
- **`/notes` as a top-level route is overkill for a single panel.** An alternative is to fold Notes into Home as a third "Notes" tab on Home, or into Lab Mode entry points. Worth deciding before shipping.
- **The wiki has a dedicated `/wiki/features/experiments/page.tsx` page.** It needs to either redirect to Home or be rewritten — small but non-zero work.
- **Mode framing is genuinely useful.** A "I'm planning my next week" mode is a real thing some users want. Killing `/experiments` removes the URL/tab that represents that mode and forces users to assemble it from Home + Gantt + `/results`. The kill option's bet is that the assembly is cheap; if it's expensive, users will miss the mode-as-a-place.
- **`+ New Experiment` discoverability.** Today the entry point is one click from anywhere via the nav. After kill, the user has to be on Home (or wherever the button lives) to launch it. Probably fine, but worth thinking about.

---

## Recommendation

**Ship Proposal A — Stages-based decision queue.**

Three factors swung the choice.

First, **the redesign needs to add information, not rearrange it.** The current page is the most-polished view in the app at the CSS level but among the thinnest at the data level: status badge, dates, "Has Method" boolean. The user opens this page in the morning to decide what to do, and the page tells them less than they could derive from a Gantt view at 50% zoom. Proposal A is the only proposal that materially increases per-experiment density (method names, sub-task progress, blocker identity, days-since-completion, results-pending flag) and turns the page from a navigation surface into a decision surface. Proposal B (DAG) adds visual structure without per-experiment density. Proposal C (kill) reduces total density.

Second, **the "Awaiting writeup" signal is uniquely valuable to the person who can act on it.** The sibling proposal puts an "Awaiting results" section on the PI's Lab view as a nag to ask about. That's good, but the actually-fix-it surface is the researcher's own workbench. Proposal A puts that signal one click from the user who can write the result — surfaced, not hidden in a collapsed accordion. This is the strongest forcing-function the redesign can carry, and no other proposal does it.

Third, **Proposal C (kill) leaves a real but recoverable gap, and Proposal B (DAG) is too heavy for a feature most labs barely use.** The kill option has merit — it shrinks the app and pushes signals into views that the user already touches — but its biggest gap (the dependency-chain visual) is also the one thing the current page does that's genuinely novel, and the redesign would lose it. The DAG option turns the chain visual into the whole page, but most labs' chains are short (often length 1) and a graph canvas of mostly-singleton nodes is worse than a grid. Proposal A keeps the chain signal as a "Next: X" / "Blocked by: Y" textual link in the right sections — less visual flash than DAG, more information than today's stacked cards.

**The structural "kill" option is rejected because of a single biggest gap: the dependency-chain visual has no comparable home elsewhere.** Gantt's dep arrows are time-axis-warped (the visual length encodes duration, not relationship); the stacked-card / "Next: X" framing in Proposal A is structurally different from both Gantt and a flat list. Lose it and chain-heavy workflows lose their best surface.

**Interaction with the sibling's `/lab` Experiments outcomes-first gallery:**

The two pages share data and primitives but should remain **structurally independent views with shared building-blocks at the component level**, not one as a special case of the other. Concretely:

- **Shared building blocks**: the `<ResultCard>` / outcome-card primitive proposed in the sibling's "Recent results / Earlier" sections **is the same component** as Proposal A's "Recent results" section here. Build it once, in a place like `frontend/src/components/ExperimentResultCard.tsx`, and import from both pages. Same applies to a `<MethodChip>`, a `<ProjectChip>`, and the `findExistingTaskResultsBase` + image-walker logic from `/results` — all worth lifting into shared utilities.
- **Independent page structures**: the sibling's page is gallery-led (Fresh / Active / Awaiting / Earlier sections), this page is queue-led (Ready / Blocked / Running / Awaiting writeup / Recent results sections). The section taxonomies overlap on **Awaiting** and **Recent results** but diverge on the rest (Lab Mode has no "Ready to start" or "Blocked," because those are *my* states not the lab's; the single-user workbench has no "Active" section as the lab-wide rollup, because "Running" already does that for one person).
- **Not a filter of each other**: it would be tempting to say "the standalone page is just the Lab page filtered to current user." That's wrong because the *thesis* differs: Lab Mode foregrounds outcomes (read), the standalone page foregrounds next-actions (write). A user-filter on the Lab gallery would give the user a view that's still optimized for *someone else's* question. Keep them as two independent views with shared primitives.

So: ship Proposal A on its own merits; in the implementation, factor out the outcome-card primitive into a shared component the moment the sibling's Lab gallery ships. The sibling's gallery and this page's "Recent results" section then visually match for the single-user case and the audience-specific differences live in section composition, not in card-level inconsistency.

## Migration / rollout

This is a self-contained rewrite of one page with no data-model changes, no API changes, and no shared-component changes (until the optional refactor above). Rollback is reverting one file.

**Phasing:**

1. **First land the Experiments-sub-tab rewrite (Proposal A core).** Leaves Notes sub-tab untouched. Page label in nav stays "Lab Notes" for this phase. Lowest-risk slice.
2. **Decide the page rename.** Two options worth picking between before phase 3:
   - (a) Rename "Lab Notes" → **"Workbench"** in `frontend/src/lib/nav.ts:13`. Keeps Notes as a sub-tab. One file change.
   - (b) Extract Notes into a top-level `/notes` route (~25 LOC new file, ~5 LOC nav update) and rename the experiments page to **"Experiments"**. Cleaner separation of concerns but adds a route.
   - Recommendation here: **(a) Workbench**, because the Notes panel is small and a thin top-level route feels heavier than a sub-tab. But this is a Grant call.
3. **Decide whether to fold `/results` into the Workbench.** Today `/results` is a single-user backward-looking gallery; Proposal A's "Recent results" section is the same data scoped to the last 30 days. If we fold `/results` in, the Workbench gets a "Show all results" expansion (the same data, no date cap) and `/results` becomes a redirect to `/experiments`. Net: one fewer nav tab, one more reason to be on the Workbench. **This is optional and can ship as a follow-up chip.** Leaving `/results` standalone is fine for v1.

**Users who currently bookmark `/experiments`:** No URL change in phase 1 (the route stays). If we proceed with phase 2(b), add a one-time redirect from `/experiments` → `/workbench` (or whatever the new path is). If we keep phase 2(a) (just renaming the label), no redirect needed since the route doesn't move.

**Wiki ripple:**

- `frontend/src/app/wiki/features/experiments/page.tsx` — the page describes the current project-grouped chain-card layout. After the redesign, this page needs a full rewrite around the Stages thesis. Per the [Wiki voice memory](file://memory) — concept-first, screenshot-heavy — the rewrite should open with "Your workbench: a stage-organized view of your experiments" and walk through each stage with an annotated screenshot of the new layout.
- `frontend/public/wiki/screenshots/experiments-*.png` — any existing screenshot of the current page becomes outdated. Must be re-captured via `?wikiCapture=1` fixture mode per the [Screenshot privacy memory](file://memory). The fixture data may need 1-2 more experiments with non-empty `notes.md` / empty `results.md` to actually trigger the "Awaiting writeup" section.
- If the page renames to "Workbench," any wiki references to "Lab Notes" need replacement.

**Demo lab data:**

- The "Awaiting writeup" section is a forcing-function nag — it's the most-visually-jarring section and also the section the demo lab needs to demonstrate. The demo data in `frontend/public/demo-data/` currently has completed experiments but no real `results.md` content. To make the section meaningful in the demo:
  - At least 1 completed experiment should have a non-empty `results.md` (so it lands in Recent results).
  - At least 1 completed experiment should have empty / missing `results.md` AND empty `Images/` (so it lands in Awaiting writeup).
  - At least 1 in-progress experiment should have a non-empty `notes.md` so the "notes updated 2d ago" cue has data to display.
- This is a small demo-data refresh that can ship alongside the rewrite or as a separate follow-up.

**Stats-row cleanup (optional):** The current page renders no top-level stats row — that's actually a strength worth preserving. The redesign should NOT add one. The section counts ("3 experiments in Ready," "2 in Awaiting writeup") serve the same purpose, and the page's title bar ("My workbench · 12 experiments in flight") gives a one-line total.

## What this proposal does NOT decide

- Whether the page renames to "Workbench" or stays "Lab Notes" or splits into "Experiments" + "/notes". Three viable options; recommend Workbench, but the call is Grant's.
- Whether `/results` folds into the Workbench as the "Earlier" expansion or stays as its own route. Recommend leaving for v2.
- The exact "Recent results" window (14 / 30 / 60 days). Proposal A defaults to 30 days; the demo data will read fine with anything in that range, but a real lab's cadence might want it tighter or looser.
- Threshold for "Awaiting writeup": completed >= 1 day ago, or >= 3 days, or >= 7? Proposal A defaults to "completed AND no result content" with no day delay, which means an experiment completed 5 minutes ago with no results yet lands in Awaiting. Worth refining — probably "completed >= 1 calendar day ago" is the right cutoff to avoid same-day false-positives.
- Whether `notes.md` content counts toward "has a result" for the Awaiting bucket. Proposal A says no (notes are process; results are conclusions), but labs that use `notes.md` heavily and never write `results.md` would disagree — same open question the sibling proposal flagged.
- Whether to show shared-into-me tasks in this page. Today the page calls `fetchAllTasksIncludingShared` but doesn't structurally distinguish shared from own. For a "my workbench" view, the right call is probably **own tasks only** — but this needs Grant confirmation since `/experiments` was a key page in the cross-user-collision sweep (AGENTS.md §8) and the shared-task surface there is load-bearing for some users.
- Exact pixel widths, breakpoints, and grid column counts. The wireframe uses 3-column for small cards and full-width for Running cards; the implementation can adjust as the cards render.
- Whether to add a per-stage `[ Collapse ]` affordance so a power user can hide stages they don't care about. Not in v1; add only if asked.
- Whether `experiment_color` (currently unused on cards) should replace project color on the dot. Proposal A keeps project color for at-a-glance project recognition, but this is a minor visual call.
- Icon set for stage indicators (`⏵`, `◌`, `▣`, `⚠`). Use whatever icon family the rest of the app uses.

---

*Open questions to confirm with Grant before implementation kicks off:*

1. **Page rename.** Workbench / keep "Lab Notes" / split into Experiments + Notes? Recommend Workbench. This shapes both the redesign and the wiki rewrite.
2. **Shared tasks in this view.** Show shared-into-me experiments or own only? "My workbench" reads as own-only, but the page has been the site of multiple shared-task collision fixes and the shared surface might be load-bearing.
3. **`notes.md` content as a "result."** Yes/no decides whether Awaiting writeup over- or under-fires (same question the sibling proposal flagged).
4. **`/results` future.** Fold into the Workbench in v2, or leave as its own route? Recommend leaving for now and reassessing once the Workbench ships.
5. **Demo data.** Worth ~30 minutes to seed the demo lab with an "awaiting writeup" experiment so the section's empty-state never blocks a demo. Spawn a sub-task for it, or include in the main implementation chip?
