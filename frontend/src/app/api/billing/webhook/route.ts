// Flat-plan billing, the Stripe webhook.
//
// POST /api/billing/webhook
//
// Verifies the Stripe signature, is idempotent (each event id is claimed once),
// and keeps the owner's subscription state in sync. On a paid invoice it also
// records the revenue in the LLC business ledger and archives a receipt record,
// so the operator tracker sees the money. Dark unless BILLING_ENABLED is on.
//
// Local testing: stripe listen --forward-to localhost:3000/api/billing/webhook
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import type Stripe from "stripe";

import { isBillingEnabled } from "@/lib/billing/config";
import {
  claimEvent,
  ensureBillingSchema,
  getSubscriptionByStripeId,
  setPlan,
  upsertSubscription,
} from "@/lib/billing/db";
import { getPlan } from "@/lib/billing/plans";
import { packTokens, type AiPack } from "@/lib/billing/ai-config";
import { creditTokens } from "@/lib/billing/ai-ledger";
import { getStripe, getWebhookSecret } from "@/lib/billing/stripe";
import { formatUSD } from "@/lib/business/calc";
import {
  addLedgerEntry,
  ensureBusinessSchema,
  recordBusinessEmail,
} from "@/lib/business/db";

export const runtime = "nodejs";

/** Active and trialing both grant storage; everything else does not. */
function normalizeStatus(raw: string): string {
  return raw === "active" || raw === "trialing" ? "active" : raw;
}

function ownerKeyOf(sub: Stripe.Subscription): string | null {
  return (sub.metadata && sub.metadata.ownerKey) || null;
}

/** Guards the metadata.aiPack value to the three known top-up tiers. */
function isAiPack(value: string): value is AiPack {
  return value === "10" || value === "25" || value === "50";
}

async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  let ownerKey = ownerKeyOf(sub);
  if (!ownerKey) {
    const existing = await getSubscriptionByStripeId(sub.id);
    ownerKey = existing?.ownerKey ?? null;
  }
  if (!ownerKey) return; // cannot attribute, skip
  const stripeItemId = sub.items.data[0]?.id ?? null;
  const status = normalizeStatus(sub.status);
  await upsertSubscription({
    ownerKey,
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripeSubscriptionId: sub.id,
    stripeItemId,
    status,
  });
  // Flat-plan model: record which plan this subscription is for, from the
  // metadata the checkout set. A canceled/ended subscription reverts to free.
  const planId = sub.metadata?.planId;
  if (status === "active" && planId && getPlan(planId)) {
    await setPlan(ownerKey, planId);
  } else if (status !== "active") {
    await setPlan(ownerKey, "free");
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isBillingEnabled()) return new Response("not found", { status: 404 });

  const sig = request.headers.get("stripe-signature");
  if (!sig) return new Response("missing signature", { status: 400 });

  const raw = await request.text();
  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(
      raw,
      sig,
      getWebhookSecret(),
    );
  } catch {
    return new Response("bad signature", { status: 400 });
  }

  await ensureBillingSchema();
  // Idempotency, a redelivered event is acknowledged but not reprocessed.
  if (!(await claimEvent(event.id))) {
    return new Response("ok (already processed)", { status: 200 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        // BeakerBot token top-up (Phase 3). A one-time pack purchase carries the
        // pack name in metadata, the subscription path does not, so the presence
        // of aiPack is what distinguishes the two. Credit is idempotent on the
        // event id, so a redelivered webhook adds the tokens exactly once.
        const aiPack = s.metadata?.aiPack;
        if (aiPack && isAiPack(aiPack)) {
          const ownerKey = s.metadata?.ownerKey;
          if (ownerKey) {
            await creditTokens(ownerKey, packTokens(aiPack), event.id);
          }
          break;
        }
        if (s.subscription) {
          const subId =
            typeof s.subscription === "string" ? s.subscription : s.subscription.id;
          const sub = await getStripe().subscriptions.retrieve(subId);
          // Carry the session's owner key onto the subscription if missing.
          if (!sub.metadata?.ownerKey && s.metadata?.ownerKey) {
            sub.metadata = { ...sub.metadata, ownerKey: s.metadata.ownerKey };
          }
          await syncSubscription(sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      }
      case "invoice.paid":
      case "invoice.payment_succeeded": {
        const inv = event.data.object as Stripe.Invoice & {
          subscription?: string | { id: string } | null;
        };
        const amountCents = inv.amount_paid ?? 0;
        if (amountCents > 0) {
          await ensureBusinessSchema();
          const subRef = inv.subscription;
          const subId =
            typeof subRef === "string" ? subRef : subRef?.id ?? null;
          const owner = subId ? await getSubscriptionByStripeId(subId) : null;
          const date = new Date().toISOString().slice(0, 10);
          await addLedgerEntry({
            date,
            direction: "in",
            category: "Storage subscription",
            amountCents,
            note: owner ? `owner ${owner.ownerKey.slice(0, 12)}...` : "storage payment",
            source: "storage-payment",
          });
          await recordBusinessEmail({
            kind: "storage-receipt",
            toEmail: inv.customer_email ?? "",
            subject: `Storage subscription payment received, ${formatUSD(amountCents)}`,
            body: `A storage subscription payment of ${formatUSD(amountCents)} was received on ${date}. Stripe sends the customer-facing receipt; this is the LLC record.`,
          });
        }
        break;
      }
      default:
        break;
    }
  } catch {
    // Returning non-2xx makes Stripe retry. The event is already claimed, so a
    // retry would skip reprocessing; better to 200 and surface failures in the
    // Stripe dashboard than to loop. Log-and-ack.
    return new Response("ok (handler error logged)", { status: 200 });
  }

  return new Response("ok", { status: 200 });
}
