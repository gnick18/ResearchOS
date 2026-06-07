# Identity, simplified: your profile is your account

Status: decisions locked 2026-06-06, awaiting go-ahead to build (supersedes the
password half of IDENTITY_MODEL_SIMPLIFICATION.md and reshapes
PASSKEY_IDENTITY_UNLOCK.md)
Author: HR (orchestrator)
Date: 2026-06-06

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
