# Cloud accounts, local data: identity system audit + redesign proposal

Status: design proposal (no code). 2026-06-13.
Principle (Grant): **the DATA is local, the ACCOUNT is cloud.** An account should be a social, cloud, device-independent thing (like a LinkedIn profile) that you log into from anywhere. The local-first part is the data, not the identity. Tying any login to a specific device is the anti-pattern we are removing, even for solo users.

This is a whole-stack audit (login, local identity, lab E2E sharing, relay + directory) and a target architecture. It does not change code yet.

---

## 1. The core finding: the model is inverted

There are already **two parallel identity layers** today, and they are backwards relative to the goal.

- **Cloud layer (already device-independent):** the NextAuth OAuth session. JWT strategy, no DB adapter, `trustHost`. Sign in with Google on any device and you get the same verified `session.user.email`. It is genuinely cloud and portable. But today it is used only for two things: proving an email to publish a directory profile, and deriving the billing owner key (`ownerKeyForEmail` = peppered HMAC of the email). It does **not** gate entry to the app.
- **Local layer (device-tied, and it is what actually gates the app):** the "account" the app treats as primary is a **folder-local username + a local keypair**. Entry requires, in order: a File System Access folder handle (stored per-browser in IndexedDB, not portable), the folder files on disk, and `users/<name>/_account.json` or `_sharing_identity.json` inside that folder. The private keypair lives wrapped in the folder sidecar (Argon2id under a recovery code) and, as a transitional shortcut, **raw/unwrapped in browser IndexedDB** (`researchos-sharing-identity`, labeled "legacy fallback"). None of this travels to another machine without re-provisioning.

So the thing that is already cloud (OAuth session) is treated as an optional add-on, and the thing that is device-tied (folder + local keypair) is treated as the account. The redesign is essentially **promoting the cloud layer to be the account, and demoting the local keypair to a per-device data credential.**

## 2. What the keypair is actually for (why we cannot just delete it)

The local keypair does real cryptographic work that protects E2E data, and that must survive:

- **Ed25519 (signing):** signs lab membership log entries, lab invites, every relay request, directory bind/rotate, profile publish, collab persistence. It proves authorship to an E2E-blind server.
- **X25519 (sealing):** `sealToRecipient` (ECDH + HKDF + XChaCha20) seals the **lab data key** to each member, and seals cross-boundary share bundles. This is what keeps the relay and the lab Durable Object unable to read data.

The server **never** sees these private keys today, and that is the property we must keep. "Account is cloud" must not become "server can read your data."

## 3. Target architecture

### 3.1 Account = cloud identity (the social, device-independent layer)
- The account is the **OAuth identity** (Google / Microsoft Entra for institutions / ORCID for academics) plus a directory record. It exists with **no folder connected** and is usable from any browser or device.
- Add the social surface the directory is missing: a **unique handle** (today there is only a non-human-readable fingerprint and a free-text display name), an avatar, and a single "find a researcher and share with them" flow (today search-by-name and send-by-email are two disconnected operations). The directory already has the hard parts: cloud profiles, trigram search, public shareable `/researchers/<fingerprint>` URLs, ORCID publication links, and a lab directory.
- Connecting a research folder becomes a **post-login action**, not the pre-login gate it is now.

### 3.2 Data = local (unchanged)
- The research folder, File System Access, local-first CRDT editing. This is the philosophy and it stays exactly as is.

### 3.3 Data-encryption keys = local + E2E, but bound to the cloud account (the reconciliation)
This is the crux. The keypair stays **client-generated and never server-readable**, but it stops being "the account" and becomes a **per-device data credential provisioned against the cloud account**:
- On device setup, the client generates the keypair and **publishes only the public keys** to the directory under the cloud account (the bind flow already exists, signed, server stores public keys + an opaque recovery blob it cannot read).
- A new device re-provisions by logging into the cloud account and **recovering the private keys from the Neon backup blob** (which already exists), instead of from the folder sidecar. The folder is no longer required to have your keys.
- A cloud account that has **not yet set up a device** is simply "not yet addressable for sealed data." It has an identity, a profile, and can be found and invited; it just cannot decrypt anything until it provisions a key on some device. The unified invite-token system we just built fits this exactly: **membership is a cloud server-token (no key needed), and data-key sealing is a per-layer post-join hook** that runs once the recipient has published a public key.

### 3.4 How lab/dept/institution sharing reconciles
- **Membership** (who is in the lab/dept/institution) is already moving to centralized server tokens (just shipped for dept + institution; lab is the scoped follow-on). No device key needed to be a member.
- **Data-key access** (the lab data key sealed to a member) stays E2E and waits for the member's published X25519 public key. If they are invited before setting up a device, the seal is **deferred** until they provision one (or a one-time-key path bridges it, which already exists for non-user invites). Membership and data-key access are already technically separable in the code; this formalizes that split.

## 4. The one real tradeoff to decide

Device-independent *login* is free (OAuth already gives it). Device-independent *data access* is not, because of a hard cryptographic fact:

- To let a brand-new device decrypt your data with **only** a cloud login and nothing else, the server would have to be able to hand over (or recover) your private key. That is **escrow, and it breaks E2E** (the server, or anyone who compels it, can read your data). The existing `IDENTITY_LAB_LOGIN.md` KMS-wrap design is exactly this, and it is why it would weaken E2E.
- To keep **E2E intact**, the user must hold **one recovery factor** the server never sees (the recovery words we already issue, or a passphrase). New device = cloud login + that factor, once. After that the device re-provisions and is seamless.

Recommendation: **keep E2E, keep a single user-held recovery factor** for cross-device data access, and make it painless (recovery kit at signup, re-enter once per new device). The cloud account itself stays fully device-independent; only the first data-unlock on a new device needs the factor. Offer institutions an optional, clearly-labeled escrow ("your IT can recover your data") as a separate, opt-in choice if a customer demands it, never the default.

## 5. What already supports this vs what blocks it

Already supports (most of the foundation exists):
- Cloud, device-independent OAuth session.
- Directory keyed on verified (peppered-hashed) email + anchored to the signing key.
- Cross-device key recovery via the Neon backup blob + recovery words (server cannot read it).
- Public shareable profile pages, trigram search, ORCID links, lab directory.

Blocks (the real work):
- **Account creation is folder-first.** You cannot have an identity without connecting an FSA folder (Chrome/Edge only). This is the biggest inversion to undo.
- **App entry is gated on the folder + local keypair**, not the cloud session.
- **No unique handle, no avatar, no "find then send" single flow** (social polish).
- **The relay/lab paths require the local device key present** (OAuth session alone is insufficient), which is correct for E2E but means a new device needs the one-time recovery step in section 4.
- **Raw private keys sit unwrapped in browser IndexedDB** (a transitional shortcut). Worth hardening regardless.

## 6. Migration phases (proposed, each shippable behind a flag)

1. **Decouple account from folder.** A user can create and log into a cloud account (OAuth) with no folder; profile, handle, and lookup work folderless. The FSA folder becomes a post-login "connect your data" step. (Largest IA change; touches the providers/login state machine and the folder-connect gate.)
2. **Local keypair becomes a per-device data credential.** Provision the keypair against the cloud account (publish pubkey on setup), recover cross-device from the Neon backup blob via the user-held recovery factor (not the folder sidecar). Harden the IndexedDB key-at-rest.
3. **Social layer.** Unique handle, avatar, "find a researcher and share" in one flow, optionally a lightweight connection graph.
4. **Sharing/lab reconciliation.** Deferred sealing + a "set up a device key to decrypt" gate so cloud-account-first users can be invited and made members before they have a device key. Finish the lab-tier migration onto the unified invite tokens (already scoped).

## 7. Open decisions for Grant

1. **E2E vs escrow for cross-device data access** (section 4). Recommended: keep E2E with one user-held recovery factor; optional institutional escrow opt-in. This is the philosophy-defining choice.
2. **Handle scheme:** auto-suggested from name/email vs user-chosen unique `@handle`. (Affects the directory schema.)
3. **Phase 1 aggressiveness:** make folderless accounts the default new-user flow, or ship it behind a flag alongside the current folder-first flow until proven.
4. **Whether to fold the just-built unified invite tokens + the org-portal sign-in into Phase 1** (they are already centralized and folderless, so they are a natural first slice of this larger move).

---

Audit basis: four read-only subsystem audits (login/auth, local identity/device-key, lab E2E sharing + key sealing, relay/directory/external sharing), 2026-06-13. Related: `docs/proposals/IDENTITY_OAUTH_ONLY.md`, `docs/proposals/IDENTITY_LAB_LOGIN.md`, `docs/proposals/2026-06-13-department-institution-tier.md`.
