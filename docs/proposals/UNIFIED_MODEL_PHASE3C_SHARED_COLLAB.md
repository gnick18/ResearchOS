# Unified Data Model, Phase 3c design (shared documents are collaborative)

Status, DRAFT for Grant sign-off (2026-06-05). Supersedes the mailbox-invite draft (`UNIFIED_MODEL_PHASE3C_INVITE.md`). This is the design for the real collaboration experience, replacing the manual incognito paste-link used to validate the engine. Chunks 1 through 5b are built and live-validated (two clients edit one note through the relay, with cursors, crash-safe undo, session grouping, retire-to-local, and auto-save).

## 0. The reframe

There is no "invite." Sharing a document IS granting collaboration. A doc already knows who it is shared with, so collab is not an action you trigger, it is a property of a shared doc that activates automatically when someone opens it. Open a shared doc and the cloud connection turns on in the background; if another collaborator has it open, you see their cursor. The Google Docs feel, with no link to copy and send.

## 1. Privacy stance (signed off 2026-06-05, this reverses the locked E2E-blind collab decision)

- Persistence is OPTION B, server-canonical. The server stores a readable copy of SHARED documents, encrypted at rest (a "safe copy") but readable by the server by design. This is NOT end-to-end encrypted. It is chosen so the server can later offer content-aware features over shared content (lab-wide search, AI over a shared project) that an E2E design forbids.
- HARD RULE, private and unshared notes are NEVER sent to the server. They live only in the user's folder. The server only ever holds documents the user explicitly shared.
- "Own your data" is intact. The user's local folder remains a full, exportable copy (no lock-in, AGPL). The server copy exists to power collaboration, it is not a silo.
- The claim that narrows, "we cannot read your data" becomes "your private notes are local-only and unreadable by us; shared docs sync to our server so live editing and search work." Honest and still strong.
- TRANSPARENT CONSENT, the moment a user shares a doc, the UI tells them plainly that a copy will be stored on the server. Sharing is opt-in, so this is the user's call.

## 2. The two surfaces

### 2a. Internal lab (build first)

The lab already has accounts, a shared notebook, and per-doc sharing (`Note.shared_with`, the shared-notebook surface, lab mode). Membership and identities exist. So for an internal shared doc:
- Opening it auto-derives the collab session from the doc plus its shared-with set and connects in the background.
- Co-present collaborators see each other's cursors.
- No invite, no accept step, the sharing grant already answered "who can edit."

This is the easiest, highest-value case and where we start.

### 2b. External (ResearchOS users outside your folder, design now build second)

To collaborate with a ResearchOS user who is not already in your lab:
- A ResearchOS-user SEARCH page (find a person by name or email or affiliation, using the existing directory).
- Granting them access to a doc (a persistent share grant, not a one-shot copy).
- After the grant, the SAME auto-on-open behavior applies for both sides. Still seamless, no link to send.

The directory exists under the hood; the search UI and the persistent-grant model are the new parts.

## 3. Architecture, the stateful collab backend

The relay stops being a blind ephemeral pipe and becomes a stateful collaboration backend (still a Cloudflare Durable Object, which can persist via its own SQLite, or a backing store).

- The server holds the canonical Loro document per shared note. It applies incoming updates (merges), persists the result encrypted at rest, fans updates to connected collaborators, and serves a snapshot to anyone who opens the doc.
- Access is enforced server-side from the share grant plus auth (the directory identity), not from key distribution.
- The user's local folder keeps a synced copy. On open, the client reconciles its local copy against the server's canonical copy.

### Relationship to what we built

- The live engine (the DO fan-out, the provider, the cursor and version-grouping and retire and auto-save work) is reused.
- The E2E envelope (chunk 2) and the encrypted relay-provider sealing (chunk 3) become OPTIONAL for shared docs, since the server stores plaintext anyway; transport security is TLS. We keep them for now (harmless) and can simplify later, or retain them as defense-in-depth for transit.
- The relay gains state, it persists the doc and serves snapshots, rather than holding nothing.

## 4. Offline and reconnect

Because the server holds the canonical copy, offline is simple. When a collaborator opens a shared doc (alone or after being offline), the client pulls the server's current snapshot and reconciles its local copy, then resumes live sync. No "last peer online" dependency, the server is always the source of truth for shared docs.

## 5. Consent and transparency UX

- On the FIRST share of a doc (or first enabling collaboration on it), a clear one-time notice, "Sharing stores a copy of this document on the ResearchOS server so collaborators can edit it live. Your private notes are never uploaded." Proceed or cancel.
- A persistent, quiet indicator on shared docs that they are synced to the server (distinct from private local-only notes), so the user always knows which docs left their device.
- Settings visibility into what is shared (and therefore stored), with the ability to stop sharing (which removes the server copy).

## 6. Required copy and design-doc updates (the E2E reversal)

Because this reverses a locked decision, these must be updated so marketing and architecture match (flag for the compliance and landing chat):
- The locked E2E-blind relay design doc (note the collab persistence is now server-canonical, not E2E).
- Any landing or wiki copy that promises shared data is unreadable by us. Reword to "private notes are local-only; shared docs sync to our server."
- The NIH-compliance and own-your-data messaging stays (local folder, export, no lock-in), but the "we cannot see your data" line is scoped to private notes.

## 7. Build chunks (in dependency order)

1. The stateful collab backend, the DO persists the canonical Loro doc, merges incoming updates, serves a snapshot on connect, persists encrypted at rest. The hardest infra piece.
2. Auto-on-open for internal shared docs, on opening a doc with a non-empty shared-with set, connect to its session automatically and reconcile against the server snapshot.
3. Consent + the shared-vs-private indicator, the one-time notice and the persistent synced indicator.
4. External user search + persistent grant, the directory-backed search page and the grant model, then the same auto-on-open.
5. Copy and design-doc updates (section 6).

## 8. Decisions (locked 2026-06-05)

1. Backend substrate, a SEPARATE database (Neon Postgres via the Vercel Marketplace), not the DO's SQLite. Chosen because it is the natural home for the lab-wide search and AI-over-shared-content features that motivated Option B. This splits the architecture (section 3a).
2. Internal session keying, mint and store a room id on the share grant (explicit, survives renames).
3. Stop-sharing, removing the last collaborator deletes the server copy and the doc reverts to local-only.
4. Rollout, auto-on-open applies to ALL shared docs (existing and new), gated by the one-time consent. Consistent mental model, shared means collaborative.

## 3a. Resulting architecture (live transport vs canonical persistence)

The separate-DB decision splits collab into two layers that already match the existing infra:
- LIVE TRANSPORT stays the Cloudflare Durable Object we built (the WebSocket fan-out + presence/cursors). It carries low-latency deltas between connected peers. It can stay light (it does not have to be the source of truth).
- CANONICAL PERSISTENCE is Neon Postgres, reached through Vercel API routes (the same shape as the existing sharing relay, which already uses Vercel routes plus R2). On open, a client pulls the canonical Loro doc (or its latest snapshot plus deltas) from Neon, reconciles its local copy, then joins the live DO room. On edit, deltas flow live through the DO AND are persisted to Neon (so an offline-returning or solo user always gets current state from Neon).
- Open build question, whether merge-on-write happens in a Vercel function (server applies the Loro update to the canonical doc in Neon) or the DO checkpoints to Neon periodically. To resolve in build chunk 1.
