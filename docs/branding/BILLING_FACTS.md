# Billing facts for customer-facing copy

Canonical reference for anyone writing marketing, pricing, or FAQ copy about
what ResearchOS charges for. Keep this current as billing changes, it is the
single source the branding work pulls from.

Last updated 2026-06-10 (added the solidarity model, larger institutions sustain the free tiers).

House voice applies to everything written from this file: no em-dashes, no
emojis, no mid-sentence colons, always state the why, no AI-speak.

Status right now: billing is built behind the `BILLING_ENABLED` flag, which is
OFF in production, so all cloud storage is free during the beta. As of the
2026-06-10 demo launch the app itself is publicly live, including sharing and
real-time collaboration. Only billing stays off, so nothing in this file is
charged for yet. The host repo (github.com/gnick18/ResearchOS) is now public.
The public **`/pricing` page is BUILT** (`frontend/src/app/pricing/`); every
tunable number lives in `frontend/src/lib/pricing/assumptions.ts` as a FLAGGED
placeholder for Grant to set before launch.

## The core promise (lead with this)

- The local-first notebook is free and open source forever (AGPLv3). Your data
  lives in your own folder on your own disk. We never need to charge you to use
  ResearchOS for your own research.
- We charge only for optional cloud storage. Individuals and labs pay only what
  that storage actually costs us. Departments and institutions pay a modest
  sustaining rate above cost, and that surplus keeps ResearchOS free for
  individual researchers and funds the open-source development. The reason it all
  stays this cheap is the local-first design, your everyday work never touches
  our servers, so our costs are small and so is the price.

## Plans (flat bundles, not metered-on-use to the customer)

- FOUR audiences, one picker. Individuals choose Free / Plus / Pro. Labs choose
  Lab Free / Lab Plus / Lab Pro. **Departments and institutions do NOT pick a
  fixed tier**, they use an automated self-serve PLAN BUILDER (see the section
  below). Individuals and labs are fixed bundles; dept and institution are built.
- Each plan bundles a storage allowance plus an activity allowance into one
  monthly price, one invoice line. No second meter watching their editing.
- Free tier is 5 GB plus a generous editing allowance, $0. A real working tier,
  not a trial.
- Plus and Pro dollar figures are still PROVISIONAL. Do not print them yet. Safe
  to say "a free tier and low-cost paid tiers for heavier storage."
- The STRUCTURE is locked and final (Free/Plus/Pro + Lab variants as fixed
  bundles, departments and institutions as automated builders, Free at 5 GB and
  $0, shared-pool labs, solidarity sustaining on the larger tiers). The only held
  item is the Plus and Pro FINAL sticker prices, unpublished until real usage sets
  them. Transparent cost-recovery ESTIMATES are fine when labeled an estimate.

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

## Departments and institutions (the solidarity tiers, get this exact)

- This is the heart of the model and the thing most likely to be reverted by a
  stale doc. Individuals and labs pay COST RECOVERY (what storage costs us, no
  more). **Departments and institutions pay a modest SUSTAINING rate ABOVE bare
  cost**, and that surplus keeps ResearchOS free for individual researchers and
  funds the open-source development. This is solidarity pricing, the well-funded
  subsidize the rest. It is NOT a flat "cost-recovery, never profit" model.
- A department is a CONTAINER of labs (one payer above several lab pools); an
  institution is a container of departments. Same engine, one or two levels up.
- Both are AUTOMATED self-serve plan builders on `/pricing`. You enter labs /
  average members / estimated adoption / what you share, and it derives a monthly
  rate = cost recovery + a per-active-lab sustaining contribution. No voluntary
  "pay above cost" slider (that was dropped), no manual price quoting.
- Billing is an **auto recurring Stripe invoice to the procurement office** on net
  terms, payable by ACH or card, adjustable any month, no lock-in, no annual
  contract. GitHub Sponsors CANNOT invoice a university, so the invoice is the
  only institutional channel (this is also why Sponsors stays an individuals path).
- The admin picks how they pay. The default is that emailed net-30 invoice for a
  procurement office that needs a purchase order. A smaller department or a PI
  fronting the cost can instead **auto-charge a card or bank account on file**,
  charged each cycle, set up through a quick Stripe Checkout.
- **International payers** can pay too (card everywhere, plus local bank debits
  where supported). Because Stripe charges us more on an international card and
  for currency conversion, that real extra cost is passed through as a small
  international processing line on the rate, so a US lab is not subsidizing it.
  Same cost-recovery principle as everything else.
- Institutions get a **self-serve trust packet** (a pre-filled HECVAT, a security
  one-pager, the open-source code, a standard agreement). Lean on local-first +
  end-to-end-encryption + Entra SSO as the easy-review edge, we hold almost none
  of their data, so the security review is short. Standard terms, no sales call.
- Frame the savings honestly: vs competitor stacks (LabArchives $330/user/yr,
  SnapGene, Quartzy) the gap is huge, but always SUBTRACT ResearchOS's real
  optional-cloud cost rather than claim "$0, you save everything" (that overclaim
  reads as a scam).

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
- Pricing philosophy is priced to sustain, not to profit. Individuals and labs
  pay cost recovery, what storage actually costs us, no more. Departments and
  institutions pay a modest sustaining rate above cost, and that surplus keeps
  ResearchOS free for individual researchers and funds the open-source
  development. We size everything to cover infrastructure plus payment processing
  plus tax with a small safety buffer, never to extract profit. We are keeping a
  public good alive, not running a money printer.

## Credibility (use lightly)

- ResearchOS is a registered Wisconsin LLC and the merchant of record, with real
  banking and Stripe set up. So paid storage, when it turns on, is a real,
  accountable business, not a hobby donation link.

## Do not publish yet

- No FINAL Plus or Pro sticker prices, they are provisional until a few weeks of
  real usage set them. Transparent cost-recovery ESTIMATES are fine to show when
  clearly labeled an estimate, not final, and free during beta (the pricing-page
  calculator and the department and institution builders do exactly this).
- Do not imply billing is live. It is off during beta, everything is free right
  now.
- Do not promise "free forever" for cloud storage. The LOCAL notebook is free
  forever. Cloud storage is the optional paid part.
