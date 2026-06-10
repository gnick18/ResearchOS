# Billing copy facts (canonical reference)

Status: LOCKED reference from the billing manager (2026-06-10), for the branding role.
This is the single source of truth for any customer-facing copy about cost, plans, or
storage. When a billing fact changes, update it here first, then propagate to pages.
House voice: no em-dashes, no emojis, no mid-sentence colons, always state the why, no AI-speak.

## Do not publish yet (hard guardrails)

- Everything below is built behind `BILLING_ENABLED`, which is OFF in production. The whole
  app is free during beta. Never imply billing is live.
- No specific Plus or Pro dollar figures in any public copy. They are provisional.
- Never say "free forever" about cloud storage. The local notebook is free forever, cloud is
  the optional paid part.

## The core promise (lead with this)

The local-first notebook is free and open source forever (AGPLv3). Your data lives in your
own folder on your own disk. We never need to charge you to use ResearchOS for your own research.

We charge only for optional cloud storage, and only to recover what that storage actually costs
us. The reason it stays this cheap is the local-first design, your everyday work never touches
our servers, so our costs are small and so is the price.

## Plans (flat bundles, not metered-on-use to the customer)

- One plan picker. Individuals choose Free, Plus, or Pro. Labs choose Lab Free, Lab Plus, or Lab Pro.
- Each plan bundles a storage allowance plus an activity allowance into one monthly price, one
  invoice line. There is no second meter watching their editing.
- Free tier is 5 GB plus a generous editing allowance, at $0. A real working tier, not a trial.
- Plus and Pro dollar figures are provisional. Do not print them. Safe public phrasing is
  "a free tier and low-cost paid tiers for heavier storage."

## Activity is never billed per edit (the LabArchives trust-flip)

Collaboration and editing are free. Past the free editing allowance, very heavy real-time
editing slows to periodic sync (a throttle), it does not generate a surprise bill. Frame it as
"your editing is never metered."

## Labs (get this exact)

- The free tier and any paid plan are a shared pool for the whole lab, not per-person.
- Only the PI pays, on one consolidated invoice. Members never get billed and never enter a card.
- The PI invites members by email and the member must accept first. The PI can see each member's
  storage and activity, and members are told this when they accept.

## Supporting us / donations (state the why)

The best way to support us beyond your own use is two things, buy only the storage you actually
use, and support through GitHub Sponsors.

Why Sponsors is better, with the reason (do not assert it bare, researchers read unexplained
claims as a sales pitch): a sponsorship is a direct contribution that funds development, and a
donation is not subject to sales tax the way a product purchase can be, so more of the money
reaches the actual dev work.

GitHub Sponsors is recognition-only (a thank-you and credits-wall placement, no storage benefit).
The storage plans live on Stripe. Keep the two channels distinct.

## Guardrails worth bragging about

- Cost circuit breaker, a hard monthly budget. If cloud spend nears it, cloud writes pause and
  the local-first app keeps working uninterrupted. We cannot run up a runaway bill and pass it
  to you.
- Pricing philosophy is cost recovery, not profit, with a small safety buffer so we are never
  underwater.

## Credibility (use lightly)

ResearchOS is a registered Wisconsin LLC and merchant of record, with real banking and Stripe.
Paid storage, when it turns on, is an accountable business.

## Where the numbers live in code (not copy, do not edit as branding)

- The free allowance (5 GB) and plan shapes live in billing constants and `plans.ts`. Those are
  the billing manager's to set. Branding consumes them, it does not change them.
- Items flagged for the billing manager to reconcile to this reference:
  - The free allowance constant if it is still the old 1 GB value (this doc says 5 GB).
  - `plans.ts` tier shapes for Free/Plus/Pro and Lab Free/Plus/Pro.

## What this supersedes

- `docs/proposals/SPONSORSHIP_TIERS.md` framed storage tiers themselves as the sponsor reward.
  That is replaced by the cleaner two-channel model here, plans on Stripe, donations on Sponsors.
  Only the Sponsors-donation framing from that doc survives.
- `docs/mockups/storage-backend-explainer.html` shows a 1 GB free tier. The free tier is 5 GB.
