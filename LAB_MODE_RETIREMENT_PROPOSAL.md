# Lab Mode Retirement Proposal

**Author:** lab mode retirement proposal author
**Date:** 2026-05-23
**Status:** Pre-implementation. No code yet.

---

## Background

"Lab Mode" is the read-only pseudo-user account that lets any logged-in user click "Lab Mode" on the login picker, log in as the `lab` user, and browse every member's data through a dedicated `/lab` route with eight tabs (Activity, Gantt, Experiments, Purchases, Roadmaps, Methods, Notes, Search). It was the first cross-user surface ResearchOS shipped, predating Lab Head and the Lab Inbox. It has since accumulated three structural problems.

First, it is a separate identity. The user logs out of themselves and into a sentinel account. Anything they want to do back in their own work (favourite a note they just spotted, drop a comment, assign a task) requires logging out of lab and back into their own user. Lab Head's soft-write actions (announcements, task assignment, purchase approval) cannot run from `/lab` at all, because the actor on `/lab` is `"lab"`, not the PI.

Second, the data path duplicates work. `useLabData` plus the `labApi.*` helpers already aggregate cross-user content for `/lab`. The same data is available from inside any per-user page, but only `/lab` exposes it; an experiment view on `/experiments` only shows the logged-in user. That asymmetry forces users into a context switch for what should be a toggle.

Third, the Lab Mode walkthrough is the longest section of the v4 tour (12 steps under `steps/lab-mode/`, plus a full `DemoLabModeViewer` overlay totalling ~650 lines). It exists to teach the user that they are now a different person looking at read-only data. With the new Lab Overview + per-page toggle pattern this whole concept goes away: you are always yourself, and "showing the lab" is a checkbox, not an identity change.

This proposal retires the `lab` pseudo-user, the `/lab` route, and the `LabModeViewer` overlay. Cross-user content reaches users in two places instead: the renamed **Lab Overview** page (the former `/lab-inbox`, now a configurable widget canvas), and per-page **"Show all lab"** toggles on the regular per-user pages. The result is one identity, one mental model, one short walkthrough.

---

## Locked design decisions (Grant 2026-05-23)

1. **Lab pseudo-user account fate: DELETE ENTIRELY.** No more "Lab Mode" button on the login picker. No more `lab` sentinel user. No more `/lab` route. Every lab-wide view is reached from inside the user's own session.
2. **Cross-user content access pattern: PER-PAGE "Show all lab" TOGGLE.** Each relevant page (Experiments, Notes, Search, Calendar, Purchases, Methods) gains a header toggle. When ON, the page renders everyone's content tinted by owner colour. When OFF, the page is personal. Mirrors the existing Workbench `showShared` pattern.
3. **Modular Lab Overview: react-grid-layout drag-and-drop.** Widgets on the Lab Overview can be moved, resized, added, and removed freely. Layout persists per-user on the lab head, with a sensible default for first-run. Estimated 1-2 week effort, anchored on the `react-grid-layout` library.

These three decisions are not re-litigated below; each section threads them through.

---

## 1. Current Lab Mode Surface Audit

### 1a. `/lab` route

`frontend/src/app/lab/page.tsx` (~480 lines). One Next.js client component that:
- Calls `useLabData()` for users / tasks / projects, then partitions by `selectedUsernames` for the floating filter.
- Renders an emerald-gradient header with title "Lab Mode" + "Exit Lab Mode" button (the exit logs the user back into their `mainUser` and routes to `/`).
- Switches between 8 panel components by tab state (Activity, Gantt, Experiments, Purchases, Roadmaps, Methods, Notes, Search).
- Hosts the `LabUserFilterButton` floating control and the `LabUserDetailPanel` side popup.
- Has elaborate guard logic in `handleLogout` to avoid re-bouncing into `/lab` if `mainUser` is corrupted to `"lab"`.

The route is the only consumer of `/lab` as a URL. Wiki pages link to it from `wiki/features/lab-mode/*` and the welcome wizard.

**Replaces with:** none. The route is deleted in Phase R5. Tab-equivalent surfaces re-emerge as Lab Overview widgets (Activity feed, Gantt overlay) and as per-page toggles (Experiments, Notes, Search, Purchases, Methods, Roadmaps).

### 1b. The eight Lab\* panels

| Component | Lines | What it does | Replaced by |
|-----------|-------|--------------|-------------|
| `LabActivityPanel.tsx` | 322 | Per-user recent edits feed with method/task/project rollups, tinted by owner colour. | **Lab Overview widget** ("Activity") — same rollup logic, widget-shaped. |
| `LabGanttChart.tsx` | 673 | Combined Gantt overlay (Phase 4 lab head work) with member colour bands + filter row. | **Lab Overview widget** + **`/gantt` "Show all lab" toggle**. Gantt page already has this overlay code; widget reuses it in a sized box. |
| `LabExperimentsPanel.tsx` | 441 | Outcome-gallery view of every member's `task_type === "experiment"` records. | **`/experiments` "Show all lab" toggle**. The page already groups by project; the toggle just feeds it everyone's tasks tinted by owner. |
| `LabPurchasesPanel.tsx` | 606 | Cross-user purchase table with PI approval controls (Phase 3 lab head). | **`/purchases` "Show all lab" toggle**. PI approval buttons stay (already gated on `account_type === "lab_head"`), just rendered inline on the regular page. |
| `LabRoadmapsPanel.tsx` | 303 | Aggregated `HighLevelGoals` across users with per-user opt-out (`hide_goals_from_lab`). | **Lab Overview widget** ("Roadmap rollup"). Personal Roadmap stays on its current home (currently inside `/gantt` or wherever it lives); the rollup is widget-only. |
| `LabMethodsPanel.tsx` | 463 | Cross-user method library + public methods. | **`/methods` "Show all lab" toggle**. Public methods are already shown in personal view; the toggle adds per-user method visibility. |
| `LabSearchPanel.tsx` | 863 | Cross-user keyword search with owner colour tints. | **`/search` "Show all lab" toggle**. Existing search already supports a scope concept; we widen its corpus when the toggle is on. |
| `NotesPanel.tsx` (with `isLabMode`) | shared | Notes panel reused with a `isLabMode` prop to show all users' notes. | **`/notes` "Show all lab" toggle**. The `isLabMode` prop becomes `showAllLab`; same code path. |

Two supporting components also retire:
- **`LabUserFilterButton.tsx`** (301 lines): the floating "user picker" control that selected which users' content to merge. With per-page toggles, the toggle is "all or me"; if Grant later wants a multi-user filter we can re-introduce it inline. For Phase R1-R5 it goes away.
- **`LabUserDetailPanel.tsx`** (342 lines): the side popup for clicking a member to see their cross-tab summary. This shape doesn't transplant cleanly to per-page toggles. Recommendation: replace with a **member-detail widget** on Lab Overview ("Spotlight a member") so PIs who want a single-member deep-dive still have one.

### 1c. Demo / tour scaffolding

- **`DemoLabModeViewer.tsx`** (649 lines) and **`DemoLabModeMount.tsx`** (90 lines): an overlay-based replica of `/lab` used by the lab-mode tour. The overlay is mounted via `openDemoLabModeViewer()` window-event from `LabModeWarpToDemoStep`, and dismissed by `closeDemoLabModeViewer()` from `LabModeExitStep`.
- **`DemoLabBanner.tsx`** (176 lines): the "you are in demo mode" banner shown over `/lab` when the tour is active.
- **Lab Mode tour steps** under `frontend/src/components/onboarding/v4/steps/lab-mode/`: 12 steps total — Prompt, Intro, WarpToDemo, Activity, Gantt, Experiments, Purchases, Roadmaps, Methods, Notes, Search, Exit. Each step has a matching `__tests__/*.test.tsx`.
- **Tour cluster test:** `LabModeCluster.test.tsx` exercises the 12-step sequence as a unit.

The replacement walkthrough (Phase R4) is a shorter PI-facing intro of ~5-8 steps that tours the Lab Overview widgets and the per-page toggle pattern.

### 1d. Pseudo-user wiring

The `"lab"` sentinel username is referenced in (non-exhaustive):

- `frontend/src/lib/local-api.ts` lines 1403, 3122, 4753 — guards against using `"lab"` as a comment author or audit actor.
- `frontend/src/components/UserLoginScreen.tsx` lines 135, 235-243, 435-436, 450, 467, 807, 833, 841, 844, 1017 — the "Lab Mode" big button (lines 830-845), the `handleLabModeLogin` handler, and assorted filters that exclude `"lab"` from the real-user list.
- `frontend/src/app/page.tsx` lines 87-98, 355-372 — Home page detects `currentUser === "lab"` and force-bounces to `/lab` (a redirect that exists only to keep the pseudo-user away from the personal home page).

Every one of these references is unambiguously dead code once the pseudo-user is retired.

### 1e. Existing Lab Inbox (becomes Lab Overview)

The current `/lab-inbox` route (121 lines) and its three sub-components — `LabInboxAnnouncements.tsx` (423), `LabInboxComments.tsx` (551), `LabInboxMetrics.tsx` (669) — already make up a working multi-section dashboard. They use account-type guards: announcements composer + metrics gate on `lab_head`; comment feed renders for everyone in the lab.

The rename in flight (chip `a199aa6b`) takes care of the URL, top-nav promotion, and the page title. This proposal layers the widget framework on top of the renamed route. The existing three "sections" become the first three widgets in the catalog.

---

## 2. Per-Page Toggle Pattern

### 2a. Toggle UI specification

Mirror the Workbench `showShared` toggle: a small pill-shaped button in the page header, with the lab-head's icon + label "Show all lab" or "Personal." Click flips state.

```
┌─ Experiments ─────────────────────────── [ ⚛ Personal ] ──┐
                                       (off: emerald-50 bg)

┌─ Experiments ─────────────────────────── [ ⚛ Show all lab ] ──┐
                                         (on: emerald-600 text)
```

Wrapping with `<Tooltip>` because it's an icon-only control on narrow viewports.

**Persistence:** per-user, per-page, in `users/<username>/_user_settings.json` under a new `lab_view_toggles` object:

```json
{
  "lab_view_toggles": {
    "experiments": false,
    "notes": false,
    "purchases": false,
    "search": false,
    "calendar": false,
    "methods": false
  }
}
```

Default `false` everywhere. The toggle is a stickier-than-session preference but cheap to flip; per-user means the lab head's "show all" doesn't drag everyone else into all-lab view.

**Visual tinting:** every record shown when toggle is ON gets a 3-4px left border in the owner's `UserMetadataEntry.color`, plus a small avatar pill in the corner. Records belonging to the current user render unchanged (no border). The owner colour scheme is already loaded by `useLabData`.

**Empty state:** "Toggle 'Show all lab' to see everyone's experiments." or similar per page. If the toggle is on but no other-user content exists, show "You're seeing the whole lab. Everyone else is empty." — better than a blank page.

### 2b. Source-of-truth data path per page

| Page | Current source | Cross-user source | Wiring effort |
|------|----------------|-------------------|---------------|
| `/experiments` | per-user `tasksStore.listAllForUser(currentUser)` filtered to `task_type === "experiment"` | `labApi.getTasks()` filtered to experiments (already exists) | small — feed-swap based on toggle state |
| `/notes` | per-user notes from `notesStore` | already implemented via `NotesPanel`'s `isLabMode` prop using `labApi.getNotes()` (or equivalent) | trivial — rename prop, wire to toggle |
| `/purchases` | per-user task list filtered to `task_type === "purchase"` | `labApi.getTasks()` filtered to purchases | small |
| `/search` | per-user content + public methods | `labApi.getTasks/getMethods/getNotes` aggregated | medium — search index needs the broader corpus when toggle is on |
| `/calendar` | per-user tasks | `labApi.getTasks()` rendered as date-grouped events tinted by owner | medium — calendar needs per-event owner colour |
| `/methods` | per-user methods + public | `labApi.getMethods()` already includes per-user breakdown | trivial |
| `/links` | per-user links | not yet exposed via `labApi`; needs a new `labApi.getLinks()` if Grant wants this on the toggle list | medium |
| `/gantt` | per-user combined Gantt | `LabGanttChart` overlay already exists | small — embed the overlay behind the toggle |

**Recommendation:** ship Phase R1 with the seven easy ones (experiments, notes, purchases, search, methods, calendar, gantt). `/links` joins in Phase R3 once a `labApi.getLinks()` exists, or sits this one out if Grant decides links stay personal-only.

### 2c. New API surface needed

The `labApi.*` helpers already cover most of what we need (tasks, projects, methods, goals, users). Two gaps:

- **`labApi.getNotes()`**: exists implicitly (NotesPanel does aggregate), formalize the helper so per-page wiring stays consistent.
- **`labApi.getLinks()`** (optional, Phase R3): only if links join the toggle list.

No backend changes. No new sidecar fields beyond `lab_view_toggles` in `_user_settings.json`. The toggle is purely a read-side feature; writes stay user-local and routes through the existing Lab Head soft-write paths when crossing owner.

---

## 3. Lab Overview Widget Framework

### 3a. react-grid-layout integration

`react-grid-layout` is the lib. It supports drag, resize, and breakpoint-aware layouts. Install:

```
npm install react-grid-layout
npm install -D @types/react-grid-layout
```

Wrap the Lab Overview body in a `<ResponsiveGridLayout>`. Each widget is a `<div data-grid={{ x, y, w, h, minW, minH }}>` child. Layout config is a JSON object the layout serializer hands us on drag/resize end.

**Breakpoints:** `lg` (≥1200), `md` (≥996), `sm` (≥768), `xs` (≥480). On `xs` the layout collapses to a single column (see 3f).

**Edit mode toggle:** drag/resize handles only appear when the user clicks "Edit layout" in the page toolbar. Default state is view-only — no accidental rearranging on a normal session. This matches the dashboard-builder convention used in Grafana, Notion gallery views, etc.

### 3b. Widget catalog

Initial catalog (Phase R3):

| Widget | Source | Default size | Visibility |
|--------|--------|--------------|------------|
| **Announcements** | `LabInboxAnnouncements` (composer for lab_head, read-only for members) | 6w × 3h | all lab members |
| **Comment feed** | `LabInboxComments` ("@everyone" cross-lab) | 6w × 4h | all lab members |
| **Metrics tabs** | `LabInboxMetrics` (Gantt overlay, funding rollup, roadmap rollup tabs) | 12w × 5h | lab_head only |
| **Activity feed** | port of `LabActivityPanel` (recent edits across the lab) | 6w × 4h | all lab members |
| **Member spotlight** | port of `LabUserDetailPanel` (pick a member, see their cross-tab summary) | 4w × 5h | lab_head only |
| **Recent shares** | new (shares involving the current user as either side) | 4w × 3h | all lab members |
| **Pending purchase approvals** | filter on `pi_approved === null` across all members | 6w × 3h | lab_head only |
| **Flag-for-review queue** | open flag-for-review notifications | 4w × 3h | lab_head only |
| **Audit-log digest** | recent `_pi_audit.json` entries (last 7 days) | 6w × 3h | lab_head only |
| **Member workload heat-map** | tasks-due-this-week per member, colour-coded | 6w × 3h | lab_head only |
| **Lab roster** | port of `LabRoster` from Settings (archive / restore + status) | 6w × 4h | lab_head editable, members read-only |
| **Todo for me** | tasks assigned by PI to the current user, plus open flags on the current user's records | 4w × 4h | all lab members |

The grid is 12 columns wide. Three rows of small widgets (3-4h tall each) or two rows of medium widgets (5-6h) fit comfortably without scrolling on a `lg` viewport.

### 3c. Layout persistence + sidecar versioning

**Storage:** per-user, in `users/<username>/_user_settings.json` under a new key:

```json
{
  "lab_overview_layout": {
    "version": 1,
    "widgets": [
      { "id": "announcements", "x": 0, "y": 0, "w": 6, "h": 3 },
      { "id": "comment-feed", "x": 6, "y": 0, "w": 6, "h": 4 },
      { "id": "metrics-tabs", "x": 0, "y": 4, "w": 12, "h": 5 }
    ]
  }
}
```

Per-user, not per-lab. Each user (lab head or member) gets their own canvas; the PI's drag-and-drop doesn't reshape what their members see. This avoids the "PI rearranges the layout and members suddenly can't find the announcement" anti-feature.

**Versioning:** `version: 1` on the layout object. When the widget catalog gets new widgets in later phases, we bump to `version: 2` and write a migration that appends the new widgets at the bottom in their default positions. Unknown widget IDs (e.g. a widget that got renamed) are silently dropped on read with a console warning. No destructive migration — the user's existing custom positions for known widgets are preserved.

**Default layout for first-time PIs:** Announcements top-left (6×3), Comment feed top-right (6×4), Metrics tabs full-width second row (12×5), Activity feed and Member spotlight side-by-side third row (6×4 each). This mirrors the current Lab Inbox layout 1:1, so the rename + widget conversion is a no-op visually for first-run PIs.

**Default layout for members:** Announcements top-full (12×3), Comment feed below (12×4), Activity feed below (12×3). No metrics widgets, no PI-only widgets. Three widgets stacked vertically.

### 3d. Add / remove / resize UX

**Top toolbar on the Lab Overview page:**

```
Lab Overview                                  [ + Add widget ] [ Edit layout ] [ Reset layout ]
```

- **+ Add widget**: opens a side drawer with the widget catalog. Each widget shows a thumbnail + name + one-line description. Click to insert at the next available grid slot (bottom of the layout). PI-only widgets are hidden from the drawer for non-PIs.
- **Edit layout**: toggles drag/resize handles on every widget. When ON: drag from the header, resize from the bottom-right corner, "×" button in each widget header removes it. Click again or press Escape to exit edit mode and persist.
- **Reset layout**: confirmation modal ("Reset to default? Your widget positions will be lost.") then writes the default layout.

**Resize behaviour:** widgets define `minW` / `minH` to prevent absurd sizes (e.g. Metrics tabs can't go below 8×4 or the tab chrome breaks). Snap to grid (`react-grid-layout` does this by default).

**Drag behaviour:** drag handle is the widget header (the title bar). The widget body is not draggable — clicks inside the body (e.g. clicking a comment to open it) work as expected.

### 3e. Member view (read-only widget set)

Per Phase 3 visibility (Grant 2026-05-23):
- Members see: Announcements, Comment feed, Activity feed, Todo for me, Recent shares. No metrics widgets, no Lab Roster edit controls (they see the roster widget read-only).
- Members can drag / resize / remove widgets from their own canvas. They cannot add widgets that are PI-only (the catalog filters those out).
- Layout persists per-member same as PI.

**Why give members the widget UI at all?** Because the announcement / comment / activity layout is theirs to customize, and there is no reason a member who never looks at announcements shouldn't be able to bury that widget. The cost is essentially zero (same library, same persistence).

### 3f. Mobile / narrow-viewport fallback

`react-grid-layout` exposes a `breakpoints` config. On `xs` (<480 wide) we collapse to single column, drag is disabled (touch-and-drag for grid items on mobile is universally bad), and the "Edit layout" button is hidden. Reset layout still works. Widget order on mobile is the persisted `y` order from the `lg` layout — no separate mobile layout.

Phase R3 estimate: 1-2 days of mobile polish on top of the desktop framework.

---

## 4. PI Walkthrough Replacement

### 4a. New walkthrough beats (5-8 steps)

Target: 6 steps, half the count of the existing Lab Mode tour (12 steps + the Prompt + the WarpToDemo + the Exit = 15 effective beats).

1. **Lab Overview intro** — "This is your Lab Overview. The PI command center. Everything cross-lab lives here." Target: the page heading on `/lab-overview`.
2. **Announcements widget** — "Drop a message that everyone in the lab sees on their own Lab Overview. The composer is yours." Target: the Announcements widget.
3. **Comment feed widget** — "Every comment your team posts across every record lands here. Click any to open the source record in place." Target: a comment row in the Comment feed widget.
4. **Edit layout demo** — "Click Edit layout. Drag widgets around. Resize handles on the corners. Add new widgets from the + button. Your layout is yours; your team has their own." Target: the Edit layout button.
5. **Show all lab on a regular page** — "Every page has a 'Show all lab' toggle in the header. Try Experiments now." Target: the toggle on `/experiments` (the tour navigates there).
6. **Done** — "That's it. Lab Overview for the dashboard, page toggles for working in everyone else's space. No mode switch." Optional outro / BeakerBot wave.

### 4b. Tour integration

This replaces the entire `steps/lab-mode/` subtree (12 step modules + their tests + the cluster test + the LabModeViewer overlay + the LabModeMount window-event host). Net file delta:
- Delete 12 step files + 12 test files + `LabModeCluster.test.tsx`.
- Delete `DemoLabModeViewer.tsx` (649 lines) + `DemoLabModeMount.tsx` (90 lines) + `DemoLabModeViewer.test.tsx` + `DemoLabModeViewer.demoData.test.tsx`.
- Delete `DemoLabBanner.tsx` (176 lines).
- Add ~6 new step files under `steps/lab-overview/` + 6 tests + 1 cluster test.

Net: ~2000 lines removed, ~600 lines added. Substantial code-debt reduction.

The new cluster gates on `picks.account_type === "lab_head"`. For ordinary lab members the tour skips this cluster entirely — they don't need a tour of widgets they'll see naturally on Lab Overview, and the per-page toggle is self-evident enough to mention in a one-line cleanup tip rather than a guided beat.

---

## 5. Phasing Plan

### Phase R1 — per-page toggles (medium)

Lowest-risk, additive. Ships first.

Deliverables:
- New `_user_settings.json` field `lab_view_toggles` (additive, defaults to all false).
- `<LabViewToggle page="experiments" />` shared component using `<Tooltip>`.
- Wire toggle into each target page (experiments, notes, purchases, search, methods, calendar, gantt).
- Owner-tint styling on each record type's row / card / pill.
- `labApi.getNotes()` formalized.
- Tests: a `__tests__/lab-view-toggle.test.tsx` exercising the toggle + the data path.

Dependent files: `lib/settings/user-settings.ts`, new `components/LabViewToggle.tsx`, the 7 page `page.tsx` files, the row/card components for tasks / notes / purchases / methods / calendar events.

Scope: **medium** (touches many page components, but each integration is mechanical).

### Phase R2 — Lab Overview widget framework (medium)

Deliverables:
- Install `react-grid-layout` + types.
- Rename `LabInboxPage` → `LabOverviewPage` (depends on chip `a199aa6b` landing first).
- Wrap the body in `<ResponsiveGridLayout>`.
- Convert the three existing sections (Announcements, Comment feed, Metrics) into widget shells with `data-grid` attributes.
- Add `lab_overview_layout` field to `_user_settings.json`.
- Toolbar: Add widget / Edit layout / Reset layout buttons.
- "Add widget" side drawer with the catalog (initially just the 3 widgets that already exist).
- Tests: layout persistence round-trip, version-1 schema, default layout for new lab_head + new member.

Dependent files: new `components/lab-overview/widget-frame.tsx`, new `components/lab-overview/widget-catalog.ts`, new `lib/settings/lab-overview-layout.ts`, `app/lab-overview/page.tsx` (renamed from `lab-inbox`).

Scope: **medium** (new lib integration; layout persistence has tricky edge cases around versioning).

### Phase R3 — widget catalog (large)

Deliverables: 9 new widgets, each a thin wrapper around an existing component or a new feed-style component:
- Activity feed (port `LabActivityPanel`)
- Member spotlight (port `LabUserDetailPanel`)
- Recent shares (new)
- Pending purchase approvals (filter on existing data)
- Flag-for-review queue (filter on existing notifications)
- Audit-log digest (last 7d from `_pi_audit.json`)
- Member workload heat-map (new)
- Lab roster (port from Settings)
- Todo for me (new, filters existing tasks + flags)

Plus the "+ Add widget" drawer fully populated, mobile fallback polish, member vs lab_head visibility filtering on the catalog.

Dependent files: ~10 new widget files under `components/lab-overview/widgets/`, the catalog config, the drawer.

Scope: **large** (lots of small components, each with its own test; visibility filtering needs care).

### Phase R4 — tour rip + new PI walkthrough (medium)

Deliverables:
- Delete `steps/lab-mode/` directory entirely (12 step files + 12 tests + cluster test).
- Delete `DemoLabModeViewer.tsx`, `DemoLabModeMount.tsx`, both test files.
- Delete `DemoLabBanner.tsx`.
- Remove step-registry imports + entries (lines 67-80 + 369-380 of `step-registry.ts`).
- Add new `steps/lab-overview/` with 6 step files + tests + cluster test.
- Update the Welcome Wizard wiki page (`wiki/getting-started/welcome-wizard/page.tsx`) to describe the Lab Overview tour instead of the Lab Mode warp-to-demo flow.

Dependent files: `step-registry.ts`, `V4MountForUser.tsx` (removes the `<DemoLabModeMount>` host), `wiki/getting-started/welcome-wizard/page.tsx`, all the tour fixtures referencing lab-mode step IDs.

Scope: **medium** (mostly deletion + 6 new mechanical steps).

### Phase R5 — Lab Mode deletion (medium)

The cleanup.

Deliverables:
- Delete `frontend/src/app/lab/page.tsx`.
- Delete `LabActivityPanel.tsx`, `LabExperimentsPanel.tsx`, `LabSearchPanel.tsx`, `LabPurchasesPanel.tsx`, `LabGanttChart.tsx`, `LabMethodsPanel.tsx`, `LabRoadmapsPanel.tsx`, `LabUserFilterButton.tsx`, `LabUserDetailPanel.tsx`. (Note: panels survive AS widget bodies but only if the widget exists — Phase R3 handles the ports, so by R5 these standalone files are pure duplicate of widget code and can go.)
- Delete the `"Lab Mode"` button on `UserLoginScreen.tsx` (lines 830-845) + `handleLabModeLogin` (lines 235-243) + all `users.filter(u => u !== "lab")` calls (lines 135, 435-436, 450, 467, 807, 1017).
- Remove `currentUser === "lab"` redirect logic from `app/page.tsx` (lines 84-100, 355-372).
- Remove `"lab"` from `labApi.getUsers` filter list at `local-api.ts:4753`.
- Remove the `"lab"` guards at `local-api.ts:1403, 3122` (no actor can be `"lab"` anymore so the guards are dead).
- Test sweep: any test that references the `lab` user, the `/lab` route, or the Lab\* panels gets deleted or rewritten.
- Wiki sweep: delete or rewrite `wiki/features/lab-mode/**` (the 6 lab-mode wiki pages).

Dependent files: see audit section 1d for the full reference list.

Scope: **medium** (mechanical deletion across many files, but each file edit is small).

### Phase R6 — wiki rewrite (small)

Deliverables:
- Delete `wiki/features/lab-mode/page.tsx` and subdirs (activity / gantt / purchases / user-filter / cross-user-lists).
- New `wiki/features/lab-overview/page.tsx` describing the widget framework.
- New `wiki/features/lab-overview/widgets/` sub-pages for each widget (announcements, comment feed, metrics, activity, roster, etc.).
- New `wiki/features/show-all-lab-toggle/page.tsx` describing the toggle pattern + listing the pages it appears on.
- Update `wiki/shared-lab-accounts/page.tsx` to reflect that the shared `lab` account is no longer a thing (it might pivot to "shared lab folder access" instead).
- Update the navigation in `lib/wiki/nav.ts` to drop Lab Mode entries and add Lab Overview + Show All Lab entries.

Dependent files: ~10 wiki page files, `lib/wiki/nav.ts`.

Scope: **small** (writing time, not engineering risk; all wiki pages are self-contained).

---

## 6. Edge Cases and Open Questions

### Permission practice during the tour

The current tour includes `LabPermissionPracticeStep.tsx` (under `steps/lab/` — note: this is a different directory from `steps/lab-mode/`; `steps/lab/` is the lab _setup_ cluster from Q1a, not the lab _mode_ cluster). This step does NOT depend on `/lab`; it depends on the lab _folder_ permission model. It survives Lab Mode retirement untouched.

Same with `LabPromptStep.tsx`, `LabAutoCleanupStep.tsx`, `LabSpawnBeakerBotStep.tsx` under `steps/lab/`. All lab-folder-setup steps, all survive.

### Saved widget layouts during catalog churn

Already handled in section 3c (version field + unknown-widget drop on read + new-widget append-at-bottom migration). The only risk is if Grant later wants to **rename** a widget ID — the migration would need a `renames: { "old-id": "new-id" }` map. Phase R3 adds this preemptively to the migration helper.

### Does deleting the `lab` pseudo-user break demo flow?

The demo (`?demo=alex` or similar) already runs as alex / morgan / mira. The `lab` pseudo-user is a separate, in-app concept — the login-picker button. They never overlapped. Verified:
- `frontend/src/lib/demo/lab-demo-data.ts` seeds alex / morgan / mira data, never references the `lab` username.
- `DemoLabModeViewer.tsx` is the tour overlay, not a demo entry point.
- `frontend/src/app/demo/[[...slug]]/` is the demo route; not affected by `/lab` deletion.

Conclusion: demo flow is unaffected by R5.

### External integrations or wiki links pointing to `/lab/*`

Internal-only audit:
- Top-nav links to `/lab` from `AppShell` for lab workspaces — gone in R5.
- Wiki pages under `wiki/features/lab-mode/*` link to `/lab` for "Try it now" — rewritten in R6.
- `SpendingDashboard.tsx` has a "View in Lab Mode →" link that deep-links to `/lab?tab=purchases` (per the `lab/page.tsx` URL parser at line 87) — rewrite to point at `/purchases?showAllLab=1` in Phase R1 once the toggle accepts a URL param.

No external integrations (the app is local-first; there are no external bookmarks to /lab that the team has shipped to customers).

### Lab Roster from Settings — stay or migrate?

Currently `LabRoster.tsx` (385 lines) lives under `components/lab-head/` and is mounted in the Settings page under a Lab Head section (settings/page.tsx:305). Two options:

- **Option A: dual-mount.** Roster stays in Settings (for the deliberate "go to Settings → Lab → archive someone" path) AND becomes a Lab Overview widget (for the at-a-glance "who's in my lab right now" use case). The component is shared; the wrapper differs.
- **Option B: widget-only.** Delete the Settings tab; Lab Overview is the only home.

**Recommendation: Option A.** Settings is the legacy / discoverable / "long-form" path. The widget is the dashboard surface. Removing Settings access would force the PI to navigate to Lab Overview every time they archive someone, which is a regression from the current state.

### Settings page "Lab Mode" tab name

Per the brief, the Settings tabs reorg (chip `a96ef211`) groups settings into Personal / Lab Mode tabs. With this proposal landing, the "Lab Mode" tab name in Settings becomes confusing — the feature it names is gone.

**Recommendation:** rename Settings tab from "Lab Mode" → "Lab Settings" (or "Lab"). The contents stay the same: lab folder controls, lab head password, archive controls, Phase 1-6 lab-admin sections. The rename is a single-line copy change in `settings/page.tsx` once the Settings tabs reorg chip lands.

Coordinate with the Settings tabs reorg chip author to land this rename in their PR, not separately.

### URL deep links into `/lab?tab=foo`

Anyone with a bookmark to `/lab?tab=purchases` (e.g. the SpendingDashboard "View in Lab Mode →" link) needs a redirect target. Recommendation: a one-line `next.config.js` redirect from `/lab/*` to `/lab-overview` for backwards compatibility through Phase R5. Drop the redirect after one release cycle.

### What if a lab has zero lab heads?

A lab with only `member` accounts (no `lab_head`) lands on Lab Overview anyway because the route is for all lab members. They see the member-default layout (Announcements + Comment feed + Activity feed). No PI-only widgets are in their catalog. The page is still useful as a comment / activity hub even without a PI.

This is a genuine improvement over the current `/lab` route which feels lopsided without lab head participation.

### Open question to surface to Grant

**Toggle granularity:** the proposal sets one toggle per page. Should we also offer a per-user multi-select filter (the current `LabUserFilterButton` behavior) on each page, or is "everyone vs me" sufficient? Recommendation: ship Phase R1 with the binary toggle; if PIs ask for multi-select later, add an inline member-pill picker next to the toggle.

This is the only design question the brief didn't pre-answer. The rest is grounded.

---

## 7. File Inventory (Delete / Rename / Move)

### Delete (R4)

- `frontend/src/components/onboarding/v4/DemoLabModeViewer.tsx` (649 lines)
- `frontend/src/components/onboarding/v4/DemoLabModeMount.tsx` (90 lines)
- `frontend/src/components/onboarding/v4/__tests__/DemoLabModeViewer.test.tsx`
- `frontend/src/components/onboarding/v4/__tests__/DemoLabModeViewer.demoData.test.tsx`
- `frontend/src/components/DemoLabBanner.tsx` (176 lines)
- `frontend/src/components/onboarding/v4/steps/lab-mode/` (entire directory, 12 step files + lib + 13 test files)

### Delete (R5)

- `frontend/src/app/lab/page.tsx` (483 lines)
- `frontend/src/components/LabActivityPanel.tsx` (322 lines)
- `frontend/src/components/LabExperimentsPanel.tsx` (441 lines)
- `frontend/src/components/LabSearchPanel.tsx` (863 lines)
- `frontend/src/components/LabPurchasesPanel.tsx` (606 lines)
- `frontend/src/components/LabGanttChart.tsx` (673 lines)
- `frontend/src/components/LabMethodsPanel.tsx` (463 lines)
- `frontend/src/components/LabRoadmapsPanel.tsx` (303 lines)
- `frontend/src/components/LabUserFilterButton.tsx` (301 lines)
- `frontend/src/components/LabUserDetailPanel.tsx` (342 lines)
- `frontend/src/components/__tests__/LabSearchPanel.cacheFilter.test.tsx`
- `frontend/src/components/lab-methods-rollup.test.ts`
- All Lab\* component test files

Estimated delete: ~6500 lines of code.

### Rename (R2 / depends on chip a199aa6b)

- `frontend/src/app/lab-inbox/` → `frontend/src/app/lab-overview/`
- `frontend/src/components/lab-inbox/LabInboxAnnouncements.tsx` → `frontend/src/components/lab-overview/widgets/AnnouncementsWidget.tsx`
- `frontend/src/components/lab-inbox/LabInboxComments.tsx` → `frontend/src/components/lab-overview/widgets/CommentFeedWidget.tsx`
- `frontend/src/components/lab-inbox/LabInboxMetrics.tsx` → `frontend/src/components/lab-overview/widgets/MetricsWidget.tsx`

### Move (R3)

- `frontend/src/components/lab-head/LabRoster.tsx` → `frontend/src/components/lab-overview/widgets/LabRosterWidget.tsx` (Settings retains a thin wrapper that mounts the same widget body inline)

### Move (R6 — wiki)

- `wiki/features/lab-mode/page.tsx` → delete + redirect to `wiki/features/lab-overview/page.tsx` (new content)
- `wiki/features/lab-mode/{activity,gantt,purchases,user-filter,cross-user-lists}/page.tsx` → delete; consolidated into Lab Overview widget docs

Estimated add: ~600 new lines of step / widget code + ~1500 lines of wiki content (writing-time, not engineering risk).

---

## 8. Out of Scope (Explicit)

The following are explicitly excluded:

- **A separate cross-lab view for multi-lab users.** ResearchOS is single-lab. No multi-lab dashboard.
- **Real-time collaborative widget editing.** The widget grid is single-user (each lab member edits their own canvas). No "PI drags widget, member's screen rearranges live."
- **Widget code published as a public API for third-party widgets.** The widget catalog is in-app only. No plugin system, no widget marketplace.
- **Multi-user content filter within per-page toggles.** Binary toggle only ("show all" or "me"). A member-pill multi-select can be added later if Grant asks; not in Phase R1.
- **Widget data refresh policies / WebSocket subscriptions.** Widgets read from disk on mount and on focus; same pattern as the rest of the app. No real-time sync.
- **A migration period where both `/lab` and `/lab-overview` coexist.** Phase R5 cuts `/lab` entirely. The Lab Overview replaces it on the same release. The one concession is a 1-release-cycle redirect from `/lab/*` → `/lab-overview` for stale bookmarks.
- **Re-introducing a "View as <member>" impersonation mode.** Lab Mode's read-only-view-of-someone-else flavour is gone for good. The Lab Head edit-mode session (Phase 5 of the Lab Head proposal) is the supported path for cross-owner read/write, and per-page toggles are the supported path for cross-owner read.

---

*— lab mode retirement proposal author, 2026-05-23*
