# /results page redesign — proposal

## Context

Grant flagged the standalone `/results` page (`frontend/src/app/results/page.tsx`, 314 LOC) as "lackluster and confusing rn. What does it really show that isn't on the other pages." This proposal is the third in a series of UX-thesis exercises — the prior two reshaped the surfaces that now sit closest to `/results`:

- **[EXPERIMENTS_REDESIGN_PROPOSAL.md](EXPERIMENTS_REDESIGN_PROPOSAL.md)** turned the `/lab` Experiments sub-tab into an outcomes-first gallery (Fresh / Active / Awaiting / Earlier sections, hero thumbnails, Compare-by-method toggle). Shipped at commit 761dd90d via `frontend/src/components/LabExperimentsPanel.tsx`.
- **[EXPERIMENTS_STANDALONE_PROPOSAL.md](EXPERIMENTS_STANDALONE_PROPOSAL.md)** proposes turning the single-user `/experiments` page into a stages-based decision queue (Ready → Blocked → Running → Awaiting writeup → Recent results) — recommended thesis "Workbench." Implementation chip is in flight; not yet on `main` as of this writing — `/experiments` still ships its today-layout and nav still labels it "Lab Notes" ([frontend/src/lib/nav.ts:13](frontend/src/lib/nav.ts:13)).

Both of those redesigns surface result content that today only `/results` carries. Lab Experiments leads with hero images and `results.md` previews for the whole lab; Workbench will lead with a per-user "Recent results" section for the last 30 days. That leaves `/results` standing on much thinner ground than when it shipped, and Grant's "what does it really show that isn't on the other pages" is the right framing — the differentiation analysis below is the spine of this proposal, not a side check.

`/results` is also the only nav surface that touches **non-experiment** completed work — purchases and list tasks live here alongside experiments. That cross-type unification is the one job no other current or proposed view does, and it's the asset the rebuild (or the kill) has to honestly account for.

## Current state

Inventory of what `frontend/src/app/results/page.tsx` renders today:

- **Page header** ([frontend/src/app/results/page.tsx:177-206](frontend/src/app/results/page.tsx:177)): `<h2>Results</h2>` plus a horizontal pill row for project filtering, driven by `selectedProjectIds` in the global `useAppStore`. Each pill shows the project's color and dims when filtered out.
- **Task-qualification filter** ([frontend/src/app/results/page.tsx:51-59](frontend/src/app/results/page.tsx:51)): a task lands on the page if `is_complete OR deviation_log`. This is **task-type agnostic** — experiments, purchases, and list tasks all qualify. No filter by `task_type` anywhere in the file. Default sort: `start_date` descending.
- **Project-grouped cards** ([frontend/src/app/results/page.tsx:208-285](frontend/src/app/results/page.tsx:208)): one section per project, header is uppercase tracking-widest project name in the project's color; underneath a 3-column responsive grid of cards. Project bucketing is composite-keyed `${owner}:${id}` per the cross-user collision sweep documented at [AGENTS.md:817](AGENTS.md:817).
- **Per-card content** ([frontend/src/app/results/page.tsx:219-281](frontend/src/app/results/page.tsx:219)): task name (`line-clamp-2`), green completion dot if `is_complete`, `start_date · {duration_days}d` (no end-date or days-since-completion cue), and indicator pills: **Notes** (blue, lights up if `results.md` OR `notes.md` exists), **N files** (purple, counts `Files/` + `Images/` + legacy `Attachments/`), **Deviations** (amber, lights up if `deviation_log` non-empty), or **No results yet** (gray fallback). Tags strip below if any.
- **Results probe** ([frontend/src/app/results/page.tsx:95-142](frontend/src/app/results/page.tsx:95)): async file-system walk for each card resolving `findExistingTaskResultsBase(task)` then `filesApi.listDirectory` on the base + `/Files` + `/Images` + `/Attachments`. Per-task fan-out cached in a React Query under `["resultCards", ...taskKeys]`. This is a heavy first-paint cost — dozens of FSA reads per project before anything shows.
- **Click action** ([frontend/src/app/results/page.tsx:301-310](frontend/src/app/results/page.tsx:301)): opens `<TaskDetailPopup>` with `initialTab="results"`. This was the deliberate consolidation per [AGENTS.md:828](AGENTS.md:828) — `ResultsEditor.tsx` was deleted in `eb9a4fb3` and the page now exists primarily as a launch surface for the popup's Results tab.
- **Empty state** ([frontend/src/app/results/page.tsx:287-294](frontend/src/app/results/page.tsx:287)): "No results yet. Complete tasks to see them here."

**What the current page does well (worth preserving):**

- It's **all-task-type unified** — only nav surface that shows completed purchases + completed list tasks alongside completed experiments. Workbench will be experiments-only; `/purchases` shows order pipeline (pending → ordered → arrived) but no archival view.
- The "Notes / files / Deviations / No results yet" indicators are the single fastest way to scan "which completed experiments are missing a write-up."
- Project-grouped layout is more scannable for "how much have I shipped in project X" than a flat list would be.

**What the current page does poorly (or doesn't do at all):**

- No hero thumbnails. The `Images/` first-image walker and the `results.md` preview helpers in [frontend/src/lib/experiments/findTaskResultsBase.ts](frontend/src/lib/experiments/findTaskResultsBase.ts) exist (landed with the Lab Experiments redesign at 761dd90d) but `/results` doesn't consume them. Visually identical chrome whether the experiment produced a stunning gel image or nothing at all.
- No "Notes" / "Results" distinction in the indicator. The blue "Notes" pill fires for `results.md` OR `notes.md` — a researcher can't tell from the card face whether the actual write-up exists or only running observations.
- The "No results yet" gray pill is the most actionable signal on the page (a researcher should write something up) but it sits visually equal to the cheerful "Notes" / "files" badges instead of being foregrounded. Compare with Workbench's proposed "Awaiting writeup" section, which makes it the spine of the layout.
- No method chips. Same data shape as Lab Experiments — `method_ids[]` + the methods join — discarded.
- No freshness signal. "Completed yesterday" vs. "Completed 8 months ago" reads identically.
- Includes tasks with `deviation_log` set but `!is_complete` — a quirky category that means "this task ran weird but isn't done." Such tasks render the same as completed ones, which is misleading.
- Project filter pills use bare `p.id` instead of composite `${owner}:${id}` ([frontend/src/app/results/page.tsx:184-186](frontend/src/app/results/page.tsx:184)) — same intentional skip flagged in the cross-user sweep at [AGENTS.md:451](AGENTS.md:451). Two same-id projects from different users collapse to one chip.
- Wiki page at [frontend/src/app/wiki/features/results/page.tsx](frontend/src/app/wiki/features/results/page.tsx) describes the page as "a board of every task you've completed... grouped by project, with a quick way to write up what the experiment showed." That framing is honest about the page's thin thesis: it's a launcher for the popup's Results tab dressed up as a gallery.

## Differentiation analysis

The spine of the proposal. For each view, what it owns and where `/results` overlaps. File-path citations verified by reading each file.

| View | Thesis (one sentence) | Data it foregrounds | Overlap with /results? |
|---|---|---|---|
| **/lab Experiments** (`frontend/src/components/LabExperimentsPanel.tsx`, shipped 761dd90d) | "What did the lab figure out — and who finished without writing it up?" | Cross-user outcome gallery: hero thumbnails, `results.md` previews, contributor avatars, method chips, Fresh / Active / Awaiting / Earlier sections. Has a Compare-by-method toggle. | **High overlap on experiment results.** Lab Experiments now does the same job `/results` does for the experiment slice, with strictly more data on the card face. The only deltas: Lab Experiments is cross-user (`/results` is single-user), Lab Experiments is experiments-only (`/results` includes purchases + list tasks), and Lab Experiments has a 7-day "Fresh" window cutoff (`/results` shows all-time). |
| **/experiments (Workbench, in flight)** (`frontend/src/app/experiments/page.tsx`, current state still chain-cards-by-project — Workbench redesign approved per [EXPERIMENTS_STANDALONE_PROPOSAL.md](EXPERIMENTS_STANDALONE_PROPOSAL.md), not yet on main) | "What should I work on right now, and what's stuck waiting on me?" | Stages: Ready → Blocked → Running → Awaiting writeup → Recent results → Earlier. Writable. Experiments-only, current user only. | **Medium-high overlap on completed experiments.** Workbench's "Recent results" + "Earlier" sections will cover the single-user experiment slice with hero thumbnails + freshness. Workbench's "Awaiting writeup" subsumes `/results`'s "No results yet" pill. Workbench will not cover purchases or list tasks. |
| **Home `/`** (`frontend/src/app/page.tsx`) | "Where do I stand on each project?" | Project cards with progress bar (`completed/total` ratio), Active / Overdue / Upcoming counts, top-N "Next Up" task list per project. Click a project → `<ProjectDetailPopup>` showing In Progress / Overdue / Upcoming / Hosted-from-others — note that the popup explicitly has **no "Completed" section** ([frontend/src/components/ProjectDetailPopup.tsx:586-670](frontend/src/components/ProjectDetailPopup.tsx:586)). | **Low overlap.** Home shows progress-bar percentages but no individual completed work. The project popup deliberately omits the completed list. This is the gap a per-project results surface could fill — see Proposal B. |
| **/search** (`frontend/src/app/search/page.tsx`) | "Find a specific thing across the workspace." | Free-text + structured filters (task type, project, method, date range, completion status). Flat result grid sorted by `start_date` desc. Supports multi-select + bulk export. | **Low overlap** for browsing, **high overlap** for completed-work lookup. With `completionStatus: "complete"` set, `/search` returns the same set of tasks `/results` shows. But `/search` is intent-driven (the user has a query in mind); `/results` is browse-driven (the user wants to scan). |
| **Lab Activity** (`frontend/src/components/LabActivityPanel.tsx`) | "What's happening across the lab right now?" | Three sections, 30-day windows: Running now (experiments + purchases in flight), Recently completed (experiments + purchases finished in last 30d, sorted by `end_date` desc), Recent shared notes (notes updated in last 30d). | **Medium overlap on the 30-day completed window.** Lab Activity's "Recently completed" covers the same ground `/results` does for last 30 days, but cross-user, no project grouping, no result indicators, no all-time. |
| **/calendar** (`frontend/src/app/calendar/page.tsx`) | "What's today / this week, with my external feeds overlaid." | Date grid + ICS feed events. No task data on the page at all (verified — `events` only, no `tasks` query in the file). | **No overlap.** Calendar doesn't touch completed work. |

**Where the cross-cutting overlap concentrates:** the experiment slice of `/results` is now redundantly covered by three other views — Lab Experiments (cross-user), Workbench (single-user, planning-led), and Activity (cross-user, 30-day). The single experiment view that's uniquely useful in `/results` today is "all-time completed experiments grouped by project for the current user" — and even that has a viable home in Workbench's "Earlier" section once the implementation lands.

**Where `/results` adds signal nothing else does:**

1. **Completed purchases as an outcomes view.** `/purchases` is order-pipeline-shaped, not archive-shaped. No other view shows "what did I successfully buy / receive / install in this project."
2. **Completed list tasks as an archive.** No other surface shows finished todos / reading-list items / paper-prep milestones across projects.
3. **All-time + all-types unified.** The one nav entry that says "show me everything I've shipped, regardless of when or what type." Workbench, Lab Experiments, and Activity are all narrower.
4. **`deviation_log` tasks that aren't complete.** A small idiosyncratic category — running tasks that hit a snag and need recording. No other view surfaces them.

That's the honest residual. The kill option (Proposal A) must absorb #1, #2, and #3 to be safe; the per-project option (Proposal B) preserves #2 and #3 but loses cross-project browsing; the outcomes-archive option (Proposal C) keeps all four.

## Candidate theses considered

Six theses evaluated. The two structural options (A and B) plus the strongest replacement-style proposal (C) are fleshed out below. Rejected ones at the end with reasoning.

1. **STRUCTURAL: Kill `/results`; fold the experiment slice into Workbench's "Earlier," the purchase slice into a new `/purchases` "Earlier" section, leave list-task archives unaddressed.** Fleshed out as **Proposal A (recommended)**. The deferred Q4 from the Workbench proposal.

2. **STRUCTURAL: Per-project results pages reachable from the project popup; kill the top-level `/results` route.** Fleshed out as **Proposal B**. Projects own their results.

3. **All-types Outcomes Archive — single-user, all-time, hero thumbnails for experiments + receipt/vendor cards for purchases + checkbox cards for list tasks, unified under one outcome-card primitive.** Fleshed out as **Proposal C**. Replacement, not kill.

4. **Insight-summary view — per-result narrative + cross-experiment synthesis cards (e.g. "across these 5 PCR runs, the methyl-cytosine band intensity trended X").** *Considered, rejected.* Requires editorial classification + structured "finding" extraction that the data model doesn't carry; effectively an AI-narrative feature whose scope is much larger than a page redesign. Worth queuing as a future feature but not a near-term replacement.

5. **Publication-prep view — group results by project + show "ready for paper" status (writeup present? figure present? methods tagged?). Optimizes for "what's ready to put in Fig 3?"** *Considered, rejected.* The "ready-for-paper" check is a per-result editorial judgment (the writeup needs to be *good*, not just present), and the data model has no boolean to back it. Could be revisited if a `publication_ready` field is ever added.

6. **Backward-chronology archive — timeline view of all completed work with skip-date navigation, "scroll through your year."** *Considered, rejected.* The view is pretty but its job is already half-done by `/gantt` (the time axis is right there, completed bars muted) and `/calendar`. Adding a third time-anchored view dilutes both; the marginal value over Lab Activity's "Recently completed" is small for the most-common use case (recent retrospection).

---

## Proposal A — STRUCTURAL: kill `/results` (recommended)

**One-sentence pitch:** Delete the `/results` route; absorb its three real jobs into the views that already own the adjacent thesis — experiment archives into Workbench's "Earlier," completed-purchase archives into a new `/purchases` "Earlier" section, and per-project completion glances into a new "Recently completed" line on `<ProjectDetailPopup>`. The app loses a nav entry; gains a sharper, less-redundant set of completion surfaces.

**Core user question answered:** *"Was this page pulling its weight?"* This proposal's bet is no — every job it does either duplicates a better-positioned view or is absorbable into an adjacent one with small additions.

**What changes** (the kill is spread across four small edits, no new top-level routes):

1. **Workbench's "Earlier" section becomes the experiment archive.** Today the Workbench proposal specifies "Earlier" as a collapsed accordion for completed-with-results experiments past the 30-day Recent window. The kill option upgrades "Earlier" from a collapsed accordion to an expandable scroll region with no time cap and an optional project-grouping toggle (matches today's `/results` project-grouped layout for users who want it). Reuses the just-landed `<ExperimentResultCard>` so the visual treatment matches Lab Experiments. The user gets hero thumbnails on completed experiments — strictly more than `/results` shows today. **Lands in:** [frontend/src/app/experiments/page.tsx](frontend/src/app/experiments/page.tsx) ("Earlier" section enhancement, ~120 LOC added to the Workbench implementation chip's scope).

2. **A new "Earlier" section on `/purchases` handles completed-purchase archiving.** Today `/purchases` shows the active pipeline; arrived purchases drop off the visible surface. The kill option adds a collapsed accordion at the bottom listing completed purchases grouped by project, with vendor + cost + arrival-date on the row face. No new card primitive needed — the existing `/purchases` row treatment carries through. **Lands in:** [frontend/src/app/purchases/page.tsx](frontend/src/app/purchases/page.tsx) (~80 LOC for the section + grouping logic).

3. **A new "Recently completed" line in `<ProjectDetailPopup>`** under the existing In Progress / Overdue / Upcoming sections ([frontend/src/components/ProjectDetailPopup.tsx:586-670](frontend/src/components/ProjectDetailPopup.tsx:586)). Capped at the last 30 days of completed tasks for that project, all task types. Click → opens `<TaskDetailPopup initialTab="results">` (same launch contract `/results` uses today). Provides the "what did I just finish in this project" glance that the project popup deliberately omits today. **Lands in:** [frontend/src/components/ProjectDetailPopup.tsx](frontend/src/components/ProjectDetailPopup.tsx) (~70 LOC).

4. **The `/results` route is deleted from nav** ([frontend/src/lib/nav.ts:17](frontend/src/lib/nav.ts:17)) and the route file is deleted. A one-time `useEffect` redirect in the deleted page's place (or middleware) sends `/results` → `/experiments` for users with the URL bookmarked, with a one-time amber toast: *"Results moved — completed experiments now live in Workbench's archive. Completed purchases live at the bottom of Purchases."*

**What it deliberately hides:** The `/results` route, its top-level nav entry, its project-grouped card grid, and the "Notes / files / Deviations / No results yet" indicator family. The actionable signal those indicators carried is preserved better in Workbench's "Awaiting writeup" section (foregrounded, not buried inline).

**Gap analysis (this is the actual decision point):**

For the kill option to be safe, Workbench + `/purchases` + `<ProjectDetailPopup>` + Lab Experiments + `/search` must together cover every job the current `/results` is doing. Honest table:

| Use case `/results` serves today | Covered after kill by | Quality of coverage |
|---|---|---|
| "Show me all my completed experiments grouped by project" | Workbench's enhanced "Earlier" with project-grouping toggle | **Better.** Today's `/results` cards have no thumbnails, no method chips, no freshness. Workbench's "Earlier" reuses `<ExperimentResultCard>` and gets all three. |
| "Which experiments did I finish without writing up?" | Workbench's "Awaiting writeup" section | **Strictly better.** Workbench foregrounds this as a top-level section; `/results` buries it in a gray "No results yet" pill at card-bottom. |
| "Show me all my completed purchases" | `/purchases` new "Earlier" accordion | **Better.** `/purchases` row treatment already shows vendor + cost + dates, which `/results` doesn't surface today (the card only shows the task name). |
| "What have I just finished in project X?" | `<ProjectDetailPopup>` new "Recently completed" section | **Better.** Today the user has to navigate to `/results`, filter by project, scan. The popup-embedded version is one click from the project card. |
| "Show me everything I've ever shipped in any project" | No single direct replacement. Workbench + `/purchases` "Earlier" sections together give the same data, in two places. | **Slightly worse.** The all-types unification is the single gap. Honest assessment below. |
| "Look up a specific completed task by name" | `/search` with `completionStatus: "complete"` | **Equal.** `/search` already supports this filter. |
| "Show me completed list tasks (todos, reading items, milestones)" | The `<ProjectDetailPopup>`'s new "Recently completed" section, scoped per project | **Worse.** Cross-project archive of list-task work disappears. Honest assessment below. |
| "Tasks with a `deviation_log` but not yet complete" | Workbench's "Running" section (where deviations show as a `⚠ deviated` chip per the proposal) | **Equal.** Same data, more contextual placement. |

**The two gaps that are real:**

- **Cross-project all-types unified archive.** Disappears — by design. The bet is that the unification was a convenience artifact, not a primary use case. A user who wants "everything I've shipped" can scan Workbench's Earlier (experiments) and `/purchases`' Earlier (purchases) in succession; both are one click from nav. List tasks complete this archive triangle but rarely warrant a dedicated browse.
- **List-task archive across projects.** Disappears. The honest take: list tasks (per the data model in [frontend/src/lib/types.ts:200](frontend/src/lib/types.ts:200)) are administrative — todos, reading items, paper-prep milestones. A retrospective cross-project view of completed list tasks reads like timesheet trivia. If a user wants it, the project-popup "Recently completed" line covers per-project. If demand surfaces, list-task archives could be folded into Workbench at that point (the Notes panel inside Workbench is the natural home).

**Gap-filling additions if we go this route** (file pointers for the HR fold-in):

- [frontend/src/app/experiments/page.tsx](frontend/src/app/experiments/page.tsx) — extend Workbench's "Earlier" section per the EXPERIMENTS_STANDALONE_PROPOSAL.md design from "collapsed accordion" to "expandable scroll region with optional project-grouping toggle, no time cap." Reuses `<ExperimentResultCard>` + `probeTaskResults`. ~120 LOC ADD to the Workbench implementation chip's scope.
- [frontend/src/app/purchases/page.tsx](frontend/src/app/purchases/page.tsx) — add a collapsed "Earlier" accordion at the bottom grouping completed purchases by project, sorted newest-first. ~80 LOC. Independent chip from Workbench; can ship in parallel.
- [frontend/src/components/ProjectDetailPopup.tsx](frontend/src/components/ProjectDetailPopup.tsx) — add a "Recently completed" section under the existing In Progress / Overdue / Upcoming blocks at lines 586-670. Cap at last 30 days, all task types. ~70 LOC.
- [frontend/src/lib/nav.ts:17](frontend/src/lib/nav.ts:17) — delete the `/results` nav entry. 1 line.
- Delete [frontend/src/app/results/page.tsx](frontend/src/app/results/page.tsx). 314 LOC removed.
- Add a small `/results` → `/experiments` redirect (middleware or a thin `page.tsx` that calls `redirect()` from `next/navigation`). ~15 LOC.
- [frontend/src/app/wiki/features/results/page.tsx](frontend/src/app/wiki/features/results/page.tsx) — rewrite (or delete + redirect in `wiki/page.tsx` nav) to point users to the new homes. ~80 LOC rewrite to a thin "where things went" reference.
- [frontend/src/app/wiki/features/settings/page.tsx:45](frontend/src/app/wiki/features/settings/page.tsx:45) and `:181` — strip "Results" from the cross-tab references. Small textual edits.
- [frontend/src/app/wiki/features/markdown-editor/page.tsx:40](frontend/src/app/wiki/features/markdown-editor/page.tsx:40) — the page links to `/wiki/features/results`; either update the link or delete the reference.
- [frontend/src/app/wiki/features/experiments/page.tsx:105](frontend/src/app/wiki/features/experiments/page.tsx:105) — "Lab Notes and Results" section heading inside the Experiments wiki page is fine to keep (Notes and Results tabs still exist on `<TaskDetailPopup>`); no changes needed.

**Shared primitives consumed:** The kill option doesn't introduce a new card primitive — the existing Workbench "Earlier" / "Recent results" sections already plan to use `<ExperimentResultCard>`, `<MethodChip>`, `<FreshnessTag>`, and `probeTaskResults` / `getHeroImageForTask` / `getResultsPreview` from `frontend/src/lib/experiments/findTaskResultsBase.ts`. The Workbench implementation chip will already touch all four; this proposal just extends its Earlier-section scope. `/purchases` Earlier accordion does not need new primitives — reuses today's purchase-row component. Project popup "Recently completed" reuses the existing task-row treatment from In Progress / Overdue / Upcoming sections.

**Implementation effort estimate:** **S/M.** Net negative LOC. Deletes ~314 LOC (`/results/page.tsx`), adds ~270 LOC across three sibling surfaces, plus ~15 LOC redirect + ~80 LOC wiki rewrite. Roughly a single afternoon chip if the Workbench implementation is already in flight (most of the cost is in the Workbench "Earlier" enhancement, which is incremental to work already happening). The risk is concentrated in coordination — the Workbench chip needs to land first, or in the same merge train, or the kill leaves users with no archive for ~2 days.

**Risks / open questions:**

- **Coordination cost with Workbench chip.** If Workbench's "Earlier" enhancement doesn't ship before or with the `/results` deletion, users have no experiment archive for the gap window. Mitigation: make the deletion a follow-up chip to the Workbench landing, not a parallel one.
- **The "Notes" indicator merger.** Today's `/results` indicator fires for `results.md` OR `notes.md`. The Lab Experiments / Workbench redesigns count only `results.md` (per the v3 ruling in [findTaskResultsBase.ts:11](frontend/src/lib/experiments/findTaskResultsBase.ts:11)). A user who currently uses `notes.md` heavily and never writes `results.md` will see their experiments shift from "Notes" pill (today, `/results`) to "Awaiting writeup" (after migration, Workbench). That's actually the right behavior per the v3 ruling, but it's a visible state change worth calling out in the migration toast.
- **The `deviation_log` carve-out.** `/results` today includes tasks where `is_complete === false && deviation_log !== null` (running tasks that hit a snag). Workbench's "Running" section will surface deviation chips per the proposal, so this case is covered — but it's worth verifying during implementation that no edge case (e.g., a task with a deviation log but no other completion signal) falls through the cracks.
- **Wiki ripple is small but non-zero.** [frontend/src/app/wiki/features/results/page.tsx](frontend/src/app/wiki/features/results/page.tsx) is a dedicated 100-LOC page that goes away. Two screenshot files (`results-list.png`, `results-tab.png`) become orphaned in `public/wiki/screenshots/` — should be deleted in the same chip. The `lab-notes-vs-results` framing currently lives on the results page; it should migrate into the Workbench / Experiments wiki page rewrites instead of being lost.
- **Users with `/results` bookmarked.** The one-time redirect + toast covers the muscle-memory loss; the more interesting question is what to do for users who have the page hidden via the Settings → Tabs preference. Their setting becomes stale (refers to a deleted tab). Migration: silently drop deleted href from `hidden_tabs` arrays during the next settings read.
- **Cross-type unification gap.** Real but probably narrow. A user who genuinely wants "everything I've shipped in any task type, any project, ever" loses the single-page view. They have to look at two places (Workbench Earlier + `/purchases` Earlier). Question for Grant: is this a real workflow you use? If yes, Proposal C is the better landing.

---

## Proposal B — STRUCTURAL: per-project results pages from the project popup

**One-sentence pitch:** Replace the top-level `/results` route with per-project results surfaces reachable from `<ProjectDetailPopup>` — a "Results" tab inside the popup, plus an optional deep-link URL `/projects/:owner/:id/results` for bookmarking. The mental model becomes "completed work belongs to its project," not "completed work belongs to a separate archive."

**Core user question answered:** *"How should I think about a finished experiment — as part of the project that produced it, or as part of a separate archive of finished work?"* This proposal's bet is project-shaped.

**What changes:**

1. `<ProjectDetailPopup>` gains a new tab row at the top of the popup body — currently the popup has no internal tab structure ([frontend/src/components/ProjectDetailPopup.tsx](frontend/src/components/ProjectDetailPopup.tsx)). New tabs: **Overview** (today's content — stats, archive/unarchive, Edit) and **Results** (new — completed-tasks gallery scoped to this project). The Results tab renders `<ExperimentResultCard>` for experiment results, plus simpler row treatments for completed purchases and list tasks.
2. A new route `/projects/[owner]/[id]/results/page.tsx` provides a bookmarkable full-page view of the same Results tab content. Renders inside `<AppShell>`. Useful for sharing a link to one project's results with a labmate.
3. `/results` top-level route deleted. Same redirect-and-toast pattern as Proposal A, but the toast says *"Results moved — open any project from Home to see its results."*
4. Nav loses `/results`. No net new nav entry — the project popup is reached from Home's project cards as today.

**What it deliberately hides:** The cross-project "what have I shipped recently across everything" view. By design — this proposal bets that completed work is project-shaped, and a cross-project view is a different question (better answered by Lab Activity's "Recently completed" or Workbench's "Recent results").

**Gap analysis:**

| Use case `/results` serves today | Covered after kill by | Quality of coverage |
|---|---|---|
| "Show me completed work in project X" | `<ProjectDetailPopup>` Results tab | **Better.** One click from Home; richer card treatment than today's flat `/results` cards. |
| "Show me a specific project's results to a labmate via URL" | `/projects/[owner]/[id]/results` deep link | **New capability.** Doesn't exist today. |
| "Show me all my completed work across all projects in one view" | No direct replacement. Workbench "Earlier" (experiments only), Activity "Recently completed" (30 days only). | **Worse.** Real gap. The user has to know to look in two places, or do a `/search` with `completionStatus: complete`. |
| "Which experiments did I finish without writing up?" | A small "Awaiting writeup" badge on each project card on Home (proposed gap-filler) + Workbench's section | **Equal.** Workbench already does this; Home gains a glance. |
| "Tasks with `deviation_log` but not complete" | Workbench's "Running" section deviation chip | **Equal.** |

**The big gap:** **cross-project browsing of completed work.** A researcher with 5 active projects who wants to scan "what have I just finished anywhere" has to click into each project popup in turn, or pull up Lab Activity (30-day cap, cross-user, no per-project organization), or run a `/search` query (intent-driven, not browse-driven). For some users this is fine — they think project-by-project. For others (Grant's framing of the use case is unknown), the cross-project glance is the muscle-memory move.

**Gap-filling additions if we go this route:**

- [frontend/src/components/ProjectDetailPopup.tsx](frontend/src/components/ProjectDetailPopup.tsx) — add a tab row + Results tab content. ~200 LOC.
- New file: `frontend/src/app/projects/[owner]/[id]/results/page.tsx` — thin wrapper rendering the same Results tab content inside `<AppShell>`. ~80 LOC.
- [frontend/src/lib/nav.ts:17](frontend/src/lib/nav.ts:17) — delete the `/results` entry. 1 line.
- Delete [frontend/src/app/results/page.tsx](frontend/src/app/results/page.tsx). 314 LOC removed.
- `/results` → `/` redirect. ~15 LOC.
- [frontend/src/app/wiki/features/results/page.tsx](frontend/src/app/wiki/features/results/page.tsx) — rewrite to document the per-project pattern. ~100 LOC rewrite.

**Shared primitives consumed:** `<ExperimentResultCard>`, `<MethodChip>`, `<FreshnessTag>`, `probeTaskResults` / `getHeroImageForTask` / `getResultsPreview` from [frontend/src/lib/experiments/findTaskResultsBase.ts](frontend/src/lib/experiments/findTaskResultsBase.ts). No new primitives required.

**Implementation effort estimate:** **M.** Net negative LOC but new route + new tab pattern in the popup. Adds ~395 LOC across two new surfaces, removes ~314. The new internal tab structure inside `<ProjectDetailPopup>` is non-trivial — the popup today is one tall scroll region, no internal tabs.

**Risks / open questions:**

- **`<ProjectDetailPopup>` is already complex.** It has an in-place edit mode, archive/unarchive flow, share popup, hosted-tasks section, plus the In Progress / Overdue / Upcoming task lists. Adding a tab structure means restructuring its top-level layout — non-trivial.
- **The cross-project glance gap is real.** If users open `/results` today to scan "what have I shipped across everything," this proposal removes that scan. Lab Activity (30d, cross-user) is the closest replacement and has its own thesis.
- **Deep-link route fragmentation.** Adding `/projects/[owner]/[id]/results` creates the first per-project route in the app. The pattern is fine but it's a new shape — every other route is global. If we open this door, the next ask is "/projects/[owner]/[id]/gantt" for a single-project Gantt. Worth a deliberate "yes we want per-project routes" decision before shipping, not a side effect of the results redesign.
- **Per-project mental model isn't universally how users think.** Some users think project-shaped (yes, show me Aging Study's results); others think time-shaped ("show me everything from last week") or method-shaped ("show me all PCR runs"). This proposal optimizes hard for project-shaped and de-prioritizes the others.

---

## Proposal C — All-types Outcomes Archive

**One-sentence pitch:** Keep the `/results` route, but rebuild it as an outcomes-first archive that handles all three task types with appropriately differentiated treatments — experiments get the hero-thumbnail gallery card (using the just-landed shared primitives), purchases get a receipt-style card with vendor + cost + arrival, list tasks get a compact checkbox row — unified under a single sortable backward-chronological scroll with project + type + time filters.

**Core user question answered:** *"What have I shipped, and what's missing a write-up?"*

**What it shows** (the four sections, top to bottom):

1. **Filter strip** at the top: type chips (Experiments / Purchases / Lists), project chips (today's strip but composite-keyed), and a "Last N" date filter (7d / 30d / 90d / All time). All defaults to "all visible." Sticky during scroll.
2. **Awaiting writeup** — completed experiments with no `results.md` content and no `Images/` content (the same forcing-function section in the Lab Experiments + Workbench redesigns). Scoped to the current user, all-time. Renders as `<ExperimentResultCard>` with `freshnessKind="awaiting"`. Hidden when empty (replaced by a single "✓ All completed experiments have a write-up" line).
3. **Recent outcomes** — completed work from the last 30 days, all task types, mixed chronologically (most-recently-completed first). Experiments render as `<ExperimentResultCard>` with hero thumbnails; purchases render as a compact receipt-card showing vendor + cost + arrival date + purchase-item-count; list tasks render as a slim checkmark row showing project + completion date.
4. **Earlier** — same content as Recent outcomes but older than 30 days. Collapsed-by-default accordion with infinite scroll on expand. Project-grouped sub-toggle for users who want today's `/results` layout.

**What it deliberately hides:**

- The current "Notes" indicator that conflates `results.md` and `notes.md`. Replaced by the "Awaiting writeup" section (the actionable case) and the hero-thumbnail-or-fallback treatment on cards (the visible case — a card with a thumbnail or text preview obviously has a results.md or Images, no badge needed).
- The "files count" badge. Per the Lab Experiments redesign, the card itself shows the hero — if a card has files, the card visibly reflects it.
- The blanket "deviation_log without is_complete" inclusion. Such tasks move to a Workbench "Running" deviation chip; `/results` only shows actually-completed work.

**ASCII wireframe of the main view:**

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Results                                                                  │
│  Your outcomes archive · 42 completed                                     │
│                                                                           │
│  Type: [ Experiments ] [ Purchases ] [ Lists ]                            │
│  Project: [ Aging study ] [ Cardio cells ] [ Pilot data ]                 │
│  Window: [ 7d ] [ 30d ] [ 90d ] [ All time ]                              │
│                                                                           │
│  ── AWAITING WRITEUP ────────────────────────────────  (2 experiments)    │
│                                                                           │
│  ┌─────────────────────┐  ┌─────────────────────┐                         │
│  │ ⚠ no write-up       │  │ ⚠ no write-up       │                         │
│  │  yet                │  │  yet                │                         │
│  ├─────────────────────┤  ├─────────────────────┤                         │
│  │ ● Plasmid prep #4   │  │ ● Toxicity screen   │                         │
│  │ @you · Cardio cells │  │ @you · Aging study  │                         │
│  │ ▣ Mini-prep         │  │ ▣ MTT-assay         │                         │
│  │ Completed 8d ago    │  │ Completed 3d ago    │                         │
│  └─────────────────────┘  └─────────────────────┘                         │
│                                                                           │
│  ── RECENT OUTCOMES ────────────────────────  (last 30 days · 11 items)   │
│                                                                           │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────┐    │
│  │ ░░░░ HERO IMG ░░░░  │  │ ▌▌ results.md ▌▌▌▌  │  │ 🧾 RECEIPT      │    │
│  │ ░░░░░░░░░░░░░░░░░░  │  │ md preview, first   │  │ Vendor: NEB     │    │
│  │ ░░░░░░░░░░░░░░░░░░  │  │ ~80 chars of        │  │ $284.50         │    │
│  ├─────────────────────┤  ├─────────────────────┤  ├─────────────────┤    │
│  │ ● Cell viability r1 │  │ ● PCR optim run 2   │  │ NEB Q5 polymer. │    │
│  │ @you · Cardio cells │  │ @you · Aging study  │  │ @you · Cardio   │    │
│  │ ▣ MTT-assay         │  │ ▣ PCR-GFP-v2        │  │ Arrived 4d ago  │    │
│  │ Result + 2d         │  │ Result + 5d         │  │                 │    │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────┘    │
│                                                                           │
│  ┌── slim list-task row ──────────────────────────────────────────────┐   │
│  │ ✓ Reading: Smith et al. (2024) Nature   Aging study · Done 6d ago │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  ── EARLIER ─── (29 older outcomes — click to expand) ──                  │
│                                                                           │
│  [Group by project ▼]                                                     │
└───────────────────────────────────────────────────────────────────────────┘
```

Legend: `░` = image area, `▌` = markdown preview, `●` = `experiment_color` dot, `▣` = method chip, `🧾` = receipt icon (replace with whatever icon family the rest of `/purchases` uses), `✓` = list-task done check.

**Key interactions:**

1. **Click any card** → opens `<TaskDetailPopup initialTab="results">` (same launch contract today's `/results` uses, preserved).
2. **Click a method chip** → opens `<TaskDetailPopup>` on the Method tab (the method's own folder navigation could be added later but is out of scope for v1).
3. **Click "Group by project" in Earlier** → switches Earlier from chronological to project-grouped layout (today's `/results` look, but inside the Earlier section only).
4. **Click a filter chip** → soft-toggles. Multiple chips can be active simultaneously (e.g., Experiments + Aging + 30d gives a narrow slice). State persists per-browser via `localStorage` (mirrors the Lab Experiments view-mode pattern at [frontend/src/components/LabExperimentsPanel.tsx:22](frontend/src/components/LabExperimentsPanel.tsx:22)).
5. **Hover an experiment card** → no overlay popup (this is a single-user view; the user can click straight in). Matches Workbench's no-hover-popup convention.

**Differentiation from sibling views:**

The single-user, all-time, all-types unified outcomes archive is the page's residual thesis. Workbench is experiments-only and planning-led. Lab Experiments is cross-user. Lab Activity is 30-day-capped and cross-user. `/purchases` is order-pipeline-shaped. Home's project popup is per-project. `/search` is intent-driven. The Outcomes Archive is the only single-user, all-time, all-types, browse-driven view. The "Awaiting writeup" section is the same forcing-function the other redesigns surface — kept here too because a user might land on `/results` from the wiki / a bookmark and want the same nag without going to Workbench.

**Shared primitives consumed:**

- `<ExperimentResultCard>` from [frontend/src/components/experiments/ExperimentResultCard.tsx](frontend/src/components/experiments/ExperimentResultCard.tsx) — used for all experiment outcomes in Awaiting writeup, Recent, and Earlier sections.
- `<MethodChip>` from [frontend/src/components/experiments/MethodChip.tsx](frontend/src/components/experiments/MethodChip.tsx).
- `<FreshnessTag>` from [frontend/src/components/experiments/FreshnessTag.tsx](frontend/src/components/experiments/FreshnessTag.tsx) — `awaiting` / `fresh` / `earlier` kinds reused.
- `probeTaskResults`, `getHeroImageForTask`, `getResultsPreview`, `hasResultContent` from [frontend/src/lib/experiments/findTaskResultsBase.ts](frontend/src/lib/experiments/findTaskResultsBase.ts).

**New primitives needed:**

- `<PurchaseReceiptCard>` — a sibling to `<ExperimentResultCard>` with a receipt-style treatment (vendor, cost, arrival date, purchase-item count). ~120 LOC. Lives at `frontend/src/components/results/PurchaseReceiptCard.tsx`.
- `<ListTaskRow>` — a slim checkbox row for completed list tasks. ~50 LOC. Lives at `frontend/src/components/results/ListTaskRow.tsx`. (Optional — could collapse list-task completion into a single "+ N list tasks completed in this window" summary line if the receipts-card and outcome-card are visually heavy enough.)

**Implementation effort estimate:** **M/L.** Adds ~600-800 LOC: the page rewrite (~250 LOC), the two new card primitives (~170 LOC), the filter strip (~120 LOC), the section-bucketing logic (~80 LOC). The probe pass for every visible card is the same as today's `/results` does, just with `probeTaskResults` swapped in for the ad-hoc walker. Heavier than Proposal A (which is mostly deletions) and Proposal B (which is mostly tabs); justified only if the all-types unification is genuinely valued.

**Risks / open questions:**

- **The all-types unification is a bet.** If users mostly want experiments-only browsing (which Workbench will provide better) or purchases-only browsing (which a `/purchases` Earlier section provides better), the unification's value disappears and the page is over-built for a thin use case.
- **Three card treatments on one page is visual noise.** Hero thumbnails next to receipt cards next to checkbox rows reads inconsistent. The design pressure is to either (a) normalize to a single shared visual treatment (which loses the type-appropriate signal), or (b) accept the visual diversity (which is what the wireframe does).
- **Performance with many cards + filter recomputation.** A heavy lab with hundreds of completed tasks would trigger hundreds of probes on first paint. Mitigation: lazy-load by intersection-observer past the first ~30 cards, cap Earlier to 100 rendered until "show more" expands. Same pattern Lab Experiments uses today.
- **List-task display is a stretch.** No one is going to celebrate a backward-chronology archive of completed todos. The honest assessment is that list tasks are probably better either omitted from this page entirely or shown only as a tiny per-day rollup ("3 list tasks completed Tuesday"). The wireframe shows them included; the implementation could legitimately strip them.

---

## Recommendation

**Ship Proposal A — kill `/results`, fold its jobs into Workbench's Earlier + a new `/purchases` Earlier + a "Recently completed" line on `<ProjectDetailPopup>`.**

Three factors swung the choice.

First, **Grant's framing answers itself.** "What does it really show that isn't on the other pages?" is a question with the answer "very little, after the Workbench redesign lands." The single jobs `/results` does uniquely today — completed purchases, list-task archives, cross-type unification — are not jobs that justify a top-level nav entry. Each has a smaller, better-positioned home: purchases at the bottom of `/purchases`, list-task archives in the project popup, cross-type unification mostly not a real workflow. The "lackluster and confusing" diagnosis isn't about visual polish; it's about thesis. Adding polish (Proposal C) doesn't fix a missing thesis.

Second, **the kill option doesn't actually lose actionable signal.** The single most useful piece of `/results` today is the "No results yet" gray pill — the "which experiments did I finish without writing up?" forcing function. That signal is **strictly upgraded** in the Workbench redesign, where "Awaiting writeup" is a top-level section with a `[Write up]` button per card, not a quiet pill at card-bottom. The thumbnail-led experiment archive is also strictly upgraded — `<ExperimentResultCard>` carries hero images, method chips, and freshness; today's `/results` cards carry none of those. The user trades a page they tolerate for two sections that materially do more.

Third, **Proposal B (per-project) leaves the cross-project glance gap, and Proposal C (rebuild) is over-built for what's left.** Proposal B is appealing in a "completed work belongs to its project" way, but `<ProjectDetailPopup>` is already crowded, and the cross-project glance is a real workflow the proposal can't recover without a separate top-level view. Proposal C answers the differentiation challenge with new card primitives and three card treatments on one page — that's a lot of LOC to defend a thesis (all-types unified browsing) we have no strong evidence anyone uses. The kill option is the leanest honest answer.

**The structural "per-project" option (Proposal B) is rejected because of a single biggest gap: cross-project browsing of completed work disappears with no replacement.** A user who lands on `/results` today to scan "what have I just finished across everything" has no single-page answer after Proposal B ships. `<ProjectDetailPopup>` Results tab requires N clicks for N projects; Lab Activity is 30-day-capped and cross-user; `/search` is intent-driven. The gap is real for users who think time-shaped or type-shaped rather than project-shaped, and there's no evidence about which mental model dominates.

**The Outcomes Archive (Proposal C) is rejected because of a single biggest gap: the all-types unification it preserves is a thesis without evidence.** Three card treatments on one page is a real visual cost; the only justification is "users want to scan everything they've shipped regardless of type," and that's plausible but unverified. If it turns out users do want this, the kill option is reversible — we can resurrect `/results` later as the Outcomes Archive once the Workbench + `/purchases` Earlier sections are running and we can see what users miss. Kill first; rebuild only if the gap manifests.

**Specific additions to the Workbench implementation chip's scope** (for HR to coordinate):

- Workbench's "Earlier" section, as specified in the Workbench proposal, is a collapsed accordion for completed-with-results experiments past the 30-day Recent window. **The kill option needs Earlier upgraded to:** (a) expandable scroll region with infinite scroll (today's collapsed accordion is too restrictive once it's the primary archive surface); (b) optional project-grouping toggle so users who currently rely on `/results`' project-by-project layout don't lose the affordance; (c) no time cap (today's proposal implies the collapse hides older items — the kill needs them all reachable). Estimated +120 LOC on top of the Workbench chip's current scope.
- Workbench's stage-bucketing function ([EXPERIMENTS_STANDALONE_PROPOSAL.md:227](EXPERIMENTS_STANDALONE_PROPOSAL.md:227)) is already going to use `hasResultContent` / `probeTaskResults` per the spec — no additional helpers needed for the Earlier upgrade.

**Independent chips that need to land alongside (separate from Workbench):**

- A new `/purchases` Earlier accordion (`frontend/src/app/purchases/page.tsx`, ~80 LOC). Independent — can ship before, during, or after Workbench.
- A new "Recently completed" section in `<ProjectDetailPopup>` (`frontend/src/components/ProjectDetailPopup.tsx`, ~70 LOC). Independent.
- The `/results` route deletion + redirect + nav removal + wiki rewrite. Should land **last** in the train, after Workbench's Earlier upgrade is on main, to avoid the gap window.

**Shared primitives the recommendation consumes:** None new beyond what's already on main and what Workbench will use. `<ExperimentResultCard>`, `<MethodChip>`, `<FreshnessTag>`, `probeTaskResults`, `getHeroImageForTask`, `getResultsPreview`, `hasResultContent` — all already exist and are already in Workbench's planned scope. Visual consistency across the four post-landing surfaces (Lab Experiments gallery, Workbench Earlier, `/purchases` Earlier, project popup Recently completed) holds because each consumes the same card primitive or the same row pattern.

## Migration / rollout notes

This is a coordinated deletion across four files (deletion + three additive enhancements). Rollback is reverting the merge.

**Phasing (the order matters):**

1. **First land** `<ProjectDetailPopup>` "Recently completed" section and `/purchases` "Earlier" accordion. Both are additive, no user-facing removal. Independent chips, can fire in parallel.
2. **Then land** Workbench's "Earlier" section upgrade (the scope-fold-in to the Workbench implementation chip). Additive to Workbench.
3. **Last land** the `/results` deletion: delete `frontend/src/app/results/page.tsx`, remove the nav entry at [frontend/src/lib/nav.ts:17](frontend/src/lib/nav.ts:17), add the `/results` → `/experiments` redirect, rewrite the wiki page. This makes the kill visible to users only after the absorbing surfaces are in place.

**Users with `/results` bookmarked:** The redirect handles the URL; a one-time amber toast on first hit (mirroring the pattern `frontend/src/components/FloatingLeaveDemoButton.tsx` uses for first-time demo signals — same UX family) says: *"Results moved — completed experiments now live in Workbench's archive. Completed purchases live at the bottom of Purchases."* Toast dismissed after first click.

**Users who hid `/results` via Settings → Tabs:** Their hidden-tabs preference becomes stale (refers to a deleted href). Migration: silently strip the deleted href on next settings read. Mention in commit message for audit.

**Wiki ripple:**

- [frontend/src/app/wiki/features/results/page.tsx](frontend/src/app/wiki/features/results/page.tsx) — rewrite to a thin "Where results went" reference page that points users to (a) Workbench for completed experiments, (b) `/purchases` for completed purchases, (c) any project popup for per-project completed work. ~80 LOC rewrite, mostly redirect copy. Per the [Wiki voice memory](file://memory) — concept-first, screenshot-heavy — the rewrite should open with a screenshot of the new Workbench Earlier section + an annotated "here's what moved" callout.
- `public/wiki/screenshots/results-list.png` and `public/wiki/screenshots/results-tab.png` — delete (orphaned by the wiki rewrite).
- [frontend/src/app/wiki/features/settings/page.tsx:45](frontend/src/app/wiki/features/settings/page.tsx:45) and `:181` — strip "Results" from the tab-references list. Small textual edit.
- [frontend/src/app/wiki/features/markdown-editor/page.tsx:40](frontend/src/app/wiki/features/markdown-editor/page.tsx:40) — update link to point to Workbench instead.
- [frontend/src/app/wiki/features/experiments/page.tsx](frontend/src/app/wiki/features/experiments/page.tsx) — no change. The "Lab Notes vs Results" framing inside the popup (separate tabs on `<TaskDetailPopup>` for during-the-run notes and final write-up) is still accurate and unrelated to the page-level kill.
- New screenshot needed: Workbench's upgraded Earlier section (captures land as `public/wiki/screenshots/workbench-earlier.png` via `?wikiCapture=1` fixture mode per the [Screenshot privacy memory](file://memory)). This screenshot work folds into the Workbench wiki rewrite chip, not this kill chip.

**Demo data:** No new demo data needed. The demo lab already has completed experiments + completed purchases per [AGENTS.md:822](AGENTS.md:822). Workbench's Earlier section will render them via the existing fixture set. The `/purchases` Earlier accordion will too.

**Telemetry / observability:** None to remove — the page doesn't emit analytics today. If we later add an "is anyone actually hitting `/results` after the redirect" check, that's a separate chip; the kill doesn't depend on it.

## What this proposal does NOT decide

- The exact UX of the Workbench "Earlier" upgrade — whether project-grouping is on by default or off by default, whether the "show more" expander chunks at 30 or 100, whether the date-range filter from today's `/results` migrates over. Those are Workbench chip implementation calls.
- Whether `/purchases` "Earlier" should also support vendor-grouping or method-grouping toggles, or just a flat chronological list. Recommend flat for v1; revisit if requested.
- Whether the `<ProjectDetailPopup>` "Recently completed" section should be capped at 30d, 60d, or all-time. Recommend 30d to keep the popup short.
- Whether the redirect should be middleware-level (server-side) or page-level (client-side `redirect()`). Server-side is cleaner for SEO but the app is offline-first; client-side is fine.
- Whether to delete `public/wiki/screenshots/results-list.png` and `results-tab.png` in the same chip or as a follow-up. Recommend same chip.
- Whether the migration toast should fire on every visit until dismissed, or just the first visit. Recommend first-visit-only.
- Whether list-task completion (e.g. completed todos) deserves any surfacing at all in the post-kill world. Recommend "only in the project popup's Recently completed line" — no top-level archive.

## Open questions for Grant

1. **Cross-type unification.** Do you actually open `/results` today to scan "everything I've shipped across experiments + purchases + lists in one view"? Or do you mostly use it for one type at a time (usually experiments)? If the cross-type view is a real workflow, Proposal C (Outcomes Archive) is the better landing. If not, Proposal A (kill) wins cleanly. **This is the single biggest decision-fork-y question** — it inverts the recommendation if your answer is "yes, I scan all types unified."

2. **Does the lab look back at old results frequently?** If "yes, often, for thesis chapters and grant prep," then an all-time archive is load-bearing and the "Earlier" expansions need real polish. If "rarely — write-once, file-and-forget," then Workbench's 30-day "Recent" might be enough and "Earlier" can stay as a small collapsed section.

3. **Per-project muscle memory.** Today's `/results` is grouped by project. Does that grouping match how you think about completed work? If yes, the Workbench Earlier "group-by-project" toggle should default ON. If you think time-shaped, default OFF.

4. **List-task archives.** Do you ever look back at completed list tasks (todos, reading items, milestones)? Worth a dedicated archive view, or trivia? The recommendation assumes trivia and drops them from any top-level view, surfacing only in project popups.

5. **The migration toast pattern.** The recommendation includes a one-time amber toast on first `/results` hit after the kill ("Results moved — ..."). Is that a UX you want to land, or do you prefer a silent redirect with the wiki rewrite as the only signpost?
