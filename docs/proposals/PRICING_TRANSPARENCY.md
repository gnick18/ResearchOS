# Pricing transparency (why we can charge so little, and it is not a scam)

Status: CONTENT DRAFT for review. 2026-06-09. Author: billing manager.
The substance to land at billing launch, in /wiki/trust/how-we-fund-it (fix the
now-false "no paid tier" line), a pricing page, and the marketing/welcome copy
(branding agent polishes voice). Related: project_sustainability_pricing_model,
SPONSORSHIP_TIERS.md, LAB_SHARED_BILLING_POOL.md.

House style: no em-dashes, no emojis, no mid-sentence colons.

## The problem this solves

A hosted ELN (LabArchives and similar) runs hundreds of dollars per seat per
year. If ResearchOS offers more (you own your data, end-to-end encrypted
transfer, NIH-aligned, open source) for $5 or even free, a reasonable scientist
asks "what is the catch." Unexplained cheapness reads as a scam or as a
bait-and-switch. So the price has to come with the reason, in plain language,
where a skeptical PI will see it.

## The honest reason, in one line

Your notebook runs on your own machine, so we are not paying to store every
lab's entire database. The only thing that ever costs us money is the optional
cloud sync, and we charge close to what that actually costs. A competitor is
pricing a hosted database plus a sales team plus investor returns. We are
pricing a thin optional layer on top of a tool that mostly runs on your computer.

## Why it is cheap, laid out

1. Local-first means no bulk server cost. A traditional ELN holds every note,
   image, and dataset for every lab in its own cloud database. That is the
   expensive part, and the per-seat price exists to pay for it (plus margin).
   ResearchOS keeps your data in a folder you own, on your machine. We never
   hold the bulk of your science, so we are not paying to store it.

2. The cloud is optional and metered at cost. The only server cost is the
   optional sync and sharing layer, the shared pool. Files there sit on
   commodity object storage that costs us about $0.015 per gigabyte per month.
   The metered lane passes that through, it is cost recovery, not a markup.

3. No investors, no sales machine. ResearchOS is grant-funded (a UW-Madison RISE
   fellowship) and open source (AGPLv3). There is no venture capital demanding
   a return, no enterprise sales team to fund, and no proprietary lock-in. Those
   are a large part of what a commercial ELN's price actually pays for.

4. Members are free, the lab is the unit. Adding a student or a collaborator
   never raises a bill. The cost of the tool does not grow with the size of the
   lab, the opposite of per-seat pricing.

## The two lanes, kept honest

We do not pretend everything is pure cost recovery. There are two ways money
comes in, and the difference is stated plainly so the margin is never disguised
as "what storage costs."

- Metered storage (cost recovery). A lab that just needs more space pays close
  to our actual provider cost. No markup.
- Sponsorship (support with a thank-you). A lab that wants to back the project
  sponsors a tier and gets a bigger shared pool as a proportional thank-you. The
  surplus over our cost is real, and it is what keeps the tool free for labs that
  cannot pay. That is the point of it, not a hidden profit.

Both are far below a hosted-ELN subscription for the same reason, the bulk of
your work never touches our servers.

## What your sponsorship funds (the line for a PI)

Because a free lab costs us only pennies a month (mostly the cheap object
storage for whatever they choose to sync), one sponsoring lab or department
covers the cloud cost of many free labs. The honest framing is "your support
keeps the tool free for the labs that cannot pay," presented as a range, not a
precise multiplier.

## What we are careful not to say

- Not "free forever, we will never charge." No one can promise the funding
  landscape years out. We say "free and open, supported by a fellowship and
  voluntary contributions, with optional cloud storage metered at cost."
- Not "no paid tier" anymore. That was true before optional cloud storage
  existed, it is not now. The accurate statement is "no FEATURE paywall, every
  feature is free, the only paid thing is optional cloud storage beyond a free
  allowance." This is the specific line to fix in how-we-fund-it at launch.
- Not a hard per-lab-cost number we cannot stand behind. Use ranges, and let the
  re-runnable capacity model (scripts/capacity-model.mjs) back the claims.

## Where it lands (at billing launch, not before)

The public site currently and honestly says there is no paid tier, and billing
is not live to real users yet. So this content ships WITH the billing launch,
not ahead of it. Targets:
- /wiki/trust/how-we-fund-it, replace the "no paid tier" bullet with the feature
  paywall framing and add a "why it costs so little" section.
- A pricing page (the tier ladder) with a short "why this is sustainable" panel
  linking here.
- The welcome/marketing page, the one-line version, "your data lives on your
  machine, so we charge for a thin optional cloud layer, not your whole
  notebook."
- Optionally a row on /transparency, since this is transparency of a different
  kind (cost, not algorithms).
