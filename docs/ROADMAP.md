# ResearchOS roadmap, future ideas

A running backlog of ideas worth doing later. Entries here are NOT scheduled and NOT in progress. They are captured so good ideas are not lost. Moving an item into active work means writing a real proposal/design first (see docs/proposals/).

Status legend, `idea` (captured, unscoped), `scoping` (proposal being written), `building` (active), `done` (shipped).

---

## Account setup revamp + lab-tier launch (with cost-enforcement gate)

Status, `building` (v1 built on main 2026-06-09, dogfooding; lab-search is the v2 follow-up below)
Raised by, Grant (2026-06-09)

Rebuild the entry experience into a real start screen. A splash animation on open, a 3-tier account chooser (Local-only, Free account, Lab), OAuth-at-creation for the account tiers with a solo escape hatch, lab create-or-join, and a celebratory hand-off into Workbench. Everything stays local-first, the cloud is only a sync and sharing intermediary, and pricing is cost-recovery with a cap-blocks model (1 GB free, opt-in metered above, hitting the cap pauses rather than bills). Mockups live in docs/mockups/{account-setup-revamp, account-splash, beakerbot-tier-icons}.html. Full plan + status in docs/proposals/ACCOUNT_SETUP_REVAMP.md; design context in docs/proposals/{IDENTITY_LAB_LOGIN, IDENTITY_OAUTH_ONLY, LAB_TIER_REDESIGN, METERED_STORAGE_PRICING, PRICING_COST_MODEL}.md.

V1 BUILT (on main, behind LAB_TIER_ENABLED / sharing flags): StartScreen front door (Sign in / Open a folder / Create a new account, adaptive for returning users), splash (once-per-session, skippable), the 3-tier chooser, Local + Free + Lab-create + Lab-join-via-invite-link branches, BeakerBot tier illustrations. DEFERRED to v2: lab browse/search + request-to-join (needs a new labs registry + a member-initiated membership model on the D1-migrating directory; Grant deferred 2026-06-09, invite-link join ships for v1). Also deferred (polish): the success-transition into the live flow + the returning Free re-authorize page (Lab re-auth already covered by LabSignInGate).

HARD LAUNCH GATE before flipping LAB_TIER_ENABLED, do not skip. The storage-migration cutover (phase 1 chunk 5 in COLLAB_STORAGE_D1_DO_MIGRATION.md) deletes the Vercel /api/collab/push route and limits.ts, which today carry the per-owner activity throttle (429) and the cost-breaker pause (503). Those must be re-implemented in the Cloudflare Durable Object write path first, because Cloudflare has no hard spend cap and the Vercel hard pause does not reach it. See that doc's "Cost-enforcement carry-over (LAUNCH GATE)" section for the four required items.

---

## Reference and citation management

Status, `idea`
Raised by, Dylan Duerre (beta feedback, 2026-06-04)

The ask, the ability to read in and open papers, input a DOI or other unique identifier, and manage citations. Citation management would be a nice-to-have.

What this could include:
- Open and read papers inside ResearchOS (a PDF reader surface, the app already stores PDF attachments and bundles source PDFs with method-catalog templates, so the viewing primitive is partly there).
- Add a reference by unique identifier (DOI, PMID, arXiv id) and auto-fetch its metadata (title, authors, journal, year) instead of typing it by hand.
- A reference library, store references, attach the PDF, and link a reference to the experiments / notes / methods that cite it.
- Generate citations and a bibliography in common styles, and export (BibTeX, RIS, formatted text).

Why it fits ResearchOS, references are the connective tissue between a lab's protocols/experiments and the published literature, and a local-first reference library (PDFs + metadata living in the user's own folder) matches the project's storage model and NIH data-management positioning. It also pairs naturally with the existing notes, methods, and attachment systems.

Early technical notes (not a commitment):
- DOI metadata lookup is browser-direct and CORS-friendly via Crossref (api.crossref.org) and DataCite, similar to the Zenodo deposit path already proven in the sharing work, so no server proxy is needed. PubMed (E-utilities) and arXiv have public APIs for PMID / arXiv ids.
- PDFs and metadata can live in the user's data folder as ordinary files plus a sidecar, consistent with how sequences and method source PDFs are stored.
- Citation formatting is a solved problem with the open citation-style ecosystem (CSL), worth reusing rather than rebuilding.

Open questions for whenever this gets scoped, where references live (per-project vs a folder-wide library vs both), whether references are shareable cross-boundary like the other entities, and how tightly to couple a reference to the things that cite it.

---

## Lab instrument and equipment manuals

Status, `idea`
Raised by, Dylan Duerre (beta feedback, 2026-06-04)

The ask, a place for common lab instruments and equipment manuals.

What this could include, a shared library of equipment manuals (PDFs) attached to the instruments a lab actually uses, so the manual for the qPCR machine or the plate reader is one click away instead of buried in someone's email. Could extend the existing method-catalog pattern (templates already bundle source PDFs) and tie a manual to the methods/instruments that reference it. Likely overlaps with the reference library primitive above (PDF + metadata + linking), so the two ideas may share machinery.

## Shared instrument calendars

Status, `idea`
Raised by, Dylan Duerre (beta feedback, 2026-06-04)

The ask, shared calendars for booking lab instruments.

What this could include, a booking/scheduling surface so lab members can reserve shared instruments (who has the confocal at 2pm, is the centrifuge free), see conflicts, and avoid double-booking. This is inherently a SHARED, multi-user feature, so it leans on the lab/sharing model (and possibly the cross-boundary or future collaborate infrastructure) rather than the single-user local store. Worth scoping against the local-first constraint, a calendar that everyone reads and writes is closer to the live-collaboration problem than the copy-on-send model.

## Experiment planner

Status, `idea`
Raised by, Dylan Duerre (beta feedback, 2026-06-04)

The ask, an experiment planner.

What this could include, a way to plan an experiment ahead of running it, steps, timeline, the methods and instruments it needs, and the resources/reagents to have on hand. ResearchOS already has experiments (tasks), methods, and a Gantt chart, so this likely builds on those rather than starting fresh, the planner would be the forward-looking, pre-run view that complements the existing record-keeping. Worth checking against the beta de-bloat work so it adds planning value without adding click-heavy complexity.

## Simulate overlap extension PCR (assembly and overhang check)

Status, `idea`
Raised by, Justin Eagan (beta feedback, 2026-06-04)

The ask, simulate overlap extension PCR so the editor can check a user's primer overhangs and confirm the fragments will assemble into the intended construct in the correct orientation. Justin noted this is currently a paid-tier SnapGene feature.

What this could include:
- Given two or more fragments plus the primers that carry the complementary overhangs, predict the assembled product and verify that the overlapping ends are truly complementary and long enough to anneal.
- Check orientation, confirming each fragment joins in the intended 5-prime-to-3-prime direction so the construct is not assembled backwards.
- Surface failure modes before the bench, mismatched or too-short overlaps, unintended secondary annealing, or a fragment that can go in two orientations.
- Render the predicted junction sequence so the user can eyeball the seam.

Why it fits ResearchOS, this sits squarely in the sequence-editor / cloning-engine arc already in flight (the SnapGene-style surface), and overlap extension PCR (also called SOEing PCR) is a common primer-driven assembly method that pairs with the primer-design and specificity tooling the sequence work is building. Catching a bad overhang in silico saves a failed bench reaction.

Early technical notes (not a commitment):
- The core check is local string and alignment work on the fragment ends and the primer overhangs (complementarity, overlap length, Tm of the overlap), the same class of pure-function sequence logic already validated on the transparency page (Tm, alignment, digest, translation).
- Builds on the cloning engine the sequence-editor initiative is already scoping rather than a standalone tool.

Open questions for whenever this gets scoped, how the user inputs the fragments and primers (pick from the sequence library vs paste), how many fragments to support in one assembly, and whether to unify this with other assembly methods (Gibson, Golden Gate) under one assembly-simulator surface rather than an overlap-extension-only tool.

---

## Quartzy integration (lab ordering and inventory)

Status, `idea`
Raised by, Grant + a labmate (2026-06-05)

The ask, connect ResearchOS with Quartzy, the online lab inventory and ordering app many labs already use to submit orders, mark receipt of items, track inventories, and keep an ordering history. The goal is to meet labs where they are rather than force them to start over.

Integrate or replace, the leaning is INTEGRATE first. Integration is the easiest path to adoption because a lab does not have to abandon the tool and history it already relies on. A from-scratch ResearchOS ordering/inventory feature (see the separate "Lab inventory + barcode scan" idea) could come later or in parallel, but the connection is the lower-friction win.

Two tiers, with very different effort and dependency (refined with the labmate 2026-06-05):

1. Export-and-import migration (LOW BAR, near-term, needs NO Quartzy API). If Quartzy lets a user export their inventory/order list (a CSV or similar), ResearchOS can ingest it with a custom importer. We already proved this pattern, the existing custom "import from LabArchives" feature does exactly this for notebooks, so an inventory importer is the same shape. This alone makes migrating off Quartzy (the "replace" path) easy, without depending on Quartzy at all. The first thing to confirm is simply, does Quartzy have an export feature (Grant is checking).

2. Live info-connected sync (RICHER, depends on Quartzy's API). The user links their Quartzy account and ResearchOS pulls and pushes data both ways, so they can view their Quartzy inventory and order status, and ping requests or modifications back and forth, all while working inside ResearchOS. This is the better experience but it is gated on Quartzy exposing good public API calls. As Grant put it, that part is "on them," it depends on Quartzy being a good company with a usable API; he will research what they offer.

What this could include:
- Surface a lab's Quartzy inventory and order status inside ResearchOS so ordering context lives next to the experiments and methods that consume the reagents.
- Mark receipt or kick off a request from inside ResearchOS and have it reflected in Quartzy, so the two stay in sync.
- A one-time import of an exported Quartzy inventory for labs that want to move their list into ResearchOS outright.

Why it fits ResearchOS, ordering and inventory are a real daily lab workflow that currently lives in a separate tab; pulling it next to the bench work (experiments, methods, the reagents a protocol calls for) is the kind of consolidation the product is about, and it pairs naturally with the barcode-scan inventory idea and the mobile app.

API research (prelim, orchestrator 2026-06-05), the good news, Quartzy HAS both a public API and an export, so BOTH tiers are real, not hypothetical.

Public API (docs at docs.quartzy.com/api, base `https://api.quartzy.com`):
- Open to any user with an active Quartzy account. A user generates a per-user AccessToken from their Quartzy settings.
- Auth, an `Access-Token` request header carrying that per-user token, OR OAuth2 as an alternative.
- Resources cover read AND write for exactly what we want: Inventory Items (GET list/filter/retrieve, PUT update quantity), Order Requests (GET list, POST create, PUT update status), plus Labs (GET), Types (GET), User (GET), Webhooks (GET/POST/PUT), Health. So tier 2 two-way sync (view inventory/orders, push requests and modifications back) is fully supported by the API surface.
- Webhooks, subscribe to `event_types` with signing keys for verification, the push channel to reflect Quartzy-side changes back into ResearchOS in near-real-time.
- Pagination via a `page` query param. Rate limit is 6000 per window (confirmed empirically, the live API returns `x-ratelimit-limit: 6000` and `x-ratelimit-remaining` headers; the window length is not stated, likely per hour, generous for our use).

Export (tier 1 migration), Quartzy exports Inventory to Excel (per lab, not across all labs), plus purchase history and previously requested items, and it supports import-FROM-Excel too, so the column schema is known and an importer is the same shape as the existing LabArchives import. Tier 1 is unblocked.

The one real architecture question for US, CORS / browser-direct, is now ANSWERED (tested empirically 2026-06-05). ResearchOS is browser-only (local-first, only thin proxy routes server-side). I hit `https://api.quartzy.com/inventory-items` with an `Origin: https://research-os.app` header and the response carries NO `access-control-allow-origin` (no access-control-* headers at all). So Quartzy does NOT support CORS, the browser canNOT call api.quartzy.com directly (unlike Zenodo, which is CORS-open), and tier 2 MUST go through a thin server proxy. Good news, payloads are small JSON so the Vercel 4.5 MB function cap is a non-issue. Privacy nuance, a proxy that forwards the user's Quartzy AccessToken means the token transits our server, it must be forward-and-forget, never stored. The token/credential still lives client-side at rest (encrypted sidecar), same posture as the planned Zenodo linking. OAuth2 is the cleaner alternative (no token copy-paste) but needs registering a ResearchOS OAuth app with Quartzy. (Side note from the same probe, an unauthenticated GET returns `[]` rather than a 401, so auth gating is per-resource on the data, not a hard wall at the endpoint.)

Bottom line, tier 1 (export-import migration) is easy and unblocked. Tier 2 (live sync) is genuinely feasible, the API does everything needed; the open design decisions are AccessToken-paste vs OAuth2 for connecting, and browser-direct vs thin-proxy (likely proxy) for the calls.

Formal integration option (researched 2026-06-05), "formal" turns out to be two layers ON TOP of the same public-API work, not a different build, and there is NO rigid gated partner program to pass:
- OAuth2 + a registered Quartzy app (the cleaner connect UX). Instead of each user pasting an AccessToken from their settings, register ResearchOS as a Quartzy OAuth2 client so a user connects with a one-click "Connect Quartzy" button. Same API underneath, just a more official-feeling, lower-friction link step (mirrors how we are doing ORCID/Zenodo).
- Listed / out-of-the-box integration (the credibility + discoverability layer). Quartzy already lists software integrations in OUR exact category, R&D / ELN platforms Benchling and SciSpot, alongside QuickBooks, NetSuite, Slack, Teams, Asana, Airtable. There is no public application gate for software tools; the path is to build on the public API and then reach out (support@quartzy.com, or the integrations-request form at info.quartzy.com/integrations-request) to be co-marketed and listed in their integrations directory. The Benchling/SciSpot precedent is encouraging, an ELN-class tool is exactly what Quartzy already integrates. NOTE, do NOT use the "Become a Supplier" program (quartzy.com/become-supplier), that is for VENDORS selling lab products, not for a software tool like us.

So formal is NOT a prerequisite, the DIY public-API build ships on our own timeline. Formal just adds a cleaner OAuth connect plus credibility and in-product discoverability (Quartzy users find ResearchOS listed). Sensible sequence, build on the public API first (prove tier 1 export-import and at least tier 2 read), then pursue OAuth2 registration and a listing/partnership once it works.

Cost (researched 2026-06-05), two sides, and one important correction:
- To US (ResearchOS), no evidence of any fee. Building on the public API, registering an OAuth2 app, and getting listed as an integration all appear free (no per-call API charges, no listing fee found). The only cost on our side is the thin proxy infra, which is negligible and fits the existing free-tier hosting like everything else. So the integration looks free for us to build and list.
- To the USER / lab, here is the catch and the CORRECTION. Quartzy is NO LONGER FREE. As of 2026 it is a paid subscription (Starter about 159 USD/month for 5 users, Professional about 299/month for 10), with only a 14-day free trial, after which the org drops to READ-ONLY. So the labmate's "accounts are free to make" is outdated. This does not cost us anything, but it means the integration only benefits labs that ALREADY pay for Quartzy, we cannot onboard new "free Quartzy accounts" through it. The audience is existing paying-Quartzy labs (still a real audience, but narrower than "free").
- API tier gating, RESOLVED via the docs, the public API is "generally available to all users, if you have an active user account you can start using it right away," so it is NOT gated to a higher paid tier, any active account works. The only remaining open item is the soft one, terms/contract for a formal LISTING (even when there is no fee), which is a conversation, not a blocker.

Implication for sequencing, this makes the tier-1 export-import MIGRATION even more interesting, a lab whose Quartzy trial lapsed to read-only (or that does not want to keep paying 159+/month) could export and move their inventory INTO ResearchOS, where it is free. That positions ResearchOS as a free alternative for the inventory piece, not only a companion to a paid Quartzy.

Strategy, integrate AND offer a free alternative (Grant 2026-06-05), the "both worlds" play, and why it is less double-work than it sounds:
- One shared foundation, not two builds. Build a NATIVE inventory + requests data model in ResearchOS (the free alternative). The Quartzy integration then becomes ADAPTERS on top of that same model, an import adapter (read a Quartzy export or pull via the API to populate the native model) and an optional two-way sync adapter (for labs that keep Quartzy as their source of truth). The native build is the bulk; the Quartzy connection is a thinner layer that reuses the model. So "most work" is really one big build plus a thin adapter, not two parallel efforts.
- What we SHOULD replicate (the management layer, buildable and free), inventory tracking (reagents/consumables, quantities, locations, expiry, barcode scan, pairs with the existing barcode-scan idea), an internal request and approval workflow (a member requests an item, the PI or lab manager approves), and order RECORDS (track what was ordered, mark received, keep an ordering history). This is the daily lab pain and it is a CRUD + workflow + scanning data model, squarely in ResearchOS's lane.
- What we should NOT replicate (the marketplace), the actual PURCHASING, vendor catalogs, placing real orders, payment, PO generation, and procurement-system integrations (Coupa, Jagger, Workday, 120+ systems). That is Quartzy's actual business, they monetize the marketplace by taking a cut of orders and brokering supplier relationships, it is a massive, vendor-relationship-heavy undertaking, and it is not our lane. Labs keep buying through their existing procurement / vendor sites / Quartzy; ResearchOS just tracks the records. Most of what labs hate is the tracking, not the buying, so the free management layer captures the real value without the marketplace.
- Why it fits, ResearchOS is free for every lab by mission (see project_sustainability_pricing_model, open source, no paid tier). Quartzy going PAID (159+/month) is precisely the opening, a free native inventory + request manager is a strong differentiator and a genuine migration target for labs that do not want to keep paying, while the Quartzy adapter still serves labs that do.
- Effort + sequencing, this is the biggest of the inventory-related roadmap items, so phase it. (1) Native inventory tracking + barcode as the free core. (2) Requests/approval workflow + order records. (3) Quartzy import adapter (the tier-1 export-import migration). (4) Quartzy two-way sync adapter (tier 2, gated on the API/CORS questions). Each phase ships value on its own, and the Quartzy adapters come last, riding on the native model.

Open questions for whenever this gets scoped, AccessToken-paste vs OAuth2 for account linking; browser-direct vs a thin proxy (test Quartzy CORS); how far to take two-way write (read-only mirror first, or full create/update of requests from day one); webhook-driven freshness vs poll; and how to keep ResearchOS from becoming a custodian of a lab's ordering data (token forward-and-forget, no server-side storage of Quartzy data).
