# Paid storage to keep the servers running

Status: draft for Grant, 2026-06-05. Author: sharing infra.

## What this is and is not

This is about one narrow thing. A lab uses enough server-side storage that it
costs real money on Neon or R2, and they want to chip in to cover it, or to lift
their own limit. The question is how money for that can flow with the least
handling and the least tax mess, ideally going to the infrastructure provider
without ResearchOS becoming a business in the middle.

This is separate from the voluntary fundraising and donations already planned.
It is also a real departure from the locked sustainability model (free for every
lab, funded by the RISE fellowship and voluntary donations, no paid tier, no
per-seat fees, AGPLv3). Metered, paid storage is a paid tier no matter how it is
framed, so the recommendation below leans hard toward the option that keeps it a
contribution rather than a sale, because that is the one that stays inside the
existing identity.

## The blunt mechanical constraint

You cannot funnel a lab's money to Neon toward the ResearchOS account. Neon
bills the account holder, which is you. There is no feature for an app's end
users to top up the app owner's bill. So "have them pay Neon directly so we
never touch it" is real in exactly one case, the lab has to be Neon's customer,
not you. Everything below is a way around or into that fact.

## Where the money and the storage actually are

ResearchOS is local first, so the heavy data lives on each user's machine. The
only durable server-side storage is collaborative note sync on Neon
(`collab_docs.latest_snapshot` and `collab_doc_updates.update_bytes`, both
bytea) plus the transient relay bundles on R2. So "a lab needs more storage"
almost always means "a lab does a lot of server-side collaboration." That keeps
the paid-storage surface small and specific, which matters for every option.

Cost facts, June 2026:
- Cloudflare R2 storage is about $0.015 per GB-month, zero egress. The relay
  bundles. Nearly free to scale.
- Neon storage is $0.35 per GB-month (down from $1.75 after the Databricks
  acquisition), plus $0.20 per GB-month for point-in-time history. Free tier is
  0.5 GB. This is the tier that ever forces a real decision, and it is roughly
  23 times the per-GB cost of R2.

So the thing anyone would actually pay to expand is Neon collab storage. R2 is a
rounding error you would just absorb.

## The prerequisite, regardless of model

"This lab's storage limit" has to be a real, enforced, per-lab number before any
payment means anything. Today storage is global on R2 and per-recipient on the
relay, with no per-lab attribution. The collab side is the one that matters and
it just gained a budget and an `/admin` usage signal (the `neon.collabBytes` /
`collabBudgetBytes` work). Turning that into a per-owner, adjustable limit is
step zero for every paid option here.

## The options

### A. Fiscal-host contribution fund (recommended)

A fiscal host is a nonprofit that legally holds a project's money, issues
receipts, handles taxes, accounting, and compliance, and pays the project's
vendor invoices. Open Source Collective is a US 501(c)(6) that has done exactly
this for 2,500+ open-source projects since 2017, processing contributions
through Stripe and PayPal and paying vendors worldwide.

How it works for us. Labs contribute to a ResearchOS "server fund" collective.
Open Source Collective holds the money. When the Neon or R2 invoice comes, it is
submitted as an expense and paid straight from the collective's balance. You
never personally receive the money, so it is not your income, there is no entity
to form, and there is no sales-tax registration. This is the closest legitimate
version of "the money goes to the infrastructure, not to me."

The one nuance. This is a contribution, not a purchase. If you promise a strict
"pay $X, get Y GB" entitlement in return, it starts to look like a sale, which
undermines the contribution framing and the tax-clean treatment (an accountant
would call this the quid-pro-quo question). So the clean shape is, contributions
raise a shared fund, and storage headroom scales with the health of that fund
for everyone, rather than a per-dollar entitlement for one lab. A lab that wants
"more room" contributes, and the whole community's ceiling rises.

Why it fits. It is the natural extension of the already-planned voluntary
donations, just earmarked for infrastructure, and it matches the AGPL,
own-your-data, free-for-every-lab identity instead of breaking it. Contributions
through a 501(c)(6) are not tax-deductible to the giver, which is worth saying
plainly in the copy, but that does not change the benefit to us.

Build cost: low to moderate. Most of it is the per-tenant accounting
prerequisite plus a contribution link and some honest copy. No payment code in
the app at all.

### B. Bring your own database

The only literal "money never touches us" path for a strict per-lab entitlement.
The lab creates its own Neon or Postgres account, pays Neon directly, and hands
us a connection string. Their collab data lives in their database.

Tax: clean, because we never receive a cent. Architecture: heavy. Everything is
one shared database today, so this means per-tenant database routing, storing
and securing each lab's connection secret, running migrations across N
databases, and walking non-technical labs through a Neon signup, which is poor
UX. Philosophically on-brand (it is self-hosting), but a large lift.

Build cost: high. This is a multi-tenant re-architecture, even if scoped to just
the collab tables.

### C. Neon for Platforms, metered, with a Merchant of Record

Neon has a first-class database-per-customer model. One API call provisions a
Neon project per lab with no Neon signup for the lab, usage is tracked per
project, and per-project limits (storage, compute, data written) can be raised
or lowered dynamically by API with no downtime. That maps almost perfectly onto
"lab pays, we bump their storage limit."

The money still flows through us here, so this is a sale and it is a paid tier.
The way to keep the tax burden sane is a Merchant of Record rather than raw
Stripe. With Stripe you are the merchant and you owe sales tax and VAT in every
jurisdiction you sell to (Stripe Tax computes it but does not remove the
liability, and global compliance otherwise runs $5k to $20k per year). A
Merchant of Record like Polar (open-source friendly) or Lemon Squeezy becomes
the legal seller, collects and remits sales tax and VAT in 200+ jurisdictions,
and takes the liability, for roughly 5% plus $0.50 per transaction versus
Stripe's 2.9% plus $0.30. You still receive the net as income, so income tax and
probably an entity still apply, but the worst operational tax pain is gone.

Build cost: high. Per-lab Neon project provisioning, API-driven limit changes,
MoR integration and webhooks, a billing surface in the app, plus the per-tenant
accounting. And it commits to a paid tier.

### D. Self-collect with Stripe

Mentioned only to dismiss it. Cheapest fees, but you become the merchant of
record, which means you personally own all the sales-tax and VAT compliance.
This is the most build-light option and the most tax-heavy one, the exact
inversion you would not want. If you ever go metered, do it through a Merchant
of Record (option C), not raw Stripe.

## Comparison

| Option | Money touches you | Tax burden | Build cost | Fits the free model |
|---|---|---|---|---|
| A. Fiscal-host fund | No (held by the host) | Minimal | Low to moderate | Yes |
| B. Bring your own DB | No (lab is Neon's customer) | None | High | Yes (self-host) |
| C. Neon platforms + MoR | Yes (net income) | Sales tax offloaded by MoR; income tax remains | High | No, it is a paid tier |
| D. Stripe self-collect | Yes | Highest, you own all of it | Moderate | No |

## Recommendation

Start with A, the fiscal-host contribution fund. It is the honest answer to what
you actually asked, the money goes to the infrastructure rather than to you, a
501(c)(6) like Open Source Collective handles the receipts, accounting, and
compliance and pays the Neon and R2 invoices directly, and it extends the
existing voluntary-donation plan instead of breaking the free-for-every-lab
identity. Keep it a contribution that lifts a shared ceiling, not a per-dollar
entitlement, so it stays a contribution in the eyes of an accountant.

Hold B and C in reserve. If a small number of heavy collaborative labs ever make
a strict, paid, per-lab quota genuinely necessary, the cleanest technical path is
Neon for Platforms (per-lab project, API-adjustable limit) and the cleanest money
path is a Merchant of Record so you never personally touch sales tax. Treat that
as a deliberate, signed-off move into a paid tier, not a quiet feature.

Do the prerequisite either way. Per-owner collab storage accounting and an
adjustable limit is step zero, and it is already half-built on the collab side.

## Caveats I am not qualified to close

I am not a tax or legal advisor. Two things need a real one before any money
moves. First, the contribution-versus-sale line and any unrelated-business-income
questions for option A. Second, and specific to you, taking money tied to a
fellowship-funded, university-affiliated project may have UW institutional or
conflict-of-interest implications that are separate from the IP question you
already cleared with WARF. Both are worth a short conversation with UW and an
accountant before committing.

## Sources

- [What is Fiscal Hosting, Open Source Collective](https://docs.oscollective.org/welcome-and-introduction-to-osc/what-is-fiscal-hosting)
- [Open Source Collective](https://opencollective.com/opensource)
- [Embedded Postgres for Platforms, Neon](https://neon.com/platforms)
- [Provision Postgres at Scale with the Neon API](https://neon.com/blog/provision-postgres-neon-api)
- [Database per User, Neon](https://neon.com/use-cases/database-per-user)
- [Neon pricing](https://neon.com/pricing)
- [Neon usage-based pricing explained](https://neon.com/blog/new-usage-based-pricing)
- [Merchant of Record, Lemon Squeezy](https://www.lemonsqueezy.com/reporting/merchant-of-record)
- [Stripe vs Paddle vs Lemon Squeezy vs Polar, Merchant of Record for B2B SaaS](https://fintechspecs.com/blog/stripe-vs-paddle-vs-lemon-squeezy-vs-polar-merchant-of-record-b2b-saas/)
