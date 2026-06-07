# Lab accounts log in, solo accounts stay local

Status: DRAFT for sign-off. One open decision flagged below (the E2E custody
tradeoff). No identity code until Grant approves that point.
Author: identity infra (HR)
Date: 2026-06-07

Supersedes the lab-account half of `IDENTITY_OAUTH_ONLY.md`. That doc's "local
keypair = account, OAuth optional, shown as a passkey + recovery-code page"
model stands for SOLO folders. For LAB (shared) folders Grant wants the opposite
emphasis, captured here.

House style: no em-dashes, no emojis, no mid-sentence colons.

## What Grant asked for (verbatim intent)

"i literally hate the keypair THEN the third party. to me that still FEELS like
two things. if the user is on a lab account we dont care about local first in
this context. They need to make an account. And from the user standpoint that is
all they need to do. The keypair thing should happen automatically on backend IF
it needs to happen. They just login to google OR whatever service to get into
their portal in ResearchOS for the day IF they are in a lab account. Solo
accounts dont have to worry about any of this."

So the felt experience must be ONE thing, not two. A lab user signs in with a
provider and they are in. A solo user connects a folder and they are in.

## The two worlds

### Solo folder (single user, no lab head)
Unchanged from today. Pure local, no provider, no passkey ceremony, no recovery
code shown. Connect the folder, you are in. If a solo user later wants device
sync or cross-boundary sharing they can opt into a provider from Profile, but
nothing is required and nothing is shown by default.

### Lab folder (two or more users, or a lab head present)
The account IS the provider login. The user does exactly one thing, both on
first run and every day after.

- First sign-in (account creation): the user clicks "Sign in with Google" (or
  another provider). On success we silently mint their identity keypair, encrypt
  the private key, store the encrypted blob with our identity server keyed to
  their provider identity, and drop them into their workspace. No passkey page,
  no recovery code, no second step.
- Returning sign-in (any device): the user clicks "Sign in with Google." On
  success we fetch their encrypted key blob, unwrap it locally into the session,
  and drop them in. "Their portal for the day."
- Switch user / new device / lost device: same single action. There is nothing
  to remember beyond their provider account.

The keypair still exists (it is the foundation for attribution, in-lab record
sharing, the collab relay, and cross-boundary sharing). It is just never
surfaced. It is an implementation detail the user never has to think about.

## How the key survives across devices (server-wrapped, Grant chose this)

The hard requirement, if login is only a provider sign-in with no user-held
secret, the encrypted key has to be retrievable using only that sign-in.

Design:
1. On first sign-in we generate the keypair locally.
2. We request a per-user wrapping operation from the identity server. The server
   holds a root wrapping key in a managed KMS (never in app code, never logged).
   The server wraps the user's private key under a per-user data key derived in
   KMS and returns the ciphertext. The server stores `{ providerSub, wrappedKey,
   pubKey, createdAt }`.
3. On any later sign-in we present the provider session, the server authorizes
   against `providerSub`, unwraps via KMS, and returns the plaintext key over the
   authenticated TLS channel. The client holds it only in memory (session-key.ts,
   same in-memory holder we already have), never written unencrypted to disk.
4. Public keys are published to the directory automatically on first sign-in, so
   lab members are findable without a separate "publish profile" step.

This is the standard cloud-account-recovery posture (how a hosted password
manager or a Google-account-bound key behaves). It buys the exact UX Grant wants.

## The one open decision: this weakens E2E for lab users. Confirm.

Be honest about the tradeoff so the sign-off is informed.

With a user-held secret (a passkey or recovery code, what we have now) the
server can be truly blind, it stores ciphertext it can never open. With NO
user-held secret, the unwrap secret has to live server-side (in KMS). That means
the identity server operator (us) is technically capable of unwrapping a lab
user's private key, and therefore of reading anything sealed to that user
(collab updates, cross-boundary sends). It is protected by access control, KMS
policy, and audit logging, not by mathematics.

Three honest options:

- A. Pure convenience (what "server-wrapped" implies). Accept that lab identity
  custody is server-assisted and not zero-knowledge. Simplest, matches the
  vision exactly. Recommended IF lab data is considered "trusted to the
  ResearchOS service" the same way the synced folder already is.
- B. Convenience plus a silent backstop. Same as A, but also derive a second
  wrap from a WebAuthn PRF passkey when the device has one, so on that device the
  server alone cannot unwrap. Falls back to server-only on devices without a
  passkey. More moving parts, partial zero-knowledge.
- C. Keep a user secret for lab users too. True zero-knowledge, but it is exactly
  the "two things" Grant rejected (sign in AND manage a key/code).

Grant's selection in chat was "server-wrapped key (recommended)", which is
option A. This doc records option A as the plan unless Grant, now seeing the E2E
consequence spelled out, prefers B. (C is off the table per his UX call.) The
collab RELAY itself stays blind regardless, only identity-key custody changes.

CONFIRM BEFORE BUILD: option A (server can technically recover lab keys) is
acceptable for the convenience.

## What has to be stood up first (dev OAuth, Grant chose real Google creds)

OAuth is currently dead in dev (no AUTH_SECRET, no provider creds) and off in
prod (SHARING_ENABLED unset). Nothing here works until a real provider client
exists. Division of labor (I cannot create accounts or enter secrets, those are
Grant's to do):

Grant does (one time, ~10 min, guided):
- Create a Google Cloud project + OAuth 2.0 Client ID (Web application).
- Authorized redirect URI for dev `http://localhost:3000/api/auth/callback/google`
  (we add the prod URI at launch).
- Hand me the Client ID and Client Secret to place in `frontend/.env.local`, or
  paste them into the prepared env keys yourself.

I do:
- Generate `AUTH_SECRET`, scaffold the `frontend/.env.local` keys with comments.
- Confirm `lib/sharing/auth.ts` Google provider wiring + the callback route.
- Flip the lab-account path to require provider sign-in; keep solo local.

## Implementation phases (after the two confirmations above)

L0. Stand up Google OAuth in dev (env + auth.ts verified, a real sign-in
    round-trips to a session). Pure plumbing, no identity logic yet.
L1. Identity server endpoints, `POST /identity/wrap` (store) and
    `POST /identity/unwrap` (retrieve), KMS-backed, authorized by provider
    session. Plus directory auto-publish of the pubkey.
L2. Lab create flow, sign-in mints keypair, calls wrap, publishes pubkey, enters.
    Delete the forced CreateLocalIdentityStep page from the lab path.
L3. Lab returning flow, sign-in calls unwrap into session-key, enters. Switch
    user becomes a provider sign-in.
L4. Solo path audit, confirm solo is untouched and still ceremony-free.
L5. Retire the now-unused lab passkey/recovery UI, reconcile with the existing
    PASSKEY_IDENTITY_UNLOCK work (passkey may still serve solo opt-in device
    unlock, but is no longer the lab everyday path).
L6. Verify, then Grant live test (real Google sign-in, second device unwrap).

## What this does NOT change

- Solo folders stay exactly as they are.
- The collab relay stays E2E-blind (sealed to recipient pubkeys).
- Attribution, in-lab `shared_with` record sharing, and the synced-folder model
  are unchanged.
- `SHARING_ENABLED` still gates the whole lab/sharing surface in prod, so this
  ships dark until Grant flips it.
