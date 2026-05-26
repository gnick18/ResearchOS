# Wiki audit: Workbench (2026-05-26)

## Summary

Audited the Workbench surface (experiments + notes + lists) covered by
`/wiki/features/experiments` ("The Workbench") and the nav cross-link at
`/wiki/features/projects` ("Project Surface"). The wiki page is single-
page-for-three-tabs (matches the app), but several concrete claims have
drifted from current code after the experiments redesign + R1 fix-pass,
the Workbench Lists inline-expand chip, and the Lab Head Phase 3/5
soft-write surfaces. Recent demo-lists fleshout, Notes lab-head-edit
integration, comments thread on notes, and the unified SharingChips row
on notes are entirely absent from the wiki.

`APP_ROUTE_TO_WIKI` is correct for both `/workbench` and
`/workbench/projects` (resolves prefix-matched). `/experiments` is
deliberately omitted (the redirect stub has no AppShell, so the `?`
icon never renders there). `WIKI_NAV` "The Workbench" blurb still reads
true at a glance.

Counts: 6 P0, 7 P1, 5 P2.

## P0 findings

P0-1. **Experiment popup default tab is wrong.** Wiki claims (line 286-291,
`experiments/page.tsx`): "The popup always opens on the **Details** tab,
regardless of whether the experiment is ready, running, awaiting
writeup, or completed." Current code (R1 fix-pass,
`TaskDetailPopup.tsx:114-115`): `initialTab ?? (isPurchase ?
"purchases" : isExperiment ? "notes" : "details")` — experiments default
to **Lab Notes**, not Details. The wiki's "consistent entry point"
justification paragraph is moot. Fix: rewrite that paragraph to say
experiments open on Lab Notes (with the rationale: users open an
experiment to write lab notes, not to admin metadata; list tasks still
default to Details).

P0-2. **"Chain stacks" feature does not exist.** Wiki claims (line
134-145, "Cards and chain stacks"): "When two or more experiments are
linked by a dependency, they collapse into a single stacked card
labeled **N tasks**. Clicking the stack opens the *root* experiment's
popup." Reality: `WorkbenchExperimentsPanel.tsx` renders one
`ExperimentResultCard` per experiment, no collapse logic, no stack
component anywhere under `frontend/src/components/experiments/` or
`frontend/src/components/workbench/`. The only chain affordance is the
gray "Next:" pointer rendered under a running card (already documented
in §3 Running). Fix: delete the "Cards and chain stacks" subsection
entirely; the per-card anatomy can move into §3.

P0-3. **"All projects" pill does not exist.** Wiki claims (line 47-57,
"The project filter pill strip"): "a row of colored pills, one per
project, plus an **All projects** pill on the left." Reality
(`WorkbenchProjectFilterPills.tsx`): no "All projects" pill rendered;
the strip is per-project only, multi-select toggle (empty selection
means show everything). "Click it again (or pick a different one) to
clear" is also wrong — toggling adds/removes from a multi-select set,
no single-select "different one clears" behavior. Fix: rewrite the
section to describe the multi-select toggle model with the "no
selection means all" default.

P0-4. **Experiment card anatomy is incorrect.** Wiki claims (line
134-145): card has "a project pill, the project color along the edge,
a hero image (if the writeup has one), a method chip strip". Reality
(`ExperimentResultCard.tsx:124-180`): the dot on the card is the
**experiment_color** (per-task accent), not project color. There is no
"project pill" — the project name renders as plain text after the
username in a single-line `username • project_name` byline. The hero
precedence is: first image → first ~3 lines of `results.md` →
placeholder tinted with `experiment_color` (the wiki only mentions
the image case). Fix: rewrite anatomy paragraph to match the actual
card structure (UserAvatar + username • project_name byline, accent
dot is experiment_color not project color, hero has 3-tier fallback).

P0-5. **Lists "Open full view" inline behavior is undocumented.** The
"Expanding a list task inline" section (line 237-268) documents the
inline panel UI but never explains the relationship with the legacy
popup. Current code (`WorkbenchListsPanel.tsx:96-103`): the popup mount
path stays alive ONLY as the "Open full view" escape hatch from inside
the inline-expanded panel; card clicks themselves toggle the accordion.
Wiki line 263-268 mentions the link in passing but doesn't make clear
that the popup is now opt-in (not the default click target). Important
because users with muscle memory from before the inline-expand chip
will expect a popup on card click. Fix: add a callout: "Clicking a
list card opens the inline panel, not the popup. Use **Open full view**
in the panel footer when you need the Details / date-editing fields."

P0-6. **Notes soft-delete + Undo toast is entirely undocumented.** Note
deletion is a soft-delete now: the JSON moves to
`users/<owner>/notes_trash/<id>.json` and a 10s Undo toast pops via
`delete-toast-bus` (`NotesPanel.tsx:111-137`, `NoteDetailPopup.tsx:
673-688`). Wiki has no mention of `notes_trash/` or the Undo toast,
which is a user-facing safety net worth surfacing. Fix: add a short
"Deleting a note" subsection or callout under "The Notes tab" covering
the trash path + the 10s Undo window.

## P1 findings

P1-1. **Lists tab "+ N scheduled later than 14d out" wording is wrong.**
Wiki claim (line 208-213): "Tasks starting further out are omitted from
the main list; a small gray footnote below the section reads
'+ N scheduled later than 14d out'". Code
(`WorkbenchListsPanel.tsx:333-336`) renders exactly that string for the
Upcoming bucket — accurate for Upcoming, but the wiki phrasing implies
it sits at the bottom of the whole tab. It actually sits directly
under the Upcoming section's card list. Minor positional precision fix.

P1-2. **Awaiting writeup empty-state behavior under-described.** Wiki
(line 101-108) correctly notes the bordered emerald "All recent
experiments have results logged" chip is rendered even when the section
is empty. But the section header itself ("AWAITING WRITEUP (0)") also
renders, with the section-help one-liner — the wiki implies only the
chip stays. Tiny precision fix.

P1-3. **Sub-task progress dots on list cards undocumented.** The
collapsed list card header renders `SubTaskProgressDots` when a list
has sub-tasks (`ExpandableListCard.tsx:357-362`,
`workbench/SubTaskProgressDots.tsx`). The wiki "Each card carries the
task name, a project color dot..." paragraph (line 222-229) misses the
progress dots strip entirely. Worth a one-line mention since it's the
at-a-glance progress signal.

P1-4. **Shared-into-me cards bypass the project filter — undocumented.**
Code (`WorkbenchExperimentsPanel.tsx:173-179`, with detailed comment
referencing the §6.16 cursor-demo regression / HR 2026-05-22): shared-
into-me experiment cards always render, owned cards stay subject to
the project pill selector. This is a deliberate, non-obvious behavior
the user could be confused by ("why does this card show when I filtered
to a specific project?"). Wiki has no mention. Fix: add a callout under
"The project filter pill strip" explaining shared-into cards skip the
filter (they live in the sharer's project namespace).

P1-5. **Comments thread on notes is undocumented.** `NoteDetailPopup.tsx:
1117-1120` mounts `NoteCommentsThread` inside every open note (both lab-
mode read-only and regular mode). The Lab Inbox wiki page covers comments
generally, but the Notes tab section never mentions that notes carry a
comment thread. Fix: add a one-liner cross-link to
`/wiki/features/lab-inbox/comments` from the Notes tab section.

P1-6. **Lab Head edit-session + flag-for-review on notes is
undocumented.** `NoteDetailPopup.tsx` integrates `useLabHeadEditGate`,
`EditSessionBanner`, `RequestEditButton`, `FlagForReviewButton`, and
`AuditTrailNotice` (lines 96-114, 720-813). The Lab Head wiki tree
covers these generically, but the Notes tab section never says these
soft-write surfaces apply to notes specifically. Fix: add a callout
under "Notes" cross-linking `/wiki/features/lab-head/soft-write-actions`
and noting notes participate (no assign — that's Task-only).

P1-7. **SharingChips on notes are undocumented.** `NoteDetailPopup.tsx:
861-869` renders the unified `SharingChips` row showing who currently
has access (added in the Lab Mode retirement R1b commit). Wiki only
talks about the "Shared with lab" toggle button. Fix: mention the
read-only visibility chips row alongside the toggle.

## P2 findings

P2-1. **Workbench page subtitle copy is undocumented but stable.** The
header subtitle ("N experiments in flight", "N list tasks on your
plate", "Meeting notes and running logs") is a small UX flourish
nobody's going to be confused by, but if the wiki wants to be complete
it could mention it. Optional.

P2-2. **"Earlier results" Flat / By project toggle: persistence is
undocumented.** Code (`WorkbenchExperimentsPanel.tsx:135-137`): the
layout state is local React state (not localStorage), so a page reload
resets to "Flat". Not user-facing critical but worth one sentence so
people don't expect persistence.

P2-3. **Recent results project sub-grouping threshold.** Wiki (line
110-117) correctly says "two or more projects" triggers the project
sub-headers; code matches (`length >= 2`). Verified accurate — keep.

P2-4. **Project filter pill colors are dim when "deselected" / not in
the active set.** Worth one line: the bg-gray-100 / gray-400 styling
of inactive pills is the visual signal. Optional polish.

P2-5. **The `data-current-tab="experiments"` and `data-current-tab=
"lists"` root attributes** (`WorkbenchExperimentsPanel.tsx:482`,
`WorkbenchListsPanel.tsx:284`) drive the onboarding tab-gate. Not user-
facing, no wiki action needed — flagged here only so future audits
don't mistake them for missing coverage.

## Notes

- `APP_ROUTE_TO_WIKI` correctly maps `/workbench` → "The Workbench"
  (slug `/wiki/features/experiments` for legacy URL stability) and
  `/workbench/projects` → "Project Surface". The prefix-walker
  resolves `/workbench/projects/<id>` correctly via `/workbench/projects`.
- `/experiments` is deliberately not mapped (`router.replace("/workbench")`
  stub, no AppShell). The comment in `nav.ts:12-14` is accurate.
- The page title "The Workbench" on `/wiki/features/experiments` is
  legacy-slug-but-correct-title — leaving the slug alone (would break
  external links from old docs and old commits).
- `workbench-lists.png` screenshot has a stale-asset TODO comment
  (`experiments/page.tsx:230`): "needs recapture: predates inline
  expand". Wiki capture pipeline should regenerate that screenshot.
- The four-tab popup section (Details / Lab Notes / Method / Results)
  is accurate as written and matches `TaskDetailPopup.tsx:558` tab
  list for experiments. The Export, Share, fullscreen, Delete header
  affordances are correctly enumerated.
- Methods/Variation/PCR sections covered in this wiki page are a
  cross-link concern for the Methods audit (separate stream); the
  surface-level "this is what you see" claims are accurate from the
  Workbench side.

— wiki audit: workbench
