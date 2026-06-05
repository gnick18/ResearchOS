# Cross-Boundary Sharing Design Proposal

Status: draft for Grant's sign-off (2026-06-03). No code until an option is approved.
Author: sharing initiative (master)

This proposal designs a way to send research artifacts (a note, a method, a protocol, a project, results, with every attached image and PDF preserved) between ResearchOS users who do NOT share a cloud folder. It is grounded in two deep-research passes whose sources are cited inline and collected at the end.

---

## 1. The problem, stated honestly

ResearchOS is local-first. A "lab" only exists because its members share one cloud folder (OneDrive, Dropbox, iCloud). Inside that folder, a share is a live pointer to another user's file, so edits show up for everyone. Across folders there is no shared storage to point at, which forces the central design fact of this whole effort.

**A cross-boundary send is necessarily a snapshot copy, not a live link.** Everything else follows from that. External shares cannot auto-update, so we need explicit re-send and versioning. They land as the recipient's own copy, so the recipient decides where to file them. They come from outside the trust boundary of a shared folder, so they need provenance and a visible internal-versus-external distinction.

---

## 2. First principles (locked with Grant)

1. **The web backend is optional sugar. The local app is the product.** Clone-and-run-local must always work fully. The only thing a user loses without the hosted service is cross-account sharing. This mirrors antiSMASH, BLAST+, and Galaxy, all of which ship a web service AND an always-runnable local standalone, so scientists already expect the cloud layer to be a convenience, not a dependency (antiSMASH docs, Galaxy admin docs).

2. **Transport is layered.** A floor that always works even offline or self-hosted (export an encrypted portable bundle, hand it off manually). A convenience layer that only the hosted service provides (directory lookup plus one-click relay delivery to an in-app inbox). Self-hosting without a backend gracefully drops to the floor.

3. **We never store research content, and never permanently.** The directory stores account info only (email, handle, public keys). The relay holds end-to-end-encrypted bundles it cannot read, auto-expiring. This is Grant's line, a transient encrypted relay is fine, permanent storage of everyone's data is not.

4. **Tier 2 in v1.** A global email-linked identity directory plus the encrypted ephemeral relay, both on Vercel. Email-linked identity.

5. **House constraints.** Chrome and Edge only (Brave strips the File System Access API). Vercel-first, a different provider only where we truly must. AGPLv3, grant-funded, free. Cheapest reasonable always wins.

---

## 3. Architecture at a glance

Three pieces, one relay path.

**The identity directory** (Vercel + Neon Postgres). Maps a verified email to a handle and two public keys (X25519 for encryption, Ed25519 for signing). Stores nothing else about research. CORS-open for public-key lookup, because public keys are public by definition (the Keybase model).

**The relay mailbox** (Cloudflare R2 + a small Neon index). A blind store-and-forward inbox. It holds opaque encrypted bundles addressed to a recipient and delivers them when that recipient next opens ResearchOS, then deletes them. Structurally identical to Matrix's send-to-device relay, the server moves ciphertext it cannot read.

**The client** (the existing app). Builds the portable bundle, encrypts it, uploads it, polls its own inbox on open, decrypts, and files accepted bundles into the user's folder.

Registered to registered only. Look the recipient up by email, fetch their X25519 public key, encrypt the bundle to that key, drop it in the relay. They see it in their inbox the next time they open ResearchOS. The server never holds a key. Both people having an account is the only supported relay path.

Reaching a non-user. There is no in-app email delivery. To send to someone who will not sign up, export the encrypted bundle and email or hand it off yourself (the floor described below). That keeps the system simple and removes the first-contact bootstrapping problem entirely.

---

## 4. The portable bundle format

**Recommendation: RO-Crate 1.1 inside a BagIt bag, zipped, then encrypted.**

The two standards have complementary jobs, and the RO-Crate spec itself blesses combining them. RO-Crate carries rich, machine-readable, FAIR-aligned metadata and the internal cross-references. BagIt provides tamper-evident SHA-512 integrity and a stable identifier for dedup.

Concrete layout inside `bundle-{uuid}.zip`.

```
{uuid}/
  bagit.txt
  bag-info.txt              (External-Identifier: urn:uuid:{uuid})
  manifest-sha512.txt
  tagmanifest-sha512.txt
  data/
    ro-crate-metadata.json  (JSON-LD graph: the artifact + every file)
    entities/               (the note/method/project JSON records)
    files/                  (images, PDFs, attachments)
```

How it solves the hard parts.

- **Cross-references.** RO-Crate's flat JSON-LD graph links entities by `@id`. A note entity links to its images with `hasPart`, an image links back with `isPartOf`. App-specific records (a ResearchOS Task, Method, Note) get a namespaced `@type` via the `@context` extension mechanism.
- **Integrity.** Every payload file appears in the BagIt SHA-512 manifest. A receiver recomputes and verifies before importing. SubtleCrypto SHA-512 is hardware-accelerated on Chrome.
- **Versioning and dedup.** The bag's `External-Identifier` is a `urn:uuid` minted when the note or method is first created (stored in the local data model, never regenerated per export). That is the dedup key. The RO-Crate Root Data Entity carries a `version` integer and schema.org `isBasedOn` pointing at the prior bundle. On import, the receiver keys on the UUID, compares versions, and offers to replace if the incoming version is higher.
- **NIH/FAIR angle.** Because the metadata is real RO-Crate, bundles are legitimately "FAIR-ready exports," which dovetails with the data-management-compliance positioning the product already markets.

Browser-buildable with `fflate` (zip, MIT, no native deps). The relay never parses any of this, it stores an opaque encrypted blob.

Note on a real trap the research surfaced. `isVersionOf` does not exist on schema.org Dataset, use `isBasedOn`. And BagIt requires every payload file to be in the manifest, so bundle assembly must be single-pass (enumerate files, then write manifests, then zip).

---

## 5. Encryption and identity keys

**Recommendation: the `age` file format via `typage`** (the official TypeScript implementation from age's author, runs in current browsers). It is an audited, RFC-grade upgrade over hand-rolled NaCl box, it natively addresses multiple recipients in one ciphertext (each gets an independent X25519 stanza), and the relay just stores the opaque `age` output.

Each user holds two long-lived keys, an X25519 encryption key and an Ed25519 signing key, generated in the browser at identity setup. The signature matters because libsodium sealed boxes (and age recipient stanzas) give no sender authentication on their own, so we sign for provenance.

### Key backup and recovery (the part that orphans mail if we get it wrong)

Vercel has no trusted-execution hardware, so the Signal SVR / WhatsApp-HSM "rate-limited server rescue" is off the table. We use a passphrase-wrapped scheme with a 1Password-style device-salt twist.

- **Derivation.** Argon2id via libsodium.js, `opslimit=3`, `memlimit=64 MiB`. Run it in a Web Worker so the UI never freezes. There is a known WASM heap-growth crash at 64 MiB on older builds, so canary-test at init and fall back to 32 MiB with a logged warning rather than silently weakening.
- **Wrapping.** `crypto_aead_xchacha20poly1305_ietf` over the concatenated private keys, with the email as associated data for domain separation.
- **Recovery Words.** A 12-word BIP39 mnemonic (128 bits, `@scure/bip39`), shown once, fed verbatim as the passphrase into a second independently-salted blob so it unlocks on its own. The checksum word catches transcription errors. We call it "Recovery Words," never "seed phrase," to avoid the crypto-wallet confusion for lab users.
- **Device salt (2SKD analog).** 16 random bytes in IndexedDB, XOR-mixed into the KDF salt, so a directory breach plus a guessed passphrase still cannot decrypt without the device bytes. The mnemonic blob carries no device-salt dependency, so it is the definitive cross-device rescue path.
- **Storage.** The wrapped blob lives in the directory as an opaque field the operator cannot read, plus a downloadable "Recovery Kit" (the 1Password Emergency Kit analog).
- **Multi-device restore.** New browser, sign in, fetch the mnemonic-keyed blob, enter the 12 words, derive locally, decrypt, store on the new device.

Honest limitation to document in-app. If a user loses both their device and their Recovery Words, the identity keys are unrecoverable and senders must re-invite them. There is no server rescue without TEE hardware. The onboarding copy must say this plainly with a "I have saved my Recovery Words" checkbox.

---

## 6. The identity directory

**v1 recommendation: verified-email binding plus log-backed trust-on-first-use, defer full key-transparency to v2.**

- **Signup.** A 6-digit email OTP (15-minute expiry, 3 attempts, 3 resends per 15 minutes). On success, store the tuple `HMAC-SHA256(server-pepper, canonical-email) -> {X25519 pubkey, Ed25519 pubkey, timestamp}` in Neon.
- **Anti-enumeration.** Lookup is exact-hash only, never prefix or substring. The server pepper makes a leaked directory resistant to offline dictionary attack. Responses are uniform whether or not an email is registered, so the directory cannot be used to harvest who-has-an-account. Rate-limited per IP and per email-hash via `@upstash/ratelimit`. The FTC's 2024 guidance is explicit that even hashed emails are PII, so the privacy policy treats directory rows as personal data.
- **Log-backed TOFU (the lightweight key-transparency substitute).** After every key registration or rotation, append a signed epoch record (epoch, email-hash, key fingerprint, timestamp, server Ed25519 signature) to a public append-only log. Any client can replay the log and confirm the key it was handed matches what was globally committed at that time. This closes the "a compromised server silently swaps in a malicious key" threat without standing up a full Merkle tree. CONIKS, Google Key Transparency, WhatsApp's AKD, and Proton's deployment are the heavyweight versions, worth adopting past roughly 10,000 identities, overkill for the beta.
- **Key-change UX (Signal advisory mode).** If a sender's fingerprint differs from the one cached on last contact, show an advisory banner in the share thread with the fingerprint, do not block. Most changes are legitimate reinstalls. For research artifacts we also add an explicit accept/reject on first-contact bundles, which is stronger than a real-time messenger needs.

Self-hostable and optional, so a privacy-maximal lab can run pure file handoff with no directory at all.

---

## 7. The relay mailbox

**Recommendation: Cloudflare R2 for the blobs, behind a thin storage adapter, with Vercel Blob as the drop-in alternative.**

The relay is a blind inbox. A Vercel function issues a presigned PUT URL (via the S3-compatible R2 endpoint), the browser uploads the encrypted bundle directly to R2 (which sidesteps the 4.5 MB Vercel function body cap), and a Neon row records `{bundle_id, recipient_email_hash, r2_key, sender_email_hash, expires_at}`. No plaintext, no filenames, no content. On pickup the function issues a presigned GET.

Why R2 over Vercel Blob. R2 storage is about 35 percent cheaper and egress is free, versus Vercel Blob's 0.05 USD per GB download and a 512 MB cache cliff that bites attachment-heavy research bundles. At 1,000 users the relay layer is roughly 19 times cheaper on R2 (about 0.14 USD per month versus 2.65 USD). It is a second vendor, which cuts against Vercel-first, so we hide it behind a one-file adapter and can fall back to Vercel Blob if you would rather keep everything in one place.

Retention and abuse, the load-bearing controls.

- **30-day TTL.** This is exactly antiSMASH's published norm, which scientists who use genome-mining tools already expect, with a visible "expires in N days, save it to your ResearchOS" countdown on both sides. BLAST's 36 hours is too short for an offline recipient.
- **Lazy-delete-on-access** (check expiry on pickup, delete if stale, return 410), plus a single free daily Hobby-plan cron to sweep orphans. No need for Vercel Pro's sub-hourly cron.
- **Mandatory authenticated upload.** No anonymous drops. This is the single biggest lesson from Firefox Send, which became ransomware infrastructure precisely because it allowed unauthenticated uploads and had no abuse report path, and was pulled in 2020.
- **A visible abuse-report endpoint.** Accepts a bundle ID and a description, triggers account review and bundle deletion. This same endpoint satisfies the EU DSA Article 16 notice-and-action duty.
- **Per-inbox and per-bundle size caps and rate limits**, so nobody can flood a recipient who is not accepting, and the blast radius of any abuse is bounded.

---

## 8. Send and receive flows

**Send.** Pick an artifact, pick a recipient by email. They must have a ResearchOS account, so the app encrypts to their directory key and drops it in the relay, showing their key fingerprint for optional out-of-band confirmation. If the person is not a registered user, the app offers the floor instead, download the encrypted bundle and email or hand it off yourself. The floor is always available and is the only option when self-hosted with no backend.

**Receive and accept.** On app open the client polls its inbox. New arrivals show as pending inbound shares with sender, provenance, and a preview of what is inside (artifact type, attachment count). The recipient accepts or declines. On accept, they choose where it lands in their own folder (which project, or unfiled), and the bundle is verified (BagIt manifest), decrypted, and imported as their own copy with a new local ID. Per-user ID collisions are handled by minting fresh local IDs on import and keying dedup on the bundle UUID, not the sender's IDs.

A note on browser transport for the floor. Web Share API Level 2 can share files on desktop Chrome and Edge but requires PWA install and is fragmented, so it is an export convenience, not the primary path. `mailto` cannot attach files. The relay is the real transport, the floor is the always-available fallback.

---

## 9. Internal versus external shares (your methods-page question)

This is a real data-model and UI split, not just a label.

- **Internal share** (today's behavior). A live pointer to another user's file in the same folder, via `shared_with`. Edits propagate. Unchanged by this work.
- **External copy** (new). A snapshot imported from outside, with provenance (who sent it, when, the bundle UUID and version, the sender's verified fingerprint). It does not auto-update, the sender re-sends to push a newer version.

On the methods page and anywhere artifacts list, external copies carry a small "received from outside" marker with the sender and date, and group separately from internal shares so the provenance is never ambiguous. The mixed-state precedent is iMessage's blue-versus-green, the user always knows which mode they are in. The recommendation is one shared list with a clear per-item origin badge and a filter, rather than a wholly separate page, so received methods still sit alongside the user's own where they will actually look for them. This is a UI fork worth your eye, see section 13.

---

## 10. Existing-user migration and adoption

The north star, the existing-user upgrade converges on the same end-state as a new user from scratch. Build the account-setup component once, invoke it from onboarding and from an upgrade prompt.

- **Intent-triggered setup, never a launch gate.** The account is created on the first click of "Share outside this folder," not at app open. This is the VS Code Settings Sync model (sign-in surfaces only when a capability needs it), and the just-in-time-provisioning pattern from identity literature. Plus one dismissible announcement banner shown once after the feature ships, with a permanent "never ask."
- **Additive claim, never destructive.** The existing folder-local account (username, color) keeps working exactly as before. "Claim this profile with a global identity" generates the keypair, publishes public keys, shows the Recovery Kit, and links the global identity to the local account. Skipping it degrades nothing. The cautionary counter-example is 1Password 8, which force-migrated standalone vaults to required cloud accounts and burned trust, we must never version-gate a local feature behind account creation.
- **No receive chicken-and-egg, because relay sharing is registered-to-registered.** Publishing public keys at signup (the prekey pattern) makes an account immediately reachable, so a sender can drop a bundle before the recipient is ever online. To reach someone who has no account, you export and email the bundle yourself, there is no in-app invite path to bootstrap.
- **Identity anchors to the keypair, not the folder path**, so it survives folder moves and renames, and supports the same person across multiple labs' folders mapping to one global identity by email.
- **Graceful mixed-state.** A globe icon marks members who have a global identity, none for local-only. Trying to share with a local-only member explains "they have not set up a sharing identity, you can still send a one-time bundle via email." Never silently downgrade, always explain.
- **Flagged data-shape change.** New fields (email, public keys, global-account-id, key-backup blob, recovery state) land on `_user_metadata.json` or a new sidecar via lazy-normalize-on-read plus a Settings repair button, the codebase's established field-migration pattern. No hard cutover, so shared-folder files from un-upgraded members keep working.

---

## 11. Infrastructure and cost

Recommended stack, cheapest-reasonable and local-first-preserving.

| Layer | Choice | Why |
|---|---|---|
| Relay blobs | Cloudflare R2 (adapter; Vercel Blob fallback) | Zero egress, ~35% cheaper storage, no 512 MB cache cliff |
| Directory + mailbox index | Neon Postgres (free, then Launch) | Relational shape, scale-to-zero, ~$0.50/mo at 1k users |
| Auth | Auth.js v5 + Resend magic-link | Self-hosted, $0, preserves clone-and-run-local |
| Email (OTP, invites) | Resend | 3,000/mo free, covers past 1k users |
| TTL cleanup | Lazy-delete + daily Hobby cron | Avoids Vercel Pro's $20/mo for sub-hourly cron |

Rough cost. About 0 USD per month up to roughly 500 users. Under 1 USD per month at 1,000 users on R2. The dominant avoidable cost is Vercel Pro at 20 USD per month per seat if upgraded for cron frequency, which lazy-delete removes the need for. The relay does zero computation on payloads, which is why it is orders of magnitude cheaper than compute tools like antiSMASH or Galaxy that run on HPC.

Auth note. Clerk is a viable drop-in (free to 50,000 monthly active users, polished, zero implementation effort) but adds a vendor dependency that complicates the clone-and-run-local story unless gated behind a hosted-mode flag. Auth.js self-hosted is the local-first-safe default and removes future-pricing risk. This is a fork, see section 13.

---

## 12. Legal and compliance

Four concrete controls, none of them alarmist.

- **GDPR.** Lawful basis is Article 6(1)(b) contract performance plus consent, with a registration consent checkbox and a one-page Article 13 privacy policy. Data minimization, store only email, handle, and public keys, delete on account deletion. Do not add EU languages, currency, or EU-targeted copy, which keeps Article 3(2) targeting untriggered. Link UW-Madison's existing GDPR supplemental notice and execute Vercel's standard DPA as belt-and-suspenders.
- **CSAM and abuse (18 U.S.C. 2258A).** The statute imposes no duty to monitor and triggers only on actual knowledge of content. A zero-knowledge relay that holds only ciphertext and no keys literally cannot have actual knowledge, which is the structural protection, and PhotoDNA-style hash scanning cannot run on encrypted content anyway. We preserve this by never holding a key, never logging recoverable sender-to-recipient metadata, and always expiring bundles. The behavioral controls (authenticated upload, abuse endpoint, ToS, quotas) are the Firefox Send lesson.
- **DSA Article 16.** The abuse-report endpoint satisfies the EU notice-and-action duty. For an encrypted bundle we cannot read, the compliant response is to act on the account (suspend or delete) and state that the content itself is end-to-end encrypted.
- **AGPLv3 Section 13.** Because we run a modified hosted version, we must offer remote users the corresponding source. Satisfied by a "Source code (AGPLv3)" link in the footer pointing at the deployed commit, plus a CI gate so the public repo never lags the deployment.

---

## 13. Decisions (locked 2026-06-03)

All forks are now resolved. The funding decision (free for everyone, no per-user payments, see CROSS_BOUNDARY_SHARING_FUNDING.md) cascaded into most of them.

1. **Relay storage, Cloudflare R2.** Its free tier is the floor of the free model and its zero egress fits a relay. Behind a thin adapter so Vercel Blob stays a drop-in fallback.
2. **Auth, Auth.js plus Resend.** Self-hosted and free, preserves clone-and-run-local, no vendor lock.
3. **Registered-to-registered only (Grant, 2026-06-03).** Both parties must have an account. No in-app email delivery to non-users. To reach a non-user, export the encrypted bundle and email it yourself (the floor). This removes the password-envelope, email-invite, and park-by-email machinery and the first-contact chicken-and-egg. Email stays as the signup and lookup identity, only the email-as-delivery feature is gone.
4. **Methods UI, same list with an origin badge and filter.** Received items sit alongside the user's own with clear provenance.
5. **Bring-your-own-storage, deferred to a later phase.** The escape valve for a lab that outgrows the free pooled inbox, not a v1 feature.

Funding model, free for everyone, backend on free credits, donations via a UW Foundation gift account plus GitHub Sponsors, abuse handled by authentication plus quota plus TTL plus an abuse endpoint. No payments, no entity, no paid tier.

---

## 14. Phased build plan (after sign-off)

This work touches the methods page, notes, the sharing layer, and attachments, which sit in or next to the active de-bloat and sequence-editor collision zones, so it integrates by per-commit cherry-pick, never a stale-anchor tree-merge, and the data-shape change is pre-flagged.

- **Phase 0. Bundle engine, no network.** RO-Crate-in-BagIt build and verify, `age` encrypt and decrypt, export-and-import via file handoff (the floor). Fully testable offline, ships value on its own.
- **Phase 1. Identity.** Keypair generation, backup and Recovery Words, the directory (signup OTP, lookup, log-backed TOFU), the claim ceremony and migration prompt.
- **Phase 2. Relay.** R2 adapter, presigned upload and download, the inbox poll, accept-and-file flow, TTL and abuse controls.
- **Phase 3. Polish.** Internal-versus-external UI, key-change advisories, provenance display, the privacy policy and AGPL footer. (The old unregistered-recipient email phase is cut, reaching a non-user is the manual export-and-email floor from Phase 0.)

---

## 15. Security limitations to document

- No forward secrecy on the long-lived identity key, a future key compromise lets an attacker who recorded bundles decrypt them. The short TTL narrows the window. Inherent to encrypt-to-long-term-key, the same tradeoff Signal accepts for identity keys.
- No post-quantum protection. X25519 and Ed25519 are not quantum-resistant, and pre-publication research data has a real harvest-now-decrypt-later horizon. `typage` has an X25519 plus ML-KEM-768 hybrid recipient type to evaluate for v2 before any strong compliance claims.
- A compromised directory could serve a malicious key. Log-backed TOFU plus fingerprint confirmation plus the first-contact accept step mitigate, full key-transparency self-monitoring is the v2 hardening.

---

## 16. Sources

Browser transport and crypto. web.dev share-files, MDN navigator.share, Chrome web-share-target and file-system-access, libsodium sealed boxes and xchacha20-poly1305, Signal X3DH, OWASP Password Storage Cheat Sheet, `@scure/bip39`, age spec (C2SP) and typage, 1Password security design, Signal SVR2, WhatsApp E2EE backups.

Packaging. RO-Crate 1.1 and 1.2 specs and implementation notes, BagIt RFC 8493, schema.org Dataset, NIH and FAIR-IMPACT.

Identity. CONIKS (eprint 2014/1004), Google Key Transparency and IETF KEYTRANS drafts, WhatsApp key transparency and Cloudflare auditor, Signal safety numbers, Proton key transparency whitepaper, Parakeet and OPTIKS, FTC 2024 hashed-data guidance.

Relay and prior art. Firefox Send (Mozilla blog, Wikipedia, ITPro), magic-wormhole, wormhole.app, Matrix E2EE, p2panda group encryption, RFC 9180 HPKE, Obsidian Sync and Trail of Bits audit, Anytype any-sync, Standard Notes, Keybase and Saltpack, Proton and Tuta password-protected mail.

Infra and cost. Vercel Blob client-upload and pricing, Cloudflare R2 pricing and presigned URLs, Neon pricing, Upstash Redis and ratelimit, Auth.js Resend provider, Clerk pricing, Resend pricing, Vercel Cron pricing.

---

## 17. Searchable profile directory (addendum, 2026-06-04)

**Recommendation: a second, opt-in public surface that sits beside the private binding, keyed by public-key fingerprint, never by email, so researchers can find each other by name and institution without anyone's address ever being searchable.**

The motivation is collaboration discovery. Today the only way to reach someone is to already know their email (section 8). For the collab feature we want a user to type "people at UW-Madison" and find colleagues to send to. That is genuinely useful, but it is the exact opposite of the property section 6 was built around, so it needs to be designed as a separate thing, not bolted onto the binding.

### 17.1 The tension, stated honestly

Section 6's directory is deliberately **non-enumerable**. It stores only `HMAC-SHA256(pepper, email)`, and lookup is exact-hash only "never prefix or substring", so the directory cannot be used to harvest who has an account. A searchable profile is enumerable by definition. We do not weaken the binding to get there. Instead we add a distinct table that holds only what a user explicitly chooses to publish, and we make the searchable key the **fingerprint** (already public, derived from the Ed25519 key), never the email or the email-hash.

### 17.2 Two surfaces, one identity

- **Private binding (unchanged).** `directory_identities`, keyed by `email_hash`, holds the public keys. Still non-enumerable, still exact-hash lookup, still the thing that proves "this email owns these keys."
- **Public profile (new, opt-in).** `directory_profiles`, keyed by `fingerprint`, holds the display fields. Deliberately searchable. Contains no email and no email_hash. It references the binding by fingerprint so a search result carries everything needed to send an encrypted bundle (name, affiliation, fingerprint, and via the fingerprint the public keys) while exposing **zero contact address**. You can find and send to a person without ever learning their email.

```sql
CREATE TABLE IF NOT EXISTS directory_profiles (
  fingerprint        text primary key references directory_identities(fingerprint),
  display_name       text not null,
  affiliation        text,            -- free text, user-entered
  affiliation_domain text,            -- the verified institutional domain, or null
  orcid              text,            -- optional, format-validated only
  updated_at         timestamptz default now()
);
-- search index on lowered name + affiliation; never on anything email-derived
```

### 17.3 The write gate (this is the "locked behind their third-party login" part)

Publishing or editing a profile reuses the [oauth-bind](frontend/src/app/api/directory/oauth-bind/route.ts) pattern exactly, two locks:

1. **OAuth session.** The route reads `session.user.email` (proven by Google / GitHub / Microsoft / LinkedIn, the providers added 2026-06-04), derives the email_hash, and finds the binding. No session, no write.
2. **Ed25519 signature.** The request carries a signature over the canonical profile payload, verified against the bound key, so only the key-holder can edit their own row. The email never comes from the client, only from the session.

So a profile is editable only by someone who both controls the email and holds the private key. Nobody can write or overwrite anyone else's profile.

### 17.4 Verified affiliation (the payoff of institutional OAuth)

Affiliation is **free text with a verified badge** (locked below). Anyone can type "Harvard." Separately, if the OAuth session email is on an institutional domain (not a consumer domain on the blocklist: gmail, outlook, hotmail, yahoo, icloud, proton, etc.), the route records that domain as `affiliation_domain` and the profile shows a "verified at wisc.edu" badge sourced from the proven login, not from the typed text. A Gmail login leaves the affiliation unverified but still searchable. This is what makes "search by school" trustworthy and blocks "I'm at MIT" impersonation, and it is the direct reward for having added Microsoft and Google institutional sign-in. Microsoft and Google institutional logins earn the badge; GitHub and LinkedIn (usually personal email) typically do not, which is correct.

### 17.5 Search

- **Logged-in researchers only** (locked below). Search requires a verified OAuth session of your own. This keeps it "researchers find researchers," not an open scrape target, and lets us attribute and rate-limit every query.
- Results return `display_name`, `affiliation` (+ verified badge), `fingerprint`, and the public keys. **Never an email.**
- Rate-limited per session and per IP via the existing [ratelimit](frontend/src/lib/sharing/directory/ratelimit.ts) infra, plus Vercel BotID on the search route, so the researcher list cannot be harvested even though it is browsable.

### 17.6 Guardrails

- **Opt-in, explicit consent.** Default stays invisible (the section 6 behavior). Creating a profile is a separate, clearly-labelled "make me searchable" action. No profile is created at signup.
- **Coarse fields only.** Name, institution, optional ORCID. Nothing the user did not type, never an email, length-capped and sanitized.
- **Signed delete route.** Removing the searchable row is a signed request like the write; it deletes the profile but leaves the binding intact, so existing shares still resolve.
- **PII posture.** Per the section 12 GDPR stance, profile rows are personal data with their own consent basis and are deleted on account deletion. The privacy policy gains one line: published profiles are publicly searchable to logged-in users.

### 17.7 Decisions (locked with Grant, 2026-06-04)

1. **Search is for logged-in researchers only.** A verified OAuth session is required to search. No public/anonymous search surface.
2. **Affiliation is free text plus a verified badge.** Anyone can claim an affiliation; an institutional OAuth login earns a domain-verified badge. Inclusive of users on personal email, who stay searchable but unverified.
3. **Profiles are opt-in and keyed by fingerprint, never email.** The private binding of section 6 is unchanged and stays non-enumerable.

### 17.8 Build phasing

Slots into the section 14 plan without disturbing it. The `directory_profiles` table and the signed write/delete routes extend **Phase 1 (identity)**; search UI and the verified-affiliation badge land in **Phase 3 (polish)**, since they depend on the binding and the OAuth providers already being in place. The schema addition is the pre-flagged data-shape change for this surface.

---

## 18. Profile enrichment and research-tool integrations (addendum, 2026-06-04)

**Recommendation: layer a researcher's actual body of work onto the section 17 profile by linking ORCID (publications) and Zenodo (deposits), with every linked credential held client-side and only public identifiers on the profile. This is the path toward a mini internal ResearchOS, a profile and discovery layer for the ecosystem, built in slices, not committed to as a network in v1.**

Section 17 makes a profile searchable. This section makes it worth finding. The motivation is collaboration discovery, a colleague should be able to see who you are, where you are, and what you have published or deposited, then reach you. The identity backbone (sections 5 and 6) and the OAuth providers (Google, GitHub, Microsoft, LinkedIn, added 2026-06-04) are the foundation, so this is enrichment, not new infrastructure.

### 18.1 ORCID-linked publications (the cheapest, highest-value piece)

ORCID is a poor email-prover (its email is private by default, which is why it is not a sign-in button), but for profile linking it is exactly right. A **"Link ORCID"** action on the profile runs ORCID OAuth, which proves the user owns that ORCID iD. With the verified iD in hand we fetch their **public works from the ORCID public API** (`/works`), no token storage required because the works are already public. The profile then renders their publication list, auto-pulled and refreshable.

This reuses the section 17 trust pattern exactly. A typed ORCID iD shows works with an "unverified" note (it could be anyone's iD); an OAuth-linked iD earns a verified badge. So the profile never lets someone attach a famous researcher's publication list to their own name without proving they own the iD.

### 18.2 Zenodo account linking and deposit (locked, token stays client-side)

ResearchOS already deposits to Zenodo browser-direct (the API is CORS-open, section reference in [[reference_zenodo_figshare_cors]] and the NIH initiative [[project_nih_sharing_initiative]]). Linking the account adds persistence and one-click push, and surfaces a researcher's deposits on their profile.

The load-bearing decision (Grant, 2026-06-04), **the Zenodo token never touches our database.** The OAuth code-to-token exchange runs through a thin server route so the client secret stays server-side, but the resulting user token is returned to the browser and stored only in the user's **encrypted identity sidecar**, the same place the key backup lives. The browser pushes deposits directly to Zenodo with that token. The profile stores only the user's **public Zenodo identifier** (username), never the credential, so others can see "this researcher deposits here" without ResearchOS ever being a credential custodian. This is the only model that preserves the store-nothing-sensitive posture (section 12). A "paste a personal access token" path is a viable fully-local fallback if the OAuth round trip is not worth a server route in the first cut.

### 18.3 The trust and credential rules (all mirror section 17)

- **Verified links get a badge, typed ones do not.** OAuth-proven ORCID and Zenodo links are badged; anything hand-entered is shown but marked unverified.
- **Third-party tokens stay client-side**, in the encrypted sidecar, never in our DB. The profile row holds only public identifiers (ORCID iD, Zenodo username).
- **Opt-in**, same consent posture as section 17. Surfacing your publications and deposits is a choice, even though the underlying data is already public.

### 18.4 The north star, a mini internal ResearchOS

The destination is a research profile and discovery layer, find people by school, see their verified identity, publications, and deposits, then collaborate. This ties directly into Collaborate Mode (the live shared-session idea on the roadmap). It is a real product direction and is named here so it is on record, but it is a multi-phase build, not a v1 commitment. We build toward it in slices and never let the social-network framing pull the first profile release out of scope.

### 18.5 Decisions (locked with Grant, 2026-06-04)

1. **Zenodo token stays client-side.** Thin server route for the OAuth exchange, token stored only in the encrypted sidecar, browser pushes deposits direct, profile holds only the public Zenodo username.
2. **ORCID publications come from the public works API with no token storage.** (Revised 2026-06-05, see section 18.7: ORCID is now also a sign-in button via a hybrid email flow, not only a profile-link action.)
3. **Linked accounts follow the section 17 verified-badge model**, and the mini-ResearchOS network is a staged north star, not a v1 feature.

### 18.6 Staging

- **Profile v1.** Section 17 (name, affiliation, search) plus ORCID-linked publications. Read-only, no credential storage, lowest risk.
- **Profile v2.** Zenodo link, deposit surfacing, one-click push from the client-side token.
- **Discovery and network features.** The longer build toward the mini-ResearchOS, coordinated with Collaborate Mode.

### 18.7 ORCID as a login, the email getaround (2026-06-05)

**Recommendation: add ORCID as a sign-in button, and because ORCID returns no email, bootstrap the account once with a proven email, then let ORCID re-authenticate it afterward. ORCID is the most universal identity in academia, so this is worth the one hybrid-flow wrinkle.**

ORCID cannot be a drop-in provider like Google or GitHub. Those return a verified email and flow straight through oauth-bind (section 6). ORCID's email is private by default, so it returns none, and the directory is keyed on the email hash (the relay routes on it). So ORCID uses a **hybrid claim flow**.

**First-time claim (two proofs, once):**

1. The user clicks Sign in with ORCID, which proves they control that ORCID iD.
2. Because no email comes back, the wizard drops into the existing 6-digit email OTP step to prove an email. (If the user has made their ORCID email public, ORCID OIDC does return it, so we skip the OTP and treat it like Google.)
3. We record the link, this ORCID iD belongs to this email-keyed identity. The email stays the directory's primary key, ORCID rides alongside it.

**Re-authentication (the payoff):** after setup, Sign in with ORCID resolves straight to the account. ORCID proves the iD, we look up the linked identity, the user is in with no email re-entry. Given how universal ORCID is, this is a smoother repeat login than email OTP, and it makes the user's ORCID iD a verified-owned profile attribute for free (the section 18.3 verified badge, no separate link step).

**Locked decisions (Grant, 2026-06-05):**

1. **A new ORCID-iD to email-hash mapping is added to the directory.** Additive, set at claim time when both ORCID and the email are proven together. The ORCID iD is a public identifier, so it is stored as-is (or hashed for lookup), never an email. This is the pre-flagged data-shape change for this surface.
2. **ORCID re-auth can sign in and write the profile, but NOT recover keys.** Key-backup recovery (handing back the encrypted blob) still requires the email OTP. This keeps the blast radius tight, a compromised ORCID account cannot reach the key backup, which stays gated on email control as today.

**Build notes:** reuses almost everything already built, the email-OTP path, the directory, the binding. The new pieces are the ORCID OIDC provider (ORCID speaks OpenID Connect), the hybrid claim branch in the setup wizard (ORCID session with no email drops to the OTP step), the orcid-to-email-hash mapping plus an ORCID-resolves-to-account lookup for re-auth, and the recovery route staying email-only. Slots into Phase 1 (identity) alongside the section 17 profile work.

---

## 19. Sources (addenda)

Profiles and integrations. ORCID Public API and works endpoint, ORCID OAuth scopes, Zenodo REST API and OAuth applications, InvenioRDM, FTC 2024 hashed-data guidance (re-cited for profile PII).

Legal. GDPR Articles 3, 6, 13, 27 and Recital 23, UW-Madison GDPR notice, 18 U.S.C. 2258A and 2258B and the 2024 REPORT Act, EU DSA Article 16, AGPLv3 and the GNU license FAQ, Matthew Green on client-side scanning.

Migration and academic norms. VS Code Settings Sync, progressive-profiling literature, 1Password 8 migration, Keybase park-by-email and Seitan tokens, Ink and Switch local-first essay, antiSMASH FAQ and standalone, BLAST developer info, Galaxy admin and Galaxy Australia data policy.
