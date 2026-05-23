# Lab Head Account Type — Design Proposal

**Author:** lab head proposal author
**Date:** 2026-05-23
**Status:** Pre-implementation. No code yet.

---

## Background

ResearchOS today has two account types: solo and lab. Lab mode is intentionally read-only for all members to prevent accidental cross-user data loss. This proposal layers a third account type on top: a lab head (PI) who still lives inside the shared lab folder, still runs their own experiments, but gains a small set of additional surfaces and actions. The design preserves the read-only invariant for ordinary lab members while giving the PI just enough reach to manage the lab without needing filesystem-level access to member folders.

---

## 1. Naming

### Account type token (internal)

Recommended: `"lab_head"`.

Rationale: clear, grep-friendly, parallel to the existing `"solo"` / `"lab"` tokens. Avoids abbreviations that could age poorly ("PI" is US-centric; "admin" implies permissions that go further than intended).

Alternative considered: `"lab_admin"` — rejected because it implies the same capabilities as a system admin, which this role is not.

### Q1 setup option copy

Three cards on the Q1 screen:

| Card | Headline | Sub-copy |
|------|----------|----------|
| Solo | **Just me** | "I work independently. No shared folder." |
| Lab member | **Part of a lab** | "I'm on a team. We share a lab folder." |
| **Lab head (new)** | **I run the lab** | "I'm the PI or lab manager. I get a Lab Inbox on top of my own workspace." |

The third option only appears after the user picks the lab storage step (Q1a), because lab head requires a shared folder. Concretely: Q1 shows all three cards; picking "I run the lab" routes through the same Q1a storage flow as "Part of a lab," then sets `account_type: "lab_head"` on completion.

### Profile / overview surface names

Recommended: **Lab Inbox** for the primary PI surface (the panel that aggregates cross-lab actions and feeds).

Rationale: "Inbox" communicates that things arrive here requiring the PI's attention, unlike "Dashboard" (passive metrics) or "Overview" (ambiguous). The inbox pattern is well-understood in professional tools.

Secondary surface names:
- **Lab Overview** (read-only cross-lab metrics tab within lab mode)
- **PI Dashboard** (considered but rejected: too vague, and "dashboard" has become meaningless)
- The profile page section: "Lab Inbox" as the tab label, surfaced when `account_type === "lab_head"`

---

## 2. Data Shape Changes

### 2a. Account type on the onboarding sidecar

`FeaturePicks.account_type` in `frontend/src/lib/onboarding/sidecar.ts` currently accepts `"solo" | "lab"`. Add `"lab_head"`:

```ts
account_type: "solo" | "lab" | "lab_head";
```

The `ACCOUNT_TYPES` validation set (line 285 of sidecar.ts) gains the new string. All downstream `account_type === "lab"` guards should be updated to `account_type === "lab" || account_type === "lab_head"` where the behavior should apply equally (e.g., lab storage prompt, lab tour), and left as `account_type === "lab"` only where ordinary-member behavior is intentional.

This is a sidecar schema bump: increment `SCHEMA_VERSION` to 5 and add a migration note. Existing v4 records normalize forward with `feature_picks = null` as usual; lab-head-specific UI only activates once the wizard has run and produced a v5 `feature_picks` object.

### 2b. Comment storage

Comments today live inline on their parent record. `Task.comments?: TaskComment[]` and `Note.comments?: NoteComment[]` are already in `types.ts`. The `NoteComment` / `TaskComment` shapes are:

```ts
{ id: string; author: string; text: string; created_at: string; }
```

**Recommended approach for Phase 1:** keep comments inline on the parent record (no new file). This is already what the demo PI fleshout seeds.

**Phase 2 additions** (threading, @mentions):

Extend `TaskComment` / `NoteComment` to:

```ts
{
  id: string;
  author: string;
  text: string;
  created_at: string;
  // Phase 2 additions — optional for backward compat:
  parent_id?: string | null;       // threading: reply-to comment id
  mentions?: string[];             // @mentioned usernames
  source_surface?: string | null;  // "gantt" | "purchases" | "experiment" | null
}
```

Storage location stays inline on the parent record. A comment thread is rarely more than 5-10 entries in a research lab; a separate file per-record adds FS overhead without meaningful benefit at this scale.

### 2c. Audit log

The session-scoped edit mode (Phase 5) requires an audit trail. Recommended shape:

**One audit log per user folder, at `users/<username>/_pi_audit.json`.**

Rationale: a global audit log at the lab root would require the PI to have write access to a single shared path, which creates a cross-user write race. Per-user audit logs keep each record in the folder it describes and are naturally consistent with the existing per-user file convention.

Schema:

```json
{
  "version": 1,
  "entries": [
    {
      "id": "uuid",
      "edited_by": "pi_username",
      "record_type": "task" | "note" | "purchase_item" | ...,
      "record_id": "string or number",
      "field": "name",
      "old_value": "...",
      "new_value": "...",
      "edited_at": "ISO8601",
      "session_id": "uuid"  // ties all edits in one 5-min window together
    }
  ]
}
```

Append-only. The PI's own session writes to the target user's `_pi_audit.json`. Because the PI already has write access to the shared lab folder (that is what lab mode provides), this does not require a new permission model.

Visibility: the record owner can see audit entries that touch their records. The PI can see all entries they themselves created. Neither can delete audit entries.

### 2d. Lab-head password

The lab-head password gates the edit-mode session unlock (Phase 5). Two options:

**Option A (recommended): Separate password, PBKDF2-hashed, stored at `users/<pi_username>/_lab_head_auth.json`.**

```json
{ "version": 1, "hash": "<pbkdf2-hash>", "created_at": "ISO8601" }
```

Rationale: separating the account password from the edit-gate password means a compromised session cookie / account password does not automatically unlock edit mode on every lab member's data. The extra friction is the point. The PI sets this once in Settings under a new "Lab Head" section.

**Option B: Reuse account password.** Simpler, but removes the friction that makes attribution meaningful. Not recommended because the edit-mode safeguard is only meaningful if it requires a deliberate act distinct from "being logged in."

PBKDF2 is the existing password hashing approach in the codebase (see `AccountPasswordPopup.tsx`); mirror that convention.

Reset path: via a dedicated "Forgot lab-head password" flow in Settings that requires the account password first, then allows setting a new lab-head password. No email reset (local-first app; no server).

### 2e. Notification storage

New notification types are needed for Phase 3 (flag-for-review, task assignment, purchase approval) and Phase 2 (comment on your work). Recommended: extend the existing `Notification` discriminated union in `types.ts` with new subtypes:

```ts
interface PiFlagNotification {
  id: string;
  type: "pi_flag_review";
  from_user: string;        // PI's username
  record_type: "task" | "note" | "experiment";
  record_id: string;
  message: string | null;   // optional PI note
  created_at: string;
  read: boolean;
}

interface TaskAssignedNotification {
  id: string;
  type: "task_assigned";
  from_user: string;        // PI's username
  task_id: number;
  task_name: string;
  created_at: string;
  read: boolean;
}

interface PurchaseApprovedNotification {
  id: string;
  type: "purchase_approved";
  from_user: string;
  purchase_item_id: number;
  item_name: string;
  created_at: string;
  read: boolean;
}

interface CommentMentionNotification {
  id: string;
  type: "comment_mention";
  from_user: string;
  record_type: "task" | "note";
  record_id: string;
  comment_id: string;
  created_at: string;
  read: boolean;
}
```

Storage: the existing notification storage pattern (per-user sidecar files, polled on load). The receiving user's notification file is written by the sender (PI or commenter) the same way `_shifted-alerts.json` works today: the PI writes to the target user's notification file in the shared lab folder.

### 2f. PI-pinned announcements

Announcements are a PI-only write. Storage at the lab root: `_announcements.json`.

```json
{
  "version": 1,
  "announcements": [
    {
      "id": "uuid",
      "author": "pi_username",
      "text": "...",
      "created_at": "ISO8601",
      "pinned": true
    }
  ]
}
```

This is a shared file all lab members can read. Only the PI can write it (enforced by UI; local-first means no server enforcement, but attribution is the safeguard). Shown on every lab member's Home page while `pinned: true`.

### 2g. Purchase approval flag

Extend `PurchaseItem` (currently in `types.ts` line 1234) with optional fields:

```ts
pi_approved?: boolean | null;          // null = pending, true = approved, false = rejected
pi_approved_by?: string | null;        // PI username
pi_approved_at?: string | null;        // ISO8601
```

These are optional for backward compat. Existing records without the field behave as if `pi_approved = null`.

### 2h. Task assignment

Extend `Task` with:

```ts
assigned_by?: string | null;           // PI username if PI created/assigned this task
assigned_at?: string | null;           // ISO8601
```

Optional, backward compat. A task in another member's folder with `assigned_by` set renders with a small "assigned by PI" badge.

---

## 3. UX Surfaces

### 3a. Q1 Setup: "I run the lab" option

The three Q1 cards are arranged horizontally (or stacked on mobile). The "I run the lab" card appears third, after the existing two. Visually it can carry a small crown or star icon to signal elevated role. Selecting it routes to the same Q1a storage step as "Part of a lab," then on to Q2-Q6 as normal.

After the wizard completes, the Lab Inbox tab appears in the lab mode navigation alongside the existing tabs (Activity, Gantt, Experiments, Purchases, Roadmaps, Methods, Notes, Search).

### 3b. Lab Inbox layout (PI profile page)

The Lab Inbox is a new tab in lab mode, visible only to users whose `account_type === "lab_head"`. It has four sections:

**1. Pinned Announcements (top)**
A text area to compose or edit a pinned announcement. Currently-pinned text shows below the composer. One pinned announcement at a time (simplest for Phase 3).

**2. Action queue (middle)**
A feed of items requiring PI attention, newest first:
- Purchase approvals pending (each row: item name, member, funding string, amount, Approve / Reject buttons)
- Flag-for-review items (each row: record name, member, optional note, Mark as reviewed button)
- Task assignment confirmations (informational, no action needed after send)

**3. Recent lab activity (bottom)**
A condensed version of the existing lab Activity panel, filtered to show only events from the last 7 days.

**4. Lab Overview tab (sibling tab, read-only)**
A separate tab next to Lab Inbox showing the cross-lab metrics (Phase 4): combined Gantt overlay, funding rollup, roadmap aggregation.

### 3c. Read-only to edit-mode flow

The flow applies to any lab-mode record the PI views that belongs to another member:

1. PI views a lab member's record (task, note, purchase item) in read-only mode. A subtle "Request edit" button appears in the record header (icon + text, with a Tooltip).
2. PI clicks "Request edit." A modal appears: "You are about to enter edit mode for [member]'s [record]. All changes will be attributed to you with a timestamp. Enter your lab-head password to continue."
3. PI types lab-head password. On success: modal closes, record switches to edit mode, a prominent amber session timer banner appears: "Editing as PI — [member]'s [record name] — 4:58 remaining. End session."
4. PI makes edits. Each field change is recorded in the audit log immediately on save.
5. After 5 minutes OR when PI clicks "End session," the record reverts to read-only and the timer banner disappears.

Attribution display: on read-only view of a record that has been PI-edited, a small "Edited by [PI] on [date]" line appears beneath the field value. Members can tap this to expand the full diff.

### 3d. Cross-lab Gantt overlay

The existing Gantt tab in lab mode shows one user at a time. The overlay mode adds:

A toggle button in the Gantt tab toolbar: "My Gantt / Lab Overlay." (Same UI pattern as the existing LabUserFilterButton.) In Lab Overlay mode:
- All lab members' tasks appear on a single chart, color-coded by member color (existing `UserMetadataEntry.color`).
- A member filter row lets the PI hide/show individual members.
- The existing single-member view is the default; overlay is opt-in to avoid visual overload.

No new data fetching is needed; the existing `useLabData` hook already loads all members' tasks.

### 3e. Comment attribution and threading UX

**Phase 1:** Every comment shows the author's color badge and username alongside the timestamp. This is the current state of `CommentsThread.tsx` and `NoteCommentsThread.tsx` — just make sure the PI fleshout is seeding comments with realistic `author` values.

**Phase 2:**
- Reply threading: a "Reply" link beneath each comment opens an indented compose box. Replies carry `parent_id` pointing to the root comment.
- @mentions: typing `@` in the compose box opens a miniature user picker (from the existing lab members list). Selected usernames are stored in `mentions[]` and rendered as a highlighted span in the comment text.
- Source-surface visibility: a small badge on each comment showing where it was posted ("from Gantt," "from Experiments"). Uses `source_surface` field.
- Notifications: posting a comment on another member's record writes a `comment_mention` notification to that member's notification file.

---

## 4. Phasing Plan

### Phase 1 — Account type + Lab Inbox shell + comment attribution (medium)

The foundation. No new write capabilities; just the new account type and a surface to grow into.

Deliverables:
- `sidecar.ts`: add `"lab_head"` to `account_type` union; bump schema version to 5; update `ACCOUNT_TYPES` set; update all `account_type === "lab"` guards as appropriate.
- Q1 setup: add third card in the wizard step that handles Q1 (likely `frontend/src/components/onboarding/v4/steps/setup/Q1AccountTypeStep.tsx` or equivalent).
- Lab Inbox tab: new component `LabInboxPanel.tsx` under `frontend/src/components/`. Rendered in `frontend/src/app/lab/page.tsx` when `account_type === "lab_head"`.
- Comment attribution: verify `CommentsThread.tsx` and `NoteCommentsThread.tsx` render author + timestamp. Extend demo PI fleshout fixture (`wiki-capture-fixture.ts`) to include a PI user (`pi`) with realistic `account_type: "lab_head"` and seeded comments.
- `feature-picks-tabs.ts` / `useFeaturePicks.test.tsx`: update tab-visibility logic for lab_head (lab_head sees all lab tabs plus Lab Inbox).

Dependent files: `sidecar.ts`, `feature-picks-tabs.ts`, `Q1AccountTypeStep.tsx` (or equivalent), `lab/page.tsx`, `CommentsThread.tsx`, `NoteCommentsThread.tsx`, `wiki-capture-fixture.ts`, `types.ts`.

Scope: **medium** (schema change touches many files; wizard step is mechanical).

### Phase 2 — Comment polish: threading, @mentions, source-surface, notifications (medium)

Deliverables:
- Extend `TaskComment` / `NoteComment` in `types.ts` with `parent_id`, `mentions`, `source_surface`.
- `CommentsThread.tsx` / `NoteCommentsThread.tsx`: render reply threads (indent), @mention highlights, source badge.
- Compose box: add @mention picker (reuse lab members list from `useLabData`).
- Add `CommentMentionNotification` type to `types.ts`; wire notification write on comment post.
- `NotificationPopup.tsx`: render new notification type.
- Update `wiki-capture-fixture.ts` with threaded demo comments.

Dependent files: `types.ts`, `CommentsThread.tsx`, `NoteCommentsThread.tsx`, `local-api.ts`, `NotificationPopup.tsx`, `wiki-capture-fixture.ts`.

Scope: **medium.**

### Phase 3 — Soft-write actions: announcements, task assignment, purchase approval, flag-for-review (large)

Deliverables:
- `_announcements.json` reader/writer (new lib file: `lib/lab/announcements.ts`).
- Home page (`app/page.tsx`): render pinned announcement banner for all lab users when `_announcements.json` has a pinned entry.
- `LabInboxPanel.tsx`: announcement composer section; action queue section.
- `types.ts`: add `pi_approved` / `pi_approved_by` / `pi_approved_at` to `PurchaseItem`; add `assigned_by` / `assigned_at` to `Task`.
- `local-api.ts` or a new `lib/lab/pi-actions.ts`: purchase approval write, task assignment write, flag-for-review write.
- New notification types in `types.ts`: `PiFlagNotification`, `TaskAssignedNotification`, `PurchaseApprovedNotification`.
- `NotificationPopup.tsx`: render new types.
- `LabPurchasesPanel.tsx`: show PI approval status badges; show Approve/Reject buttons to lab_head.
- Task rendering: show "assigned by PI" badge when `assigned_by` is set.

Dependent files: `types.ts`, `local-api.ts`, `app/page.tsx`, `LabInboxPanel.tsx`, `LabPurchasesPanel.tsx`, `NotificationPopup.tsx`, new `lib/lab/announcements.ts`, new `lib/lab/pi-actions.ts`.

Scope: **large** (touches many panels; notification wiring across users is fiddly).

### Phase 4 — Cross-lab metrics: Gantt overlay, funding rollup, roadmap aggregation (medium)

Deliverables:
- `LabGanttChart.tsx`: add toggle between single-user view and overlay mode; add member filter row in overlay mode.
- `SpendingDashboard.tsx` or new `LabFundingRollup.tsx`: aggregate funding account totals across all lab users; show per-user breakdowns.
- `LabRoadmapsPanel.tsx`: aggregate all users' roadmap milestones into a single view with member color coding.
- New "Lab Overview" tab in `lab/page.tsx`, visible to lab_head only.

Dependent files: `LabGanttChart.tsx`, `SpendingDashboard.tsx` or new component, `LabRoadmapsPanel.tsx`, `lab/page.tsx`.

Scope: **medium** (data is already loaded by `useLabData`; mostly UI composition).

### Phase 5 — Session-scoped edit mode (large)

Deliverables:
- `lib/lab/lab-head-auth.ts`: PBKDF2 hash/verify for the lab-head password; read/write `_lab_head_auth.json`.
- Settings page: new "Lab Head" section for setting the lab-head password.
- `lib/lab/edit-session.ts`: session state machine (idle / unlocked / locked); 5-minute countdown; session ID generation.
- `lib/lab/pi-audit.ts`: append-only writer for `_pi_audit.json`.
- Generic "Request edit" button component and password modal component.
- Integrate into `TaskDetailPopup.tsx`, `NoteDetailPopup.tsx`, `PurchaseEditor.tsx`: gate write inputs behind session state; show timer banner; write audit on each save.
- Audit diff display: "Edited by PI on [date]" expandable inline in read-only views.
- `wiki-capture-fixture.ts`: demo PI-edited record with audit entry.

Dependent files: `AccountPasswordPopup.tsx` (reference for PBKDF2 pattern), `TaskDetailPopup.tsx`, `NoteDetailPopup.tsx`, `PurchaseEditor.tsx`, `app/settings/page.tsx`, new `lib/lab/lab-head-auth.ts`, new `lib/lab/edit-session.ts`, new `lib/lab/pi-audit.ts`.

Scope: **large** (security-sensitive; touches many record views; timer state needs careful cleanup on unmount).

### Phase 6 — User archiving (medium)

Hide departed lab members from the login page, mention pickers, share dialogs, and assignee selectors without deleting any data. Full design lives in section 7 below. Depends on Phase 3 (soft-write action infra for the archive button) and Phase 5 (session edit mode for archive auth gating). Sub-phases 6a-6e dispatch as separate chips after Phase 5 lands.

Deliverables:
- `users/<username>/_onboarding.json`: new `archived`, `archived_at`, `archived_by` fields (additive, default false).
- Login page filter: hide archived by default + "Show archived" toggle.
- Picker filters: mentions, share dialogs, assignee selectors strip archived users.
- Lab Roster surface (Settings or Lab Inbox): archive / restore buttons for lab heads.
- Demo content: fourth fixture user with `archived: true` to showcase the feature.

Dependent files: `app/login/page.tsx` (or equivalent), `lib/settings/user-settings.ts`, mention / share / assignee picker components, new `LabRoster` component, `wiki-capture-fixture.ts`, `scripts/generate-demo-data.mjs`.

Scope: **medium** (additive sidecar field, filter logic across multiple pickers, one new admin surface).

---

## 5. Edge Cases and Open Questions

### Multiple lab heads (co-PIs)

The current proposal treats `account_type: "lab_head"` as a single user role with no co-PI concept. If two users set `account_type: "lab_head"`, they both get Lab Inbox, both can soft-write, and both can initiate edit sessions.

Questions for Grant:
- Is this acceptable? If so, nothing changes architecturally.
- If co-PIs should have independent audit trails and distinct permissions (e.g., one PI can't edit the other PI's experiments), that requires a permission model beyond what this proposal scopes.
- Recommendation: allow multiple lab_head users as a natural consequence of the account type, with no additional gating. Most labs have one PI; the edge case of co-PIs is handled gracefully by attribution.

### Lab head as a regular member

Confirmed per brief: lab_head users still run their own experiments. Their own data lives in `users/<pi_username>/` like any other member. The Lab Inbox is additive, not a replacement for their personal workspace. No special handling needed; the existing lab mode already shows each user their own data when they click on themselves in the member list.

### Audit log visibility

Proposed: the record owner sees edits to their own records (attributed to PI). The PI sees edits they made across all records. Neither can delete entries.

Open question: should lab members see the full diff, or just a "this was edited by PI" notice? Recommendation: show the full diff (old value, new value, timestamp) on expansion. Transparency is the point of the audit trail.

### Lab-head password reset

With no server, password reset must go through the account password. Proposed flow: Settings > Lab Head > "Reset lab-head password" requires the account password first, then sets a new lab-head password. If the user forgets both passwords, there is no recovery (same as the existing account password situation in a local-first app).

### Orphaned comments on member departure

If a member leaves the lab and their `users/<username>/` folder is deleted (or soft-deleted via `deleted_at` tombstone), comments they wrote (stored inline on other users' records) still carry their `author` username. Those orphan gracefully: the username is shown but the member no longer appears in the lab member picker. No cleanup is needed beyond ensuring the comment renderer handles a missing user color gracefully (fall back to gray).

Comments on the departed member's own records become inaccessible once their folder is gone, which is correct behavior.

### Demo content for the lab head role

The existing demo PI fleshout seeds `alex` and `morgan` as lab members. A Phase 1 task is to add a `pi` demo user to `wiki-capture-fixture.ts` with `account_type: "lab_head"` in their `_onboarding.json`, a few pinned announcements in `_announcements.json`, and comments attributed to `pi` on select alex/morgan records. All demo data must use `?wikiCapture=1` fixture mode, never real user data.

### Session timer UX on page navigation

If the PI navigates away from the record under edit before the 5-minute window expires, the session should be preserved for the remainder of the window (stored in module-level state, not component state). If they close the tab, the session naturally expires (no persistence needed; the 5-minute window is short enough that a closed tab is an acceptable loss). The timer banner should be visible across all lab mode routes while a session is active.

---

## 6. Phase 6 Detail — User Archiving

### Motivation

When a lab has been on ResearchOS for years, departed members accumulate. The shared-machine user login page gets cluttered with stale accounts. We need a way to hide them from default surfaces while preserving all their data, full searchability, and PI editability.

### Design decisions (locked, Grant 2026-05-23)

1. **Who can archive:** lab_head only. Members cannot archive themselves or other members. The PI is the single source of departure decisions, matching the existing oversight pattern.
2. **Login page visibility:** archived users are hidden by default. A small "Show archived" toggle below the user grid reveals them so a temporary returner can re-login without PI intervention.
3. **Mention / share / assignee pickers:** archived users are hidden from new-action surfaces. Existing references stay intact (an old `@mira` mention still renders).

### Behavior spec

**Search:** archived users' content remains globally searchable. Their author attribution renders gray, per the comment polish from Phase 1 (decision #5).

**PI edit mode (Phase 5):** the PI can access archived users' data through normal navigation. Archive state is independent of edit-mode auth — the PI can edit Mira's experiment whether or not Mira is archived.

**Restore:** lab_head can un-archive any user via the Lab Roster surface (see UX below). Un-archive immediately restores them to all pickers and login defaults.

**Lab Inbox filtering (Phase 2 surface):** when filtering comments by user, archived users appear in a collapsed "Archived" subgroup at the bottom of the user filter.

### Data shape

Add to `users/<username>/_onboarding.json` (the existing per-user sidecar):

```json
{
  "archived": false,
  "archived_at": null,
  "archived_by": null
}
```

- `archived`: boolean, default `false`. Single source of truth for visibility filtering.
- `archived_at`: ISO 8601 timestamp set when `archived` flips to `true`, cleared when restored.
- `archived_by`: username of the lab_head who triggered the most recent transition (archive or restore).

Migration: existing users have no archive fields. The reader defaults missing fields to `false` / `null`. No SoT data migration needed; the field is purely additive.

### UX surfaces

**Login page** (`frontend/src/app/login/page.tsx` or equivalent):
- Filter `users` to `!u.archived` by default.
- "Show archived" toggle (text link or pill) below the grid. Toggle on → archived accounts appear with a small "Archived" badge, sorted to the bottom.
- Clicking an archived account still allows login (no extra gate).

**Lab Roster surface** (new component, mounted either in Settings page or the Lab Inbox route from Phase 1):
- Lists all users with display name, username, account_type pill, and status (Active / Archived).
- "Archive" button per non-archived member — lab_head only. Confirmation dialog: "Archive Alex Chen? Their data stays searchable; they're just hidden from the login page and pickers."
- "Restore" button per archived member.
- Members see this surface read-only (view the roster, no buttons).
- The archive / restore action goes through Phase 5's session edit mode gating — the lab head must be unlocked to take the action.

**Mention / share / assignee pickers:**
- Filter `users` to `!u.archived` in the picker query.
- Existing references (old `@mira` mentions, existing assignments) render normally with gray author attribution.

### Edge cases

**Self-archive prevention:** the archive UI does not expose an "archive me" action for the currently logged-in lab_head. If a PI wants to leave the lab, they hand off to a co-PI who archives them.

**Last lab_head:** if archiving the last lab_head would leave the lab with zero PIs, surface a warning ("This is your last lab head. Archiving will leave the lab without a PI. Continue?"). Don't block — Grant's decision #1 explicitly allows co-PIs to coexist naturally without enforcement, and this is the consistent extension.

**Archived user comments on shared records:** continue rendering with gray author name (Phase 1 design decision #5 handles this).

**Edits made by PI while user was archived:** edits made in edit mode while the user was archived stay attributed to the PI in the audit log (Phase 2). Restoring doesn't reattribute.

**Sync folder layout:** archived users' files remain in `users/<username>/` on disk. Archive is purely a UI filter, not a data move. This means archived data still consumes shared sync bandwidth — acceptable, since the alternative (move-to-archive subfolder) breaks file paths in existing notes.

**Phase 1 demo PI (Mira) not yet archived:** Mira ships as `archived: false`. Phase 6's fourth fixture user will be the archive showcase.

### Sub-phase split

- **6a.** Sidecar schema: `archived`, `archived_at`, `archived_by` fields. Reader defaults missing → false. Settings type extension.
- **6b.** Login page filter + "Show archived" toggle. Default hidden.
- **6c.** Picker filters across mention / share / assignee surfaces. Existing references unchanged.
- **6d.** Lab Roster component: archive / restore buttons gated by Phase 5 edit mode, lab_head only.
- **6e.** Demo content: fourth fixture user (e.g. "Dr. Sam Whitley, former postdoc") with `archived: true, archived_by: "mira"`. Showcases the feature end to end.

Each sub-phase is a separate chip after Phase 5 lands.

### Out of scope (Phase 6 explicitly)

- **Permanent user deletion** — archive is non-destructive only. A delete-with-data action is a different (scarier) feature.
- **Auto-archive on inactivity** — manual PI action only. No "if a user hasn't logged in for 6 months, archive them" rule.
- **Archive history audit log** — relies on Phase 2 audit infrastructure. Phase 6 just sets the `archived_by` field; the diff log for archive / restore transitions is a Phase 2 follow-up.
- **Ownership transfer on archive** — archiving doesn't reassign projects / experiments / lists owned by the departed member. PI uses edit mode (Phase 5) to move things around if needed.

---

## 7. Out of Scope (Explicit)

The following are explicitly excluded from this proposal:

- **Cross-lab features**: this is a single-lab PI model. No federation across multiple lab folders, no cross-institution access.
- **Permissions model beyond "lab_head can soft-write + edit-mode-can-edit-anything"**: role-based access control, per-record permission grants, or lab-head restrictions on specific members are not in scope. The PI either has lab_head access or they do not.
- **Real-time sync**: ResearchOS remains local-first. The PI sees each member's data as the shared sync folder delivers it. No websocket layer, no live collaboration.
- **Mandatory approval workflows**: purchase approval is a UI toggle the PI flips; there is no enforcement that a purchase cannot be ordered without approval. The flag is informational, not a gate.
- **Comment moderation**: the PI cannot delete another member's comments. Attribution is the only safeguard.
- **Email or push notifications**: all notifications are in-app bell notifications, consistent with the existing notification system.
- **Multi-tenant / multi-lab**: one lab folder, one lab head (or co-PIs sharing the same folder), no concept of a university-level admin above the PI.

---

*— lab head proposal author, 2026-05-23*
