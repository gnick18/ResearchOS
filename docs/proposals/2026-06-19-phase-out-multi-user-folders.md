# Phase out multi-user folders (one folder per person)

Date 2026-06-19
Decision owner Grant
Status BUILT behind a flag, default OFF, awaiting verify + flag flip

## Why

The legacy model let several real humans share ONE local data folder. With lab
accounts now syncing E2E, real collaboration goes through the account / relay, not
a shared local folder. The shared-folder path lets people skirt real lab accounts
and forces a long tail of "is this folder multi-user" edge cases. Grant's call is
to retire it. Going forward, one folder per person, and collaboration is via a lab
account (your work follows you to every machine you sign in on).

## The two levers (both gated by ONE flag)

1. BLOCK NEW. A folder that already has at least one real local user never offers
   "create another user". The first user of an EMPTY folder is still created
   normally.
2. GRACE-THEN-FORCE. An EXISTING, genuinely multi-user folder keeps the
   migrate-to-solo gate, but the unlimited "Keep it shared for now" dismiss becomes
   a bounded grace. Once grace runs out the gate is blocking (Convert, or Take my
   data out), while the "Use a different folder" disconnect escape always stays so
   a user is never trapped.

## The flag

`NEXT_PUBLIC_SINGLE_USER_FOLDERS` (env `=1` or `=true`), surfaced as
`SINGLE_USER_FOLDERS_ENABLED` in
`frontend/src/lib/lab/single-user-folders-config.ts`, mirroring
`lab-as-folder-config.ts` and `multi-folder-config.ts`. OFF by default in prod
(env unset). When OFF, every surface is byte-identical to today.

## How a folder's real-user count is determined

The genuine human-user count comes from `discoverRealLocalUsers()`
(`frontend/src/lib/file-system/user-discovery.ts`), which already excludes reserved
sentinel dirs, tombstoned users (`deleted_at`), AND materialized co-members
(`materialized_member` in `users/_user_metadata.json`). `useIsMultiUserFolder`
already uses it. In the login screen the equivalent set is `usersApi.listLocalIdentities`
(also strips materialized co-members), which is what `UserLoginScreen` carries in
`users`, so the create-block reads `users.length` there.

## Lever 1: blocking the second user

Pure predicate `canCreateAnotherUser(realLocalUserCount, enabled)` in
`frontend/src/lib/lab/single-user-folders.ts`:

- flag OFF -> always allowed (byte-identical).
- flag ON -> allowed only when count is 0 (empty folder, first user). count >= 1
  blocks.

Important reality of the codebase. The "Create New User" CTA in
`UserLoginScreen.tsx` is ALREADY empty-folder-only (`users.length === 0`, Grant
2026-06-15), so a non-empty folder already shows no create button regardless of the
flag. This change therefore does NOT loosen anything when OFF. What the flag ADDS
when ON is:

- an HONEST explanation block in place of the missing CTA (why there is no "add me",
  open your own folder, collaborate via a lab account, use the disconnect option
  below), so the would-be new user is not left at a silent dead end, and
- a defensive guard at the top of `handleCreateUser` (same predicate) so the submit
  path can never grow a folder past one real user even if reached another way.

Existing real users still list and log in (legacy folders need that to sign in and
then migrate). The connect screen's own "Use a different folder" disconnect is
always present, so this is never a soft-lock.

## Lever 2: grace-then-force migration

Pure helpers in `single-user-folders.ts`, persisted state in `MigrationGate.tsx`.

Grace policy (whichever limit is hit first ends grace):

- up to `MIGRATION_GRACE_MAX_DISMISSALS = 3` dismissals, OR
- `MIGRATION_GRACE_WINDOW_DAYS = 7` days from first-seen.

State shape `{ firstSeen: number; dismissals: number }`, stored per-folder in
localStorage under `ros_migration_gate_grace_v1::<folder>`. This is a NEW key,
separate from the legacy `ros_migration_gate_dismissed_v1::<folder>` boolean, so
flag-OFF keeps reading/writing the byte-identical unlimited-dismiss boolean and the
two never collide. localStorage only, NO on-disk data, so NO data-shape change.

Helpers:

- `isMigrationGateDismissible(state, enabled, now)` -> flag OFF always true; flag ON
  true only while dismissals < cap AND now - firstSeen < window.
- `recordMigrationDismissal(prev, now)` -> starts the clock on the first dismissal,
  increments thereafter.
- `ensureMigrationFirstSeen(prev, now)` -> idempotently stamps first-seen the moment
  the gate appears, so the days window ticks even for a user who never clicks "Keep
  it shared for now".

Gate behavior when ON and the folder is genuinely multi-user
(`useIsMultiUserFolder()` true):

- within grace, the dismiss button ("Keep it shared for now" / "Keep working here
  for now") shows, with copy that this is temporary and migration will soon be
  required.
- once grace is exhausted the dismiss button is REMOVED, so the user must Convert
  (owner) or Take my data out (labmate).
- in BOTH states the "Wrong folder or account? Use a different folder" disconnect
  escape stays. A migration in progress is never blocked from completing, and a
  completed migration closes the popup directly (not via the grace path), so it
  never spends grace.

## Edge cases

- Empty folder, 0 users. First-user creation allowed (`canCreateAnotherUser(0)` is
  true).
- Lab MEMBER folder (1 real user + materialized PI / labmates for display).
  `discoverRealLocalUsers` and `listLocalIdentities` both return 1, so it is NOT
  multi-user, NO gate fires, and creating a 2nd real user is blocked (consistent).
  Materialized co-members are never counted.
- Owner vs labmate in the gate. The existing convert-vs-self-export branch is
  preserved unchanged.
- Mid-migration. The chosen flow (MigrateToSoloModal / SelfExportModal) takes over
  exactly as today; the grace logic never blocks it, and `onComplete` closes the
  popup directly.
- Flag OFF. Create CTA, gate dismiss, and persistence keys are all byte-identical to
  current behavior.

## What this does NOT touch

The migrate-to-solo executor (`migrate-to-solo-executor.ts`), the on-disk JSON /
sidecar formats, crypto, the relay, and the icon baseline. No new icons.

## Rollout / rollback

Rollout. Verify locally with `NEXT_PUBLIC_SINGLE_USER_FOLDERS=1`, confirm flag-OFF
is byte-identical, then set the env var in the deploy target and redeploy.

Rollback. Unset the env var and redeploy. The grace state is additive localStorage
under its own key, so turning the flag off simply ignores it; no cleanup needed and
no data migration either way.

## Files

- `frontend/src/lib/lab/single-user-folders-config.ts` (flag)
- `frontend/src/lib/lab/single-user-folders.ts` (pure logic)
- `frontend/src/lib/lab/single-user-folders.test.ts` (unit tests)
- `frontend/src/components/UserLoginScreen.tsx` (lever 1 wiring)
- `frontend/src/components/lab/MigrationGate.tsx` (lever 2 wiring)
