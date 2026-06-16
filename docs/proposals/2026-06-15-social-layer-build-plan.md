# Social / researcher-network layer — build & sequencing plan

Date: 2026-06-15. Lane: open-asset-library / public-surfaces (INJEST), proposing.

**This is the HOW, not the WHAT.** The *what* is already locked in
`docs/proposals/2026-06-14-researcher-profiles-and-social-layer.md` (+ mockup
`docs/mockups/2026-06-14-researcher-profiles-social.html`). This doc does three
things that spec does not: (1) grounds it in the CURRENT code state via a fresh
audit, (2) holds the social side to the polished public-marketing bar the
`/library` flow just set, and (3) sequences the build against the **Popup Unifier
lane's active identity/directory work** (`docs/proposals/2026-06-15-c3-server-
escrow-crypto-design.md`, branch `feat/identity-c3-escrow`) so the two lanes don't
collide. No code yet — this is for Grant's review.

## Why now

The open-asset library went from "built but undiscoverable" to a polished, woven,
discoverable public surface (marketing landing + nav + footer + BeakerSearch +
settings + a public contribution/moderation flow). The social side has the raw
pieces but is **three disconnected frameworks with no hub, no marketing chrome,
and the institution social pages don't exist.** This plan brings it to library
parity.

## Audit: current state vs the locked spec (2026-06-15)

| Surface | Route / file | State | Shell | Discoverable? |
|---|---|---|---|---|
| Public @handle profile | `app/u/[handle]/page.tsx` | Built but THIN (name+affiliation+avatar; bio/links in the model, not rendered) | Bare (Backdrop + Wordmark, **no MarketingNav/Footer**) | **No** — absent from nav/footer/search; URL-only |
| Researcher directory (search) | `app/researchers/page.tsx` + `ResearcherSearch.tsx` | Built (name/institution search, verified badge, fingerprint) | **AppShell — login + folder gated** (not public like /library) | In-app only |
| Shareable fingerprint profile | `app/researchers/[fingerprint]/` + `ProfileCard.tsx` | Fleshed (cover, avatar, ORCID, pubs) | Bare PageShell | URL/share-link only |
| Your-profile editing | `/settings?section=profile` | Unified + fleshed | SettingsShell | Settings only |
| Institution / dept | `app/institution`, `app/department` | Built but **ADMIN/BILLING PORTALS ONLY** | PortalShell (sign-in gated) | **Only** the `/account` quick-link grid |
| **Public institution PROFILE page** | — | **ABSENT** | — | — |
| **Institution member DIRECTORY (LinkedIn-style)** | — | **ABSENT** (the spec's headline feature) | — | — |
| **Social graph (connect / mutual)** | — | **STUBBED** — discovery is read-only; sending still goes via email relay | — | — |
| **A social/network HUB landing** | — | **ABSENT** (no `/library`-equivalent) | — | — |

Net: profiles + directory + org portals EXIST and are individually decent, but
they are **fragmented, undiscoverable, and missing the connective tissue** (hub
landing, public institution pages, member directory, connections) that the spec
describes and that would make this a first-class product surface.

## Design principles (carry over from the library build)

1. **One public framework.** Every public social surface uses the same chrome as
   `/library`: `MarketingNav` + `MarketingBackdrop` + `Reveal` + `Kicker` +
   `MarketingFooter`, with the route in the providers public bypass. No more
   three-shell drift.
2. **Discoverable by construction.** Anything user-facing lands in MarketingNav +
   footer + BeakerSearch + (where in-app) the nav More-overflow — the same sweep
   `/library` got.
3. **Consume, don't re-own, identity.** The public layer READS Popup's directory /
   account-profile model through the existing API seam (`/api/account/public`,
   `/api/directory/*`). It does not reshape keypairs, escrow, or the email_hash
   directory binding — that is Popup's C3 surface.
4. **Listed-by-default + opt-out** (locked spec decision) — a profile is in the
   directory unless the user opts out; opting out hides them from search +
   institution member lists.

## Coordination boundary with Popup Unifier (hard line)

| Popup owns (identity/directory plumbing) | This lane owns (public-facing layer) |
|---|---|
| Keypair, escrow, OAuth-gated reissue (C3) | Hub landing, `/u` marketing chrome |
| `email_hash → ownerKey` directory binding | Institution public pages + member-directory UI |
| Account portability (graduating-student email/provider rebind) | Connections UX (consuming the trust-graph backend) |
| `lib/sharing/identity/*`, `lib/sharing/directory/*` schema + routes | Discoverability sweep (nav/footer/BeakerSearch) |
| New directory READ endpoints (e.g. list institution members) | Calling those endpoints + rendering |

Rule: **any new `/api/directory/*` route or change under `lib/sharing/identity|directory/*`
is Popup's** — I request it from them, I do not author it. I ping `local_469c681b`
before touching that tree, per their forward-coordination note.

## Build phases (independent-first, dependency-gated)

### Phase A — Public surface + discoverability (LOW Popup overlap; buildable ~now)
The presentation + reachability layer. Reads existing APIs; touches no identity code.
- **A1. `/u/[handle]` to library parity** — wrap in MarketingNav + MarketingFooter;
  render the bio + typed links (ORCID/ResearchGate/website) + verified badge that
  already exist on `AccountProfile` but aren't shown. Pure presentation over
  `/api/account/public`.
- **A2. Researcher-network HUB landing** — a PUBLIC `/network` (or public `/researchers`)
  marketing landing in the `/library` mold: hero + Kicker + value prop + a live,
  login-free search over the public directory, with CTAs into profiles. (Today's
  `/researchers` search is AppShell-gated; keep the in-app version, add the public
  landing.) Needs a public read of the directory search — confirm with Popup whether
  `/api/directory/researcher` can serve unauthenticated search or needs a sibling.
- **A3. Discoverability sweep** — add "Network" (or "Researchers") to `MarketingNav`
  NAV_LINKS, `MarketingFooter` COLUMNS, and BeakerSearch (`useGlobalCommands`); add
  the route(s) to the providers public bypass. Mirror the `/library` wiring exactly,
  and ADD `/network` (and any new route) to `check-wiki-coverage.mjs` EXCLUDED_PREFIXES
  or APP_ROUTE_TO_WIKI **before merge** (the gate that bricked the deploy on 2026-06-15).
- Flag: `NEXT_PUBLIC_SOCIAL_LAYER` (new, default off).

### Phase B — Public institution pages + member directory (NEEDS Popup directory reads)
The spec's headline gap.
- **B1. Public institution profile** — `/institution/[slug]` (distinct from the
  sign-in-gated `/institution` admin portal): name, branding/logo, departments, and
  the LISTED-MEMBER DIRECTORY (LinkedIn-style, opt-out hides you). Same public chrome.
- **B2. Directory read endpoint** — list an institution's listed members (handle,
  display name, affiliation, avatar, verified) honoring opt-out. **Popup authors this**
  under `lib/sharing/directory/*` + `/api/directory/*`; I consume it.
- **B3. Profile↔institution links** — `@X at Institution Y →` on `/u/[handle]` and the
  network hub; institution search/browse entry.
- Depends on: the institution tier flags (`NEXT_PUBLIC_INSTITUTION_TIER_ENABLED`) and
  Popup's directory binding. Coordinate the member-list contract first.

### Phase C — Connections / trust graph (HIGH Popup overlap; Popup backend, my UI)
- **C1. Connect / mutual-connection** UX on profiles + the hub (the spec's "connections
  (the trust graph)" section). The graph storage + signing is identity-adjacent →
  Popup owns the backend; I own the surface. Joint design before build.
- **C2. Seamless external-collaborator sharing** — wire a found researcher directly into
  the send flow (the spec's payoff; today sending still needs their email). Depends on
  C3 directory key material being reachable. Popup-led.

### Phase D — Account portability (Popup-OWNED; listed for completeness)
Graduating-student email/provider rebind is squarely Popup's C3 escrow/reissue work.
Not this lane; tracked so the social layer doesn't duplicate it.

## What I can start the moment you say go (and Popup okays the seam)

Phase A in full — it's the highest-visibility, lowest-collision slice: `/u` parity,
the public network hub landing, and the discoverability sweep, all on the `/library`
framework. The only Popup touchpoint in A is confirming whether the directory search
can serve an unauthenticated public read (A2); everything else is presentation over
existing public endpoints + the same nav/footer/search wiring I just shipped for the
library.

## Open decisions for Grant

1. **Hub route name** — `/network`, public `/researchers`, or `/community`? (Affects nav
   label + the wiki-coverage exclusion.)
2. **Public directory search** — OK to expose an unauthenticated, listed-only researcher
   search on the public hub (names + affiliation + ORCID, never email)? The locked spec
   says listed-by-default; this confirms it's OK login-free.
3. **Institution page provisioning** — auto-create a public institution page from the
   verified-domain cluster of listed members, or only when an institution admin claims
   it? (Spec discusses both; pick the v1 default.)
4. **Scope of v1** — ship Phase A alone first (parity + discoverability, fast win), or
   hold for A+B together (so institutions launch with the network)?

## Relevant code (from the audit)

- Profiles: `app/u/[handle]/page.tsx`, `lib/account/account-profile.ts` (bio/links/avatar
  already modeled), `app/api/account/public/route.ts`.
- Directory: `app/researchers/page.tsx`, `components/sharing/ResearcherSearch.tsx`,
  `components/researchers/{ResearcherProfile,ProfileCard}.tsx`,
  `app/api/directory/researcher/route.ts`.
- Org: `app/institution/*`, `app/department/*`, `components/portal/PortalShell.tsx`,
  `lib/institution/config.ts`, `lib/dept/config.ts`.
- Discoverability seams (same as the library sweep): `components/MarketingNav.tsx`,
  `components/MarketingFooter.tsx`, `components/beaker-search/useGlobalCommands.ts`,
  `lib/nav.ts`, `lib/providers.tsx` (public bypass), `scripts/check-wiki-coverage.mjs`.
- Identity/directory plumbing (POPUP-OWNED, do not edit without coordinating):
  `lib/sharing/identity/*`, `lib/sharing/directory/*`, `lib/account/*`,
  `docs/proposals/2026-06-15-c3-server-escrow-crypto-design.md`.
