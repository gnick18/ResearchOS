# Wiki audit: Lab Head features

**Auditor:** wiki audit: lab head
**Date:** 2026-05-26
**Scope:** Lab Head account type, all six phases, plus the user-archiving spinoff page.

## Pages audited

- `frontend/src/app/wiki/features/lab-head/page.tsx` (overview)
- `frontend/src/app/wiki/features/lab-head/audit-log/page.tsx`
- `frontend/src/app/wiki/features/lab-head/edit-session-and-password/page.tsx`
- `frontend/src/app/wiki/features/lab-head/soft-write-actions/page.tsx`
- `frontend/src/app/wiki/features/lab-inbox/page.tsx`
- `frontend/src/app/wiki/features/lab-inbox/comments/page.tsx`
- `frontend/src/app/wiki/features/lab-inbox/announcements/page.tsx`
- `frontend/src/app/wiki/getting-started/user-archiving/page.tsx`

## Source code consulted

- `frontend/src/lib/lab/edit-session.ts`
- `frontend/src/lib/lab/pi-audit.ts`
- `frontend/src/lib/lab/announcements.ts`
- `frontend/src/lib/lab/pi-actions.ts`
- `frontend/src/lib/lab/lab-head-auth.ts`
- `frontend/src/lib/lab/user-archive.ts`
- `frontend/src/lib/onboarding/sidecar.ts`
- `frontend/src/lib/settings/user-settings.ts`
- `frontend/src/lib/sharing/unified.ts`
- `frontend/src/lib/types.ts` (Task, Note, PurchaseItem, TaskComment, NoteComment)
- `frontend/src/components/lab-overview/widgets/PiActionsWidget.tsx`
- `frontend/src/components/lab-overview/widgets/AnnouncementsWidget.tsx`
- `frontend/src/components/EditSessionTopNavChip.tsx`
- `frontend/src/components/LabHeadPasswordModal.tsx`
- `frontend/src/components/TaskDetailPopup.tsx`
- `frontend/src/components/UserLoginScreen.tsx`
- `frontend/src/lib/lab-overview/tool-registry.tsx`

## Counts

- **Critical (factually wrong, breaks user trust if followed):** 8
- **Significant (missing or misleading, but not catastrophic):** 6
- **Minor (style, polish, surface-name drift):** 4
- **Out of scope (Lab Overview widgets, Mira fixtures, onboarding):** noted but skipped

---

## Critical findings

### C1. Audit-log file location and fields are fabricated (audit-log page)

Wiki says (audit-log page) "The lab-level audit log is at `_pi_audit.json` at the root of the lab folder" and that each row carries an **`action`** field with a fixed vocabulary: `approve_purchase`, `decline_purchase`, `reapprove_purchase`, `assign_task`, `flag_record`, `resolve_flag`, `post_announcement`, `edit_announcement`, `delete_announcement`, `archive_user`, `unarchive_user`.

Reality:
- The canonical audit log is **per-user** at `users/<target_user>/_pi_audit.json` (`lib/lab/pi-audit.ts`, `auditPath`). The PiActions popup's Audit log tab reads it via `loadAuditEntriesByActor` which fans out across every user's per-user file (`PiActionsWidget.tsx:207-226`). It does NOT read a single lab-root file.
- A lab-root `_pi_audit.json` does exist but ONLY for announcement events, written by `appendLabAuditEntry` in `lib/lab/announcements.ts`. Nothing else writes to it and nothing in the PiActions popup reads from it.
- `PiAuditEntry` has NO `action` field. The actual schema is: `id`, `session_id`, `actor`, `target_user`, `record_type`, `record_id`, `field_path`, `old_value`, `new_value`, `timestamp`. Action verbs are reconstructed by a renderer (`describeAuditEntry`), not stored. The 11 action strings listed in the wiki are fabricated and do not appear in any source file.

### C2. Audit-log tab has no filter chips (audit-log page)

Wiki says the Audit log tab offers "Filter chips: by action category (approvals, flags, announcements, user-mgmt), by actor, and by date range" and "Click a row to expand the field path and the old / new value inline. For longer values (announcement bodies, for example) the expansion shows a diff-style view."

Reality (`PiActionsWidget.tsx:1280-1340`, `AuditRow`): the Audit log tab renders a flat newest-first list of entries the current PI authored, with a `Show more` / `Show all` paginator. No filter chips. No actor filter. No date range. No expandable rows. No diff view.

### C3. Lab Head password is stored per-user, not at lab root (edit-session page)

Wiki callout "Forgot the Lab Head password?" says "The Lab Head password sidecar lives at the lab folder root."

Reality (`lib/lab/lab-head-auth.ts:37`): `authPath(username)` returns `users/<pi_username>/_lab_head_auth.json`. The file is in the PI's own user folder, not at the lab root. The instruction to "delete it from Finder or Explorer" sends the user to the wrong directory.

### C4. First-time unlock uses the account password, not a "set new password" flow (edit-session page)

Wiki section "Setting the Lab Head password" says "The dialog flips to a 'set a new password' mode that asks you to type and confirm. After the first unlock, the dialog reverts to a single password field for ongoing sessions."

Reality (`lib/lab/lab-head-auth.ts:142-166` `verifyLabHeadPassword`, `components/LabHeadPasswordModal.tsx:145-154`): per Grant decision #3, the first unlock asks for the **account password** (one input, no confirmation), verifies against the existing account password hash, and silently auto-bootstraps a `_lab_head_auth.json` using that same password. The wiki then claims "The Lab Head password is stored separately from the per-user account password" — this is half-true at best: they start identical and only diverge if the PI uses Settings > Lab Head > Change password.

### C5. Comments do not exist on purchases (comments page)

Wiki says "Three record types accept comments today: Tasks, Notes, Purchases (individual line items inside a purchase order)."

Reality (`lib/types.ts`): only `Task` (line 446) and `LabNote` (line 1825 / 1888) carry `comments?: TaskComment[] | NoteComment[]`. `PurchaseItem` (line 1457-1490) has no comments field. `CommentsThread` is mounted only inside `TaskDetailPopup` and `NoteDetailPopup`. The purchase claim is fabricated.

### C6. Source-surface badge was never built (overview page and lab-inbox page)

Wiki overview lists "Comment threading + @-mentions" as Phase 2; the Lab Inbox page calls out "source-surface" as a deliverable. The proposal §3e Phase 2 also lists a "Source-surface visibility" badge on comments and a `source_surface` field on the comment type.

Reality: `TaskComment` and `NoteComment` (`lib/types.ts:481-495`, `1807-1816`) carry only `parent_id` and `mentions` from Phase 2. There is no `source_surface` field on either type, and a repo-wide grep for `source_surface` returns zero matches. Phase 2 source-surface scope was dropped; the wiki claims it shipped.

### C7. Session does not auto-extend on soft-writes; "5 minutes of inactivity" is wrong (edit-session page)

Wiki: "After 5 minutes of inactivity (no soft-write actions) the session auto-locks ... Each soft-write also extends the timer to the full 5 minutes, so a busy approval queue does not time out on you mid-pass."

Reality (`lib/lab/edit-session.ts`):
- `startEditSession` sets `expiresAt = now + 5*60*1000` and the tick loop locks at expiry regardless of activity. It is a flat 5-minute countdown from unlock, not an inactivity timer.
- `extendEditSession` exists but is called from exactly ONE place: the user clicking "Extend 5 min" in `EditSessionTopNavChip`. None of `assignTask`, `setPurchaseApproval`, `declinePurchase`, `setFlagForReview`, `postAnnouncement`, `updateAnnouncement`, `deleteAnnouncement`, `archiveUser`, or `restoreUser` call it.

### C8. Login picker badge wording misrepresents the data shape (overview page)

Wiki repeatedly conflates `account_type` semantics. The overview intro says "account flagged with `account_type === 'lab_head'`" and "values `'member'` (the default) or `'lab_head'`". That part is correct (matches `lib/settings/user-settings.ts:86` `AccountType = "member" | "lab_head"`), BUT the proposal-derived language elsewhere (e.g., proposal §2a) talks about `FeaturePicks.account_type: "solo" | "lab" | "lab_head"`. Today's code uses TWO orthogonal account_type fields and the wiki nowhere explains the split:

- `FeaturePicks.account_type: "solo" | "lab"` in `_onboarding.json` (workspace shape; "lab_head" was never added)
- `UserSettings.account_type: "member" | "lab_head"` in `settings.json` (intra-lab role)

`sidecar.ts:403` `ACCOUNT_TYPES = new Set(["solo", "lab"])` — no `lab_head` in the onboarding union. A reader following the wiki to find lab-head detection in `_onboarding.json` will not find it. Worth a short callout in the overview page.

---

## Significant findings

### S1. "Lab Inbox" is a stale surface name (lab-inbox page family)

Wiki has an entire `features/lab-inbox/` subtree (`page.tsx`, `comments/page.tsx`, `announcements/page.tsx`) describing a "Lab Inbox popup" that "lists every comment authored anywhere". The actual app has no "Lab Inbox" surface. The closest equivalents are the `CommentFeedWidget` ("Lab comments" tool), `CommentMentionsWidget`, and `AnnouncementsWidget`, all mounted inside `/lab-overview` as separate tools — see `tool-registry.tsx:225-298`. The screenshot TODO `lab-inbox-overview.png` describes a popup that doesn't exist.

The codebase comments still reference "Lab Inbox" as a historical name (e.g. `CommentFeedWidget.tsx:18`), so the term is recognized internally, but the public-facing surface is "Lab Overview" with per-tool popups. Decision needed: rename the wiki subtree, or keep it and add a callout explaining the rename.

### S2. "PI Actions popup" is technically "Pending lab head actions" (multiple pages)

Wiki refers to "the PI Actions popup" throughout. The tool registry title is "Pending lab head actions" (`tool-registry.tsx:298`). The code identifier is `pi-actions`. Either rename the wiki references or call out the tool's display name explicitly.

### S3. AssignTaskButton renders only on cross-owner views (soft-write-actions page)

Wiki: "On any task popup the Lab Head sees an Assign to member control above the description."

Reality (`TaskDetailPopup.tsx:938-951`): the button is gated by `labHeadGate.canRequestEdit && labHeadGate.unlocked && labHeadGate.activeUser && labHeadGate.sessionId`. `canRequestEdit` is true only when the viewer is a lab head AND the task owner differs from the viewer. A PI viewing their OWN task popup does not see the Assign button. "On any task popup" is misleading.

### S4. Edit-session chip placement and "lock icon" copy is off (edit-session page)

Wiki: "You can also lock the session manually from the header (a small lock icon next to the timer)." and earlier "The session timer is visible in the Lab Overview header so you always know how long you have left."

Reality (`EditSessionTopNavChip.tsx`): the chip lives in the global AppShell top nav (`AppShell.tsx`), not just the Lab Overview header. It is a single amber pill with an OPEN padlock icon and the remaining time inline; clicking opens a popover with two actions (Extend 5 min, Lock now). There is no separate "small lock icon next to the timer" — the icon IS the chip. The full-width amber banner (`EditSessionBanner`) is a separate sibling that lives inside relevant popups.

### S5. Audit-log "field_path" examples don't match the writers (audit-log page)

Wiki lists `field_path` examples as `status`, `assigned_to`, `flagged_for_review`.

Reality (grep across `lib/lab/`): the actual field_path values are `assignee` (not `assigned_to`), `approved`, `declined`, `flagged` (not `flagged_for_review`), `archived`, `text`, `pinned`, `_deleted`, `transient-read`. No `status` field exists.

### S6. Lab-root `_pi_audit.json` is announcement-only, not per-user (audit-log page)

Wiki says both files exist: "Lab-level: every soft-write across the whole lab" and "Per-user: every soft-write touching this user's records". This implies a complete lab-wide rollup at the root.

Reality: the lab-root file is written only by `appendLabAuditEntry` in `lib/lab/announcements.ts` (for `target_user: "_lab"` entries — announcement post/edit/delete/pin). All non-announcement soft-writes (assign, approve, decline, flag, archive) go ONLY to the per-user file. The wiki's two-file framing oversells the lab-root file as a full rollup.

---

## Minor findings

### M1. Wiki overview phasing labels are slightly off (overview page)

Wiki lists Phase 1 as "Account type + comment attribution" and Phase 2 as "Comment threading + @-mentions". The original proposal §4 calls Phase 1 "Account type + Lab Inbox shell + comment attribution" (three things, with Lab Inbox shell explicitly called out) and Phase 2 as "Comment polish: threading, @mentions, source-surface, notifications." The wiki phasing summary drops the Lab Inbox shell label entirely (because there is no Lab Inbox now — see S1) and silently drops source-surface (see C6).

### M2. Tab labels capitalization (soft-write-actions, audit-log)

Wiki refers to "Pending Approvals" and "Flagged" tabs; actual tab labels are "Pending approvals", "Flagged by you", "Audit log" (`PiActionsWidget.tsx:508,520,532`). Capitalization and wording mismatch.

### M3. "5-10 entries" claim drift (no wiki impact, just heads-up)

The proposal §2b said comments rarely exceed "5-10 entries"; the wiki doesn't quote that, so nothing to fix, but worth knowing if you write more about comment storage.

### M4. "Bring an archived member back" tone (user-archiving page)

The Bring-back section says "At the top of the LabRoster section is a Show archived toggle." That's correct (`LabRoster.tsx`), and the picker filter is correct, but the page never mentions that lab-head archive/restore actions also require an unlocked edit session — Section "Where the affordance lives" mentions the password prompt for the first archive, but the restore description does not repeat the gate. Minor wording — readers might miss that restore also requires unlock.

---

## Cross-cutting recommendations

1. **Pick a name and ship it.** "PI Actions popup" / "Lab Inbox" / "Pending lab head actions" / "Lab Overview" all coexist. Master should decide canonical names and the wiki should use them consistently.
2. **The audit-log page needs a near-total rewrite.** Fields, file location, filtering, expansion, and tab UX are all wrong (C1, C2, S5, S6). Best fix: actually read `PiActionsWidget.tsx` AuditLogTab and document what it renders, plus a clear paragraph saying per-user file is the source of truth and the lab-root file is announcement-only.
3. **The edit-session page needs a rewrite of the "Setting the Lab Head password" + timeout sections** to reflect the account-password bootstrap (C4), per-user storage (C3), and flat-5-minute countdown (C7).
4. **Drop the source-surface claim from the overview** (C6).
5. **Either build the Lab Inbox surface or rename the wiki subtree** (S1).
6. **Add a short data-shape callout to the overview** explaining the two distinct `account_type` fields (C8).

---

*— wiki audit: lab head, 2026-05-26*
