# Project Surface UI proposal (Phase 0)

**Author:** project surface UI manager (parallel session, spawned 2026-05-20)
**Brief:** `PROJECT_SURFACE_UI_MANAGER_ROLE_BRIEF.md` at repo root
**Reports to:** master (Grant relays between sessions)
**Status:** Phase 0 complete. All 11 design locks ratified by Grant via AskUserQuestion 2026-05-20. Awaiting master green-light to proceed to P1.

---

## 1. Problem statement

Today's `ProjectDetailPopup` (`frontend/src/components/ProjectDetailPopup.tsx`, triggered from `frontend/src/app/page.tsx:423`) is a low-value modal whose task-list portion duplicates seven other task surfaces at lower fidelity:

1. Home project cards (completion %, in-progress, overdue, 5-task preview)
2. Workbench (`/workbench`) — filterable experiments/lists by project
3. Gantt (`/gantt`) — full timeline with dependencies + goals
4. Search (`/search`) — queryable browser with bulk export
5. Daily Tasks sidebar — today + overdue grouped by project
6. Notifications — shares + shift alerts
7. The popup itself

The popup's only unique value is project-level CRUD (rename, recolor, retag, share, archive, delete). That's low-frequency work that doesn't justify being the entire user-facing identity of a project.

**Goal:** turn projects into first-class research objects with their own page-level identity. A place to capture hypothesis prose, aggregate results, inventory methods, and surface activity scoped to the project. Industry / startup framing throughout (copy says "your work" not "your lab").

---

## 2. Locked design (Batch 1, 2026-05-20)

| # | Decision | Locked value | Rationale |
|---|---|---|---|
| **L1** | Surface architecture | **Hybrid: slim popup + route.** Click card → slim popup (stats + CRUD + "Open full view →" link). Route at `/workbench/projects/[id]` hosts identity surfaces. | Pure popup can't breathe for prose-heavy content and loses deep-link / bookmark / share-via-URL. Pure route over-corrects on the home-page click-into-popup muscle memory. Hybrid splits the jobs: popup = inspector, route = workspace. |
| **L2** | IA of the route | **Single-scroll with sticky section anchors.** Top bar sticks with "Overview │ Results │ Methods │ Activity" jump links. Land on hypothesis prose by default; scroll for the rest; jump-click when targeting a specific section. | "Overview-first, then drill down" workflow. Terse note style (see `project_note_style_lab_recipe.md`) makes scroll-fatigue unlikely. Tabs would fragment the in-project flow; side-nav is overkill chrome for 4-6 sections. |
| **L3** | Home card click target + popup fate | **Slim popup with prominent "Open full view →" link.** Strip the popup of its task list (the 7-redundancy problem). Keep: stats panel, CRUD (edit/share/archive/delete), full-width "Open full view →" button at bottom + inline link in header. | Combined per master's refinement: Q1=hybrid makes the click-target and popup-fate questions deterministically linked. |
| **L4** | Route discoverability beyond the popup | **v1 = popup link + sidebar nav entry (long-term play).** AppShell sidebar gets a "Projects" item with a sub-list of active projects (Linear-style). Sidebar click → route, bypassing the popup. | Promotes projects to first-class nav citizens — matches the brief's "first-class research objects" framing. Cost: AppShell coordination with onboarding v3 manager (relay through master before chip fires). Workbench filter chips deferred to a polish pass after route adoption is proven. |

### Locked — Batch 2 (storage + editor + activity-feed source)

| # | Decision | Locked value | Rationale |
|---|---|---|---|
| **L5** | Markdown editor pattern | **LiveMarkdownEditor** (full toolbar / image-paste-resize / undo / file viewer / Hybrid+Preview toggle). Page renders editor inline; edits autosave. Note: P2 originally shipped with bare `HybridMarkdownEditor` per the literal proposal text; **P2-follow-up** swapped to `LiveMarkdownEditor` after sub-bot investigation confirmed the codebase pattern + image upload wiring. | Same affordances used by tasks / experiments / notes today via LiveMarkdownEditor, zero cognitive switching cost. The original L5 wording said "HybridMarkdownEditor" but its rationale (file viewer + image strip) actually described LiveMarkdownEditor; the swap was a brief-text correction, not a re-litigated lock. |
| **L6** | Storage shape for overview prose **+ attachments** | **Sidecar markdown file** at `users/<owner>/projects/<id>-overview.md` + **sibling attachments directory** at `users/<owner>/projects/<id>-attachments/{Images,Files}` (added P2-follow-up). New API: `projectsApi.getOverview(owner, id)` + `projectsApi.setOverview(owner, id, body)` + path helpers `projectAttachmentsBase` / `projectImagesBase` / `projectFilesBase` exported from `lib/projects/attachment-paths.ts`. Existing `users/<u>/projects/<id>.json` untouched. Missing files = empty overview / no attachments. | Raw markdown on disk: portable, greppable, external-editable, no JSON-escape pain on long prose. Attachments sidecar pattern keeps all project-N stuff grouped under `projects/N*` so `rm projects/N*` cleans the whole project. Owner-routed reads/writes follow the existing receiver-edit-permission pattern from `ProjectDetailPopup`. No migration needed (new files / dirs start empty). |
| **L7** | Activity feed source | **New project-scoped event-log sidecar** at `users/<owner>/projects/<id>-activity.json` with `{ version: 1, events: [{id, type, ts, payload}, ...] }`. Mirrors `_shifted-alerts.json` exactly: read-modify-write, append-on-event, missing-file = empty, lazy-pruned at 90-day retention. New module `lib/project-activity/event-log.ts` exporting `recordProjectActivity(owner, projectId, event)`. ~5-10 mutation call sites wire it in (task complete, image add, method change, prose edit, share, archive). | Full-fidelity feed; fits existing sidecar pattern (no new file-format primitive); no migration (existing projects start empty). |

### Locked — Batch 3 (aggregators)

| # | Decision | Locked value | Rationale |
|---|---|---|---|
| **L8** | Gallery ordering | **Group by experiment, chronological within each, sections collapsible.** Source: `FileMetadata` where `project_id === id` and `attachment_type === "results"`. Click-to-open opens the file in the existing viewer. | Matches the mental model that results belong to experiments, not floating in time. Sections collapsible so projects with many experiments stay scannable. |
| **L9** | Methods inventory linking | **Inline name + short description + "used in N experiments" badge + link out.** Source: union of `Task.method_ids` across tasks where `project_id === id`, deduplicated. Click navigates to `/methods?id=N` (existing MethodTabs viewer). | Usage count is the project-scoped insight that justifies the methods section's existence. Inline expansion (showing method body) deferred — users who want the full method navigate out. |
| **L10** | Scoped Gantt | **Link out to `/gantt?project=N` (prefilter).** Project page surfaces a "View timeline →" link, no embedded `<GanttView />`. | Gantt is heavy (calendar render, dependencies, drag-handles); embedding duplicates it as a second surface that will drift over time. Link-out keeps the project page fast and preserves Gantt's UI conventions. |
| **L11** | Goal-tracker P8 | **Conditional surface.** Project page shows a "Goals" section when the user's onboarding `feature_picks` include goals; hidden otherwise. P8 fires after P5 lands. `HighLevelGoal.project_id` is already present — no data model change. | Consistent with the rest of the app's onboarding-feature-pick gating model. No new data needed; just a UI section that queries `goalsApi.list().filter(g => g.project_id === id)`. |

---

## 3. Phase plan (firm; per-phase scope derived from L1-L11 locks)

| Phase | Effort | Scope | Merge timing |
|---|---|---|---|
| **P0** | M | This proposal doc. No implementation. | Doc commit only, lands on working branch. |
| **P1** | M | Route scaffold at `app/workbench/projects/[id]/page.tsx`. URL routing, breadcrumb back to home, sticky top bar with project name + color stripe + "Overview │ Results │ Methods │ Activity" jump anchors per L2 + share/archive/CRUD overflow menu. Empty section placeholders for P2-P5 / P8. Handles missing-project / archived / not-shared / view-only-receiver cases. Wiki-capture gate-precedence story (`?wikiCapture=1` must reach the new route — coordinate with `lib/file-system/wiki-capture-fixture.ts`). | Merge on report (UI-only, per memory `feedback_merge_timing_ui_vs_backend.md`). |
| **P2** | M | **Overview body.** New `projectsApi.getOverview(owner, id)` + `setOverview(owner, id, body)` writing to `users/<owner>/projects/<id>-overview.md` per L6. Owner-routed for receiver-with-edit per existing pattern in `ProjectDetailPopup`. Page wraps `HybridMarkdownEditor` per L5 with autosave. Records `prose_edited` event to `<id>-activity.json` per L7. | **Hold merge for master verify** — data-shape (new sidecar path + write call sites). |
| **P3** | M | **Aggregated results gallery.** Query `FileMetadata` where `project_id === id && attachment_type === "results"`, group by `experiment_id` (showing `experiment_name`), chronological within each (newest first) per L8. Collapsible sections. Click opens existing file viewer. | Merge on report (read-only aggregation). |
| **P4** | S | **Methods inventory.** Aggregate `Task.method_ids` across tasks where `project_id === id`, dedupe by method id, count usages per method. Render: method name + short desc + "used in N experiments" badge + link to `/methods?id=N` per L9. | Merge on report. |
| **P5** | M | **Activity feed scoped to project.** New module `lib/project-activity/event-log.ts` exporting `recordProjectActivity(owner, projectId, event)` + `readProjectActivity(owner, projectId)`. Sidecar at `users/<owner>/projects/<id>-activity.json` mirrors `_shifted-alerts.json` shape (read-modify-write, missing-file = empty, 90-day lazy pruning) per L7. Wire call sites: task complete, image add, method change (add/remove), prose edit (from P2), share, archive. Read-side renders chronological feed inside the Activity section. | **Hold merge for master verify** — data-shape (new sidecar + write call sites sprinkled across mutations). |
| **P6** | S | **Scoped Gantt link-out.** Add "View timeline →" link in the project page header / nav. Click → `/gantt?project=<id>`. May require minor change in `/gantt/page.tsx` to honor `?project=` query param if not already supported. | Merge on report. |
| **P7** | S | **Slim the popup.** Strip `ProjectDetailPopup.tsx` task list (in-progress / overdue / upcoming / recently-completed / hosted-from-others sections delete). Keep: stats panel, CRUD (edit/share/archive/delete), tooltips. Add: full-width "Open full view →" button at bottom + inline link in header per L3. Update `frontend/src/app/page.tsx:423` card-click handler to keep opening the (now-slim) popup. | Merge on report. |
| **P8** | S | **Goals section** (conditional per L11). Read user's onboarding `feature_picks` from v3 sidecar; if goals enabled, render Goals section above Activity. Query `goalsApi.list().filter(g => g.project_id === id)`. Click goal → existing goal editor. If no goals enabled, hide section entirely (not even a CTA). | Merge on report. |
| **P9** | S | **Sidebar nav entry + wiki handoff.** Add "Projects" item to `AppShell.tsx` sidebar with expanded sub-list of active projects (Linear-style); sidebar click → route per L4. **Coordinate with onboarding v3 manager via master before chip fires** — both arcs touch AppShell. Relay paste-verbatim brief to wiki manager for `wiki/getting-started/project-surface` (or wherever wiki manager places it). | AppShell touch holds merge for master verify; wiki content handed to wiki manager. |

**Estimated total:** 2-3 weeks, one manager dispatching chips sequentially.

---

## 4. Surface inventory (post-shipping)

**Slim popup (post-P7):**
- Header: name, color stripe, archived badge, edit/share/close buttons
- Stats panel: total tasks, completed, overdue (count only — no task list)
- CRUD: edit (name/tags/color/weekend), archive/unarchive, delete (owner-only), share (owner-only)
- "Open full view →" affordance: inline link in header + full-width button at bottom

**Route (`/workbench/projects/[id]`):**
- Sticky top bar: project name + color stripe + "Overview │ Results │ Methods │ Activity" jump anchors + share/archive/CRUD overflow menu + "View timeline →" link to `/gantt?project=<id>` (L10)
- **Overview** section: `HybridMarkdownEditor` rendering `<id>-overview.md` (L5 + L6) with autosave
- **Results** section: gallery grouped by experiment, collapsible, chronological within each (L8)
- **Methods** section: dedup'd list with usage badges, links to `/methods?id=N` (L9)
- (Conditional, L11) **Goals** section: visible when onboarding feature_picks include goals
- **Activity** section: chronological feed from `<id>-activity.json` (L7)

**Sidebar (post-P9):**
- New "Projects" item with expanded sub-list of active projects → clicks navigate to route

---

## 5. Off-limits to other sessions

- New route under `frontend/src/app/workbench/projects/[id]/*`
- New components under `frontend/src/components/project-surface/*` (or wherever P1 lands them)
- `frontend/src/components/ProjectDetailPopup.tsx` (P7 owns the slim-down)

## 6. MAY touch with master green-light

- `frontend/src/app/page.tsx` (home card click handler — P7 may refresh wiring)
- `frontend/src/components/AppShell.tsx` (P9 sidebar entry — coordinate with onboarding v3 manager via master relay)
- `frontend/src/lib/file-system/wiki-capture-fixture.ts` (P1 gate-precedence)

## 7. Will NOT touch

- Hybrid editor internals (P2 wraps via HybridMarkdownEditor)
- Methods / experiments / purchases / goals / calendar / search internals (P3-P5 read via public APIs)
- AI Helper feature itself
- Wiki content (P9 hands off to wiki manager)
- Onboarding v2 / v3 wizard surfaces

---

## 8. Cross-arc coordination notes

- **Onboarding v3 manager** (parallel session, spawned 2026-05-20): per master's P0-ratify relay, v3's P1 mount logic likely lives entirely in `lib/onboarding/orchestrator.tsx` (swapping the no-op `OnboardingOrchestrator` body for the v3 wizard surface), NOT `AppShell.tsx`. Collision risk on AppShell is smaller than initially anticipated. P9's sidebar nav entry may be the only AppShell touch in either arc; will still relay through master before that chip fires to confirm.
- **Wiki manager:** P9 hands off wiki page authoring; do not write yourself.
- **Wiki capture fixture:** the new route must load under `?wikiCapture=1` so the wiki manager can screenshot it in P9. Plan the gate-precedence story in P1; don't leave it for wiki manager to discover.

---

## 8b. P2-follow-up notes (overview image support)

P2 shipped Overview with bare `HybridMarkdownEditor`. P2-follow-up landed `LiveMarkdownEditor` + image/file drop wiring. Two implementation details worth pinning so downstream phases don't trip:

- **Inline-splice deviation from codebase convention.** Every other `<LiveMarkdownEditor>` call site in the app (NoteDetailPopup, methods page, TaskDetailPopup, CompoundChildCreator, CreateMethodModal) writes dropped attachments to disk + emits an `imageEvents` / `fileEvents` event, but does NOT splice the markdown ref inline — those surfaces render an `ImageStrip` / `FileStrip` below the editor and users drag from the strip to place refs. Project Surface Overview has no strip, so a silent drop would look broken. P2-follow-up's `OverviewSection` adapted: splice the snippet (`![name](Images/name)` or `[name](Files/name)`) at the end of `draft` and flow through `handleChange` so the attachment + ref reach disk together via the existing autosave debounce. **Future revisit:** if an `ImageStrip` ever lands for Project Surface Overview, this inline splice should be removed (otherwise drops will double-ref — once from the strip's drag, once from the auto-splice). Track via this proposal.
- **`onImageDrop` / `onFileDrop` contract correction.** The original P2-follow-up chip brief assumed the editor returns a snippet for the caller to insert. It does not — the callback is `(files: File[]) => void` with no return value. Documenting here so future chip briefs don't repeat the assumption.

---

## 9. Sign-off

Phase 0 complete: all 11 locks (L1-L11) ratified by Grant via AskUserQuestion 2026-05-20 + master via relay same day. Signed: **project surface UI manager**, 2026-05-20.
