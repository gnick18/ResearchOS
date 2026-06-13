# Real Stripe round-trip: department + institution billing

The authentic test of the org procurement billing, on Stripe TEST keys. Finds the
bugs the simulated demo cannot (Stripe param validation, the invoice lifecycle,
webhook timing, the LLC ledger entry). Nothing here charges real money.

Split of work: YOU do the parts a synthetic session cannot (secrets, the webhook
listener, the OAuth sign-in). Then I drive the browser and verify.

## What you set up (only you can do these)

1. Stripe test keys. From the Stripe dashboard (test mode), put in
   `frontend/.env.local`:
   ```
   BILLING_ENABLED=true
   STRIPE_SECRET_KEY=sk_test_...
   NEXT_PUBLIC_DEPT_TIER_ENABLED=1
   NEXT_PUBLIC_INSTITUTION_TIER_ENABLED=1
   ```
   (Leave the live key out. The code bypasses the WI sales-tax hard gate on a
   sk_test_ key, so the test runs without that determination.)

2. A database. Point `DATABASE_URL` at a NEON TEST BRANCH, not prod, so the test
   subscriptions land in a throwaway branch you can delete after. (org_billing is
   a new table, so a fresh branch just creates it on first call.)

3. The webhook listener. In a terminal:
   ```
   stripe listen --forward-to localhost:3000/api/billing/webhook
   ```
   It prints a signing secret `whsec_...`. Put that in `.env.local`:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```
   Keep this terminal running for the whole test.

4. Restart `:3000` (NEXT_PUBLIC + the new env bake at start). Confirm it came up.

5. Sign in for real (OAuth) in the browser, so there is an authenticated account
   with a sharing identity. This is the one step I cannot do. Land on the
   workbench signed in, then tell me you are ready.

## What I drive (after you signal ready)

Department, real flow (NOT /demo):
1. Go to `/department`, create a department (real, writes to Neon).
2. Build a plan, choose "Emailed invoice" (bank), click Activate. I verify the
   server created a send_invoice subscription and org_billing shows active.
3. Choose "Auto-charge card", Activate -> Stripe Checkout. I fill the success test
   card `4242 4242 4242 4242` (any future expiry, any CVC, any ZIP). On completion
   I confirm the webhook fired, the subscription is charge_automatically, and the
   dashboard shows active.
4. I check `/admin/business` for the revenue ledger entry recorded on the paid
   invoice, and the Stripe dashboard for the customer + subscription + invoice.

Then the institution flow (`/institution`) the same way, one tier up.

Optional ACH leg: a bank-pay Checkout uses Stripe's test bank (Test Institution)
rather than a card. I can drive that too if you want the ACH path covered.

## Things we are specifically watching for (the point of this test)

- The send_invoice subscription actually produces an invoice, and invoice.paid
  flows back to org_billing + the LLC ledger with the right amount and category.
- The Checkout (automatic) path round-trips: session -> subscription.created ->
  syncOrgSubscription marks active with the right pay class.
- Switching pay class / updating the plan reprices in place without a duplicate
  subscription, and dropping to no plan cancels cleanly.
- No Stripe param rejections (already pre-fixed the USD-vs-SEPA bank-method bug).

## Cleanup

When done, delete the Neon test branch (drops org_billing + the dept/inst rows),
and the test subscriptions disappear with the test-mode data. The Stripe test-mode
objects can be left or cleared from the dashboard.
