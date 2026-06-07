# Handoff: PI (lab head) capability revamp + session context

Written 2026-06-07 by the outgoing orchestrator session (running low on tokens).
Read this end to end before touching code. The immediate next task is the **PI
revamp**; the rest is context for everything that landed this session.

---

## 1. THE NEXT TASK: revamp the PI's unique functions (no password)

### Why
Profile (identity) login is now the official auth on main. The old lab-head
**password** + timed **edit-session** were therefore dead, and this session
removed them (see §3). But the removal went too far: it also stripped the PI's
ability to **edit a member's record content** and the **PI audit-trail UI**.
Grant: that loss is NOT acceptable. The PI must keep its unique powers; we just
need to redesign them cleanly without the password.

### LOCKED decisions (Grant, 2026-06-07)
- **Edit model: DIRECT, always-on, role-based.** A lab head can edit a member's
  record inline exactly like their own data. Every change is attributed + written
  to the PI audit log. There is NO unlock step, NO password, NO timed session.
  Being `account_type === "lab_head"` is sufficient.
- **Cover + surface these PI functions:**
  1. Edit member records + the PI audit log (restore this capability, password-free).
  2. Right-click / context-menu actions on records + roster rows (edit as PI,
     assign, flag, approve, archive, view audit).
  3. Dedicated PI page polish (Lab Overview / a PI hub where the unique
     functions are discoverable in one place).
  4. Settings + an audit-log surface (PI settings section WITHOUT any password
     control; a place to view the per-member audit trail).

### OPEN decision (Grant paused before answering — ASK HIM FIRST)
**Starting point: build forward on current main, vs revert the removal then
redesign.** My recommendation is **build forward on current main** (the
password/session are gone; do NOT resurrect them). The audit infra is still
present (see below), so "build forward" mostly means re-adding role-based PI
edit of member-record CONTENT, not rebuilding from scratch. Confirm with Grant
before starting.

### What is STILL on main (kept by the removal) — your building blocks
- `frontend/src/lib/lab/pi-actions.ts` and `pi-audit.ts` are KEPT (edit-session
  coupling stripped). The PI audit-log WRITER (`_pi_audit.json`, full old/new
  field diffs) still works. PI assign-task, flag-for-review, approve-purchase,
  archive-user, announcements all still function and are gated on "lab head
  viewing a member's record."
- `account_type: "lab_head"` still drives nav (Lab Overview), the Lab Roster,
  approvals, the Mentoring/Check-ins 1:1 tab.
- `canWrite(record, viewer)` in `frontend/src/lib/sharing/unified.ts` is now
  owner-or-shared-edit only (NO PI special-case). **This is the key seam for the
  revamp:** a clean way to restore direct PI edit is to teach `canWrite` (and the
  owner-scoped write path) that `viewer.account_type === "lab_head"` may write
  any same-lab member's record, then route those writes through the existing
  `pi-actions` audited path so attribution/audit is automatic. Re-add a thin PI
  edit affordance in the record popups (TaskDetailPopup, NoteDetailPopup,
  PurchaseEditor) that is just "you're the PI, edits are audited" (no unlock).

### What was DELETED (do NOT resurrect the password/session)
`edit-session.ts`, `lab-head-auth.ts`, `LabHeadPasswordModal`,
`RequestEditButton`, `EditSessionBanner`, `EditSessionTopNavChip`,
`AuditTrailNotice`, hooks `useEditSession` / `useLabHeadEditGate`, the Settings
PI password + active-session controls, and the `_lab_head_auth.json` fixture
seed. The plan doc for that removal is `docs/proposals/EDIT_MODE_REMOVAL.md`.
For the revamp, write a NEW design doc (e.g. `docs/proposals/PI_CAPABILITY_REVAMP.md`)
capturing the locked decisions above before building.

### CRITICAL coordination issue (tell Grant / the other session)
A parallel "collab manager" session committed `963fe60cd` (`useLiveEditSession`)
to build a **Purchases BeakerSearch "Approve" command** gated on the live
edit-session. This session's removal DELETED that hook (no caller had landed
yet). Grant chose "removal wins, I coordinate." So: that session must stop
building on edit-session and re-gate their Approve command on the independent
approval mechanism (`PurchaseApprovalControls` does not need a session). Confirm
this was communicated before they re-land conflicting code.

---

## 2. Demo / verification recipe (lab head)

- **Sign in as the demo lab head:** open `http://localhost:<port>/?wikiCapture=1&fixtureUser=mira`.
  Lands directly on Lab Overview as `mira` (account_type lab_head), NO login
  screen, NO passkey enrollment. `fixtureUser=mira` survives hard-navs (put it
  on every URL). Use this for all lab-head audits/demos/screenshots.
- The demo PI has seeded data (this session): her own project + 2 tasks, plus
  morgan tasks shared with her (task 3 at VIEW, task 5 at EDIT) so PI-vs-member
  record scenarios are testable. Fixture: `frontend/src/lib/file-system/wiki-capture-fixture.ts`.
- Preview MCP friction: the full TaskDetailPopup open control resists headless
  clicks (CDP limitation). A real-Chrome pass is needed to audit the PI
  edit/right-click flows interactively.
- Lab-head settings live on the **Lab Mode** tab of `/settings` (not Personal).

---

## 3. What landed this session (all on local main, NOTHING pushed)

- **Notebooks generalization (Phases 1+2):** personal + generic-shared notebooks
  (Notes-tab left rail: All / Unfiled / My notebooks / Shared). Generic shared
  notebooks are plain note containers (weekly machinery removed). Docs:
  `docs/proposals/NOTEBOOKS_GENERALIZATION_PROPOSAL.md`.
- **Lab-head/member 1:1 platform** (the "Mentoring" / "Check-ins" Workbench tab):
  weekly goals, meeting notes, shared notes, agenda/action items; role-relative
  label via `oneOnOneLabel`. Docs: `docs/proposals/NOTEBOOKS_AND_ONE_ON_ONE_REVAMP.md`.
- **Verified-icon registry usage:** new UI must use `<Icon>` from
  `@/components/icons` (an icon-guard test blocks new inline `<svg>`; new verified
  glyphs need Grant sign-off + `scripts/update-icon-baseline.mjs`).
- **Lab-head audit:** `docs/audits/LAB_HEAD_AUDIT_2026-06-07.md`. Em-dash sweep
  done; retired the redundant TraineeNotesWidget; AGENTS.md now exempts the
  empty-value "—" glyph. Remaining audit P3s noted there (e.g. shared task shows
  "Unknown project (#2)"; shared experiment tasks not in the PI Experiments tab).
- **PI edit-mode removal** (the thing being partly walked back): merged at
  `885bcc8c3`.

---

## 4. House style + working rules (from AGENTS.md)

- No em-dashes (except the empty-value glyph exemption), no emojis, no
  mid-sentence colons in any UI copy or prose. `<Icon>` only, `<Tooltip>` for
  icon-only buttons, brand tokens (`brand-action`, `.btn-brand`,
  `bg-surface`/`text-foreground`/`border-border`).
- Big/destructive changes: do in a worktree (`cp -c -R frontend/node_modules`,
  never install), verify `tsc --noEmit` = 0 + full `vitest run`, integrate via
  cherry-pick/merge after review. Commit, never push, never merge to origin
  without Grant. Sign-off `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Pre-existing test failures on main (NOT yours): 3 in
  `notes/__tests__/notes-trash.test.ts` + `notes/__tests__/restore-integration.test.ts`.
- Many parallel sessions touch this repo. main moves fast; re-merge main into
  your branch before integrating and watch for cross-arc collisions (the
  edit-session one above is a live example).
