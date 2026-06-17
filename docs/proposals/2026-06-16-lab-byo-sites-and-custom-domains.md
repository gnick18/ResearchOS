# Lab BYO static-site hosting + custom domains (2026-06-16)

Lane: INJEST (social layer). Status: proposal / design (Grant: "scope after 3b/4").
Builds on the shipped lab-domains epic (Phases 1-4b on origin/main, flag-gated off).
Covers the two remaining pieces: bring-your-own static sites, and Phase 5 custom
domains. Both are external/custom hosting under a lab domain and share the
sandbox-origin + CNAME design, so they're scoped together.

## Two ways a lab presents content under its domain

1. **Native pages (BUILT, Phases 1-4b)** — markdown + ResearchOS visualizer blocks
   (figures, static tables, live DuckDB datasets from R2). The PRIMARY path: most
   companion-data needs are widget-able and look better native.
2. **BYO static site (this spec)** — the lab's own HTML/CSS/JS, GitHub-connected or
   uploaded, for when the presentation is too custom for our widgets. The escape
   hatch.

Grant's framing (2026-06-16): the bulk of value is native widget pages; BYO is for
fully-custom sites a lab builds themselves (increasingly easy with AI). The pain it
removes: getting a paper's companion site hosted without an IT ticket.

## Native block ideas worth building (backlog, extends the Phase 3b/4a block set)

From Grant's brainstorm — these are NATIVE blocks, NOT BYO, and a separate backlog:
- **Reproducibility block** — pair a hosted dataset with the script/pipeline that
  produced a figure ("this is the raw data, this is the script I used to make the
  plot"). Raw data (the Phase 4a hosted dataset) + the code, side by side.
- **Annotated-genome page** — a lab uploads a genome to NCBI AND renders it here
  via the existing sequence viewer, context-separated.
- **Big-table / mass-spec viewers** — the Phase 4a live DuckDB viewer already
  covers generic large tables; mass-spec / genome are specialized viewers on top.

## BYO static-site hosting

### Sources
- **GitHub connect (headline)** — a GitHub App / repo connection; pull the static
  files (no build, or a simple static build), re-sync on every push via webhook.
  Auto-updating, matches the lab's existing workflow.
- **Upload** — drag-drop a folder/zip of a static site, for labs not on GitHub.
  Simplest first cut; testable immediately with Grant's 2023 paper HTML site.

### Hosting + security — THE critical constraint
Untrusted lab HTML/JS must NOT execute on the `research-os.app` origin (it could
read app cookies/localStorage or phish under our brand). So BYO sites are served
from an **isolated sandbox origin**.

LOCKED DECISION (Grant, 2026-06-16): the sandbox origin is the EXISTING
`research-os.com` (our assets domain — R2-backed, NO auth / NO cookies, and a
DIFFERENT registrable domain from the app's `research-os.app`, so untrusted lab JS
loaded from it is automatically cookie-isolated from the authed app). Each BYO site
lives at a per-lab subdomain `<labSlug>.research-os.com`. NO new domain purchase is
needed (the earlier "register research-os.site" idea is superseded). The clean lab
URL (`research-os.app/<slug>`) can link to / front it; the untrusted bytes live only
on `<labSlug>.research-os.com`. Files hosted on R2, served via the social-lane R2
client. INVARIANT: never set app cookies or serve the authed app on `.com`.

GO-LIVE infra (deferred, like Phase 4a's R2 creds): a `*.research-os.com` wildcard
DNS record + the Vercel domain config that maps `<labSlug>.research-os.com` to the
serve route. Until that exists, the serve route is testable via its `?slug=` +
`?path=` query fallback. See the BYO Slice 1 handoff
(`docs/handoffs/2026-06-16-lab-byo-upload-slice1.md`).

### Cost + permanence (reuse Phase 4)
Same model as native hosted data: metered, 100% pass-through (reuse the Phase 4
`lab_hosted_assets` line + `hostedAssetMonthlyCost`), and the GC/reclaim lifecycle
(Phase 4b). Static site HTML is tiny so the page shell can stay perma-read-only;
any large embedded data follows the 30-day asset reclaim.

## Custom domains (Phase 5)

A lab points its OWN domain (`data.smithlab.org`) at ResearchOS. Flow: enter
domain -> add a CNAME (`cname.research-os.app`) -> verify -> auto-TLS -> a 301 from
`research-os.app/<slug>` preserves links already printed in papers. Applies to BOTH
native lab sites and BYO sites. (Mockup of this flow already exists from the
2026-06-16 design pass.)

### Open infra decisions (Grant's calls — surfaced, not assumed)
1. **Vercel domain strategy** — add each custom domain to the Vercel project via the
   Vercel Domains API (per-lab automation) vs. a wildcard. Need the plan's
   domain limits + an API token + automation in the claim flow.
2. **Sandbox apex** — register a separate domain (e.g. `research-os.site`) to host
   untrusted BYO content isolated from the app. Which domain is Grant's call.
3. **Tier gating** — custom domains (and BYO?) as a premium add-on above the base
   lab tier (coordinate with Billing).
4. **Shared asset line** — BYO + custom domains reuse the Phase 4 R2 asset line +
   GC (recommend yes; one metering + reclaim path).

## Boundary / reuse
- Reuse: Phase 4 R2 client + `lab_hosted_assets` metered line + GC, the slug
  registry, `lab_owner_key`, the existing custom-domain mockup.
- New: GitHub App integration (OAuth + webhook), sandbox-origin serving + the
  separate apex, Vercel domain automation.
- Billing: BYO / custom-domain entitlement (premium gate) — coordinate before build.

## Recommended sequencing
1. BYO **upload-first** (simplest; verify with Grant's 2023 paper site).
2. BYO **GitHub-connect** (auto-sync).
3. **Custom domains** last (most infra; needs the Vercel-domain + sandbox-apex
   decisions above).

All flag-gated (`LAB_SITES_ENABLED` + likely a `LAB_BYO_SITES` sub-flag), off +
byte-identical until launch, consistent with the rest of the epic.
