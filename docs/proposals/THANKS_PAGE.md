# Thanks page (sponsors + open source credits) design doc

Status: draft for Grant. Decisions below are signed off 2026-06-07; build after a
mockup review.
Author: brand manager (Claude), 2026-06-07.

## Goal

One branded page on research-os.app that does two jobs at once, thank the people
who fund ResearchOS (GitHub Sponsors) and credit the open-source projects
ResearchOS is built on. Both are community gratitude, so they live together. The
page is where BeakerBot carries the brand, since GitHub's own Sponsors page is
text-only and we keep it plain.

## Decisions (signed off 2026-06-07)

1. Combined page: sponsors and the open-source credits live on one page.
2. Perks are recognition only (sustainable for a solo maintainer). No support
   SLAs, no gated code.
3. Tier names: Bench ($5), Lab ($25), Institute ($100), a "how much science you
   enable" ladder, with rising BeakerBot rainbow-fill art per tier.
4. GitHub stays the checkout. The page tells the story and links out to Sponsors.

## Route and entry points

- Route: `/thanks` (primary). Add `/sponsors` as a redirect alias so either reads.
- Linked from the AppFooter (next to the existing `/transparency` link) and from
  the README ("Sponsor" + "Acknowledgements" both point here).
- Public, no auth, no folder needed. Excluded from the wiki-coverage map (it is a
  marketing/brand page, not a documented feature).

## Page structure

### 1. Hero

BeakerBot, plus a plain one-liner. Concept-first, no hype. Something like
"ResearchOS is free and open because of the people and projects behind it." Then
two anchor links, "Sponsors" and "Built on open source".

### 2. Sponsors section

- **Three tiers** as cards, left to right, with rising rainbow fill in a BeakerBot
  beaker (Bench = a low fill, Lab = half, Institute = full and just starting to
  overflow). Each card: tier name, monthly price, the recognition it earns, and a
  "Sponsor on GitHub" button linking to
  `https://github.com/sponsors/ResearchOS-LLC`.
- **Recognition per tier (what we actually deliver), revised 2026-06-07:**
  - Bench ($5): the GitHub Sponsor badge (automatic) plus your name on the /thanks
    sponsor wall. Thanks-page only.
  - Lab ($25): everything in Bench, plus name/handle in `SPONSORS.md`, plus your
    lab's logo and link SITE-WIDE (welcome page + wiki footer), secondary placement.
  - Institute ($100): everything in Lab, with the logo featured first and larger
    site-wide.
  - Rationale: "name on the wall" vs "logo at the top of /thanks" was too weak a
    distinction. Real site-wide visibility (welcome + wiki) is what makes the
    higher tiers worth it to a lab. Bench stays thanks-page only.
  - Implementation: a `SponsorStrip` component reads `sponsors.json`, filters to
    Lab + Institute, sorts Institute first / larger, and renders on the welcome
    page (a "Supported by" section) and in the wiki footer (a small logo row).
    Empty state renders nothing (no empty "Supported by" header) until the first
    qualifying sponsor exists.
- **Sponsor wall:** a grid of current backers (name or logo, linked). Shows a warm
  empty state until the first sponsor lands ("Be the first to back ResearchOS").

### 3. Built on open source section

- A short intro: ResearchOS stands on open-source work, and several licenses
  require attribution, so this is both a thank-you and a license obligation.
- A list of the key dependencies grouped (sequence tools, math, crypto, UI, etc.)
  with each project's name, what it does for us, and its license. Sourced from the
  existing `THIRD_PARTY_NOTICES` and `ACKNOWLEDGEMENTS.md` so there is one source
  of truth, not a hand-kept duplicate.
- Call out the immediate attribution debt explicitly: mathjs (Apache-2.0, needs
  NOTICE) and the Biopython Tm port (BSD). These are obligations, not just
  niceties.

## BeakerBot tier art (approved 2026-06-07, mockup reviewed)

Decision changed after the mockup: do NOT vary the fill level. Keep a standard
healthy rainbow fill across all tiers, and instead escalate BeakerBot's EXCITEMENT
as the tier rises. The beaker is the same; the mascot reacts more.

Use the OFFICIAL `BeakerBot` component (`frontend/src/components/BeakerBot.tsx`),
NOT a hand-traced SVG. It already has a `pose` system; map the tiers to real poses:

- Bench ($5): `pose="idle"` with `alive` (content, gently alive).
- Lab ($25): `pose="bouncing"` or `pose="giggle"` (excited). Pick whichever reads
  best in a static-ish card; both are official.
- Institute ($100): `pose="cheering"` (the celebration / ta-da pose), plus a light
  layer of custom-SVG confetti on the card for the payoff.

Respect `prefers-reduced-motion` (the component already gates animation on it).
No emojis anywhere; confetti is custom SVG shapes in the rainbow palette. The
mockup at `docs/mockups/thanks-page.html` shows the intended escalation (content ->
excited -> celebrating) and is the approved reference.

## Data and sources

- **Sponsor list:** start with a hand-curated file at
  `frontend/src/data/sponsors.json` (name, optional logo, optional url, tier).
  This is simplest and fully in our control, and at zero sponsors it is trivial.
  Live fetch from the GitHub Sponsors GraphQL API is a future option but needs a
  token and a server route, not worth it for v1.
- **Open-source credits:** parse or mirror `THIRD_PARTY_NOTICES` /
  `ACKNOWLEDGEMENTS.md` into a small structured list the page renders, so the page
  and the repo files do not drift. A tiny build step or a checked-in derived JSON,
  decide in build.

## What this does NOT promise

No private repos, no priority support, no custom features, no sponsorware. If a
future sponsor perk is added, it must be something deliverable on a solo
maintainer's time. Recognition scales, labor does not.

## Build phases

- Phase 0: this doc, then an interactive HTML mockup of the page for Grant to
  review the layout and the beaker-fill art before any TSX (matches the usual
  redesign-review flow).
- Phase 1: the three BeakerBot fill-level SVGs in `brand/` + generator.
- Phase 2: the `/thanks` route and components (hero, tiers, sponsor wall empty
  state, credits list), `sponsors.json` seed, footer + README links.
- Phase 3: wire the credits list to the existing notices files so it stays current.

## Open items (my defaults, change if you disagree)

1. Route name `/thanks` with `/sponsors` alias (vs `/community` or `/credits`).
2. Sponsor data as a hand-curated `sponsors.json` for now (vs live GitHub API).
3. `SPONSORS.md` created in the repo when the first $25+ sponsor lands (not before).
