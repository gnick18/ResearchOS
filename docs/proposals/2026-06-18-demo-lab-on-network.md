# Demo lab on the researcher network (two-site showcase)

Status: proposal (design only, no production code)
Date: 2026-06-18
Author: demo-lab-network design session
House style: no em-dashes, no mid-sentence colons, no emojis.

## 1. Goal

Make the ResearchOS demo lab a real, browsable showcase of the full "seamless
sharing plus lab sites" story, end to end, without a real user account and
without a connected folder. Concretely the demo lab should:

1. Appear on the researcher network directory (`/network`) as a single lab card
   with a handle, a PI plus member `@handles`, a verified-domain badge, and a key
   fingerprint, all framed as sharing and discovery, NOT a social feed.
2. Have a public lab home at `research-os.app/<slug>` built from native markdown
   pages authored in ResearchOS (home/about, people, a paper companion). This is
   the built-in wizard companion site.
3. Also have a public BYO ("bring your own") static site (a GitHub-built static
   HTML/CSS/JS bundle, a paper companion) served from the lab's own slug.
4. Show a site switcher so a viewer sees that one lab can have BOTH a native
   companion site and a BYO static site.

The point is a prospective lab head clicking around the demo can see exactly what
they get when they turn on lab sites and list on the network, without us having to
flip the whole feature on in production.

## 2. The infrastructure already exists, and ships dark

This is NOT a green-field build. The slug registry, the public lab-site route, the
native-page store, the BYO static-site store, the R2 asset store, and the network
landing are all already written and merged behind flags that default OFF. The work
here is a demo-enrichment layer on top, plus a flag plan that exposes only the demo
slug.

### 2.1 The flag split (three flags, server-lazy vs client-inlined)

`frontend/src/lib/social/config.ts` defines three independent flags, each with a
server gate read lazily at request time and a client gate inlined at build time,
all fail-closed (default OFF):

- Social layer. `SOCIAL_LAYER_ENABLED` at
  [config.ts:15](frontend/src/lib/social/config.ts:15) (client, `NEXT_PUBLIC_SOCIAL_LAYER`).
  Gates `/network`, the public researcher search, and the richer `/u/[handle]`.
- Lab sites. `isLabSitesEnabled()` at
  [config.ts:38](frontend/src/lib/social/config.ts:38) (server, `LAB_SITES_ENABLED`)
  and `LAB_SITES_ENABLED` at [config.ts:43](frontend/src/lib/social/config.ts:43)
  (client, `NEXT_PUBLIC_LAB_SITES`). Gates the `research-os.app/<slug>` companion
  pages. Kept separate from the social layer on purpose (companion sites are a
  paid-lab feature that can ship independently of the public network).
- BYO sites. `isLabByoSitesEnabled()` at
  [config.ts:65](frontend/src/lib/social/config.ts:65) (server, requires
  `isLabSitesEnabled()` AND `LAB_BYO_SITES`) and `LAB_BYO_SITES_ENABLED` at
  [config.ts:74](frontend/src/lib/social/config.ts:74) (client, requires
  `LAB_SITES_ENABLED` AND `NEXT_PUBLIC_LAB_BYO_SITES`). BYO is a strict subset of
  lab sites, so its gate is layered ON TOP of the lab-sites gate.

The server functions read `process.env` at call time (never inlined) so a route
handler 404s until the env is deliberately set; the `NEXT_PUBLIC_*` constants are
inlined at build time, so flipping a client gate in prod requires a rebuild.

### 2.2 The public lab-site route (renders without an AppShell)

`frontend/src/app/[labSlug]/[[...path]]/page.tsx` is the public companion-site
route. Key facts that shape the demo design:

- It is `runtime = "nodejs"` ([page.tsx:37](frontend/src/app/[labSlug]/[[...path]]/page.tsx:37))
  and a TOP-LEVEL optional-catch-all. Next.js always prefers a static segment over
  a dynamic one, so every existing top-level route still wins; this fires only for
  a first path segment that matches no static directory
  ([page.tsx:19-25](frontend/src/app/[labSlug]/[[...path]]/page.tsx:19)).
- It `notFound()`s when `isLabSitesEnabled()` is false, so with the flag off the
  route is byte-identical to a missing page
  ([page.tsx:44-47](frontend/src/app/[labSlug]/[[...path]]/page.tsx:44)). It also
  404s unless the slug resolves in `slug_registry` as `kind=lab`, a `lab_sites`
  row exists, and the page status is `published` (the pure `resolvePublicPage`
  decision at [page.tsx:61](frontend/src/app/[labSlug]/[[...path]]/page.tsx:61)).
- The resolve helper swallows any DB failure into a not-found so a DB outage is a
  404, never a crash ([page.tsx:53-60](frontend/src/app/[labSlug]/[[...path]]/page.tsx:53)).
- It renders through `LabSitePageView`
  (`frontend/src/components/social/LabSitePageView.tsx`), which is a pure presenter
  on the MARKETING chrome (`MarketingNav` + `MarketingBackdrop` + `MarketingFooter`
  + `RenderedMarkdown`), explicitly NOT the AppShell and NOT a connected folder
  ([LabSitePageView.tsx:4-15](frontend/src/components/social/LabSitePageView.tsx:4)).
  This is the crucial property for the demo. A public lab page is already a calm,
  login-free, folder-free surface, so it does not need the ephemeral demo store at
  all to render once it has a page body.

### 2.3 The DB plus R2 storage model

Everything the route reads is DB-backed, with file bytes in R2:

- Slug registry. `frontend/src/lib/social/slug-registry.ts` is the pure core
  (normalization, the reserved set, availability). `RESERVED_SLUGS` at
  [slug-registry.ts:178](frontend/src/lib/social/slug-registry.ts:178) is the union
  of every top-level App-Router segment (`APP_ROUTE_SEGMENTS` at
  [slug-registry.ts:62](frontend/src/lib/social/slug-registry.ts:62)) and the system
  words. `normalizeSlug` is at
  [slug-registry.ts:203](frontend/src/lib/social/slug-registry.ts:203). The Neon
  layer `frontend/src/lib/social/slug-registry-db.ts` stores one row per slug across
  `kind = lab | handle | institution | reserved`, with the slug as the primary key
  enforcing global uniqueness (`reserveSlug` at
  [slug-registry-db.ts:172](frontend/src/lib/social/slug-registry-db.ts:172),
  `getSlug` at [slug-registry-db.ts:107](frontend/src/lib/social/slug-registry-db.ts:107)).
- Native pages. `frontend/src/lib/social/lab-site-db.ts` stores `lab_sites` (one row
  per lab keyed by the billing owner-key hash, `getSiteBySlug` at
  [lab-site-db.ts:277](frontend/src/lib/social/lab-site-db.ts:277)) and
  `lab_site_pages` (keyed by owner plus normalized path, `getPage` at
  [lab-site-db.ts:315](frontend/src/lib/social/lab-site-db.ts:315)). Bodies are plain
  markdown (`body_md`); `snapshots_json` and `hosted_json` are nullable columns for
  baked block snapshots (Phase 3b) and live hosted datasets (Phase 4a). Schema is
  idempotent `CREATE TABLE IF NOT EXISTS` callable on every route entry.
- Baked snapshots. `frontend/src/lib/social/lab-site-snapshots.ts` validates the
  frozen `BakedEmbed` bundle a public reader sees instead of a live embed
  (`parseSnapshotBundle` at [lab-site-snapshots.ts:102](frontend/src/lib/social/lab-site-snapshots.ts:102)).
- Hosted datasets. `frontend/src/lib/social/lab-site-hosted.ts` is the live
  DuckDB-WASM upgrade on top of a baked snapshot (`resolveDatasetEmbed` cascade at
  [lab-site-hosted.ts:283](frontend/src/lib/social/lab-site-hosted.ts:283)); the
  Parquet bytes are on R2 via `frontend/src/lib/social/lab-site-asset-store.ts`.
- BYO static sites. `frontend/src/lib/social/lab-byo.ts` is the pure core (zip-slip
  sanitization at [lab-byo.ts:101](frontend/src/lib/social/lab-byo.ts:101),
  content-type table, `resolveByoServePath` at
  [lab-byo.ts:202](frontend/src/lib/social/lab-byo.ts:202), `labSlugFromHost` at
  [lab-byo.ts:245](frontend/src/lib/social/lab-byo.ts:245), `parseByoManifest`). The
  Neon layer `frontend/src/lib/social/lab-byo-db.ts` stores `lab_byo_sites` (one
  manifest row per lab, `getByoSiteByOwner` at
  [lab-byo-db.ts:81](frontend/src/lib/social/lab-byo-db.ts:81)) plus a `lab_byo_github`
  connection row for pull-from-repo. The file bytes are served by
  `frontend/src/app/api/social/lab-site/byo/serve/route.ts` from `research-os.com`
  (the assets domain, no cookies, a different registrable domain so the lab JS is
  cookie-isolated from the authed app). The serve route resolves the lab by Host
  subdomain `<slug>.research-os.com` OR a `?slug=` fallback for local testing.

### 2.4 The network directory surface

`frontend/src/app/network/page.tsx` `notFound()`s unless `SOCIAL_LAYER_ENABLED`
([network/page.tsx:23](frontend/src/app/network/page.tsx:23)) and renders
`NetworkLanding` (`frontend/src/components/social/NetworkLanding.tsx`). The landing
is the SAME marketing chrome, a hero, a login-free `PublicResearcherSearch`, and a
value-prop band whose copy is locked to the sharing positioning, not a social feed
("Send work, not files", "Know it reached the right person", verified-domain badge
plus key fingerprint, "Reachable by choice", opt-in)
([NetworkLanding.tsx:24-45](frontend/src/components/social/NetworkLanding.tsx:24)).
There is no lab-card / lab-directory component yet; the network surface today is
people search only.

### 2.5 The demo lab identity

The demo is deliberately ephemeral and in-tab. The seed
(`frontend/src/lib/dev/seed-ephemeral.ts`) plus the demo bundle under
`frontend/public/demo-data/` define the FakeYeast lab. The `_demo_marker.json`
notice is "This folder is the ResearchOS demo lab. All projects, strains, and
results are fabricated for tutorial purposes." The PI archetype is Dr. Mira
Castellanos (`@mira`, the orange PI color in
[lab-demo-data.ts:185](frontend/src/lib/demo/lab-demo-data.ts:185)), with members
`@alex` (postdoc), `@ivy`, `@morgan` (grad student), `@nia`, `@remy`, `@theo`, plus
an archived `@sam`. The on-tab demo banner already establishes the framing, "You
are exploring a sample lab. The data is fictional and lives only in this tab."
([DemoEntryCue.tsx:66-68](frontend/src/components/DemoEntryCue.tsx:66)).

Chosen demo slug. `castellanos-lab`. It is a natural lab slug (PI surname plus
"lab"), passes `normalizeSlug` unchanged, is not in `RESERVED_SLUGS`, and does not
collide with any existing `@handle` (the handles are first-name based). See the
slug-shadowing note in section 5.

## 3. The crux. DB-backed feature vs a no-DB demo

The companion-site route and the directory read are DB-backed
(`slug_registry`, `lab_sites`, `lab_byo_sites` rows in Neon, BYO bytes in R2). The
demo is deliberately ephemeral, in-tab, with NO database and NO connected folder.
So "add the demo lab to the network" is not just fixture data. There are three
ways to bridge that gap.

### Option A. Seed real DB rows plus R2 assets for one reserved demo slug

Provision a genuine, read-only "demo lab" that exists server-side. At deploy time a
seed script reserves `castellanos-lab` in `slug_registry` as `kind=lab` with a
sentinel demo owner key, inserts the `lab_sites` row, upserts the native
`lab_site_pages` (home, people, paper companion) as `status=published`, uploads the
BYO bundle to R2 and writes the `lab_byo_sites` manifest. Then flip only the flags
needed to expose it.

- Pros. Zero new render code. The existing route, the existing `LabSitePageView`,
  and the existing BYO serve route all just work because the data is real. The demo
  exercises the true production path end to end, which is the highest-fidelity
  showcase and doubles as a smoke test of the real feature.
- Cons. Requires a populated Neon `DATABASE_URL` and configured `R2_*` in the
  environment the demo runs in. The demo is no longer purely client-side, so a
  preview deploy or a local run without Neon/R2 cannot show it. It also means the
  three flags are genuinely ON in that environment (scoped, see section 5), so the
  blast radius needs care. A seed script plus an idempotent re-seed on deploy is new
  operational surface.

### Option B. A demo-mode read adapter (no DB)

Add a demo branch inside the resolve path so that, for the reserved demo slug only,
the route serves the lab from static fixtures (or the ephemeral store) instead of
Neon. `resolve()` would short-circuit. If `slug === DEMO_LAB_SLUG`, return a
hard-coded published page bundle; the BYO serve route would map the demo slug to a
checked-in bundle. No DB, no R2.

- Pros. Works anywhere, including a DB-less preview or a purely local run, which
  matches the demo's "lives only in this tab" promise. Nothing leaks into the real
  registry.
- Cons. New production code on a load-bearing public route (a `if demo` branch in
  `resolve()` and in the BYO serve route), which is exactly what the brief says NOT
  to build here, and which adds a permanent special case to a security-sensitive
  path. The demo no longer exercises the real DB/R2 path, so it is a lower-fidelity
  showcase and is not a smoke test. The flag gating gets subtle (the route must
  serve the demo even with `isLabSitesEnabled()` false, or we gate the demo on a
  fourth "demo" flag).

### Option C. Hybrid. Static fixtures for the native site, a checked-in bundle for BYO, behind a demo-only branch

A blend of A and B. Native wizard pages come from a checked-in fixture module; the
BYO bundle is a checked-in static folder; both are served by a narrow demo-only
branch keyed on the reserved slug, with the directory card sourced from the same
fixture.

- Pros. No Neon, no R2, fully portable like B, while keeping the native and BYO
  content as plain checked-in files that are easy to review and diff.
- Cons. Same core objection as B (new branches on the public route and the serve
  route), and now TWO content sources to keep in sync with the real shapes. The
  most code of the three.

### Recommendation. Option A, scoped, with a one-shot deploy seed

Recommend Option A for production, because it is the only option that needs zero
new render code, exercises the real path, and is the most honest showcase (a
prospective lab head is looking at the actual feature, not a mock of it). The cost
is operational, not architectural. We already run idempotent `CREATE TABLE IF NOT
EXISTS` on route entry and idempotent slug seeding
(`seedReservedSlugs`/`seedExistingHandles`/`seedInstitutionSlugs` in
[slug-registry-db.ts:246-306](frontend/src/lib/social/slug-registry-db.ts:246)), so
adding a `seedDemoLab()` in the same idempotent style is a small, familiar surface.

Two refinements make A safe:

1. Sentinel owner key. The demo `lab_sites.lab_owner_key` is a fixed sentinel (for
   example `demo-castellanos-lab`) that maps to no real billing account, so the
   demo lab can never be edited through the authed dashboard and never bills.
2. Demo framing at the view layer. `LabSitePageView` gets a small, opt-in "sample
   lab" ribbon for the demo slug only (see section 4.4), reusing the
   `DemoEntryCue` copy so the public page carries the same "fictional, for tutorial
   purposes" framing the in-tab demo does.

For local development and DB-less previews where Option A cannot run, fall back to
the MOCKUP in this proposal (a fully clickable HTML artifact) rather than to Option
B/C special-casing. That keeps the real route clean. If a portable, no-DB demo
later becomes a hard requirement (for example for an offline trade-show laptop),
revisit Option C as an additive, clearly-fenced demo adapter, never as a branch
inside the shared resolve path.

## 4. Content spec

### 4.1 Network directory card

A new lab card on `/network` (a small `LabDirectoryCard`, sourced for the demo from
Option A's real row, or from the mockup fixture for review). The card carries:

- Lab handle. `castellanos-lab` (links to `research-os.app/castellanos-lab`).
- Lab name. The Castellanos Lab (FakeYeast synthetic biology).
- PI. Dr. Mira Castellanos, `@mira`.
- Members. `@alex`, `@ivy`, `@morgan`, `@nia`, `@remy`, `@theo` (archived `@sam`
  not shown). Rendered as a small avatar/handle row, each linking to `/u/<handle>`.
- Verified-domain badge. "Verified, fakeyeast.edu" using the same shield language
  as `NetworkLanding`'s value prop, so a viewer can trust the lab is who it says.
- Key fingerprint. A short fingerprint chip (for example `ab12 cd34 ef56`) per the
  locked positioning that sharing is verified, not a follower count.
- Sites. Two small chips, "Lab site" (native) and "Paper companion" (BYO),
  reinforcing that one lab can host both.

The card copy stays on the locked sharing positioning. No follower counts, no
likes, no feed. It is a discovery-and-trust card.

### 4.2 Built-in wizard companion site (native markdown)

Three published `lab_site_pages` under `castellanos-lab`, authored as plain
markdown in ResearchOS (the wizard companion site):

- Home / about (`path = ""`). Who the FakeYeast lab is, the research question
  (engineering FakeYeast strains), and a calm intro. Includes one figure as a baked
  snapshot to demonstrate the Phase 3b frozen-embed path.
- People (`path = "people"`). The roster with roles, each linking to `/u/<handle>`,
  mirroring the directory card members.
- Paper companion (`path = "papers/fakeyeast-2026"`). A short companion page for a
  fictional paper, abstract plus a results figure (baked snapshot) plus a link to
  the BYO static companion for the full interactive version.

All three render through the existing `LabSitePageView` on the marketing chrome,
with the breadcrumb back to `/castellanos-lab` already built in.

### 4.3 BYO hosted static site (GitHub-style bundle)

A small static "paper companion" the lab built itself (the archetype is a site
exported from a GitHub Pages repo, recorded via the `lab_byo_github` connection).
The bundle is a root `index.html` plus `assets/` (a stylesheet, maybe a figure
image), validated by `validateByoEntries` and served from
`castellanos-lab.research-os.com` (or `?slug=castellanos-lab` locally). It is the
same paper as the native companion page, but as the lab's own fully-custom site,
which is the contrast the demo is making, native authored pages vs a bring-your-own
static bundle.

### 4.4 Site switcher and demo framing

On both the native lab home and the BYO site, a small site-switcher control shows
the two surfaces a lab can publish, "Lab site (researchos.app/castellanos-lab)" and
"Paper companion (castellanos-lab.research-os.com)", with the current one marked.
This makes the both-sites story explicit.

The demo "sample lab" ribbon (reusing `DemoEntryCue`'s "The data is fictional"
copy) appears on the native pages and the directory card so a viewer always knows
the lab is fabricated for the tutorial.

## 5. Flag plan

The goal is the demo lab visible while the rest of the feature stays dark in prod.
The flags are coarse (they gate whole surfaces, not per-slug), so "scoped" here
means we accept that turning a flag on exposes its surface, and we make that
surface safe to expose rather than trying to per-slug gate it.

| Flag | Env | Effect when ON | Demo needs it |
| --- | --- | --- | --- |
| Lab sites (server) | `LAB_SITES_ENABLED=true` | `research-os.app/<slug>` resolves published lab pages | Yes, for the native site |
| Lab sites (client) | `NEXT_PUBLIC_LAB_SITES=1` | Lab-site UI surfaces appear (dashboard controls) | Only if we expose authoring UI, NOT needed for a read-only demo |
| BYO (server) | `LAB_BYO_SITES=true` (plus lab-sites server) | BYO serve route serves uploaded bytes | Yes, for the BYO site |
| BYO (client) | `NEXT_PUBLIC_LAB_BYO_SITES=1` | BYO upload UI appears | No, the demo BYO bundle is pre-seeded |
| Social layer (client) | `NEXT_PUBLIC_SOCIAL_LAYER=1` | `/network` plus public search render | Yes, for the directory |

Recommended production posture for the demo:

- Turn ON `LAB_SITES_ENABLED` (server) and `LAB_BYO_SITES` (server). These only
  make a slug resolve when a real published row exists, so with ONLY the demo lab
  seeded, the only lab site reachable is `castellanos-lab`. Any other slug still
  404s because there is no row.
- Turn ON `NEXT_PUBLIC_SOCIAL_LAYER` so `/network` renders and can show the lab
  card. (Public researcher search also turns on; that is acceptable because listing
  is opt-in and the search is empty until real researchers list.)
- Keep `NEXT_PUBLIC_LAB_SITES` and `NEXT_PUBLIC_LAB_BYO_SITES` OFF unless we want
  the authoring UI live. A read-only demo does not need the dashboard authoring
  controls, so leaving the client gates off keeps the in-app authoring surface dark
  while the public read surfaces are on.

Net effect. The public read paths (`/network`, `research-os.app/castellanos-lab`,
`castellanos-lab.research-os.com`) are live and populated only by the seeded demo
lab; the in-app authoring UI stays dark; and because the route gates on a real
published row, no other lab is reachable.

### Slug shadowing safety

`castellanos-lab` is a single segment that matches no static directory under
`frontend/src/app`, so Next.js routes it to the `[labSlug]` catch-all rather than
shadowing a real page. `RESERVED_SLUGS` already makes every static route segment
unclaimable as a lab slug at registry-write time, and the demo seed reserves
`castellanos-lab` as `kind=lab`, so no real lab can later claim it. If we ever add
a top-level `/castellanos-lab` route (we will not), the static segment would win
per Next.js precedence, so the demo could never hijack a real route either.

## 6. Phased build plan

Phase 0. Land this design doc plus the clickable mockup (this change). No
production code. Get sign-off on the slug, the card content, and Option A.

Phase 1. Demo seed module. A `seedDemoLab()` (idempotent, deploy-time) that
reserves the slug, inserts the `lab_sites` row under the sentinel owner key, upserts
and publishes the three native pages, and writes the BYO manifest, with a small
checked-in BYO bundle and a checked-in markdown source for the native pages. Unit
test the seed shapes against `parseByoManifest` / `parseSnapshotBundle`.

Phase 2. View-layer demo framing. The small "sample lab" ribbon in
`LabSitePageView` (demo slug only) and the `LabDirectoryCard` on `/network`. Both
flag-gated and demo-slug-scoped so they never affect a real lab.

Phase 3. Flag flip plus verify in a Neon/R2-backed environment. Set the server
lab-sites and BYO flags plus `NEXT_PUBLIC_SOCIAL_LAYER`, run the seed, and verify
all three public surfaces plus the site switcher in a real browser. Confirm every
non-demo slug still 404s.

Phase 4 (optional, later). Author the demo native pages through the real dashboard
(turning on the client lab-sites gate) so the demo doubles as an authoring
walkthrough, and connect the BYO bundle via the real `lab_byo_github` pull so the
"sync from GitHub" story is also demonstrated.

## 7. Open questions for Grant

1. Slug. `castellanos-lab` confirmed, or prefer `fakeyeast-lab` / `mira-lab`?
2. Verified domain. Use a fabricated `fakeyeast.edu` for the badge, or borrow the
   real founders' institution language? (Recommend fabricated, consistent with the
   "fictional" framing.)
3. Authoring UI in the demo. Read-only seeded demo only (client gates off), or also
   expose the dashboard authoring so the demo shows the create flow (Phase 4)?
