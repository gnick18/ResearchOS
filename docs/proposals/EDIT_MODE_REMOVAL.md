# Remove PI edit-mode (Phase 5 soft-write / edit-session) entirely

Author: orchestrator (master bot), 2026-06-07
Status: PLAN, pending Grant go-ahead. Grant 2026-06-07: profile (identity)
login is now the official auth; the lab-head password is dead and the whole PI
edit-mode / Request-edit / edit-session soft-write flow should be removed.

## What edit-mode is (being removed)
The "Lab Head Phase 5" feature: a PI viewing another member's record in lab-mode
read-only could "Request edit", verify a lab-head password, and get a timed
(5-min) edit session that temporarily made the member's record writable, with
every change attributed + written to a per-user PI audit log. The session also
let `canWrite` return true for a lab head on records they do not own.

## Post-removal behavior (the consequence Grant accepted)
A lab head becomes a normal user for write purposes: they can edit only records
they own or that are shared with them at edit permission (standard sharing).
There is no PI soft-write on a member's record and no PI audit log.

## KEEP (independent of edit-mode, must NOT break)
- Purchase approvals (`PurchaseApprovalControls`, the Lab Overview approval queue
  / "What needs you").
- Flag-for-review (`FlagForReviewButton`, `FlagBanner`) and `clearFlagAsOwner`
  (already bypasses the edit-session gate).
- Announcements (`announcements.ts`, `AnnouncementsWidget`).
- Lab Roster, Lab Overview dashboard, Mentoring/Check-ins 1:1, account_type
  lab_head itself (still drives nav + these features).

## REMOVE
Core/libs:
- `lib/lab/edit-session.ts`, `lib/lab/lab-head-auth.ts`, `lib/lab/pi-actions.ts`,
  `lib/lab/pi-audit.ts`.
- `hooks/useEditSession.ts`, `hooks/useLabHeadEditGate.ts`.
UI:
- `components/LabHeadPasswordModal.tsx`, `components/RequestEditButton.tsx`,
  `components/EditSessionBanner.tsx`, `components/EditSessionTopNavChip.tsx`,
  `components/AuditTrailNotice.tsx`.
- The PI edit-mode `LabHeadSection` in `settings/page.tsx` (password + active
  session controls) and `ChangeLabHeadPasswordPopup`. Keep `AccountTypeSection`
  + `LabRosterSection` on the Lab Mode tab.
Rewire (drop the session, keep share-permission gating):
- `lib/sharing/unified.ts`: drop the `session: EditSessionView` param from
  `canWrite` (and `EditSessionView` / `NEVER_UNLOCKED`); `canWrite` becomes
  owner-or-shared-edit only. Update every caller.
- `lib/owner-scoped/index.ts`, `lib/notes/owner-scoped-api.ts`,
  `lib/purchases/owner-scoped-api.ts`, `lib/notes/*-permission.ts`,
  `useMethodPermissions.ts`: remove the edit-session-audited write path; keep
  plain owner-scoped read/write where still needed for shared-edit records.
- `TaskDetailPopup.tsx`, `NoteDetailPopup.tsx`, `PurchaseEditor.tsx`,
  `AssignTaskButton.tsx`, `LabRoster.tsx`, `ProjectRoute.tsx`, `AppShell.tsx`,
  `file-system-context.tsx`, `user-archive.ts`: remove the Request-edit
  affordance + the edit-session readOnly bypass; `effectiveReadOnly` becomes
  just the share-permission `readOnly`.
Data/fixture:
- Remove `users/mira/_lab_head_auth.json` from `wiki-capture-fixture.ts` and any
  `_pi_audit.json` / `_lab_head_auth.json` references. Legacy on-disk files are
  inert and ignored (no migration).

## Out of scope
- `frontend/src/app/wiki/**` (the `lab-head/edit-session-and-password`,
  `soft-write-actions`, and related pages go stale). Wiki is a separate sub-bot
  domain; list the implication, do not edit here.

## Verification gates
- `cd frontend && node_modules/.bin/tsc --noEmit` exits 0.
- Full `node_modules/.bin/vitest run` green (especially `sharing/`,
  `owner-scoped`, `lib/lab/`, notes/purchases permission tests). Delete or
  rewrite tests that assert edit-session behavior.
- `grep -rn "edit.?session\|useEditSession\|RequestEdit\|LabHeadPassword\|pi-actions\|pi-audit\|verifyLabHeadPassword" frontend/src --include=*.ts --include=*.tsx | grep -v /wiki/` returns nothing (clean removal).
- Live smoke as the demo lab head (`?wikiCapture=1&fixtureUser=mira`): no
  "Request edit" / password modal anywhere; approvals, flags, announcements,
  roster, Mentoring all still work; opening a member's record is read-only
  unless shared at edit.

## Execution
High blast radius (~27 files incl. `canWrite`). Do in a dedicated worktree with
the gates above; integrate via cherry-pick after review. Best as one focused
sub-bot since it is a coherent, self-contained removal.
