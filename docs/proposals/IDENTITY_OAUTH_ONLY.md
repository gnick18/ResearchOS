# Identity, simplified: a local keypair is your account, OAuth is optional

Status: MAJOR REVISION 2 locked 2026-06-08 (OAuth-only login for lab accounts,
passkey removed, keypair auto-unwraps via device key). Prior P1+P2 (local keypair
+ passkey) built and live; this revision supersedes the passkey-everyday-unlock
parts. See "MAJOR REVISION 2" immediately below.
Author: HR (orchestrator)
Date: 2026-06-06 (rev 2026-06-08)

## MAJOR REVISION 2 (2026-06-08): OAuth IS the login for lab accounts; kill the passkey

Context. The original 2026-06-06 cut (just below) made OAuth-the-login for
EVERYONE and dead-ended, because OAuth was required even for pure local-first
users and was not configured in dev/prod, so no account could be created. The
fix was the current model: a local keypair unlocked everyday by a passkey, OAuth
optional. That works but leaves two long-standing annoyances Grant called out
2026-06-08:
  1. "Logging in" is really a PASSKEY ceremony, never a third-party login, which
     is confusing (e.g. linking a phone first makes you "log in" = save a passkey).
  2. The keypair unlock is in-memory and is redone EVERY REFRESH (only the OAuth
     cookie persists), so the session feels like it keeps logging you out.

Why OAuth-only is viable NOW (and was not on 2026-06-06). The lab-tier pivot
split SOLO (free, local-first, no login) from LAB (paid, cloud, online). That
dissolves the old dead-end: OAuth is required ONLY for lab accounts, which are
online by definition, while solo stays pure local-first with no OAuth at all.
Phase 8 also made OAuth actually work end to end (devmock in dev, real providers).

The locked model (Grant 2026-06-08):
  - SOLO account = no login, ever. Pure local-first. Unchanged.
  - LAB account = third-party OAuth (Google/GitHub/LinkedIn/ORCID) is THE login.
    It is REQUIRED before the home/launch page renders (gate in front of the app,
    not after). The NextAuth JWT cookie persists it across refreshes like any
    normal website.
  - THE KEYPAIR STILL EXISTS and still does all decryption (the lab key is sealed
    to the member's X25519 pubkey; OAuth cannot decrypt). "Remove the passkey"
    does NOT mean remove the keypair. It means the keypair stops being a passkey
    ceremony and AUTO-LOADS.
  - KEYPAIR AT REST = auto-unwrap via a per-device key (DECISION 2026-06-08,
    option "device key"). The keypair stays encrypted in the folder sidecar, but
    is wrapped under a random DEVICE KEY stored in this browser's IndexedDB. On
    boot the device key auto-unwraps the keypair into the in-memory session, no
    gesture, and it survives refresh. A raw folder copy alone cannot read it
    (the device key is not in the folder). 
  - RECOVERY CODE stays, but only as the NEW-DEVICE / new-browser bootstrap:
    where there is no device key yet, the recovery code unwraps the folder
    sidecar once, then a fresh device key is minted + the keypair re-wrapped for
    auto-load thereafter.
  - PASSKEY is REMOVED everywhere (the passkey door at unlock + the enrollment
    step + passkeyBlob handling). One fewer ceremony, one fewer concept.

Boot flow, target:
  SOLO:  connect folder -> (keypair auto-loads via device key if one exists) -> home.
  LAB:   connect folder -> detect lab account (settings.lab_id / account_type)
         -> OAUTH GATE (sign in with provider; cookie persists) -> keypair
         auto-loads via device key (or recovery on a new device) -> lab session
         opens (existing Phase 8 openLabKey + binding) -> home. OAuth gate is in
         FRONT; the app shell never renders for a lab account until OAuth is live.

What this simplifies:
  - The lab email binding (Phase 8a) gets its email straight from the OAuth login
    that already happened, no separate publish step.
  - Telegram/phone linking just works post-login (keypair already auto-loaded),
    no passkey ceremony.
  - One login concept for lab (OAuth), one secret concept (the auto-loaded
    keypair), one bootstrap (recovery code).

Migration (existing users):
  - Existing accounts have recoveryBlob (+ maybe passkeyBlob) in the sidecar but
    no device key. On their next unlock (recovery, or passkey while it still
    exists), mint a device key, re-wrap the keypair under it (IndexedDB), and from
    then on they auto-load. The passkeyBlob is dropped. recoveryBlob is kept.
  - Removing the passkey UI must not strip recovery (the new-device path).

Phased build plan (proposed):
  P1. Device-key auto-unwrap: add a device-key store (IndexedDB) + wrap/unwrap of
      the keypair under it; on boot, auto-load the keypair from it (extend
      IdentitySessionRestorer). Recovery path mints the device key on success.
      RESULT: no more re-unlock every refresh. (Self-contained, testable.)
  P2. OAuth-front-gate for lab accounts: on folder-connect, if the user is a lab
      account, require an OAuth session BEFORE the app shell renders; reuse the
      Phase 8 LabSessionController. Solo unchanged.
  P3. Remove the passkey door + enrollment + passkeyBlob; collapse the login
      screen to "auto-load, else recovery code" for the keypair, OAuth for lab.
  P4. Migration sweep + cleanup of the old passkey-first UserLoginScreen branches.

OPEN ITEMS to confirm before building:
  - Multi-device for lab without re-entering recovery each new device: option
    "escrow keypair in cloud under OAuth" was DECLINED for now (kept device-key +
    recovery). Revisit only if cross-device friction is a real complaint.
  - Security posture: device-key-in-IndexedDB is defense-in-depth only (a full
    device compromise reads it). Accepted as the local-first trust boundary.

Everything below is the prior (2026-06-06) framing, kept for history. Where the
2026-06-06 revision says "passkey everyday unlock", read "device-key auto-unwrap;
passkey removed" per this revision.



## MAJOR REVISION 2026-06-06: local keypair = account, OAuth optional

The first cut made the OAuth profile THE account ("your profile is your account").
That dead-ended immediately: OAuth is not configured in dev (no AUTH_SECRET, no
provider creds) and is off in prod (SHARING_ENABLED unset), so an account could
not be created or unlocked at all there. Coupling basic local login to cloud
OAuth infra fights the local-first premise.

Grant's revised call: the ACCOUNT is a local keypair, created OFFLINE with no
OAuth, unlocked by a passkey (everyday) or recovery code (offline fallback).
OAuth becomes OPTIONAL, used only to publish a findable profile (bind the
keypair's public key to a verified email in the directory) for cross-boundary
sharing. This still kills the standalone password and keeps one keypair + passkey
unlock; it just stops REQUIRING OAuth to have an account.

What changes from the sections below:
- "An account = a profile (OAuth)" becomes "an account = a local keypair";
  creating it is a local step (mint keypair, enroll passkey, show recovery code),
  no network.
- The shared-folder gate forces CREATE-A-LOCAL-IDENTITY, not OAuth.
- OAuth (SharingSetupWizard) becomes the optional "publish my profile" action and
  must BIND THE EXISTING keypair to the email (it currently mints a fresh one,
  that is the old two-keypair bug, fixing it here completes unification).
- The sidecar `email`/`claimedAt` become optional (present only once published);
  a local-only identity has keys + recoveryBlob + passkeyBlob and no email.
- The P1 machinery (device-key/session-key/storage seal+unlock/sidecar wrapped
  blobs) already supports this; the new work is a local "create identity" path +
  making the wizard reuse the existing keypair + the optional-email sidecar shape.

Everything below is the prior (OAuth-required) framing, kept for history; where it
says "profile/OAuth is the account", read "local keypair is the account, OAuth
optional".

## Why (original framing)

## Why

We have been stacking identity features over time and ended up with two parallel
notions of "account" that fight each other:

1. A standalone app password, the old `_auth.json` hash and the cutover's
   `_account.json` keypair wrapped by a password, created independently of any
   third-party login.
2. The OAuth profile (sharing identity), a separate keypair bound to a verified
   email in the directory.

Both call `saveIdentity()`, so whichever ran last becomes the loaded device key,
and a later password login overwrites the sharing key (sharing then breaks). The
two-keypair clash is a symptom, not the disease. The disease is having two ideas
of "account."

Grant's call (2026-06-06): delete the standalone password entirely. Your profile
(third-party login) IS your account. There is exactly one identity concept.

## The model

- **Solo, no profile.** No password, no login, nothing to set up. The folder is
  yours on your machine and the app just opens. This is the default and the
  lightest path.
- **An account = a profile.** You get an account by signing in with a third
  party (Google / GitHub / ORCID / LinkedIn). That OAuth login is your login.
  There is no app-managed password, ever.
- **One keypair.** The profile keypair is the only keypair. It is your login,
  your shared-folder identity, and your cross-boundary sharing identity.
- **Everyday unlock = passkey (offline).** After setup, a passkey (Face ID /
  fingerprint / platform key, WebAuthn PRF) unwraps your on-device key each
  session and gates switching to your user on a shared machine. No network
  needed, so a lab computer with spotty wifi still works day to day.
- **OAuth = setup and recovery only.** Creating the profile the first time, and
  restoring it on a new device, use the OAuth round-trip (prove the email, fetch
  the encrypted key backup from the directory). The recovery code stays as the
  backstop if the passkey is unavailable.

So: passkey is the door you use daily, OAuth is how you mint and recover the key,
recovery code is the lifeboat. Three doors to one key, no password.

## What gets retired

- `_auth.json` (legacy password hash) and all readers.
- `_account.json` entirely. Its recovery + passkey blobs fold into the single
  per-user sharing identity sidecar (no `passwordBlob`, no second file).
- `frontend/src/lib/auth/local-identity.ts` `createLocalAccount` /
  `unlockWithPassword` / `changePassword` password paths, and
  `frontend/src/lib/auth/login-policy.ts` if `folderRequiresLogin` collapses
  into "has a profile."
- `frontend/src/lib/auth/password.ts`, `cached-password.ts` (already dead), and
  `IdlePasswordWipe.tsx` (already a stub).
- `AccountPasswordPopup.tsx` (set / change / remove password) and the Settings
  `SecuritySection` password entry.
- The force-set-a-password gate in `UserLoginScreen` (created in the cutover),
  replaced by a force-make-a-profile (OAuth) gate for shared folders.
- The "skippable set-a-password" and recovery-code-as-password screens from the
  cutover, replaced by the OAuth profile setup the wizard already does.

Net: a large deletion. The cutover's login plumbing shrinks to "load the local
key, unlock with passkey, or sign in with OAuth."

## The flows

- **First profile (any device, online).** Click a provider, OAuth proves the
  email, the wizard mints the single keypair, binds email to the public key in
  the directory, writes the encrypted key backup (recovery + passkey envelope),
  enrolls a passkey, and stores the key locally. One keypair from here on.
- **Everyday open / switch user (same device, offline ok).** Pick your user,
  the passkey ceremony unwraps the local key. No passkey or it fails, fall back
  to OAuth re-login when online, or type the recovery code when offline.
- **New device / lost device.** OAuth proves the email, the directory hands back
  the encrypted key backup, the passkey (if synced via the platform keychain) or
  the recovery code unwraps it, the key lands on the new device.
- **Solo, no profile.** None of the above. The app opens straight into the
  folder.

## At-rest device key (discovery, 2026-06-06)

`sharing/identity/storage.ts` currently persists the keypair as RAW plaintext
bytes in IndexedDB ("Raw key bytes live on this device only"). Today the gate is
the folder-level password (`_account.json`); the key itself is unprotected at
rest, `loadIdentity()` just hands it back.

For "passkey gates everyday unlock" to mean anything on a shared browser profile,
the device key must be WRAPPED at rest, not plaintext. So storage.ts changes from
storing raw keys to storing the same envelope shape the passkey arc already
defines (`key-backup-envelope.ts`): a passkey-PRF-wrapped blob plus a
recovery-code-wrapped blob. `loadIdentity()` becomes "unlock", run the passkey
ceremony (or take the recovery code offline) to unwrap the in-memory session key;
nothing usable sits on disk without one of those. This is the load-bearing change
that makes switch-user a real gate, and it reuses the chunk 1-3 crypto.

Consequence: there is no more silent plaintext load. Opening the app / switching
to your user always runs the passkey ceremony (fast, Face ID / fingerprint), with
the recovery code as the offline fallback.

## Shared folders

The cutover's reason to exist (a shared folder needs a per-user gate so people
cannot act as each other) is preserved, the gate just moves from a password to
the passkey / OAuth login. Creating a user in a shared folder forces a profile
(OAuth), not a password.

CONSEQUENCE TO ACCEPT: multi-user folders now require the OAuth / directory infra
to be reachable at least at setup time. With `SHARING_ENABLED` off (current prod
posture), there are simply no accounts, only solo local use, which matches
today's "sharing is laptop-only" reality. Offline-first labs set up each user
once online, then run on passkey unlock offline thereafter. If we ever want
multi-user folders that never touch the directory, that is a separate follow-up,
this proposal couples accounts to OAuth on purpose, per the simplification.

## What of the passkey arc survives

Chunks 1-3 (committed) are mostly reusable, the crypto core moves from "a door on
the sharing backup" to "the everyday unlock of the one keypair":

- `identity/passkey.ts` (PRF to wrapping key), `identity/recovery-code.ts`,
  `identity/key-backup-envelope.ts`, `identity/webauthn.ts` all stay.
- The enrollment step stays but binds to the single keypair at profile setup.
- Chunk 4 changes meaning: not "unlock the sharing identity in the needs-restore
  card" but "the everyday passkey unlock in the login screen."
- Chunk 5 (change linked email) stays, a signed rebind of the one keypair.

## Migration

Dev only, all fake accounts, so wipe-and-re-establish (the cutover's chosen
migration). Existing `_auth.json` / `_account.json` / diverged sharing keypairs
are dropped, the user re-establishes a profile. No production users to migrate
(sharing dark in prod).

## Phasing

These phases are MORE interdependent than a clean linear list, login must keep
working, so the new passkey-unlock path is built before the password path is
ripped. Practical order:

1. Wrap the device key at rest (storage.ts -> envelope), and make the sharing
   setup the single keypair source (stop minting a second key). Build the new
   unlock (passkey, recovery-code offline) alongside the old login.
2. Cut the login screen over to the new unlock, OAuth for setup/new-device,
   recovery-code offline fallback. Shared-folder gate becomes force-make-a-profile.
3. Rip the now-dead password system (files + UI listed above), retire
   `_account.json`.
4. Change-linked-email rebind (chunk 5).
5. Verify, Grant tests the live passkey + OAuth flows (not headless-drivable).

Because the unlock and at-rest changes are security-critical AND not
headless-verifiable, each phase ships compiling + unit-tested, and Grant does the
live ceremony verification.

## Locked decisions (Grant, 2026-06-06)

- **Offline fallback = recovery code.** Everyday unlock is the passkey. When the
  passkey is unavailable AND there is no network (shared lab machine, offline),
  the user can still unlock by typing their recovery code. OAuth re-login remains
  the path when online; the recovery code is the offline escape hatch.
- **One identity file per user.** Fold the recovery + passkey blobs into the
  existing sharing identity sidecar, there is literally one identity file on disk
  per user. No separate `_account.json`. This is the cleaner end state and worth
  the extra refactor.
