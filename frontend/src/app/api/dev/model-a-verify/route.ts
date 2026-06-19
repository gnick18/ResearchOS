// Model A billing, end-to-end verify (DEV TOOL, test mode only).
//
// GET /api/dev/model-a-verify   Authorization: Bearer <BILLING_SIM_SECRET>
//
// Exercises the risky half of the engine against Stripe TEST MODE without the
// hosted Checkout UI: create a test customer, set up a test card off-session,
// accrue a real Model-A period charge on the ledger, then run the off-session
// charge job to draw the balance to zero. Self-cleans the test ledger rows and the
// test Stripe customer so it is repeatable.
//
// Gated by BILLING_SIM_SECRET (404 if unset/mismatched), same as billing-sim, so
// it is inert in prod. Refuses to run against a live Stripe key as a safety belt.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { getStripe } from "@/lib/billing/stripe";
import { MODEL_A_PLANS, periodCharge } from "@/lib/billing/model-a/pricing";
import {
  accruePeriodCharge,
  getCloudBalance,
  setCloudPaymentMethod,
} from "@/lib/billing/model-a/ledger";
import { runChargeRun } from "@/lib/billing/model-a/charge";
import { stripeOffSessionCharger } from "@/lib/billing/model-a/stripe-charger";
import { getSql, ensureCloudLedgerSchema } from "@/lib/billing/model-a/ledger-db";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.BILLING_SIM_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return new Response("not found", { status: 404 });
  }
  if (process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_")) {
    return Response.json({ ok: false, error: "refusing to run against a live Stripe key" }, { status: 400 });
  }

  const ownerKey = "model-a-verify-owner";
  const period = "2026-06";
  const stripe = getStripe();
  const steps: Record<string, unknown> = {};

  try {
    await ensureCloudLedgerSchema();
    const sql = getSql();
    // Clean any prior run so the verify is repeatable.
    await sql`DELETE FROM cloud_usage_ledger WHERE owner_key = ${ownerKey}`;
    await sql`DELETE FROM cloud_balance WHERE owner_key = ${ownerKey}`;

    // 1. Test customer + a card set up for off-session use (test PM token).
    const customer = await stripe.customers.create({
      email: "model-a-verify@example.com",
      metadata: { modelAVerify: "1" },
    });
    const si = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method: "pm_card_visa",
      confirm: true,
      usage: "off_session",
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    });
    const pm = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id ?? null;
    if (!pm) throw new Error("no payment method from setup intent");
    await setCloudPaymentMethod(ownerKey, customer.id, pm);
    steps.cardOnFile = { customer: customer.id, paymentMethod: pm, setupStatus: si.status };

    // 2. Accrue a real Model-A solo charge ($3 base + markup + storage).
    const charge = periodCharge(MODEL_A_PLANS.solo, {
      writes: 2_000_000,
      storageBytes: 20e9,
      hostedBytes: 0,
    });
    const accrueRes = await accruePeriodCharge(ownerKey, period, charge);
    const balanceBefore = await getCloudBalance(ownerKey);
    steps.accrual = { charge, accrued: accrueRes.accrued, balanceBefore };

    // 3. Run the off-session charge for real (test-mode PaymentIntent).
    const chargeSummary = await runChargeRun(stripeOffSessionCharger, {
      owners: [{ ownerKey, accruedCents: balanceBefore, customerId: customer.id, paymentMethodId: pm, trialEndsAt: null }],
      threshold: 0,
    });
    const balanceAfter = await getCloudBalance(ownerKey);
    steps.charge = { chargeSummary, balanceAfter };

    const pass =
      accrueRes.accrued &&
      balanceBefore === charge.totalCents &&
      chargeSummary.succeeded === 1 &&
      balanceAfter === 0;

    // 4. Clean up (ledger rows + the test Stripe customer).
    await sql`DELETE FROM cloud_usage_ledger WHERE owner_key = ${ownerKey}`;
    await sql`DELETE FROM cloud_balance WHERE owner_key = ${ownerKey}`;
    await stripe.customers.del(customer.id).catch(() => {});

    return Response.json({ ok: true, pass, steps });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "verify failed", steps },
      { status: 500 },
    );
  }
}
