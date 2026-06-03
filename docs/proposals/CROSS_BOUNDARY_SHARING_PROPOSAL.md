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

Three pieces, two send paths.

**The identity directory** (Vercel + Neon Postgres). Maps a verified email to a handle and two public keys (X25519 for encryption, Ed25519 for signing). Stores nothing else about research. CORS-open for public-key lookup, because public keys are public by definition (the Keybase model).

**The relay mailbox** (Cloudflare R2 + a small Neon index). A blind store-and-forward inbox. It holds opaque encrypted bundles addressed to a recipient and delivers them when that recipient next opens ResearchOS, then deletes them. Structurally identical to Matrix's send-to-device relay, the server moves ciphertext it cannot read.

**The client** (the existing app). Builds the portable bundle, encrypts it, uploads it, polls its own inbox on open, decrypts, and files accepted bundles into the user's folder.

Path 1, registered recipient. Look the recipient up by email, fetch their X25519 public key, encrypt the bundle to that key, drop it in the relay. They see it in their inbox next open. The server never holds a key.

Path 2, unregistered recipient. Encrypt the bundle under a random passphrase, park it in the relay keyed to the recipient's email, send them an invite email with a link. They open the link, enter the passphrase (shared out of band), and download. If they later register with that email, any parked bundles auto-deliver into the app. This is the Proton Mail password-protected-message model plus Keybase's park-by-email pattern, and it is what makes "send to anyone" actually work.

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

**Send.** Pick an artifact, pick a recipient by email. If they are in the directory, encrypt to their key and relay (Path 1). If not, generate a passphrase, encrypt, park, and email an invite (Path 2). Show the recipient's key fingerprint for optional out-of-band confirmation. The floor option (download the encrypted bundle and hand it off yourself via Web Share, email attachment, or file) is always present, and is the only option when self-hosted with no backend.

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
- **The receive chicken-and-egg is solved at registration.** Publishing public keys at signup (the prekey pattern) makes an account immediately reachable, so a sender can park a bundle before the recipient is ever online. For someone with no account at all, Path 2's password envelope plus park-by-email is the universal first-contact fallback, and the parked bundle auto-delivers when they register with that email (the Keybase model).
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
3. **Unregistered-recipient path, ship Path 2 in v1.** Password envelope plus email invite, so "send to anyone" works from launch. Easiest scope to trim if v1 needs to shrink.
4. **Methods UI, same list with an origin badge and filter.** Received items sit alongside the user's own with clear provenance.
5. **Bring-your-own-storage, deferred to a later phase.** The escape valve for a lab that outgrows the free pooled inbox, not a v1 feature.

Funding model, free for everyone, backend on free credits, donations via a UW Foundation gift account plus GitHub Sponsors, abuse handled by authentication plus quota plus TTL plus an abuse endpoint. No payments, no entity, no paid tier.

---

## 14. Phased build plan (after sign-off)

This work touches the methods page, notes, the sharing layer, and attachments, which sit in or next to the active de-bloat and sequence-editor collision zones, so it integrates by per-commit cherry-pick, never a stale-anchor tree-merge, and the data-shape change is pre-flagged.

- **Phase 0. Bundle engine, no network.** RO-Crate-in-BagIt build and verify, `age` encrypt and decrypt, export-and-import via file handoff (the floor). Fully testable offline, ships value on its own.
- **Phase 1. Identity.** Keypair generation, backup and Recovery Words, the directory (signup OTP, lookup, log-backed TOFU), the claim ceremony and migration prompt.
- **Phase 2. Relay.** R2 adapter, presigned upload and download, the inbox poll, accept-and-file flow, TTL and abuse controls.
- **Phase 3. Path 2.** Unregistered-recipient password envelope, email invites, park-and-auto-deliver (if approved for v1).
- **Phase 4. Polish.** Internal-versus-external UI, key-change advisories, provenance display, the privacy policy and AGPL footer.

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

Legal. GDPR Articles 3, 6, 13, 27 and Recital 23, UW-Madison GDPR notice, 18 U.S.C. 2258A and 2258B and the 2024 REPORT Act, EU DSA Article 16, AGPLv3 and the GNU license FAQ, Matthew Green on client-side scanning.

Migration and academic norms. VS Code Settings Sync, progressive-profiling literature, 1Password 8 migration, Keybase park-by-email and Seitan tokens, Ink and Switch local-first essay, antiSMASH FAQ and standalone, BLAST developer info, Galaxy admin and Galaxy Australia data policy.
