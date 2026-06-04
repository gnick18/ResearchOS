# Cross-Boundary Sharing, Phased Build Plan

Companion to CROSS_BOUNDARY_SHARING_PROPOSAL.md and CROSS_BOUNDARY_SHARING_FUNDING.md. This is the implementation sequencing, not new design. Nothing here changes the locked decisions.

---

## Guiding principles for the build

1. **Everything lands behind a feature flag.** A `crossBoundarySharing` flag gates every surface, mirroring the version-control Phase 0 flag-gated pattern, so partial work can merge to main without showing users a half-built feature and without blocking the de-bloat and sequence-editor arcs.
2. **Greenfield first, collision zones last.** The bundle engine and the identity server are mostly new code in new locations (`lib/sharing/`, new `/api/` routes, new Settings UI), which barely touch the active arcs. The send and receive UI touches the methods page, notes, and the sharing layer, which are live collision zones. So the build front-loads the greenfield phases (safe to run now via per-commit cherry-pick) and defers the editor-adjacent UI until it can be coordinated with those arcs.
3. **The local app never regresses.** The whole feature is additive and degrades gracefully. With no backend configured (self-host, clone-and-run-local), the directory and relay simply do not appear, and the manual export-and-email floor still works.
4. **Data-shape changes are pre-flagged and lazy-normalized.** Two FLAG changes (an entity share UUID, and global-identity fields) land via lazy-normalize-on-read plus a Settings repair button, never a hard cutover. Each is surfaced to Grant before it commits.
5. **Verification gate every phase.** `cd frontend && npx tsc --noEmit` at exit 0, vitest for the engine and crypto and migration paths, and a named manual-verification step for anything touching the live relay or the File System Access layer (which cannot be fully tested in CI).

---

## Human prerequisites (Grant, not bot-able)

These gate Phase 1 and beyond, so worth starting early in parallel with Phase 0.

- **Provision the cloud accounts and set env vars.** A Cloudflare R2 bucket, a Neon Postgres project, a Resend account, and an Upstash Redis instance, with their keys added to the Vercel project environment. The build can scaffold the code against these, but the accounts and secrets are yours to create.
- **Read the RISE fellowship letter for an IP clause** before the donation surface in Phase 3.
- **Apply to the Vercel OSS Program** (independent, anytime).

---

## Phase 0, portable bundle engine (greenfield, no network)

**Goal.** Turn any entity plus its attachments into an encrypted portable bundle and back, fully offline. This is the foundation for both the relay and the manual floor.

**Deliverables.**
- A new `lib/sharing/bundle/` module that builds an RO-Crate-1.1-inside-BagIt zip from an entity (note, method, project) and its referenced images and files, and that verifies and parses one on import.
- An `age` encryption wrapper (`typage`) over the zip, encrypt-to-public-key and decrypt-with-private-key.
- A stable per-entity share UUID (the BagIt External-Identifier, the dedup key), minted at entity creation and persisted. **FLAG, data-shape change**, add a `shareUuid` to notes, methods, and projects, lazy-normalized on read (mint and persist if absent) with a Settings repair button.
- Round-trip vitest coverage, build then encrypt then decrypt then verify then parse, including a project with multiple image attachments.
- The manual floor, a flag-gated "export encrypted bundle" action that downloads the bundle so a user can email it themselves. This is genuinely useful on its own and is the registered-only path to reach a non-user.

**Touches.** New `lib/sharing/`, reads from the existing entity stores and `file-service`. Low collision.

**New dependencies.** `typage`, `fflate`. Bundle-weight check per the mathjs lesson, both are small and the crypto path is dynamically imported only when the sharing UI opens.

**Ships.** A tested engine plus the manual export floor, behind the flag.

**Size.** Medium. One focused sub-bot in a worktree.

---

## Phase 1, identity (keys, directory, accounts)

**Goal.** Stand up email-linked identity, in-browser keys with recovery, and the directory, with no data movement yet. This is the first real backend beyond the two existing proxy routes.

Best split into three sub-phases.

**1a, client keys and recovery (greenfield, client-only).**
- Generate the X25519 and Ed25519 keypair in the browser, store in IndexedDB.
- Key backup, Argon2id via libsodium.js (ops 3, mem 64 MiB, in a Web Worker, with a 32 MiB canary fallback), wrap with XChaCha20-Poly1305.
- A 12-word recovery phrase via `@scure/bip39`, surfaced as "Recovery Words," plus a 1Password-style device salt and a downloadable Recovery Kit.
- vitest for the wrap, unwrap, and mnemonic round-trip.

**1b, directory server (greenfield, new API).**
- Neon-backed directory, store `HMAC(pepper, email)` to public keys plus the opaque key-backup blob.
- Signup with a 6-digit email OTP via Resend, exact-hash lookup only, uniform responses, `@upstash/ratelimit` on every endpoint.
- Log-backed trust-on-first-use, an append-only signed epoch log.
- Auth.js v5 with the Resend provider for account auth.
- A `HOSTED_MODE` flag so the whole surface is absent when no backend is configured.

**1c, claim ceremony and migration (touches Settings, low collision).**
- Intent-triggered "claim this profile with a global identity," additive, never destructive, linking the folder-local account to the global identity.
- **FLAG, data-shape change**, new fields on `_user_metadata.json` or a new sidecar (email, public keys, global-account-id, key-backup blob, recovery state), lazy-normalized on read with a Settings repair button.
- Multi-device restore via the recovery phrase.

**Touches.** New `/api/directory/*` routes, new onboarding and Settings UI, the identity sidecar. Mostly greenfield plus Settings, low collision with the active arcs.

**New dependencies.** `libsodium-wrappers`, `@scure/bip39`, `next-auth` (Auth.js), `@upstash/ratelimit`. Client crypto is code-split.

**Ships.** Accounts, keys, recovery, lookup, and the claim flow, all testable without the relay.

**Size.** Large. Three sub-bots, sequenced 1a then 1b then 1c, with the infra provisioning done by Grant in parallel.

---

## Phase 2, relay (the actual send and receive)

**Goal.** Move bundles registered-to-registered through the blind relay.

**Deliverables.**
- Server, a Cloudflare R2 storage adapter (presigned PUT and GET via the S3 SDK, Vercel Blob swappable behind the same interface), a Neon mailbox index, a 30-day TTL with lazy-delete-on-access plus a daily orphan-sweep cron, a per-inbox quota, authenticated upload, and an abuse-report endpoint.
- Client send, look the recipient up, age-encrypt the bundle to their key, presigned upload to R2, write the index row. If the recipient is not registered, fall back to the manual floor from Phase 0.
- Client receive, poll the inbox on app open, show pending inbound shares with sender and provenance, accept or decline, and on accept verify the BagIt manifest, decrypt, and import as the recipient's own copy with a fresh local ID, letting them choose where it lands.
- Signal-style key-change advisory on receive.

**Touches.** The methods page, notes lists, the sharing layer, and the inbox. **High collision** with the de-bloat and sequence-editor arcs. This phase is sequenced to run when those arcs are at a coordinated point, integrated by per-commit cherry-pick, never a stale-anchor merge.

**New dependencies.** `@aws-sdk/client-s3` (server-side only).

**Ships.** The full registered-to-registered experience behind the flag.

**Size.** Large. Two or three sub-bots (server relay, send UI, receive-and-accept UI), carefully scoped against the collision zones.

---

## Phase 3, polish, provenance, and compliance

**Goal.** Make it trustworthy and legible, and satisfy the legal surface.

**Deliverables.**
- The internal-versus-external distinction in the UI, an origin badge and filter on the methods and notes lists, plus provenance display (sender, date, verified fingerprint).
- A privacy policy page covering the GDPR Article 13 elements, a "Source code (AGPLv3)" footer link with a CI gate so the repo never lags the deploy, and the abuse-report UI.
- The donation surface, a UW Foundation gift-account link and a GitHub Sponsors button, framed as supporting a free open-source tool.
- A wiki page for the feature, handed to a dedicated wiki sub-bot per the established convention (the feature sub-bots only list wiki implications, they do not write wiki pages).

**Touches.** Methods and notes lists (collision zone), footer, Settings, a new public page, the wiki. Coordinate the list-touching parts with the arcs.

**Size.** Medium. One or two sub-bots plus a wiki sub-bot.

---

## Sequencing and collision strategy

```
Now ──► Phase 0 (greenfield)         ── safe to start immediately, cherry-pick integrates clean
        Phase 1a (client keys)       ── greenfield, parallel-safe
        [Grant provisions infra] ────────────────┐
                                                  ▼
        Phase 1b (directory) ───► Phase 1c (claim/migration)
                                                  │
                                                  ▼
        Phase 2 (relay + send/receive UI) ── WAIT for a coordinated point with the
                                              de-bloat and sequence-editor arcs (collision zone)
                                                  │
                                                  ▼
        Phase 3 (polish, provenance, legal, wiki)
```

The critical insight, Phases 0 and 1 are largely greenfield and can proceed now in parallel with the active arcs, because they add new files in new locations and integrate by clean cherry-pick. Phase 2 is where the build enters the methods, notes, and sharing surfaces that the de-bloat and sequence-editor arcs are actively reshaping, so it is deliberately sequenced last among the heavy phases and coordinated rather than run blind.

---

## What needs Grant at each gate

- **Before Phase 1,** provision R2, Neon, Resend, and Upstash, and set the env vars.
- **Before Phase 3 donation surface,** the RISE IP check.
- **At each FLAG data-shape change** (the entity share UUID in Phase 0, the identity sidecar fields in Phase 1c), a one-line pre-flag confirmation before it commits.
- **Each phase** merges to local main behind the flag for you to exercise, with the relay-touching and FSA-touching steps verified manually since CI cannot cover them.

---

## Suggested first move

Start Phase 0 now. It is greenfield, needs no cloud accounts, integrates by clean cherry-pick, and delivers the tested bundle engine plus the manual export floor, which is real working value on its own. In parallel, provision the Phase 1 infrastructure so identity can begin the moment Phase 0 lands.
