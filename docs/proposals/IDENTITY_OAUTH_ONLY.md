# Identity, simplified: your profile is your account

Status: proposed, awaiting sign-off (supersedes the password half of
IDENTITY_MODEL_SIMPLIFICATION.md and reshapes PASSKEY_IDENTITY_UNLOCK.md)
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
- `_account.json`'s password door. The file (or its successor) keeps only the
  recovery and passkey blobs, no `passwordBlob`.
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
  the passkey ceremony unwraps the local key. No passkey enrolled or it fails,
  fall back to OAuth re-login (you already have the profile).
- **New device / lost device.** OAuth proves the email, the directory hands back
  the encrypted key backup, the passkey (if synced via the platform keychain) or
  the recovery code unwraps it, the key lands on the new device.
- **Solo, no profile.** None of the above. The app opens straight into the
  folder.

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

1. Unify the keypair, profile setup reuses / becomes the one keypair, sharing
   setup stops minting a second one. Login loads that key.
2. Make the passkey the everyday unlock in the login screen (revised chunk 4),
   OAuth re-login fallback, recovery-code lifeboat.
3. Rip the password system (files + UI listed above), force-profile gate for
   shared folders.
4. Change-linked-email rebind (chunk 5).
5. Verify, Grant tests the live passkey + OAuth flows (not headless-drivable).

## Open questions

- The no-passkey, no-network case on a shared machine, is OAuth re-login an
  acceptable everyday fallback, or do we want the recovery code there too?
- Do we keep a single `_account.json`-style local file for the recovery + passkey
  blobs, or fold those into the existing sharing sidecar so there is literally
  one identity file per user?
