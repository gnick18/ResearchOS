# Lab Tier Phase 7: migrating multiuser folders to one-folder-one-user

Status: DRAFT for sign-off (SHARING + COLLAB manager, 2026-06-08). Prioritized at Grant's request: his folders are all multiuser today and the multiuser/OneDrive overhead is the pain the whole pivot exists to remove. Grant confirmed he is effectively the primary user (labmates inactive), so the safe fast path is open.

Sibling docs: `LAB_TIER_REDESIGN.md` (the pivot + five locked decisions), `LAB_SESSION_PHASE5.md` (the lab session). This doc covers ONLY the migration off the old model.

## The key reframe: Phase 7 is TWO things, only one is urgent

1. The MIGRATION (7a, prioritized here): convert a multiuser folder into one-folder-one-user. This can be NON-DESTRUCTIVE and RECOVERABLE, and it does NOT depend on the lab tier (Phase 5/6). This is what gives Grant relief now.
2. DELETING multiuser support from the code (7b): rip out the multi-tenant read paths and UI. This MUST stay last, after folders are migrated AND the lab tier works, because it is irreversible and removes the fallback. Out of scope for the near term.

Conflating these is the trap. We build 7a soon and hold 7b.

## The elegant part: the app already treats a one-user folder as solo

`lib/lab/lab-mode.ts` already DERIVES solo-vs-lab from the folder's user count: `isLabModeFolder({ userCount, anyLabHead })`, and `deriveWorkspaceAccountType({ isLabMode })` returns `"solo"` when it is not lab mode. `discoverUsers()` (`lib/file-system/user-discovery.ts`) enumerates the `users/<owner>/` directories.

So we do NOT need a new "this is a solo folder" marker or a new on-disk layout. A folder with exactly ONE `users/<owner>/` directory is already, by the existing derivation, a solo folder. The migration's whole job is therefore to REDUCE a multiuser folder to a single user. The primary user's data stays at exactly the same `users/<me>/...` paths (the layout that is load-bearing across ~106 files), so there is zero data-shape change for the person who keeps the folder.

## What the migration does (7a)

Given a connected multiuser folder, for the primary user (the connecting `mainUser`, confirmed in a preview):

1. DETECT: `discoverUsers()` returns more than one user.
2. IDENTIFY the primary user (the connecting account). Confirm in a preview that lists every other user that will be moved out.
3. SPLIT, non-destructively:
   - The primary user's `users/<me>/` stays in place, untouched.
   - Each OTHER `users/<other>/` is EXTRACTED into a portable single-user bundle (its own one-folder-one-user export) that Grant can hand to that person, who can then connect it as their own solo folder. This is the true one-folder-one-user split, not a deletion.
   - The originals are then removed from the active folder via the existing trash-not-delete primitive (`lib/migrations/trash.ts`, `trashFile`), so they are RECOVERABLE in-place if anything looks wrong.
4. RESULT: the folder now has one user. The existing `isLabModeFolder` derivation flips it to solo automatically. No multiuser UI, no per-user overhead, fast.

The primary user notices only that the lab/multi-user surfaces disappear and the folder is faster. Their own data is byte-for-byte unchanged.

## Why this is safe

- Non-destructive + recoverable: every moved user goes through trash-not-delete (the same recovery posture as the existing destructive-but-recoverable migrations in `lib/migrations/registry.ts`). Nothing is hard-deleted.
- No data-shape change for the keeper: the primary user's records are not rewritten, just left alone. The migration only touches OTHER users' directories.
- Decoupled from the lab tier: this runs on the existing model with no dependency on Phase 5/6. Collaboration is re-added later via the lab tier's R2 sync; it is not lost here because (Grant's case) it is not actively in use.
- Deliberate, not silent: because it moves other people's data, this is a USER-TRIGGERED action with a preview + confirm, NOT a silent auto-run-on-connect migration. It reuses the migration toast/runner plumbing but gates on an explicit click.

## Cross-owner loose ends to handle

Reducing to one user leaves dangling cross-owner references. The existing archived-users mechanism (`useArchivedUsers`, user metadata `deleted_at`/archived flags) already renders references to absent users gracefully, so these degrade rather than break, but the design must decide each:

- Tasks/projects the primary user OWNS that reference another user (assignee, dependency, mention): keep the reference, it resolves to an archived user (handled today). No rewrite.
- Records OWNED by a moved user that the primary user was reading via the lab view: those leave with that user's bundle. The primary loses read access to them (correct, they belong to that person now).
- Shared constructs (`shared_with`, shared notebooks, 1:1 notebooks, cross-owner method shares): these straddle two owners. Options per construct: (a) strip the share (cleanest), (b) keep a read-only archived copy in the primary's folder, (c) carry it into the moved user's bundle. Recommendation: strip live shares, and since the moved user's bundle contains their side, nothing is lost.

## Build shape (7a)

- A pure-ish `lib/lab/migrate-to-solo.ts` planner: given `discoverUsers()` + the primary user, produce a MigrationPlan (which users move, which shared constructs are affected, what the bundles contain). Unit-testable against a fake file service.
- The executor: extract each non-primary user to a portable bundle (reuse the existing export path, `lib/export/extract.ts`) then trash the originals (`lib/migrations/trash.ts`). Idempotent and resumable.
- A preview + confirm UI (deliberate action), surfaced where folder/lab settings live, reusing the migration toast bus for progress.
- Mostly browser-free LOGIC (planner + executor are testable with a fake file service); the confirm UI + a real-folder dry run want a browser, but the dangerous part (the plan + the recovery posture) is unit-tested first.

This is buildable soon and largely independent of the Phase 5 browser arc.

## Open decisions for Grant

1. ARCHIVE DESTINATION for moved users: portable bundle Grant can hand off PLUS trash-not-delete of the in-folder original (recommended, true split + recoverable), versus just trashing them in place (simpler, but no clean hand-off to the labmate). Recommendation: bundle + trash.
2. SHARED CONSTRUCTS: strip live cross-owner shares on migrate (recommended) versus preserve read-only archived copies in the primary's folder.
3. TRIGGER: a deliberate "Convert this folder to single-user" action with preview/confirm (recommended) versus offering it automatically on connect when a multiuser folder is detected.
4. SCOPE NOW: build 7a (the migration) next, in parallel-safe slices, and keep 7b (deleting multiuser support from the code) for last after the lab tier works. Confirm.
5. GRANT'S OWN FOLDERS: do we target a specific real folder of Grant's as the first live dry-run (in a copy), and which one?
