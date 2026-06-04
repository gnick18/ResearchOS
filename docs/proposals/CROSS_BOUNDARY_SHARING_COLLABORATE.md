# Cross-Boundary Sharing, Collaborate Mode (live sessions)

Status: fleshed-out design proposal, not yet a build spec. The E2E fork is marked "recommended, pending Grant." Written 2026-06-04.
Author: sharing initiative (master)

This expands the "Beyond copies, Collaborate mode" sketch in CROSS_BOUNDARY_SHARING_ROADMAP.md into a build-ready-as-possible design. It does the hard thinking now so the eventual build is faster. Every external technical claim is verified against a cited source, and any claim that could not be confirmed is flagged as such.

It is grounded in and does not contradict the locked tenets in CROSS_BOUNDARY_SHARING_PROPOSAL.md (sections 2 and 13). The three that bind this design hardest,

1. The web backend is optional sugar. Clone-and-run-local must always work fully.
2. We never store research content, and never permanently. A transient encrypted relay is fine, permanent readable storage is not.
3. End-to-end encryption is the default posture. The relay moves ciphertext it cannot read.

---

## 1. Concept, and why it fits the tenets

Everything shipped so far in the sharing arc is a copy. A send is a snapshot sealed to a recipient, moved through a blind store-and-forward relay, and materialized as the recipient's own local copy (CROSS_BOUNDARY_SHARING_PROPOSAL.md section 1). There is no live link, because two people in different cloud folders share no storage to point at.

Collaborate mode is the live complement. A user temporarily promotes one artifact (a note first, later a markdown method) to a live shared session hosted in the cloud, invites N people, and everyone edits it together in real time, every keystroke rendering on every screen with no manual refresh, like a shared document. When the work is done, the session is retired, which writes a permanent local copy into every collaborator's own folder and then deletes the cloud copy.

The shape is ephemeral-cloud, permanent-local. The cloud state exists only for the duration of the session and is deleted on retire. The durable artifact always ends up local, one materialized copy per collaborator. So this is a temporary shared scratchpad that dissolves back into local copies, not a hosted backend that owns anyone's research.

Why each tenet survives.

- Optional sugar. Collaborate mode is the same kind of convenience the relay is. With no hub configured, the app simply does not offer live sessions, and every local feature still works. A self-hosted deployment can run its own hub (section 8).
- Never permanently store readable data. In the recommended design (section 3) the hub never sees plaintext at all, and even in the fallback design the plaintext lives only for the session and is destroyed on retire. Either way there is no permanent readable store.
- E2E by default. The recommended fork keeps the hub blind. It is the same per-doc-key-wrapped-to-each-recipient idea already used for multi-file shares.

How it contrasts with copy-based sharing.

| | Copy-based send (shipped) | Collaborate mode (this doc) |
| --- | --- | --- |
| Liveness | Snapshot, no auto-update | Live, every edit propagates instantly |
| Transport | Store-and-forward relay (R2 + Neon index) | Realtime hub (one Durable Object per live doc) |
| Cloud lifetime | Bundle held until pickup or 30-day TTL, then deleted | Session held only while live, deleted on retire |
| End state | One local copy for the recipient | One local copy per collaborator |
| Conflict model | None (one-way copy) | CRDT (conflict-free concurrent edits) |
| Identity/auth | Signed relay request, sealed-to-recipient bundle | Signed socket token, per-doc key wrapped to each X25519 key |
| Reuse | New build per tier | Reuses identity/auth and import/apply (retire-to-local) |

The two are siblings, not rivals. Copy-based sharing is "here, take this." Collaborate mode is "let us work on this together for a while, then we each keep what we made." Retire-to-local literally ends in the same place a copy-based send ends, a local artifact with provenance, so the two converge.

---

## 2. The editing core, Yjs

Conflict-free concurrent editing needs a CRDT (Conflict-free Replicated Data Type), a data structure where every client is equal and concurrent edits merge deterministically with no central arbiter. Yjs is the de-facto standard CRDT for collaborative text in the JS ecosystem and is MIT licensed ([yjs/yjs npm](https://www.npmjs.com/package/yjs)).

Three facts make Yjs the right fit here, each verified.

- It binds to CodeMirror 6, which the project already uses. The note and markdown editor is CodeMirror 6 today (`frontend/src/components/InlineMarkdownEditor.tsx`, `frontend/src/lib/markdown/cm-inline-reveal/`, and CM6 packages pinned in `frontend/package.json`, for example `@codemirror/state` 6.6.0 and `@codemirror/view` 6.43.0). The binding is `y-codemirror.next`, whose `yCollab` extension binds a `Y.Text` to a CodeMirror 6 editor, and it is MIT licensed ([y-codemirror.next README](https://github.com/yjs/y-codemirror.next), [Yjs docs, CodeMirror](https://docs.yjs.dev/ecosystem/editor-bindings/codemirror)). NOTE, there is no Yjs dependency in the repo yet, so this is a net-new dependency family at build time, not something already present.
- Presence and cursors come for free via the awareness protocol. Yjs ships an awareness protocol that shares ephemeral per-client state (cursor position, selection, who is online) separately from the document, and `y-codemirror.next` renders remote selections and cursors from it as a plugin ([y-codemirror.next README](https://github.com/yjs/y-codemirror.next)). Awareness state is ephemeral and is not part of the persisted document, which matters for the blind-persistence design below.
- Shared undo is per-client. `y-codemirror.next` provides collaborative undo/redo where each client keeps its own undo history ([y-codemirror.next README](https://github.com/yjs/y-codemirror.next)), which is the behavior users expect (your undo undoes your edits, not your collaborator's).

A caveat to carry into the build. The Yjs ecosystem is mid-transition. The stable line is `y-codemirror.next` on Yjs v13, with an unstable `@y/codemirror` for the upcoming Yjs v14 ([y-codemirror.next, search result note]). The build should pin the stable v13 line and revisit v14 later, not chase the unstable package.

---

## 3. Architecture

### 3.1 Why a Durable Object, not a Vercel function

A live session needs a long-lived stateful socket hub, one authoritative place per document that holds the in-flight session and fans every edit out to all connected clients over a persistent WebSocket. Vercel functions are the wrong fit for this, they are request-scoped and do not hold long-lived sockets, which is exactly why the copy-based relay is store-and-forward rather than realtime.

Cloudflare Durable Objects (DOs) are the canonical home for this on Cloudflare. A DO is a single-instance stateful Worker that combines compute with storage and is addressed by id, so "one DO per live document" gives each session a single authoritative coordinator ([Cloudflare Durable Objects overview](https://developers.cloudflare.com/durable-objects/)). DOs are built for exactly this class of problem, the docs name collaborative editing, chat, and multiplayer as the motivating use cases ([Cloudflare Durable Objects overview](https://developers.cloudflare.com/durable-objects/)).

There is prior art for Yjs-on-DO so we are not inventing the wiring. `y-durableobjects` is an MIT-style library that runs Yjs on Cloudflare Workers via Durable Objects, inspired by `y-websocket`, eliminating the Node `y-websocket` server ([napolab/y-durableobjects](https://github.com/napolab/y-durableobjects)). `yjs-cf-ws-provider` is another WebSocket provider for Yjs on Cloudflare Workers ([TimoWilhelm/yjs-cf-ws-provider](https://github.com/TimoWilhelm/yjs-cf-ws-provider)). These are reference implementations for a plaintext hub. The E2E-blind variant (section 4a) is a thinner relay-only DO, so it is if anything simpler than these.

WebSocket Hibernation is the cost lever. The DO WebSocket Hibernation API lets a DO evict from memory while clients stay connected, and duration charges do not accrue while hibernating ([Cloudflare, Use WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [Cloudflare DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)). For sparse research-editing patterns (long idle gaps) this matters a lot, and the build should use the hibernation API rather than keeping the DO hot.

### 3.2 Data flow (E2E-blind, the recommended design)

```
  Collaborator A (browser)                 Collaborator B (browser)
  +-----------------------+                +-----------------------+
  | CodeMirror 6 editor   |                | CodeMirror 6 editor   |
  |   + yCollab binding   |                |   + yCollab binding   |
  | Y.Doc (Yjs CRDT)      |                | Y.Doc (Yjs CRDT)      |
  | doc key K (in memory) |                | doc key K (in memory) |
  +----------+------------+                +-----------+-----------+
             |  encrypt(update, K)                     |
             |  = XChaCha20-Poly1305                   |
             v  + Ed25519 sign                         v
        [ ciphertext update ]                   [ ciphertext update ]
             |                                         |
             |        signed WS token (section 5)      |
             +------------------+   +------------------+
                                v   v
                    +---------------------------------+
                    |  Cloudflare Durable Object      |
                    |  one per live document          |
                    |  - verifies socket token        |
                    |  - fans ciphertext to peers     |
                    |  - persists ENCRYPTED updates   |
                    |    (SQLite-backed DO storage)   |
                    |  - NEVER holds K, NEVER decrypts |
                    +---------------------------------+
                       ^                          ^
                       |  ciphertext only         |
                       |  (relay + blind store)   |
                       +----------+    +----------+
                                  |    |
   Awareness (cursors/presence):  ephemeral, also encrypted under K,
   relayed but not persisted.

   On RETIRE: each client materializes final Y.Doc -> local artifact
   via existing import/apply machinery, then the DO + its stored
   ciphertext are deleted.
```

The hub's job is reduced to three blind operations, authenticate the socket, fan ciphertext out to the other connected peers, and optionally persist ciphertext so a late-joiner or a reconnecting client can catch up. It never holds the document key K and never decrypts, so it sees only opaque bytes plus the small authenticated envelope (document id, a public key, a clock) it needs to order and route them.

The per-doc key K is generated by the session initiator and wrapped to each collaborator's X25519 identity public key, exactly the wrapped-key idea already documented for multi-file shares (CROSS_BOUNDARY_SHARING_ROADMAP.md, the "seal a per-share symmetric key once" sub-question) and already implemented as the single-recipient seal in `frontend/src/lib/sharing/encryption.ts` (ephemeral X25519, HKDF-SHA256, XChaCha20-Poly1305). Each collaborator unwraps K with their X25519 private key, then encrypts and decrypts Yjs updates locally under K.

---

## 4. The E2E fork (the key open decision)

The one genuinely load-bearing decision is whether the hub sees plaintext during a live session. Both options are fleshed out below with concrete mechanics, then a recommendation.

### 4a. E2E-blind (recommended, pending Grant)

The hub relays and stores only encrypted Yjs updates. Clients merge locally. The server never sees plaintext, even mid-edit.

Mechanics.

1. Session start. The initiator generates a random 256-bit document key K. For each invited collaborator, K is wrapped to that collaborator's X25519 public key using the existing seal primitive in `encryption.ts`. The wrapped-K set is small and can be handed to clients out of band of the hub (for example carried in the signed invite, section 5), so the hub never needs to touch even the wrapped keys.
2. Editing. Each local Yjs update (the binary delta Yjs emits on every change) is encrypted under K with XChaCha20-Poly1305 and signed with the author's Ed25519 identity key, then sent to the DO. The DO verifies the signature and the small authenticated envelope, then fans the ciphertext to the other sockets. Receiving clients verify, decrypt, and apply the update to their local Y.Doc. Because Yjs is a CRDT, applying updates in any order converges.
3. Awareness. Cursor and presence state is also encrypted under K and relayed, but never persisted (it is ephemeral by nature).

Blind persistence and compaction (the hard part, with prior art). Relaying alone is not enough, a client that joins late or reconnects after a drop needs the history. Storing the full encrypted-update log forever would grow without bound and cuts against the ephemeral posture. The answer is encrypted snapshots plus a short tail of encrypted updates, and this exact pattern is established prior art, not something we are inventing.

- secsync is a published architecture for relaying end-to-end encrypted CRDTs over a central service, and it supports Yjs ([serenity-kit/secsync](https://github.com/serenity-kit/secsync)). Its model is precisely ours, a Snapshot holds the encrypted CRDT document at a point in time, an Update holds one or more encrypted CRDT updates referencing a snapshot, and each carries unencrypted but authenticated metadata (document id, a public key, signatures) so the server can verify ordering and authenticity without ever decrypting the content ([serenity-kit/secsync](https://github.com/serenity-kit/secsync)). Snapshots compress history, a client downloads and decrypts one snapshot and then applies only the updates after it, rather than replaying thousands of updates ([serenity-kit/secsync](https://github.com/serenity-kit/secsync)). secsync uses XChaCha20-Poly1305-IETF for both snapshots and updates and Ed25519 signatures for authenticity ([serenity-kit/secsync, fetched]), which lines up with the primitives already in the codebase, so we can either adopt secsync directly or follow its design with our own thin DO.

  Compaction in our case is, periodically (and on the last writer leaving), a client encrypts the current full Y.Doc state under K as a fresh snapshot, signs it, and posts it to the DO, which then drops the now-superseded encrypted update tail. The DO does this blindly, it is told "this snapshot supersedes updates up to clock N" in the authenticated envelope and deletes accordingly, never reading content.

- The Yjs community has discussed this design extensively and confirms the relay-encrypted-updates approach is feasible, with the caveat that a blind server cannot itself merge or compact plaintext, so snapshotting must be client-driven ([Yjs community, implementing E2E encryption](https://discuss.yjs.dev/t/implementing-end-to-end-encryption/308), [Yjs community, E2E with schema validation](https://discuss.yjs.dev/t/end-to-end-encryption-with-schema-validation/2263)). DeepNotes is a shipped product doing E2E-encrypted note-taking on Yjs, which is existence proof ([Yjs community, DeepNotes](https://discuss.yjs.dev/t/deepnotes-end-to-end-encrypted-visual-note-taking-with-yjs/1787)).

Tradeoffs.
- For. Consistent with the never-store-readable-data tenet at the strongest level, the hub is blind during the session, not just after it. No new trust surface beyond the existing identity keys. Reuses the exact crypto primitives already in the repo.
- Against. More work. The DO cannot do server-side merge or server-driven compaction, so the client owns snapshotting and the catch-up protocol. Server-side validation of document structure is impossible (the server cannot enforce a schema on ciphertext), so a malicious authenticated collaborator could in principle inject a malformed update, this is a known limitation of E2E CRDTs and is mitigated by the fact that collaborators are explicitly invited and identity-bound, not anonymous. Awareness and updates both need the client-side encrypt/sign wrapper, which is custom glue rather than a stock provider.

### 4b. Server-side merge (the simpler fallback)

The DO holds the plaintext Y.Doc for the duration of the session and merges centrally, the stock `y-durableobjects` / `y-websocket`-style model.

Mechanics. The DO maintains a server-side Y.Doc, applies incoming updates to it, and broadcasts merged updates. Persistence is the plaintext (or at-rest-encrypted-by-Cloudflare) Y.Doc in DO storage. This is the path with the most turnkey libraries ([napolab/y-durableobjects](https://github.com/napolab/y-durableobjects), [TimoWilhelm/yjs-cf-ws-provider](https://github.com/TimoWilhelm/yjs-cf-ws-provider)).

Tradeoffs.
- For. Much less custom code, server can compact and snapshot itself, late-join catch-up is trivial, schema validation is possible server-side.
- Against. The hub sees research data in plaintext for the session's duration. Even though the data is deleted on retire, this is exactly the "permanent (here, temporary) readable store" the project's posture pushes against, and it weakens the marketing claim that our servers never see research. It is a real step down from the relay's blind-by-construction property.

### Recommendation

DECISION (Grant, 2026-06-04), LOCKED to 4a (E2E-blind). Grant confirmed the key worry, E2E-blind does NOT change the live-editing experience, you still get the full Google-Docs feel (simultaneous editing, live remote cursors, presence) because the Yjs CRDT and awareness layer are identical under both forks, the only difference is that the hub relays sealed bytes it cannot read. The encryption is transparent to the merge (each client decrypts locally and converges), so 4a costs engineering, not UX, and keeps the "our servers never see your research, even live" claim. 4b is no longer under consideration. PROCEEDING via a local spike first (wrangler dev, no infra provisioning) to de-risk the Yjs + CM6 + Durable Object integration before committing to the MVP build.

Recommended, pending Grant, E2E-blind (4a). It is the only option that keeps the strong "our servers never see your research, even live" claim that the whole sharing arc is built on, and it reuses the crypto primitives already shipped in `encryption.ts`. The extra work is real but bounded, and secsync gives us either a library to adopt or a blueprint to copy. The MVP can ship the blind relay first and add blind snapshot/compaction in a fast follow (a two-person session that never drops barely needs catch-up), so the harder half of 4a is deferrable without compromising the posture.

If Grant decides the engineering cost is not worth it for a beta, 4b is the honest fallback, but it must come with an explicit, visible "during a live session the hub temporarily holds the document" disclosure, because it changes the privacy story.

---

## 5. Auth and invites

Reuse the sharing identity system end to end, no new identity surface.

- Gate the socket on a signed token. The WebSocket upgrade carries a token signed by the caller's Ed25519 identity key over a canonical payload (document id, action, issuedAt), verified by the DO before any data flows. This is the same per-request-signature model the relay already uses (`frontend/src/lib/sharing/relay/auth.ts`, which signs an action plus issuedAt and rejects anything outside a freshness window). The DO checks the signature against the collaborator's directory-bound Ed25519 key, so the socket is authenticated to a real identity, not an anonymous connection. The relay's documented v2 nonce-store hardening applies here too if replay within the freshness window becomes a concern.
- Invite a collaborator via the existing directory and invite flow. The initiator looks a collaborator up by email in the identity directory, fetches their X25519 public key, wraps K to it, and sends a session invite. The invite reuses the invite flow already designed (CROSS_BOUNDARY_SHARING_INVITE.md), the only new payload is the session id, the hub address, and the wrapped K. Accepting the invite is what unlocks the socket.
- The keyless-invitee case. If you try to invite someone who has no sharing identity (no published X25519 key), there is no key to wrap K to, so live collab is not possible with them, exactly as registered-to-registered relay sharing already requires both parties to have accounts (CROSS_BOUNDARY_SHARING_PROPOSAL.md decision 3). The honest UX is the same as the relay's, explain "they have not set up a sharing identity" and offer the copy-based path instead (send them a snapshot). Do not silently degrade, explain and offer the fallback.

---

## 6. Entity scope

Text-first, because text CRDT is the mature part of Yjs.

- In scope first. Notes and markdown methods, the artifacts whose body is free text in a CodeMirror 6 editor. These map directly onto a single `Y.Text` with the stock `yCollab` binding, which is the well-trodden path.
- Harder follow-on, structured records. Experiments (tasks), PCR and plate protocols, and other structured records keep their data in typed stores, not a text blob. Live-collaborating them means mapping their shapes onto Yjs shared types (`Y.Map`, `Y.Array`) field by field, deciding per-field merge semantics, and building a binding between the form UI and the CRDT, none of which `y-codemirror.next` gives us for free. There is also a correctness hazard, a numeric protocol field merged by last-write-wins is fine, but a structured field with internal invariants (a plate layout, a gradient table) can reach an invalid state under naive concurrent edits. This is a genuinely separate design and should not block the text-first MVP. It mirrors the roadmap's own staging, where structured composites are always the harder later tier.

A practical middle note. Even for a structured record, its free-text fields (a protocol's notes, an experiment's description) could be the first live-collab surface, with the structured fields staying copy-only. That is a possible intermediate step worth keeping in mind, not a commitment.

---

## 7. Retire-to-local

This is where the ephemeral session becomes the permanent local artifact, and it is the step that keeps the whole feature inside the tenets.

- Trigger. The session owner (or any collaborator, policy is an open question, section 11) ends the session. Optionally the session auto-retires after an idle TTL (section 9).
- Materialize per collaborator. On retire, each connected client takes the final converged Y.Doc state, turns it back into a normal artifact record plus any attachments, and writes it into that collaborator's own folder using the existing import/apply machinery. The note path is `note-transfer.ts` and the composite path is the export/import resolution flow `ImportExperimentDialog` plus `applyImportPlan` (referenced in `frontend/src/lib/sharing/experiment-transfer.ts`). Retire-to-local is "the same materialize step the inbox already runs," just sourced from the live Y.Doc instead of a decrypted bundle. New local ids are minted on import exactly as for received copies, so there is no id collision with the collaborator's existing data.
- Provenance and versioning. The materialized copy carries the same external-copy provenance the relay copies carry (CROSS_BOUNDARY_SHARING_PROPOSAL.md section 9), who the collaborators were, the session id, the retire timestamp, and a marker that it came from a live session rather than a one-way send. It slots into the existing internal-versus-external badge system. If the artifact already existed locally (the initiator's own note that was promoted), retire updates it in place and bumps its version rather than creating a duplicate.
- Then delete the cloud copy. After every connected client confirms its local write (ack-after-write, the same discipline the inbox uses before acking the relay), the DO and all its stored encrypted state are destroyed. The ephemeral-cloud half of the contract is honored, nothing readable or unreadable persists in the cloud past retire.
- The offline collaborator. A collaborator who was not connected at retire is the hard case, handled in section 9.

---

## 8. Self-hostability and graceful degradation

Clone-and-run-local must stay honest, so the collab hub cannot be a hard dependency.

- The hub is self-hostable. A DO-based Worker is deployable by any operator to their own Cloudflare account, and the open-source `y-durableobjects` and `yjs-cf-ws-provider` projects show the deployable shape ([napolab/y-durableobjects](https://github.com/napolab/y-durableobjects), [TimoWilhelm/yjs-cf-ws-provider](https://github.com/TimoWilhelm/yjs-cf-ws-provider)). The hub address is configuration, the same way the relay endpoint is, so a self-hoster points the app at their own Worker. AGPLv3 Section 13 applies (we run a modified hosted version, so we offer source), satisfied the same way the relay is, a source link to the deployed commit.
- It degrades to nothing, not to an error. When no hub is configured (a pure clone-and-run-local, or a privacy-maximal lab with no backend), the app detects the absence and simply does not surface the "Collaborate" affordance. There is no broken button and no error, live editing is just not offered, and every local feature plus the copy-based floor (export-and-email a snapshot) still works. This is the same floor-and-convenience layering the proposal already commits to (CROSS_BOUNDARY_SHARING_PROPOSAL.md section 2), live collab is a convenience layer on top of the always-present local product, never a requirement.

---

## 9. Failure modes and hard parts

- Offline edits during a session. Yjs is offline-tolerant by construction, a client that drops keeps editing its local Y.Doc and re-syncs on reconnect, the CRDT merges the divergence. The only real work is the catch-up protocol (section 4a), the reconnecting client needs the encrypted snapshot plus the update tail it missed. For the MVP this can be "if you were disconnected long enough that the tail was compacted away, you re-fetch the latest snapshot."
- A collaborator who never retires. Retire materializes to every connected client, but someone who is offline at retire never gets the local write. Options to design, hold the encrypted snapshot in the relay (the store-and-forward mailbox) addressed to that collaborator so they materialize it on next open, or block retire until all invitees have a copy (bad, one absent person freezes everyone), or retire for the present collaborators and hand the absent one a copy-based send. The relay-the-final-snapshot option is cleanest and reuses the shipped mailbox, recommended, flagged for Grant.
- Conflict on retire if two people edited an attachment. Yjs merges text, but binary attachments (an image, a PDF) are not text-CRDT-mergeable. If two collaborators replaced the same attachment, retire faces a genuine conflict the CRDT cannot resolve. The MVP sidesteps this by being text-only (attachments are out of MVP scope, section 10). Beyond MVP, the honest model is last-writer-wins-with-a-kept-copy, the losing version is materialized alongside as a conflict copy rather than silently dropped, the same "never lose data" instinct the rest of the arc has. Flagged for Grant.
- Session expiry. A session left open forever is a cost and a stale-state hazard. An idle TTL (no edits and no connected clients for N hours) auto-retires the session, materializing to whoever is reachable and relaying snapshots to the rest. The DO hibernates while idle (section 3.1) so an idle session is nearly free until the TTL fires.
- Abuse. The socket is authenticated to a real identity (section 5), so there are no anonymous sessions, which is the Firefox Send lesson the proposal already internalized (CROSS_BOUNDARY_SHARING_PROPOSAL.md section 7). Per-user caps on concurrent live sessions and on session size bound the blast radius. Because the hub is blind in the recommended design, abuse handling acts on the account, not the content, exactly as the relay's abuse model does. The same abuse-report endpoint covers it.
- The blind-server cannot validate structure. In 4a the hub cannot enforce a schema on ciphertext, so a malicious authenticated collaborator could inject a malformed update. Mitigated by invite-only identity-bound participation and client-side validation on apply. Documented as a known limitation, the same class of limitation the proposal already documents for the blind relay.

---

## 10. Resource model and cost

Collaborate mode spends the same per-user storage budget the async inbox uses, one budget, two uses (CROSS_BOUNDARY_SHARING_ROADMAP.md). Live text is cheap, attachments are the cost.

The numbers, verified against Cloudflare's published pricing ([Cloudflare DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)).

- Free tier is generous for a beta. The Workers free plan includes Durable Objects with 100,000 requests per day, 13,000 GB-seconds of duration per day, and 5 GB of (SQLite) storage, with 5 million rows read and 100,000 rows written per day ([Cloudflare DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)). For a small number of concurrent two-person text sessions this is comfortably inside the free tier.
- WebSocket billing is cheap by design. Incoming WebSocket messages bill at a 20:1 ratio, 100 incoming messages count as 5 requests, and outgoing messages and protocol pings are free ([Cloudflare DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Cloudflare, Use WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)). So even chatty keystroke-level editing is a fraction of nominal request cost.
- Hibernation removes the idle-duration cost. With the WebSocket Hibernation API, a DO evicts from memory while clients stay connected and duration does not bill while hibernating ([Cloudflare DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)). Research editing is bursty with long idle gaps, so this is the dominant saving.
- Paid overage, for scale context. Beyond the included allowances the paid plan is 0.15 USD per million requests, 12.50 USD per million GB-seconds of duration, and storage at 0.20 USD per GB-month, with SQLite-backed DO storage billing beginning January 2026 ([Cloudflare DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)). Live text documents are kilobytes, so the storage line is negligible until attachments enter the picture.
- The cost shape, confirmed. Live text is tiny and effectively free at beta scale, attachments are the real cost, exactly as the roadmap predicted, so the feature prices naturally against the same per-user budget. One caveat to design around, a naive plaintext-merge server (4b) that never hibernates can run up real duration cost, the y-sweet project hit exactly this ([y-sweet issue 203](https://github.com/jamsocket/y-sweet/issues/203)), which is another point in favor of the blind-relay design plus hibernation.

---

## 11. Phasing, prerequisites, open questions

### MVP

Two-person live note, text-only, E2E-blind relay.

- One artifact type (note), one `Y.Text`, `y-codemirror.next` `yCollab` binding into the existing CM6 editor.
- A minimal DO that authenticates the socket (signed token), fans encrypted Yjs updates to the one peer, and relays encrypted awareness for cursors.
- Per-doc key K generated by the initiator and wrapped to the one invited collaborator's X25519 key via the existing seal.
- Retire-to-local through `note-transfer.ts` / the existing import path, with external-copy provenance, then DO teardown.
- No persistence yet (a two-person live session that does not drop barely needs catch-up), and no attachments. If a client drops, it re-fetches by having the still-connected peer re-broadcast current state.

### Expansion, in rough order

1. Blind snapshot plus compaction (secsync-style) for late-join and reconnect catch-up.
2. N-person sessions (more wrapped keys, awareness for many cursors).
3. Markdown methods (same text core).
4. Relay-the-final-snapshot for the offline-at-retire collaborator.
5. Attachments, with the conflict-copy model (section 9).
6. Structured records (experiments, protocols) as the genuinely separate later design (section 6).

### Prerequisites

- The Yjs dependency family added (`yjs`, `y-codemirror.next`, a DO provider), pinned to the stable v13 line, all MIT.
- Identity and the directory shipped (this depends on the same X25519/Ed25519 keys the relay uses).
- A Cloudflare Worker plus DO deploy target, alongside the existing R2 relay.
- The CM6 note editor stable (it is, today), and ideally the version-control work landed since retire interacts with versioning.

### Open questions for Grant

- The E2E fork. 4a (E2E-blind) is recommended, pending your sign-off. 4b (server-side merge) is the simpler fallback but the hub sees plaintext during the session. This is the one decision that should be made before any code.
- Who can retire a session, owner only, or any collaborator? Affects the retire UX and the offline-collaborator handling.
- The offline-at-retire collaborator, relay-the-final-snapshot through the existing mailbox (recommended), or hand them a copy-based send? Either reuses shipped machinery.
- Attachment conflict policy at retire, last-writer-wins-with-a-kept-conflict-copy (recommended) or block. Only matters once attachments are in scope.
- Session size and concurrency caps per user, what bounds fit the free-for-everyone funding model.

---

## 12. Sources

Yjs and CodeMirror binding. [yjs/yjs npm](https://www.npmjs.com/package/yjs), [y-codemirror.next README](https://github.com/yjs/y-codemirror.next), [Yjs docs, CodeMirror binding](https://docs.yjs.dev/ecosystem/editor-bindings/codemirror).

Yjs on Cloudflare Durable Objects. [napolab/y-durableobjects](https://github.com/napolab/y-durableobjects), [TimoWilhelm/yjs-cf-ws-provider](https://github.com/TimoWilhelm/yjs-cf-ws-provider), [y-sweet runtime cost issue](https://github.com/jamsocket/y-sweet/issues/203).

End-to-end encrypted CRDTs. [serenity-kit/secsync](https://github.com/serenity-kit/secsync), [Yjs community, implementing E2E encryption](https://discuss.yjs.dev/t/implementing-end-to-end-encryption/308), [Yjs community, E2E with schema validation](https://discuss.yjs.dev/t/end-to-end-encryption-with-schema-validation/2263), [Yjs community, DeepNotes E2E note-taking](https://discuss.yjs.dev/t/deepnotes-end-to-end-encrypted-visual-note-taking-with-yjs/1787).

Cloudflare Durable Objects, capability and cost. [Cloudflare Durable Objects overview](https://developers.cloudflare.com/durable-objects/), [Cloudflare, Use WebSockets and Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [Cloudflare Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

Grounding in the existing design (in-repo). CROSS_BOUNDARY_SHARING_PROPOSAL.md, CROSS_BOUNDARY_SHARING_ROADMAP.md, CROSS_BOUNDARY_SHARING_IDENTITY_INTERACTION.md, CROSS_BOUNDARY_SHARING_INVITE.md, and the implementation surfaces `frontend/src/lib/sharing/encryption.ts`, `frontend/src/lib/sharing/identity/`, `frontend/src/lib/sharing/relay/auth.ts`, `frontend/src/lib/sharing/note-transfer.ts`, `frontend/src/lib/sharing/experiment-transfer.ts`, and the CodeMirror 6 editor `frontend/src/components/InlineMarkdownEditor.tsx`.
