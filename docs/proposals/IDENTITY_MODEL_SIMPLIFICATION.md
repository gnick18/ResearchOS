# Identity model simplification (local keypair foundation, login for shared folders)

Status: DRAFT for sign-off. No code until Grant approves.
Author: sharing infra
Date: 2026-06-05

## Why

Today "identity" is one word covering five different jobs that do not share a
network requirement, and the account model carries a `solo | lab | lab_head`
type that drives far more branching than the real distinctions justify. Grant
wants to collapse this. A genuinely solo person should just connect a folder. The
moment a folder is shared, everyone in it is a real account with a login and an
identity, period. That kills a pile of "no identity yet" edge cases and adds real
protection (switching users becomes a login, not a free picker).

### The five jobs an identity is asked to do

| Job | Needs a keypair | Needs the cloud |
| --- | --- | --- |
| Per-user login (switch-user protection) | No, a password or passkey | No, fully local |
| Attribution (who wrote this) | No, the username suffices in-folder | No |
| In-lab record sharing (`shared_with`, canRead/canWrite) | No | No, rides the synced folder |
| In-lab real-time collab (Loro relay) | Yes | Yes today, only because membership binds to the cloud directory |
| Cross-boundary sharing (send to another folder) | Yes | Yes, inherently |

The load-bearing realization. Only cross-boundary sharing truly needs the cloud
directory. In-lab real-time collab needs it today only because
`collab/server/auth.ts` resolves a member through `getBindingByHash` (a directory
lookup by peppered email hash). If in-lab collab membership were registered by
public key instead, taken from the member's `_sharing_identity.json` sidecar in
the shared folder, a purely local keypair would be enough and no directory entry
would be required.

## The model (decided 2026-06-05, option A, phased)

1. A keypair is generated locally for every shared-folder user, offline, at
   account creation, behind the login they set. This single local keypair powers
   login, attribution, and in-lab collab. No email, no network, no directory
   entry to start.
2. Email-verifying and publishing to the directory becomes the optional upgrade,
   done only when the user first sends or receives across folders.

This keeps the part that matters for the product story. Nothing of yours touches
our cloud until you choose to share outward. That is the LabArchives trust-flip
and the NIH "you own and control your data" pitch in one sentence. Making every
lab member publish to a cloud directory just to open the app (the rejected
"directory identity mandatory" option) quietly breaks that, for no real friction
saving, since the keypair generation is cheap either way.

### Why the friction worry is small

The friction lives almost entirely in the email-verify and publish step, which we
defer. Generating the keypair is silent and offline. "Make an account" becomes
"pick a passkey," and a keypair appears under the hood. Grant's read that few will
mind making an account points toward this model, not away, because the model makes
the heavy step optional and the light step automatic.

## Collapsing the account type

`account_type` is currently `solo | lab | lab_head` on `feature_picks`, consumed
across `local-api.ts`, `settings/user-settings.ts`, the unified sharing model, and
tab derivation (`deriveVisibleTabs` / `tabsForFeaturePicks`). The real axes are
simpler.

- Do you share a folder. Derived from the user count in the folder (1 vs 2 or
  more), not a stored type.
- Are you a PI / lab head. A single `isLabHead` role flag.

So `account_type` collapses to one boolean, and "lab mode" becomes "this folder
has two or more users." This is a satisfying simplification but it touches a lot
(feature picks, `deriveVisibleTabs`, lab-overview gating, onboarding copy), so it
is its own sizable sub-arc, sequenced alongside but not blocking the identity
work.

## Where third-party sign-in fits

Two auth jobs that are easy to conflate, and they do not overlap.

- The local login (passkey or password) is the mandatory switch-user gate. It is
  offline, it proves "I am this user on this device", and it unwraps the local
  keypair. It never touches the network.
- Third-party sign-in (Google, GitHub, ORCID, LinkedIn) is email proof for the
  optional outward layer. It proves "I own this email" so we can publish the key
  to the directory, and later re-fetch the encrypted backup on a new device. It is
  interchangeable with the 6-digit email code and only appears when the user
  chooses to go cross-boundary.

OAuth cannot be the local login. It is network-bound (switching offline would
break), it authenticates the user to Google rather than to their keypair (it
returns a rotating token, not a key-unwrapping secret), and any server-assisted
unlock would let the server read the user's data, which the whole design rejects.

How they compose.
- A member who never shares across folders only ever sets a local login, and a
  keypair is generated silently behind it. The OAuth buttons never appear.
- A member who wants cross-boundary clicks Sign in with Google (or uses the email
  code) to prove their email and publish. The passkey or password still guards the
  key locally, OAuth only vouches for the email to the cloud.
- On a new device, OAuth proves the email to fetch the encrypted backup, then the
  recovery code or passkey actually unwraps it. OAuth participates but never
  unwraps.

One sentence. Third-party sign-in proves who you are to the cloud, the passkey or
password proves you are you on this device and unlocks your local key.

This shifts what the setup wizard is. Today it leads with the four OAuth buttons
because creating an identity equals proving an email plus publishing. Under this
model the keypair is created locally and silently at account creation, so the
wizard and those four buttons become the publish / go-cross-boundary flow, not the
make-an-identity flow.

## Unified login rebuild (full, decided 2026-06-05)

Grant's call, do the real rebuild rather than bolt onto the old password gate. The
standalone `_auth.json` hash retires. Login becomes "your password unwraps your
local keypair", so password, passkey, and recovery code are three doors to the
same local identity, the exact envelope model the passkey arc already built.

The local account file. Each shared-folder user gets a per-user file in the folder
(a `_account.json` replacing `_auth.json`) holding public fields plus the wrapped
private keys.
- `x25519PublicKey`, `ed25519PublicKey`, `fingerprint`, public.
- `passwordBlob`, the private key bundle wrapped under an Argon2id key derived
  from the password. Device salt is NOT mixed in (unlike the device-bound
  passphrase blob in backup.ts), so the password alone unwraps on any device, which
  is correct for a folder-stored, password-portable blob.
- `recoveryBlob`, the same bundle wrapped under the recovery code (the base32
  rendering of the 128-bit mnemonic from the passkey arc). The forgotten-password
  fallback.
- `passkeyBlob`, optional, added when the user enrolls a passkey (the PRF blob).

The keypair unification. This local keypair IS the sharing identity. It is created
at account creation, wrapped locally, and only PUBLISHED to the directory later if
the user goes cross-boundary. So `createIdentityMaterial` effectively moves from
the wizard to account creation, and the wizard becomes the publish flow. One
keypair, created local-first, optionally published.

Login. Read `_account.json`, derive the wrapping key from the typed password,
unwrap `passwordBlob`. Success is the password check (a wrong password fails the
Poly1305 tag). The unwrapped private keys load into the session. No separate hash
compare.

Migration, wipe and re-establish (decided 2026-06-05). There is no keypair
migration. A user lacking an `_account.json` (every existing user) is run through
the new "set up your account" flow on next login, set a password, a fresh keypair
is generated, `_account.json` is written. The old `_auth.json` is removed and any
old `_sharing_identity.json` (a published link to the now-superseded old keypair)
is cleared, the same supersede the Reset action does. If the user later wants
cross-boundary again, they publish the new local keypair. This wipes the old
published binding (orphaned in the directory, harmless pre-launch) rather than
preserving it, which Grant chose for the simplest code given there is essentially
no real sealed data yet. Members in a newly shared folder with no password go
through the same set-up flow, there is no separate path.

Recovery and PI reset (locked above). The recovery code unwraps `recoveryBlob` and
restores the SAME identity. A lab head reset mints a FRESH keypair (the existing
start-over path), so it never unwraps the member's old key.

Build order for the rebuild.
1. Crypto core, the local account file create / unlock-with-password /
   unlock-with-recovery / passkey-attach, reusing backup.ts. Pure, unit-tested.
2. The login-required policy (login-policy.ts, already built).
3. Migration logic from `_auth.json`, unit-tested against fixtures.
4. UX cutover, the login screen, force-set, and switch-user read the new file.
   Destructive (retires `_auth.json` reads) and not orchestrator-verifiable, so it
   lands last, behind Grant's live test.

## Switch-user becomes a real login

Today switching users in a folder is a free picker, and the per-user password
(`lib/auth/password.ts`, `_auth.json`) is opt-in. Under this model, switching to a
user in a shared folder requires that user's login (password or, preferably,
passkey). This is the protection Grant asked for. The raw files are always on disk
regardless (local-first), this gates the in-app account view, not the data.

### The genuine risk, the recovery story

Making switch-user an auth gate means a forgotten login locks someone out of their
own account view in the app. The recovery path for a lost login must be rock solid
before this ships. The passkey plus recovery-code work already in flight (see
docs/proposals/PASSKEY_IDENTITY_UNLOCK.md) is most of that backbone, which is
convenient timing. A shared-folder account must always have at least one recovery
route (recovery code, or a lab-head reset, decided below).

## What changes, what stays

Stays exactly as is.
- In-lab record sharing (`shared_with`, canRead, canWrite). Local, offline,
  username-based. No identity needed, no change.
- Cross-boundary sharing and the directory. Unchanged, still the opt-in outward
  layer.
- The raw data folder. Always plaintext on disk.

Changes.
- Shared folders gain a mandatory per-user login and a silent local keypair.
- `account_type` collapses to `isLabHead` plus a derived shared-folder flag.
- In-lab collab membership moves from email-directory to public-key registration
  (deferred to phase 3, when collab is verified).

## Phasing

Phase 1, cheap and high value, no network.
- Mandatory per-user login for any shared folder (2 or more users, or a lab head
  present). Passkey preferred, password fallback, reusing `lib/auth/password.ts`
  and the passkey core.
- Generate a silent local keypair at account creation and store it (IndexedDB +
  a public sidecar), so every shared-folder user has an identity in hand.
- This alone removes most "no identity yet" branches and delivers the switch-user
  protection.

Phase 2, the account-type collapse.
- Replace `account_type` with `isLabHead` plus a derived shared-folder flag across
  feature picks, tab derivation, and lab gating. Migration for existing sidecars.

Phase 3, local-first in-lab collab, deferred until collab is verified.
- Register in-lab collab membership by public key (from the members' sidecars)
  rather than the email directory, so in-lab collab needs no directory entry.
- Until this lands, collab users who want real-time still publish to the directory
  exactly as today, just with the keypair already generated.

## Decisions locked (2026-06-05)

1. Lost-login recovery, recovery code PLUS a lab-head reset. Each user has a
   recovery code that restores their SAME identity. A lab head can additionally
   last-resort reset a locked-out member, and that reset mints a FRESH keypair
   (the "start over" flow), so it never unwraps or exposes the member's old key.
   The recovery code covers the lab head themselves and solo users. The PI reset
   needs its own guardrails (the member's old sealed content becomes unopenable,
   same warning as the existing Reset identity action, and the reset should be
   attributable).
2. Existing multi-user folders, prompt each user on next open. The first time a
   user opens the folder after the upgrade, they set their login once and a
   keypair is generated. Self-service, one-time, the folder keeps working.
3. Solo to shared, auto-prompt at the second user. The moment a folder becomes
   shared, the existing user is prompted to set a login and a keypair is generated
   for them. No lingering unprotected accounts.
4. Login method, passkey preferred with a password fallback. Offer a passkey
   first, but allow a password (reusing `lib/auth/password.ts`) for devices or
   users that cannot or will not use a passkey, since a mandatory gate cannot
   exclude anyone.

## Still to confirm before build

- Sign-off to start phase 1 (mandatory login plus silent local keypair for shared
  folders). Phase 1 is mostly local and testable, the keypair generation and the
  login gate are unit-coverable, the switch-user UX needs a Grant pass.
