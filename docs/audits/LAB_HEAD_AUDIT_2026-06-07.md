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

- **[CORRECTED, was a navigation error] Lab-head session controls DO exist.**
  The "PI" section (Lab-head password / Change password, Active session, Lock
  session now) lives on the **Lab Mode** settings tab (`LabModeTabContent` ->
  `LabHeadSection`, gated `account_type === "lab_head"`). My first walk only
  viewed the Personal tab, so I wrongly reported them missing. Confirmed present
  live at `/settings?...&tab=lab-mode` as mira. NOT dead code; do not delete.
- **[CORRECTED] Security "Password not set" is accurate.** The Personal-tab
  Security section is the GENERIC account password (`_auth.json`), which mira
  genuinely has not set; it is separate from the lab-head password
  (`_lab_head_auth.json`) on the Lab Mode tab. Not misleading.
- **[P2, DONE]** Two em-dashes fixed: `settings/page.tsx:1619` (sidebar desc)
  and the "Active — N remaining" edit-session status pill.
- **[P3, open design Q]** Whether the edit-session / lab-head-password
  soft-write workflow is still the intended model after the identity/passkey
  migration is a real question, but the code is LIVE, not orphaned. Evaluate
  deliberately, do not blind-delete.
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

- **[P3, design] Edit-session / lab-head-password model vs identity/passkey**
  (surface 4): the controls are LIVE on the Lab Mode tab (the earlier
  "missing/dead" reading was my navigation error). Open question is only whether
  the soft-write edit-session workflow is still the right model post-identity
  migration. Not dead code; evaluate deliberately if at all.
- **[P3] Empty-value "—" glyph** convention: pick keep-and-exempt vs swap to a
  middot, apply once.
- **[P3] Surface 3 live walk** (BLOCKED on demo data): TaskDetailPopup
  edit-session password modal + soft-write flow, comments, archiving,
  FlagBanner. As mira the Gantt is empty (no tasks of her own, no member tasks
  shared into her view), so the PI soft-write workflow (which acts on a member's
  shared record) cannot be exercised. Do the demo-data seeding first, then walk.
- **[P3] Demo richness** (enabler for surface 3): the demo PI has no tasks, no
  shared member records in her Gantt, and $0 across funding accounts, yet Lab
  Overview claims "40 approvals". Seed a coherent PI dataset: a couple member
  tasks shared into the PI view, a pending purchase or two to approve, a
  comment/mention, and some funding usage. Reconcile the "40 approvals" count
  with actual seeded approvals.
