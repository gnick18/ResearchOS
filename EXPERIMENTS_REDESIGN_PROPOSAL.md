# Experiments page redesign — proposal

> Scope: this proposal is about the **Experiments sub-tab inside the Lab tab**
> (`frontend/src/components/LabExperimentsPanel.tsx`, rendered from
> `frontend/src/app/lab/page.tsx`). The single-user `/experiments` page
> (`frontend/src/app/experiments/page.tsx`) is a separate, more polished
> view and is treated here as comparable prior art rather than as a thing to
> change.

## Context

The Lab tab is the multi-user roll-up of the app. It already has eight
sub-tabs — Activity, GANTT, Experiments, Purchases, Roadmaps, Methods, Notes,
Search (`frontend/src/app/lab/page.tsx:53`). Each one is supposed to answer
one specific question about "what is the whole lab doing." The
**Experiments** sub-tab is the only one whose thesis the wiki describes
flatly as "a flat view of everyone's rows for that area"
(`frontend/src/app/wiki/features/lab-mode/page.tsx:120-126`). That flatness
is the problem — the panel today renders every experiment as a row in either
a "grouped by user + project" list or a sortable table, and nothing on
screen tells you anything you couldn't see in another tab faster.

Concretely, the Lab Activity tab answers "what just happened" in 30-day
windows. The Lab GANTT answers "when is everything." The Lab Methods tab
answers "who's using which protocols." The Lab Search tab answers "find me
the thing." The Experiments tab is left with the residual "everything
ever" — a complete inventory — but renders that inventory at one row per
experiment, with no surfaces for the rich data each experiment actually
carries (`notes.md`, `results.md`, the `Images/` folder, sub_task progress,
variation notes, deviations). For each row you get a color dot, a name,
dates, a method count, and a status chip. None of those answer the question
a PI walks up to Lab Mode to ask, which is some version of "what did the
lab actually find this week, and what are they running right now to find
out more."

The data model has the raw material to do better. Every task with
`task_type === "experiment"` has a per-task results directory at
`users/<owner>/results/task-<id>/` containing `notes.md`, `results.md`, an
`Images/` folder, and a `Files/` folder
(`frontend/src/lib/tasks/results-paths.ts:20-22`). Tasks also carry
`method_ids[]`, `method_attachments[]` with per-experiment PCR tweaks and
`variation_notes`, `deviation_log`, `sub_tasks[]`, `tags[]`, and an
`experiment_color`. The current sub-tab surfaces only the structural
metadata (dates, status, method count) and leaves the actual experimental
output entirely off-screen.

## Current state

Inventory of what `LabExperimentsPanel` renders today
(`frontend/src/components/LabExperimentsPanel.tsx`):

- Filters all tasks where `task_type === "experiment"` and the owner is in
  the user-filter selection (lines 18-35).
- Header stats row, four cards: Total / Completed / In Progress / Users
  (lines 122-145). **This row duplicates the parent stats row at
  `frontend/src/app/lab/page.tsx:309-328`** (Users / Projects / Experiments
  / Purchases) — both render on the same page above the fold.
- View-mode toggle: Grouped View / Table View (lines 148-169).
- **Grouped View** (lines 171-240): one section per `username + project`
  pair, header has user avatar + username + project name + count chip.
  Each row underneath shows: `experiment_color` dot, name, `start_date →
  end_date • duration_days`, `method_ids.length` chip if any, status chip
  (Complete / In Progress), chevron.
- **Table View** (lines 241-331): seven sortable columns (User, Project,
  Experiment, Start Date, Duration, Methods (count), Status). Click sorts;
  default sort is start_date desc.
- Click on a row anywhere → `onExperimentClick(exp)` →
  `lab/page.tsx:392` opens `<TaskDetailPopup readOnly={true}>`.

What an experiment has that the current sub-tab **does not surface**:

- `results.md` content (the actual findings).
- `notes.md` content (the lab notebook narrative).
- Any image from `Images/` (no hero thumbnail anywhere).
- Attachment count from `Files/`.
- `sub_tasks[]` progress (e.g. "3/5 done").
- `tags[]`.
- `method_attachments[].deviation_log` or `.variation_notes` (only the
  numeric method count is shown).
- Dependency chains across experiments (single-user `/experiments`
  surfaces these via stacked cards; this tab is dependency-blind because
  per-user dependency stores aren't reachable cross-user without a
  rollup).
- Time since completion (a "finished yesterday" cue would be useful but
  is absent — only the raw end_date is shown).
- Recency of edit to `results.md` or `notes.md` (no `updated_at` is read
  here).

Read-only constraint inherited from Lab Mode
(`frontend/src/app/wiki/features/lab-mode/page.tsx:73-76` and
`lab/page.tsx:394`): every interactive surface in this tab opens the
popup in `readOnly={true}` mode. Any drag-to-edit interactions
(Kanban-style status moves, drag-to-reschedule) are off the table for
this panel.

## What other views own

| View | Thesis (one sentence) | Data it foregrounds |
|---|---|---|
| Lab Activity (`frontend/src/components/LabActivityPanel.tsx`) | "What just happened across the lab?" | 30-day rolling: experiments+purchases running now, recently completed, recently-updated shared notes. |
| Lab GANTT (`frontend/src/components/LabGanttChart.tsx`) | "When is everything happening?" | Time axis with user-color-tinted bars; multi-user merged. |
| Lab Methods (`frontend/src/components/LabMethodsPanel.tsx`) | "Which protocols are in use, by whom?" | Per-method rollup: usage count, users, last-used date, expandable task list. |
| Lab Search (`frontend/src/components/LabSearchPanel.tsx`) | "Find a specific thing across the lab." | Free-text + structured filters (user, type, project, method, date, status) with match-highlighting and bulk export. |
| Lab Roadmaps (`frontend/src/components/LabRoadmapsPanel.tsx`) | "What's everyone's high-level direction?" | Per-user roadmap of high-level goals. |
| Lab Notes (`NotesPanel.tsx` in lab mode) | "Browse shared notes across the lab." | Meeting notes and running-log narratives. |
| `/experiments` standalone (`frontend/src/app/experiments/page.tsx`) | "What's coming up on my plate, with dependency context?" | Single-user project-grouped cards, dep-chain stacking, overdue/in-progress/upcoming status with progress bar. |
| `/gantt` standalone (`frontend/src/app/gantt/page.tsx`) | "Plan and reschedule my work." | Single-user editable time axis with drag-shift and dependency cascade. |
| `/calendar` (`frontend/src/app/calendar/page.tsx`) | "What's today / this week, with external calendars overlaid." | Date grid + ICS feed overlay. |
| `/methods` (`frontend/src/app/methods/page.tsx`) | "Manage and edit my protocol library." | Folder tree of methods, markdown editor, PCR builder. |
| `/search` (`frontend/src/app/search/page.tsx`) | "Find a specific thing in my data." | Same as Lab Search but single-user. |
| `/` home (`frontend/src/app/page.tsx`) | "Where do I stand on each project?" | Project cards with task counts, upcoming, overdue. |

## Candidate theses considered

Six theses were evaluated. Proposal A, B, and the structural kill option
are fleshed out below; the rest are rejected here with the reasoning
recorded.

1. **Outcomes-first results gallery (fleshed out below as Proposal A — recommended).**
   The sub-tab becomes a visual board of experiment outcomes. Each card
   leads with a hero thumbnail (first image from `Images/` or rendered from
   `results.md`), the contributor's avatar, the methods used, and a short
   results snippet. Answers "what did the lab learn this week?" — the
   question no other tab answers.

2. **STRUCTURAL: kill the sub-tab (fleshed out below as Proposal B).**
   Delete the Experiments sub-tab entirely. The "what's running" job moves
   to Activity (already there), "what's coming up" stays on
   single-user `/experiments`, "find any experiment" stays on Lab Search,
   "every experiment in the lab as an inventory" gets re-filled by a
   small Lab Search default ("show all experiments") plus a small GANTT
   "all time" view option. The single biggest risk is the historical
   inventory regression — see the proposal for whether that's fatal.

3. **Method-pivot comparison grid (fleshed out below as Proposal C).**
   Group cards by method instead of by user + project. Under each method
   header, lay out the experiments that used it side-by-side so replicates
   read at-a-glance — "we ran this PCR protocol four times; here are the
   four outcomes." Answers "did this method work, and how reproducibly?"

4. **Kanban swim lanes by status — considered, rejected.** The most-natural
   redesign of a "list of experiments" is usually a board with Planning /
   In-Progress / Completed / Blocked lanes and drag-to-update. But Lab Mode
   is **read-only** by contract
   (`frontend/src/app/wiki/features/lab-mode/page.tsx:73-76`), which kills
   the headline interaction (drag between lanes to update status). The
   layout would still convey status at a glance, but without the
   interactivity it's a fancier `status` column, not a meaningful new
   thesis. Also: the data model has no `status` enum — only `is_complete`
   plus derived "running" via dates — so "Blocked" / "Failed" lanes can't
   be populated without first adding a field, which is out of scope.

5. **Decision-focused "Up Next" queue — considered, rejected.** A
   morning-planning queue surfaces "what should I run today, ordered by
   dependencies + blockers." This is a great single-user view (and arguably
   what `/experiments` already half-is), but it makes no sense in
   multi-user Lab Mode where the viewer (typically a PI or another lab
   member) is not the one deciding what someone else runs next.

6. **Lab-notebook chronological feed — considered, rejected.** A
   timestamped social-feed-style scroll of "alex ran X today, kritika
   added a result to Y yesterday" overlaps heavily with what Lab Activity
   already does (Running now / Recently completed / Recent notes). The
   marginal value over what's already in Activity is small.

7. **Density-focused mega-table — considered, rejected.** A 30+-row
   compact table with every column visible at once would maximize
   information density but does not answer any new question. It also
   already exists as the "Table View" mode in today's panel — the user can
   sort by any column. Doubling down on this would entrench the very
   sameness Grant pushed back on.

## Proposal A — Outcomes-first results gallery

**One-sentence pitch:** Turn the Lab Experiments sub-tab into a visual
gallery of experiment outcomes, ordered by freshness of result, with a
clearly-marked "completed but no results yet" section so the PI can see
the gaps.

**Core user question answered:** *"What did the lab actually figure out
this week, and what's in progress that we'll find out about next?"*

**What it shows** (the things on screen at all times):

1. A grid of **outcome cards**, one per experiment.
2. A **hero visual** on each card: the first image found in the
   experiment's `Images/` directory, or a rendered preview of the first
   ~80 chars of `results.md`, or — if neither exists — a neutral
   placeholder with the method icon.
3. Experiment **name**, **contributor avatar + name**, and **project
   name**.
4. **Method chips** (one per attached method, with a tooltip showing the
   method's folder + variation-notes-present indicator).
5. A **freshness tag**: "Result added 2d ago" / "Notes updated 5d ago" /
   "Completed yesterday" / "Running, day 3 of 7" / "Completed, no result
   logged yet" (the last one is the action signal for a PI). Freshness is
   computed from the file mtimes of `results.md` and `notes.md` plus the
   existing `is_complete` + `start_date` + `end_date` fields.
6. **Status badge** (Running / Completed / Overdue) consistent with the
   palette `/experiments` already uses.

**What it deliberately hides:**

- The 4-card stats strip at the top of the current panel (Total /
  Completed / In Progress / Users). The parent
  `lab/page.tsx:309-328` already renders a 4-card strip on this tab, so
  removing the in-panel duplicate is pure cleanup.
- The "Table View" toggle. Power users who want a compact tabular sort go
  to Lab Search, where every column from today's table is already a
  filter. Maintaining two ways to do the same thing is the source of
  half the sameness complaint.
- Per-experiment dates and duration on the card face. Dates are still in
  the popup; the gallery card is for "what did we learn," not "when did
  it run." (`/experiments` and GANTT already cover the time question.)
- Method counts as a numeric chip. The methods become chips with names,
  which is more useful than "2 methods."

**ASCII wireframe of the main view:**

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Lab tab header (Users / Projects / Experiments / Purchases — kept)       │
├───────────────────────────────────────────────────────────────────────────┤
│  Experiments                                                              │
│                                                                           │
│  Sort: [ Freshest results ▼ ]    Filter: [Status][Method][Project][Date]  │
│                                                                           │
│  ── FRESH RESULTS ──────────────────────────────────────  (last 14 days)  │
│                                                                           │
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐   │
│  │ ░░░░ HERO IMG ░░░░ │  │ ░░░░ HERO IMG ░░░░ │  │ ▌▌▌▌ RESULTS  ▌▌▌▌ │   │
│  │ ░░░░░░░░░░░░░░░░░  │  │ ░░░░░░░░░░░░░░░░░  │  │ md preview, first  │   │
│  │ ░░░░░░░░░░░░░░░░░  │  │ ░░░░░░░░░░░░░░░░░  │  │ ~80 chars of       │   │
│  │ ░░░░░░░░░░░░░░░░░  │  │ ░░░░░░░░░░░░░░░░░  │  │ results.md         │   │
│  ├────────────────────┤  ├────────────────────┤  ├────────────────────┤   │
│  │ ● PCR optimization │  │ ● Cell viability   │  │ ● Western blot 3   │   │
│  │ @alex • Aging      │  │ @kritika • Cardio  │  │ @morgan • Cardio   │   │
│  │ ▣ PCR-GFP-v2   ◐   │  │ ▣ MTT-assay        │  │ ▣ WB-standard      │   │
│  │ Result + 2d • ✓    │  │ Result + 5d • ✓    │  │ Notes + 1d • RUN   │   │
│  └────────────────────┘  └────────────────────┘  └────────────────────┘   │
│                                                                           │
│  ── ACTIVE ─────────────────────────────────────────────  (running today) │
│                                                                           │
│  ┌────────────────────┐  ┌────────────────────┐                           │
│  │ ▤ method icon      │  │ ░░░░ HERO IMG ░░░░ │                           │
│  │  no result yet     │  │ ░░░░ from notes ░░ │                           │
│  ├────────────────────┤  ├────────────────────┤                           │
│  │ ● PCR optimization │  │ ● Imaging assay 2  │                           │
│  │ @alex • Aging      │  │ @kritika • Cardio  │                           │
│  │ ▣ PCR-GFP-v3   ◐   │  │ ▣ Confocal-Z       │                           │
│  │ Day 3 of 7 • RUN   │  │ Day 5 of 5 • RUN   │                           │
│  └────────────────────┘  └────────────────────┘                           │
│                                                                           │
│  ── AWAITING RESULTS ───────  (completed but results.md is empty/missing) │
│                                                                           │
│  ┌────────────────────┐  ┌────────────────────┐                           │
│  │ ⚠  no result file  │  │ ⚠  no result file  │                           │
│  │   notes.md exists  │  │   nothing logged   │                           │
│  ├────────────────────┤  ├────────────────────┤                           │
│  │ ● Plasmid prep #4  │  │ ● Toxicity screen  │                           │
│  │ @morgan • Cardio   │  │ @alex • Aging      │                           │
│  │ Completed 3d ago   │  │ Completed 12d ago  │                           │
│  └────────────────────┘  └────────────────────┘                           │
│                                                                           │
│  ── EARLIER ──────────  (older results, collapsed, ‘Show 47 more’ button) │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

Legend used above: `●` = `experiment_color` dot, `▣` = method chip, `◐` =
"variation notes / deviation present" indicator,
`▤` = method icon placeholder, `░` = image area, `▌` = markdown
preview, `RUN` = running badge, `✓` = completed badge.

**Key interactions:**

1. **Hover a card** → uses the same `<TaskQuickPopup>` pattern that
   `GanttChart` uses (`frontend/src/components/TaskQuickPopup.tsx`) — a
   small overlay that adds "method tooltip details" and "first paragraph
   of `notes.md`" on top of what's on the card face. No edit affordances
   in Lab Mode.
2. **Click a card** → opens `<TaskDetailPopup readOnly={true}>` (same as
   today, `lab/page.tsx:392`).
3. **Click a method chip** → cross-links to Lab Methods tab, scrolled to
   and expanded on that method (uses the existing scroll-to/expand
   contract already in `LabMethodsPanel.tsx`'s `expanded` state).
4. **Click a contributor avatar** → opens the existing per-user
   `<LabUserDetailPanel>` side panel (`lab/page.tsx:401-408`), so a PI
   can drill into one person's full work from a card they noticed.
5. **Click "Show N more" in "Earlier"** → expands the collapsed list of
   older completed-with-results experiments. No new modal or route — it
   just appends to the grid in the same shape. Pagination kicks in at
   ~100 cards rendered (lazy-render on scroll) so the page stays light
   for labs with hundreds of historical experiments.

**Filter / sort surface** (the bar above the grid):

- **Sort dropdown**: Freshest results (default) / Most recently completed
  / Most recently started / Project / Contributor.
- **Status filter**: Active / Has result / Awaiting result / Earlier (any
  combination; defaults to all visible).
- **Method filter**: dropdown sourced from the existing `useLabData()` →
  `methods` set, same as `LabSearchPanel`.
- **Project filter**: same as today's filter pattern from
  `selectedProjectIds` in the global store.
- **Date range**: simple "Last 14d / 30d / 90d / All time" chips, same
  pattern as Activity's 30-day window
  (`LabActivityPanel.tsx:17` `RECENT_WINDOW_DAYS`).

(Note: the user-filter chip at the bottom-right of Lab Mode keeps doing
its existing job — filtering who's included in this whole panel. The
panel-level filters above are *within* that selection, not in addition
to.)

**Differentiation from Lab GANTT, Activity, Search, and `/experiments`:**

This is the only view in the app that surfaces actual **experimental
outputs** — image thumbnails from `Images/`, markdown previews from
`results.md`, the "completed but never wrote a result" gap. GANTT shows
time. Activity shows recency in plain text. Search shows hits against a
query. The standalone `/experiments` is a single-user planning queue with
dependency chains. None of them show what experiments *produced*. The
gallery format is the visual answer to "what did we find?" — and the
"Awaiting results" section is unique signal for the PI ("Alex finished
that two weeks ago and never wrote it up — let's ask in the next 1:1").
This is the strongest differentiation the panel can carry given the data
model.

**Implementation effort estimate:** **M.** Most of the structural work
already exists — same `useLabData()` hook, same `<TaskDetailPopup>` /
`<LabUserDetailPanel>` consumers, same color/avatar primitives. The new
work is: (a) a `<ExperimentCard>` component (~150 LOC), (b) a hero-image
resolver that walks `users/<owner>/results/task-<id>/Images/` and falls
back to `results.md` first-paragraph render, (c) section bucketing logic
(Fresh / Active / Awaiting / Earlier) ~80 LOC, (d) the filter/sort bar
~120 LOC. The image walker is the only new file-system pattern and it
mirrors what `LabArchives` already does for image rehydration. Estimate
~600-800 LOC net, mostly contained to the panel.

**Risks / open questions:**

- **Performance with many cards.** Reading the first image of every task's
  `Images/` is dozens of FSA reads on first paint. Mitigation: lazy-load
  thumbnails on scroll (IntersectionObserver), and cache resolved
  hero-paths in a `useMemo` keyed by task id + mtime. The
  read-count instrumentation in `file-service.ts` should make perf
  regressions visible.
- **What counts as a "result"?** The proposal treats "non-empty
  `results.md` OR ≥1 file in `Images/`" as having a result. Worth a
  Grant gut-check — some labs might consider `notes.md` content as
  result-enough, in which case the "Awaiting results" section over-fires.
- **Image privacy.** Wiki-capture mode must keep using fixture data
  (`?wikiCapture=1`). The mock layer
  (`frontend/src/lib/file-system/wiki-capture-mock.ts`) needs at least
  one stub `Images/foo.png` per demo experiment for the redesigned tab to
  look right in screenshots; the demo lab (`frontend/public/demo-data/`)
  probably needs ~3-5 stub image files added.
- **The "Earlier" section can grow unbounded.** A 5-year-old lab might
  have 1000+ completed experiments. The "Show N more" collapse + scroll
  virtualization handles this, but the default "All time" sort needs a
  cap (suggest: only the last 6 months render until the user clicks the
  expand affordance, which then virtualizes the rest).

---

## Proposal B — Structural: kill the Experiments sub-tab

**One-sentence pitch:** Delete the Experiments sub-tab; absorb its real
job ("see every experiment in the lab as an inventory") into Lab Search
with a saved-default of "all experiments, newest first," and let Activity,
GANTT, and Methods continue to own their respective questions.

**Core user question answered:** *"Was this tab even necessary?"* This
proposal's bet is no.

**What it shows:**

This proposal deletes a thing. The "showing" replacement is spread across
three small additions, each rendered in tabs that already exist:

- **Lab Search** gets a default "All experiments, newest first" preset
  loaded on tab open if no filters are touched yet. That gives the user a
  scrollable inventory of every experiment in the lab without typing
  anything — which is the underlying job the current Experiments tab is
  doing, just packaged inside Search where the column-sort + filter
  affordances are already richer.
- **Lab Activity** gets a small enhancement: the existing
  "Recently completed" section (`LabActivityPanel.tsx:202-209`) gains a
  "Show 30 more" expander that paginates back through history in 30-day
  chunks. That covers "I want to see more than the last 30 days but I
  came here from Activity."
- **Lab GANTT** gets a date-window option that already implicitly works
  via the `viewMode` switcher (`LabGanttChart.tsx:222-234`) — the "1Y"
  option is already 52 weeks. The proposed add is a tiny "Compact density"
  toggle that bumps the row height down so a full year of experiments
  fits without overflowing.

**What it deliberately hides:** The Experiments sub-tab itself, including
its grouped + table views.

**Gantt gap analysis (this is the actual decision point):**

For the kill option to be safe, GANTT + Activity + Search + Methods +
single-user `/experiments` must together cover every job the current
Experiments sub-tab is doing. Here is the honest table:

| Use case the current sub-tab serves | Covered after kill by | Quality of coverage |
|---|---|---|
| "What experiments is the lab running today" | Lab Activity → Running now | **Better.** Activity is already sharper for this. |
| "What did the lab finish in the last month" | Lab Activity → Recently completed | **Better.** Same data, fresher framing. |
| "When does X happen on a calendar" | Lab GANTT | **Better.** GANTT is built for this. |
| "Find a specific experiment by name/method/date" | Lab Search | **Equal.** Same filters, more flexible. |
| "See every experiment in the lab as an inventory, organized by who and which project" | Lab Search w/ default preset | **Slightly worse.** The grouped-by-user-and-project hierarchy of the current tab is more scannable than a flat search-result list. This is the gap. |
| "See historical experiments past the 30-day Activity window without typing a search" | Activity → "Show 30 more" addition | **Worse.** Defaults to a temporal sort rather than a hierarchical grouping. |
| "See what one specific user is working on" | User-filter chip + any other tab | **Equal.** User filter already does this. |
| "See dependency chains across experiments" | Single-user `/experiments` | **Equal.** Already only works single-user; the Lab Experiments tab doesn't surface chains today either. |

The single biggest gap is the **hierarchical "by user, then by project,
then by experiment" browsing pattern**. Today's grouped view delivers
that. Lab Search defaults wouldn't — Search shows a flat result list, not
a project-grouped list with section headers. That's a real regression for
a PI who opens Lab Mode, picks 5 students, and wants to scan their
ongoing projects rather than search by keyword.

**Gap-filling additions if we go this route** (cite the files the
additions would land in):

- `frontend/src/components/LabSearchPanel.tsx` — add a "Group results by
  user + project" toggle to the results-rendering section (around lines
  300+, the results-rendering pass). The grouping logic is portable from
  the existing `LabExperimentsPanel.tsx:86-109`. ~80 LOC.
- `frontend/src/components/LabSearchPanel.tsx` — load a default-on-open
  preset of `{task_types: "experiment", completion_status: "all"}` if
  `hasSearched === false` (a state already on the panel,
  `LabSearchPanel.tsx:52`). ~15 LOC.
- `frontend/src/components/LabActivityPanel.tsx` — add a "Show 30 more"
  expander on the "Recently completed" section (around line 286).
  ~50 LOC.

**Differentiation from GANTT:** N/A by construction — this proposal *is*
a bet that the question the current sub-tab tries to answer is either
already answered better elsewhere, or worth letting go of in favor of a
leaner Lab Mode.

**Implementation effort estimate:** **S.** Deletes ~335 LOC (the panel),
adds ~150 LOC across the three sibling panels, removes one tab button +
one branch in `lab/page.tsx`. Net negative LOC. Lowest-risk option for
the codebase.

**Risks / open questions:**

- **The hierarchical-inventory gap is real.** Whether it's *fatal* depends
  on how often anyone actually uses Lab Experiments as a project-grouped
  inventory vs. a "I want to see what's going on" reach-for. There's no
  telemetry — only Grant's intuition.
- **Wiki ripple.** The wiki has a dedicated page at
  `frontend/src/app/wiki/features/lab-mode/cross-user-lists/` (per
  `lab-mode/page.tsx:118-126`) describing Experiments + Methods +
  Roadmaps + Notes as "four cross-user lists." Killing one of the four
  means rewriting that page to be three lists, and updating the screenshot
  in `frontend/public/wiki/screenshots/lab-mode.png` so the tab row
  matches.
- **The Lab tab keeps a tab button for "Experiments" today.** If we kill,
  the route `?tab=experiments` (or the in-app equivalent) needs to either
  redirect to Search or to Activity. A 1-line redirect plus a one-time
  "we moved this" toast on first hit would handle it gracefully.
- **PIs who use this tab for lab-meeting prep would feel the loss most
  acutely.** The wiki explicitly cites that user
  (`wiki/features/lab-mode/page.tsx:33-35`). Activity covers most of
  what they want for the meeting, but the hierarchical inventory may not
  fully translate.

---

## Proposal C — Method-pivot comparison grid

**One-sentence pitch:** Group experiments by the method they used, so the
sub-tab becomes a reproducibility/comparison view — "we ran this
protocol N times across M people; here are the N outcomes side-by-side."

**Core user question answered:** *"Does this protocol work
reproducibly across people in the lab, and how have results varied?"*

**What it shows:**

- One section per method (with at least one attached experiment).
- Inside each section, a horizontal row of compact cards, one per
  experiment using that method.
- Each card: contributor avatar + name, project, run date, status badge,
  a tiny result preview (single thumbnail or first ~40 chars of
  `results.md`), and a "variation: yes/no" indicator (true if
  `method_attachments[].variation_notes` or `.deviation_log` is
  non-empty for this experiment).
- Section header shows: method name, folder, total run count, distinct
  contributor count, "Last run X days ago."

**What it deliberately hides:**

- The user + project grouping. Replaced by method grouping.
- The status/freshness as the top-level organizing principle. Status is
  still on each card, but the page is organized for "compare runs of
  protocol X," not "tell me what's hot."

**ASCII wireframe of the main view:**

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Experiments → grouped by method                                          │
│                                                                           │
│  Sort: [ Most-used method ▼ ]  Filter: [Project][User][Date][Has result]  │
│                                                                           │
│  ┌── ▣ PCR-GFP-v2  •  Methods/Cloning  •  7 runs by 3 people ────────┐    │
│  │                                                                   │    │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  │    │
│  │  │ ░██░ │ │ ░██░ │ │ ░██░ │ │ ░░░░ │ │ ░██░ │ │ ░░░░ │ │ ░██░ │  │    │
│  │  │ @al  │ │ @al  │ │ @kr  │ │ @kr  │ │ @mor │ │ @mor │ │ @al  │  │    │
│  │  │ Run1 │ │ Run2 │ │ Run3 │ │ Run4 │ │ Run5 │ │ Run6 │ │ Run7 │  │    │
│  │  │ 5/2  │ │ 5/4  │ │ 5/7  │ │ 5/8  │ │ 5/10 │ │ 5/11 │ │ 5/14 │  │    │
│  │  │ ✓    │ │ ✓    │ │ ✓    │ │ var◐ │ │ ✓    │ │ ✗    │ │ ✓    │  │    │
│  │  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘  │    │
│  └───────────────────────────────────────────────────────────────────┘    │
│                                                                           │
│  ┌── ▣ MTT-cell-viability  •  Methods/Assays  •  4 runs by 2 people ──┐   │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                              │   │
│  │  │ ...                                                            │   │
│  │  ...                                                              │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  ── Experiments with no attached method ──                                │
│  ┌──────────────────────┐  ┌──────────────────────┐                       │
│  │ ● Pilot scoping      │  │ ● Quick check        │                       │
│  │ @al • Aging          │  │ @kr • Cardio         │                       │
│  └──────────────────────┘  └──────────────────────┘                       │
└───────────────────────────────────────────────────────────────────────────┘
```

**Key interactions:**

1. **Click a card** → `<TaskDetailPopup readOnly>` as today.
2. **Click section header (the method name)** → navigates to the Lab
   Methods tab, that method auto-expanded. Round-trip with the Lab
   Methods tab is the key feature: Methods owns the protocol, Experiments
   owns the runs of the protocol.
3. **Hover a card** → `<TaskQuickPopup>` showing the variation notes /
   deviation log if any (this is the data the comparison surface is
   uniquely positioned to make visible).
4. **Click the "variation: yes" indicator** → opens the popup with the
   variation_notes tab pre-selected.
5. **Filter "Has result" on** → hides cards with empty `results.md` and
   empty `Images/`, so each method's row only shows reproducibility data
   worth comparing.

**Differentiation from Lab GANTT, Activity, Search, and Methods:**

This proposal lives in tension with the existing **Lab Methods** tab,
which is the closest neighbor in the design space. Methods rolls up per
method, shows usage count + last-used + contributors, and has an
expandable per-method task list. Proposal C inverts the priority: the
*comparison of outcomes* is the page, the method is just the grouping
key. Methods optimizes for "who used what," this optimizes for "here
are the runs, do they agree." If we ship this, Methods stays as a
library/admin view and Experiments becomes the empirical-comparison view.
The overlap is real but the foregrounded data is different (per-experiment
outcome thumbnails + variation notes are not in Methods today).

**Implementation effort estimate:** **M.** Same general scope as
Proposal A — most of the work is in a new card component and the
section-rollup logic. Slightly cheaper than A because it doesn't need the
4-section bucketing (Fresh / Active / Awaiting / Earlier); slightly more
expensive because horizontal-scroll rows have layout edge cases (long
method names overflowing, replicating with 20+ runs needing virtualized
horizontal scroll). Estimate ~500-700 LOC.

**Risks / open questions:**

- **Lab Methods is too close.** Honest concern. If this ships, the wiki
  page for cross-user-lists has to argue why both exist. Could be
  resolved by demoting Methods to "library" framing and Experiments to
  "outcomes" framing, but that's a wiki rewrite.
- **Most experiments don't have multiple replicates yet.** If a lab
  rarely runs the same protocol twice, every section is one card and the
  view degenerates into a slightly-fancier grouped list. Worth a
  Grant-input question: how common are replicates in this lab and
  similar labs?
- **The "no method" tail.** Some experiments don't attach a method at
  all (`method_ids` empty). A catch-all section at the bottom handles
  them but the design pressure to attach methods just to be visible
  here is real and might be either a feature (encourages
  methodology hygiene) or a friction.

---

## Recommendation

**Ship Proposal A — Outcomes-first results gallery.**

Two factors swung the choice.

First, **what differentiates this panel must come from the data nothing
else surfaces.** GANTT owns time. Activity owns recency. Search owns
query. Methods owns the library. The thing left over — the actual
*output* of each experiment, the `results.md` + `Images/` content — is
not on screen anywhere else in the app. A redesigned Experiments tab
that leads with that output is the only redesign whose thesis can't be
re-argued as "but isn't that just GANTT / Activity / Search?" Proposal A
makes the panel uniquely about outcomes, and the "Awaiting results"
section is a forcing function for the PI workflow ("we finished this two
weeks ago, why is there nothing to show?") that has no parallel in the
app today.

Second, **the structural kill option (Proposal B) leaves a real but
narrow gap.** GANTT, Activity, Search, and Methods cover almost every
job the current sub-tab is doing — *except* hierarchical project-grouped
browsing of every experiment in the lab. That gap is fillable in Search
with a "group by user + project" toggle and an open-on-load default
preset. It would be the right call if the redesign budget were tiny or
if the team strongly preferred deleting a tab over rebuilding one. But
killing the tab burns the opportunity to surface outcome data that isn't
visible anywhere else, in service of making the app *smaller*. Given
that Lab Mode is a wall-mounted-TV-in-the-lab / PI-prepping-for-meeting
view (per the wiki framing), trading the outcome-surfacing potential for
a tab-count reduction is a worse deal than just rebuilding the tab.

Proposal C is a strong runner-up if it turns out that the lab actually
runs the same protocols repeatedly (replicate-heavy work). For a lab
that runs each protocol once or twice, Proposal C's method-grouped
sections will mostly be sections-of-one and the page will feel sparse.
Proposal A degrades more gracefully — fewer experiments just means fewer
cards, but the layout still reads.

## Migration / rollout notes

- **No feature flag needed.** This is a self-contained panel rewrite in
  Lab Mode (a read-only view), no data migration, no API changes. The
  worst-case rollback is reverting one file. A side-by-side toggle would
  add maintenance burden without much risk reduction. Recommend direct
  replacement.
- **Routes.** The `?tab=experiments` (or the in-memory `activeTab`
  equivalent) stays — same tab, new contents. No redirect logic needed.
- **Demo lab data.** The demo data in `frontend/public/demo-data/`
  currently has experiments but doesn't ship `Images/` content per task.
  For the redesigned panel to look right in the live demo + in
  screenshots, the demo lab needs ~3-5 stub PNGs added under at least
  3-4 of its tasks' `users/<owner>/results/task-<id>/Images/`
  directories, plus non-empty `results.md` content on at least 2-3 tasks
  so the markdown-preview fallback path also has something to show. This
  is a self-contained sub-task that can ship independently.
- **Wiki updates.**
  - `frontend/src/app/wiki/features/lab-mode/page.tsx:118-126` — rewrite
    the "Experiments, Methods, Roadmaps, and Notes — four cross-user
    lists" lump. The Experiments line specifically should describe the
    outcome-gallery thesis ("an outcome-first board of what the lab has
    figured out lately, with surfacing of experiments that are
    finished-but-undocumented").
  - The cross-user-lists wiki page mentioned at
    `lab-mode/page.tsx:119-122` needs a per-tab section rewrite for
    Experiments specifically.
  - A new screenshot at `frontend/public/wiki/screenshots/lab-mode-experiments.png` (using `?wikiCapture=1` fixture
    mode, per the screenshot-privacy memory entry) showing the
    redesigned gallery. The existing `lab-mode.png` screenshot of the
    Activity tab doesn't need to change.
- **Wiki capture mock.** `frontend/src/lib/file-system/wiki-capture-mock.ts`
  needs at least one fixture image and one fixture `results.md` content
  string per demo experiment for the redesigned view to capture cleanly.
  Roughly the same delta as the demo-data change above, just mirrored on
  the mock side.
- **Activity's "Recently completed" section overlaps with the new
  "Fresh results" section.** They show similar data with different
  thesis (Activity = "what happened," Experiments = "what was learned").
  If the overlap feels noisy in practice, the Activity section could
  later narrow to "Recently *started*" — but that's an Activity-tab
  decision, not a precondition for this proposal.
- **Stats strip cleanup.** Remove the in-panel 4-card stats row
  (`LabExperimentsPanel.tsx:122-145`) since `lab/page.tsx:309-328`
  already shows a 4-card strip above the panel on this tab. Pure
  duplication cleanup, no behavior change.

## What this proposal does NOT decide

- Exact card pixel dimensions, the grid breakpoints, and whether cards
  are 280px or 320px wide.
- Exact threshold for "Fresh" (proposal says 14 days; could be 7 or 21
  depending on how a real lab's cadence reads).
- Exact threshold for "Awaiting results" (proposal: completed >3d ago
  with no `results.md` body and no `Images/` content; the day count is
  debatable).
- Whether `notes.md` content counts toward "has a result." Proposal A
  says no (notes are process, results are conclusions), but the labs
  that use `notes.md` heavily and never write `results.md` would
  disagree. Flag for Grant confirmation.
- Icon set and exact placement of the "variation present" indicator
  (`◐` in the wireframe). Should pick whatever icon family the rest of
  Lab Mode uses.
- Color palette beyond reusing existing status colors (the emerald /
  blue / red / amber palette `/experiments` already uses).
- Whether the panel should add a "Compare" multi-select mode for
  side-by-side detail. Tempting but separable — ship the gallery first,
  see whether labs ask for it.
- Whether the hero-image walker should also probe sub-task images / PCR
  protocol images. Proposal A scopes hero-image discovery to the task's
  own `Images/` folder for V1.

---

*Open questions to confirm with Grant before implementation kicks off:*

1. How often does the lab actually run the same protocol multiple times
   (replicates)? If "frequently," that's a strong nudge to revisit
   Proposal C; if "rarely," Proposal A is unambiguously the right call.
2. Does `notes.md` content count as "has a result" for the purposes of
   the "Awaiting results" bucket? Yes/no changes the panel's
   nag-the-PI bias.
3. Is there a "results-style" file outside of `results.md` and `Images/`
   that should also count as a result? (e.g. a `data/` folder convention,
   exported CSVs in `Files/`?)
4. Demo-lab Images. Should the demo-data update ship in this same chip
   or be a separate small sub-task?
