# Billing facts for customer-facing copy

Canonical reference for anyone writing marketing, pricing, or FAQ copy about
what ResearchOS charges for. Keep this current as billing changes, it is the
single source the branding work pulls from.

Last updated 2026-06-10.

House voice applies to everything written from this file: no em-dashes, no
emojis, no mid-sentence colons, always state the why, no AI-speak.

Status right now: billing is built behind the `BILLING_ENABLED` flag, which is
OFF in production, so all cloud storage is free during the beta. As of the
2026-06-10 demo launch the app itself is publicly live, including sharing and
real-time collaboration. Only billing stays off, so nothing in this file is
charged for yet. The host repo (github.com/gnick18/ResearchOS) is now public.

## The core promise (lead with this)

- The local-first notebook is free and open source forever (AGPLv3). Your data
  lives in your own folder on your own disk. We never need to charge you to use
  ResearchOS for your own research.
- We charge only for optional cloud storage, and only to recover what that
  storage actually costs us. The reason it stays this cheap is the local-first
  design, your everyday work never touches our servers, so our costs are small
  and so is the price.

## Plans (flat bundles, not metered-on-use to the customer)

- One plan picker. Individuals choose Free / Plus / Pro. Labs choose Lab Free /
  Lab Plus / Lab Pro.
- Each plan bundles a storage allowance plus an activity allowance into one
  monthly price, one invoice line. No second meter watching their editing.
- Free tier is 5 GB plus a generous editing allowance, $0. A real working tier,
  not a trial.
- Plus and Pro dollar figures are still PROVISIONAL. Do not print them yet. Safe
  to say "a free tier and low-cost paid tiers for heavier storage."
- The plan STRUCTURE is locked and final (the six names above, one picker, Free
  at 5 GB and $0, shared-pool labs). It is not waiting on a decision. The only
  held item is the Plus and Pro prices, which stay unpublished until a few weeks
  of real usage set them. Treat "the tiers" as settled when writing copy.

## Activity is never billed per edit

- Collaboration and editing are free. We never charge per keystroke or per sync.
- Past the free editing allowance, very heavy real-time editing slows to
  periodic sync (a throttle), it does not generate a surprise bill. If a lab
  keeps hitting it, the PI raises the lab plan.
- Frame this as "your editing is never metered." That is the LabArchives
  trust-flip, their model nickel-and-dimes, ours does not.

## Labs (get this exact)

- The free tier and any paid plan are a shared pool for the whole lab, not
  per-person.
- Only the PI pays, on one consolidated invoice. Members never get billed and
  never enter a card.
- A PI invites members by email and the member must accept before the lab covers
  them. We do not store the email address permanently.
- The PI can see each member's storage and activity use, so they can manage the
  shared pool. Members are told this on accept.

## Supporting us / donations (state the why)

- If someone wants to support the project beyond their own use, the best way is
  two things. First, only buy the amount of cloud storage they actually use, no
  more. Second, support us through GitHub Sponsors.
- Say why GitHub Sponsors is the better way to give: a sponsorship is a direct
  contribution that funds development, and a donation is not subject to sales tax
  the way a product purchase can be, so more of the money reaches the actual dev
  work. Do not assert "it is better" without that reason, researchers read
  unexplained claims as a sales pitch.
- The GitHub Sponsors tiers were renamed so they do not copy the real billing
  tier language. They are recognition and support, not a competing product tier.

## Guardrails worth bragging about

- Cost circuit breaker: we set a hard monthly budget. If cloud spend ever
  approaches it, cloud writes pause and the local-first app keeps working with
  zero interruption. We cannot run up a runaway bill that we then pass to you.
- Pricing philosophy is cost recovery, not profit. We size prices to cover
  infrastructure plus payment processing plus tax, with a small safety buffer so
  we are never underwater. We are not trying to be a money printer.

## Credibility (use lightly)

- ResearchOS is a registered Wisconsin LLC and the merchant of record, with real
  banking and Stripe set up. So paid storage, when it turns on, is a real,
  accountable business, not a hobby donation link.

## Do not publish yet

- No specific Plus or Pro prices, they are provisional until a few weeks of real
  usage data set them.
- Do not imply billing is live. It is off during beta, everything is free right
  now.
- Do not promise "free forever" for cloud storage. The LOCAL notebook is free
  forever. Cloud storage is the optional paid part.
