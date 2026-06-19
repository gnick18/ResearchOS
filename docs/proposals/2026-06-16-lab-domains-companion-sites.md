# Lab vanity domains + publication companion sites (2026-06-16)

Lane: INJEST (social layer). Status: proposal / design. Not built.
Origin: Grant + his business partner/professor, 2026-06-16.

> SUPERSEDED on the URL form (2026-06-19, Grant): the locked decision is now that
> NO public lab surface shares the authed app's cookie origin. Every native lab
> companion site lives at the per-lab SUBDOMAIN `<labslug>.research-os.com` (the
> cookie-isolated public lab origin, same registrable domain as the untrusted BYO
> bundle, which is carved under `/_site/` on that subdomain). Old
> `research-os.app/<labslug>` links 301 to the subdomain. The "researchos.app/<labslug>"
> path form described below is the original draft and is retained for history only.
> See AGENTS.md (lab-sites .com lane) and `[[project_demo_lab_on_network]]`.

Every paying Lab gets a vanity URL `researchos.app/<labslug>` and can publish
website pages under it (nested paths) — companion sites for papers, lab sites, or
anything else. The killer use case: turn a paper's supplemental dataset (e.g. a
big transcriptomics matrix) into a live interactive viewer at a citable URL,
instead of a dead table in a PDF.

## Why this wins (the moat)

"Labs get a domain" is commodity. The moat is that ResearchOS ALREADY has the
interactive pieces — Data Hub's large-table engine (DuckDB-WASM, 100k+ rows),
Figure Composer, Phylo Tree Studio, the plot artboard. The microsite is just the
publishing wrapper that turns "the interactive figure you already built in your
notebook" into a citable public page in one click. That notebook -> published
companion site path is what competitors can't copy. It reframes ResearchOS from
"a notebook" into "where your science lives AND gets published."

## Decisions locked (Grant, 2026-06-16)

1. URL shape: clean `researchos.app/<labslug>`; custom domains (lab.edu CNAME) a
   later premium add. Slugs are UNIQUE, first-come-first-serve, claimed at lab
   account creation (head enters name -> lab name -> desired slug). If taken,
   AUTO-SUGGEST institution-qualified alternatives (we already know their
   institution before asking), e.g. `smithlab` taken -> `smithlab-wisc`,
   `smithlab-uwmadison`.
2. Permanence on lapse: published website PAGES stay live read-only FOREVER
   (citation safety; near-zero fixed cost for us — static HTML/JSON on CDN). The
   hosted DATA ASSETS on R2 are reclaimed 30 days after lapse, with a big
   warning. Optional one-time "permanently archive this dataset" pre-pay for paper
   supplements.
3. Data-hosting cost: 100% pass-through, NO margin/upcharge. The lab pays the
   Cloudflare/R2 data cost at cost; we bill it through the Billing lane's metered
   storage, not beside it.

## URL namespace + slug registry (this lane)

- ONE unified slug namespace shared across labs (`/<labslug>`), handles
  (`/u/<handle>`), and institutions (`/institution/<domain>`), plus a reserved-word
  list for system routes (`/network`, `/ai`, `/library`, `/datahub`, etc.). A
  single registry guarantees no collisions and powers uniqueness + auto-suggest.
- Auto-suggest uses the lab's known institution to qualify a taken slug.
- Custom domains (CNAME) deferred to a higher tier; Vercel supports it natively.

## The builder (this lane)

- Block-based page editor reusing the markdown-embed-hybrid + InlineMarkdownEditor.
  Blocks are LIVE ResearchOS visualizers: a Data Hub table, a Phylo tree, a
  Figure Composer panel, a plot, a dataset explorer, a text block, an external
  embed/link.
- "Build with BeakerBot" — AI-assisted page authoring (fits the assistant lane).
- External-link attach: a lab can point a page at / embed a site they built
  themselves (recommend hosted for permanence; external is best-effort).
- Publish flow: choose path under the lab slug, set visibility, "freeze &
  publish" produces a versioned, stable, citable permalink; optionally link the
  page to a paper DOI.

## Data hosting + cost model

- Datasets live on R2 (already wired). The published viewer streams + renders
  client-side via the DuckDB large-table lane — no new infra for big supplements.
- Metered per-lab storage on a SEPARATE owner-keyed byte line
  (`lab_hosted_assets`), distinct from the lab's private workspace pool
  (`collab_doc_sizes`). It REUSES the existing collab tally mechanism
  (`getOwnerUsage` / `getLabPoolUsage` in `lib/collab/server/db.ts`, keyed by the
  owner-key hash from `lib/billing/owner.ts`). This lane reports bytes on that
  line; Billing bills them at COST RECOVERY (~1.15x raw R2 = R2 cost + payment-
  processing recovery, zero profit). The prepaid "permanent archive" SKU runs
  near-raw cost. (Grant + Billing locked 2026-06-16.)
- On lapse: 30-day warning -> R2 assets GC'd by this lane on Billing's reclaim
  signal; the website shell stays live read-only. Optional pre-pay to permanently
  archive a supplement dataset.
- Honest tension: when assets are reclaimed, a paper-cited interactive viewer
  goes data-less (page stays, interactive part stops). The pre-pay-archive option
  + the standing incentive to keep paying (your cited data lives there) mitigate
  this; surface a clear "dataset archived" state rather than a broken viewer.

## Permanence / citation

- Frozen-on-publish: a published page snapshots to a stable, versioned permalink
  so a URL printed in a paper never changes under the reader.
- Read-only forever even on lapse (pages). Version history; "cite this page"
  affordance.
- STATIC-FALLBACK SNAPSHOT on publish (surfaced while mocking the edge states):
  freeze-on-publish must snapshot a rendered static image of each interactive
  block. So when a dataset is reclaimed post-lapse, the page degrades to
  text + static figures + citation (graceful "dataset archived" notice on the
  interactive block), never a blank page. This is what makes the citation-safety
  promise real.
- Custom-domain cutover keeps a 301 redirect from `research-os.app/<slug>` to the
  custom domain, so any URL already printed in a paper never breaks.

## Tier / entitlement + Billing boundary

- Billing OWNS: the publish entitlement gate (wraps `getSubscription(ownerKey)`
  from `lib/billing/db.ts` as `isLabPublishEntitled(labOwnerKey)` = status active +
  lab tier), site/page allowances, the metered cost-recovery data-hosting line,
  the 30-day-grace reclaim signal (subscription status flip + lapse timestamp),
  and the prepaid permanent-archive SKU + its `archived` flag. Lab referenced by
  `lab_owner_key` (lib/billing/lab.ts).
- This lane checks `isLabPublishEntitled` before publish/edit, reports hosted-asset
  bytes, and GCs R2 assets on Billing's reclaim signal — SKIPPING any dataset with
  Billing's `archived` flag set.
- This lane OWNS: the unified slug registry, public rendering, the builder UX, and
  R2 asset GC on Billing's signal. No new lab identity — `lab_sites` references
  the billing lab by owner-key hash.

## Network integration

- The lab's home page (`/<labslug>`) is a public surface that joins `/network`:
  the lab profile lists its published companion sites; dept/institution pages
  (the wiki layer) list their labs -> lab pages -> companion sites. One discovery
  graph: institution -> dept -> lab -> companion site.

## Data model (this lane)

- `slug_registry` (slug PK, kind: lab|handle|institution|reserved, owner ref) —
  the single uniqueness/auto-suggest source of truth.
- `lab_sites` (lab_owner_key FK to billing lab, lab_slug, created_at).
- `lab_site_pages` (site, path, title, blocks_json, status: draft|published,
  version, frozen_snapshot_ref, paper_doi, updated_at).
- `lab_site_assets` (site, r2_key, bytes, status: live|reclaim_pending|archived) —
  metered + GC'd; bytes reported on the SEPARATE `lab_hosted_assets` owner-keyed
  line (reusing the collab tally mechanism), keyed by `lab_owner_key`. The
  `archived` status is driven by Billing's prepaid-archive flag.
- References Billing's lab by `lab_owner_key`; references ROR for the lab's
  institution. Never writes billing/entitlement state.

## Reuse (already in repo)

- Data Hub large-table engine (DuckDB-WASM) for big supplements.
- Phylo Tree Studio, Figure Composer, plot artboard, markdown-embed-hybrid for
  page blocks.
- R2 storage client (lib/sharing/relay/storage.ts pattern), ROR registry for
  institution anchoring, BeakerBot for AI-assisted authoring.

## Build plan (phased) — greenlit by Grant 2026-06-16

All phases flag-gated (`LAB_SITES_ENABLED` server / `NEXT_PUBLIC_LAB_SITES`
client), default OFF + byte-identical until launch. Each lands as its own
reviewable branch + handoff; merge when healthy.

1. **Slug registry (foundation)** — `slug_registry` table + pure
   `lib/social/slug-registry.ts` (normalize, reserved-words, availability,
   institution-aware auto-suggest, reserve/release). Seed existing @handles +
   institution slugs as reserved so uniqueness is global. Document the
   reserve-on-create contract for Popup's handle/institution flows. NO
   cross-lane dependency. [IN PROGRESS 2026-06-16]
2. **Static lab site + page rendering + entitlement gate** — `lab_sites` /
   `lab_site_pages`, public render, `isLabPublishEntitled` check (Billing wraps
   it). Text/markdown pages live first.
3. **Block system + freeze-on-publish (bake-on-publish, render frozen)** — Grant
   locked 2026-06-16: a public reader has no account/local data, so blocks are
   BAKED at publish (client-side, needs the author's data + canvas) and the public
   page renders the frozen snapshots via the existing `BakedEmbedView`, never live
   embeds. Reuses `ReferencePicker` ("/" insert), `bakeAllEmbeds`/`bakeOne`,
   `embed-pins`, `BakedEmbedView`, `RenderedMarkdown`. 3b = figures + static
   tables (citation-safe). [IN PROGRESS]
4. **Hosted-data assets / LIVE interactive (R2)** — R2 upload of a published
   dataset + a public PublicDatasetEmbed (DuckDB-from-R2, no auth) upgrades the
   data-heavy blocks from static to live-interactive; the separate
   `lab_hosted_assets` metered line, lapse GC + `archived` flag (needs Billing's
   metered line + reclaim signal — kicked off in parallel with 3b 2026-06-16).
5. **Custom domains** — CNAME claim + verify + auto-TLS + 301 cutover (premium
   add-on, last).

## Open questions

- Custom-domain tier + verification flow (CNAME, TLS) — deferred but design the
  seam now.
- Abuse/moderation surface for public-published pages (mitigated: paid + verified
  lab, our components not arbitrary JS) — define a content policy.
- RESOLVED (Billing 2026-06-16): metered-storage primitive = the collab tally
  mechanism on a separate `lab_hosted_assets` line; entitlement =
  `isLabPublishEntitled`; reclaim signal off subscription flip + lapse timestamp;
  pricing = 1.15x cost-recovery recurring / near-raw prepaid archive. No build
  dependency open from this lane's side.
