# Head bot report — 2026-05-27 morning + midday

Status report from the orchestrator manager handing off mid-session.
The `docs/HANDOFF_2026-05-26.md` doc has the long-arc orientation
(orchestration patterns, memory rules, file pointers); this report is
the **delta since that doc was written**.

---

## What's actively in flight

**Grant is running a tour-script editorial pass against
`docs/proposals/BEAKERBOT_TOUR_SCRIPT_REWRITE_2026-05-27.md`** (he
pinned this doc as source-of-truth in commit `47c082c6`). The pass is
landing in waves directly into step body source files. Six waves have
landed so far:

- Wave 1 (`372fcb1e`): structural rework — dropped 8 steps, added 7
  skeletons, wired the registry. The 7 new steps have IDs in
  TOUR_STEP_ORDER but their step body files may still be skeletal;
  worth a check before they ship visually.
- Wave 2B (`2cde1e72`): methods + workbench experiment speech rewrites
- Wave 2C (`1a7e1ec3`): hybrid editor + notes/lists speech rewrites
- Wave 2D (`b736d7b3`): Gantt speech rewrites
- Wave 2E (`48f21c12`): settings + search + wiki pointer speech rewrites
- Wave 2F (`349c0d66`): conditional steps + cleanup + goodbye speech rewrites

Grant has been **hand-editing the step body files directly** rather
than handing the doc back for an inverse-apply (the workflow we
originally designed). System reminders on
`HybridNotesVsResultsStep.tsx`, `HybridImageDragInStep.tsx`, and
`HybridImageResizeStep.tsx` show his direct edits. **Don't auto-apply
the BEAKERBOT_TOUR_SCRIPT_REWRITE doc** — Grant is iterating wave by
wave himself, with sub-bots dispatched per wave doing the
file-touching work. If he hands you a new wave, dispatch a sub-bot to
apply just that wave's edits.

Open question worth surfacing if he doesn't bring it up first: are
there more waves coming (2A, 2G, etc.) or is this complete? The
wave numbering suggests 2A might be missing.

---

## Just landed (this session, since the prior handoff)

### User-rename owner-field propagation (`233d954c` + `537c8e2e`)

**Root-cause fix** for a real product bug Grant identified: when a
user renames their folder, the prior code (May 23 fix `URGENT: User
rename leaves stale file handles`) renamed the directory and updated
`_user_metadata.json` but did NOT propagate the rename into the
`owner` / `username` / `created_by` / `shared_with[].username`
fields inside the entity JSONs. Result: every task / project / goal
/ method authored before the rename got orphaned from the data path,
because `taskResultsBase(task)` literally interpolates `task.owner`
into the storage path.

The new `propagateOwnerRename(oldName, newName)` helper at
`frontend/src/lib/users/propagate-rename.ts` walks 3 scopes:
1. Own directory: `owner`, `username`, `created_by`, `assignee`,
   `approved_by`, `declined_by`, `flagged.by`, `external_project.owner`,
   `method_attachments[].owner`, `comments[].author`,
   `comments[].mentions[]`
2. Other users' directories: `shared_with[].username` entries
3. Public namespace: `created_by` on `users/public/*.json` entities

Wired into `usersApi.rename` between metadata migration and
currentUser update. Idempotent (re-running is a no-op), best-effort
per entity (logs + continues on failure, never aborts the rename).
19 tests added at `frontend/src/lib/users/propagate-rename.test.ts`,
all pass per sub-bot's verified run.

**Validation status: PENDING.** This is a data-shape touch; Grant
hasn't yet exercised it on real disk. Recommended validation path:
rename a scratch user (`Test_Walkthrough` or `Test-2`) → confirm
propagation works end-to-end. Then if confident, rename
`Grant_Nickles` to something temporary, verify task 76 still loads,
rename back.

### Manual fix on Grant's real folder (NOT code, data only)

Before the propagation fix existed, Grant hit the symptom on task 76
(`Master-bot orchestration arc`): notes.md + results.md on disk but
the popup rendered empty. Root cause was the stale `owner` field
problem above. **Surgical fix applied to 7 stale entity files** in
Grant's real folder via `sed`:

```
tasks/63.json, tasks/69.json, tasks/76.json, tasks/77.json,
projects/11.json, goals/4.json, goals/5.json
```

All had `"owner": "GrantNickles"` (without underscore) when the
directory is `Grant_Nickles`. Replaced to `"owner": "Grant_Nickles"`
to match. Confirmed via grep that no other stale references exist in
his folder. This was a one-off repair; the code fix above prevents
future orphans on rename.

### Task 76 (`Master-bot orchestration arc`) backfilled with May 12-26 record

Grant asked to flesh out the experiment in his real folder:
- `tasks/76.json` metadata: name + end_date + duration_days updated
  (Grant later extended end_date to 2026-06-01 himself)
- `results/task-76/notes.md` (132 → 326 lines): 7 new daily sections
  added for Wed May 20 through Tue May 26, with the May 26 section
  capturing the v4 fresh-user walkthrough bug parade (~20 commits
  with one-line context each), the VCP design + R1-R3 implementations,
  Hybrid editor model overhaul, tour script doc + handoff doc
- `results/task-76/results.md` (79 → 200 lines): new top-line section
  with the 5 things-that-matter-most + new Week 2 section with
  headline outcomes + 40+ key SHAs grouped by area + new process
  artifacts section

This was real-folder writing, not git. Grant explicitly asked for it.

---

## Backlog / open items

- **Tour-script editorial pass: more waves likely coming.** Wave 2A
  is conspicuously absent from the wave letters that landed (2B, 2C,
  2D, 2E, 2F). Either it landed before the prior handoff under a
  different label, or it's still queued. If Grant hands you any
  wave-prefixed work, dispatch a sub-bot per wave.

- **User-rename propagation verification** (as noted above) — needs
  real-folder exercise before we'd call it shippable.

- **The 7 Wave-1 NEW skeleton steps** may need cursor demos or
  completion contract wiring. If Grant reports that any of them have
  empty speech bubbles or no advance affordance, that's the cause.

- **Mira-as-PI Batch 2 personas** (task tracker #188, still
  `pending`) — 5-persona break-bot panel for the Mira-substrate
  walkthrough. Awaiting Grant's green light.

- **The `frontend/node_modules` symlink situation** — I removed a
  symlink from git in `fb0c0846` to clean up an accidental commit,
  but it turns out the symlink was load-bearing for local test runs
  (it pointed at a shared dependency cache). Tests still pass in the
  sub-agent worktrees because they have their own `node_modules`;
  but `npx vitest` from the master repo's `frontend/` will hit
  `ERR_MODULE_NOT_FOUND` until Grant runs `pnpm install` (or
  equivalent) to restore the local install. Not a code issue, just
  a local-dev workflow note. Don't try to recreate the symlink by
  hand — auto-mode classifier (correctly) flags that.

---

## Standing rules to internalize fast

(Repeated from the prior handoff because they're load-bearing.)

- No emojis in user-facing UI (every icon is a custom inline SVG)
- No em-dashes in any prose you write (commas / colons / parens / period splits)
- `Tooltip` component, not native `title=`
- Mascot is "BeakerBot" everywhere
- "PI" not "Lab Head" in user-facing copy (lab_head stays as a field name internally)
- Clickable-option questions, not free-form prose, when asking Grant a question
- UI merges to local main on report; backend / data-shape work waits for verification
- Sign off as "orchestrator manager" in commits, PR/spawn_task prompts, and chat
- Screenshots: fixture data only, never the real research folder
- "Commit early and often" in every sub-bot brief (wifi-watchdog resilience)
- "Use `npx vitest run`, not `pnpm test`" in every sub-bot brief (pnpm hits a consent prompt on this machine)

Full memory index at
`~/.claude/projects/-Users-gnickles-Desktop-ResearchOS/memory/MEMORY.md`.

---

## Tone

Grant works fast and reads at speed. Match:
- Lead with what you did (commit hash, what changed)
- Tables > paragraphs for multi-item updates
- Push back if an ask conflicts with a memory rule
- Surface sub-bot design calls via `AskUserQuestion` clickable options
  rather than waiting for Grant to spot them in long reports

Good luck.

— orchestrator manager (handing off 2026-05-27 12:30pm)
