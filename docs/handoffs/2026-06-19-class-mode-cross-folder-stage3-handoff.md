# Handoff: Class Mode + cross-folder, through Stage 3 kickoff (2026-06-19)

Owner: orchestrator/Class-Mode lane. Read this with the authoritative scope doc
`docs/proposals/2026-06-19-class-mode-and-cross-folder-scope.md` (the full design +
the reconciled second-pass addendum + Grant's locked decisions) and the memory
`project_class_mode_cross_folder`. House voice: no em-dashes, no emojis, no
mid-sentence colons.

## TL;DR, where to pick up

UPDATE at handoff time: CT-1 LANDED and is MERGED + PUSHED (commit `07598432a`,
merged at `2da59ca03`). Only ONE Stage-3 lane is still in flight:

- `claude/class-ct5-dashboard` (worktree `.claude/worktrees/class-ct5-dashboard`) —
  the CT-5 + CT-3 class config / dashboard record lane. As of this handoff it had
  NOT committed (branch tip still at the branch point `2218ea23c`), so it was either
  still running or stalled when the session ended.

FIRST ACTION for the next agent: check whether the `class-ct5-dashboard` background
agent finished. Run `git -C .claude/worktrees/class-ct5-dashboard log --oneline -3`
and `git -C .claude/worktrees/class-ct5-dashboard status`. Three cases:
1. It committed cleanly -> integrate per the "Integration recipe" below (it touches
   `lab-read.ts` for the `isLabWidePublic` extension, expect that to sit on top of
   C1's `recordSharedWith`; also CT-1 already merged so re-check `lib/nav.ts` /
   `class-chrome.ts` if CT-5 touched nav, low risk).
2. It has uncommitted work but died -> inspect, finish/commit it, then integrate.
3. The worktree is empty/untouched -> re-dispatch using the CT-5 brief in
   "In-flight lane briefs" below (verbatim, self-contained; re-anchor to current
   `main` HEAD).

THEN: dispatch the queued per-student-subkey crypto lane (CT-2 + CT-4 + subkeys),
brief in "Queued next" below.

CT-1 (now merged, for reference): shared class materials. `wholeAudienceCopy` copy
switch in `ShareDialog` (new `classContext` prop), a `/class-materials` page +
`filterOwnClassMaterials` filter, and a class-only "Class Materials" nav entry in
`buildLabLensItems`. Reuses the `"*"` grant entirely, no data-shape change.

## What is DONE, merged, and pushed (the whole arc up to Stage 3)

All flag-gated and INERT until the flags flip (`NEXT_PUBLIC_CLASS_MODE`,
`NEXT_PUBLIC_MULTI_FOLDER`, `NEXT_PUBLIC_CROSS_FOLDER`, `NEXT_PUBLIC_LAB_AS_FOLDER`).
All on `origin/main`.

- SCOPE: `docs/proposals/2026-06-19-class-mode-and-cross-folder-scope.md` (full
  spec + 3-critic second pass + Grant decisions + the Stage-3 H1 route-gate audit).
- STAGE 1 (data spine): `class` folder kind (`RememberedFolderLabRole +
  "class"|"student"`), `UserSettings.lab_kind` + `classConfig`, `isClassFolder`
  (`lib/lab/lab-mode.ts`), `useIsClassMode` hook, `provision-class-folder.ts`
  (OPFS, ordering-invariant, `navigator.storage.persist()` H4 durability),
  `class-mode-config.ts`. PI-context-lost fix (banner + validated seed-on-connect
  via `record.head` check). Cross-folder Strategy-A store refactor (additive
  `ctx` on `json-store.ts`, `materializeNoteToDestination`,
  `local-folder-transfer.ts` copyObjectToFolder NOTES-only, `FolderDestinationPicker`,
  member-folder destinations refused C7).
- PHASE 2 (chrome): create-a-class flow + `CreateClassModal` (any account incl
  solo, Grant decision); `class-chrome.ts` resolvers, AppShell "Class" lens +
  "Class Overview" label + nav-hide research-only items, BeakerBot PI-suite
  suppressed in class, class head lands `/workbench` not `/lab-overview`; per-kind
  folder COLOR pills + NICKNAMES (`folderKindBadge`, `folderDisplayName`,
  `setRememberedFolderNickname`).
- GLYPHS (Grant-approved, in the icon registry): `mortarboard` (class/student),
  `user` (solo), `crown` (lab head). `folderKindIcon()` maps labRole -> icon,
  wired into switcher rows + collapsed trigger + nickname-edit row.
- PALETTE (Grant signed off): solo=brand-ink, head=brand-lead GOLD (#a16207),
  member=brand-purple, class=brand-teach TEAL (#0f766e), student=brand-learn ROSE
  (#be123c). Tokens in `globals.css` `@theme inline`.
- LABEL: the class instructor side reads "Instructor" (paired with "Student"),
  display-only, the `class` role value is unchanged.
- CROSS-FOLDER BREADTH: two-handle copy/move/bulk for note + sequence + calculator
  (the light types that fit the `ctx` seam). HEAVY types (method/experiment/project)
  REFUSED cleanly (their import-apply layer ~1000 lines is singleton-bound, a true
  two-handle is its own refactor lane). Missing-type collectors refused via
  `CrossFolderCopyError`. MOVE = copy -> await -> trash-via-per-entity-delete ->
  verify-gone. Bulk per-item results. `CopyMoveToFolderButton` + `BulkTransferDialog`
  + the UnifiedShareDialog "Another folder of mine" section. Per-row right-click
  wiring deliberately NOT done (components ready to mount).
- STAGE 3 C1 (the unblock, merged `2218ea23c`): `pullLabView` `recordSharedWith`
  now expands the `"*"` WHOLE_LAB_SENTINEL against the roster (`params.owners`),
  so whole-class shares reach members. Server-blind preserved, own-record path
  untouched, not class-flag-gated (benefits all labs). `lib/lab/lab-read.ts` +
  `lab-read.test.ts` (13 tests).

## In-flight lane briefs (re-dispatch verbatim if the worktrees are empty)

Both off main anchor `2218ea23c` (now `0f7ef92a5+` after a parallel session
commit, re-anchor to current `main` HEAD when re-dispatching). Standard worktree
discipline preamble applies (own worktree, symlink node_modules for the tsc/vitest
gate, never touch main checkout, commit-not-merge-not-push, the grants/* tsc
errors are pre-existing and NOT yours so gate on `grep -vE "admin/grants"`).

### CT-1 `claude/class-ct1-materials` (shared class materials)
Behind CLASS_MODE. (a) In `ShareDialog.tsx`, when `useIsClassMode()` is true,
relabel "Share with the whole lab" -> "the whole class" and the roster preview to
"All N students" (COPY switch only, the `"*"` grant logic is unchanged). (b) A
"Class Materials" panel + a class-only nav entry (the `SOCIAL_LAYER_ENABLED`
conditional-entry pattern in `lib/nav.ts`) listing the instructor's own records
where `isWholeLabShared(shared_with)` is true (`unified.ts:248`), each with a
share/unshare-with-class toggle that flips the `"*"` entry. (c) Materials are
NOTES/datahub records (they carry `shared_with` and now reach students via C1).
Do NOT invent a file ACL. Sequence-whole-class-sharing (sequences have no ACL,
`UnifiedShareDialog ~105`) is a documented FOLLOW-UP, not a build item. Tests +
flag-off parity. Do NOT touch `lab-read.ts`.

### CT-5 + CT-3 `claude/class-ct5-dashboard` (class config relay record)
Behind CLASS_MODE. A new lab-wide-public relay record TYPE `class_dashboard`
(instructor-owned, well-known key, E2E under the team key). Extend the
`isLabWidePublic` guard in `lab-read.ts` (the `announcement` precedent ~204-212)
so `class_dashboard` is surfaced to every roster member. Payload (consolidates
CT-5 + CT-3): `{ tabs?, landingTab?, intro?{title,body}, enabledTools?,
enabledMethodTypes?, visibilityDefault?:"collaborative"|"private", rev }`. FORCE-only
v1 (NO per-student customization store, NO apply-banner). "Dashboard" = the curated
WORKBENCH (`app/workbench/page.tsx` tab strip), NOT the torn-down widget grid.
Instructor authoring panel (class LabOverviewPage / class settings, class-head
gated) writes via `putLabRecord` (`lab-data-client.ts`). Student `app/workbench`
FORCE-applies the template (tabs/landing/intro), absent = today's hardcoded
default (the `resolveEnabledMethodTypes` ABSENT-is-all-on contract,
`lib/methods/method-type-enablement.ts`). `visibilityDefault` seeds a new student
record's create-time `shared_with` in a class ("collaborative" => `["*"]`,
"private"/absent => empty). FLAG every data-shape touch. Tests + flag-off parity.
NOTE: this lane touches `lab-read.ts` (same file as C1, already merged), so when
integrating, expect the `isLabWidePublic` edit to sit cleanly on top of C1's
`recordSharedWith`.

## Integration recipe (how this session merged every lane)

From the main checkout on `main`:
1. `git fetch origin main -q`. If behind, `git merge origin/main --no-edit`. If a
   merge is blocked by another session's UNTRACKED file that is identical to
   origin's committed copy, `rm` the local untracked copy then re-merge (verify
   identical first with `git show origin/main:<path> | diff -q - <path>`). Do NOT
   touch other sessions' uncommitted tracked changes.
2. `git merge --no-ff --no-edit <lane-branch>`; check `git diff --name-only
   --diff-filter=U` for conflicts.
3. Gate: `cd frontend && npx tsc --noEmit` (filter `grep -vE "admin/grants"`, those
   errors are a different lane's and self-heal) + `npx vitest run --project node
   <the lane's touched dirs>`. Both must be clean.
4. `git push origin main` (re-merge origin first if behind). Never force-push main.
5. `git worktree remove --force .claude/worktrees/<lane>` + `git worktree prune`.

## Queued next: the per-student-subkey crypto lane (CT-2 + CT-4)

This is the FERPA-grade piece Grant approved ("build per-student subkeys"). It is
the heaviest and most correctness-sensitive, so it gets its OWN focused lane (do
NOT race it with other lanes). Design (from the scope doc, critic findings C2 + C3):

- CT-2 ASSIGNMENT (re-authored per critic C2): an assignment is an INSTRUCTOR-OWNED
  shared record (under the instructor's own owner-prefix, `shared_with ["*"]` or
  per-student), NEVER a write into a student's `users/<student>/` space (that
  violates residency and the student's own sync would tombstone-delete it). The
  per-student NOTEBOOK is a SEPARATE student-owned record the student creates on
  first open, linked by `assignment_id`. Invariant to encode: no actor ever authors
  a record under another user's owner-prefix.
- CT-3/CT-4 PRIVACY (critic C3, the gating safety call): a student's private
  notebook CANNOT be private under the single class team key (every classmate holds
  it and `/lab/data/get` is open at transport). Build PER-STUDENT SUBKEYS: encrypt a
  student's private notebook under a subkey held only by that student and the
  instructor (PI co-owner), not the class team key. This is real crypto work in
  `lib/lab/lab-key.ts` / the seal path. Until it ships, Class Mode must NOT be used
  for graded/private student work (Grant's decision was to build the subkeys).
- CT-4 SUBMIT/REVIEW: a minimal `Task.submission?: { status, submitted_at?,
  submitted_rev?, instructor_note? }` (additive nullable). Grading stays in the LMS.

## Standing dependencies + open follow-ups

- SEAL-AT-SCALE (residency lane, NOT this lane): a 30-student LIVE demo needs bulk
  reseal (`reconcileDeferredSeals` is opportunistic-only today). The instructor-side
  Stage-3 build does not need it, but a real classroom demo does.
- HEAVY-TYPE cross-folder (method/experiment/project two-handle): thread `ctx`
  through `lib/sharing/import/apply.ts` + `project-apply.ts`, or a Strategy-B
  offscreen switch guard. Biggest remaining cross-folder lane.
- MISSING-TYPE cross-folder collectors (purchases, inventory, PCR, goals, figures,
  check-ins, phylo, datasets): a separate builder lane.
- SEQUENCE whole-class sharing: sequences have no ACL; decide add-an-ACL vs
  note-carrier (Owen's primer demo wants it).
- ROSTER lane (Stage 4, not started): manual roster (CSV/email paste + auto-invite)
  WITH the authenticated per-PI invite limiter (the current `getInviteLimiter` is
  10/IP/day, a class blast is impossible without it). Then Moodle/Canvas LMS.
- Cross-folder right-click / per-row entry-point wiring (components are ready).
- Genesis-retry follow-up: `LabGenesisPublishRetry` republishes without
  `suppressDirectory`, so a class whose genesis publish lands on a reload could make
  a public directory row. Thread a suppress flag into `PendingLabGenesis`.

## Verification state

- LIVE on PROD (`research-os.app`, MULTI_FOLDER on): the switcher renders the
  per-kind glyph + colored pill on real folders (verified on Grant's Solo folders).
- ON GRANT'S LOCAL :3000 (flags on, demo session): Create-a-class renders with the
  mortarboard glyph, the modal copy is correct, create-class SUCCEEDS + fires the
  H4 durability warning, the class "Class" lens activates. BLOCKED by demo mode:
  the class as a switcher row, switching, cross-folder copy (needs 2+ real folders +
  native FSA grant), PI-context banner. Those need a real non-demo signed-in session
  with 2+ real disk folders.
- HEADLESS worktree verify cannot do the OAuth-email + native-FSA flows.

## Gotchas / environment notes for the next agent

- SHARED-CHECKOUT CHURN: multiple sessions commit into this one `main` checkout and
  push to origin concurrently. Expect main to advance under you, untracked files
  from other lanes to block merges, and your own uncommitted edits to occasionally
  get swept into another lane's commit. Integrate from the main checkout carefully
  (recipe above) or from an isolated worktree; never touch other sessions'
  uncommitted/untracked files.
- The `src/app/api/admin/grants/__tests__/route.test.ts` tsc errors come and go from
  another lane; they are NOT yours. Always gate with `grep -vE "admin/grants"`.
- Grant's `frontend/.env.local` has the four `NEXT_PUBLIC_*` class/cross-folder/
  lab-as-folder flags turned ON (added this session for the Chrome verify, marked
  "safe to remove"). Leave or remove per Grant.
- A throwaway "Genetics 410" OPFS class was created in Grant's browser during the
  verify pass (harmless local cruft, cleared by clearing :3000 site data).
- Background sub-agents launched with `run_in_background` are tied to the spawning
  session and may not survive it. Check the branch/worktree state rather than
  waiting on a notification that may never come.

## Key anchors

- Scope: `docs/proposals/2026-06-19-class-mode-and-cross-folder-scope.md`
- Class-mode pilot intel (Owen Sullivan): `docs/proposals/2026-06-17-class-mode-teaching.md`
- Multi-lab substrate (P2/P3 shipped): `docs/proposals/2026-06-18-multi-lab-build-spec.md`,
  `docs/handoffs/2026-06-19-multi-lab-membership-handoff.md`
- Memory: `project_class_mode_cross_folder` (the running state + all decisions)
- Badges-lane integration contract (Buisness Boi): at Stage-3 awarded-grant
  transport, ping them to wire read-grants -> awardedBadgeIds (per-student shared
  record under the team key).
