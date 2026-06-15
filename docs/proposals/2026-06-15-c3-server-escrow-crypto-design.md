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
4. **Primary recommendation: two-secret custody (the escrow wrapping key must NOT be co-located with the database) — and it's free at our scale.** If a `DATABASE_URL` leak (or a Neon compromise / lawful DB production) is sufficient to recover plaintext keys, we have built a honeypot. The escrow ciphertext and the key that opens it must require **two independent compromises**. We already have two independent trust domains (Vercel + Cloudflare) to get this at **$0** — see §5.1; a managed KMS (~$1/mo) is a nicer-but-optional upgrade, not a budget item.

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

1. **SEK custody (most important).** Pick one. **Cost note up front: at this scale none of these is an expensive service.** KMS-style pricing is (number of keys) × (operations); we need exactly ONE SEK and the operations are rare (enrollment once per user, reissue only on a lockout), so every option is in the noise floor. The real cost is *architectural discipline* (where the secret lives), not dollars.

   | Option | Dollar cost at our scale (<10 beta users) | What it really costs |
   |---|---|---|
   | **(A) Managed KMS/HSM** | AWS KMS ~**$1/mo** flat (1 key) + ~$0 ops; GCP KMS ~**$0.06/mo** + ~$0 ops | A new vendor dependency + a per-op call. HSM-grade non-extractability. |
   | **(B) Asymmetric SEK split** | **$0** | A second *isolated* place to hold the private SEK. No per-op fee — just keypair material. Cost is architecture. |
   | **(C) Plain env secret, separate store** | $0 | Weakest; only OK as a knowingly-temporary beta posture. |

   - **(A) KMS/HSM:** SEK never leaves the HSM; the app calls "unwrap this DEK." DB dump alone is useless. Strongest, ~$1/mo, minimal code. Note: Cloudflare has no general-purpose envelope-KMS product (Workers Secrets / KV / Keyless SSL are not it), so a managed-KMS path means AWS or GCP KMS.
   - **(B) Asymmetric SEK split — RECOMMENDED for beta (free + already-have-the-pieces).** We already run **Vercel** (app + `DATABASE_URL`) and **Cloudflare** (KV for rate limiting), which gives us two *independent trust domains at zero marginal cost*. Web tier (Vercel) holds the DB creds and only the SEK **public** key, so it can WRITE escrow rows but cannot decrypt them; a tiny **Cloudflare Worker** holds the SEK **private** key as a Worker Secret and is the only thing that unwraps a DEK on reissue. A Vercel env leak or a full Neon dump/subpoena then yields only ciphertext — an attacker would have to *also* breach the Cloudflare Worker secret. Cloudflare's free Workers tier covers far more than <10 users. **$0, no new vendor, genuine two-secret custody.**
   - **(C) Plain env secret, separate store:** SEK is an env var, but the escrow blobs live in a *different* datastore than Neon, so one credential leak isn't enough. Weakest of the three; only acceptable as a temporary beta posture with eyes open.
   - ❌ **Not acceptable:** SEK as an env var on the same deployment that holds `DATABASE_URL`, with escrow in the same Neon DB. That is a one-leak-loses-everything honeypot.

   **Where the SEK service runs (LOCKED 2026-06-15): Cloudflare, for isolation AND cost.** In split (B) the SEK-holding reissue service belongs on **Cloudflare**, not Vercel — for two reasons that point the same way:
   - **Trust-domain isolation (the deciding reason):** the Neon DB creds (`DATABASE_URL`) live on Vercel with the main app. Putting the SEK service on Vercel too would re-collapse escrow ciphertext + the key that opens it into one blast radius, defeating the whole split. The SEK must live in a *different* domain → Cloudflare.
   - **Cost at scale (the bonus):** escrow ops do not scale with user count (enrollment is once-per-user; reissue only on a lockout), so even at 10k+ users this service stays in the cheapest tier. Cloudflare Workers is also structurally cheaper for short-CPU request workloads (Paid ~$5/mo, 10M req + 30M CPU-ms included, CPU-time billing so no charge for I/O wait) vs Vercel Functions (~$20/mo per seat, Active-CPU + invocation billing). At 10k+ users the reissue Worker is well inside Cloudflare's included tier.

   So: **main app stays on Vercel; the SEK-holding reissue Worker runs on Cloudflare.** This is the placement to build to — do not co-locate the SEK on Vercel to consolidate.

   **Pricing (no new fixed cost):** Cloudflare Workers is gated by **request volume, not user count**. The **Free plan covers 100k requests/day**; the SEK service's volume is trivially low (enrollment once per user, reissue only on a lockout), so it stays inside the free tier effectively indefinitely even at 10k+ users. A bare "unwrap a DEK" Worker + a Worker Secret needs no paid-only feature (no Durable Objects, no extended CPU). The **$5/mo Workers Paid is therefore NOT a required new line item** for C3 — we'd only pay it if overall Cloudflare usage crosses the free limits or we later want a paid feature, in which case the $5 flat also covers this service. The audit log can ride a free-tier store (KV writes are per-reissue = rare, or a small D1 table).

   **Upgrade path:** start free with (B) and move to (A) later without changing the envelope-encryption shape — both wrap the same per-user DEKs, so swapping the SEK custody backend re-wraps only the small DEKs, not the blobs. A managed KMS (AWS/GCP) slots in *behind* the same Cloudflare reissue Worker, so picking (B) now does not lock us out of HSM-grade custody later.

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

## 9. Infra cost posture (broader, recorded so it isn't re-litigated)

Context for a "should we move things to Cloudflare to save money" question (Grant, 2026-06-15). Conclusion: **the only savings worth chasing later is app hosting; everything else is already optimal or a no-op.**

- **Cloud database stays tiny by design → don't move Neon.** The product is "cloud accounts, *local* data": research lives on the user's disk; the cloud DB holds only directory/identity/lab/escrow *metadata* (kilobytes per user, a few MB even at 10k users). That is effectively free on Neon *or* Cloudflare D1, so there is no bill to cut, while a move means a Postgres→SQLite rewrite (`@neondatabase/serverless`, `ON CONFLICT`, `timestamptz`, peppered HMAC lookups). Effort for ~$0 savings. If the *app* ever moves to Cloudflare, keep Neon and front it with **Hyperdrive** (pooling) — no DB migration.
- **Bulk-storage savings (R2) already captured.** The cost that scales is archives + the assets library; those are already on **Cloudflare R2**, whose zero-egress model is the single biggest available win vs S3. Nothing to do.
- **App hosting (Vercel → Cloudflare) is the only real lever, and it is a later, deliberate call.** Vercel costs more per-unit at high volume, but it is a Next.js app (running Next on Cloudflare via `@opennextjs/cloudflare` carries an ISR/middleware/image compatibility tax), and a local-first app has lighter server load than typical SaaS, so the Vercel bill grows slowly. **Monitor the bill; revisit only if it actually hurts.** Not a speculative migration.
- **Do NOT consolidate everything onto one provider — it would break the C3 trust-domain split.** The SEK lives on Cloudflare *because* the DB creds live on Vercel. If the whole app ever moved to Cloudflare, the SEK would need to move to a *third* domain (managed KMS) to keep two-secret custody. "Everything on one provider" is the one move that is actively harmful here.

---

## 8. One-paragraph summary for the reviewer

The strict, zero-knowledge recovery tier already exists (`my-backup` serves a recovery-code-wrapped blob over OAuth; we can't open it). The only new thing C3 builds is the **recoverable default tier**, which inescapably means **we hold a server-decryptable copy** of default-tier users' keys — the accepted trade for "sign in with Google and your key comes back." The single most important decision is **where the server escrow key lives**: it must be in a different trust domain than the database so that no single leak or subpoena of the DB yields plaintext keys. This is **free at our scale** — recommend the asymmetric-SEK split using the Vercel + Cloudflare trust domains we already have (web tier holds only the public SEK; a tiny Cloudflare Worker holds the private SEK and is the only thing that can reissue), with managed KMS (~$1/mo) as an optional later upgrade that doesn't change the envelope shape. Secondary mitigations — step-up auth, hard rate limits, mandatory notify-on-reissue, and an optional cancel-delay — blunt the new "OAuth account-takeover = key-takeover" risk. I recommend shipping beta with **default = strict** (zero new risk, already built) and flipping the default to recoverable only after the SEK custody is provisioned and this design is approved.
