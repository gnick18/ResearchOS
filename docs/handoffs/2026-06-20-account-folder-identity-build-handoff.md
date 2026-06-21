# Handoff: account-centric folder identity BUILD (2026-06-20)

Owner: orchestrator / cloud-accounts + identity lane. House voice, no em-dashes,
no emojis, no mid-sentence colons.

## TL;DR

The identity-model BUILD queued by the 2026-06-20 class-nav handoff is DONE on
branch `feat/account-folder-identity`, built in an isolated worktree off main,
gated behind `NEXT_PUBLIC_MULTI_FOLDER` (dark, OFF in prod). Independently
re-gated on the rebased tree (tsc 0, 81 tests pass). The branch is a clean
fast-forward onto current main. NOT merged, NOT pushed. Ready for DEBUG to ff.
Browser E2E (4-folder FSA) is human-only and was NOT run, see the live-test
checklist below before any flag flip.

## What was built (all behind MULTI_FOLDER, flag-off byte-identical)

Implements the locked proposal `docs/proposals/2026-06-20-account-centric-folder-identity.md`.
Decisions honored: D1 exclusive owner keyed on signing-key fingerprint (email is a
label only), D2 warn-then-allow-rebind with a real Cancel, D4 connecting account
ADOPTS an unowned folder silently (even a legacy multi-user folder, other users/
stay visible co-members), D6 shared-file removal MOVES TO TRASH (recoverable) plus
a Revert ownership that restores exactly that set and hands ownership back.

New modules:
- `frontend/src/lib/file-system/folder-owner.ts`, the `users/_folder_owner.json`
  record (owner_fingerprint + owner_email label + previous_owner + takeover_events)
  with pure helpers isOwnedBy / isForeignTakeover / adoptRecord / takeoverRecord /
  revertRecord / lastTakeover / makeTakeoverEventId. revertRecord handles nested
  takeovers (restores the prior event's owner). writeFolderOwner appends the
  sentinel to the data-folder .gitignore via ensureGitignoreEntries.
- `frontend/src/lib/file-system/folder-owner-connect.ts`, the connect-time
  resolution. Pure selector decideOwnerAction(rec, fingerprint, flag) -> none |
  adopt | owned | takeover. Runtime resolveOwnerAction WRITES the adopt record
  (D4 silent) and computes the foreign-share count for the takeover warning.
  currentAccountFingerprint() reads getSessionIdentity().keys.signing.publicKey
  through the same fingerprint() the sidecar uses, so it matches Phase B.
- `frontend/src/lib/sharing/foreign-share-sweep.ts`, detect/count/sweep/restore.
  The removal set = records under users/<currentUser>/{notes,projects,methods,
  experiments,tasks,sequences}/*.json carrying received_from_fingerprint present
  AND != my fingerprint. ABSENCE of that stamp is the exclusion guard that
  preserves the account's own authored content. Sweep moves each to trash tagged
  with the takeover event id and writes a per-event manifest (_swept_shares.json)
  so restore returns EXACTLY that set. Best-effort prunes dangling _shared_with_me.
- `frontend/src/components/account/FolderTakeoverWarning.tsx`, the D2 modal
  (LivingPopup). Cancel disconnects so the user is never stranded. Take over runs
  the sweep + owner rebind. Renders null unless pendingTakeover is set.
- `frontend/src/components/account/FolderTakeoverBanner.tsx`, the D6 revert banner.
  Inert when the flag is off, not connected, or the folder has no takeover.

Wiring:
- `file-system-context.tsx`, finishConnect calls resolveOwnerAction (only when
  MULTI_FOLDER and a session fingerprint exist) and surfaces pendingTakeover.
  New context actions takeOverFolder / revertOwnership / cancelTakeover.
  pendingTakeover is cleared on disconnect so it never leaks across a folder switch.
- `providers.tsx`, mounts the two components inside FileSystemProvider next to the
  other connect-state banners. (Mount point is the open call below.)
- `user-discovery.ts`, SKIP_DIRECTORIES learns `_folder_owner.json`.
- `migrations/trash.ts`, added restoreTrashedFile + trashPathFor (same
  write-then-delete safety order) so the sweep is reversible.

## Gate state (independently verified on the rebased tree)

- `npx tsc --noEmit` from frontend/ exits 0.
- `npx vitest run` over the 3 new test files + migrations + require-account.test.ts,
  81 tests pass.
- Branch rebased onto current main, clean ff (0 behind / 1 ahead at handoff time).

## A regression I caught and fixed

The first build pass narrowed `isFolderlessAccountRoute` in providers.tsx from
`startsWith("/account")` to an exact `=== "/account"`, which would have
folder-gated account subpages (/account/lab-site). That was out of scope and not
flag-gated. Reverted. The rebase later confirmed main already carries the correct
prefix form, so my revert dropped cleanly as already-upstream.

## KEY RISK (unchanged from the proposal)

Rebind-on-takeover is data-safe ONLY while DEVICE_KEY_V2 at-rest encryption stays
OFF. Encoded as a guard comment in folder-owner.ts, folder-owner-connect.ts, and
the takeOverFolder branch in file-system-context.tsx. Re-review the takeover flow
before that flag is ever flipped.

## Live-test checklist (human, before any flag flip)

Needs a real 4-folder FSA setup (cannot be driven headless). With MULTI_FOLDER on,
capture recovery codes per account:
1. Fresh account connects an unowned multi-user folder, expect SILENT adopt, no
   warning, and a users/_folder_owner.json appears.
2. A second account connects the same folder, expect the takeover warning with the
   correct shared-file count. Take over, expect the foreign shares move to trash
   and the account rebinds as owner.
3. The Revert ownership banner restores exactly the swept set and hands ownership
   back to the previous owner.

## DEBUG, to land

Fast-forward `feat/account-folder-identity` onto main (it is a clean ff). Flag is
OFF so prod is byte-identical. No relay/server change needed.
