# Reconciling the password-manage popup and the Telegram backup with keypair login

Status: DRAFT for sign-off. Part of the identity model phase 1 cutover (see
IDENTITY_MODEL_SIMPLIFICATION.md). The core login cutover (gate, keypair login,
setup, recovery) is built and verified on the `identity-cutover` branch. This
covers the entangled remainder before that branch can merge.

## The entanglement

The account password does two jobs today, not one.

1. Login gate. A PBKDF2 hash in `users/<u>/_auth.json` that login compares
   against. ALREADY replaced on the branch by the keypair model, login now
   unwraps the local keypair in `_account.json`.
2. Encryption key for the Telegram backup. The Telegram bot token is stored
   encrypted in `users/<u>/_telegram-encrypted.json`, under an AES key derived
   from the account password via PBKDF2-SHA-256 (600k iterations,
   `lib/telegram/encrypted-backup.ts`). A strict in-memory password cache
   (`lib/auth/cached-password.ts`, never persisted, wiped on logout / switch /
   folder-change / idle / auth-fail) holds the password so the Telegram poll can
   decrypt the token without re-prompting on every tick.

So the password cannot simply go away. It, or a key derived from it, still
encrypts the Telegram token, and the cache still feeds the decrypt loop. This is
why `AccountPasswordPopup` (set / change / remove) carries a decrypt-old then
re-encrypt-new dance on a password change.

## The decision that shapes everything, how the Telegram backup is keyed

Two coherent options.

Option A, keep the password as the Telegram key (recommended, minimal). The
password still exists and is still meaningful, it now unwraps the keypair AND
keys the Telegram backup. Nothing about `encrypted-backup.ts` or the cache
changes. The only new wiring is that the keypair login path caches the password
on a successful unlock (the old hash-verify path already did this), so the
Telegram decrypt loop keeps working. A password change re-wraps the keypair AND
decrypts-old / encrypts-new the Telegram backup, the same dance as today. Lowest
risk, no Telegram migration, ships the cutover fastest.

Option B, re-key the Telegram backup off the local keypair (cleaner, later).
After login the keypair sits in IndexedDB, so derive the Telegram AES key from
the keypair (HKDF over the X25519 secret) instead of the password. This deletes
the password cache entirely, the keypair is the secret and it is already in the
session. Cleaner conceptually and removes a sensitive in-memory password, but it
is a one-time migration of every existing `_telegram-encrypted.json` and touches
the pairing flow. More work, better end state.

Recommendation, A now, B as a clean follow-up. A keeps the password meaningful
(it unwraps the keypair) and leaves the Telegram feature untouched, so the cutover
can land. B is worth doing once the cutover is stable, because eliminating the
in-memory password cache is a real security simplification.

## AccountPasswordPopup, rewritten under option A

The popup keeps its three modes, re-pointed at the account store.

- Set (no account yet). `createAndPersistAccount(username, password)`, then
  `setCachedPassword(password)` and show the recovery code once. This is the
  solo-account opt-in path, shared folders already create the account through the
  login force-gate.
- Change. `changeAccountPassword(username, current, new)` re-wraps the keypair
  (returns null on a wrong current password, which replaces the old hash verify).
  If a Telegram backup exists, decrypt with the old password and re-encrypt with
  the new (the existing re-encryption logic, KEPT verbatim), then
  `setCachedPassword(new)`. The recovery code is unchanged.
- Remove. Only offered for a genuinely solo folder (folderRequiresLogin false).
  Removing deletes `_account.json` and clears `_telegram-encrypted.json` (its key
  is going away). For a shared folder the action is disabled with a note, login is
  mandatory there.

The popup stops importing `lib/auth/password.ts` (the hash API) and uses the
account store plus `hasLocalAccount`. The Telegram re-encryption helpers and the
password cache stay exactly as they are.

## The password cache, under option A

Unchanged module. The new requirement is that the keypair login path calls
`setCachedPassword(password)` on a successful `loginWithPassword`, and the setup
path calls it after `createAndPersistAccount`, so the Telegram decrypt loop has
the password it needs. All existing wipe triggers stay. The recovery-code login
path does NOT cache a password (there is none typed), which is correct, a user who
recovered will be re-prompted for the Telegram decrypt or can set a password.

## Migration, folds into wipe-and-re-establish

Existing users have no `_account.json`, so on next login they set a password and
`createAndPersistAccount` runs. Their old `_telegram-encrypted.json` was encrypted
under their OLD password, which the new password does not reproduce, so that
backup is orphaned. The account-creation cleanup (which already supersedes
`_auth.json` and a stale `_sharing_identity.json`) also clears
`_telegram-encrypted.json`. The user re-pairs Telegram, acceptable pre-launch and
re-doable in a minute.

## Decisions locked (2026-06-05)

1. Telegram key, OPTION B, re-key off the keypair. Derive the Telegram AES key
   from the local keypair (HKDF over the X25519 secret) instead of PBKDF2 over the
   password. This DELETES `lib/auth/cached-password.ts` entirely, the keypair is
   the secret and it already lives in the session after login. A one-time
   migration clears old password-keyed backups (see below).
2. Remove-password, SOLO-ONLY. Allowed only for a genuinely solo folder (deletes
   `_account.json` and `_telegram-encrypted.json`). Disabled with a note for shared
   folders, login is mandatory there.
3. Orphaned backup, CLEAR IT. Account-creation cleanup also deletes
   `_telegram-encrypted.json`, the user re-pairs Telegram.

### What option B changes versus the draft above

- AccountPasswordPopup change-mode gets SIMPLER, not harder. Because the Telegram
  backup is keyed off the keypair (which does not change on a password change, only
  its wrapping does), a password change is just `changeAccountPassword`, the
  decrypt-old / encrypt-new Telegram dance is DELETED.
- `lib/auth/cached-password.ts` is removed, along with every wipe-trigger call
  site. The Telegram decrypt loop calls `loadIdentity()` and derives the key from
  the keypair at the moment of need.
- `lib/telegram/encrypted-backup.ts` derive function changes from PBKDF2-over-
  password to HKDF-over-X25519-secret. `encryptToken` / `decryptToken` take the
  keypair (or the derived key) instead of a password string.
- Telegram callers (`file-system-context.tsx`, `TelegramEncryptedRecoveryPrompt`,
  `TelegramPairingModal`) stop passing a password and pass the keypair.

### Build order (option B)

1. Re-key `encrypted-backup.ts` off the keypair (HKDF over X25519), unit-tested.
2. Rewire the Telegram decrypt/pair callers to the keypair, delete
   `cached-password.ts` and its wipe-trigger calls.
3. AccountPasswordPopup to the account store (set / change / solo-only remove), no
   Telegram dance.
4. Account-creation cleanup clears `_telegram-encrypted.json`.
5. Verify, then merge `identity-cutover` to main after Grant's real-folder test.
