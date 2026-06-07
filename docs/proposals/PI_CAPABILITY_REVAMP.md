# PI (lab head) capability revamp, password-free

Status: DRAFT for sign-off. Supersedes the password + timed edit-session model,
which was removed on main (`e534f585d refactor(lab): remove PI edit-mode /
edit-session entirely`, plan in `docs/proposals/EDIT_MODE_REMOVAL.md`). Context
and locked decisions come from `docs/handoff/2026-06-07_pi-revamp-handoff.md`
plus Grant's refinements on 2026-06-07.

## Why this exists

Profile (keypair) login is now the official auth on main, so the old lab-head
**password** and the timed **edit-session** were dead weight and got removed.
The removal was correct about the password and the session, but it went too far,
it also stripped two things the PI genuinely needs.

1. The PI's ability to edit a lab member's record content (notes, tasks,
   purchases) as the lab head.
2. The PI audit-trail UI (the surface that shows what a PI changed on a
   member's record).

Grant: that loss is not acceptable. The PI keeps its unique powers, we just
rebuild them cleanly without any password or session ceremony.

## What is already on main (the building blocks)

These survived the removal and the revamp builds on them, it does not rebuild
them.

- `lib/lab/pi-audit.ts`, the audit layer. `writeWithAudit<T>()` is a generic
  "write data, then append per-field audit entries" helper. `readAuditEntries(targetUser)`
  reads a member's `_pi_audit.json`. `buildFieldDiffEntries()` produces the
  old/new field diffs. All intact.
- `lib/lab/pi-actions.ts`, the kept PI actions, each routed through the audit
  layer. `assignTask`, `setPurchaseApproval`, `declinePurchase`, `setFlagForReview`,
  `clearFlagAsOwner`. There is NO edit-record-content action, that is the gap.
- `account_type: "lab_head"` still drives the Lab Overview nav, the Lab Roster,
  approvals, and the Mentoring 1:1 tab.
- Flag-for-review still works (a PI viewing a member's record can flag it, a
  role privilege rather than a content write).

## What was deleted (do NOT resurrect)

`edit-session.ts`, `lab-head-auth.ts`, `LabHeadPasswordModal`, `RequestEditButton`,
`EditSessionBanner`, `EditSessionTopNavChip`, `AuditTrailNotice`, the hooks
`useEditSession` / `useLabHeadEditGate`, the Settings PI password + active-session
controls, and the `_lab_head_auth.json` fixture. None of these come back. The
new model has no password, no unlock, no timer.

## The current write seam

`canWrite(record, viewer)` in `lib/sharing/unified.ts` is owner-or-shared-edit
only, with no PI special case.

```
export function canWrite(record, viewer) {
  if (!record) return false;
  if (record.owner === viewer.username) return true;
  // shared_with includes the viewer (or the whole-lab sentinel) at level "edit"
  return list.some((s) => sameUserOrWholeLab(s) && s.level === "edit");
}
```

This is the seam the revamp teaches about the lab head.

## Locked decisions (Grant, 2026-06-07)

1. **Edit model: direct, always-on, role-based.** A lab head edits a member's
   record inline exactly like their own data. Being `account_type === "lab_head"`
   is sufficient. There is no unlock step, no password, no timed session.
2. **Confirm guard, once per session.** To prevent accidental edits, the first
   time a PI edits a given member's record in an app session, a short are-you-sure
   warning appears. After they confirm, that member's record is freely editable
   for the rest of the session. The guard is remembered per member per record
   for the session (in memory, cleared on reload / user switch). It is a
   guard-rail, not an auth gate.
3. **Every PI edit is attributed and audited.** PI writes to a member's record
   route through the kept `writeWithAudit` path so `_pi_audit.json` records the
   field diffs automatically.
4. **No password control anywhere.** The Settings PI surface gets an audit-log
   viewer, never a password field.

## Design

### canWrite, taught about the lab head

Add a single PI clause. In a local shared folder the folder is the lab, so a
lab head may write any record in it.

```
export function canWrite(record, viewer) {
  if (!record) return false;
  if (record.owner === viewer.username) return true;
  if (viewer.account_type === "lab_head") return true; // PI writes any lab record
  return list.some((s) => sameUserOrWholeLab(s) && s.level === "edit");
}
```

This restores editability everywhere `canWrite` gates UI. The confirm guard and
the audited write routing live one layer up, in the record popups, because
`canWrite` is a pure predicate and cannot hold session state.

### The confirm guard (once per session)

A tiny in-memory store keyed by `targetOwner + recordType + recordId`. The first
edit intent on a not-yet-confirmed member record opens a `PiEditConfirmDialog`
(reuse `LivingPopup`), copy along the lines of "You are editing {member}'s
{record}. Your changes save to their folder and are logged to the lab audit
trail. Continue?" On confirm, the key is marked confirmed for the session and the
popup becomes editable. The store resets on reload and on user switch (same wipe
points the old password cache used).

This replaces the deleted `RequestEditButton` + password modal with a far lighter
single confirmation, and it only ever fires for a PI on someone else's record.

### Audited write routing

When the active user is a lab head editing a member's record (owner is not the
PI), the popup save path uses `writeWithAudit` instead of the plain write, so the
`_pi_audit.json` diff lands automatically. Own-record edits keep the plain path.
A thin helper, `savePiRecordEdit(...)`, wraps the branch so the three popups
share it.

### Surfaces (phased)

1. Edit content, the core. canWrite clause + confirm guard + audited routing in
   `TaskDetailPopup`, `NoteDetailPopup`, `PurchaseEditor`. A small "PI edit,
   changes are logged" inline note in the header (no unlock affordance).
2. Right-click / context-menu PI actions on records and roster rows (edit as PI,
   assign, flag, approve, archive, view audit), surfacing the kept `pi-actions`
   in one ergonomic place.
3. PI hub polish on Lab Overview, the unique functions discoverable in one place.
4. Settings Lab Mode audit-log viewer, built on `readAuditEntries`, no password
   control.

Phase 1 is the smallest shippable slice and restores the capability Grant flagged.
Phases 2 to 4 are the rest of the revamp.

## Coordination (must communicate)

A parallel collab-manager session committed `963fe60cd` (`useLiveEditSession`) for
a Purchases BeakerSearch "Approve" command gated on the live edit-session. The
removal deleted that hook. Grant chose "removal wins, I coordinate." That session
re-gates its Approve command on the independent approval mechanism
(`PurchaseApprovalControls` needs no session). Confirm this is communicated before
they re-land conflicting code.

## Open questions for Grant

1. Phase 1 only now, or the full four-surface revamp on this branch? (Default
   read: phase 1 first, follow-ups for 2 to 4.)
2. "Session" for the confirm guard means until page reload / user switch. Good,
   or should it persist longer (per member, remembered across reloads)?
3. The inline header note for a PI editing a member record, exact copy. Draft is
   "You are editing {member}'s record. Changes are logged to the lab audit trail."
