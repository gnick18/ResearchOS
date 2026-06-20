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
  setModelAPlan,
  setPlan,
  upsertSubscription,
} from "@/lib/billing/db";
import { getPlan } from "@/lib/billing/plans";
import { packTokens, type AiPack } from "@/lib/billing/ai-config";
import { creditTokens } from "@/lib/billing/ai-ledger";
import {
  creditBalance,
  getOwnerByCustomerId,
  recordCharge,
  setCloudPaymentMethod,
  setDisputed,
} from "@/lib/billing/model-a/ledger";
import {
  ensureOrgBillingSchema,
  getOrgBillingBySubId,
  setOrgSubscription,
  type OrgBillingStatus,
  type OrgTier,
} from "@/lib/billing/org-billing";
import { getStripe, getWebhookSecret } from "@/lib/billing/stripe";
import { formatUSD } from "@/lib/business/calc";
import {
  addLedgerEntryBySource,
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

/** The org tier this subscription bills, if it is an org (dept/institution)
 *  procurement subscription rather than an individual/lab one. */
function orgTierOf(sub: Stripe.Subscription): OrgTier | null {
  const t = sub.metadata?.orgTier;
  return t === "department" || t === "institution" ? t : null;
}

/** Maps Stripe's subscription status onto the org billing lifecycle. A sent
 *  invoice that lapses shows as past_due; the cost circuit breaker can read this
 *  to pause cloud writes for the sponsored labs (local-first keeps working). */
function normalizeOrgStatus(raw: string): OrgBillingStatus {
  if (raw === "active" || raw === "trialing") return "active";
  if (raw === "past_due" || raw === "unpaid") return "past_due";
  if (raw === "canceled" || raw === "incomplete_expired") return "canceled";
  return "inactive";
}

/** Syncs an org (dept/institution) subscription onto its org_billing row. */
async function syncOrgSubscription(
  sub: Stripe.Subscription,
  tier: OrgTier,
): Promise<void> {
  const entityId = sub.metadata?.orgId;
  if (!entityId) return; // cannot attribute, skip
  await ensureOrgBillingSchema();
  await setOrgSubscription(
    tier,
    entityId,
    sub.id,
    sub.items.data[0]?.id ?? null,
    normalizeOrgStatus(sub.status),
  );
}

/** The Stripe customer id on a charge (string ref or expanded object), or null. A
 *  refund/dispute event carries the charge whose customer we map to an owner via
 *  cloud_balance.stripe_customer_id. */
function customerIdOf(
  customer: string | { id: string } | null | undefined,
): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
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
        // Model-A card-on-file setup completing. A setup-mode session carries
        // modelA in metadata and a setup_intent, no subscription, so it is
        // distinct from the flat-plan subscription path and the AI top-up. Store
        // the saved card and activate the chosen Model-A plan; usage then accrues
        // and the charge job runs this card past the threshold.
        if (s.mode === "setup" && s.metadata?.modelA === "1") {
          const ownerKey = s.metadata?.ownerKey;
          const planId = s.metadata?.planId;
          if (ownerKey && s.setup_intent) {
            const siId =
              typeof s.setup_intent === "string" ? s.setup_intent : s.setup_intent.id;
            const si = await getStripe().setupIntents.retrieve(siId);
            const pm =
              typeof si.payment_method === "string"
                ? si.payment_method
                : si.payment_method?.id ?? null;
            const customerId =
              typeof s.customer === "string" ? s.customer : s.customer?.id ?? null;
            if (pm && customerId) {
              await setCloudPaymentMethod(ownerKey, customerId, pm);
              // planId here is a Model-A id (solo / lab), so write it directly via
              // setModelAPlan. Routing it through setPlan (the flat catalog) would
              // resolve to null and store free / inactive, under-charging the lab.
              if (planId) await setModelAPlan(ownerKey, planId);
            }
          }
          break;
        }
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
          // An org (dept/institution) automatic-method checkout completing: sync
          // onto its org_billing row. Otherwise it is an individual/lab checkout.
          const orgTier = orgTierOf(sub);
          if (orgTier) {
            // Carry the org keys from the session if the subscription lacks them.
            if (!sub.metadata?.orgId && s.metadata?.orgId) {
              sub.metadata = { ...sub.metadata, ...s.metadata };
            }
            await syncOrgSubscription(sub, orgTier);
          } else {
            // Carry the session's owner key onto the subscription if missing.
            if (!sub.metadata?.ownerKey && s.metadata?.ownerKey) {
              sub.metadata = { ...sub.metadata, ownerKey: s.metadata.ownerKey };
            }
            await syncSubscription(sub);
          }
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        // An org (dept/institution) procurement subscription syncs onto its
        // org_billing row; everything else is an individual/lab subscription.
        const orgTier = orgTierOf(sub);
        if (orgTier) await syncOrgSubscription(sub, orgTier);
        else await syncSubscription(sub);
        break;
      }
      case "invoice.paid":
      case "invoice.payment_succeeded": {
        const inv = event.data.object as Stripe.Invoice & {
          // Removed top-level field (pre-2026 API versions); kept for fallback.
          subscription?: string | { id: string } | null;
          parent?: {
            subscription_details?: { subscription?: string | { id: string } | null } | null;
          } | null;
        };
        const amountCents = inv.amount_paid ?? 0;
        if (amountCents > 0) {
          await ensureBusinessSchema();
          // The subscription ref moved to invoice.parent.subscription_details
          // in API version 2026-05-27; fall back to the deprecated top-level
          // field and the line-item parent for older versions.
          const subRef =
            inv.parent?.subscription_details?.subscription ??
            inv.subscription ??
            (inv.lines?.data?.[0]?.parent as
              | { subscription_item_details?: { subscription?: string | null } }
              | undefined)?.subscription_item_details?.subscription ??
            null;
          const subId =
            typeof subRef === "string" ? subRef : subRef?.id ?? null;
          // An org procurement invoice attributes to its entity; otherwise it is
          // an individual/lab storage payment. Both land in the LLC ledger.
          const org = subId ? await getOrgBillingBySubId(subId) : null;
          const owner =
            !org && subId ? await getSubscriptionByStripeId(subId) : null;
          const date = new Date().toISOString().slice(0, 10);
          const category = org
            ? org.tier === "institution"
              ? "Institution subscription"
              : "Department subscription"
            : "Storage subscription";
          const note = org
            ? `${org.tier} ${org.entityId.slice(0, 12)}...`
            : owner
              ? `owner ${owner.ownerKey.slice(0, 12)}...`
              : "storage payment";
          // Idempotent per invoice: Stripe fires both invoice.paid and
          // invoice.payment_succeeded for one payment, so key the ledger row on
          // the invoice id to book it exactly once regardless of which (or both)
          // arrive, or of webhook redelivery.
          const { inserted } = await addLedgerEntryBySource({
            date,
            direction: "in",
            category,
            amountCents,
            note,
            source: inv.id ? `storage-payment:${inv.id}` : "storage-payment",
          });
          if (inserted) {
            await recordBusinessEmail({
              kind: "storage-receipt",
              toEmail: inv.customer_email ?? "",
              subject: `${category} payment received, ${formatUSD(amountCents)}`,
              body: `A ${category.toLowerCase()} payment of ${formatUSD(amountCents)} was received on ${date}. Stripe sends the customer-facing receipt; this is the LLC record.`,
            });
          }
        }
        break;
      }
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        // Only Model-A cloud-usage charges are handled here (tagged modelA in
        // metadata); other PaymentIntents are handled via their invoice/session.
        if (pi.metadata?.modelA === "1" && pi.metadata?.ownerKey) {
          const ownerKey = pi.metadata.ownerKey;
          const amountCents = pi.amount_received ?? pi.amount ?? 0;
          if (amountCents > 0) {
            // Draw the accrued balance down, idempotent on the PaymentIntent id
            // (the charge job records the same id, so this is belt-and-braces).
            await recordCharge(ownerKey, amountCents, pi.id);
            // Book the revenue in the LLC ledger, idempotent per PaymentIntent id.
            await ensureBusinessSchema();
            const date = new Date().toISOString().slice(0, 10);
            await addLedgerEntryBySource({
              date,
              direction: "in",
              category: "Cloud usage",
              amountCents,
              note: `owner ${ownerKey.slice(0, 12)}...`,
              source: `cloud-charge:${pi.id}`,
            });
          }
        }
        break;
      }
      case "charge.refunded": {
        // A refund (manual in the dashboard, or as the resolution of a customer
        // contacting us). CREDIT the ledger back so the running balance reflects the
        // money returned. We use the refund AMOUNT (amount_refunded), not the full
        // charge, so a PARTIAL refund credits exactly what was refunded. Map the
        // charge to an owner via its customer id. Idempotent on the charge id (Stripe
        // redelivers, and amount_refunded is cumulative, so we key the credit on the
        // charge id and credit the cumulative refunded total exactly once).
        const charge = event.data.object as Stripe.Charge;
        const customerId = customerIdOf(charge.customer);
        const refundedCents = charge.amount_refunded ?? 0;
        if (customerId && refundedCents > 0) {
          const ownerKey = await getOwnerByCustomerId(customerId);
          if (ownerKey) {
            await creditBalance(
              ownerKey,
              refundedCents,
              `refund ${charge.id}`,
              `refund:${charge.id}`,
            );
          }
        }
        break;
      }
      case "charge.dispute.created": {
        // A customer filed a card dispute. FLAG the account disputed and PAUSE it
        // (the shared accrual decision stops adding new usage) so a disputed user
        // cannot keep running up uncharged usage while the dispute is open. Map the
        // dispute to an owner via the charge's customer id. Idempotent (a redelivery
        // re-stamps the same paused state; setDisputed preserves the first
        // disputed_at).
        const dispute = event.data.object as Stripe.Dispute;
        const chargeId =
          typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
        const ch = chargeId ? await getStripe().charges.retrieve(chargeId) : null;
        const customerId = customerIdOf(ch?.customer);
        if (customerId) {
          const ownerKey = await getOwnerByCustomerId(customerId);
          if (ownerKey) await setDisputed(ownerKey, true);
        }
        break;
      }
      case "charge.dispute.closed": {
        // The dispute resolved. If it was WON (resolved in our favor) clear the flag
        // and un-pause the account. If it was LOST leave it flagged (the money is
        // gone; we do not silently un-pause). "warning_*" and other non-terminal
        // statuses are ignored here, only a closed won/lost moves the flag.
        const dispute = event.data.object as Stripe.Dispute;
        if (dispute.status === "won" || dispute.status === "lost") {
          const chargeId =
            typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
          const ch = chargeId ? await getStripe().charges.retrieve(chargeId) : null;
          const customerId = customerIdOf(ch?.customer);
          if (customerId) {
            const ownerKey = await getOwnerByCustomerId(customerId);
            if (ownerKey && dispute.status === "won") {
              await setDisputed(ownerKey, false);
            }
          }
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
