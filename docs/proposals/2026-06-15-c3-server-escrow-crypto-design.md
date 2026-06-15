# C3 — Hybrid Server Escrow + OAuth-Gated Key Reissue: Crypto Design & Threat Model

**Status:** Design for review — NO CODE. This is the security sign-off gate for Phase C3 of the account/folder/identity redesign.
**Date:** 2026-06-15
**Author:** Popup Unifier / Account-Folder-Identity lane (de-facto identity-lane owner this cohort).
**Reviewer:** Grant (there is no separate security team; for <10 beta users Grant is the reviewer of record).
**Parent:** `docs/proposals/2026-06-15-account-folder-identity-redesign.md` §4.4 / §6c. Recovery decision LOCKED 2026-06-15 (decision #2: hybrid — recoverable-via-OAuth DEFAULT + opt-in strict E2E).
**Memory:** `[[project_account_folder_identity_redesign]]`, `[[project_cloud_accounts_local_data]]`.

> Read this before writing any C3 code. The whole point of the gate is that escrow done wrong is catastrophic and irreversible for the trust model. Nothing here is built; the build plan (§7) is what your sign-off unlocks.

---

## 0. TL;DR

1. **The strict tier is already built.** Today `GET /api/directory/my-backup` is OAuth-gated and serves an Argon2id-wrapped `BackupBlob`; the **recovery code is never sent to the server** and is required *client-side* to unwrap. That is, byte for byte, the "Advanced Protection / we-can't-recover-it" tier. C4 (the tier toggle) mostly just *labels and defaults* this; no new crypto.
2. **The default tier is the only genuinely new surface, and it has an unavoidable property: we must hold a server-decryptable copy of the key.** "Sign in with Google and your key comes back, nothing lost" is mathematically incompatible with "we cannot decrypt your key." OAuth yields a low-entropy, public identifier (email / `sub`), not a high-entropy secret, so the unwrap capability has to come from a **server-held secret**. This is the accepted trade in the locked decision, but it is THE thing to review.
3. **Deploying the routes is itself the risk, not flipping the flag.** Unlike C1/C2 (client-only, flag-off = byte-identical), C3 creates a persistent escrow blob + a reissue endpoint. Once those exist in production, the security of every default-tier user's key reduces to **the custody of one server wrapping key**. A flag-off client does not reduce that surface. So the review must happen before *building/deploying*, not before *flipping*.
4. **Primary recommendation: two-secret custody (the escrow wrapping key must NOT be co-located with the database).** If a `DATABASE_URL` leak (or a Neon compromise / lawful DB production) is sufficient to recover plaintext keys, we have built a honeypot. The escrow ciphertext and the key that opens it must require **two independent compromises**.

---

## 1. What exists today (grounded in code)

| Primitive | Where | Fact |
|---|---|---|
| Identity keypair | `lib/sharing/identity/keys.ts` | x25519 (encryption) + ed25519 (signing), both hex. |
| `BackupBlob` | `lib/sharing/identity/backup.ts:71` | `{ v:1, alg:"argon2id", t,m,p, salt, nonce, ciphertext, dkLen? }`. KDF Argon2id (`PROD_KDF_PARAMS = {t:3, m:65536, p:1, dkLen:32}`, `backup.ts:50`), AEAD XChaCha20-Poly1305 (24-byte nonce). |
| Wrap/unwrap | `backup.ts:120-168` | `deriveWrappingKey(passphrase, salt, deviceSalt|null, params)` (XORs deviceSalt into the KDF salt when non-null), `wrapKeys`, `unwrapKeys`, `makeBackupBlob`. Device-independent recovery uses `deviceSalt=null`. |
| Escrow store | `lib/sharing/directory/db.ts:57` | Neon Postgres table `directory_identities(email_hash PK, x25519_pub, ed25519_pub, fingerprint, key_backup_blob text, ...)`. The blob column holds a JSON `KeyBackupEnvelope = { v:2, mnemonic: BackupBlob }` (`key-backup-envelope.ts:16`). |
| Escrow read | `app/api/directory/my-backup/route.ts:30` | **OAuth-gated** (`session = await auth(); session.user.email` else 401), IP rate-limited, then `getBackupBlob(hashEmail(canonicalizeEmail(email), pepper))`. Returns the wrapped blob. **No recovery code is involved server-side.** |
| Client restore | `lib/sharing/identity/cloud-restore.ts:40` | `recoverDeviceKeyFromCloud(recoveryInput)`: GET my-backup → parse envelope → `unlockKeysFromRecoveryBlob(envelope.mnemonic, recoveryInput)` **client-side** → persist at rest. Wrong code → `{ok:false, reason:"wrong-words"}`. |
| Server OAuth verify | `lib/sharing/auth.ts:152` | NextAuth (JWT strategy). `auth()` yields `session.user.email`, `session.provider`, `session.orcidId`. Email canonicalized (`directory/email.ts:29`) + HMAC-SHA256 peppered (`hashEmail`, pepper `DIRECTORY_HMAC_PEPPER`). |
| Binding signature | `lib/sharing/directory/signature.ts:57` | Ed25519 over `researchos.directory.binding.v2` payload (email + both pubkeys + issuedAt); server verifies with the client-supplied ed25519 pubkey. One email_hash → one keypair row. |

**Crucial consequence:** today, an attacker (or a subpoena) who obtains a full dump of `directory_identities` gets only **Argon2id-wrapped ciphertext**. Without each user's recovery code they cannot open it. The database alone is not enough. **C3's default tier deliberately weakens this** for the recoverable tier — that weakening is the entire review.

---

## 2. The cryptographic crux (why this needs design, not just code)

We want: *OAuth re-auth alone restores the key, no recovery code.*
We have: OAuth proves control of an **email/sub** — a low-entropy, often-public identifier. You cannot derive a 256-bit wrapping key from it.

Therefore the unwrap capability must live in a **server-held secret**. There is no escape from this; any scheme where "Google alone recovers it" implies "an entity holding the server secret can recover it." The only questions are **who/what holds that secret** and **what it takes to compromise it**.

This is consistent with the locked decision: default tier = recoverable = we hold a recoverable copy; strict tier = today's recovery-code-only blob = we cannot. The strict tier is the escape hatch for anyone who refuses the trade.

---

## 3. Proposed scheme (default tier)

### 3.1 Shape
Add a **second** escrowed copy of the identity private bundle, wrapped under a **server escrow key (SEK)**, alongside the existing recovery-code blob. The recovery-code blob (strict tier) is untouched and remains the only copy for strict-tier users.

```
directory_escrow (NEW table, separate from directory_identities)
  email_hash      text PK           -- same HMAC-peppered hash used elsewhere
  escrow_blob     text              -- XChaCha20-Poly1305(privateBundle) under a per-user data key
  wrapped_dek     text              -- the per-user data key, wrapped under the SEK (envelope encryption)
  sek_id          text              -- which SEK generation wrapped wrapped_dek (for rotation)
  tier            text              -- "recoverable" (only recoverable-tier rows exist here)
  created_at, updated_at, last_reissue_at timestamptz
```

Envelope encryption (standard KMS pattern): a fresh random **per-user data key (DEK)** encrypts the private bundle; the DEK is wrapped under the **SEK**. To recover, the server unwraps the DEK with the SEK, then the client (or server) decrypts the bundle with the DEK. This makes SEK rotation cheap (re-wrap only the small DEKs, not every blob) and isolates the long-lived secret.

### 3.2 The reissue route (NEW) — `POST /api/directory/escrow-reissue`
1. `session = await auth()`; require `session.user.email` (and matching `provider` policy, see §5). 401 otherwise.
2. Strict IP **and** per-account rate limit (reissue is rare; throttle hard — e.g. N/day/account, exponential backoff). Every call is **audit-logged** (email_hash, provider, ip, ts, outcome) to an append-only table; the user is **notified** (existing notification rail / email) on every reissue, successful or not, so a silent attacker reissue is visible.
3. Look up `directory_escrow` by `hashEmail(canonicalizeEmail(session.user.email), pepper)`.
4. Unwrap the DEK with the SEK (the only place the SEK is used). **Decision point (§5):** either (a) return the still-DEK-wrapped bundle + the unwrapped DEK to the authenticated client so the *client* decrypts (server never re-derives the plaintext bundle in memory beyond the DEK unwrap), or (b) server decrypts and returns the bundle. (a) is marginally better (smaller plaintext window) but the SEK still gates everything, so the difference is modest.
5. Client persists the recovered keys at rest, writes a reference sidecar (this is also exactly **C5 cross-device restore** — C3 and C5 share this route), and re-publishes the directory binding if needed.

### 3.3 Enrollment (writing the escrow copy)
On account setup / first publish, IF the user is on the default (recoverable) tier: generate a DEK, wrap the private bundle under it, wrap the DEK under the current SEK, write the `directory_escrow` row. This requires the plaintext private bundle **on the client at enrollment time only** (it already is — that is where the keypair is minted/held). The server never sees the plaintext bundle at enrollment if we wrap client-side and send only ciphertext + (DEK wrapped under an SEK *public* half — see §5 "asymmetric SEK").

---

## 4. Threat model

| Adversary / event | Strict tier (today's blob) | Default tier (proposed escrow) |
|---|---|---|
| DB dump / Neon compromise / SQL injection on the directory | Gets Argon2id ciphertext only. Safe without each recovery code. | Gets `escrow_blob` + `wrapped_dek`. **Safe ONLY IF the SEK is not also compromised** (two-secret custody, §5). If the SEK lives in the same env/secret store → full key compromise. |
| Leak of one env secret (`DATABASE_URL`) | No key exposure. | No key exposure **iff** SEK is in a *different* trust domain (KMS/HSM). If SEK is a sibling env var → catastrophic. |
| Malicious/compelled insider with prod access | Cannot open blobs (no codes). | Can reissue for any account (that is the feature). Mitigation: audit log + mandatory user notification + (optional) reissue requires a co-signer / time delay. |
| Legal compulsion (subpoena) | We genuinely cannot comply (no plaintext). | **We can be compelled to reissue/produce** a recoverable-tier key. This is inherent and must be disclosed to users choosing this tier. |
| Stolen OAuth session / account takeover at the provider | Attacker gets the wrapped blob but still needs the recovery code. | **Attacker recovers the full key.** OAuth becomes the single factor. Mitigations: notify-on-reissue, rate limit, optional step-up (recent-auth requirement, `max_age`), optional second factor before reissue. |
| SEK loss (we lose our own secret) | N/A | All recoverable-tier users lose the escrow path (they fall back to recovery code or reset-keep-data C1). So the SEK needs its own durable backup — but that backup is itself sensitive. |

**Headline risks to accept or mitigate:** (1) OAuth-as-single-factor → account-takeover = key-takeover for default-tier users; (2) we become a compellable/honeypot custodian; (3) SEK custody is now the crown jewel.

---

## 5. Decisions for Grant (the review)

1. **SEK custody (most important).** Pick one:
   - **(A) KMS/HSM** (e.g. Cloudflare Keyless / a managed KMS / Vercel + an external KMS): SEK never leaves the HSM; the app calls "unwrap this DEK." DB dump alone is useless. **Recommended.** Cost/ops: a KMS dependency + per-op latency.
   - **(B) Asymmetric SEK split:** enrollment wraps the DEK under an SEK *public* key (so the web tier writing escrow rows never holds the private SEK); reissue runs in a *separate, minimal* service that holds the SEK private key. DB + web-tier compromise still can't decrypt. Good middle ground without a managed KMS.
   - **(C) Plain env secret, separate store:** SEK is an env var, but the escrow blobs live in a *different* datastore than Neon, so one credential leak isn't enough. Weakest of the three; only acceptable as a temporary beta posture with eyes open.
   - ❌ **Not acceptable:** SEK as an env var on the same deployment that holds `DATABASE_URL`, with escrow in the same Neon DB. That is a one-leak-loses-everything honeypot.

2. **Step-up auth before reissue?** Require a *fresh* OAuth (`max_age`/recent-auth) and/or a provider second factor before honoring a reissue, to blunt stolen-session takeover. Recommended yes.

3. **Notify + delay?** Mandatory user notification on every reissue (recommended yes). Optional 24–72h "tripwire" delay with a cancel link (Apple-style) so a victim can abort an attacker's reissue. Decision: delay on/off for beta.

4. **Default tier truly the default?** The locked decision says yes (recoverable = default, strict = opt-in). Confirm we ship beta with default=recoverable, or beta-conservative with default=strict until escrow is battle-tested. (I lean: beta default = **strict** since strict is already built and zero-new-risk, then flip default to recoverable once §5.1 custody is in place and reviewed. This sequences risk.)

5. **Provider binding.** Reissue should require the *same* provider/email that enrolled (we already store `provider` in the session and `email_hash`). Confirm: lock reissue to the enrolled email_hash; ORCID-only logins (no email) cannot use the email-keyed escrow — they stay strict-tier.

---

## 6. What is and isn't blocked

- **NOT blocked (safe now):** this design doc; the C4 tier-toggle UI/labeling (it surfaces a choice between two already-coherent postures, strict = existing); continuing C5 cross-device restore *for the strict path only* (recovery-code unwrap of the existing my-backup blob — no new server secret).
- **Blocked on your sign-off (this doc):** anything that creates the `directory_escrow` table, the SEK, or the reissue route — i.e. the default-tier escrow itself.
- **Hard rule:** none of the C3 backend lands on shared `main` (per the single-shared-checkout reframe, a main commit publishes to origin). It is built on an isolated branch/worktree, behind the flag, and merged only after sign-off + a deploy plan for the SEK.

## 7. Build plan (unlocked by sign-off)

1. Decide §5.1 custody → provision the SEK (KMS/HSM/asymmetric split). This is an infra step, not app code.
2. `directory_escrow` schema + `directory_escrow_audit` append-only log.
3. Enrollment: client-side DEK wrap + write escrow row (recoverable tier only).
4. `POST /api/directory/escrow-reissue`: OAuth (+ step-up) gate, rate limit, audit, notify, SEK-unwrap DEK, return per §3.2.
5. Wire `cloud-restore.ts` to try the reissue path (default tier) and fall back to recovery-code unwrap (strict). This closes the Phase B `// Phase C:` cross-device stop-guard (= C5).
6. C4 tier toggle: choose/disclose strict vs recoverable; switching recoverable→strict deletes the escrow row + SEK-wrapped DEK.
7. Security pass on the built thing (not just the design): rate-limit/audit/notify verified, SEK custody verified, takeover + compulsion paths walked, then a staged flag-on.

---

## 8. One-paragraph summary for the reviewer

The strict, zero-knowledge recovery tier already exists (`my-backup` serves a recovery-code-wrapped blob over OAuth; we can't open it). The only new thing C3 builds is the **recoverable default tier**, which inescapably means **we hold a server-decryptable copy** of default-tier users' keys — the accepted trade for "sign in with Google and your key comes back." The single most important decision is **where the server escrow key lives**: it must be in a different trust domain than the database so that no single leak or subpoena of the DB yields plaintext keys (recommend KMS/HSM, or an asymmetric-SEK split service). Secondary mitigations — step-up auth, hard rate limits, mandatory notify-on-reissue, and an optional cancel-delay — blunt the new "OAuth account-takeover = key-takeover" risk. I recommend shipping beta with **default = strict** (zero new risk, already built) and flipping the default to recoverable only after the SEK custody is provisioned and this design is approved.
