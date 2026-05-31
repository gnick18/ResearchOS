# Sustainability + positioning brief (for the landing-page rewrite)

Author: HR orchestrator, 2026-05-31, from a strategy discussion with Grant. This is a BRIEF, not the page. The landing page (`frontend/src/components/landing/LandingPage.tsx`) is owned by the parallel chat; this doc hands it precise replacement copy + the strategy behind it. HR drafts, the parallel chat executes the actual edits.

## Why this exists (the liability)

The landing page currently makes an absolute "free forever, no pricing page ever" promise. We are about to build a paid hosted tier, so that copy would become a walk-back that damages trust. The fix is not to hide the money story. It is to tell the HONEST open-core version, where the promise we keep is real and the revenue path is clear.

## The model: open-core, told honestly

Two things, kept distinct in every line of copy:

- THE SOFTWARE is free and open source, forever. Anyone can clone the repo, install the dependencies, run a local server, and have everything the website has, at zero cost, always. This is the "free forever" we can truthfully promise.
- THE HOSTED SERVICE (the website) is the convenience layer for people who do not want to self-host. It is what sustains the project. Its pricing phases:
  - BETA (now): the whole site is free for everyone. We are grateful to early adopters and say so.
  - POST-BETA: a limited-time early-adopter "founding lab" one-time lifetime deal (will not last forever), which may later become a modest annual per-lab cost to fund maintenance and support.
  - ALWAYS: individual / solo researchers stay free on the hosted version. Self-hosting stays free for everyone, forever.

The data-ownership story makes the promise airtight: we never lock data behind a paywall because the data lives in the user's own folder, not on our servers. Even a paying lab can walk away with everything at any time.

## Positioning additions (new framing to add)

1. By academics, for academics. ResearchOS was built by a researcher, in a lab, for researchers, not by a venture-backed enterprise vendor. Lead with this identity high on the page. It is the trust anchor and the differentiator.
2. Who it is for (be honest + targeted): solo researchers and labs up to roughly 30 people. This is the segment that big-vendor per-seat pricing prices out. Naming the ideal user builds credibility and sets correct expectations.
3. Tie the values together: local-first, your data stays yours, open formats, no lock-in, open source. These are not just features, they are academic values. The positioning should connect them to "by academics, for academics."

## The headline cost story (use this, it is the pitch)

LabArchives charges $330 per head per year. A 30-person lab pays them roughly $9,900 a year. At a flat per-lab price, ResearchOS for an ENTIRE lab costs less than a single LabArchives seat. Per-lab, not per-head, is the differentiator. Lead the comparison with it. (During beta this is simply "free for everyone"; the per-lab cost story is the post-beta framing.)

## Where the money goes (a short mission / transparency note)

A brief, plain section. ResearchOS is being filed as an LLC in Wisconsin so it can legitimately accept support. Money from hosted labs goes to: hosting costs, ongoing maintenance, helping labs get set up, and, longer term, funding a maintainer / support staff so the tool can grow without coming out of one person's pocket. Frame it as mission-driven sustainability, not profit. This section is what makes asking for money feel honest rather than mercenary.

## The exact copy fixes (worst-first)

Every reference is in `frontend/src/components/landing/LandingPage.tsx`. Line numbers are as of 2026-05-31; the parallel chat should match on text, not line number.

1. CRITICAL, line ~498: "There is no pricing page, and there never [will be]". This is the line that becomes a lie. Replace with the open-core story. Suggested copy:
   "ResearchOS is open source, so you can always run it yourself for free, forever. The hosted version you are using is free for everyone while we are in beta, and we are grateful to the early labs helping us build it. Down the line, labs that want us to host it for them will be able to chip in to keep the project sustainable, and individual researchers will always be free. Your data lives in your own folder, never on our servers, so it is never behind a paywall: you can take everything and leave at any time."

2. line ~480, section title "Free, forever". Rescope to the software, not the hosted service. Suggested: "Free to run, forever" or "Free and open, forever", with the body clarifying self-host-free-forever + hosted-free-in-beta.

3. line ~741, comparison cell "None: the whole lab, free" (the per-seat row). Keep the per-seat win, make it future-proof. Suggested: "No per-seat charges, ever: one lab, one price (free during beta)."

4. line ~733, comparison "Price" cell, us = "Free and open source, forever". Defensible for the software, but pair it with the hosted nuance so it is not read as "hosting is free forever for labs". Suggested: "Free and open source. Self-host free forever; hosted free in beta." Keep them = "$330+ per user, per year".

5. lines ~410 / ~416 (hero "A free, local-first lab notebook" / "ResearchOS is a free electronic lab notebook ..."). Keep "free" (true) but weave in the new positioning nearby: add a "Built by an academic, for academics" line and the "for solo researchers and labs up to ~30" framing.

6. line ~475 ("we can keep it free and why your privacy isn't ours to leak") and line ~929 ("It is free, it is yours, and you can leave any time"). Both are fine in spirit; just make sure "free" reads as "free to self-host + free for individuals + free in beta", consistent with the rewritten pricing section above. No hard walk-back here, only consistency.

Also update the `/welcome` route metadata description in `frontend/src/app/welcome/page.tsx:17` if the hero tagline changes, so the social/meta copy stays in sync (that file is a thin wrapper HR can touch if needed, but coordinate so it matches the landing rewrite).

## Phasing (do not overpromise a product that cannot transact yet)

- PHASE 1 (now, beta): land the positioning (academics-for-academics, ideal user), fix the "never charge" liability, plant the open-core sustainability story + the where-the-money-goes note, and the beta-free + gratitude framing. NO live price, NO checkout. This removes the liability and tells the honest story without selling something we cannot yet legally sell.
- PHASE 2 (after the LLC is filed + a payment path exists): add the concrete founding-lab pricing + a real checkout, and a pricing/sustainability page.

## Voice guardrails

Concept-first, honest, plain. Never promise the hosted service is free forever for labs. Never imply data lock-in (the opposite is our whole story). No em-dashes (use commas, colons, parentheses, period splits). No emojis. Custom inline SVG for any icon. Keep BeakerBot as the only mascot. The north star: a reader should finish the page trusting us MORE because we were straight about how this stays alive, not less.
