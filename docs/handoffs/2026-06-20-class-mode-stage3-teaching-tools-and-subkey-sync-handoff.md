# Handoff: Class Mode Stage 3 teaching tools + subkey-aware sync (2026-06-20)

Owner: orchestrator / Class-Mode lane. Read with the scope doc
`docs/proposals/2026-06-19-class-mode-and-cross-folder-scope.md`, the subkey-sync
design `docs/proposals/2026-06-20-class-subkey-sync-integration.md`, the prior handoff
`docs/handoffs/2026-06-19-class-mode-cross-folder-stage3-handoff.md`, and the memory
`project_class_mode_cross_folder` (the full running state). House voice, no
em-dashes, no emojis, no mid-sentence colons.

## TL;DR

The entire Class-Mode + cross-folder arc through Stage 3 teaching tools is BUILT,
merged, and pushed, all flag-gated behind `NEXT_PUBLIC_CLASS_MODE` (off) and inert.
The FERPA-grade private-notebook privacy is real and end-to-end verified over the
actual sync/pull path. What remains is a small re-seal fast-follow, one UI mount, and
the operational lanes (seal-at-scale, Stage 4 roster) needed before a live classroom
demo. None of that is blocking the code being correct, it is the path to flipping the
flag.

## What landed this session (all on origin/main)

1. CT-5/CT-3 integration (`e301dd950`). The in-flight class_dashboard relay record
   lane from the prior session had committed cleanly, so it was gated, merged, and
   pushed. Instructor-set curated-Workbench template + create-time visibility seeding.
2. HEAVY-TYPE cross-folder (`74761bb5d`). Two-handle copy/move/bulk now covers
   method + experiment + project (the last refused types). New
   `lib/transfer/heavy-transfer.ts` mirrors the light-type seam (destination-scoped
   materialize via JsonStore + ctx), `import/apply.ts` untouched. No new data shape.
3. PER-STUDENT-SUBKEY crypto core + CT-2 + CT-4 (`a5ed7db59`). Pure cores:
   `lib/lab/lab-subkey.ts` (subkey sealed only to student + head, no team-key
   fallback on read), `class-assignment.ts` (CT-2 planner, instructor-owned, no
   cross-owner-prefix per critic C2), `class-submission.ts` (CT-4 state machine +
   dashboard data). Adversarially verified independently with real keys.
4. LIVE-WIRING (`8e4270ddf`). The cores wired into pi-actions/tasksApi/transport:
   `assignMethodToClass`, `submitNotebookForStudent`, `returnNotebookForStudent`,
   `ClassSubmissionsPanel` in LabOverviewPage, and the contained subkey transport
   `class-private-notebook.ts` (the double-seal write + the read resolver). The risky
   shared-sync integration was FENCED here.
5. SUBKEY-AWARE SYNC/PULL, the fence CLOSED (`ef831e69d`). Design doc reviewed +
   Grant decisions locked, then built. `resolvePulledClassRecord` slotted into
   `pullLabView`, the viewer x25519 priv read from `getSessionIdentity().keys` and
   threaded through `lab-view-pull-runner`, the private notebook partitioned OUT of
   the generic team-key push in `lab-sync-runner` (predicate
   `isPrivateClassNotebookRecord`, total, so the exclusivity invariant holds). E2E
   adversarial gate `lab-mirror-class-e2e.test.ts` proves a classmate holding the
   team key cannot read a private notebook over the REAL path, while the student and
   head can. Orchestrator-verified the assertions are strong.

Gate at every merge: tsc 0 (grants-filtered), the lab test dir green (now 917
passing). Each lane built in an isolated worktree, merged via the integration recipe,
re-verified on the merged tree before push, worktree swept.

## Grant decisions locked this session (subkey-sync)

1. Read x25519 priv from the live identity at call time, no new long-lived reference
   on the session state. DONE that way.
2. Seal NEW notebooks only, no migration of pre-existing team-key notebooks. DONE.
3. Identity-reset re-seal is a FAST FOLLOW, not folded in. See below.

## Where to pick up (remaining work, none blocking correctness)

- FAST FOLLOW, identity-reset re-seal. When a student resets identity, `readmitMember`
  (`lab-key.ts:592-636`) rotates the team key and re-adds them under a new x25519 key,
  but their existing subkey envelopes still seal to the OLD key, so they lose access
  to their own prior private notebooks until re-sealed. Add `reSealSubkeyForStudent`
  after `addMember` returns (the head co-holds every subkey, so re-seal is always
  possible). Small, well-scoped, design already sketched in the subkey-sync doc.
- UI MOUNT, the CT-2 student-open path. `SubmitNotebookButton` is built but NOT
  mounted, because the flow where a student first opens an assignment and gets their
  per-student notebook task is unbuilt. That flow should create the notebook via
  `writePrivateNotebookRecord` (the dedicated subkey path) and mount the submit
  button there. This is the last wiring gap for the student-facing loop.
- SEAL-AT-SCALE (residency lane, gates a LIVE demo not the code). A 30-student class
  needs bulk reseal, `reconcileDeferredSeals` is opportunistic-only today. Required
  before a real classroom demo, not before flag-on correctness.
- STAGE 4 ROSTER (not started). Manual roster (CSV/email paste + auto-invite) WITH
  the authenticated per-PI invite limiter (current limiter is 10/IP/day, a class
  blast is impossible without it). Then Moodle/Canvas LMS.
- HEAVY-TYPE cross-folder right-click / per-row entry wiring (components ready to
  mount). And the missing-type cross-folder collectors.

## Standing gotchas / environment

- SHARED-CHECKOUT CHURN. Multiple sessions commit into this one main checkout and
  push concurrently. main advances under you, untracked files from other lanes appear,
  your uncommitted edits can get swept into another lane's commit. Integrate from the
  main checkout via the recipe (fetch, merge origin if behind, --no-ff the lane,
  conflict-check the shared files, gate the merged tree, push) or from an isolated
  worktree. Never touch other sessions' uncommitted/untracked files. This session,
  Grant's working tree carried unrelated edits (next-env.d.ts, badges, two untracked
  docs) the whole time, untouched.
- The `admin/grants` tsc errors are a DIFFERENT lane's and self-heal. Always gate with
  `grep -vE "admin/grants"`.
- Run tsc/vitest from `frontend/`. Fresh worktrees need node_modules symlinked from
  main to run the gate.
- Everything is behind `NEXT_PUBLIC_CLASS_MODE` (off), so prod is unaffected.

## Key anchors

- Scope: `docs/proposals/2026-06-19-class-mode-and-cross-folder-scope.md`
- Subkey-sync design + locked decisions: `docs/proposals/2026-06-20-class-subkey-sync-integration.md`
- Crypto core: `lib/lab/lab-subkey.ts`; transport: `lib/lab/class-private-notebook.ts`
- Sync/pull integration: `lib/lab/lab-sync-runner.ts`, `lib/lab/lab-read.ts`,
  `lib/lab/lab-view-pull-runner.ts`; e2e proof: `lab-mirror-class-e2e.test.ts`
- Memory: `project_class_mode_cross_folder` (the full decision + state log)
