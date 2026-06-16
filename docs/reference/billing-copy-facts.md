# Billing copy facts (canonical reference)

Status: LOCKED reference from the billing manager (2026-06-10), for the branding role.
This is the single source of truth for any customer-facing copy about cost, plans, or
storage. When a billing fact changes, update it here first, then propagate to pages.
House voice: no em-dashes, no emojis, no mid-sentence colons, always state the why, no AI-speak.

## Publishing rules (hard guardrails)

- BILLING-LIVE-DURING-BETA (Grant, 2026-06-15): real payments are going ON during the beta
  (live testing is the real bug harness, and Stripe Tax auto-handles sales tax). This SUPERSEDES
  the old "everything is free during beta, never imply billing is live" guardrail. Customer copy
  is now FLAG-DRIVEN so it is always truthful as the flags flip: while `BILLING_ENABLED` /
  `AI_BILLING_ENABLED` are off it still reads free-during-beta; once they flip it reads live,
  billed pricing. Server pages (`/pricing`, `/terms`, `/wiki`) read `isBillingEnabled()` /
  `isAiBillingEnabled()` from `lib/billing/config.ts`; the client Welcome page reads
  `NEXT_PUBLIC_BILLING_LIVE`. Do NOT hardcode either state. See
  `docs/proposals/2026-06-13-billing-go-live-checklist.md`.
- STILL IN FORCE: No FINAL Plus or Pro sticker prices in public copy, they are provisional.
  Transparent cost-recovery ESTIMATES are fine when clearly labeled an estimate, not final (the
  pricing-page calculator and the dept/institution builders do this).
- Never say "free forever" about cloud storage. The local notebook is free forever, cloud is
  the optional paid part.

## The core promise (lead with this)

The local-first notebook is free and open source forever (AGPLv3). Your data lives in your
own folder on your own disk. We never need to charge you to use ResearchOS for your own research.

We charge only for optional cloud storage. Individuals and labs pay only what that storage
actually costs us. Departments and institutions pay a modest sustaining rate above cost, and that
surplus keeps ResearchOS free for individual researchers and funds the open-source development.
The reason it all stays this cheap is the local-first design, your everyday work never touches
our servers, so our costs are small and so is the price.

## Plans (flat bundles, not metered-on-use to the customer)

- One plan picker. Individuals choose Free, Plus, or Pro. Labs choose Lab Free, Lab Plus, or Lab Pro.
- Each plan bundles a storage allowance plus an activity allowance into one monthly price, one
  invoice line. There is no second meter watching their editing.
- Free tier is 5 GB plus a generous editing allowance, at $0. A real working tier, not a trial.
- FINAL Plus and Pro sticker prices are provisional, do not print them. Transparent
  cost-recovery estimates are fine when labeled an estimate. Safe public phrasing is "a free tier
  and low-cost paid tiers for heavier storage."

## Activity is never billed per edit (the LabArchives trust-flip)

Collaboration and editing are free. Past the free editing allowance, very heavy real-time
editing slows to periodic sync (a throttle), it does not generate a surprise bill. Frame it as
"your editing is never metered."

## Labs (get this exact)

- The free tier and any paid plan are a shared pool for the whole lab, not per-person.
- Only the PI pays, on one consolidated invoice. Members never get billed and never enter a card.
- The PI invites members by email and the member must accept first. The PI can see each member's
  storage and activity, and members are told this when they accept.

## Departments and institutions (the solidarity tiers, get this exact)

- The heart of the model, and the thing most likely to be reverted by a stale doc.
  Individuals and labs pay COST RECOVERY (what storage costs us, no more). Departments
  and institutions pay a modest SUSTAINING rate ABOVE bare cost, and that surplus keeps
  ResearchOS free for individual researchers and funds the open-source development. This is
  solidarity pricing, NOT a flat "cost-recovery, never profit" model.
- A department is a container of labs, an institution a container of departments. Both are
  AUTOMATED self-serve plan builders on `/pricing` (enter labs / members / adoption / what
  you share, get a monthly rate = cost recovery + a per-active-lab sustaining contribution).
  No voluntary "pay above cost" slider, no manual quoting.
- Billing is an auto recurring Stripe invoice to the procurement office, net terms, ACH or
  card, adjustable any month, no lock-in. GitHub Sponsors cannot invoice a university, so the
  invoice is the institutional channel (and why Sponsors stays an individuals path).
- The admin picks how they pay. Default is the emailed net-30 invoice (procurement, PO). A
  smaller department or a PI can instead auto-charge a card or bank account on file each cycle,
  set up through a quick Stripe Checkout.
- Paying by bank transfer earns a discount, sitewide (orgs and individual + lab plans). The card
  price is the list price; a bank debit (ACH/SEPA) costs us far less, so we pass the saving back
  as a lower price. This is a discount for a lower-cost method, NOT a card surcharge (which is
  why it is allowed in every state). A bank price is only ever payable by a bank debit.
- International payers can pay too (card everywhere, local bank debits where supported). An
  international card costs us more (cross-border + conversion), so the card price is higher for
  an international card while the bank-transfer price stays low. A US lab never subsidizes an
  international card.
- Institutions get a self-serve trust packet (pre-filled HECVAT, security one-pager, the
  open-source code, a standard agreement). Lean on local-first + E2E + Entra SSO as the
  easy-review edge, we hold almost none of their data.
- Frame savings honestly, always SUBTRACT ResearchOS's real optional-cloud cost rather than
  claim "$0, you save everything" (that overclaim reads as a scam).

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
- Pricing philosophy is priced to sustain, not to profit. Individuals and labs pay cost
  recovery, what storage costs us, no more. Departments and institutions pay a modest sustaining
  rate above cost, and that surplus keeps ResearchOS free for individual researchers and funds
  the open-source development. Small safety buffer, never to extract profit.

## Credibility (use lightly)

ResearchOS is a registered Wisconsin LLC and merchant of record, with real banking and Stripe.
Paid storage, when it turns on, is an accountable business.

## Where the numbers live in code (not copy, do not edit as branding)

- The free allowance (5 GB) and plan shapes live in billing constants and `plans.ts`. Those are
  the billing manager's to set. Branding consumes them, it does not change them.
- Confirmed already correct in code (no pending change): the storage-pool free tier is 5 GB.
  `FREE_ALLOWANCE_BYTES = 5 * BYTES_PER_GB` in `frontend/src/lib/billing/config.ts`, and the
  Free plan in `plans.ts` is `5 * GB` (Grant changed it to 5 GB after a detailed price analysis,
  2026-06-09).
- Do not conflate two separate budgets in copy. The persistent storage pool free tier is 5 GB
  (`FREE_ALLOWANCE_BYTES`). The transient sharing inbox is a separate 1 GB cap
  (`FREE_STORAGE_BYTES` in `relay/limits.ts`, delete-on-pickup), and that 1 GB is correct and
  unrelated.

## Where the numbers live (do not override, 2026-06-14)

- Every tunable price/cost number lives in `frontend/src/lib/pricing/assumptions.ts`
  (the public `/pricing` page and the operator price-modeling tool both derive from it).
  The operator-only price-modeling tool (`/admin` -> Modeling section) reads it LIVE and
  is where Grant tunes the economics, with Simulation and Actuals (real-counts) modes.
- The values in `assumptions.ts`, `plans.ts`, and the locked BeakerBot AI-meter rates are
  DELIBERATE RESEARCH DECISIONS. Do not overwrite, round, "simplify", or revert any of
  them without Grant's explicit say-so. To change a price, edit `assumptions.ts` and
  `docs/branding/BILLING_FACTS.md`, never hardcode a number elsewhere.

## What this supersedes

- `docs/proposals/SPONSORSHIP_TIERS.md` framed storage tiers themselves as the sponsor reward.
  That is replaced by the cleaner two-channel model here, plans on Stripe, donations on Sponsors.
  Only the Sponsors-donation framing from that doc survives.
- `docs/mockups/storage-backend-explainer.html` shows a 1 GB free tier. The free tier is 5 GB.
