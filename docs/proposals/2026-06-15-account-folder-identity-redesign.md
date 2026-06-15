# Account / Folder / Identity Redesign

**Status:** Proposal — **core decisions LOCKED 2026-06-15** (Grant). Design only, no code yet beyond Phase A. Beta, <10 users — temporary breakage is acceptable, so we do this *right* rather than patch it.
**Date:** 2026-06-15
**Owner seam:** the cloud-accounts / identity lane (`[[project_cloud_accounts_local_data]]`). This is security-sensitive; the identity parts must be reviewed with that lane.

### Locked decisions (2026-06-15)
1. **Identity:** *reuse-don't-mint* — one keypair per account, restored + re-wrapped into each folder; the folder sidecar becomes a reference. Builds on existing `DEVICE_KEY_V2` / `cloud-restore` machinery.
2. **Recovery:** **hybrid (Apple iCloud model)** — server-assisted recovery (recoverable via OAuth) is the DEFAULT; strict E2E ("Advanced Protection", only-you, we-can't-recover) is an OPT-IN. Plaintext-data floor + reset-keep-data + PI re-admit underneath both. (See §4.4.)
3. **Migration:** **clean reset** for the <10 beta users — everyone re-establishes identity fresh (new keypair, new recovery code); simplest, acceptable at this size.
4. **Next:** start **Phase A** (folder switcher, identity-independent) now; co-design Phases B–C with the identity lane before any code there.

---

## 1. Why we're doing this

Three real failures, all rooted in **one wrong assumption: identity is owned by a folder.**

1. **Multi-lab is broken.** A researcher in two labs has two folders. Today each folder mints its *own* keypair (`createLocalIdentity`), and the cloud directory holds exactly `one email → one keypair`. Publishing from the second folder *overwrites* the first folder's directory entry. So one person genuinely cannot be themselves in two folders.
2. **No folder switching.** IndexedDB stores exactly one folder handle (`research-os-directory-handle`). Switching labs = `disconnect()` (wipes the handle) → `connect()` (OS picker) → re-unlock. Every time.
3. **Recovery is per-folder and brittle.** Each folder has its *own* recovery code (the only backstop). There's no admin reset, no server preimage. Lose the code → that identity is gone forever. And the app gates entry on identity unlock, so a locked-out user can't even reach their own (plaintext) data through the app.

## 2. The reframe that lowers the stakes

**Notebook data is plaintext on disk** (at-rest encryption exists but is behind `DEVICE_KEY_V2`, which is OFF). The keypair only protects **signing, sharing, and proof-of-you** — not the notes themselves. So a lockout today loses your *identity*, not your *research*. This is the single most important framing: recovery must restore **access and signing authority**, and the data is almost always still right there.

⚠️ The moment `DEVICE_KEY_V2` (at-rest encryption) ships, lockout flips to **real data loss**. So recovery has to be solved *before* that flag is ever turned on.

## 3. Target model

> **The cloud account IS the identity. Folders are workspaces the account opens. Recovery protects the one identity.**

- **One identity per person**, generated once, cloud-backed (sealed under one recovery code), restorable on any device. This is the existing `DEVICE_KEY_V2` / `cloud-restore` capability, promoted from "off, multi-device only" to "on, the default, multi-folder too."
- **Folders are just data locations.** A folder no longer *owns* a keypair. When you open a folder as your account, your **existing** identity is restored/reused (not minted fresh). The folder's sidecar becomes a *reference* ("worked in by public key X"), not the keypair's home.
- **Many remembered folders + a switcher.** Persist N folder handles + an "active" pointer + a recent list. A "switch lab" control flips folders without re-picking or re-unlocking.
- **Recovery centralized.** One recovery code + one cloud backup for the one identity. Plus a lockout escape, PI re-admit, and optional pre-provisioning (below).

This is the natural completion of the **"cloud accounts, local data"** vision already in flight — not a new direction.

## 4. What gets rebuilt / redesigned / migrated

Ordered by layer, with the concrete seams.

### 4.1 Identity layer — *reuse, don't mint* (biggest, most sensitive)
- **Change the provisioning rule.** `autoProvisionFromAccount` (`UserLoginScreen.tsx:~603`) and the create-identity paths must, when a signed-in account **already has an identity** (in the device vault or restorable from cloud), **restore and re-wrap it into the folder** rather than calling `createLocalIdentity` to generate a new keypair.
- **Folder sidecar becomes a reference.** `_sharing_identity.json` (`sidecar.ts`) keeps the public key + a `recoveryBlob`, but the keypair it wraps is **the account's one keypair**, identical across every folder. The directory's `one email → one keypair` model is now *correct* (there really is one keypair).
- **Device vault stays** (`device-vault.ts`) — it's the per-device at-rest hold of the one keypair; safe and unchanged.
- **Files:** `lib/sharing/identity/storage.ts`, `sidecar.ts`, `provision.ts`, `cloud-restore.ts`, `UserLoginScreen.tsx` (auto-provision), `lib/account/account-first.ts`.

### 4.2 Folder layer — multi-handle (safest; can ship first)
- **IndexedDB: single handle → keyed set.** Replace the lone `DIRECTORY_HANDLE_KEY` (`indexeddb-store.ts:3`) with a per-folder key + an "active folder" pointer + a recent-folders list.
- **Context API.** Add `listFolders()`, `switchFolder(id)`, `forgetFolder(id)` alongside `connect()` / `disconnect()` in `file-system-context.tsx`. Track `activeFolder` + a `folders` map.
- **No identity dependency** — this layer is the low-risk first phase.

### 4.3 Entry / login flow
- **Entry becomes: sign in → pick a folder.** Once signed in as your account (one identity), the screen lists the **folders/labs you can open**, not per-folder "users." Pick one → open under your identity.
- **The "Select your account" screen is replaced** by "Select a workspace/lab." This *finishes* the direction the recent login cleanup started — we already removed per-folder "Create New User," because in this model there is no per-folder user, only your account opening folders.
- **Files:** `UserLoginScreen.tsx`, `providers.tsx`, `lib/.../landing-gate.ts`, `FolderConnectGate.tsx`.

### 4.4 Recovery layer (new) — the hybrid (Apple iCloud) model

**Mental model:** everyone has a **recovery code** + an **auto-unlocking trusted device**. The two tiers differ only in whether the *server* can also help.

- **Default tier (recoverable):** the server holds an escrowed copy of the key, released only after the user re-proves themselves via OAuth. So **"sign in with Google" is a real recovery path.** This is what users expect from modern software.
- **Strict tier (opt-in, "Advanced Protection"):** the server holds **nothing**. Only the recovery code or a still-logged-in device gets you back. We cannot recover it — by design, for labs that need a true zero-knowledge guarantee (IP, clinical / human-subjects, compliance).

**Plaintext-data floor (both tiers):** because notebook data is plaintext on disk, **"reset identity, keep your data"** is always the worst case — you never lose research, you only lose old signatures + the ability to decrypt things previously shared *to* you. This is also the no-soft-lock escape (`[[feedback_no_soft_locks]]`).

**PI involvement is sharing-only:** after any reset, the member's NEW public key is re-admitted to the lab roster so *sharing* resumes. The PI is **never** needed to recover a member's own data or identity. Files: `components/lab-head/LabRoster.tsx`, `lib/lab/*`.

**Lockout behavior, by scenario:**

| What happened | Default tier (recoverable) | Strict tier (opt-in E2E) |
|---|---|---|
| Forgot recovery code, still have Google | Sign in with Google → server reissues the key. Nothing lost. | Use a still-logged-in device, else → reset-keep-data. |
| Lost Google access, but have recovery code | Type the code → in (provider not required). | Same. |
| Forgot *which* provider | Account shows it (e.g. "Google · j•••@gmail.com"); sign in there. | Reminder shown; recovery still via the code. |
| New laptop, have Google | Sign in with Google → key auto-restored to the device. | Need the recovery code (or transfer from a device you're on). |
| Lost Google AND forgot recovery code | Still-logged-in device, else → reset-keep-data. | Identity gone (the opted-in promise) → reset-keep-data. |
| Future student (PI pre-provisioned) | Invite hands a ready account, escrowed via their Google; later loss → recover via Google. | Same setup, handed a recovery code; later loss → reset-keep-data. |
| Shared-lab member did a reset | New key auto re-escrows; PI re-admits it to the roster. Own data fine throughout. | Same; PI re-admit is sharing-only. |

**Build pieces:**
- **Per-account recovery code** (one, not per folder), shown once, frictionless backup (print/download).
- **Server key escrow + OAuth-gated reissue** (the default tier). Secure wrapping, access controls, audit log, reissue flow. This is the heaviest new backend surface and the main security-review item.
- **Tier toggle** ("Advanced Protection" opt-in) + clear disclosure of the trade.
- **Reset-keep-data escape** (client-side) + **PI re-admit** flow.
- **Optional pre-provisioning** — a PI invite that carries a one-time setup so a *future* student claims a ready account on first entry. Files: `lib/.../invite-tokens.ts`, `lab-invite.ts`.

> ⚠️ The default tier means **we hold recoverable keys** — so we become a target, are legally compellable, and must build escrow correctly. Accepted as the right trade for mainstream UX; the strict opt-in is the escape hatch for users who can't accept it. Revisit the default once at-rest encryption (`DEVICE_KEY_V2`) is on the table, since escrow weakens its vendor-protection.

### 4.5 Sharing / lab / roster
- **Roster keys off the account's stable public key** (now stable across folders — a strict improvement). Invite/accept harvests the account identity, not a folder-minted one.
- **Multi-lab membership falls out for free:** one account in several labs = several roster memberships, no overwrite.

### 4.6 Migration (beta-friendly)
- Existing users have per-folder keypairs + per-folder recovery codes. For <10 users we can do a **guided one-time migration** (or, acceptable in beta, a clean reset): on next launch, establish the account's canonical identity (restore the cloud one if published, else promote the current folder's keypair to the account identity), then re-wrap each connected folder's sidecar to it.

## 5. Phasing (safe-first)

1. **Phase A — Folder switcher (no identity change).** Multi-handle persistence + `switchFolder` + recent-labs UI. Ships value immediately, zero security surface.
2. **Phase B — Identity reuse.** Flip provisioning from *mint* to *restore-and-reuse* the account identity across folders; turn on the cloud-restore default. Behind a flag; this is the sensitive one.
3. **Phase C — Recovery & lockout.** Reset-keep-data escape, PI re-admit, one-code backup UX, optional pre-provisioning.
4. **Phase D — At-rest encryption.** Only after C is solid, consider turning on `DEVICE_KEY_V2` (this is when recovery becomes data-critical).

## 6. Decisions — RESOLVED

All four locked 2026-06-15 (see the "Locked decisions" block at the top): reuse-don't-mint identity; **hybrid recovery** (recoverable default + opt-in strict E2E); clean reset migration; start Phase A now. Nothing here is open.

## 6b. Phase B build plan (identity reuse) — IN PROGRESS

**Goal:** when a signed-in account opens a folder, REUSE its one keypair instead of minting a fresh one per folder.

**The seam (confirmed in code):**
- `createLocalIdentity` (`storage.ts:182`) mints a new keypair + wraps it under a fresh recovery code + writes a sidecar carrying that `recoveryBlob`. This is the per-folder mint we are replacing.
- `SharingIdentitySidecar.recoveryBlob` is **optional** (`sidecar.ts:66`), so a public-only "reference" sidecar is already a legal shape.
- The session/vault already hold the account's keypair on a device that has set up before (`loadIdentity()` / `restoreSessionFromStore()`); `cloud-restore.ts` (`/api/directory/my-backup`) restores it on a new device.

**Increment 1 — DONE (this commit):** new primitive `writeIdentityReferenceSidecar(username, keys)` (`storage.ts`) — writes a reference sidecar (public keys + fingerprint + createdAt, **no** recoveryBlob) reusing an existing keypair, parks it in the session. Recovery stays account-level (vault + cloud + originating folder). Unit-tested (`write-identity-reference-sidecar.test.ts`, 3 tests): correct shape, no recoveryBlob, same keypair reused across two folders. Purely additive — no existing flow changed, safe to land.

**Increment 2 — DONE (the behaviour change):** `autoProvisionFromAccount` (`UserLoginScreen.tsx`) now, under `MULTI_FOLDER_ENABLED`, REUSES the device's keypair via `writeIdentityReferenceSidecar` instead of `createLocalIdentity` **when it is verified to be the signed-in account's** (decision below). First-ever folder for an account still mints. Verification, offline, unpublished, mismatch, or flag-off all fall back to the original mint, so it is never less safe than before. tsc 0; identity suite 98 tests pass.

### ✅ Phase B verification decision (LOCKED 2026-06-15): directory fingerprint match
Reuse the device keypair only if `fetchMyProfile()` (`GET /api/directory/profile`, OAuth-authed) returns a published profile whose `fingerprint` matches the device keypair's fingerprint (`compactFingerprint` on both sides). Any miss → safe fallback to mint. Lightweight (one authed read), no recovery code needed for the common same-device second-folder case, and a previous user's vault key on a shared machine can never be reused (their fingerprint won't match the new signer's published profile).

**Increment 3 — DONE (the follow-ons):** factored `reuseAccountIdentityIfVerified(username)` (flag-off short-circuits to false) and applied it across the identity flow:
- **Manual create-user path** (`handleColorPickerAccept` + `handleCreateUser` fallback): reuse the verified on-device identity instead of forcing a fresh mint.
- **Reference-sidecar login** (`handleLogin`): a user whose folder sidecar has no `recoveryBlob` but whose device identity public-keys + fingerprint MATCH signs in directly, skipping both the unlock gate and the force-profile gate. A genuine new member (no/mismatched local key) still gets forced correctly.
- **Cross-device safe guard** (`autoProvisionFromAccount`): on a new device with no local key but a published profile elsewhere, do NOT mint a divergent keypair — stop and point at recovery. The full cross-device restore UX (cloud-restore + reference-sidecar) is marked `// Phase C:` and lands with recovery.

tsc 0; identity suite 98 tests pass; flag-OFF byte-identical (helper inert, all new branches behind `MULTI_FOLDER_ENABLED`). **Phase B core + follow-ons COMPLETE; only the Phase-C-dependent cross-device restore UX remains, by design.**

## 7. Coordination

The identity pieces (4.1, 4.4, 4.5) overlap the cloud-accounts / identity lane's owned surface. Phase A (4.2) is independent and safe to start. Phases B–C should be co-designed with that lane before code, given the security implications.
