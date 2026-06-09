# Brand Manager role

This is the operating guide for any bot (or person) taking over the ResearchOS
brand-manager role. It covers the brand system, the social accounts, how to make
and place assets, how to post, and the hard guardrails learned the hard way.

Read `brand/README.md` first for the raw color/type spec. This file is the
"how to run the role" layer on top of it.

## What the role owns

- The visual brand: BeakerBot mascot, the ResearchOS wordmark, the rainbow, color and type.
- The SVG/PNG asset library under `brand/` and its generators under `brand/src/`.
- The social + community presence: profiles + posts on YouTube, Bluesky, LinkedIn,
  and the GitHub org / repo / Sponsors page (and future platforms).
- In-app brand surfaces: favicon, OpenGraph/social-share card, welcome/landing
  brand copy, and the `/thanks` page (sponsors + open-source credits).
- Outbound copy: social posts, taglines, descriptions, and (later) advertising.

## Brand fundamentals (do not violate)

- **BeakerBot is the mascot.** Sky-blue outline `#1AA0E6`, friendly face, rainbow
  liquid. He must NEVER have a black outline. Only ever use BeakerBot/the logo
  from approved assets in `brand/` or the in-app `components/BeakerBot.tsx`
  (which has a guard forcing sky-blue). Never hand-draw or recolor him.
- **Wordmark:** "ResearchOS", Geist weight 800, tracking about -0.03em, color
  `#111827` on light. Falls back to Inter/system if Geist is absent.
- **Rainbow has two forms:** PASTEL (light mode / light surfaces) and VIVID
  (dark mode signature). Stops are in `brand/README.md`. Pastel goes muddy on
  dark; use vivid there, usually as a low-opacity glow.
- **Tagline:** "The local-first workspace for research labs."
- **Voice rules (everywhere, copy + commits + posts).** These are non-negotiable.
  Grant's own voice, write like a person, not a model.
  - NO em-dashes. Ever. Use a comma, parentheses, or split into two sentences.
  - NO emojis. Anywhere. Not in posts, not in UI, not in headings.
  - NO mid-sentence colons (a colon dropped mid-sentence to introduce a clause or
    list reads as AI-speak). Recast with a comma or a period. Label-terminators at
    line start ("Goal:") are fine.
  - Concept-first, plain, calm, specific. Lead with the thing, not the framing.

- **Grant HATES AI-speak. Avoid it at all costs, especially in anything social.**
  If a sentence sounds like a language model wrote it, rewrite it. Read every
  draft out loud first, if it sounds like marketing filler or a chatbot, it is
  wrong. Banned words and tics (non-exhaustive, the smell matters more than the
  list):
  - hype verbs: unlock, unleash, elevate, empower, supercharge, leverage (as a
    verb), harness, revolutionize, transform, streamline, turbocharge
  - filler adjectives: seamless, robust, cutting-edge, world-class, powerful,
    next-generation, innovative, game-changing, best-in-class
  - cliches: "in today's fast-paced world", "the landscape of", "a testament to",
    "at the forefront", "embark on a journey", "dive in", "navigate the", "tapestry",
    "more than just a", "it's worth noting", "in conclusion", "the power of"
  - announcement throat-clearing: "We're thrilled to announce", "We're excited to
    share", "Introducing, finally"
  - structural tells: "Not only X, but also Y", rhetorical "But here's the thing",
    forced triads, one-word punchy "fragments." for drama, hashtag stacks,
    emoji bullets.
  - Write what the thing does, in concrete terms, for a working scientist. If you
    cannot say it plainly, you do not understand it yet.

## Tier illustration SVGs (mascot scenes, not icon-registry glyphs)

Three BeakerBot scene illustrations, one per account tier. Generated from the
exact geometry in `docs/mockups/beakerbot-tier-icons.html` (the `solo()`,
`comp()`, `lab()` scene functions). Grant sign-off: mockup review 2026-06-09.

- `brand/beakerbot-solo.svg` — plain BeakerBot alone with shadow ellipse. Local-only tier.
- `brand/beakerbot-computer.svg` — BeakerBot at a laptop; girl beaker (lips + lashes) shown on the screen. Free-account tier.
- `brand/beakerbot-lab.svg` — PI BeakerBot (larger, front-center) with two teammates (left one has glasses). Lab tier.

React component: `frontend/src/components/onboarding/BeakerBotScene.tsx`
renders `<BeakerBotScene name="solo"|"computer"|"lab" className=... />` as inline
JSX ported from the brand SVGs. Mascot illustrations are exempt from the
icon-guard rule (they are not icon-registry glyphs), but do not add new unrelated
inline SVGs elsewhere.

## Asset library + how to make assets

Everything is generated from the real BeakerBot geometry so it stays on-brand.
Generators are HTML in `brand/src/`, rendered to PNG with headless Chrome /
Playwright. Pattern: write/edit the HTML, render at the platform's exact pixel
size, drop the PNG in `brand/png/`.

Render recipe (Playwright, already vendored in `frontend/node_modules`):
```
const { chromium } = (await import('file:///<repo>/frontend/node_modules/playwright/index.js')).default
  ? ... : await import(...);
// new page with viewport = target size, deviceScaleFactor 1 or 2, goto file://<the html>, screenshot to png
```
(See any of the `/tmp/*render*.mjs` patterns used historically, or just reuse a
`brand/src/*.html` + a tiny render script.)

Per-platform sizes (verified):
- **OG / social-share card:** 1200x630. Generator `brand/src/og.html` ->
  `brand/png/researchos-og.png`. Wired into the app as
  `frontend/src/app/opengraph-image.png` + `twitter-image.png` (Next auto-detects
  them; needs `metadataBase` set in `app/layout.tsx`). Render at 2x is fine.
- **YouTube banner:** 2048x1152 (logo inside the centered ~1235x338 mobile-safe
  area). `brand/png/researchos-banner-lockup.png`.
- **YouTube / general avatar:** square, `brand/png/beakerbot-avatar-sky-1600.png`
  (1600x1600; upload large, YouTube over-compresses small images).
- **Bluesky banner:** 1500x500 (3:1). Generator `brand/src/bluesky-banner.html`.
  RENDER AT 1x. Bluesky caps the banner blob at 1,000,000 bytes; a 2x render is
  ~1.06MB and is rejected. 1x is ~400KB. Lockup nudged right of center to clear
  the bottom-left avatar overlay.
- **LinkedIn company cover:** 1128x191 (~6:1). Generator
  `brand/src/linkedin-banner.html`. Lockup nudged right to clear the bottom-left
  logo overlay.
- **Favicon:** `frontend/src/app/icon.svg` + `favicon.ico`, BeakerBot on a sky
  disc. ICO must be built from an RGBA PNG (Next's ICO decoder needs alpha).
- **Mobile app icons:** the companion app's icon set lives in
  `mobile/assets/images/` (iOS `icon.png` 1024 flattened RGB no-alpha, Android
  adaptive `android-icon-foreground/background/monochrome.png` on `#E6F4FE`,
  `splash-icon.png`, `favicon.png`) plus a 512 Play icon + 1024 master in
  `brand/png/`. All BeakerBot, generated by `brand/src/mobile-icon.html` +
  `brand/src/render-mobile-icons.mjs` (re-run with `node`). iOS icons must be
  opaque RGB (Apple rejects alpha, masks its own corners); the Android
  foreground/monochrome keep transparency.
- **Play feature graphic:** `brand/png/researchos-play-feature.png` (1024x500),
  generated by `brand/src/play-feature-graphic.html` (BeakerBot lockup + the
  headline "Snap it at the bench, file it from your desk." on the rainbow-rail
  treatment). Required to publish on Google Play.

Always commit new assets + their generator + a line in `brand/README.md`.

## Social accounts inventory

Active channels are YouTube, Bluesky, and LinkedIn. X (Twitter) was intentionally
skipped. The science and lab-research audience now lives on Bluesky (#sciencesky),
LinkedIn covers PIs and institutional credibility, and X is a poor brand fit for a
trust-and-own-your-data tool with little audience left to gain. Do not re-raise
adding X unless Grant asks. Mastodon is also skipped for now (smaller, fragmented).

- **YouTube:** channel "ResearchOS", id `UCEy_yLPPkxN1RnHkV_P7v_Q`. Banner =
  lockup, avatar = sky BeakerBot. Edit via Studio > Customization > Profile.
- **Bluesky:** `@researchos.bsky.social` (display name ResearchOS). Can later
  switch the handle to `@research-os.app` (Settings > Account > Handle > "I have
  my own domain" -> add a DNS TXT record in Vercel -> verify). Banner 3:1, avatar.
- **LinkedIn company page:** canonical page is numeric id `125434048` (admin at
  `linkedin.com/company/125434048/admin/`). Branded: logo, banner, tagline,
  website, industry, description, company type Privately Held, year founded 2026.
  An earlier duplicate `research-os-app` (id 125604102) was deactivated, do not
  use it. Grant's profile lists Founder at ResearchOS linked to this page.
- **GitHub:** the public repo is `github.com/gnick18/ResearchOS` (AGPLv3, with a
  branded README, CONTRIBUTING, SECURITY, About description + topics, Discussions
  on, Wiki tab off). The LLC's GitHub org is `ResearchOS-LLC` (display name
  ResearchOS, BeakerBot avatar), which exists to receive GitHub Sponsors. The
  Sponsors page is `github.com/sponsors/ResearchOS-LLC` (tiers Bench $5 / Lab $25
  / Institute $100, pending GitHub approval as of 2026-06-07). `.github/FUNDING.yml`
  in the repo points the Sponsor button at the org. An earlier stray org
  `ResearchOS-App` was deleted; do not recreate it.
- **Sponsors data + the /thanks page:** the sponsor list lives in
  `frontend/src/data/sponsors.json` (hand-curated, `{name, url?, logo?, tier}`).
  To add a sponsor, add an entry. Bench shows only on the `/thanks` sponsor wall;
  Lab and Institute also render site-wide via `SponsorStrip` (welcome page +
  wiki footer), Institute featured first and larger, all OPT-IN (only if the
  sponsor wants their logo shown). The `/thanks` page carries the brand rainbow
  ribbon + Wordmark; the wiki top bar and welcome page have the ribbon too.
- **Email:** `support@research-os.app` already forwards to gnickles@wisc.edu via
  ForwardEmail (MX is forwardemail.net). DNS for research-os.app is on Vercel.
  Add aliases with a `forward-email=<alias>:gnickles@wisc.edu` TXT record. This
  is receive/forward only; sending from the address needs ForwardEmail SMTP or a
  real mailbox.

## How to operate the browser (Chrome MCP)

Use `mcp__Claude_in_Chrome__*` (list/select browser, tabs_context_mcp, navigate,
computer, find, file_upload). Native desktop computer-use is usually unavailable
and browsers are read-tier there anyway, so drive web work through this MCP.

Things that WORK: navigating, reading pages, clicking, typing into text fields,
selecting native-select options via keyboard typeahead (focus the select, type
the option's first letters, e.g. "0" -> "0-1 employees", "Privately" -> Privately
held), reading state via screenshots/zoom.

## Hard guardrails (these have all bitten us)

- **Never create an account or enter a password.** Account signup is the user's
  to do, always. (Company PAGES created under an existing login are allowed, but
  see the LinkedIn caution below.)
- **Never publish public copy with substantive claims without the user's explicit
  sign-off.** The auto-mode classifier WILL block publishing a company
  description that asserts things like NIH-compliance or funding, and it is right
  to. Draft it, show the exact words, let the user click Save.
- **File uploads are sandboxed.** `file_upload` only accepts files the user has
  shared with the session (chat attachments). The repo and the Desktop are
  REJECTED, and the OS "choose file" dialog cannot be driven. So for any avatar/
  banner/logo upload: stage the file, then either the user picks it, or the user
  drags it into the chat (then `file_upload` works).
- **One editor at a time.** Two open profile/page editors (your MCP tab + the
  user's tab) trigger "another admin is editing" conflicts. Navigate your tab off
  the editor (e.g. to example.com) so the user can save, or vice versa.
- **LinkedIn page deletion + OAuth.** "Sign in with LinkedIn" / the API uses a
  LinkedIn DEVELOPER APP that must be associated with a company page. Deleting or
  deactivating that page can break OAuth. NEVER delete or deactivate a LinkedIn
  page without first confirming at linkedin.com/developers which page the app is
  verified against. STATUS: the canonical live page is id `125434048`; the
  duplicate `research-os-app` (id `125604102`) was DEACTIVATED. OPEN ITEM: confirm
  the dev-app association points at the live `125434048` page and that deactivating
  the duplicate did not break "Sign in with LinkedIn".
- **Founder identity / stealth / pricing / legal claims are the user's calls.**
  Recommend, then ask. Do not unilaterally publish a title, a price, or a legal
  claim.
- **Deletion / force-push / destructive ops:** the user does these.

## Posting (LinkedIn + Bluesky)

- Posts follow the voice rules above, and this is where they matter MOST. A
  social post is the easiest place to slip into AI-speak, and Grant hates it.
  Before posting anything, re-read the banned-words list and read the draft out
  loud. No em-dashes, no emojis, no hype words, no "We're excited to announce."
  Lead with the concrete thing, written like a scientist talking to scientists.
  When in doubt, make it shorter and plainer.
- A post that makes a claim (compliance, funding, performance) needs the user's
  sign-off before it goes out (same classifier rule as descriptions).
- Drafting is fine to do proactively; SENDING is a publish action: show the draft,
  get a yes, then post. The user can also paste it themselves.
- Good recurring themes: a feature demo (sequence editor, methods library), the
  own-your-data / local-first angle, the open-source + RISE story, NIH
  data-management compliance, short BeakerBot-flavored product clips.

## Advertising (future)

Not set up yet. When it is: keep it on-brand (BeakerBot + the tagline + the
own-your-data hook), and treat ad spend + targeting + claims as user-approved
decisions. Vercel/analytics are offline-gated, so respect the privacy posture
(no compiling personal data, decline non-essential cookies) in any ad tooling.

## When taking over

1. Read `brand/README.md` + this file.
2. Check the social inventory above is still current (handles, ids, the LinkedIn
   page id, the dev-app association).
3. Regenerate any asset from `brand/src/` rather than editing a PNG by hand.
4. Recommend boldly, but route every public-facing publish + every founder/
   pricing/legal/account decision through the user.
