# Automatic on-disk data migrations

Status: DRAFT for sign-off. Replaces the manual "Data maintenance" repair buttons
in Settings with a migration system that brings old-format folder data up to the
current expected shape automatically, on folder connect, without data loss.

## Why

ResearchOS is local-first, so the user's data folder is the database. Over time
the on-disk format drifts (a field renamed, a stamp header reformatted, an
attachment folder restructured, a retired integration's credential files left
behind). Today the fixes live behind a row of manual "Run repair" buttons in
Settings that the user has to know to click. That is friction, it reads as
unfinished, and most users never touch it, so old folders silently stay on the
old shape until something downstream trips on it.

A server app runs DB migrations on startup. The local-first equivalent is to run
idempotent FORMAT migrations when the folder is connected, in the background,
once, quietly. The user should never have to think about it.

## Locked decisions (Grant, 2026-06-07)

1. **Design doc first**, then build (this doc).
2. **Destructive steps run automatically too, but recoverably.** Removals
   (orphaned LabArchives credential files, an orphaned `_auth.json`) and the
   cross-owner reconcile run in the auto pass, but anything removed is moved to
   a recoverable trash location, never hard-deleted, and every change is logged.
   Nothing is ever lost.

## What is already true (the building blocks)

The repairs are already discrete, idempotent functions that return a
`{ scanned, repaired, alreadyCorrect, failed }` style report. Running one twice
is a no-op. They are wired to buttons today via a `RepairRow` in
`frontend/src/app/settings/page.tsx`. The migration system orchestrates these
existing functions, it does not rewrite them.

Inventory (current Data maintenance panel + `lib/repair/` + `lib/tasks/migrate-*`):

| Migration | Function | Kind |
| --- | --- | --- |
| Method links (`method_id` -> linked method) | `tasksApi.repairMethodLinks` | in-place, safe |
| Method source paths (`github_path` -> `source_path`) | `methodsApi.repairSourcePaths` | in-place, safe |
| Split Lab Notes / Results attachments | `splitAllTaskAttachments` | copy-forward, safe (leaves legacy) |
| Stamp formats (legacy header -> HTML comment) | `repairStampFormats` | in-place, safe |
| PCR protocol normalization | `repairAllPCRProtocols` | in-place, safe (some unrecoverable, reported) |
| Method-type normalizers (lc, qpcr, plate, cell-culture, coding, mass-spec) | `lib/repair/*` | in-place, safe (not currently surfaced) |
| Cross-owner project-sharing reconcile | `ReconcileRow` logic | cross-owner, prune-only |
| Orphaned LabArchives credential cleanup | `scanOrphanLabArchivesFiles` + delete | DESTRUCTIVE (plaintext-password files) |
| Orphaned `_auth.json` cleanup (folds in password.ts retirement) | new, thin | DESTRUCTIVE (orphan only) |

Stays a manual action, NOT a migration: **Import experiment (.zip)**. It is a
user-initiated import, not a format upgrade.

## Architecture

### The registry

An ordered list of named migrations:

```
interface Migration {
  id: string;            // stable, e.g. "method-source-paths-v1"
  title: string;         // human label for the report
  destructive?: boolean; // gates the trash-not-delete contract
  run(): Promise<MigrationReport>;
}
interface MigrationReport {
  changed: number;       // records/files this run actually modified
  scanned: number;
  failed: number;
  details?: string[];    // per-record notes for the log
}
```

Order matters where one migration depends on another (the attachment split folds
the older `Attachments/` migration first; the registry encodes that by ordering).

### The marker

A single `_schema_migrations.json` at the folder root:

```
{ "applied": ["method-source-paths-v1", "stamp-formats-v1", ...], "updatedAt": "..." }
```

It records which migration ids have completed for this folder. On connect we run
only the ones NOT in `applied`. The marker is an optimization, not a correctness
crutch: every migration is idempotent, so a lost or stale marker only costs a
re-walk, never corruption.

### The runner

On folder connect / user switch, AFTER the folder is mounted and the app is
interactive (never blocking first paint):

1. Read `_schema_migrations.json` (empty = first run, everything pending).
2. For each pending migration in order, run it inside its own try/catch.
   - On success: accumulate its report, add its id to `applied`.
   - On failure: log the error, do NOT add the id (so it retries next connect),
     continue to the next migration (one failure never blocks the rest).
3. Write the updated marker.
4. If the total `changed` across migrations is greater than zero, show one quiet
   toast ("Updated N files to the latest format"). If nothing changed, stay
   silent. Errors surface a single soft "some maintenance steps could not finish,
   they will retry" line, never a blocking modal.

Runs in the background (idle callback / post-hydration), debounced so a rapid
connect-switch-connect does not stack passes.

### Safety, the no-data-loss contract

- **Idempotent**: already true of every function; re-running is a no-op.
- **Trash, never hard-delete**: destructive migrations move files to a recoverable
  location (the existing trash mechanism, or a `_trash/migrations/<id>/` folder
  with the original path preserved) instead of deleting. A mistaken removal is
  always recoverable from disk.
- **Copy-forward over move where possible**: the attachment split already copies
  and leaves the legacy folder; we keep that posture.
- **Per-migration isolation**: a thrown error is caught, logged, and skipped; it
  cannot cascade or half-write the marker.
- **Audit log**: each pass appends a line to `_schema_migrations.log` (or the
  marker keeps a small ring of recent runs) so support can see what changed when.

## Settings, after

The "Data maintenance" section slims to:

- A read-only status line: current schema version + the last auto-run summary
  ("All formats up to date" or "Last updated 12 files on <date>").
- A single manual "Re-run all checks" button for support / power users (runs the
  full registry ignoring the marker), replacing the row of per-repair buttons.
- The Import experiment (.zip) action stays.

## password.ts retirement (the trigger for this)

`lib/auth/password.ts` is kept today only for `removePassword` (orphan
`_auth.json` cleanup at the login force-gate) plus three now-dead exports reserved
for a future `_auth.json` user migration. We fold the orphan cleanup into a
migration (`auth-json-orphan-cleanup-v1`, destructive-but-recoverable: a folder
that has `_auth.json` but no `_account.json` for a user is a legacy artifact the
keypair model supersedes, so trash it) and delete `password.ts` entirely.

Caveat: re-keying an ACTIVE old password into a keypair needs the user to type
that password, so it cannot be a silent migration. It does not need to be: a
legacy user creating their keypair account at the login force-gate already
supersedes `_auth.json`, and the orphan-cleanup migration trashes the leftover.
So no silent password handling is required, and `password.ts` goes away.

## Open questions / risks

1. **Cross-owner reconcile during concurrent sessions.** A shared folder has two
   users; the reconcile touches both sides of a project's hosting manifest. Two
   sessions auto-running it at once risks the known shared-manifest race. Options:
   gate cross-owner reconcile behind a soft per-folder lock, or run it only for
   the folder owner, or keep it prune-only (it already is) and accept idempotent
   reconvergence. Needs a decision before that migration auto-runs.
2. **Performance on large folders.** First connect on a big, never-migrated folder
   walks everything. The marker means it is a one-time cost, run in the background,
   but we should chunk + yield so it never janks the UI.
3. **Trash location + retention.** Where recoverable removals land, and whether
   they ever get pruned. Proposal: a `_trash/migrations/` folder, never
   auto-pruned (the user can clear it).

## Build plan (phased)

1. Runner + marker + report/toast plumbing, with the 3 safest in-place migrations
   (method source paths, stamp formats, method links). Prove the pattern.
2. Add the remaining in-place migrations (attachment split, PCR + the method-type
   normalizers).
3. Add the destructive-but-recoverable migrations (LabArchives cleanup, `_auth.json`
   orphan cleanup) on the trash-not-delete contract; delete `password.ts`.
4. Resolve the cross-owner reconcile concurrency question, then fold it in.
5. Slim the Settings panel to the status line + single re-run button.
