# Account-centric folder identity

**Status.** Design proposal. Read plus audit, no code changed. Builds directly on the LOCKED redesign in `docs/proposals/2026-06-15-account-folder-identity-redesign.md`.
**Date.** 2026-06-20
**Owner seam.** cloud-accounts / identity lane.

## 1. The problem

Today the active person is a property of the FOLDER, not of your login. When you connect or switch to a different folder, the app re-derives who you are from that folder's `users/<username>/` directories, so swapping the data store swaps your identity. Your OAuth account (the third-party login) is NOT what folders hang off of. And nothing records which account a folder belongs to, so a different login that opens a folder created by someone else is adopted silently, with no warning before binding.

Grant's target is the natural one. One OAuth account is the identity, constant across folders. Folders are just separate data stores under that one account. Switching folders changes the data, not who you are. And a different login that tries to take over a folder owned by another account should be warned before it binds.

Good news up front. This is not a new direction. The 2026-06-15 redesign already locked exactly this model and Phases A and B (multi-folder plus identity-reuse) are already BUILT in code, behind `NEXT_PUBLIC_MULTI_FOLDER` which is OFF in prod. What is genuinely missing is the folder-ownership record and the foreign-account takeover warning. Those do not exist anywhere today.

## 2. Current model (audited)

### 2.1 Two different "identities" live side by side

There are two distinct notions of "you" in the codebase, and they are only loosely bound.

1. The per-folder user. A folder contains `users/<username>/` subdirectories. The active one is a plain string, `currentUser`, persisted in a single shared IndexedDB key `research-os-current-user` (`frontend/src/lib/file-system/indexeddb-store.ts:5`, read/written by `getCurrentUser` / `storeCurrentUser` at lines 607 and 593). Users are discovered by scanning the folder's `users/` directory (`frontend/src/lib/file-system/user-discovery.ts:25`, `discoverUsers`).

2. The OAuth account plus keypair. Signing in mints (or reuses) an Ed25519/X25519 keypair held in process memory for the session (`frontend/src/lib/sharing/identity/session-key.ts`, `getSessionIdentity` / `setSessionIdentity`) and persisted at rest in an encrypted device vault (`frontend/src/lib/sharing/identity/storage.ts:83`, `loadIdentity`). The published account is the keypair plus a verified email, recorded in the per-user sidecar `_sharing_identity.json` (`frontend/src/lib/sharing/identity/sidecar.ts:57`, fields `email`, `claimedAt`, public keys, `fingerprint`).

The binding between the two is thin. The session identity is GLOBAL (one in-memory holder, not per folder), which is what already lets one keypair span folders. But the active PERSON the app shows is the per-folder `currentUser` string, re-derived from the folder on every connect.

### 2.2 How `currentUser` is chosen on connect, and why switching swaps the person

The connect path is `finishConnect` (`frontend/src/lib/file-system/file-system-context.tsx:425`). After pointing the file service at the new handle, it:

- discovers the folder's users, `const users = await discoverUsers()` (`file-system-context.tsx:518`),
- reads the shared `currentUser` pointer, `let currentUser = await getCurrentUser()` (`file-system-context.tsx:564`),
- and VALIDATES that pointer against the new folder. If the stored `currentUser` is not one of this folder's `users/`, it is cleared and the login screen takes over (`file-system-context.tsx:571` to `639`).

So the person is recomputed from the folder. Folder A's user is `gnickles`, folder B's users are `student1` and `student2`. Connect folder B and the stored `gnickles` is "not in this folder", so it is wiped and folder B asks who you are. That is the crux Grant is pointing at. The identity is folder-derived, not login-derived.

`switchFolder` makes this concrete. It re-grants permission to the remembered handle and then calls the SAME `finishConnect(handle)` (`file-system-context.tsx:1671`). Switching swaps the directory handle AND re-runs the full user-discovery-plus-validate flow, which is why the active person changes. `setActiveFolderId(id)` (line 1668) only moves the active pointer; it carries nothing about who you are.

`setCurrentUser` (`file-system-context.tsx:1530`) is the explicit login path. On a user change it clears the per-user cache, clears once-per-session PI edit confirmations, removes per-user external-calendar query entries, and blanket-invalidates React Query (lines 1533 to 1578). In other words a user switch is treated as a full person swap, by design today.

### 2.3 Remembered folders carry no account or owner binding

A remembered folder is path plus handle plus cosmetic metadata, nothing more. The persisted row `RememberedFolderMeta` (`frontend/src/lib/file-system/indexeddb-store.ts:981`) is `{ id, name, lastOpenedAt, labRole?, labId?, labName?, nickname? }`. The directory handle lives in the `handles` object store under `folder-handle::<id>` (line 907). There is no owner email, no owner public key, no account id on the row.

There IS per-account SCOPING of the registry, but that is a different thing from ownership. The remembered-folder list is keyed by the signing public key hex of the unlocked account (`frontend/src/lib/file-system/folder-account-scope.ts:34`, `getFolderRegistryScope`, used as the `::<scope>` suffix in `indexeddb-store.ts:916`). So account X and account Y on the same browser see different folder LISTS. But this only partitions visibility in the browser. It does not stamp ownership onto the folder on disk, and a brand-new account inherits the pre-account unscoped list once (the first-account inherit at `indexeddb-store.ts:1115`, `migrateLegacyFolderIfNeeded`). Nothing stops a different account, on a different machine, from opening the same on-disk folder.

### 2.4 The closest thing to "ownership" today, and what it does NOT do

The per-user sidecar's `email` field (`sidecar.ts:59`) is the only on-disk fact that says "this account published this user." The login screen reads it as `claimedUsers`, keyed on `sidecar.email`, to decide which users can sign in online (`frontend/src/components/UserLoginScreen.tsx:185` and `:935`). Identity reuse across folders is gated by a fingerprint match against the signed-in account's published directory profile (the Phase B "directory fingerprint match" decision, `2026-06-15-account-folder-identity-redesign.md:123`, implemented as `reuseAccountIdentityIfVerified`).

But this is per-`users/<username>/`, not per-folder, and it gates SIGN-IN and key-REUSE, not folder ADOPTION. There is no folder-root record of "account A owns this folder," and crucially no check on connect that asks "is the login opening this folder the one that created it?" A foreign account that connects simply lands on the login screen and can create or claim a user. Searching the connect and claim paths for any takeover, foreign-account, or already-claimed-by-another warning returns nothing in app code. The warning does not exist.

### 2.5 How auto-claim binds an account to a folder

Under `NEXT_PUBLIC_REQUIRE_ACCOUNT` (default ON, `frontend/src/lib/account/require-account.ts:25`), a connected user with no usable identity is held at `RequireAccountGate` (`frontend/src/components/account/RequireAccountGate.tsx`) and the claim wizard reuses the live OAuth session to mint the keypair (`require-account.ts:125`, `shouldGateForClaim`; `:180`, `canAutoClaimWithSession`). This is the auto-claim flow. It binds an account to whatever folder is currently open by writing that account's keypair plus email into the folder's sidecar. It does NOT first check whether the folder already belongs to a different account. So auto-claim is the exact place a takeover would silently happen.

### 2.6 What exists versus what is dark (flags)

| Flag | File | Default | Effect |
|---|---|---|---|
| `NEXT_PUBLIC_REQUIRE_ACCOUNT` | `frontend/src/lib/account/require-account.ts:25` | ON (only `0`/`false` disables) | OAuth required, no-account entry retired, auto-claim gate live |
| `NEXT_PUBLIC_MULTI_FOLDER` | `frontend/src/lib/file-system/multi-folder-config.ts` | OFF in prod | Remembered-folder set, switcher, identity reuse across folders, reset-keep-data |
| `NEXT_PUBLIC_LAB_AS_FOLDER` | `frontend/src/lib/lab/lab-as-folder-config.ts:20` | OFF in prod | A lab is a folder, join provisions a managed member folder and switches to it |

So the account-as-identity machinery (multi-folder plus identity reuse) is BUILT but DARK. Require-account and its auto-claim are LIVE. The folder-ownership record and the takeover warning are NEITHER built nor dark, they are unwritten.

## 3. Target model

> One OAuth account is the identity, constant across folders. Folders are data stores the account opens. Switching a folder swaps the data, not the person.

This is the same target the 2026-06-15 redesign locked (its section 3). Stated against today's audit:

1. The account is the active person. The signed-in OAuth account plus its one keypair is "you" for the whole session, independent of which folder is open. The session identity holder is already global, so the plumbing exists.

2. Switching a folder swaps the data, not the person. `switchFolder` should keep the active account fixed and only repoint the data store. The per-folder user-discovery-plus-validate that currently overrides the person on every switch must be subordinated to the account.

3. The per-folder `users/<username>/` reconciles as the account's canonical home in that folder. One account maps to ONE canonical `users/<username>/` directory per folder. When the account opens a folder it does not own yet, it provisions or references its own user dir (Phase B's `writeIdentityReferenceSidecar`, `storage.ts:305`, already reuses the account keypair into a folder as a reference). When the account opens a folder it DOES own, it resolves straight to its existing user dir with no "who are you" prompt. A multi-user shared folder keeps multiple `users/` dirs, but the active account resolves to its OWN dir, the others are co-members it can see but is not.

4. Foreign-account takeover warning. When an account connects a folder whose recorded owner is a DIFFERENT account, the app warns before binding. The user can cancel (keep the folder under the original owner, open it read-or-share only) or deliberately take over (rebind, with eyes open). This is the new surface that does not exist today and is the heart of Grant's ask.

5. Takeover removes shared files the new account cannot read (Grant). The files SHARED TO the original account are sealed to that account's keypair, so a different account that takes over genuinely cannot decrypt or view them, and should not retain another account's shared documents. So the takeover warning quantifies them and the takeover removes their local copies. The new account's OWN authored content is never touched. See the audit and steps in section 4 under "Shared-file removal on takeover".

## 4. Gap audit, what needs to be made

Grouped. Each item notes ALREADY-EXISTS (reuse) versus BUILD, rough size, and the files it touches.

### Identity binding (account is the person)
- EXISTS. Global session identity holder (`session-key.ts`), reuse-across-folders via reference sidecar (`storage.ts:305`), fingerprint-gated reuse (`reuseAccountIdentityIfVerified`). Phase B is done behind `MULTI_FOLDER_ENABLED`.
- BUILD, medium. Make the active person derive from the signed-in account rather than from `currentUser` re-discovered per folder. Today `finishConnect` recomputes `currentUser` from the folder (`file-system-context.tsx:564` to `639`). Target. When an OAuth session is present, resolve the account's canonical user in the folder first, and only fall back to folder discovery when there is no session. Touches `file-system-context.tsx` (`finishConnect`, `setCurrentUser`), `account-first.ts`.

### Switch semantics (swap data, not identity)
- EXISTS. `switchFolder` repoints the handle and active pointer (`file-system-context.tsx:1622`).
- BUILD, medium. Keep the account fixed across a switch. `switchFolder` currently funnels through `finishConnect`, which re-runs person discovery. Either pass an "active account" through `finishConnect` so it resolves the account's user directly, or split person-resolution out of `finishConnect` so a switch never asks "who are you" for a folder the account already owns. Touches `file-system-context.tsx`.

### Folder-ownership record (the missing fact)
- DOES NOT EXIST. Today the only on-disk owner hint is the per-user sidecar `email`, which is per-user, not per-folder, and is not consulted on connect.
- BUILD, medium and FLAG (new on-disk shape). Write a folder-root ownership marker, for example `users/_folder_owner.json` carrying the owner account's published email and signing public-key fingerprint (the same fingerprint Phase B already compares). Written when an account first claims or initializes a folder, read on every connect. Touches `user-discovery.ts` (or a new `folder-owner.ts`), `file-system-context.tsx` (write on claim, read on connect), and the gitignore list. Note. A signing public key, not email, is the more durable owner key (email can change, the keypair is the identity), so prefer fingerprint as the primary owner key and email as the human-readable label.

### Takeover warning UX (the heart of the ask)
- DOES NOT EXIST.
- BUILD, medium to large. On connect or auto-claim, compare the signed-in account against the folder-owner record. On mismatch, show a warning before binding, with a clear cancel and a deliberate "take over this folder" path. Must honor the no-soft-locks rule (`[[feedback_no_soft_locks]]`), every state needs a visible escape. Touches a new modal under `frontend/src/components/account/`, the auto-claim gate (`RequireAccountGate.tsx`, `require-account.ts`), and the connect path (`file-system-context.tsx`).

### Shared-file removal on takeover (the data-handling half of the warning)
- AUDIT. There are two physically different shared-file paths in a folder, and only ONE is recipient-sealed, so only one is the removal target.
  - Cross-boundary (sealed) shares, the REMOVAL TARGET. A bundle is sealed to the recipient's X25519 key via `sealToRecipient` / `openSealed` (`frontend/src/lib/sharing/encryption.ts`), fetched through `receiveRawShare` (`frontend/src/lib/sharing/relay/client.ts`), then imported as records under `users/<currentUser>/{notes,projects,methods,experiments,tasks,sequences}/<id>.json`, each STAMPED with `received_from`, `received_from_fingerprint`, `received_at` (`note-transfer.ts:376`, `sequence-transfer.ts:246`, `import/apply.ts:56`; typed in `types.ts`). Sealed to the prior identity, so the new account cannot decrypt or view them.
  - Intra-lab references, NOT removed. `users/<u>/_shared_with_me.json` (`SharedManifest`, `local-api.ts:8111` / `:8122`) only points at records living in OTHER lab members' directories in the same folder. Not keypair-sealed, they belong to other members, not the prior owning account. Out of scope for removal.
- BUILD, medium and FLAG (touches on-disk records + the manifest). On a confirmed takeover:
  - DETECT + COUNT. The "files you do not have permission to view" set is exactly the records carrying a `received_from_fingerprint` whose value does not match the new account's fingerprint. Count them for the warning (X).
  - WARN with Grant's copy, shown only when X > 0. "There are X shared files that you do not have permission to view. Taking over this folder will mean the local copies of those shared documents will be removed from this folder."
  - REMOVE SAFELY. On confirm, delete those flagged local record copies (and prune any dangling `_shared_with_me` entries that referenced them). The EXCLUSION GUARD is the absence of `received_from_fingerprint`, which strictly preserves the new account's own authored content. The user's own data is never in the removal set.
  - Touches a new helper (e.g. `frontend/src/lib/sharing/foreign-share-sweep.ts`), the takeover modal, and the connect/claim path. Re-key target on rebind is `users/<username>/_sharing_identity.json` (`identity/sidecar.ts`).

### Migration of existing folders
- PARTIAL. The 2026-06-15 redesign already chose clean reset for the under-ten beta (its locked decision 3) and the first-account registry inherit exists (`indexeddb-store.ts:1115`).
- BUILD, small. On first connect under the new model, stamp the current signed-in account as the folder owner if no owner record exists (adopt, do not warn, for an unowned legacy folder). Only a folder that already has an owner record different from the signed-in account triggers the warning. Touches the folder-owner write path.

## 5. Open decisions for Grant

1. Exclusive ownership or shared. Does one account OWN a folder exclusively, or can a folder legitimately belong to several accounts (a genuinely shared lab folder with multiple `users/`)? If shared is allowed, the owner record is a SET of accounts and "takeover" means "you are not on the member list", not "you are not the single owner". Which is it?

2. What the takeover warning ALLOWS. On a foreign-account match, do we (a) warn then allow rebind, (b) warn and allow only a read-or-share-only open without rebinding, or (c) hard-block until the original owner removes the record? Grant's framing says "warn before letting them", which reads as (a) plus a real cancel.

3. Owner key. Is the owner identified by the signing public-key fingerprint (durable, survives email change, matches Phase B), by the published email (human-readable, but mutable), or both with fingerprint authoritative?

4. Legacy multi-user folders. A real shared folder today has several `users/` dirs and no owner record. On first connect under the new model, do we adopt the connecting account as sole owner (risk, strands the co-members' claim), record ALL published `users/` as co-owners, or prompt the connecting account to declare ownership? This interacts with decision 1.

5. Does the per-folder `users/` directory stay or collapse. Long term, does each folder keep a `users/<username>/` per account (today's shape, supports genuine co-located multi-user), or collapse to a single account-owned data root with sharing handled across folders (the cleaner account-centric end state)? The 2026-06-15 redesign leans toward the latter for solo, but multi-user shared folders still need the former. Confirm the intended end state.

6. How the unreadable shared files are removed. Grant's rule is to remove the local copies the new account cannot read. Do we (a) hard-delete them, (b) move them to the folder trash so a wrong takeover is recoverable for a window, or (c) zip-and-set-aside a backup the way the image cleanup script does? The trash route is the safest default (a mistaken takeover is undoable), at the cost of leaving the unreadable ciphertext on disk until the trash is emptied. Recommend (b) unless you want them gone immediately.

## 6. Risks and non-goals

Risks.
- Data-loss on rebind. Rebinding identity must NEVER strand a folder's data. Notebook data is plaintext on disk today (`2026-06-15-account-folder-identity-redesign.md:25`), so a takeover that rebinds identity loses old signatures and the ability to decrypt data shared TO the old key, but not the research. This stays true ONLY while `DEVICE_KEY_V2` (at-rest encryption) is OFF. The moment at-rest encryption ships, a takeover that rebinds the identity could orphan the data, so the takeover flow must be re-reviewed before that flag is ever flipped.
- Owner-record spoofing. The owner record is plaintext JSON on disk and can be edited by anyone with the folder. It is a friction-and-warning mechanism, not a cryptographic access control. Treat it as a guardrail against accidental silent takeover, not as authorization. Real authorization stays in the keypair and the lab roster.
- Flag interactions. The account-centric switch semantics live under `NEXT_PUBLIC_MULTI_FOLDER` (dark). The owner record and warning should ride the same flag so flag-off stays byte-identical, matching the redesign's discipline.

Non-goals.
- This is a design doc, not a build. No app code changed.
- Not redesigning recovery or escrow, that is Phase C of the 2026-06-15 redesign and its `c3-server-escrow` design doc.
- Not flipping any flag. Turning on `MULTI_FOLDER` or `LAB_AS_FOLDER` in prod is a separate decision.
