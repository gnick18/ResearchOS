# Laptop-native redesign sweep + awaiting-Grant verification pass (2026-06-20)

Owner: the "Icon Lib" orchestrator session, continuing after the 2026-06-19 icon-lib
electronics handoff. This session did two things: verified and signed off the
awaiting-Grant items from that handoff, then established and applied a new standing
design rule (redesign stretched pages to fill the laptop width, never narrow them).
Everything below is on origin/main and live unless marked otherwise. House style
throughout: no em-dashes, no emojis, no mid-sentence colons.

## TL;DR state

- Verification pass on the icon-lib handoff section 5 is DONE and recorded in that
  handoff (commit `349026150`). The agent-verifiable items are signed off; the rest are
  genuine human-judgment items that stay with Grant or their owning lanes.
- New STANDING RULE locked by Grant (memory `[[feedback_laptop_native_redesign]]`): when
  a full-width page reads sparse or stretched on a laptop, REDESIGN the data presentation
  to fill the width, never drop the container to `width="wide"`. Build laptop tools, not
  phone-stretched ones.
- Three pages redesigned to that rule and SHIPPED to prod: People, lab-overview, approvals
  (the last via the shared OrdersApprovalsLens, so /supplies gains it too).
- A full-width audit of every swept page was run; only the three above needed work, the
  rest already earn their width.
- Nothing of mine is mid-flight or blocked.

## 1. The standing rule (read this first)

Grant, 2026-06-19, reviewing the page-width sweep. A stretched full-width page is a signal
the PRESENTATION is underbuilt, not that the page is too wide. The fix is a redesign that
makes the width carry real information (denser multi-column tables, more columns per row,
side-by-side panes), never a skinnier container. ResearchOS is a laptop and desktop tool,
design like one. Full record in `[[feedback_laptop_native_redesign]]`. Per
`[[feedback_ui_review_interactive_mockup]]`, hand Grant a clickable before/after HTML
(light by default) before touching code on a redesign.

## 2. Awaiting-Grant verification pass (icon-lib handoff section 5)

Done on Grant's live :3000 via Chrome plus code-read plus unit tests. Recorded in
`docs/handoffs/2026-06-19-icon-lib-electronics-and-orchestration-handoff.md` section 5.

- DONE (signed off): permanent gate sign-out (live, top-right on /admin gate and the
  account gate, with a "Back to the app" escape, no soft-lock); /admin operator gating
  (live, non-operator blocked); /admin widen (`OperatorShell.tsx` `max-w-screen-2xl`);
  two-column folder gate (`FolderConnectGate.tsx` `lg:grid-cols-2` + `overflow-y-auto` +
  `max-w-4xl`, two columns only when there is a recent folder to resume); page-width sweep
  mechanical half (7 full + 3 wide pages carry the right prop); trial-countdown logic
  (7/7 unit tests pass).
- SUPERSEDED (not this lane's to verify): the /admin tab order + Finances sub-grouping I
  shipped (6 tabs) was REPLACED by the later "admin 7-group IA reorg" (pepper clean-slate
  lane). Current live IA is Dashboard, Accounts, Metrics, Finances, Compliance, Pricing,
  Comms. Verify that under its own lane.
- STILL GRANT (cannot be automated): page-width "reads sparse?" was resolved by the
  redesigns in section 3 below (the answer was redesign, not narrow); trial banner visual
  at a live lab trial; onboarding cursor glide (live rAF); Stripe-test refund and dispute.

## 3. Laptop-native redesigns shipped (all on origin/main, live)

A full-width audit was run in the demo lab (lab-head view). Result: lab-experiments and
lab-work already fill the width (card galleries), lab-notes is acceptable (list with
substantial descriptions), funding already earns its width. Three pages needed work.

- **People page** (`frontend/src/components/people/PeoplePage.tsx`, commit `a3a91427c`).
  The thin left-clustered list became a full-width roster table. Columns: Member (avatar,
  name, PI/You/Archived badges, handle), Workload (shared-scale bar plus open and overdue),
  IDP (on-file with last-updated date, or missing), Cloud seat (shown ONLY when billing is
  populated, so no dead column), and a per-row Check-ins jump. Row click still opens the
  member panel; the `data-testid` and tutor hooks moved onto the `<tr>`. RosterRow has no
  per-member last-active field, so that column was intentionally dropped rather than faked.
  Before/after mockup at `docs/proposals/2026-06-19-people-roster-laptop-redesign.html`.
- **lab-overview** (`LabOverviewPage.tsx` + the two widgets, commit `a3a91427c`). The bottom
  was lab activity at two-thirds beside a short one-third People column, leaving a tall void
  on the right. People is now a full-width workload strip (responsive grid of member cards,
  new `surface="strip"` variant in `MemberWorkloadWidget`) and lab activity spans the full
  width with its date groups flowing into responsive columns (new `wide` prop in
  `LabActivityWidget`, gates a `lg:columns-2 xl:columns-3` flow). Both new behaviors are
  prop-gated so the dashboard-canvas widget usages are unchanged.
- **approvals** (`frontend/src/components/supplies/OrdersApprovalsLens.tsx` +
  `ApprovalsPage.tsx`, commit `1c9790e13`). The worst offender, a roughly 900px empty band
  per row. Each approval item is now an aligned multi-column row: Item (plus catalog or
  CAS), Vendor (plus funding string), Qty, Unit price, Line total, then the Approve /
  Decline / Flag controls. The flag queue on /approvals got the same treatment, spreading
  the flag reason across the middle. OrdersApprovalsLens is shared, so the /supplies
  lab-head lens gains the columns too. Same data and controls, presentation only.

Verification for all three: tsc clean, lab-overview tests 37/37, approvals-lens tests 7/7,
member-panel and row interactions intact, no console errors, no new glyphs (all existing
registry icons, icon-guard pre-commit hook passed on every commit). funding was left as is.

## 4. Shared-tree hazard hit live this session (learnings)

While committing and pushing, the badges lane was actively switching the shared PRIMARY
checkout between `main` and `feat/researcher-badge-publish-path` and committing into it.
Consequences and the clean recoveries:

- My approvals commit first landed on the badges branch (the checkout had been switched out
  from under me), with their phase-2 commit later stacked on top of it. Recovery, since my
  commit's parent was exactly main's tip, was `git branch -f main <mycommit>` to
  fast-forward main by my one commit only, leaving the badges commit on its own branch. No
  working-tree change, no touching their work.
- The tree showed badge-lane tsc errors (`earnedBadgeIds` / `pinnedBadgeIds` /
  `badgeSnapshotJson` missing) that were NOT mine. I verified main itself in an ISOLATED
  throwaway worktree (`git worktree add` on main, symlink node_modules, tsc) and confirmed
  main was 0 errors. Do this before any push when the shared tree is being churned by
  another lane, the primary checkout's branch is not reliable.
- Push was rejected twice for non-fast-forward as origin/main moved under other lanes'
  pushes. Each time the divergence was integrated and re-verified before pushing.
- Final state landed clean: main typechecked 0 errors with my approvals commit plus the
  badges lane's merged work, and pushed (origin/main was `e5aa24c51` at push time, has moved
  since as other lanes land).

Lesson reinforced (`[[feedback_isolated_worktree_for_shared_trees]]`,
`[[feedback_verify_merged_tree_before_push]]`): never trust the shared primary checkout's
current branch during a multi-lane night, verify the MERGED main tree in an isolated
worktree before pushing, and when a commit lands on the wrong branch, prefer a ref
fast-forward over history surgery. A cross-lane nudge to the badges lane to move into an
isolated worktree is the standing suggestion if this recurs.

## 5. NEXT (nothing in flight)

- The laptop-native rule now governs future "looks stretched" pages, redesign, do not
  narrow. funding stays full. If new dense full-width pages appear, audit them the same way.
- Remaining genuine-Grant items from section 2 (trial banner visual, onboarding cursor
  glide, Stripe refund and dispute) belong to Grant or the Billing and BeakerAI lanes.
- The /admin 7-group IA reorg verification belongs to the pepper clean-slate lane.
