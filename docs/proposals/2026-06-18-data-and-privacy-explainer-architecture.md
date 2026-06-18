# Data, privacy, and cost: the architecture behind the explainer series

Date 2026-06-18. Owner: orchestrator. Status: VERIFIED audit + storyboard, ready to build graphics. This is the source of truth for the animated explainers. Every claim below is evidence-backed from a website-wide code/doc audit (4 parallel agents). The goal Grant set: de-mystify how the business actually works so academic customers trust us and understand why we made the cost-and-privacy design choices we did.

House style applies to all copy: no em-dashes, no mid-sentence colons, no emojis, custom SVG only, light-default.

The hard rule for this whole series: we teach the TRUTH, including the uncomfortable parts. Overclaiming privacy is the fastest way to lose a skeptical PI. Where a server can read something, we say so, and we explain why that choice is still good for them.

---

## Part A. The verified architecture (what is actually true)

### A1. Where data lives, and who can read it

| Thing | Where it lives | Can our server read it? | Status |
|---|---|---|---|
| Your research folder (notes, experiments, methods, tables, files) | Your own disk (File System Access API), or your own cloud drive if you put it there | No, never reaches us | Live, core design |
| A one-time send to another researcher | Sealed on your device, relayed as ciphertext, deleted on pickup | No, true end-to-end (X25519 sealed box) | Live |
| A live co-edited document | The one shared doc syncs to the relay (Cloudflare Durable Object), which merges and saves it | YES, the relay holds it in readable form to merge and compact it. Encrypted in transit and at rest, but NOT end-to-end | Live |
| Lab-tier shared storage (sealed under a lab key) | R2, as ciphertext the relay cannot decrypt | No, server-blind by design | Built but DORMANT, flag off, not wired |
| An AI question to BeakerBot | Your message plus whatever a tool reads to answer it, sent through our server to the AI provider | YES, the provider receives the specific content the AI reads | Live |
| Your directory profile (name, affiliation, ORCID, public keys) | Neon Postgres, readable, powers researcher search | YES, by design (it is public-facing) | Live behind flag |
| Your email | Stored only as a secret-keyed hash, never plaintext | No | Live |
| Your private key | Only as a blob encrypted on your device with your recovery code | No, we cannot decrypt it | Live |

The single most important honesty point: one-time sends are end-to-end encrypted, live collaboration is not. The relay reads the shared doc so it can converge offline edits and compact the history (the deliberate "Option B" decision, `relay/src/worker.ts:20`). We must never imply live collab is end-to-end. The strong, true version is "encrypted in transit and at rest, and only the one document you are co-editing ever syncs."

### A2. The two kinds of cloud storage (the hot/cold story Grant flagged)

This is real and built. It is a price difference of roughly 13x.

| Tier | Store | Speed | Cost to us | What it holds |
|---|---|---|---|---|
| HOT | Durable Object SQLite (one per live doc) | Fast, always-on working memory | about $0.20 per GB-month | The canonical live copy of a document being co-edited right now |
| COLD | Cloudflare R2 object storage | Durable shelf, fetched on demand | about $0.015 per GB-month | Backups of collab snapshots (every 5 min), lab data ciphertext (dormant), transient phone captures |
| LOCAL | Your own disk | Instant | $0 to us | Everything else, which is almost everything |

Evidence: `lib/sharing/capacity-shared.ts:65` (`do: 0.2`, `r2: 0.015`), `relay/wrangler.toml` bucket bindings, `relay/src/worker.ts:51` (5-minute backup cadence).

Accuracy trap, do not animate this wrong: we do NOT yet use an R2 Infrequent-Access or archival storage class. Today's "cold" tier is plain R2 Standard. A true archival tier is only proposed (`docs/proposals/LAB_ARCHIVE_CONTINUITY.md:173`). So we can teach "hot live store vs cheap durable store vs your free local disk," but not "we auto-move old data to a frozen archive" yet.

The teaching payoff: live collaboration is expensive because it needs the hot store running per document. Everything that can be cheap or free (your folder, backups) is. That is why live collab is the thing a paid plan pays for, and nearly everything else is free.

### A3. The cost and business model (Model A, the canonical one)

Ignore the legacy GB-ladder plans in `plans.ts`, they are dead. The live model is in `lib/billing/model-a/pricing.ts` and `docs/branding/PRICING.md`.

| Plan | Price | Usage markup | Who pays |
|---|---|---|---|
| Free | $0 | none (receive-only, no cloud produce) | nobody |
| Solo | $3 per month | 5x cost | the individual |
| Lab | $40 per month per lab | 7x cost | the PI or payer only, pooled across members |
| Department | $35 per month per lab | 6x cost | the institution |

- Storage is sold a-la-carte at about 1.15x our cost, which is pass-through, never a profit center (`service-model.ts:263`).
- AI is marked up 1.4x for individuals and 2.0x for orgs over a bare basis, and is "deliberately not the money-maker" (`PRICING.md:60`). Our measured real AI cost is about $0.153 per million tokens.
- Every new account gets a one-time starter grant of about 1.63 million AI tokens, which costs us exactly $0.25 (`ai-config.ts:76`).
- We only charge a card when the accrued balance crosses about $5, to avoid paying Stripe's per-charge fee on tiny amounts (`PRICING.md:70`).
- Our fixed monthly cost is about $262 (`PRICING.md:87`).

The "why," in the codebase's own words:
- "Free users get NO cloud produce feature, so they generate about 0 recurring cost ... that is the whole no-free-cloud-feature equals sustainable insight" (`service-model.ts:336`).
- "A paid tier's cost is dominated by relay activity, not storage" (`service-model.ts:11`).
- "We do not profit from holding your data, that is the trust play" (`PRICING.md:26`).

### A4. The guardrail (the cost circuit breaker)

There is a real brake. When estimated variable cost crosses a budget, the breaker trips and pauses cloud WRITES only, requires a manual operator reset so spending never silently resumes, and never touches your local data (`lib/billing/breaker.ts:14`). When paused, live edits still flow between peers and stay in your local copy, they just are not persisted to the cloud until it resumes (`relay/src/worker.ts`, `SYNC_BLOCKED "paused"`). This is a genuine trust story worth teaching: we built a spending brake that fails toward "your work is safe."

### A4b. Redundancy through your institution's existing cloud, and where version history lives

Two related facts, both verified, that turn local-first from a perceived risk ("what if I lose my laptop") into a strength.

1. Put your folder on the cloud your university already pays for. Most institutions already have a contract for Google Drive, OneDrive, or Box. Because a ResearchOS folder is just plain files, you can keep it inside that institutional sync drive, which gives you a second, automatic copy of your raw data at no extra cost to you or to us. The whole lab can even work out of the same synced folder. The history engine was built for exactly this, the on-disk format is deliberately "OneDrive-sync-friendly" with atomic writes so a sync mid-write can never corrupt it (`lib/history/storage.ts:1,57`).

2. Version history is stored in your folder, not on our servers. ResearchOS has built-in version control, and the history is written to `users/<owner>/_history/<type>/<id>.jsonl` inside your own folder through the local file service (`lib/history/storage.ts:23-28`). So your edit history is yours, it works offline, and if your folder is on the institutional cloud drive then your history is backed up right along with it. None of it is on a ResearchOS server.

The teaching payoff: the recommended setup is local folder plus your institution's existing cloud for redundancy. You get durability from infrastructure the university already bought, your version history is included in that backup because it is just files in the folder, and ResearchOS still never holds your data. This is the answer to "isn't local-first risky," and it costs us nothing, which is part of why the model stays cheap.

### A4d. The three sharing modes (internal lab, external live, external one-time)

There are three modes, not two. The product names the outside ones under "Outside your lab" (wiki `sharing-and-permissions/page.tsx:277`).

1. Inside your lab, live. Live co-editing among lab members. Only the shared document syncs, each member's files stay local, encrypted in transit and at rest, the relay merges everyone's edits so it is NOT end-to-end. Ongoing, with audit-logged PI oversight. Lab tier.
2. Outside your lab, live. Live co-editing with a ResearchOS user who is not in your folder or lab. This IS built (the full grant, invite, accept, materialize, live-sync, revoke, block arc in `lib/collab/client/external-grant.ts`, `accept.ts`, `inbox.ts`), notes-only, and it ships dormant behind `NEXT_PUBLIC_EXTERNAL_COLLAB_ENABLED`. On accept the recipient gets a real local copy in their own folder that then stays in sync. Same engine as in-lab, so it is also encrypted in transit and at rest, relay-merged, NOT end-to-end. Should be a paid feature.
3. Outside your lab, one-time. A one-time send to any ResearchOS user. It is a COPY, not a live link (`lib/sharing/calculator-transfer.ts:17`), end-to-end encrypted so the relay holds only ciphertext, lands in the recipient's own folder, deleted on pickup. Free to RECEIVE, paid to SEND (decision below).

The unifying rule (Grant 2026-06-18): receiving anything is always free, and every outbound action (sending a copy, hosting external live collab, in-lab co-editing) is paid. The honest crypto insight: only the one-time copy is end-to-end encrypted. Any live co-editing, inside your lab or outside it, is encrypted in transit and at rest but merged by our server, because a live shared document needs the server to read it and a one-time handoff does not.

GAPS TO CLOSE, both verified against current code and decided with Grant 2026-06-18:
- External live collab host gate: BUILT on branch `feat/external-collab-paid-gate` (commit f23b7cf0b), not merged, no flag flipped. Free accounts can no longer host/initiate external live collab, they get an upsell ("Collaborate live is a paid feature") with no soft-lock. Hosting now requires a paid plan (Solo and up), enforced via `isProduceEntitled` both server-side (new `GET /api/collab/external-entitlement`) and in `grantExternalCollab`. So mode 2 is genuinely enforced as paid now, not just flag-gated.
- One-time copy SEND gate: BUILT on branch `feat/gate-send-outside-paid`, not merged, no flag flipped. Decision (Grant 2026-06-18): SENDING is paid (Solo and up), free is RECEIVE-only. Enforced with the SAME server signal the live-collab gate uses, `isProduceEntitled` (so a free member of a paid lab still sends, the PI covers them). Server, the produce gate already lived on `POST /api/relay/send`; this build adds the matching gate to `POST /api/relay/invite/send` (the keyless invite-a-non-user path, previously open), both return `402 {reason: "send-is-paid"}`. Client, a new shared hook `useProduceEntitlement` (reads `GET /api/billing/model-a/status`) drives a new `SendOutsideGate` wrapper that shows an escapable upsell ("Sending shares this beyond your folder", links to `/pricing#plans`) instead of the send form for a free account. Gated surfaces, all the send-outside dialogs (note, project, experiment, sequence, bulk sequence, method, calculator) plus the `/network` `RecipientShareDialog`; the find-and-share modal is covered transitively (it only mounts inside a gated send form). RECEIVING and ACCEPTING are untouched and stay free. The whole gate is DORMANT until billing is live (`NEXT_PUBLIC_BILLING_LIVE` on the client, `isBillingEnabled()` on the server), so the beta is byte-for-byte unchanged. Copy rewritten to receive-first, wiki accounts page (bullet + comparison table now splits Receive vs Send), `WhatsNewModal`, `AccountBenefitsUpsell`. Both gates share `isProduceEntitled`; consolidating the sibling branch onto `useProduceEntitlement` is a later cleanup.

### A4c. How lab-head search works (the hybrid mirror index)

A lab head can search the whole lab without bulk-copying everyone's data, by a deliberate cache-small-files, request-big-files design (`docs/proposals/2026-06-17-hybrid-lab-mirror-index.md`, code in `lib/lab/lab-index.ts`, `lib/lab/lab-index-search.ts`, `components/lab/LabWideSearch.tsx`).

- The small file (always cached): each member's sync run writes one compact, lab-key-encrypted index file holding a lightweight entry per record (type, id, owner, title, updatedAt, tags, size, and a roughly 200-character preview), plus an "eager" flag. The lab head's search reads only these tiny per-member index files, so search is instant and complete across the lab without pulling a single content blob (`lib/lab/lab-index.ts:1`).
- The big file (on request only): records above 256 KB (`HEAVY_CONTENT_THRESHOLD_BYTES`), such as large data tables and big sequences, are NOT pushed to the mirror. The lab head sees that they exist (title plus preview) but must request them, the owning member approves, and only then does the full content upload. The request is visible to the member, there is no silent decline, and every lab-head read is audit-logged to the member's own log (`lib/lab/lab-scoped-read.ts:1`).
- Who can do this: search is role-gated to the lab-head role (`lib/lab/lab-index-search.ts:86`), and the index files are server-blind ciphertext sealed under the lab key, so the relay never reads them.

The cost-and-privacy tie-in, which is the teaching point: searching the lab means reading N tiny encrypted indexes, not downloading everyone's data, so it is cheap and fast, the heavy data stays with its owner until they choose to share it, and the relay only ever holds encrypted copies.

Build status: Phases A, B, and C are built and wired into the lab-wide search UI, but the whole lab tier ships dark behind the lab-tier flag, so this is real in code yet not yet live for users.

### A5. Domains and hosting (the separate-domain story)

| Domain | Purpose | Status |
|---|---|---|
| research-os.app (hyphenated) | THE canonical home: the app, marketing, and `research-os.app/<lab-slug>` public lab and paper companion pages | Live (lab pages built, flag off) |
| research-os.com (the .com) | An isolated sandbox origin for a lab's OWN uploaded static site, at `<lab-slug>.research-os.com`, deliberately cookie-isolated from the app so untrusted lab code cannot touch app sessions | Spec'd, partly built, inert (needs wildcard DNS) |
| researchos.app (NO hyphen) | NOT OURS. A third party's abandoned prototype. Watched for a possible drop around early 2027 | Not owned |

Two things the animation must get right:
1. Always use the hyphenated research-os.app. The hyphen-less researchos.app currently points at someone else's product. (Note: our own marketing pages `labs/page.tsx` and `departments/page.tsx` print the hyphen-less typo. That is a separate cleanup, flagged.)
2. Public lab sites and paper companion pages are CLOUD-hosted, server-rendered content backed by Neon and R2, NOT your local-first folder. This is the one place where "ResearchOS shows a web page" and it is correct that it is in the cloud. We must not blur this with the local-first workspace. The clean framing: your private workspace is local, and when you choose to PUBLISH a page or dataset to the world, that published copy is hosted in the cloud on purpose, because a public URL has to be.

Hosting stack: the app and lab pages run on Vercel (Next.js), relational data is Neon Postgres, object and asset storage is Cloudflare R2, and the collaboration relay is Cloudflare Workers and Durable Objects.

### A5b. A lab's own web home, three ways to build it, and paper companion pages

A paid lab gets its own public web home at research-os.app/<lab-slug>, with a custom domain as a later add-on. The headline use is a companion page for a paper: a citable landing page that can carry the paper's figures and a live, interactive dataset viewer, frozen on publish so the link never changes under a reader.

There are three ways a lab can build that site, so it fits any comfort level:
1. The built-in no-code builder. Write and lay out pages inside ResearchOS, no code, the "just give me a site" path. This is the recommended default for most labs.
2. Connect a GitHub repo. A lab that already keeps a static site in a public repo can point ResearchOS at it.
3. Upload a custom HTML site. A lab with a hand-built site can upload it directly.

Options 2 and 3 (bring-your-own) are served from the isolated <lab-slug>.research-os.com sandbox origin so untrusted lab code can never touch app sessions.

BUILD STATUS, important for messaging: this whole layer ships dark behind the lab-sites flag. The built-in authoring today is markdown pages plus baked-on-publish figure and dataset snapshots (`app/account/lab-site/page.tsx:17`), and the richer visual block editor is a later phase, so the "no-code builder" is real in direction but not yet the full drag-and-drop experience the word "builder" implies. The GitHub and HTML upload paths are built but inert (need the research-os.com wildcard DNS), and custom domains are spec'd, not built.

MESSAGING DECISION (Grant 2026-06-18): present lab sites and the builder as "coming with lab sites," not "available now," until the block editor and the research-os.com DNS land. So the builder and lab-site graphics are forward-looking showcases, and any walkthrough or wiki copy should frame them as upcoming, not live. Reversible once the pieces ship.

---

## Part B. The honest one-line claims we can make

These are the vetted sentences. Use these, do not improvise stronger ones.

- Folder: "Your research lives in a folder on your own computer. It never uploads, and there is no ResearchOS server holding it."
- Send: "When you send something to another researcher, it is end-to-end encrypted on your device, so our relay only ever holds unreadable ciphertext and only they can open it."
- Collab: "When you co-edit live, only that one shared document syncs. It is encrypted in transit and at rest, and our relay holds it in readable form so it can merge everyone's edits. Your folder never syncs."
- AI: "BeakerBot runs on your machine, but when you ask it to work with your data, the specific note or table it reads to answer is sent to our AI provider over our server. Our model key never reaches your browser, and the provider's default is no retention and no training on your data."
- Lab sealed storage (only once live): "Lab shared storage is sealed under a key our servers never hold." Until then, do not teach it.
- Directory: "We store your name, affiliation, ORCID, and public keys to power researcher search. Your email is stored only as a hash, and your private key only as a blob we cannot decrypt."
- Cost: "Because we do not store everyone's research, we have almost nothing to charge free users and nothing to lose or sell. Paid plans pay mainly for live collaboration, which is the only part that runs a real per-use cost."

---

## Part C. The animation storyboard (refined, one idea per graphic)

Built with the Claude designer first for review, then ported to house-style mockups. Each graphic teaches exactly one idea, with an honest claim and meaningful motion.

1. The big picture. Your laptop holds the whole folder, a thin path reaches the cloud only when you ask. Motion: a single parcel travels up the thin path while the folder pulses "at home." (Draft already built.)

2. The three travelers, honestly labeled. Send (true end-to-end), live co-edit (encrypted in transit and at rest, relay reads it), ask AI (your question plus what it reads). Three lanes, each with an accurate lock-state badge. This is where we earn trust by NOT overclaiming.

3. Collaborate, up close. Two laptops, one shared document syncing live through a relay node that visibly merges both edits, while the rest of each folder stays greyed and local. Caption makes the "relay reads only this one doc, to merge it" point.

4. The AI question, up close. BeakerBot on your machine reads one table, that one table travels through our server to the provider and the answer returns. The key stays server-side (a small "key never leaves our server" marker). Everything else in the folder stays put.

5. Hot vs cold vs local storage. Three shelves: a fast glowing HOT shelf (live doc, costs the most), a cheap COLD shelf (backups and published assets), and your FREE local disk (the biggest by far). Show the roughly 13x price gap as relative size or a small price tag. This is the founder's "fast access costs more, long-term storage costs less" idea made visible.

6. Why it is cheap and sustainable. A simple flow: free users cost about zero because their data is local, paid plans pay mainly for the hot live-collab store and AI, storage is sold at cost. End on "we do not make money holding your data."

7. The spending brake. A budget gauge filling, then a brake engaging that pauses cloud writes while your local work keeps going untouched. Teaches that we engineered against runaway cost and that your data is never the casualty.

8. Domains, the published layer. Your private workspace (local) on one side, and when you choose to publish, a research-os.app/your-lab page and an optional dataset viewer rendered from the cloud on the other. Makes the local-vs-published boundary explicit and correct.

Sequencing for the walkthrough or a wiki page: 1 sets the model, 2 names the three cloud touches, 3 and 4 go deep on the two that worry people most, 5 and 6 explain the money, 7 shows the safety net, 8 handles the one legitimately-cloud surface. Any subset can stand alone.

---

## Part D. Open items and flags

- Marketing typo: `labs/page.tsx` and `departments/page.tsx` print the hyphen-less researchos.app, which is a third party's live domain. Separable fix, flagged for a follow-up task.
- AI provider retention: we can say "default zero-retention, no training" attributed to the provider, but must NOT claim HIPAA, a BAA, or independent audit (`docs/research/ai-assistant/00-hosting-and-compliance.md:66`).
- Lab sealed storage and BYO lab sites are dormant. Teach them only as "designed for" or hold until live.
- Confirm with Grant how much of the cost model (actual prices) to show customers vs keep directional. The prices are real and public-facing per PRICING.md, but the markups and our internal costs may be more than we want on a customer-facing animation.
