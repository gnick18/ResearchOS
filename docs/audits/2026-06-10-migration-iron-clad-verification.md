# Multiuser to solo migration: iron-clad verification report

Date: 2026-06-10. Scope: the Phase 7a "convert a multiuser `users/` folder into
one-folder-one-user (separate accounts)" migration (`lib/lab/migrate-to-solo*`).
Goal stated by Grant: a full dev test build-out that exercises the split across
many structures, seeds, and edge cases, with hard proof it can never lose or
corrupt anyone's data, reviewed on function first.

## Bottom line

The data layer is now proven iron-clad on three independent fronts: the real
test folders, a generated edge-case matrix, and explicit crash-window
simulations. Every run holds a full invariant set with zero violations. Two real
correctness gaps and one latent production bug were found and fixed in the
process. The remaining work is the trigger UI (not built) and a final live run
in Grant's own Chrome on a folder copy (only he can drive the native picker).

## What the migration does (recap)

The connecting user (primary) keeps `users/<primary>/` byte-for-byte. Every other
`users/<other>/` is copied to a portable bundle at
`_migration_bundles/<other>/users/<other>/` (a connectable single-user folder)
and the original is moved to `_trash/migrated_users/<other>/` (recoverable).
Cross-owner references in the primary's retained data are cleaned. The folder
then has one user and derives as solo automatically.

## The invariants every run must hold

Defined once in `lib/lab/__tests__/migration-invariants.ts` and asserted by both
test suites, so they cannot drift:

- I1 SOLO RESULT: exactly the primary remains under `users/`.
- I2 NO DATA LOSS: every moved user's tree is byte-identical (sha256) in BOTH
  their bundle and their trash, binary files (`.loro`, images) included.
- I3 PRIMARY CONTENT: every retained primary file is byte-identical except the
  files the executor reported changing, and within those a deep field diff
  proves only whitelisted share/prune fields changed and surviving array entries
  are byte-identical. The strip only REMOVES dangling entries, it never mutates
  content (titles, bodies, dates stay intact).
- I4 NO DANGLING: zero share-semantic references to a moved user remain anywhere
  in the primary tree.
- I5 VALID JSON: every rewritten file still parses.
- I6 PI RESET: a `lab_head` primary is clamped to `member`.
- I7 NO STRAY WRITES: the executor creates no unexpected files under the primary.
- Idempotency: a second (and third) run is a perfect no-op (whole-folder hash
  unchanged).

## Coverage

1. Real test folders (`real-fixture-verify.test.ts`, env-guarded). Five folders
   from Desktop and Documents, run with EVERY user as the primary (the connecting
   user could be anyone), 18 primary-runs total, all PASS:

   | Folder | Users | Primary choices tested |
   |---|---|---|
   | McQueenLab | 1 | 1 (already-solo no-op) |
   | badussie | 2 | 2 |
   | ArchiveKiller | 3 | 3 |
   | Lab Notebook | 4 | 4 |
   | LoroTest | 8 | 8 |

2. Synthetic CI matrix (`migrate-to-solo-synth.test.ts`, always-on in CI). A
   deterministic generator (`migration-synth-fixtures.ts`) lays down folders
   embedding every reference type and structural trap (see catalog below). 26
   cases across 2 to 6 users, multiple primaries each, plus lab-head and
   archived-user variants and the 1-user no-op. All PASS. This is a permanent
   regression gate that fails the build if any future change loses or corrupts
   data, and needs no external paths.

3. Crash-safety (`migrate-to-solo-crashsafe.test.ts`, always-on). Simulates the
   failure windows the browser path can hit, all PASS:
   - a silently torn bundle write aborts BEFORE any delete, source intact;
   - a crash mid-trash (source and trash both present) resumes from the verified
     bundle, drops the leftover source, loses nothing;
   - a partial leftover bundle is recopied and verified before trashing;
   - running three times is a perfect no-op after the first.

Totals: 317 lab tests pass in CI (6 real-fixture tests skipped unless
`MIGRATION_FIXTURE_VERIFY=1`), tsc clean, eslint clean.

## Edge-case catalog (what the generator embeds)

Share grant in object form `{username, level}`, plain-string form, and the `*`
wildcard with `is_shared:true`. KEEP controls that must survive untouched
(assignee, comment author and mentions, last_edited_by, created_by, a
self-reference to the primary in its own shared_with). external_project hosting
ref to a moved owner. The three sidecars: `_shared_with_me.json` nested owners,
`_notifications.json` `{version, notifications:[]}` with from_user/owner_username,
`projects/<id>-hosted.json` hostedTasks owner/sharedBy. A 1:1 notebook (title
rename plus member strip) and a plain shared notebook. Structural traps: an empty
directory, a non-json file, a MALFORMED json, a top-level ARRAY json that is not
a known sidecar, and a binary blob. An archived user (`deleted_at`) whose
directory must linger, stay invisible, and stay untouched.

## Findings fixed during this pass

1. Incomplete share strip (correctness gap, real folders). The original stripper
   only inspected top-level fields, so it left dangling pointers in
   `_shared_with_me.json` (nested `owner`) and `tasks/N.json` `external_project`.
   Fixed with a file-aware stripper that prunes dead entries from the three
   sidecars and clears `external_project`, while KEEPING attribution that
   gray-degrades. Verified against the real folders (4 dangling refs in Lab
   Notebook went to 0).

2. Wrong assumed shape for `_notifications.json` (correctness gap, real folders).
   The on-disk shape is `{version, notifications:[...]}`, not a root array. The
   synthetic generator had embedded the wrong shape, so the bug only surfaced
   against real data. Fixed prune and generator.

3. FSA `exists()` returned false for directories (latent production bug). The
   real `fileService.fileExists` resolves a FILE handle, so it returns false for
   a directory. The executor checks directory paths, so the production browser
   path would have silently skipped every user and migrated nothing. Fixed the
   adapter to detect directories via the parent listing, tightened the test mock
   to match reality, and added a regression test.

## Crash-safety design (production FSA path)

The one irreversible step is deleting a source, and it is never reached until a
COMPLETE, VERIFIED bundle exists. The executor verifies the bundle file set
covers the whole source before any delete (catching an FSA atomic write that
left a file absent). Because the trash move (a non-atomic copy-then-delete on
FSA) only runs after that verification, the existence of a trash directory proves
a complete bundle exists, which makes resume sound: on a re-run the bundle is the
authoritative copy and the trash is rebuilt from it, never from a possibly-partial
source. A new idempotent `removeDir` primitive (node `rm`, FSA `deleteDirectory`)
backs the leftover-source cleanup. Net guarantee: at every await the user's data
exists in full in at least one location, so no torn run loses data.

## Open items

- Trigger UI is not built. There are no callers of `executeMigrationToSolo`
  outside tests, so this cannot yet be run from inside the app. Building the
  preview + confirm + progress + result UI over the FSA adapter is the next step
  if we want an in-app flow and a "look" review.
- A live run in Grant's own Chrome on a COPY of a real folder is the only thing
  the harness cannot cover, because Claude Preview cannot drive the native folder
  picker. Recommended before any real use.
- Lab-only attribution fields (PI flag `flagged.by`, purchase `approved_by` /
  `declined_by`) are currently KEPT (they gray-degrade). Stripping them on solo
  conversion is a defensible future choice, not a correctness issue. Flagged for
  Grant rather than decided unilaterally.

## How to re-run

```bash
cd frontend
# Always-on CI matrix + crash-safety + unit tests:
node_modules/.bin/vitest run src/lib/lab/__tests__/ --no-coverage
# Real folders, every primary (env-guarded, reads COPIES, never the originals):
MIGRATION_FIXTURE_VERIFY=1 node_modules/.bin/vitest run \
  src/lib/lab/__tests__/real-fixture-verify.test.ts --no-coverage
```

To point the real harness at different folders, edit `FIXTURES` in
`real-fixture-verify.test.ts`.
