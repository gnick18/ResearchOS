# Handoff: marketing + AI surfacing + demo + /ai page + /terms (2026-06-12, updated)

Resume point for the marketing/AI/demo orchestrator session. Everything below is on LOCAL main unless noted. This supersedes the original pause-point handoff (the three in-flight sub-bots are all resolved now).

## Shipped this session

### /terms Terms of service (NEW, research-verified, DRAFT)
- Built the public `/terms` page (`frontend/src/components/terms/TermsOfService.tsx` + `frontend/src/app/terms/page.tsx`), mirroring the `/privacy` page structure and voice. Footer legal row now reads Terms / Privacy / License, `/terms` is in `isPublicMarketingRoute` (bypasses the folder gate) and in the wiki-coverage `EXCLUDED_PREFIXES`. Also corrected the stale `/ai` exclusion comment (it is a marketing page now).
- Ran a deep-research pass against real AGPLv3 / open-core SaaS terms (PostHog, Plausible, Grafana). Verdict: the draft was broadly right (license-vs-terms split, AS-IS + AGPL sections 15-16 + all-caps conspicuousness, 12-month liability-cap structure, no-arbitration / no-class-waiver, single-state Wisconsin law, cancel-anytime / no-unused-refund all match precedent).
- Applied the precedent-backed fixes: a `$100` liability-cap FLOOR (greater-of-fees-or-$100, since a bare 12-month cap is $0 for free users), a consumer-law carve-out, a formal AI / no-professional-advice line, plus the missing standard boilerplate (feedback license, severability, entire agreement, no waiver, assignment, force majeure), an eligibility (13+) clause, and a basic DMCA/copyright-takedown clause.
- STILL A DRAFT, do not ship to prod without a licensed Wisconsin attorney. Open for the lawyer: the exact dollar floor, EU/UK consumer-rights plus a possible GDPR data-processing addendum for international academic users, and sign-off on the DMCA + eligibility clauses. The effective date is a placeholder (June 12, 2026), set the real one at publish.
- An `ACTION FOR GRANT` block was added to the top of AGENTS.md (surfaces on or after 2026-06-13) so a session tomorrow reminds Grant to find an affordable, good Wisconsin/Madison tech-SaaS-IP attorney and helps him run the search.

### /ai BeakerBot marketing page (NEW)
- Retired the old in-app `/ai` palette-opener (Grant's call) and repurposed `/ai` as a public marketing sell page, built to the welcome-page quality bar (shared `MarketingNav` / `MarketingBackdrop` aurora / `Reveal` / `MarketingFooter`, the bold-rainbow treatment, `BeakerBot`). Five capability cards (Data Hub analysis + publication figure, primer design + Tm, PubChem chemistry, cross-type search, experiment chain on a Gantt), grounded in real shipped tools. Leads hard on how CHEAP the AI is (about a penny of compute per analysis, the 750,000-token free gift framed as about 25 cents of compute, no subscription or seat fees, a per-seat-tool contrast). Whitelisted public route, wiki-excluded. A humanizer pass restored contractions and tightened rhythm.
- OPEN, the one concrete remaining marketing build item: `/ai` is ORPHANED. Nothing links to it yet. Wire a "Learn more about BeakerBot" link from the pricing AI section (`id="ai-pricing"`) and the welcome AI showcase, and add BeakerBot/AI to `MarketingNav` (it currently carries only `/` and `/demo`).
- The approved review mockup is `docs/mockups/ai-showcase-2026-06-12.html` (Grant liked it).

### Prior in-flight sub-bots, all recovered and merged
- ai-surface (the BeakerBot free-token gift surfaced across pricing/welcome/settings, one consistent economy of 30k per analysis, 7.5k per quick question, 750k free gift) and demo-polish (`/demo` reads like a real lab, 141 de-DEMO'd data files, `?record=1` recording mode, slimmer demo chrome) were recovered from their worktrees and merged. ai-showcase-mockup was re-dispatched and merged.
- Copy fix: user discovery is shipped, so the WhatsNewModal "coming soon" line was dropped (Grant confirmed `/researchers` is live).

### Earlier this session (from the original handoff)
- Shared marketing motion system (`Reveal` + `MarketingBackdrop`), welcome page rebuilt to the approved IA, settings redesign (full-screen left-rail), pricing AI section + honest savings calculator, product chrome rebranded to ResearchOS LLC, the footer/nav IA split (`MarketingFooter` + `MarketingNav` + `/about`), and the public-marketing-route gate bypass.

## Open / pending
- Wire the `/ai` entry points (orphaned, see above). This is the next obvious build task.
- `/terms` attorney review (see the AGENTS.md ACTION block, surfaces 2026-06-13).
- Standing, at the next prod deploy: set `NEXT_PUBLIC_OAUTH_FIRST_LOGIN=true` in Vercel Production to ship the redesigned login (built and local-only).
- The "penny of compute" cost claim (on `/ai` and `/pricing`), Grant is aware and kept it.
- Parked: the sponsor BeakerBot badge mockup, waiting only on GitHub approving the Sponsors profile.
- Marketing redesign is browser-verified by Grant on `:3000` (he approved welcome, pricing, settings, and `/ai` this session).

## Gotchas reaffirmed this session
- The single `main` checkout is shared across all running sessions, so any one session's `git checkout` or `git merge` drags every session (and Grant's `:3000`). ALWAYS `git branch --show-current` before committing. Build in isolated worktrees off `main`. Land by fast-forward only when the main checkout is free and not mid-merge, and never `git stash` in the shared tree. The recovery branch `wip/shared-tree-snapshot-2026-06-12` holds a snapshot of uncommitted shared-tree edits saved when we re-pinned the checkout back to `main`, so another session can recover its work from there.
- The Data Hub tsc-red on main noted in the original handoff was fixed by the Data Hub session (`d62501944`).
