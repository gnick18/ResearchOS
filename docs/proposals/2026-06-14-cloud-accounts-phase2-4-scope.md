# Phases 2-4 scope: keypair as a per-device data credential, social layer, lab reconciliation

Status: scoping plan for review (no code yet). 2026-06-14.
Parent: `docs/proposals/2026-06-13-cloud-accounts-local-data.md` (design + decisions locked).
Phase 1 (decouple account from folder, @handle, folderless `/account`) is COMPLETE and on main.

**Key grounding finding (from a fresh code audit).** The crypto foundation is already built; Phases 2-4 are mostly *wiring + hardening + UX*, not new cryptography:
- Keypair generation (`identity/keys.ts`), Argon2id wrap/unwrap (`identity/backup.ts`, `device-key.ts`), recovery code/words (`recovery-code.ts`), sealed-box `sealToRecipient`/`openSealed` and the one-time-key invite path (`encryption.ts`) all exist and are tested.
- The folder sidecar already stores the keypair WRAPPED under the recovery code (not raw) as `recoveryBlob`.
- The Neon cloud backup blob already exists: `directory_identities.key_backup_blob` holds the recovery-words-wrapped keypair, uploaded via `POST /api/directory/oauth-bind` (OAuth-session authed) and fetched via `getBackupBlob(emailHash)`.
- Remaining weak spot: the RAW unwrapped keypair is still persisted in browser IndexedDB (`researchos-sharing-identity`) as a "transition fallback"; the in-memory session-key holder is already the authoritative store.

So the real gaps are: (a) no folderless cross-device RESTORE flow off the Neon blob, (b) no provision-on-demand of a key against an account-first (folderless) account, (c) the raw IndexedDB key, (d) social polish, (e) lab deferred-sealing.

---

## Phase 2: keypair becomes a per-device data credential

### Chunk 2A. Folderless cross-device key restore (the headline)
A signed-in (OAuth) user on a NEW device/browser with NO folder recovers their E2E keys from the Neon backup blob by entering their recovery words. No folder required.
- New folder-free restore path: `recoverDeviceKeyFromCloud(recoveryInput)` that (1) `GET`s the caller's own backup blob (new `GET /api/directory/my-backup`, authed by OAuth session, returns `key_backup_blob` for the session email hash), (2) unwraps via the existing `unlockDeviceKeyWithRecovery()`, (3) `setSessionIdentity()` + persists per the 2C policy.
- UI: an "Unlock your data on this device" card on `/account` shown when signed-in + a published key exists (directory has their pubkey) + no local key in this browser. Recovery-words input, error states, success → key live for the session.
- Files: new `src/app/api/directory/my-backup/route.ts`, `src/lib/sharing/identity/cloud-restore.ts`, a card in `AccountHome`. Flag-gated `NEXT_PUBLIC_DEVICE_KEY_V2`.

### Chunk 2B. Provision-on-demand against the cloud account
When an account-first user (signed in, no keypair) takes a first E2E/sharing action, generate the keypair, publish pubkeys + upload the backup blob via the existing OAuth bind, and show the recovery kit once.
- Reuse `createLocalIdentity`'s keygen + `wrapDeviceKey` (recovery words) but DROP the folder-sidecar requirement: a folderless variant that sets session identity and `POST`s `/api/directory/oauth-bind` (pubkeys + `key_backup_blob`, signed by the just-generated key, authed by OAuth session).
- One-time recovery-kit UI (the words, "save these"), with `recoveryConfirmedAt` tracked on the account (move that stamp off the sidecar to the account profile / a small Neon column so it survives folderlessly).
- Files: `src/lib/sharing/identity/provision.ts`, recovery-kit modal, hook the "needs a key" actions.

### Chunk 2C. Harden the at-rest device key  [DECISION NEEDED — see below]
Stop persisting the RAW keypair in IndexedDB. The session-key holder stays authoritative; on reload, re-hydrate from a key wrapped at rest (not raw). Remove vestigial `deviceSalt`; retire passkey remnants if any linger.
- Files: `identity/storage.ts` (the `researchos-sharing-identity` raw persist), `session-key.ts`, `device-key.ts`.

---

## Phase 3: social layer (the @handle already shipped in P1)

### Chunk 3A. Avatar
- Add `avatar_url` (or a small blob ref) to `account_profiles`; upload + display on `/account` and `/u/[handle]`. Storage: R2 (same bucket pattern as other assets) or a data-URL cap for v1.

### Chunk 3B. "Find a researcher and share" — one flow
- Merge today's two disconnected ops (search-by-name in the directory + send-by-email on the relay) into a single flow: search by @handle/name → pick → send. If the recipient has a published pubkey, seal to it; if not, fall back to the existing one-time-key invite link. Sits on the directory trigram search + relay client that already exist.

---

## Phase 4: lab / sharing reconciliation

### Chunk 4A. Deferred sealing
- Let a lab/dept/institution invite + admit a member who has NO published pubkey yet (membership = the unified server token, already built). Seal the lab data key to them via a post-join hook the first time they provision a key (2B), or bridge with the existing one-time-key path. Formalizes the membership-vs-data-key split that's already technically separable (`addMember` always seals, `checkAndEnterLab` gates on opening the sealed copy).

### Chunk 4B. Finish the lab-tier invite-token migration
- Generalize the dept/institution unified invite tokens (already shipped) to the lab tier so all three use one centralized, folderless, session-based membership path.

---

## Sequencing
1. **2C** (hardening) + **2A** (restore) first — 2C is independent and safe; 2A is the headline cross-device win and only reads the existing blob.
2. **2B** (provision) — depends on the 2C at-rest policy.
3. **3A**, **3B** — additive social, low risk; dispatchable to a sub-bot.
4. **4A**, **4B** — lab reconciliation; 4B is mostly generalizing shipped code.
Each chunk lands on local main behind `NEXT_PUBLIC_DEVICE_KEY_V2` (Phase 2) / its own flag, current flow untouched until verified.

## The one real decision (Chunk 2C): at-rest key vs reload UX
A local-first app fundamentally must keep *some* recoverable key material on the device, or the user re-enters their recovery words on every page reload (unacceptable UX). Options:
- **(A) Wrapped-at-rest in IndexedDB under a device secret** (e.g. a non-extractable WebCrypto key, or a deviceSalt-derived key kept in IndexedDB). Survives reload with no prompt; "hardening" is modest (a local attacker with the device can still unwrap, same as any local-first app), but it removes the plaintext-key-at-rest smell.
- **(B) Session-only + re-unlock from the local sidecar's recovery blob on reload** — but that's folder-only (breaks folderless) and/or needs the recovery words each reload. Not viable folderless.
- **(C) Keep raw in IndexedDB (status quo)** — simplest, but the thing the audit flagged.
Recommendation: **(A)** — wrap the at-rest key under a non-extractable WebCrypto AES key stored in IndexedDB, so the key is never sittng raw, reload is seamless, and it matches the realistic threat model for a local-first tool. Confirm before building 2C.
