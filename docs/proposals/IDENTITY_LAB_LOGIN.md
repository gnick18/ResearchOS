# Lab accounts log in, solo accounts stay local

Status: DECISIONS LOCKED 2026-06-07. Ready to build (gated only on Grant
creating the Google OAuth client, see below).
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
Two login methods, set up once at creation, either one accepted afterward
(Grant's "both generated at creation, either accepted to login" model). The
keypair itself is always invisible.

- Creation (one guided pass): the user signs in with a provider (Google etc).
  That mints the invisible identity keypair, server-wraps a recovery copy keyed
  to the provider identity, and publishes the verified pubkey to the directory.
  Then we offer "Set up Touch ID for one-tap login next time", which enrolls a
  passkey and wraps a second copy of the key under its WebAuthn PRF (blind, only
  the fingerprint opens it). Skippable, but recommended.
- Daily login on your own device: one Touch ID tap. The passkey login IS the
  auth, no provider step that day, and that path is zero-knowledge (we never see
  the key).
- Login on a device with no passkey (new/borrowed device): sign in with the
  provider, the server returns the recovery wrap, the key unwraps into the
  session. Offer to enroll a passkey on that device too.
- Recovery (lost ALL devices): sign in with the provider anywhere. The server
  recovery wrap restores the key. Nothing to remember. (Grant's locked call,
  see the custody section.)

The keypair is the foundation for attribution, in-lab record sharing, the collab
relay, and cross-boundary sharing. The user never sees or manages it.

## How the key is wrapped (two copies, dual path)

The key is wrapped TWICE at creation so either login method can open it.

1. On first sign-in we generate the keypair locally.
2. Passkey wrap (the zero-knowledge daily path). When the user enrolls the
   passkey, we derive a wrap key from its WebAuthn PRF and wrap a copy of the
   private key. Only that fingerprint opens it. The server never sees this. This
   reuses the existing PASSKEY_IDENTITY_UNLOCK crypto (core + envelope +
   enrollment already built).
3. Server recovery wrap (the provider path). We also ask the identity server to
   wrap a copy. The server holds a root key in a managed KMS (never in app code,
   never logged), wraps under a per-user KMS data key, and stores
   `{ providerSub, wrappedKey, pubKey, createdAt }`. On a provider login the
   server authorizes against `providerSub`, unwraps via KMS, and returns the
   plaintext over the authenticated TLS channel. The client holds it only in
   memory (session-key.ts), never written unencrypted to disk.
4. Public keys are published to the directory automatically on first sign-in, so
   lab members are findable without a separate "publish profile" step.

Daily on a passkey device, only path 2 runs and the server is never touched for
the key. On a new device or full recovery, path 3 runs.

## Locked custody decision: provider covers recovery (server-recoverable)

Grant's call 2026-06-07, after the tradeoff was spelled out, "Google OR whatever
3rd party thing they used covers you." So the provider login is the full
recovery path for total device loss, with nothing for the user to keep.

The honest consequence, recorded so nobody is surprised later: because the
provider alone must be able to restore the key on a fresh device with no user
secret, the server recovery wrap (path 3) is a wrap the server CAN open. So the
identity server operator (us) is technically capable of unwrapping a lab user's
key, and therefore of reading what is sealed to that user (collab updates,
cross-boundary sends). It is guarded by access control, KMS policy, and audit
logging, not by mathematics. This is the standard cloud-account-recovery posture.

This is accepted deliberately for the UX. Notes on scope and honesty:
- The exposure is narrow. It covers data that passes through us sealed to the
  user (collab relay traffic, cross-boundary sends), NOT the bulk research, which
  lives as local files in the user's folder that we never see, and NOT solo users.
- The collab relay stays E2E-blind in transit regardless. Only identity-key
  custody is server-assisted.
- Marketing must not claim zero-knowledge / "we cannot read your data" for LAB
  collab. Solo remains fully local and that claim holds for solo.
- Hardening to still do at build, KMS-only unwrap (no raw key in app config),
  unwrap calls audit-logged, plaintext key never logged and held client-side in
  memory only. Optionally raise the bar later with split/HSM custody so an unwrap
  requires deliberate multi-party action.
- A future "high-security lab" mode (recovery-code-backed, server cannot recover)
  can be offered as an opt-in for the paranoid without changing this default.

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
    round-trips to a session). Pure plumbing, no identity logic yet. GATED on
    Grant creating the Google OAuth client.
L1. Identity server endpoints, `POST /identity/wrap` (store the server recovery
    wrap) and `POST /identity/unwrap` (retrieve), KMS-backed, authorized by
    provider session, unwrap calls audit-logged. Plus directory auto-publish of
    the pubkey.
L2. Lab create flow, provider sign-in mints keypair, calls server wrap,
    publishes pubkey, then offers passkey enrollment (reusing the existing
    PASSKEY_IDENTITY_UNLOCK PRF wrap), enters. Replace the forced
    CreateLocalIdentityStep page on the lab path with this.
L3. Lab returning flow, dual path. Passkey present, one-tap PRF unwrap into
    session-key, no server call. No passkey, provider sign-in then server unwrap,
    offer to enroll a passkey on this device. Switch user becomes this login.
L4. Solo path audit, confirm solo is untouched and still ceremony-free.
L5. Reconcile the passkey UI, it now serves the lab daily one-tap path (and solo
    opt-in device unlock), not a separate recovery-code ceremony. Remove the
    lab-facing recovery-code surface (provider covers recovery).
L6. Verify, then Grant live test (real Google sign-in on device A, passkey enroll,
    one-tap relogin, then device B provider-recovery unwrap).

## What this does NOT change

- Solo folders stay exactly as they are.
- The collab relay stays E2E-blind (sealed to recipient pubkeys).
- Attribution, in-lab `shared_with` record sharing, and the synced-folder model
  are unchanged.
- `SHARING_ENABLED` still gates the whole lab/sharing surface in prod, so this
  ships dark until Grant flips it.
