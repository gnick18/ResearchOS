# Metered-storage billing and payout wiring

Status: design for Grant, 2026-06-05. Author: sharing infra.

Builds on docs/proposals/paid-storage-sustainability.md (the why and the model)
and docs/proposals/llc-business-tracker.md (where the money is recorded). This is
the how, the concrete engineering to take a lab from "out of storage" to a paid
quota bump with the money landing in the LLC account.

## Where the LLC stands (the unblock)

As of 2026-06-05 the LLC admin side is essentially done, so the payout
destination exists shortly.

- EIN REDACTED-EIN (single-member LLC, disregarded entity default).
- Operating agreement executed.
- Grant is his own registered agent (WI Form 13 filed, Northwest cancelled).
- Business bank account, Mercury, applied for and in review, approval expected
  in about a day. Mercury chosen over Relay for simplicity and clean Stripe
  integration.
- Initial funding via ACH from Grant's personal Schwab as a capital contribution.

What is still pending before a payout can land, Mercury approval plus the first
deposit, so the live account and routing numbers come after approval. The
engineering below can be built now in test mode and flipped live once the
account exists.

## The path the money takes

1. A lab hits its storage quota and chooses to add storage.
2. The app opens a hosted checkout (Stripe) for a storage block.
3. On payment, a webhook bumps that owner's paid quota, records the income in the
   business ledger (source "storage-payment"), and archives a receipt email.
4. Stripe pays out to the LLC Mercury account on its payout schedule.
5. The Neon and Cloudflare R2 invoices are paid from the same Mercury account.
   The business tracker already estimates that infra cost and can record it.

## The rail, and why it is swappable

Per paid-storage-sustainability.md, start with Stripe plus Stripe Tax with the
LLC as merchant of record. It has the lowest fees and, since early customers are
mostly US academic labs and Wisconsin does not tax this kind of cloud storage,
the sales-tax burden is light at first. If multi-state or international volume
ever makes compliance a chore, switch to a Merchant of Record (Polar or Lemon
Squeezy) that remits tax everywhere.

To keep that switch cheap, hide the provider behind a small interface rather than
sprinkling Stripe calls across the app:

```
interface BillingProvider {
  createCheckout(input: { ownerId, blockId, returnUrl }): Promise<{ url }>;
  verifyWebhook(req): Promise<BillingEvent | null>; // signature-checked
}
```

The webhook handler consumes a normalized BillingEvent, so swapping Stripe for an
MoR is a new implementation of the interface, not a rewrite of the quota and
ledger logic.

## Data and quota

The prerequisite is a real, enforced, per-owner storage quota (see
paid-storage-sustainability.md). The free allowance is generous (storage is
cheap), and a paid block raises the ceiling. The collab-side accounting is owned
by the collab track (the /admin collabBytes / collabBudgetBytes work); the relay
side already enforces a per-recipient cap. Billing adds:

- A per-owner paid-quota figure (free allowance plus purchased blocks), stored
  next to the accounting the collab track is landing. Coordinate, do not
  duplicate.
- A purchases record so a quota bump is auditable and a refund or expiry can
  reverse it.

## Pricing

Sell storage in blocks priced to clear cost plus fees with a small buffer, not
to profit. Reference costs, Neon storage $0.35/GB-month, R2 $0.015/GB-month,
Stripe about 2.9% plus $0.30 (or an MoR about 5% plus $0.50). A block size and
price are a Grant decision; the engineering treats them as configured products,
not hard-coded numbers.

## Tracker tie-in

The business tracker already has the hooks:
- Income, a paid block records a ledger entry with source "storage-payment", so
  the existing money-in totals and safe-to-draw math just work.
- Receipts, the payment receipt email archives into Correspondence exactly like
  the deadline reminders, so it is an LLC record and exports to the folder.
- Expenses, the infra-cost estimate already approximates the Neon and R2 bills.

## Environment and secrets

- STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and the storage-block price IDs.
- A STRIPE_ENABLED (or BILLING_ENABLED) flag so the whole surface is dark until
  it is configured, mirroring SHARING_ENABLED.
- The Mercury account and routing numbers are added in the Stripe dashboard as
  the payout destination, not in code, so they never touch the repo.

## Build phases

1. Per-owner paid quota, coordinated with the collab track's accounting. The
   prerequisite for everything else.
2. The BillingProvider interface plus a Stripe implementation, a create-checkout
   route, and a signature-verified webhook that bumps the quota, records the
   ledger entry, and archives the receipt. Buildable now end to end in Stripe
   TEST mode, behind the flag, with no live account needed.
3. Go-live, after Mercury approves, add it as the Stripe payout destination,
   swap to live keys, and flip the flag. No code change, just configuration.

Phases 1 and 2 can proceed now. Phase 3 waits on Mercury approval and the first
deposit.

## What is blocked, and on what

- Live payouts, Mercury approval plus first deposit.
- The final rail choice (Stripe vs MoR) only matters at scale, start on Stripe.
- A clean unified per-owner quota, the collab-side accounting landing from the
  collab track.

## Caveats I am not qualified to close

I am not a tax or legal advisor. Before charging real money, confirm the
sales-tax handling and the reserve percentage with an accountant, and confirm
there are no UW institutional or conflict-of-interest issues with the revenue
LLC, separately from the IP question already cleared.

## Sources

- [Stripe Tax](https://stripe.com/tax)
- [Neon pricing](https://neon.com/pricing)
- docs/proposals/paid-storage-sustainability.md
- docs/proposals/llc-business-tracker.md
