# Lab site as the lab's network-facing presence

Status: DESIGN ONLY (no code in this change). Build plan for turning the public lab
subdomain page into the lab's network presence.
Date: 2026-06-19
Author: lab-site network-presence design session
House style: no em-dashes, no emojis, no mid-sentence colons. The mascot is BeakerBot.

Related docs:
- docs/mockups/2026-06-18-demo-lab-on-network.html (the target visual)
- docs/proposals/2026-06-18-demo-lab-on-network.md (Phases 1+2 BUILT behind default-off flags)
- docs/proposals/2026-06-16-lab-domains-companion-sites.md (origin + companion-site context)
- docs/proposals/2026-06-16-network-discovery-and-wiki-institution-editing.md (network context)

## 0. Decisions locked (Grant 2026-06-19)

These supersede the matching items in section 7.

- ORIGIN BOUNDARY (locked, broad). research-os.com (the network plus public lab
  sites) is FULLY PUBLIC and never blocked by login, so every lab and outside reader
  gets maximum visibility. research-os.app is the authed origin where sign-in lives
  and where paid-account gating applies (some cloud features, e.g. sending or sharing
  work, require a paying account). A collaboration action therefore renders publicly
  on the .com lab page but DEEP-LINKS to research-os.app to sign in and run the
  existing send flow. Never gate a .com view behind login or payment. See agent memory
  feedback-dotcom-public-dotapp-gated.
- ACTION SET (was Q1). All four ship in the first build, Send data / share work,
  Reach out for collaboration, Request data, and Find people / Cite.
- REQUEST DATA (was Q2). Deep-link to research-os.app (the user signs in there, and
  the relevant cloud features may require a paid account). NO new cookie-free public
  POST or request inbox on the .com origin.
- SEND-TO-LAB RECIPIENT (was Q3). The PI is the recipient, reusing the existing
  researcher-recipient machinery, with no new lab-inbox identity.

Still open: Q4 (header demo-only first), Q5 (BYO bundles per paper), Q6 (BYO banner),
Q7 (theming), Q8 (nav order).

## 1. Target state vs current live render

### 1.1 The framing (Grant)

The lab subdomain page IS the network link. When you find a lab on the network, the
thing you land on is `https://<slug>.research-os.com/` (after the .com cutover), and
that page should be the lab's presence, not a bare markdown dump. It should carry
collaboration actions (reach out, send data to the lab, request data from the lab),
let a reader move between the lab's pages (People, Methods, Data, Figures), and link
out to per-paper companion sites. A clickable mockup of this already exists and was
never wired onto the live render.

### 1.2 What the mockup shows (the target)

`docs/mockups/2026-06-18-demo-lab-on-network.html` shows the same lab three ways:

1. Network directory card (`/network`) with handle, PI plus member `@handles`, a
   verified-domain badge, a key fingerprint, two site chips (Lab site, Paper
   companion), and two CTAs (`Share to this lab`, `Visit lab site`).
2. Built-in lab site (`research-os.app/fakeyeast-lab`, after cutover the subdomain)
   with marketing chrome, a sample-lab ribbon, a site switcher (Lab site vs Paper
   companion BYO), a page subnav (Home / People / Paper companion), prose, and baked
   figure snapshots.
3. BYO static site (`fakeyeast-lab.research-os.com`) with its own custom dark theme,
   a sandbox note, its own nav (Abstract / Figures / Data / Methods), the same site
   switcher back to the lab site, and a live interactive table inside the bundle.

### 1.3 What the live render is today (barebones)

`frontend/src/components/social/LabSitePageView.tsx` renders ONE page only:
MarketingNav, an optional `DemoSampleLabRibbon` (demo slug only), a MarketingBackdrop,
a single breadcrumb link back to `/${slug}`, the page title as an `<h1>`, and the
markdown body through `RenderedMarkdown`, then MarketingFooter. That is the whole
public surface. The route
`frontend/src/app/[labSlug]/[[...path]]/page.tsx` resolves one page by path and mounts
that presenter.

### 1.4 Concrete gaps (target minus current)

| Mockup feature | Live today | Gap |
| --- | --- | --- |
| Cross-page nav (Home / People / Paper companion) | none (only a breadcrumb to home) | no public page listing, no nav render |
| Site switcher (native lab site vs BYO companion) | none | not rendered; data on which sites exist not surfaced to the view |
| Companion-site listing (per-paper companions) | a single markdown link in the demo paper body | no first-class listing or link surface |
| Collaboration CTAs (reach out, send data, request data) | none on the lab page | entirely new, plus a cookie-isolation routing decision |
| Directory card `Share to this lab` CTA | `LabDirectoryCard` has `Visit lab site` + `Paper companion` only | share CTA not built; "lab as recipient" not modeled |
| Lab header (avatar, name, PI, members, trust badges) on the lab page | none (title only) | the rich header from the card is not reused on the page |

What is already built and reusable, so we do NOT rebuild it (from the demo-lab-network
Phases 1+2, inert behind default-off flags):

- `frontend/src/components/social/DemoSampleLabRibbon.tsx` (the sample-lab ribbon).
- `frontend/src/components/social/LabDirectoryCard.tsx` (the directory card, demo-only).
- `frontend/src/lib/social/demo-lab.ts` (pure card + page content, `isDemoLabSlug`).
- `frontend/src/lib/social/seed-demo-lab.ts` (idempotent deploy seed).
- The whole render + storage + routing spine in section 2 below.

## 2. The infrastructure that already exists

This is not a green-field build. Ground truth from the code:

- Public route. `frontend/src/app/[labSlug]/[[...path]]/page.tsx` is a top-level
  optional-catch-all, `runtime = "nodejs"`. It `notFound()`s when `isLabSitesEnabled()`
  is false and otherwise resolves `getSlug` (kind=lab) plus `getSiteBySlug` plus
  `getPage` and renders `LabSitePageView`. The render decision is the pure
  `resolvePublicPage` in `frontend/src/lib/social/lab-site.ts`.
- Page model. `frontend/src/lib/social/lab-site.ts` `normalizePagePath` supports nested
  paths up to `PAGE_DEPTH_MAX = 8` (so `papers/fakeyeast-2026` is a normal page). Pages
  are `status: draft | published`; only published renders publicly. There is NO public
  "list a lab's pages" read today; the route fetches ONE page by path. There is NO
  page-type field (a "paper companion" page is a page by convention, not a type).
- Storage. `frontend/src/lib/social/lab-site-db.ts` holds `lab_sites` (one row per lab,
  keyed by `labOwnerKey`) and `lab_site_pages` (keyed by owner plus normalized path),
  with `getSiteBySlug` and `getPage`. Baked figure snapshots and live hosted datasets
  ride in nullable columns (`snapshotsJson`, `hostedJson`), parsed defensively by
  `lab-site-snapshots.ts` / `lab-site-hosted.ts`.
- BYO. `frontend/src/lib/social/lab-byo.ts` is the pure core (zip-slip sanitizer,
  content-type table, `resolveByoServePath`, `labSlugFromHost`, `resolveLabHostRequest`,
  `isLabPublicHost`, `labSiteOrigin`, `LAB_SITE_BYO_PREFIX = "/_site"`). `lab-byo-db.ts`
  stores `lab_byo_sites` (one manifest per lab) plus a `lab_byo_github` connection. The
  serve route is `frontend/src/app/api/social/lab-site/byo/serve/route.ts`.
- Routing source of truth. `frontend/src/proxy.ts` calls `resolveLabHostRequest`, which
  rewrites `<slug>.research-os.com/...` to the native `/<slug>/<path>` route,
  `<slug>.research-os.com/_site/...` to the BYO serve route, allows exactly one public
  API path, and BLOCKS every other `/api/*` on the lab origin.
- Network surface. `frontend/src/components/social/NetworkLanding.tsx` (gated on
  `SOCIAL_LAYER_ENABLED`) renders the hero, `PublicResearcherSearch`, a Labs section
  with the single `LabDirectoryCard card={DEMO_LAB_CARD}`, and the value props.
- Share machinery. `frontend/src/components/social/RecipientShareDialog.tsx` plus
  `frontend/src/lib/social/share-recipient.ts` are the existing recipient-first send.
  It is launched today only from `frontend/src/components/researchers/ResearcherProfileModal.tsx`,
  which passes `senderEmail={identity.email}` (from `useSharingIdentity`) and
  `ownerUsername={currentUser}`. Both are SESSION and LOCAL-FOLDER bound. This matters
  for section 3.

### 2.1 The cookie-isolation invariant (hard constraint)

The public lab origin is `research-os.com`, a DIFFERENT registrable domain from the
authed app `research-os.app`. From `lab-byo.ts` and `config.ts`:

- `LAB_SITES_PUBLIC_DOMAIN = research-os.com`, served with NO app cookies, so a lab's
  own JS (and the native page) is cookie-isolated from the authed app.
- `resolveLabHostRequest` BLOCKS all `/api/*` on the lab origin except the single public
  read `/api/social/lab-site/asset/read`. No cookie-setting auth/app route is reachable.
- `isLabPublicHost` is used by the client app shell to SKIP the folder / welcome wall on
  a lab origin, so a lab page has no session and no connected folder by construction.

Consequence for this build. Any action that needs the visitor's identity, key, or local
objects (the entire `RecipientShareDialog` send path) CANNOT run on the lab origin. It
must either deep-link to the app origin (`research-os.app`) where the session and the
local folder live, or use a cookie-free relay path (an email-keyed request). Section 3
specifies this per action. Note the current posture nuance from `config.ts`. Today
`LAB_SITES_ENABLED` is ON in prod and the demo lab is live on the APP origin
(`research-os.app/fakeyeast-lab`); the `.com` cutover (`LAB_SITES_COM_ORIGIN`) is OFF
until the `*.research-os.com` wildcard DNS is wired. So before cutover the page is on the
app origin and CTAs could in principle use the session; after cutover they cannot. We
design for the cutover (cookie-free) case so nothing breaks when the flag flips.

## 3. Section-by-section map (mockup to live implementation)

REUSE = exists, wire it in. EXTEND = modify an existing file. NEW = new file.

| Mockup section | Route / component to render it | Verdict | Notes |
| --- | --- | --- | --- |
| Marketing chrome (nav, footer, backdrop) | `MarketingNav`, `MarketingFooter`, `marketing/MarketingBackdrop` (already in `LabSitePageView`) | REUSE | unchanged |
| Sample-lab ribbon | `social/DemoSampleLabRibbon.tsx` (already mounted demo-slug-scoped) | REUSE | unchanged |
| Lab header (avatar, name, PI, members, verified badge, key fingerprint) | `LabSitePageView.tsx` | EXTEND | lift the header block out of `LabDirectoryCard` into a shared `LabIdentityHeader` (NEW) and mount it atop the page; data from a `lab_sites` profile (see 3.1) |
| Site switcher (Lab site vs Paper companion BYO) | new `social/LabSiteSwitcher.tsx`, mounted in `LabSitePageView.tsx` | NEW + EXTEND | needs "does this lab have a BYO site" plus the page list (see 3.2) |
| Page subnav (Home / People / Paper companion / Methods / Data / Figures) | new `social/LabSiteNav.tsx`, mounted in `LabSitePageView.tsx` | NEW + EXTEND | needs a public page listing (see 3.2) |
| Page body (prose, baked figures) | `RenderedMarkdown` with `bakedEmbeds` / `hostedAssets` (already wired) | REUSE | unchanged |
| Collaboration CTAs (reach out, send data, request data) | new `social/LabCollaborationActions.tsx`, mounted in `LabSitePageView.tsx` | NEW | session-dependent ones deep-link to app origin (see 3.3) |
| Companion-site listing / link-out | new `social/LabCompanionList.tsx` or a section in `LabSiteNav` | NEW + EXTEND | from the page list filtered to companion pages plus the BYO link (see section 4) |
| Directory card (network) | `social/LabDirectoryCard.tsx` | REUSE / EXTEND | add the `Share to this lab` CTA (see 3.3); everything else already matches the mockup |
| Network directory section + value props | `social/NetworkLanding.tsx` | REUSE | already renders the Labs section + `LabDirectoryCard` |
| BYO static site (its own theme, nav, table) | `api/social/lab-site/byo/serve/route.ts` (serves the lab's own bundle) | REUSE | the BYO bundle is fully the lab's HTML/CSS/JS; nothing to render on our side beyond serving it |
| BYO sandbox note ("served from the assets domain") | the lab's own bundle, OR a thin injected banner | OPEN | we do not control BYO markup; if we want the note it has to be a wrapper, see open questions |
| Back-to-lab-site link on the BYO site | the lab authors it in their bundle | REUSE (lab-authored) | the demo bundle should include it |

### 3.1 Where the lab header data comes from

`LabDirectoryCard` reads `DEMO_LAB_CARD` (name, tagline, PI, members, verified domain,
fingerprint) from the pure `demo-lab.ts`. The public PAGE has only `slug`, `title`,
`bodyMd`, `snapshots`, `hostedAssets`. To show the same header on the page we need that
profile reachable from the slug at render time. Two grounded options:

- Demo-only (smallest). In `LabSitePageView`, when `isDemoLabSlug(slug)`, render the
  shared `LabIdentityHeader` from `DEMO_LAB_CARD`. Zero schema change. Matches the
  current demo-scoped pattern exactly. Real labs get no header yet.
- General (later). Add a small profile (name, tagline, PI handle, member handles,
  verified domain, fingerprint) to the `lab_sites` row in `lab-site-db.ts` and pass it
  through the route into `LabSitePageView`. This is a data-shape change (FLAG before
  committing) and should wait for real labs.

Recommendation. Demo-only header first (no schema), generalize when real labs claim sites.

### 3.2 The missing public page listing (the nav and switcher need it)

The page subnav and the companion listing both need "what published pages does this lab
have". Today the route fetches ONE page; the only multi-page read is
`GET /api/social/lab-site` which is OWNER-scoped (session). So:

- EXTEND `frontend/src/lib/social/lab-site-db.ts` with a public, read-only
  `listPublishedPages(labOwnerKey): { path, title }[]` (published only, no bodies).
- EXTEND the route `page.tsx` `resolve()` to also fetch that list and pass it to
  `LabSitePageView` for the nav / switcher. Keep the same defensive try/catch so a DB
  hiccup degrades to "no nav", never a crash.
- The nav order can follow a simple convention (home first, then `people`, then
  `papers/*`, then the rest alphabetically) computed purely so it is unit-testable. A
  stored, author-controlled nav order is a later refinement (open question).

This is the one genuinely load-bearing backend extension. It is small, read-only, and on
the same module as the existing reads, so it carries low risk. Per the merge-timing rule
it is a data-read change (not a new persisted shape), so it can ship with its UI once
verified.

### 3.3 Directory card `Share to this lab` and lab-page CTAs

The mockup's `Share to this lab` button (directory card) and the lab page's
collaboration actions are the heart of the request. The existing send machinery
(`RecipientShareDialog`) is recipient-FIRST and researcher-keyed (it takes a
`ShareRecipient` with a fingerprint or handle), and it needs a session
(`senderEmail` from `useSharingIdentity`) and the local folder (`ownerUsername`). It is
launched only from `ResearcherProfileModal` today. To point it at a LAB we need to
resolve a lab to a recipient, which is the PI (or a lab inbox). See section 3.5.

Two placements, two very different constraints:

- On `/network` (app origin, `research-os.app`). The session and the local folder ARE
  available here, so the directory card's `Share to this lab` CAN open
  `RecipientShareDialog` directly, exactly like `ResearcherProfileModal` does, with the
  lab's PI as the resolved `ShareRecipient`. This is REUSE plus a thin EXTEND to
  `LabDirectoryCard` (add the button and the dialog mount, gated on `SOCIAL_LAYER_ENABLED`
  and a resolved identity). This is the lowest-risk, highest-value collaboration action.
- On the lab page (`<slug>.research-os.com`, cookie-isolated). No session, no folder, no
  app `/api`. So a `Send data to this lab` button here CANNOT open the dialog. It must
  deep-link to the app origin, for example
  `https://research-os.app/network?share=<slug>` (or `/u/<piHandle>?share=1`), where the
  app resolves the session and opens `RecipientShareDialog`. The lab page button is a
  plain link to the app origin, never an in-page send.

## 3.4 The collaboration action set (the core ask)

For each action, what it does, what it reuses, what is new, and the cookie-isolation
routing. All are gated (section 5) and inert when off.

1. Reach out for collaboration.
   - What. A way to contact the PI / lab to start a conversation (not a data transfer).
   - Reuses. The researcher profile (`/u/<piHandle>`) and the directory trust model
     (verified badge, fingerprint). The simplest honest implementation is a link to the
     PI's profile where the existing contact / share affordances live.
   - New. A `Reach out` button on the lab page that links to
     `https://research-os.app/u/<piHandle>` (app origin). Optionally a lab-scoped contact
     that uses the cookie-free relay (see action 2's relay note) to send a short message.
   - Cookie isolation. Link to the app origin. No session needed on the lab page.

2. Send data to this lab.
   - What. A visitor sends a method, sequence, dataset, or figure to the lab.
   - Reuses. `RecipientShareDialog` plus `share-recipient.ts` plus the relay client
     (`sendShare` / `inviteShare` / `sendRawShare` / `inviteRawShare`) and
     `decideDeliveryMethod`. No new crypto, no new relay protocol.
   - New. Resolving a LAB to a `ShareRecipient` (the PI, or a lab inbox, section 3.5),
     and a `LabCollaborationActions` button. On `/network` it opens the dialog inline; on
     the lab page it deep-links to `research-os.app/network?share=<slug>`.
   - Cookie isolation. The whole send path needs the sender's session, key, and LOCAL
     objects, none of which exist on the lab origin. So on the lab origin this is ALWAYS a
     deep link to the app origin. It is never an in-page send. (Even the email-keyed relay
     path still reads the sender's local objects, which only exist on the app origin.)

3. Request data from this lab.
   - What. A visitor asks the lab FOR something (a strain, a dataset, a protocol).
   - Reuses. The relay's invite / message direction conceptually, but the current relay
     is built for SENDING an object, not for a request-for-data. There is no
     request inbox today.
   - New. This is the most genuinely new action. The lightest cookie-free version is a
     structured message to the lab's relay mailbox (email-keyed), which needs only the
     requester's email plus a short text, so it CAN run cookie-free from the lab origin
     IF we add a small public, cookie-free POST endpoint allowed on the lab origin (a new
     entry in `PUBLIC_LAB_API_PATHS`). A heavier version is a real "lab requests" inbox.
     Recommendation. Start as a deep link to the app origin (a pre-addressed compose), and
     only add the cookie-free request endpoint if Grant wants it to work without leaving
     the lab page. See open questions.
   - Cookie isolation. Deep link by default. A cookie-free request endpoint is possible
     but is new public attack surface on the isolated origin, so it needs explicit
     sign-off and rate-limiting / captcha.

4. (Idea) Visit the lab's people to find a specific collaborator.
   - What. The People page already lists members linking to `/u/<handle>`; surface it as
     a first-class CTA so a reader can pick the right person and share with THEM (the
     existing per-researcher send).
   - Reuses. `LabSiteNav` People page plus `RecipientShareDialog` on the app-origin
     profile. No new backend.
   - Cookie isolation. People links can stay on the lab origin (read-only); the share
     happens on the app-origin profile.

5. (Idea) Cite this lab / copy a citation.
   - What. A copy-to-clipboard citation (lab name, PI, slug URL, and for a paper
     companion the paper line). Pure client, no session, no network.
   - Reuses. Nothing server-side; a tiny clipboard helper.
   - New. A `LabCitation` control. Fully cookie-safe, works on the lab origin.
   - Why it belongs. The lab page is the citable network link, so making the citation one
     click reinforces "this page is the lab's address".

6. (Idea, optional) Follow updates by email.
   - What. A cookie-free email capture so a reader can be told when the lab publishes.
   - Reuses. The same relay / email infra pattern as action 3's request endpoint.
   - New. A public cookie-free POST (same attack-surface caveat as action 3). Likely
     deferred; listed for completeness. Grant decision.

Default recommended set to build first. Actions 1, 2, 4, 5 (reach out, send data, people,
cite), because they reuse existing machinery and need no new cookie-free write endpoint.
Actions 3 and 6 need a product decision on whether to add a cookie-free request inbox.

### 3.5 Resolving a lab to a share recipient

`RecipientShareDialog` takes a `ShareRecipient` (display name, optional fingerprint,
optional handle, `hasPublishedKey`). A lab is not a person. Options:

- PI as recipient (smallest). Resolve the lab's PI handle (the demo has `DEMO_LAB_PI`)
  to a `ShareRecipient` and send to the PI. Honest and reuses everything. For the demo
  this is trivial; for real labs it needs the PI handle on the `lab_sites` profile (3.1).
- Lab inbox (later). A lab-level key / fingerprint so "send to the lab" addresses the lab
  rather than one person. This is a larger identity change (a lab needs a published key);
  defer. Listed as an open question.

Recommendation. PI-as-recipient first; revisit a lab inbox if labs want shared receipt.

## 4. Companion-site linking

A "paper companion" in the model is just a nested native page (the demo's
`papers/fakeyeast-2026`) and/or a BYO static site. There is no page-type field today, so:

- Listing native companion pages. Use the public page listing from 3.2 and treat any page
  whose path starts with `papers/` as a paper companion (a pure convention, unit-testable).
  Render them in a `LabCompanionList` and in the site switcher. No schema change.
- Linking the BYO companion. The lab's BYO site is one per lab, at
  `<slug>.research-os.com/_site/` (after cutover) or `<slug>.research-os.com` (before).
  `LabDirectoryCard` already computes `byoHref` from `LAB_SITE_BYO_PREFIX`. Reuse that
  same derivation in the site switcher and the companion list. Whether a BYO site EXISTS
  is a `getByoSiteByOwner` read (EXTEND the route to pass a boolean `hasByo` to the view,
  so the switcher only shows the BYO card when there is one).
- Per-paper companion granularity. Today there is one BYO bundle per lab, so "per-paper
  companion sites" maps cleanly only to native `papers/*` pages; multiple BYO bundles per
  lab is a larger change (open question). For now, multiple paper companions = multiple
  native `papers/*` pages, optionally each linking out to the single BYO bundle or to an
  external URL the page author writes in markdown.

## 5. The built-in lab site vs BYO static site switcher

The mockup's switcher maps directly onto the two existing stores:

- Built-in lab site = the native-page store (`lab_sites` + `lab_site_pages`), rendered by
  `LabSitePageView`. Its URL is the lab root (`/<slug>` pre-cutover, the subdomain root
  after).
- BYO static site = the BYO store (`lab_byo_sites` + R2), served by the BYO serve route at
  `LAB_SITE_BYO_PREFIX` under the subdomain.

The switcher is a presentational control (`LabSiteSwitcher.tsx`) that shows the two cards
and marks the current one. It needs two inputs the route must pass through: the native
home URL (always present) and the BYO URL plus a `hasByo` boolean (from
`getByoSiteByOwner`). The URL derivation already exists in `LabDirectoryCard` (the
`onComOrigin` branch); factor it into a shared helper so the card, the switcher, and the
companion list agree. On the BYO side, the "back to lab site" control and the mirrored
switcher are authored INSIDE the lab's own bundle (we do not control BYO markup); the demo
bundle should include them, which `demo-lab.ts` `DEMO_BYO_FILES` already enumerates
(`index.html`, `assets/style.css`, `assets/app.js`).

## 6. Flag plan and phasing

### 6.1 Flags (everything inert when off)

From `frontend/src/lib/social/config.ts`:

| Flag | Kind | Gates | Role here |
| --- | --- | --- | --- |
| `SOCIAL_LAYER_ENABLED` (`NEXT_PUBLIC_SOCIAL_LAYER`) | client | `/network`, search, `LabDirectoryCard` | gates the directory card + its `Share to this lab` |
| `isLabSitesEnabled()` (`LAB_SITES_ENABLED`) | server | `research-os.app/<slug>` resolves | gates the public lab page and the new nav / switcher / CTAs |
| `LAB_SITES_ENABLED` (`NEXT_PUBLIC_LAB_SITES`) | client | dashboard authoring UI | unchanged; not required for the read-side enrichment |
| `isLabByoSitesEnabled()` (`LAB_BYO_SITES`) | server | BYO serve route | gates `hasByo` and the BYO switcher card |
| `isLabSitesComOriginEnabled()` (`LAB_SITES_COM_ORIGIN`) | server | subdomain serving + 301 + .com links | flips the page from app origin to cookie-isolated subdomain |

Rules. The new view pieces (header, nav, switcher, CTAs, companion list) live INSIDE
`LabSitePageView`, which only renders when `isLabSitesEnabled()` is true (the route 404s
otherwise), so they are inert by inheritance. The BYO switcher card renders only when the
route passes `hasByo` true (which requires `isLabByoSitesEnabled()`). The directory-card
`Share to this lab` renders only under `SOCIAL_LAYER_ENABLED` and a resolved identity. The
deep-link CTAs (send/request from the lab page) point at `research-os.app` and are always
safe to render because the app origin self-gates the dialog. No new flag is required; all
the new surfaces fold under the three existing gates plus the cutover gate.

### 6.2 Phasing (small, independently shippable, ordered)

Phase 0 (this doc). Design only. Sign-off on the collaboration set (section 3.4) and the
two open data-shape questions (header profile, request inbox).

Phase 1. Lab-page enrichment, demo-scoped, NO schema change. Build `LabIdentityHeader`
(shared, lifted from `LabDirectoryCard`), `LabSiteNav`, `LabSiteSwitcher`,
`LabCompanionList`, and `LabCitation`; mount them in `LabSitePageView`. EXTEND
`lab-site-db.ts` with `listPublishedPages` and EXTEND the route to pass the page list,
`hasByo`, and (demo-only) the `DEMO_LAB_CARD` profile. REUSES the demo-lab-network Phase 1/2
infra (ribbon, card, seed, `demo-lab.ts`) so the demo lab immediately shows the full page.
This is the bulk of the visible win and touches no persisted shape (page listing is a
read).

Phase 2. Collaboration CTAs, reuse-only. Add `Share to this lab` to `LabDirectoryCard`
(opens `RecipientShareDialog` on the app origin, PI-as-recipient). Add
`LabCollaborationActions` to the lab page as DEEP LINKS to `research-os.app` (send data,
reach out, find people). Wire the app-origin `?share=<slug>` / `/u/<handle>?share=1`
handler so the deep link opens the dialog. No cookie-free write endpoint. Reuses
`RecipientShareDialog`, `share-recipient.ts`, the relay client unchanged.

Phase 3. (Conditional on Grant) Request-data path. If Grant wants request-from-lab to work
without leaving the lab page, add a cookie-free public POST to `PUBLIC_LAB_API_PATHS` in
`resolveLabHostRequest`, with rate-limiting / captcha, plus a minimal lab-requests inbox.
Otherwise request-data stays a deep link folded into Phase 2.

Phase 4. (Later) Generalize beyond the demo. Add the lab profile (name, PI, members,
verified domain, fingerprint) to the `lab_sites` row so REAL labs get the header, nav, and
share CTA, not just the demo. Data-shape change, FLAG before committing. Optional
author-controlled nav order and a lab-inbox identity.

Phase 5. (Ops) Cutover. When `*.research-os.com` DNS is wired, flip
`LAB_SITES_COM_ORIGIN`; the page moves to the cookie-isolated origin and the deep-link
CTAs become load-bearing (rather than a convenience). Verify the lab page renders with no
session and the CTAs bounce correctly.

Reuse vs new summary. REUSE the entire render/storage/routing spine, the ribbon, the
directory card, the demo content + seed, and the full `RecipientShareDialog` send path.
NEW is small and presentational (header, nav, switcher, companion list, citation, CTA
buttons) plus one read-only DB helper (`listPublishedPages`) and an app-origin deep-link
handler. The only potentially heavy NEW is the optional cookie-free request inbox (Phase 3).

## 7. Open design questions for Grant

1. RESOLVED (see section 0). All four actions ship in the first build, including Request
   data.
2. RESOLVED (see section 0). Request data deep-links to research-os.app, no cookie-free
   inbox on the .com origin.
3. RESOLVED (see section 0). Sends address the PI, no new lab-inbox identity.
4. Lab header for real labs. OK to ship the page header demo-only first (no schema), and
   add a `lab_sites` profile (name, PI, members, verified domain, fingerprint) only when
   real labs claim sites (a flagged data-shape change)?
5. Per-paper companions. Is "multiple native `papers/*` pages, one BYO bundle per lab"
   enough, or do we need multiple BYO bundles per lab (a larger storage change)?
6. BYO sandbox note and back-link. We do not control BYO markup. Leave the sandbox note
   and the back-to-lab-site link to the lab to author in their bundle (the demo bundle
   includes them), or inject a thin first-party banner above the BYO frame?
7. Theming scope. The native lab site stays on ResearchOS marketing chrome (the mockup
   shows this). Any lab-level theming (accent color, logo) on the native site, or is full
   custom theming strictly the BYO lane?
8. Nav order. Convention-driven order (home, people, papers, rest) for now, or do labs
   need an author-controlled nav ordering in Phase 1?
