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
- **[DONE] Empty-value "—" glyph**: Grant chose keep-and-exempt; AGENTS.md
  house-style rule updated to exempt it (`b50e9f036`).
- **[DONE] Demo PI dataset seeded** (`75eaf9d69`): mira now has her own project
  + 2 tasks, plus two morgan tasks shared with her (qPCR id 3 at VIEW so the
  Request-edit/edit-session flow is demonstrable; figures list id 5 at EDIT).
  The "40 approvals" was NOT a discrepancy: it counts pending purchase items
  across members (already seeded), separate from the PI's personal purchases.
- **[NOTED, false alarm corrected]** The earlier "Gantt empty / 40 approvals
  unbacked" reading was wrong; approvals are backed, and the PI just had no
  shared records until this seed.

## Surface 3 walk results (partial, as mira)

- **Verified:** a task shared at EDIT (list id 5) opens a quick-view list popup
  where the PI can check off / add / delete items directly (no edit-session
  needed, correct for edit permission). The "Shared by morgan" badge shows.
- **[P3, NEW] "Unknown project (#2)" on a shared task.** A task shared to the PI
  references the owner's project id, which the PI can't resolve (the project
  isn't shared), so the row reads "Unknown project (#2)". Show the owner's
  project name (it travels with the share) or a friendlier "morgan's project".
- **[P3, NEW] Shared EXPERIMENT tasks don't surface in the PI's Experiments
  tab.** morgan's qPCR experiment (shared to mira) does not appear under
  Experiments (filtered to the PI's own projects); it only shows under Lists.
  Shared member experiments should be reachable from the Experiments view.
- **[P3, COULD NOT COMPLETE HEADLESSLY]** Opening the full TaskDetailPopup for a
  member task to audit Request-edit -> edit-session password modal (demo pw
  "demo") -> comments -> archive -> FlagBanner. The full-popup open control
  resisted the Preview MCP click (documented CDP click friction). Now testable
  in a real browser since task 3 is view-shared: needs Grant or a real-Chrome
  pass.
