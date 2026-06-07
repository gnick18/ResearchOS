# Lab-head surfaces audit (2026-06-07)

Auditor: orchestrator (master bot). Findings-only, driven as the demo lab head
(mira) in fixture mode plus source review. Severity: P1 (broken / wrong), P2
(clear UX or house-style issue), P3 (polish / consistency).

Method note: live-driven for Lab Overview + Mentoring as mira; the cross-cutting
surfaces (task interactions, settings, purchases) are source-reviewed plus
spot-checked. Items tagged [src] were found by source review and want a live
confirmation before fixing.

## Cross-cutting

- **[RESOLVED, was a false alarm] Demo lab-head access.** Frictionless lab-head
  sign-in ALREADY EXISTS: `?wikiCapture=1&fixtureUser=mira` lands directly on the
  lab-head Lab Overview with NO login screen and NO passkey enrollment (mira is
  in `WIKI_CAPTURE_FIXTURE_USERS`, and `fixtureUser` keeps the session across
  hard-navs too). The earlier "hard to reach" reading was my mistake (I used
  picker mode + manual enrollment). No fix needed; just use `fixtureUser=mira`
  for any lab-head audit/demo/screenshot. (A known demo lab-head password "demo"
  was set in passing; harmless and still useful if edit-session elevation reads
  the lab-head auth.)
- **[P2] Em-dashes in user-facing copy** (house style = none). Confirmed in:
  - `AnnouncementsWidget.tsx:255` placeholder "Share an update with the lab — e.g. ..."
  - `lab-head/LabRoster.tsx:336` "— archived"
  - `lab-head/AssignTaskButton.tsx:212` option "— Pick a lab member —" and `:241` placeholder "...this week — sequencing primers..."
  - `settings/page.tsx:1619` "...Pick what to show — tasks for today..."
  - `TaskDetailPopup.tsx:3378` "Editing — Save when done"
  Recast each with a comma / period / ellipsis.
- **[P3] Em-dash as an empty-value glyph** ("—") in `AnnouncementsWidget:885`,
  `LabActivityWidget:791,932`, `PurchaseEditor:839,925,929,941`,
  `TaskDetailPopup:2043`. This is a common "no value" convention, but it
  technically conflicts with the no-em-dash rule. Decide once: keep as the
  house empty-value glyph (then exempt it explicitly) or swap to a middot.

## 1. Lab Overview (/lab-overview) — live as mira

- **[P2] "Trainee notes & goals" widget overlaps the new Mentoring tab.** It
  reads shared notes + shared weekly goals (`labApi.getNotes/getWeeklyGoals`,
  `shared_only`), so it now also surfaces the 1:1 weekly goals. With the new
  Mentoring/Check-ins surface owning the structured trainee relationship, this
  widget is conceptually redundant. Decide: retire it, or differentiate it
  clearly (e.g. "recent shared activity" vs the structured 1:1).
- **[P3] "40 approvals" in "What needs you".** Verify the count is real lab data
  and not an artifact; 40 reads as alarming on a fresh-looking dashboard.
- **[P3] Voice:** the demo announcements model em-dashes ("...include — I'm
  anchoring..."). Fixture content, not UI, but if we want to set tone in demos,
  the seeded copy should follow house style too.
- Looked solid otherwise: header, "What needs you" banner, Browse lab
  experiments/notes, Announcements composer + pinned/recent list all render
  cleanly with real data.

## 2. Mentoring tab (Workbench, lab-head view) — live earlier this session

- Verified working: gating (tab shows for lab head / hidden for memberless solo),
  create 1:1, role-relative label ("morgan - Mentoring"), four areas (Weekly
  goals / Meeting notes / Notes / Agenda), add + owner-routed toggle, week
  selector + meeting-date picker (just added).
- **[P3] Member-side "Check-ins" perspective not yet live-verified** (needs a
  second account). Reuses the same code paths, low risk.
- **[P3]** Consider whether the Lab Overview should link to / surface the
  Mentoring tab so a PI discovers it (currently only a Workbench sub-tab).

## 3. Lab-head task interactions [src]

- TaskDetailPopup carries the PI edit-session, "Edited by PI" notice, comments,
  archiving, request-edit. **[P2]** `TaskDetailPopup.tsx:3378` "Editing — Save
  when done" em-dash (above). **[P3]** Needs a live pass of the edit-session
  password modal + soft-write flow as mira (the modal is the one place the
  lab-head password still matters); confirm copy + states.
- `FlagBanner.tsx`, `RequestEditButton.tsx`, `CommentsThread.tsx` are part of
  this surface; source-review only so far, want a live walk.

## 4. Settings + nav — live as mira

- **[P2, NEW] No lab-head session controls render for a lab head.** On Settings
  as mira, there is NO visible "Change lab-head password", "Active session"
  pill, or audit-log control. The source (settings page ~1108) describes these,
  but they do not appear. Likely stale/dead relative to the identity/passkey
  migration (login moved to keypair/passkey). Needs a decision: re-surface them,
  or remove the dead code if the identity model replaced them.
- **[P2, NEW] Security section shows wrong state for a lab head.** It reads
  "Password is currently not set" for mira even though she has
  `_lab_head_auth.json`. The generic Security/Password section reflects
  `_auth.json` only, so a lab head sees a misleading "no password" state.
- **[P2, DONE]** `settings/page.tsx:1619` em-dash fixed.
- Nav: "Lab Overview" correctly appears for lab heads; member vs lab-head nav
  difference looks intentional.

## 5. Purchases + sharing — purchases live as mira

- **Good:** the Purchases page for a lab head shows a clear callout, "40 items
  across the lab await your approval. This page shows your personal purchases.
  The lab-wide approval queue lives on Lab Overview. [Open Lab Overview]". The
  approval-queue indirection is well signposted.
- **[P3]** The lab-head spending dashboard + funding accounts render but are all
  $0 in the demo (no seeded purchase data for the PI view). Fixture-richness, not
  a bug; worth seeding for a convincing PI demo.
- `PurchaseEditor.tsx`: empty-value "—" glyphs (P3 above).
- `sharing/ShareDialog.tsx`: no UI-copy em-dashes found; still wants a live pass.

## Recommended fix batches

1. **Em-dash sweep** (P2): DONE (commit `6d5ff2cd2`).
2. **TraineeNotesWidget retired** (P2): DONE (commit `c6e9ba2b9`).
3. **Demo lab-head access**: NOT NEEDED, already works via `fixtureUser=mira`.
4. **Live walks**: DONE for Lab Overview, Mentoring, Settings, Purchases. Task
   edit-session interactions (surface 3) still want a focused interactive pass.

## Still open (post-this-pass)

- **[P2] Lab-head settings stale vs identity/passkey model** (surface 4): no
  edit-session / change-lab-head-password / audit controls render, and the
  Security section shows a misleading "Password is currently not set" for a lab
  head. Decide re-surface vs remove-dead-code. Needs Grant.
- **[P3] Empty-value "—" glyph** convention: pick keep-and-exempt vs swap to a
  middot, apply once.
- **[P3] Surface 3 live walk**: TaskDetailPopup edit-session password modal +
  soft-write flow, comments, archiving, FlagBanner, as mira.
- **[P3] Demo richness**: seed lab-head purchase/spending data so the PI demo
  isn't all $0.
