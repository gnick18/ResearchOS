# Passkey identity unlock (WebAuthn PRF), with a recovery-code backstop

Status: DRAFT for sign-off. No code until Grant approves.
Author: sharing infra
Date: 2026-06-05

## Why

Setting up and moving a sharing identity today leans on a 12-word recovery
phrase. A user who links the wrong account, switches devices, or loses the words
hits real friction, and the panel can land in a "Key not on device" dead end
whose only escape is typing 12 words or starting over. Grant hit exactly this
while moving his identity from a personal Google account to his school account.

The fix is not to drop end-to-end encryption. It is to stop using a typed phrase
as the everyday thing that guards the on-device key. We wrap the key with a
passkey (WebAuthn PRF) so the user just signs in with the Google or Apple passkey
they already have, the key unwraps automatically, and it follows them across
devices through their platform keychain. The server still never sees the
plaintext key. We keep a recovery code as the ultimate fallback for the
lost-and-unsynced-passkey case (Grant's locked choice, 2026-06-05).

### Reframing the stakes (important context)

While scoping this we confirmed how key loss actually plays out in this codebase,
because it changes how scary "lose your key" really is.

- Your own local notes live in your data folder in plaintext. They are never
  encrypted under the sharing key, so losing the key cannot lose them.
- Collab is OPTION B, server-readable (see `frontend/src/lib/collab/server/db.ts`
  line 4). In collab the identity key is only a request-auth credential (Ed25519
  signatures proving membership). Note content is stored as plain Loro bytes the
  client just imports. Losing the key does NOT permanently lose collab notes. You
  rebind your email to a fresh key, you are still a member, you pull the doc.
- The only content genuinely sealed to the key is un-imported cross-boundary
  inbox items (`sealToRecipient`). Lose the key plus the recovery path plus every
  device and those specific pending items become unopenable. Once imported they
  are plaintext in your folder.

So the identity key is mostly a recoverable login credential plus a seal-key for
the inbox relay. That makes this passkey work a near pure UX win with low
data-loss risk, which is why it is worth doing well rather than fearing it.

Separate flag, not part of this work. Because collab is Option B the server can
currently read collab content, which is in tension with the "we cannot read your
data" trust-flip for the collab surface specifically. That deserves its own
deliberate decision later and is out of scope here.

## What we are NOT changing

- The keypair, fingerprint, and the cross-boundary E2E model stay exactly as they
  are. Passkeys change how the on-device private key is unwrapped, nothing about
  what it does.
- The existing 12-word recovery phrase keeps working. Passkey is layered on top,
  it does not replace the words for users who already have them.
- Inbox sealing stays E2E. The PRF secret and the unwrapped key never leave the
  device.

## How the current scheme works (what we build on)

From `frontend/src/lib/sharing/identity/backup.ts`. The private key bundle is
sealed with XChaCha20-Poly1305. The 32-byte wrapping key is derived with Argon2id
from a secret. Today there are two such wrapped blobs.

1. A passphrase blob that may mix in a device salt.
2. A mnemonic blob derived from the 12 words with no device-salt dependency, so
   the words alone unlock it on a brand new device.

The mnemonic blob is stored in the directory as one opaque `key_backup_blob text`
field (`frontend/src/lib/sharing/directory/db.ts`), retrievable by email-OTP
proof and unwrappable only by the words.

The whole design here is to add a THIRD wrapped blob whose 32-byte wrapping key
comes from a WebAuthn PRF output instead of Argon2id-over-a-secret. Same
ciphertext envelope, same private bundle, different source of the wrapping key.

## The passkey mechanism (WebAuthn PRF)

WebAuthn's `prf` extension lets a credential deterministically return a secret
keyed to a caller-supplied salt. The same passkey plus the same salt always
returns the same bytes, and a synced passkey (iCloud Keychain, Google Password
Manager) returns the same bytes on every device it syncs to, because PRF is keyed
by the credential which itself syncs. The bytes never leave the authenticator API
boundary in a way the server sees.

Derivation. Take the raw PRF output, run it through HKDF-SHA256 with a fixed
info string to get a clean 32-byte XChaCha20-Poly1305 wrapping key. We never use
the PRF output as a key directly.

Enrollment (first time, on a device that already holds the unwrapped key).

1. `navigator.credentials.create(...)` with `prf` requested, tied to the
   ResearchOS relying-party id. The user picks Google or Apple as the passkey
   provider in the browser's native sheet.
2. Read the PRF output for our fixed salt, HKDF to a wrapping key.
3. Wrap the existing private bundle into a new blob tagged
   `alg: "webauthn-prf"`, recording the credential id.
4. Publish that blob to the directory alongside the mnemonic blob (storage shape
   below).

Everyday unlock (key not on this device, passkey is).

1. Identify the account by OAuth or email-OTP, the same proof the wizard already
   does.
2. Fetch the passkey-wrapped blob for that email.
3. `navigator.credentials.get(...)` with `prf` and our salt, allowing the stored
   credential id. The user taps their passkey.
4. HKDF the PRF output, unwrap the blob, save the private keys to IndexedDB.
   The panel flips to ready with no words typed.

New device with a synced passkey. Identical to everyday unlock. The synced
passkey produces the same PRF bytes, so the fetched blob unwraps with no extra
steps.

Recovery code backstop (lost or unsynced passkey). The backstop is a
high-entropy formatted recovery code in the 1Password-Secret-Key style, decided
2026-06-05. Crucially this is NOT a new recovery primitive. It is the same 128
bits of entropy the BIP39 mnemonic already carries, rendered as grouped Crockford
base32 (for example XXXX-XXXX-XXXX-XXXX-XXXX-XXXX) instead of 12 dictionary
words. We derive the wrapping key from the raw 16 random bytes, so the rendering
is purely presentational and the Argon2id-wrapped blob is unchanged in strength.

Why high entropy and not a genuinely short code. The wrapped blob is stored
server-side so a new device can recover with just the code plus an email proof.
Vercel has no trusted-execution hardware to rate-limit guesses (stated in
backup.ts), so a low-entropy code could be brute-forced offline after a directory
breach. 128 bits keeps offline brute force infeasible even with the Argon2id
hardening. Short, server-recoverable, and breach-safe cannot all be true, so we
keep the entropy and improve only the rendering.

Compatibility. Existing identities that saved 12 BIP39 words keep working
unchanged, the words decode to the same 16 bytes. New identities created through
the passkey-first flow are shown the base32 code. Build cost is a small
encoder and decoder plus a parser that accepts either rendering, no new KDF or
cipher work. Passkey enrollment ends with a "save your recovery code" step that
stores this blob.

## Storage shape (FLAG, data-shape change, confirm before code)

Today the directory holds one `key_backup_blob text` column carrying the mnemonic
blob. Passkey needs a second blob. Two options.

Option 1, JSON envelope, no migration. Store a small versioned JSON object in the
existing `key_backup_blob` column holding named blobs, for example
`{ v: 2, mnemonic: <blob>, passkeyPrf: <blob> }`. A v1 reader sees only the old
shape, and we upgrade lazily on next write. No schema change, fully backward
compatible. Recommended.

Option 2, second column. Add `passkey_backup_blob text` to
`directory_identities`. Cleaner SQL, but a real migration on the production Neon
directory.

DECIDED 2026-06-05, Option 1, the JSON envelope, no Neon migration. Still a
data-shape change, the envelope version bump and lazy upgrade land behind the
sharing flag.

The per-user sidecar (`_sharing_identity.json`) gains one optional public field,
`passkeyEnrolledAt`, so the settings panel can show passkey status without a
directory round-trip. Public field only, no key material, consistent with the
existing sidecar contract.

## Browser support

ResearchOS is already Chrome and Edge only because it requires the File System
Access API (Brave is explicitly unsupported). Chrome and Edge support the
WebAuthn `prf` extension, so this lands inside the existing support envelope with
no new exclusions. We still feature-detect and fall back to the words path if PRF
is unavailable, so nobody is ever locked out by a browser gap.

## UI surfaces

- Setup wizard. After the email or OAuth proof and key generation, add a "Set up
  a passkey" step, then the "save your recovery code" step. A user can skip the
  passkey and stay on words only.
- Settings identity panel (`SharingSection.tsx`). The ready state shows passkey
  status and offers "Add passkey" or "Remove passkey". The needs-restore state
  offers "Unlock with passkey" as the primary action above "Restore with recovery
  code", with the Reset action we just shipped still present as the clean-slate
  escape hatch.
- This also resolves the "Change linked email" request. With the key unwrappable
  by passkey on demand, rebinding the same keypair to a new email becomes a
  signed re-verify of the new address rather than a destructive reset. We fold
  that flow into this work since both live in the same panel and both need the
  key available. It is called out as its own chunk below.

## Threat model notes

- A directory breach yields only wrapped blobs. The passkey blob is useless
  without the PRF output, which only the user's authenticator can produce.
- Phishing the OAuth login still does not reveal the key, because OAuth only
  proves the email. The attacker would also need the user's passkey to unwrap.
- The PRF salt is fixed and public, which is fine, the security comes from the
  authenticator-held credential, not salt secrecy.
- We keep the device-salt mixing for the passphrase blob untouched.

## Rollout phasing (proposed chunks)

1. Crypto core. PRF-wrapped blob create and open in `backup.ts`, HKDF derivation,
   the storage envelope, unit tests with a mocked PRF. No UI, no network.
2. Directory plumbing. Read and write the envelope through `upsertBinding` and the
   recover route, behind the Option 1 shape.
3. Enrollment UI. The wizard "Set up a passkey" plus "save your recovery code"
   steps.
4. Unlock UI. The needs-restore "Unlock with passkey" path and the settings
   "Add / Remove passkey" controls.
5. Change linked email. Signed rebind of the same keypair to a new verified email,
   using the passkey-unwrapped key.

Each chunk is independently shippable behind the existing sharing flag. Chunks 1
and 2 are orchestrator-verifiable by unit test. Chunks 3 through 5 need Grant to
test in a browser with a real passkey, since WebAuthn cannot be driven headless
here.

## Relying-party id

DECIDED 2026-06-05, the rp id is `research-os.app`, the real production domain
(confirm the exact spelling once, a wrong rp id silently breaks every passkey).
We develop against it from the start so enrolled passkeys carry to production with
no re-enroll. The throwaway research-os-xi.vercel.app domain is NOT used as the rp
id, since passkeys bound to it would break on the move to research-os.app. For
pure local development the rp id is localhost (a separate scope), and the
production build uses research-os.app.

## Decisions locked (2026-06-05)

1. Backstop. Passkey for everyday unlock, plus a recovery code as the ultimate
   fallback.
2. Storage shape. Option 1, JSON envelope in the existing key_backup_blob column,
   no Neon migration.
3. Relying-party id. research-os.app, pinned from the start.
4. Recovery code. High-entropy formatted code (1Password style), the same 128-bit
   secret as the mnemonic rendered as grouped base32, existing 12-word identities
   stay valid.

## Still to confirm before build

- Exact spelling of the production domain for the rp id (taking it as
  research-os.app).
- Sign-off to start chunk 1 (crypto core), which is unit-testable and touches no
  UI or network.
