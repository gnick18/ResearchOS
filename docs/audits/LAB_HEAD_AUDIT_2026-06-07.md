# Lab-head surfaces audit (2026-06-07)

Auditor: orchestrator (master bot). Findings-only, driven as the demo lab head
(mira) in fixture mode plus source review. Severity: P1 (broken / wrong), P2
(clear UX or house-style issue), P3 (polish / consistency).

Method note: live-driven for Lab Overview + Mentoring as mira; the cross-cutting
surfaces (task interactions, settings, purchases) are source-reviewed plus
spot-checked. Items tagged [src] were found by source review and want a live
confirmation before fixing.

## Cross-cutting

- **[P2] Demo lab-head login is hard to reach.** Signing into the demo as a lab
  head goes through the new passkey/identity-keypair enrollment, and any
  `?wikiCapture=1` hard-nav reseeds back to alex. There is no frictionless way to
  land in a lab-head view for testing/demos/screenshots. Recommend a fixture
  affordance (pre-enrolled mira + a soft `as=mira` seed) so lab-head features are
  demoable at all. (The committed demo password is now moot for login.)
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

## 4. Settings + nav [src]

- **[P2]** `settings/page.tsx:1619` em-dash (above).
- Lab-head sections: change-lab-head-password, active-session status pill, audit
  log. **[P3]** Needs a live pass to confirm these still match the current
  identity/passkey model (login moved to keypair/passkey; verify the lab-head
  password settings copy is not stale relative to that).
- **[P3]** Nav: "Lab Overview" appears for lab heads; confirm the member vs
  lab-head nav difference is intentional and that the Mentoring tab is reachable.

## 5. Purchases + sharing [src]

- `PurchaseEditor.tsx`: empty-value "—" glyphs (P3 above). **[P3]** Live pass of
  the lab-head purchase-approval flow (the pinned announcement tells members
  orders route through purchases for one-pass PI approval — verify that approval
  UX exists and is clean).
- `sharing/ShareDialog.tsx`: no UI-copy em-dashes found; wants a live pass.

## Recommended fix batches

1. **Em-dash sweep** (P2): the 5 confirmed UI-copy strings. One small commit,
   safe, no behavior change.
2. **Empty-value glyph decision** (P3): pick a convention, apply or exempt.
3. **TraineeNotesWidget vs Mentoring** (P2, design): decide retire vs
   differentiate. Needs Grant.
4. **Demo lab-head access** (P2): fixture affordance for frictionless lab-head
   sign-in; unblocks future audits/demos/screenshots.
5. **Live walks** of surfaces 3/4/5 as mira to confirm the [src] items and catch
   visual/state issues a source scan cannot.
