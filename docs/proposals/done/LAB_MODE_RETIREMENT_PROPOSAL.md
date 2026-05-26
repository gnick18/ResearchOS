# Lab Mode Retirement Proposal

**Author:** lab mode retirement proposal R1 author
**Date:** 2026-05-23
**Status:** Pre-implementation. No code yet. R1 revision (supersedes v1 per Grant 2026-05-23 direction shift).

---

## Background

"Lab Mode" is the read-only pseudo-user account that lets any logged-in user click "Lab Mode" on the login picker, log in as the `lab` user, and browse every member's data through a dedicated `/lab` route with eight tabs (Activity, Gantt, Experiments, Purchases, Roadmaps, Methods, Notes, Search). It was the first cross-user surface ResearchOS shipped, predating Lab Head and the Lab Inbox. It has since accumulated three structural problems.

First, it is a separate identity. The user logs out of themselves and into a sentinel account. Anything they want to do back in their own work (favourite a note they just spotted, drop a comment, assign a task) requires logging out of lab and back into their own user. Lab Head's soft-write actions (announcements, task assignment, purchase approval) cannot run from `/lab` at all, because the actor on `/lab` is `"lab"`, not the PI.

Second, the data path duplicates work. `useLabData` plus the `labApi.*` helpers already aggregate cross-user content for `/lab`. The same data is available from inside any per-user page, but only `/lab` exposes it; an experiment view on `/experiments` only shows the logged-in user. That asymmetry forces users into a context switch for what should be a record-by-record visibility setting.

Third, the Lab Mode walkthrough is the longest section of the v4 tour (12 steps under `steps/lab-mode/`, plus a full `DemoLabModeViewer` overlay totalling ~650 lines). It exists to teach the user that they are now a different person looking at read-only data. With the new Lab Overview + unified sharing primitive this whole concept goes away: you are always yourself, and cross-user content shows up in your own page because someone shared it with you (or with the whole lab).

This proposal retires the `lab` pseudo-user, the `/lab` route, and the `LabModeViewer` overlay. Cross-user content reaches users in two places instead: the renamed **Lab Overview** page (the former `/lab-inbox`, now a configurable widget canvas), and shared records flowing into the recipient's own per-page views via a **unified `shared_with` primitive** that replaces the current patchwork (notes use `is_shared`, tasks have one shape, methods another, etc.). The result is one identity, one mental model, one short walkthrough.

> **R1 note.** The v1 author proposed a per-page "Show all lab" toggle as the cross-user access pattern. After v1 landed, Grant redirected to a unified sharing primitive instead; the patterns are mutually exclusive (one is "I temporarily ask to see everyone," the other is "the record is shared with me so it's mine to see"). Section 2 was rewritten end-to-end against the new direction; Sections 1 / 3 / 4 received light edits to reflect the swap; Section 5 was reordered to land the sharing primitive first.

---

## Locked design decisions (Grant 2026-05-23)

1. **Lab pseudo-user account fate: DELETE ENTIRELY.** No more "Lab Mode" button on the login picker. No more `lab` sentinel user. No more `/lab` route. Every lab-wide view is reached from inside the user's own session.
2. **Cross-user content access pattern: UNIFIED `shared_with` PRIMITIVE.** A single canonical shape across every share-able record type, with a `"*"` sentinel for "Whole lab." The Workbench `showShared` filter (already in place) becomes the canonical recipient-side UX across every page. No per-page "Show all lab" toggle; that approach was considered (v1) and rejected (R1).
3. **Modular Lab Overview: react-grid-layout drag-and-drop.** Widgets on the Lab Overview can be moved, resized, added, and removed freely. Layout persists per-user on the lab head, with a sensible default for first-run. Estimated 1-2 week effort, anchored on the `react-grid-layout` library.
4. **Lab Head implicit view-all + passcode edit-anywhere.** PIs see every record regardless of `shared_with` (role privilege; no entry written). The Phase 5 session edit mode (already plumbed for tasks / notes / purchases via owner-scoped wrappers) extends to every record type so a PI can edit anyone's work after entering the lab head passcode.

These four decisions are not re-litigated below; each section threads them through.

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

**Replaces with:** none. The route is deleted in Phase R5. Tab-equivalent surfaces re-emerge as Lab Overview widgets (Activity feed, Gantt overlay) and as shared records flowing into the recipient's per-page views through the unified sharing primitive (Experiments, Notes, Purchases, Methods, etc).

### 1b. The eight Lab\* panels

| Component | Lines | What it does | Replaced by |
|-----------|-------|--------------|-------------|
| `LabActivityPanel.tsx` | 322 | Per-user recent edits feed with method/task/project rollups, tinted by owner colour. | **Lab Overview widget** ("Activity"); same rollup logic, widget-shaped. |
| `LabGanttChart.tsx` | 673 | Combined Gantt overlay (Phase 4 lab head work) with member colour bands + filter row. | **Lab Overview widget** for the dashboard rollup. The personal `/gantt` page already shows shared tasks the user has access to via `shared_with`; the cross-lab combined view becomes a widget only. |
| `LabExperimentsPanel.tsx` | 441 | Outcome-gallery view of every member's `task_type === "experiment"` records. | **Naturally subsumed.** Shared experiments show up in the recipient's `/experiments` page; the PI sees everyone's via the implicit view-all rule. No new page surface. |
| `LabPurchasesPanel.tsx` | 606 | Cross-user purchase table with PI approval controls (Phase 3 lab head). | **Naturally subsumed** for purchases the recipient is on. A **"Pending purchase approvals"** Lab Overview widget covers the PI's cross-lab triage need. |
| `LabRoadmapsPanel.tsx` | 303 | Aggregated `HighLevelGoals` across users with per-user opt-out (`hide_goals_from_lab`). | **Lab Overview widget** ("Roadmap rollup"). Personal Roadmap stays on its current home; the rollup is widget-only. Goal sharing (see Section 2) supersedes the `hide_goals_from_lab` opt-out. |
| `LabMethodsPanel.tsx` | 463 | Cross-user method library + public methods. | **Naturally subsumed.** Methods marked `is_public: true` are already visible to everyone; shared-but-private methods come through `shared_with` into `/methods`. |
| `LabSearchPanel.tsx` | 863 | Cross-user keyword search with owner colour tints. | **`/search`** indexes everything the user is allowed to see (own + shared + lab-public). Lab Head sees everything. No mode flip. |
| `NotesPanel.tsx` (with `isLabMode`) | shared | Notes panel reused with a `isLabMode` prop to show all users' notes. | **Naturally subsumed.** Shared notes appear in the recipient's `/notes`; the `isLabMode` prop is deleted along with `LabSearchPanel`. |

Two supporting components also retire:
- **`LabUserFilterButton.tsx`** (301 lines): the floating "user picker" control that selected which users' content to merge. With sharing-based access, content is in your own list because someone shared it; per-user filtering is a sort / group concern handled by existing page filters (or a future inline owner-pill picker if Grant asks for one).
- **`LabUserDetailPanel.tsx`** (342 lines): the side popup for clicking a member to see their cross-tab summary. Replaced with a **member-detail widget** on Lab Overview ("Spotlight a member") so PIs who want a single-member deep-dive still have one.

### 1c. Demo / tour scaffolding

- **`DemoLabModeViewer.tsx`** (649 lines) and **`DemoLabModeMount.tsx`** (90 lines): an overlay-based replica of `/lab` used by the lab-mode tour. The overlay is mounted via `openDemoLabModeViewer()` window-event from `LabModeWarpToDemoStep`, and dismissed by `closeDemoLabModeViewer()` from `LabModeExitStep`.
- **`DemoLabBanner.tsx`** (176 lines): the "you are in demo mode" banner shown over `/lab` when the tour is active.
- **Lab Mode tour steps** under `frontend/src/components/onboarding/v4/steps/lab-mode/`: 12 steps total; Prompt, Intro, WarpToDemo, Activity, Gantt, Experiments, Purchases, Roadmaps, Methods, Notes, Search, Exit. Each step has a matching `__tests__/*.test.tsx`.
- **Tour cluster test:** `LabModeCluster.test.tsx` exercises the 12-step sequence as a unit.

The replacement walkthrough (Phase R4) is a shorter PI-facing intro of ~5-8 steps that tours the Lab Overview widgets and the shared-record flow.

### 1d. Pseudo-user wiring

The `"lab"` sentinel username is referenced in (non-exhaustive):

- `frontend/src/lib/local-api.ts` lines 1403, 3122, 4753; guards against using `"lab"` as a comment author or audit actor.
- `frontend/src/components/UserLoginScreen.tsx` lines 135, 235-243, 435-436, 450, 467, 807, 833, 841, 844, 1017; the "Lab Mode" big button (lines 830-845), the `handleLabModeLogin` handler, and assorted filters that exclude `"lab"` from the real-user list.
- `frontend/src/app/page.tsx` lines 87-98, 355-372; Home page detects `currentUser === "lab"` and force-bounces to `/lab` (a redirect that exists only to keep the pseudo-user away from the personal home page).

Every one of these references is unambiguously dead code once the pseudo-user is retired.

### 1e. Existing Lab Inbox (becomes Lab Overview)

The current `/lab-inbox` route (121 lines) and its three sub-components; `LabInboxAnnouncements.tsx` (423), `LabInboxComments.tsx` (551), `LabInboxMetrics.tsx` (669); already make up a working multi-section dashboard. They use account-type guards: announcements composer + metrics gate on `lab_head`; comment feed renders for everyone in the lab.

The rename in flight (chip `a199aa6b`) takes care of the URL, top-nav promotion, and the page title. This proposal layers the widget framework on top of the renamed route. The existing three "sections" become the first three widgets in the catalog.

---

## 2. Unified Sharing Primitive

### 2a. The canonical shape

```ts
// frontend/src/lib/types.ts; replaces the current SharedUser interface
export interface SharedUser {
  username: string;   // a real lab member, or "*" for the whole lab
  level: "read" | "edit";
}

// On every shareable record:
//   shared_with: SharedUser[];
//
// Default for new records: []  (owner-only).
// Backward-compat for records without the field: treated as [] on read.
```

The `level` field renames from `permission: "view" | "edit"` to `level: "read" | "edit"` to read more naturally in code (`level === "edit"` is more obvious than `permission === "edit"`). The migration is mechanical (a field rename, see 2g).

The `"*"` sentinel is the only string that is not a real username. It expands at read-time to "every current lab member"; there is no fan-out write. If three new members join the lab next month, they automatically see records shared with `"*"` from before they joined.

### 2b. Per-record-type audit (current → unified)

The good news: tasks, projects, methods, and mass spec protocols already use `SharedUser[]` on a `shared_with` field. The migration there is the `permission` → `level` rename + the `"*"` sentinel addition. Other record types use ad-hoc shapes that get normalized.

| Record type | Current sharing shape | Owner field? | Migration to unified | Complexity |
|-------------|----------------------|--------------|----------------------|------------|
| **Task** (`Task`) | `shared_with: SharedUser[]` with `permission: "view" \| "edit"` | yes (`owner`) | Rename `permission` → `level`, rewrite `"view"` → `"read"`. No structural change. | trivial |
| **Project** (`Project`) | `shared_with: SharedUser[]` with `permission: "view" \| "edit"` | yes (`owner`) | Same field rename. | trivial |
| **Method** (`Method`) | `shared_with: SharedUser[]` with `permission: "view" \| "edit"`, PLUS a separate `is_public: boolean` for "lab-wide" | yes (`owner`) | Field rename + a one-time migration: if `is_public === true`, push `{ username: "*", level: "read" }` into `shared_with`. Keep `is_public` for one release as a derived view-only flag (any `shared_with` entry with `username === "*"` materializes as `is_public: true` on read), then drop the field. | small |
| **Workbench List** (Task with `task_type === "list"`) | Same as Task (it IS a Task) | yes | Free; picks up Task's migration. | none |
| **Experiment task** (Task with `task_type === "experiment"`) | Same as Task | yes | Free. | none |
| **Purchase Item** (`PurchaseItem`) | None on the item; sharing is inherited from the parent Task (`task_id`) | inherited via Task | Free; recipient sees the Task they're shared on, which means they see its purchase items. The "shared purchase order" example (two members on one order) works by sharing the parent Task with `level: "edit"`. | none |
| **Note** (`Note`) | `is_shared: boolean` (a single "whole lab can read" flag) | yes (`username` field; should also be aliased as `owner` for symmetry) | Drop `is_shared`. Add `shared_with: SharedUser[]`. One-time migration: `is_shared === true` → `[{ username: "*", level: "read" }]`. Add `owner` as an alias for `username` (set it at write time; read both for compat). | medium |
| **Link** (`LabLink`) | No sharing fields. Lives in a lab-level file (`labLinks.json`) so it's already globally readable. | no (file-scoped) | Add `owner` + `shared_with`. On migration, every existing LabLink gets `shared_with: [{ username: "*", level: "edit" }]` (matches current behavior: any lab member can edit the lab links file). Going forward, "owned" links are a new concept: a member can have private links that only they see. | medium |
| **High-level Goal** (`HighLevelGoal`) | No sharing fields at all. Per-user storage. Aggregate read is `LabRoadmapsPanel` honoring a `hide_goals_from_lab` opt-out on the OWNER's user settings. | no (file-scoped; lives in user's folder) | Add `owner` (the username from the folder path) + `shared_with`. Migration: `hide_goals_from_lab === true` on the owner → `shared_with: []` (owner-only); otherwise `shared_with: [{ username: "*", level: "read" }]`. Drop `hide_goals_from_lab` after one release. | medium |
| **Mass spec protocol** (`MassSpecProtocol`) | `shared_with?: SharedUser[]` (optional) + `is_public: boolean` | yes (`owner?`) | Same as Method: field rename, `is_public` → `"*"` sentinel migration. | small |

**Out of unified primitive scope:**
- **Comments**; already inherit their parent record's sharing (a `TaskComment` is visible to anyone who can see the Task).
- **Audit-log entries** (`_pi_audit.json`); PI-only by file location; not a share-able record.
- **User settings** (`_user_settings.json`); owner-only by file location.
- **Lab roster / lab folder config**; lab-global by file location.

### 2c. Shared `<ShareDialog>` component

Replaces the current `SharePopup.tsx` (383 lines, hard-coded for `itemType: "task" | "method" | "project"`) with a generic dialog that any record type plugs into.

```tsx
// frontend/src/components/sharing/ShareDialog.tsx
interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  recordType: "task" | "note" | "project" | "method" | "link" | "goal" | "mass_spec_protocol";
  recordId: number;
  recordName: string;
  ownerUsername: string;
  currentSharedWith: SharedUser[];
  onShared: (next: SharedUser[]) => void;
}
```

UX shape:

```
┌─ Share "PCR setup for compound C-217" ─────────────────────────┐
│                                                                 │
│  Currently shared with:                                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ [Whole lab]                              [read ▼] [×]   │    │
│  │ @morgan                                  [edit ▼] [×]   │    │
│  │ @mira                                    [read ▼] [×]   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Add someone:                                                   │
│  ┌────────────────────────────────────┐ ┌───────┐ ┌──────────┐  │
│  │ @username or pick from list…       │ │ read ▼│ │  Share   │  │
│  └────────────────────────────────────┘ └───────┘ └──────────┘  │
│                                                                 │
│  Or: [+ Whole lab]    (one-click: adds {username: "*", level: "read"}) │
│                                                                 │
│                                          [Done]                 │
└─────────────────────────────────────────────────────────────────┘
```

- **Multi-select recipients.** The "Add someone" row accepts one entry at a time but the list shows everyone the record is currently shared with. Per-entry `read`/`edit` pill is a click-to-toggle.
- **"Whole lab" shortcut.** A single chip-style button that inserts `{ username: "*", level: "read" }`. Clicking again removes it.
- **Per-recipient level toggle.** Each row has a `[read ▼]` / `[edit ▼]` dropdown.
- **Archived members.** Already hidden from the picker (the existing `useArchivedUsers` hook in `SharePopup.tsx`). Existing share entries on archived users stay intact and visible in the list (with an "archived" badge), so the PI can re-archive their access if needed.
- **Owner is implicit.** The owner is never shown in the share list; they always have full edit.
- **PI is implicit.** A Lab Head viewing the dialog sees a top-row hint "Lab Head: you can see + edit this regardless of share entries." No share entry written for the PI.

Replaces the current `SharePopup.tsx` 1:1. The existing `sharingApi.shareTask` / `shareMethod` / `shareProject` calls are still the underlying write path; the dialog gains paths for `shareNote` / `shareLink` / `shareGoal` (new) and feeds everything through one component.

### 2d. SharingChips display component

A small inline display of who has access on the record itself (above the share button). New file `frontend/src/components/sharing/SharingChips.tsx`.

```
[👤 you] [⚛ Whole lab read] [@morgan edit] [@mira read]   [Share…]
```

Used on Task detail popup, Note detail popup, Project header, Method header, Link card, Goal card. Replaces the ad-hoc "X people" badges that exist in some places and the absence of any visibility hint in others.

### 2e. Read-side helpers; `canRead` / `canWrite`

New file `frontend/src/lib/sharing/unified.ts`. Two pure functions plus a small set of helpers.

```ts
// frontend/src/lib/sharing/unified.ts
import type { SharedUser } from "@/lib/types";

export interface ShareableRecord {
  owner: string;
  shared_with: SharedUser[];
}

export interface Viewer {
  username: string;
  account_type: "solo" | "lab" | "lab_head";
}

export interface EditSessionView {
  isUnlockedFor(username: string): boolean;
}

/**
 * Can this viewer see this record at all?
 *
 *   - Owner always reads.
 *   - Lab Head always reads (implicit view-all, no share entry needed).
 *   - "*" sentinel in shared_with means anyone in the lab reads.
 *   - Otherwise the viewer must be explicitly in shared_with.
 */
export function canRead(record: ShareableRecord, viewer: Viewer): boolean {
  if (record.owner === viewer.username) return true;
  if (viewer.account_type === "lab_head") return true;
  return record.shared_with.some(
    (s) => s.username === viewer.username || s.username === "*",
  );
}

/**
 * Can this viewer modify this record?
 *
 *   - Owner always writes.
 *   - Lab Head writes IFF the edit session is unlocked for the record's
 *     owner (Phase 5 passcode-gated edit-anywhere).
 *   - Otherwise the viewer must be in shared_with with level: "edit".
 *     The "*" sentinel with level: "edit" grants the whole lab edit.
 */
export function canWrite(
  record: ShareableRecord,
  viewer: Viewer,
  session: EditSessionView,
): boolean {
  if (record.owner === viewer.username) return true;
  if (viewer.account_type === "lab_head" && session.isUnlockedFor(record.owner)) {
    return true;
  }
  return record.shared_with.some(
    (s) =>
      (s.username === viewer.username || s.username === "*") && s.level === "edit",
  );
}

/** Resolve "*" to the set of current lab members (read-time expansion). */
export function expandSharedWith(
  shared_with: SharedUser[],
  allLabUsernames: string[],
  ownerUsername: string,
): { username: string; level: "read" | "edit" }[] {
  const expanded: Record<string, "read" | "edit"> = {};
  for (const entry of shared_with) {
    if (entry.username === "*") {
      for (const u of allLabUsernames) {
        if (u === ownerUsername) continue;
        // Highest level wins if "*" and an explicit entry both set this user.
        if (expanded[u] !== "edit") expanded[u] = entry.level;
      }
    } else {
      if (expanded[entry.username] !== "edit") {
        expanded[entry.username] = entry.level;
      }
    }
  }
  return Object.entries(expanded).map(([username, level]) => ({ username, level }));
}
```

The functions take their inputs explicitly (no global state) so they're trivially testable.

### 2f. Lab Head bypass; Implementation Notes

Phase 5 of the Lab Head proposal already plumbs owner-scoped writes for three record types via dedicated wrapper modules:

- `frontend/src/lib/tasks/owner-scoped-api.ts`
- `frontend/src/lib/notes/owner-scoped-api.ts`
- `frontend/src/lib/purchases/owner-scoped-api.ts`

Each one routes a write through the target user's folder if the current viewer is a Lab Head AND `isUnlockedFor(targetOwner) === true`. This is exactly the `canWrite(record, viewer, session)` rule above.

The unified sharing R1 extends these wrappers to the remaining record types; methods, lists (already a Task, free), links, goals, projects, mass spec protocols; OR refactors all wrappers into a single owner-scoped layer (`frontend/src/lib/owner-scoped/index.ts`) parameterized by store. Recommendation: **refactor**, on the grounds that five hand-rolled wrappers are five places to drift. The refactor is in R1's scope.

Implementation sketch:

```ts
// frontend/src/lib/owner-scoped/index.ts (new)
export function createOwnerScopedApi<T extends ShareableRecord>(
  store: JsonStore<T>,
  recordKind: "task" | "note" | "purchase" | "method" | "link" | "goal" | "project",
) {
  return {
    update: async (ownerUsername: string, id: number, patch: Partial<T>) => {
      const viewer = getCurrentViewer();
      const record = await store.get(ownerUsername, id);
      if (!record) throw new Error(`${recordKind} ${id} not found for ${ownerUsername}`);
      const allowed = canWrite(record, viewer, editSession);
      if (!allowed) throw new Error("not authorized");
      await store.update(ownerUsername, id, patch);
      if (viewer.account_type === "lab_head" && viewer.username !== ownerUsername) {
        await appendPiAudit(viewer.username, ownerUsername, recordKind, id, patch);
      }
    },
    // create / delete / share follow the same shape
  };
}
```

The PI audit log writes are reused from the existing `frontend/src/lib/lab/pi-audit.ts`.

### 2g. Migration shape

One-time migration on app boot (or on `users/<u>/sidecar.ts` schema version bump):

```ts
// frontend/src/lib/sharing/migrate-unified.ts (new)
export async function migrateToUnifiedSharing(username: string): Promise<void> {
  // Tasks: rename permission → level, rewrite "view" → "read".
  // Projects: same.
  // Methods: same + is_public → "*" sentinel entry (keep is_public on read for one release).
  // Notes: is_shared === true → [{ username: "*", level: "read" }]; drop is_shared.
  // Links: every existing labLinks.json entry gets shared_with: [{ username: "*", level: "edit" }]
  //   (matches the current "anyone can edit the file" reality).
  // Goals: hide_goals_from_lab === true → shared_with: []; else [{ username: "*", level: "read" }].
  // Mass spec protocols: same as methods.
  //
  // Idempotent: each migration checks for the unified shape before rewriting.
  // Failure tolerance: per-record try/catch + console.warn on any record that
  // can't be normalized; the migration moves on. The user can re-run from
  // Settings → Lab → "Re-run migration" if needed.
}
```

Sidecar schema bump to `SCHEMA_VERSION: 5` (or whatever the next slot is after Lab Head's bump). Migration is one-way; no rollback.

### 2h. Backward compatibility

- Old records (read before migration runs, or imported from an old backup) without `shared_with` default to `[]` on the read path. The `canRead` / `canWrite` helpers handle this transparently.
- Old records with the old `SharedUser` shape (`permission: "view" | "edit"`) are accepted on the read path with a normalize-on-read pass. The on-disk file gets rewritten with the new shape next time it's saved.
- The `"*"` sentinel is the only "magic" username. Migration validates that no real user has `username: "*"` (impossible in practice since `"*"` would be rejected by usernameRegex at sign-up, but the migration still checks and aborts on the assertion).

### 2i. Why this beats the v1 per-page toggle

v1's "Show all lab" toggle was a UI affordance over the existing per-user data path; it didn't change what was shared, just what was rendered. That works for read-only browsing but breaks down for the actually interesting cases; Grant's "shared purchase order, two members add to it together" example needs **edit** rights flowing across users, which the toggle can't grant. A toggle is a viewer-side preference; sharing is a record-side fact.

The unified primitive replaces the toggle pattern wholesale: if you want to see your labmate's experiment, they share it with you (or with the whole lab), and it's in your `/experiments` page the next time you load. No toggle, no mode switch, no separate identity. Lab Head sees everything by role, with edit gated by the passcode session.

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

**Edit mode toggle:** drag/resize handles only appear when the user clicks "Edit layout" in the page toolbar. Default state is view-only; no accidental rearranging on a normal session. This matches the dashboard-builder convention used in Grafana, Notion gallery views, etc.

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
| **Pending purchase approvals** | filter on `approved === undefined \|\| null` across all members | 6w × 3h | lab_head only |
| **Flag-for-review queue** | open `flagged` notifications across tasks / notes / purchases | 4w × 3h | lab_head only |
| **Audit-log digest** | recent `_pi_audit.json` entries (last 7 days) | 6w × 3h | lab_head only |
| **Member workload heat-map** | tasks-due-this-week per member, colour-coded | 6w × 3h | lab_head only |
| **Lab roster** | port of `LabRoster` from Settings (archive / restore + status) | 6w × 4h | lab_head editable, members read-only |
| **Todo for me** | tasks shared to current user with `level: "edit"`, plus open flags on the current user's records, plus PI-assigned tasks | 4w × 4h | all lab members |

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

**Versioning:** `version: 1` on the layout object. When the widget catalog gets new widgets in later phases, we bump to `version: 2` and write a migration that appends the new widgets at the bottom in their default positions. Unknown widget IDs (e.g. a widget that got renamed) are silently dropped on read with a console warning. No destructive migration; the user's existing custom positions for known widgets are preserved.

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

**Drag behaviour:** drag handle is the widget header (the title bar). The widget body is not draggable; clicks inside the body (e.g. clicking a comment to open it) work as expected.

### 3e. Member view (read-only widget set)

Per Phase 3 visibility (Grant 2026-05-23):
- Members see: Announcements, Comment feed, Activity feed, Todo for me, Recent shares. No metrics widgets, no Lab Roster edit controls (they see the roster widget read-only).
- Members can drag / resize / remove widgets from their own canvas. They cannot add widgets that are PI-only (the catalog filters those out).
- Layout persists per-member same as PI.

**Why give members the widget UI at all?** Because the announcement / comment / activity layout is theirs to customize, and there is no reason a member who never looks at announcements shouldn't be able to bury that widget. The cost is essentially zero (same library, same persistence).

### 3f. Mobile / narrow-viewport fallback

`react-grid-layout` exposes a `breakpoints` config. On `xs` (<480 wide) we collapse to single column, drag is disabled (touch-and-drag for grid items on mobile is universally bad), and the "Edit layout" button is hidden. Reset layout still works. Widget order on mobile is the persisted `y` order from the `lg` layout; no separate mobile layout.

Phase R3 estimate: 1-2 days of mobile polish on top of the desktop framework.

### 3g. Customizable left sidebar for Lab Heads (R2 extension, Grant 2026-05-23)

The same widget primitive that powers the Lab Overview canvas also powers a customizable left sidebar — different surface, identical mechanism. Rationale: the default sidebar today is task-centric (Overdue / Today / Upcoming), which presumes the viewer is running their own experiments. PIs typically oversee rather than run, so a one-size-fits-all sidebar mis-serves them.

**Sidebar widget catalog (PI-oriented, additive to the existing task widgets):**

- **Recent lab activity** — newest comments, shares, task creations across the lab. Compact 6-row feed.
- **Pending lab head actions** — purchase approvals waiting, records flagged for review, audit entries to acknowledge. Counts + jump links.
- **Member workload at-a-glance** — each member's open-task count + overdue count, sorted by overdue desc. 1-line per member.
- **Lab metric snapshot** — single key stat (total open tasks across lab, this-week's spending, etc.) with mini-trend sparkline.
- **Today's announcements** — pinned announcements from the announcements widget, condensed to titles only.

**Persistence model:** sidebar layout lives in the SAME `lab_overview_layout` blob on `_user_settings.json` — just under a `sidebar` key alongside the main `canvas` key. Same migration helper, same version field, same unknown-widget drop rule.

**Edit affordance:** "Edit sidebar" mode toggle on the sidebar itself (small gear or Edit pill). When active, sidebar widgets become drag-handles in vertical order + show/hide checkboxes. No horizontal grid — sidebar is single-column always.

**Default sidebar for lab heads:** Recent lab activity (top) → Pending lab head actions → Member workload → Today's announcements. The existing Overdue / Today / Upcoming task widgets remain available in the catalog (toggle-on) for PIs who still run their own experiments.

**Default sidebar for members (account_type === "member"):** unchanged from today. Members get the same "Edit sidebar" affordance to reorder / show-hide / add a "Recent lab activity" widget if they want one, but the default stays the current Overdue / Today / Upcoming.

**Scope estimate:** +1-2 days on top of R2's main-canvas framework. The widget primitive is shared; only the layout-engine wrapper differs (react-grid-layout for the canvas, a simple vertical react-beautiful-dnd or framer-motion-reorder for the sidebar).

---

## 4. PI Walkthrough Replacement

### 4a. New walkthrough beats (5-8 steps)

Target: 6 steps, half the count of the existing Lab Mode tour (12 steps + the Prompt + the WarpToDemo + the Exit = 15 effective beats).

1. **Lab Overview intro**; "This is your Lab Overview. The PI command center. Everything cross-lab lives here." Target: the page heading on `/lab-overview`.
2. **Announcements widget**; "Drop a message that everyone in the lab sees on their own Lab Overview. The composer is yours." Target: the Announcements widget.
3. **Comment feed widget**; "Every comment your team posts across every record lands here. Click any to open the source record in place." Target: a comment row in the Comment feed widget.
4. **Edit layout demo**; "Click Edit layout. Drag widgets around. Resize handles on the corners. Add new widgets from the + button. Your layout is yours; your team has their own." Target: the Edit layout button.
5. **Share a record**; "Every record you can share has a Share button. Share with @one teammate, or click 'Whole lab' to share with everyone. As Lab Head you see everything regardless." Target: the Share button on a demo experiment task.
6. **Done**; "Lab Overview for the dashboard. Sharing for cross-user work. No mode switch." Optional outro / BeakerBot wave.

### 4b. Tour integration

This replaces the entire `steps/lab-mode/` subtree (12 step modules + their tests + the cluster test + the LabModeViewer overlay + the LabModeMount window-event host). Net file delta:
- Delete 12 step files + 12 test files + `LabModeCluster.test.tsx`.
- Delete `DemoLabModeViewer.tsx` (649 lines) + `DemoLabModeMount.tsx` (90 lines) + `DemoLabModeViewer.test.tsx` + `DemoLabModeViewer.demoData.test.tsx`.
- Delete `DemoLabBanner.tsx` (176 lines).
- Add ~6 new step files under `steps/lab-overview/` + 6 tests + 1 cluster test.

Net: ~2000 lines removed, ~600 lines added. Substantial code-debt reduction.

The new cluster gates on `picks.account_type === "lab_head"`. For ordinary lab members the tour skips this cluster entirely; they don't need a tour of widgets they'll see naturally on Lab Overview, and the sharing flow is taught one beat at a time in the per-record tours (the "share your first experiment" beat in the experiments cluster, etc).

---

## 5. Phasing Plan

### Phase R1; Unified sharing primitive (large); FOUNDATIONAL, lands first

Everything else depends on this. Sharing must work for tasks / notes / lists / methods / links / goals / projects before the `/lab` route can be retired (otherwise members lose visibility into shared work).

Deliverables:
- New `frontend/src/lib/sharing/unified.ts`; `SharedUser`, `canRead`, `canWrite`, `expandSharedWith`.
- New `frontend/src/lib/sharing/migrate-unified.ts`; one-time field migration for every record type.
- Update `frontend/src/lib/types.ts`; rename `permission` → `level`, normalize across record types, add `shared_with` + `owner` to Note / Link / Goal / Mass spec protocol.
- New `frontend/src/components/sharing/ShareDialog.tsx`; replaces `SharePopup.tsx`.
- New `frontend/src/components/sharing/SharingChips.tsx`; visibility-hint display.
- Refactor `frontend/src/lib/{tasks,notes,purchases}/owner-scoped-api.ts` into a single `frontend/src/lib/owner-scoped/index.ts` parameterized by store; extend to methods / links / goals / projects.
- New sharing API entries in `local-api.ts`: `shareNote`, `shareLink`, `shareGoal` (paralleling existing `shareTask` / `shareMethod` / `shareProject`).
- Sidecar schema bump (whatever the next slot is after Lab Head's bump).
- Tests: per-record migration round-trip; `canRead` / `canWrite` truth-table; `"*"` sentinel expansion; PI bypass with edit-session locked vs unlocked.

Dependent files: `lib/types.ts`, `lib/local-api.ts`, the three owner-scoped wrappers + the new unified one, the new sharing dir, `components/SharePopup.tsx` (deleted), `frontend/src/lib/onboarding/sidecar.ts` (schema bump).

Scope: **large.** Touches every record type's store + read path. The migration is the highest-risk piece; ship it behind a flag if needed and force-run on next app open after Lab Head Phase 5 has stabilized.

### Phase R2; Lab Overview widget framework (medium)

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

### Phase R3; widget catalog (large)

Deliverables: 9 new widgets, each a thin wrapper around an existing component or a new feed-style component:
- Activity feed (port `LabActivityPanel`)
- Member spotlight (port `LabUserDetailPanel`)
- Recent shares (new; reads from the unified `shared_with` primitive)
- Pending purchase approvals (filter on existing data)
- Flag-for-review queue (filter on existing notifications)
- Audit-log digest (last 7d from `_pi_audit.json`)
- Member workload heat-map (new)
- Lab roster (port from Settings; see also OQ "Lab Roster surface"; dual-mount in Settings + widget)
- Todo for me (new, filters existing tasks + flags + shared `level: "edit"` records)

Plus the "+ Add widget" drawer fully populated, mobile fallback polish, member vs lab_head visibility filtering on the catalog.

Dependent files: ~10 new widget files under `components/lab-overview/widgets/`, the catalog config, the drawer.

Scope: **large** (lots of small components, each with its own test; visibility filtering needs care).

### Phase R4; tour rip + new PI walkthrough (medium)

Deliverables:
- Delete `steps/lab-mode/` directory entirely (12 step files + 12 tests + cluster test).
- Delete `DemoLabModeViewer.tsx`, `DemoLabModeMount.tsx`, both test files.
- Delete `DemoLabBanner.tsx`.
- Remove step-registry imports + entries (lines 67-80 + 369-380 of `step-registry.ts`).
- Add new `steps/lab-overview/` with 6 step files + tests + cluster test.
- Update the Welcome Wizard wiki page (`wiki/getting-started/welcome-wizard/page.tsx`) to describe the Lab Overview tour + sharing flow instead of the Lab Mode warp-to-demo flow.

Dependent files: `step-registry.ts`, `V4MountForUser.tsx` (removes the `<DemoLabModeMount>` host), `wiki/getting-started/welcome-wizard/page.tsx`, all the tour fixtures referencing lab-mode step IDs.

Scope: **medium** (mostly deletion + 6 new mechanical steps).

### Phase R5; Lab Mode pseudo-account + login picker + `/lab` route deletion (medium)

The cleanup. Can only land AFTER R1 (sharing primitive) is in place; otherwise members lose cross-user visibility.

Deliverables:
- Delete `frontend/src/app/lab/page.tsx`.
- Delete `LabActivityPanel.tsx`, `LabExperimentsPanel.tsx`, `LabSearchPanel.tsx`, `LabPurchasesPanel.tsx`, `LabGanttChart.tsx`, `LabMethodsPanel.tsx`, `LabRoadmapsPanel.tsx`, `LabUserFilterButton.tsx`, `LabUserDetailPanel.tsx`. (Note: some survive AS widget bodies if Phase R3 already ported them; the standalone files go either way.)
- Delete the `"Lab Mode"` button on `UserLoginScreen.tsx` (lines 830-845) + `handleLabModeLogin` (lines 235-243) + all `users.filter(u => u !== "lab")` calls (lines 135, 435-436, 450, 467, 807, 1017).
- Remove `currentUser === "lab"` redirect logic from `app/page.tsx` (lines 84-100, 355-372).
- Remove `"lab"` from `labApi.getUsers` filter list at `local-api.ts:4753`.
- Remove the `"lab"` guards at `local-api.ts:1403, 3122` (no actor can be `"lab"` anymore so the guards are dead).
- Test sweep: any test that references the `lab` user, the `/lab` route, or the Lab\* panels gets deleted or rewritten.

Dependent files: see audit section 1d for the full reference list.

Scope: **medium** (mechanical deletion across many files, but each file edit is small).

### Phase R6; wiki rewrite + Settings "Lab" tab rename (small)

Deliverables:
- Delete `wiki/features/lab-mode/page.tsx` and subdirs (activity / gantt / purchases / user-filter / cross-user-lists).
- New `wiki/features/lab-overview/page.tsx` describing the widget framework.
- New `wiki/features/lab-overview/widgets/` sub-pages for each widget (announcements, comment feed, metrics, activity, roster, etc.).
- New `wiki/features/sharing/page.tsx` describing the unified primitive: how to share a record, what "Whole lab" means, what the recipient sees, what Lab Head sees.
- Update `wiki/shared-lab-accounts/page.tsx` to reflect that the shared `lab` account is no longer a thing.
- Update the navigation in `lib/wiki/nav.ts` to drop Lab Mode entries and add Lab Overview + Sharing entries.
- **Rename Settings tab "Lab Mode" → "Lab" (or "Lab Settings").** Coordinate with the Settings tabs reorg chip (`a96ef211`) author so the rename lands in their PR, not separately. The tab's content does NOT change; just the label.

Dependent files: ~10 wiki page files, `lib/wiki/nav.ts`, `app/settings/page.tsx` (one-line copy change).

Scope: **small** (writing time, not engineering risk; all wiki pages are self-contained).

---

## 6. Edge Cases and Open Questions

### Closed in this revision (Grant 2026-05-23 answers)

- **Lab Roster surface:** dual-mount. Settings keeps its Lab Roster (under the renamed "Lab" tab); Lab Overview adds a Lab Roster widget. Shared component, two wrappers.
- **Settings tab name:** "Lab Mode" tab → "Lab" or "Lab Settings." Phase R6.
- **Links page in sharing scope:** YES; `LabLink` gets `owner` + `shared_with`, migration writes `[{ username: "*", level: "edit" }]` for every existing link (matching today's behavior).
- **Per-page "Show all lab" toggle vs unified sharing primitive:** unified sharing primitive. The toggle approach (v1) is dropped.

### Permission practice during the tour

The current tour includes `LabPermissionPracticeStep.tsx` (under `steps/lab/`; `steps/lab/` is the lab _setup_ cluster from Q1a, not the lab _mode_ cluster). This step does NOT depend on `/lab`; it depends on the lab _folder_ permission model. It survives Lab Mode retirement untouched.

Same with `LabPromptStep.tsx`, `LabAutoCleanupStep.tsx`, `LabSpawnBeakerBotStep.tsx` under `steps/lab/`. All lab-folder-setup steps, all survive.

### Saved widget layouts during catalog churn

Already handled in section 3c (version field + unknown-widget drop on read + new-widget append-at-bottom migration). The only risk is if Grant later wants to **rename** a widget ID; the migration would need a `renames: { "old-id": "new-id" }` map. Phase R3 adds this preemptively to the migration helper.

### Does deleting the `lab` pseudo-user break demo flow?

The demo (`?demo=alex` or similar) already runs as alex / morgan / mira. The `lab` pseudo-user is a separate, in-app concept; the login-picker button. They never overlapped. Verified:
- `frontend/src/lib/demo/lab-demo-data.ts` seeds alex / morgan / mira data, never references the `lab` username.
- `DemoLabModeViewer.tsx` is the tour overlay, not a demo entry point.
- `frontend/src/app/demo/[[...slug]]/` is the demo route; not affected by `/lab` deletion.

Conclusion: demo flow is unaffected by R5.

### External integrations or wiki links pointing to `/lab/*`

Internal-only audit:
- Top-nav links to `/lab` from `AppShell` for lab workspaces; gone in R5.
- Wiki pages under `wiki/features/lab-mode/*` link to `/lab` for "Try it now"; rewritten in R6.
- `SpendingDashboard.tsx` has a "View in Lab Mode →" link that deep-links to `/lab?tab=purchases`; rewrite to point at `/purchases` directly. Since the recipient now sees shared purchase items in their own `/purchases` page, no special filter parameter is needed.

No external integrations (the app is local-first; there are no external bookmarks to /lab that the team has shipped to customers).

### URL deep links into `/lab?tab=foo`

A one-line `next.config.js` redirect from `/lab/*` → `/lab-overview` covers any stray bookmarks for one release cycle, then drops.

### What if a lab has zero lab heads?

A lab with only `member` accounts (no `lab_head`) lands on Lab Overview anyway because the route is for all lab members. They see the member-default layout (Announcements + Comment feed + Activity feed). No PI-only widgets are in their catalog. The page is still useful as a comment / activity hub even without a PI.

Cross-user visibility still works; members share records with each other directly via the unified sharing primitive. The PI's implicit view-all is irrelevant in a labs-without-PI configuration.

### Open questions from the unified-sharing audit — resolved (Grant 2026-05-23 R2)

- **`is_public` on Method and Mass spec protocol:** DROP IN R1 IMMEDIATELY. Pure shape, no legacy field. Migration writes `shared_with: [{ username: "*", level: "read" }]` for any `is_public === true` record and removes the boolean in the same pass. Any external code reading `is_public` breaks at R1 — verified that internal callers all live in the same diff.
- **`hide_goals_from_lab` opt-out:** PER-GOAL GRANULARITY. The migration honors the old per-user setting by writing `shared_with: []` on every existing goal IFF the user had `hide_goals_from_lab === true`. Going forward each goal has its own `shared_with` entry; users can mix shared + private goals freely. The old user-settings boolean is dropped at R1.
- **Project share cascade:** NO AUTO-CASCADE + EXPLICIT CHECKBOX. Sharing a project shares the project metadata only. The `<ShareDialog>` for projects offers a checkbox "Also share all tasks in this project" that does the explicit fan-out on confirm. Future child tasks added to the project are NOT auto-shared.
- **Methods referenced by a shared task but not themselves shared:** AUTO-GRANT TRANSIENT `level: "read"` WITH AUDIT ENTRY. Depth-1 only (no recursion into compound method components). The audit log records the implicit grant so a PI viewing the audit trail can see which methods leaked into shared scope.

All four are locked. Ready for R1 implementation dispatch.

---

## 7. File Inventory (Delete / Rename / Move / Add)

### Add (R1)

- `frontend/src/lib/sharing/unified.ts`; `SharedUser`, `canRead`, `canWrite`, `expandSharedWith`, helpers.
- `frontend/src/lib/sharing/migrate-unified.ts`; one-time per-record-type migration.
- `frontend/src/lib/owner-scoped/index.ts`; refactor target for the three existing wrappers + new record types.
- `frontend/src/components/sharing/ShareDialog.tsx`; replaces `SharePopup.tsx`.
- `frontend/src/components/sharing/SharingChips.tsx`; visibility-hint display chip row.

### Delete (R1)

- `frontend/src/components/SharePopup.tsx` (383 lines); replaced by `ShareDialog.tsx`.

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

Estimated R5 delete: ~6500 lines of code.

### Rename (R2 / depends on chip a199aa6b)

- `frontend/src/app/lab-inbox/` → `frontend/src/app/lab-overview/`
- `frontend/src/components/lab-inbox/LabInboxAnnouncements.tsx` → `frontend/src/components/lab-overview/widgets/AnnouncementsWidget.tsx`
- `frontend/src/components/lab-inbox/LabInboxComments.tsx` → `frontend/src/components/lab-overview/widgets/CommentFeedWidget.tsx`
- `frontend/src/components/lab-inbox/LabInboxMetrics.tsx` → `frontend/src/components/lab-overview/widgets/MetricsWidget.tsx`

### Move (R3)

- `frontend/src/components/lab-head/LabRoster.tsx` → `frontend/src/components/lab-overview/widgets/LabRosterWidget.tsx` (Settings retains a thin wrapper that mounts the same widget body inline; dual-mount per Grant's OQ answer).

### Move (R6; wiki)

- `wiki/features/lab-mode/page.tsx` → delete + redirect to `wiki/features/lab-overview/page.tsx` (new content).
- `wiki/features/lab-mode/{activity,gantt,purchases,user-filter,cross-user-lists}/page.tsx` → delete; consolidated into Lab Overview widget docs.
- Add new `wiki/features/sharing/page.tsx` covering the unified primitive.

### Per-record-type field migrations (R1)

The fields are not files, but they're load-bearing migrations:

- `Task.shared_with[].permission` → `level`. "view" → "read".
- `Project.shared_with[].permission` → `level`. "view" → "read".
- `Method.shared_with[].permission` → `level`. `is_public: true` → push `{ username: "*", level: "read" }` into `shared_with`. Keep `is_public` for one release as a derived read-only flag.
- `MassSpecProtocol.shared_with[].permission` → `level`. `is_public` migration same as Method.
- `Note.is_shared: true` → `shared_with: [{ username: "*", level: "read" }]`. Drop `is_shared` after one release.
- `LabLink`; new `owner` (lab folder owner / first writer) + `shared_with: [{ username: "*", level: "edit" }]` initial value.
- `HighLevelGoal`; new `owner` (from folder path) + migrate `hide_goals_from_lab` user-setting to per-goal `shared_with: []` for the user's goals.

Estimated add (Phase R1): ~1200 new lines (helpers + dialog + chips + owner-scoped refactor + migrations + tests).
Estimated add (Phase R3): ~600 new lines of step / widget code.
Estimated add (Phase R6): ~1500 lines of wiki content.

---

## 8. Out of Scope (Explicit)

The following are explicitly excluded:

- **A separate cross-lab view for multi-lab users.** ResearchOS is single-lab. No multi-lab dashboard.
- **Real-time collaborative widget editing.** The widget grid is single-user (each lab member edits their own canvas). No "PI drags widget, member's screen rearranges live."
- **Widget code published as a public API for third-party widgets.** The widget catalog is in-app only. No plugin system, no widget marketplace.
- **A per-page "Show all lab" toggle (v1's R1).** Superseded by the unified sharing primitive. Access is a record-side fact, not a viewer-side preference.
- **Widget data refresh policies / WebSocket subscriptions.** Widgets read from disk on mount and on focus; same pattern as the rest of the app. No real-time sync.
- **A migration period where both `/lab` and `/lab-overview` coexist.** Phase R5 cuts `/lab` entirely. The Lab Overview replaces it on the same release. The one concession is a 1-release-cycle redirect from `/lab/*` → `/lab-overview` for stale bookmarks.
- **Re-introducing a "View as <member>" impersonation mode.** Lab Mode's read-only-view-of-someone-else flavour is gone for good. The Lab Head edit-mode session (Phase 5 of the Lab Head proposal) is the supported path for cross-owner read/write; the unified sharing primitive is the supported path for ordinary members.
- **Multi-user share-target picker in one click.** `<ShareDialog>` adds recipients one at a time (plus the "Whole lab" shortcut). A multi-select picker can ship later if Grant asks; not in R1.
- **Group-share entities (a "team" / "subgroup" within a lab).** Only individual users + `"*"` sentinel for now. Subgroups can ride on top later by adding a `group:<id>` sentinel; the dialog would need a row type for it.

---

*; lab mode retirement proposal R1 author, 2026-05-23*
