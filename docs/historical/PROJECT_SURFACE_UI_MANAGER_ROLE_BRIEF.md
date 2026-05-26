# Project Surface UI manager — role brief

**You are:** the Project Surface UI manager. A parallel Claude Code session spawned by Grant to redesign how a clicked project surfaces itself in ResearchOS. Today's `ProjectDetailPopup` is a low-value modal whose task-list duplicates Workbench / Gantt / Search / Daily sidebar / notifications at lower fidelity. The popup's only unique value today is project-level CRUD (rename, recolor, retag, share, archive, delete) — low-frequency operations that don't justify the click target.

**You report to:** master (Grant relays between sessions).

**Spawned:** 2026-05-20 by master via Grant.

**Your assignment in one sentence:** Turn projects from named buckets into **first-class research objects with identity** — a place to capture hypothesis prose, aggregate results across experiments, inventory methods in use, and surface activity scoped to the project.

---

## What master + Grant already locked

| Lock | Value |
|---|---|
| **Direction** | **Option B — dedicated project route at `/workbench/projects/[id]`** |
| **Tension** | Grant's default preference is popups (matches the rest of the app's click-into-modal pattern). He's open to a route if the route's case is strong. **You are explicitly invited to propose a hybrid** (popup-for-glance + "Open full view" button → route-for-heavy-work). Decide in your Phase 0 proposal which direction wins. |
| **Project-level identity surfaces** | Markdown overview / hypothesis prose, aggregated results & images gallery, methods inventory used across the project, activity feed scoped to project. Possibly scoped Gantt embed + goal-tracker integration. |
| **Surfaces that stay** | Project-level CRUD (rename, recolor, retag, share, archive, delete). Where it lives is your call (route page, popup, or both). |
| **Industry/startup framing** | Maintained throughout. Copy says "your work" not "your lab". |

---

## Today's `ProjectDetailPopup` audit findings (from master's pre-spawn explore)

**File:** `frontend/src/components/ProjectDetailPopup.tsx`
**Triggered from:** `frontend/src/app/page.tsx:423` (home project card click)

**Current interactive elements:**
- Edit button (pencil icon) — opens edit mode for name/tags/color/weekend toggle
- Share button — opens SharePopup
- Delete button — confirmation + delete
- Archive/Unarchive button
- Overdue task names — clickable → `TaskQuickPopup` (preview) or `TaskDetailPopup` (full editor)
- Recently completed task names — open `TaskDetailPopup` on Results tab
- Remove hosted task X button — removes cross-owner tasks from project

**The 7 redundant task-surface inventory:**
1. Home page project cards — completion %, in-progress, overdue, 5-task preview
2. Workbench (`/workbench`) — filterable experiments/lists by project
3. Gantt (`/gantt`) — full timeline with dependencies + goals
4. Search (`/search`) — queryable browser with bulk export
5. Daily Tasks sidebar — today + overdue grouped by project
6. Notifications — shares + shift alerts
7. ProjectDetailPopup itself — task list per project, redundant with all above

**The popup's UNIQUE-but-low-value layer:** project-level CRUD only.

---

## Phase plan (refine in your Phase 0 proposal)

| Phase | Effort | Scope |
|---|---|---|
| **P0** | M | Design brainstorm with Grant via AskUserQuestion → produce `PROJECT_SURFACE_PROPOSAL.md` at repo root. Locks every design call before implementation. Specifically: popup-vs-route-vs-hybrid (Grant's open question); IA of the project page (tabs vs single scroll); markdown editor pattern (HybridMarkdownEditor? lighter?); fate of the existing popup (slim to CRUD-only? deprecate? keep as glance layer?); activity feed source (reuse notifications? new event log?); gallery source + ordering; methods inventory linking pattern. **No implementation in P0; only the spec doc.** |
| **P1** | M | Route scaffold at `app/workbench/projects/[id]/page.tsx` (or wherever Phase 0 locks). URL routing, breadcrumb, project header (name + color + share), basic layout shell. Handles missing-project / archived / not-shared cases. |
| **P2** | M | **Project overview body** — markdown notes / hypothesis prose. Per-project storage shape (extend `Project` type? new sidecar `users/<u>/projects/<id>-overview.md`?). HybridMarkdownEditor integration if locked. |
| **P3** | M | **Aggregated results & images gallery** — pull results/images from every experiment in the project. Ordering, deduplication, click-to-open behavior. |
| **P4** | S | **Methods inventory** — deduplicated list of methods used across experiments in this project. Links to MethodTabs viewer. |
| **P5** | M | **Activity feed scoped to project** — shares, completions, edits. Decide whether to reuse the notifications event log or stand up a project-scoped event source. |
| **P6** | S | **Scoped Gantt embed** (if Phase 0 locks it) — embed `<GanttView projectFilter={id} />` on the project page or link out with prefilter. |
| **P7** | S | **Popup fate** — execute whatever Phase 0 locked: slim popup to CRUD-only / deprecate popup / keep as hybrid-glance layer. |
| **P8** | S | Goal-tracker integration (if Q4 feature enabled on the account) — show project's goals + progress. |
| **P9** | S | Wiki manager handoff — wiki page covering the new project surface. |

**Estimated total:** 2-3 weeks at one manager dispatching chips sequentially.

---

## Standing role + autonomy scope

Carry-forward from onboarding v3 brief unless v2/v3 explicitly diverge.

You have standing permission to:
- Refresh your own AGENTS.md §8 entry with progress
- Dispatch chips via `spawn_task` within your arc
- Cherry-pick / merge chips into your working branch
- Run AskUserQuestion brainstorm sessions with Grant in your Phase 0 (this is EXPECTED — your scope explicitly invites design ideation before implementation)
- Coordinate with bug-fix manager, wiki manager (Phase 9), AI Helper manager (your route may need a Helper-prompt entry post-ship)

You MUST:
- Hold final merges to local main until master confirms (data-shape work especially — P2's overview storage is data-shape)
- Surface cross-arc state assertions with `git log` verification or explicit "not verified" disclaimers
- Sign as `project surface UI manager` in commit-body refs and relay messages
- NOT touch surfaces outside your arc without explicit master green-light: hybrid editor internals (you wrap it; don't redesign), methods/experiments internals (you read aggregated data through public APIs; don't redesign), AI Helper feature itself, wiki content (Phase 9 handoff)
- Coordinate with **Onboarding v3 manager** (also in flight, spawned 2026-05-20) — both touch `AppShell` potentially. Cross-reference their AGENTS.md §8 entry before any AppShell edit and announce intent via master.

You may NOT:
- Push to origin (master batches pushes at milestones)
- Migrate existing users' project data without master + Grant green-light
- Skip Phase 0 (Grant explicitly said "I'm not even fully sure what that means" — your brainstorm IS the proposal's value-add)

---

## Dispatch discipline (carry-forward from v3 brief)

All chip briefs you dispatch MUST include:

1. **Cross-arc state verification** — bot must `git log --oneline main | head -20` and paste output OR explicitly disclaim
2. **Pre-commit prebuild** — when scope touches autogen-adjacent surfaces (AI Helper, demo-lab.zip, types.ts → AI Helper schemas), bot runs `npm run --prefix frontend prebuild` before commit
3. **Post-stash diff confirmation** — after lint stash/unstash, bot runs `git diff --stat HEAD` and flags any unexpected file changes
4. **In-flight surface carve-outs** — explicitly name adjacent in-flight chips by branch name when firing on shared surfaces (AppShell, /app/page.tsx home card click handler, ProjectDetailPopup)
5. **Sign as bot identity** — sub-bots sign as their own branch name, NOT as you or master
6. **No merge / no push by bot** — bots report back; you merge after review; master batches pushes
7. **Stale-branch-root awareness** — see AGENTS.md §6 entry at `45c4bb88`. Cherry-pick source-only, not full `--no-ff` merges.

---

## Reporting cadence

Send a report to master after each Phase lands. Format:

```
Project Surface UI manager → master (via Grant relay)

Phase <N>: <name> — <status>

Branch: <name> @ <SHA>
Files touched: <list>
Verification: <tsc / vitest / eslint / prebuild>
Cross-arc state: <any in-flight overlaps observed + how handled>
Design refinement asked of Grant (if any): <Q + locked answer>
Next phase: <name + estimated effort>
```

**Phase 0 is the brainstorm phase** — your first report back will be heavier than usual, summarizing the AskUserQuestion calls + Grant's locks + the locked design table in `PROJECT_SURFACE_PROPOSAL.md`. Treat Phase 0 like onboarding v3's proposal phase: synthesize first, dispatch later.

---

## Master-side process flags (carry-forward from v3 arc)

Three lessons from prior arcs worth pinning:

1. **Surface brief-flagged design questions to master before chip fires.** Memory `feedback_surface_briefed_design_questions.md`. If your proposal has an explicit gap you can't resolve from the brief, route via AskUserQuestion before the chip fires.
2. **Parallel-session stale-view trap.** Run `git fetch` + `git log --oneline main -5` before claiming any cross-arc state.
3. **Gate-precedence collisions.** Anticipate that `?wikiCapture=1` fixture mode needs to load the new route too (so wiki manager can screenshot it in Phase 9). Plan the gate-precedence story in P1 mount logic; don't leave it for wiki manager to discover.

---

## Acknowledgment

Sign as `project surface UI manager`. Update AGENTS.md §8 with your own bullet in your first commit:

```
- **Project Surface UI manager (parallel session, spawned 2026-05-20)** — owns the redesign of how clicked projects surface. Per master+Grant lock, direction is Option B (dedicated route at `/workbench/projects/[id]`); hybrid (popup-glance + "Open full view" route) is an explicit Phase 0 brainstorm option. <add phase progress as it lands>
```

Off-limits to other sessions (announce in your §8 entry):
- New route under `frontend/src/app/workbench/projects/[id]/*`
- New components under `frontend/src/components/project-surface/*` (or wherever Phase 0 lands them)
- `frontend/src/components/ProjectDetailPopup.tsx` (you decide its fate in Phase 0)

MAY touch with master green-light:
- `frontend/src/app/page.tsx` (home card click handler — Phase 0 may redirect or swap)
- `frontend/src/components/AppShell.tsx` (coordinate with onboarding v3 manager — both could touch)
- Wiki capture fixture (Phase 1 gate-precedence story)

Will NOT touch:
- Hybrid editor internals (P2 wraps it via HybridMarkdownEditor)
- Methods / experiments / purchases / goals / calendar / search internals (P3/P4/P5 read via public APIs)
- AI Helper feature itself
- Wiki content (P9 hands off to wiki manager)
- Onboarding v2 / v3 wizard surfaces (different manager's territory)

Standing permission to refresh this §8 entry with progress.

Signed: **master bot**, 2026-05-20
