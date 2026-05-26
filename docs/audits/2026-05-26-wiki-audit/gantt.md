# Wiki audit: Gantt + timeline

Auditor: wiki audit: gantt
Date: 2026-05-26
Branch anchor: 14ea9892 (Overnight orchestrator handoff doc)

## Scope

- `/gantt` route surface: `frontend/src/app/gantt/page.tsx`, `frontend/src/components/GanttChart.tsx`, `frontend/src/components/Toolbar.tsx`
- Recent work covered: Gantt redesign + R1/R2 fix-passes; toolbar declutter (animation picker retired, multi-select project dropdown); filter mode flag (`all` vs `explicit`, Select all / Unselect all); chained deps + drop-target wiring; `?project=` link-out from project surface.
- Wiki page audited: `frontend/src/app/wiki/features/gantt/page.tsx` (310 lines).
- Out of scope (per brief): Lab Overview PI Gantt overlay (MetricsWidget), onboarding cursor demos on Gantt.

## Summary

The Gantt wiki page is the most thorough of the feature pages: it walks the toolbar, the bar vocabulary, the cascade modal, and the goal sidebar. However, it carries two fabricated affordances (a non-existent dependent-task gradient, and an image-drop onto bars), misframes the lab-head section as a dropdown auto-aggregation, and is missing four real affordances: double-click empty space to create a task, the `?createGoal=1` deep-link, the search-projects input inside the dropdown, and the project-surface "View timeline" link-out via `?project=<owner:id>` that triggered the multi-select redesign.

Counts: 3 P0, 5 P1, 4 P2.

## P0 (fabricated affordances, will mislead users)

### P0-1. "Drop an image on a task" section is fictional

Wiki section at lines 245-254 claims a user can "Drag any image file from Finder or the desktop and drop it on a task bar" and that "The image attaches to that task as a new Images-folder entry and a markdown reference is appended to the task's Lab Notes body. ... The drop zone highlights blue while you are hovering."

Reality (`frontend/src/components/GanttChart.tsx` lines 980-1120): the bar's `onDragStart` / `onDragOver` / `onDrop` only carry an internal task-id via `e.dataTransfer.setData("text/plain", task.id.toString())`. There is no `FileReader`, no `dataTransfer.files` handling, no `attachImageToTask` call anywhere in GanttChart.tsx. Image attach is wired into `TaskDetailPopup` and `NoteDetailPopup` only.

Action: delete the "Drop an image on a task" h2 section, including the intro line that name-checks it ("and drop an image straight onto a task" in the page intro).

### P0-2. "Gradient bars for dependent tasks" bullet is fabricated

Wiki "Anatomy" list, lines 51-57: "When a bar is downstream of another (FS, SS, or SF), the fill renders as a subtle gradient instead of a flat color. The gradient direction mirrors the dependency direction, so you can read whether a task waits on something earlier or constrains something later."

Reality: GanttChart bars carry a flat `backgroundColor: taskColor`. The only gradients in the file are (a) edge-fade overlays for tasks extending beyond the visible window (lines 1830-1844), (b) the purchase-task diagonal stripe (1815), (c) PTO/weekend hashes (1611-1618, 1854). No dependency-direction gradient exists.

Action: delete the bullet. The real downstream-task indicator is the colored top stripe (already documented one bullet up) plus the chain dots at bottom-right of bars (`frontend/src/components/GanttChart.tsx` lines 1896-1911) — the dots are not yet documented and would replace this bullet.

### P0-3. Lab-head section overstates the aggregation

Wiki lines 221-238 frame the lab-head experience as a special Gantt with "the project dropdown on the left of the toolbar now spans every member's projects across the lab" and "rescheduling a bar cascades downstream tasks regardless of who owns them."

Reality: `/gantt/page.tsx` calls `fetchAllProjectsIncludingShared` and `fetchAllTasksIncludingShared` for every user. There is no lab-head-specific branch in the Gantt route or the Toolbar. Projects show in the dropdown only if they are individually shared with the lab head (or share their host project with them). The `isLabMode` prop on `GanttChart` exists but is wired only from the Lab Overview MetricsWidget tile (the PI rollup), not from `/gantt`.

Action: rewrite the section to clarify that lab heads see what is shared with them (no automatic cross-member aggregation on `/gantt`), and point readers at the Lab Overview metrics tile for the actual cross-lab overlay. The phrase "across the lab" should leave, the screenshot caption should be redrafted (the demo screenshot is presumably showing a lab-head fixture where the lab head has been shared every member's projects, which is a fixture quirk, not a product behavior).

## P1 (real affordances missing)

### P1-1. Double-click empty space to create a task

`frontend/src/components/GanttChart.tsx` lines 1242-1246 and the legend text on line 1956 ("Double-click to create a new task.") plus the empty-week hint on line 1553 ("Double-click to add a task"). Empty grid cells also accept double-click.

Action: add a one-liner under "The toolbar" or before "Open a task" — "Double-click any empty grid cell (or empty week column) to spawn the new-task modal with that day's date pre-filled." This is a real power-user shortcut.

### P1-2. Search input inside the projects dropdown is undocumented

Wiki "Filter with the multi-select project dropdown" section (lines 194-219) describes Select all / Unselect all / persistent-open behavior but does not mention the search box. `Toolbar.tsx` lines 320-329 renders a `Search projects...` input above the list, which case-insensitively substring-filters by project name.

Action: add a bullet: "Type into the **Search projects...** input at the top of the list to narrow long project rosters."

### P1-3. `?project=<owner:id>` deep-link from the project surface

The recent project-surface link-out is the whole reason the dropdown got a multi-select redesign. `frontend/src/components/project-surface/ProjectRoute.tsx` line 225 emits `/gantt?project=${encodeURIComponent(owner:id)}`, and `Toolbar.tsx` lines 89-117 consume it (sets the project filter to that single composite key, strips the param so reload does not re-trigger). This is the canonical "View timeline" path.

Action: add a short section "Scope from another page" describing the per-project View timeline link and what it does on arrival. Cross-link it back from the future Projects wiki page.

### P1-4. `?createGoal=1` deep-link is undocumented

Same `useEffect` block in `Toolbar.tsx`. Triggers `onCreateGoal()` on mount.

Action: mention it once in the Goals section ("a link with `?createGoal=1` lands you on the Gantt with the new-goal modal already open").

### P1-5. Chain-membership dots at bottom-right of bars

`frontend/src/components/GanttChart.tsx` lines 1896-1911. Each bar in a chain shows N dots, with one filled in the position-in-chain color so you can read "this is the 2nd of 4 in the chain" at a glance.

Action: add as a sibling bullet to the chain top-stripe bullet (currently lines 44-49). Suggested wording: "Chain dots at the bottom-right of each bar. A row of small dots, one per task in the chain, with the current task's dot fully colored — at a glance you can tell which position in the chain you are looking at."

## P2 (small drift, polish)

### P2-1. "All" zoom claim is precise but easy to misread

Lines 122-129: the wiki correctly says All renders an 8-week window from the current Monday. That is good. But the placement under "Zoom segmented control" implies a continuous zoom-out. Worth a tiny callout: "The **All** label is historical — it shows the same 8-week window as 2M would, anchored to today's week."

### P2-2. Subtask counter "N/M" badge

`frontend/src/components/GanttChart.tsx` lines 1913-1918 renders a small "X/Y" subtask completion text at the bottom-left of bars with incomplete subtasks. Wiki currently mentions only the "partial fill on the left" (line 70). Add a sister bullet for the numeric counter.

### P2-3. The Shared toggle is shown twice in the toolbar list

Lines 119-121 (under "The toolbar") cover Shared. The 2026-05 redesign moved it into a chip group next to tags (`Toolbar.tsx` line 432). The wiki bullet is fine but the order (Projects > Tags > Shared) does not match the rendered order in code (Projects > Tags > Shared > spacer > Zoom > +Goal > +Task > week-nav). The reader will not be misled, but the redesign also moved the +Task / +Goal buttons to land BEFORE the week-nav cluster, while the wiki lists them "at the far right of the toolbar" which is still accurate.

Action: reorder bullets to match the visual order: Projects, Tag chips, Shared, Zoom segmented control, +Goal, +Task, Week navigator. Currently Zoom and Week navigator are at the end after +Task / +Goal.

### P2-4. PTO context-menu wording

Wiki line 258-260 says the context menu has a "**Mark as PTO** / **Unmark PTO** option." Actual button label includes the date: `Mark 2026-05-26 as PTO` / `Unmark 2026-05-26 as PTO` (`frontend/src/components/GanttChart.tsx` lines 1989-1992). Minor: keep the wiki's shorter prose, but the screenshot caption when captured should not crop out the date.

## Notes

- Screenshot TODO blocks at lines 12-20 (gantt-overview), 239-243 (gantt-overview-lab-head), and 296-302 (gantt-task-popup) are present and well-formed for the screenshot agent, but the lab-head screenshot fixture should be re-staged once P0-3 is resolved (the current framing implies a feature that does not exist).
- WIKI_NAV entry exists (`frontend/src/lib/wiki/nav.ts` line 17, line 179) — `/gantt` → `/wiki/features/gantt`. APP_ROUTE_TO_WIKI mapping is correct.
- Out-of-audit observation worth flagging to whoever owns lab-overview: `TaskListWidgets.tsx` line 60 emits `/gantt?task=<id>` (to open a specific task) but there is no `task` param consumer in `Toolbar.tsx` or `app/gantt/page.tsx`. The route ignores the param. Either the consumer needs adding or the emitter should be redirected to a different surface.
- The chained-deps + drop-on-task popup is well documented (lines 168-192) and matches the SS/FS/SF buttons in `handleCreateDependency` (lines 1123-1231). No drift.
- The "This change will affect N task(s)" modal is correctly framed as SF-past-date specific — `frontend/src/lib/engine/shift.ts` lines 320-358 confirms `requires_confirmation: true` only on the SF past-date branch.
