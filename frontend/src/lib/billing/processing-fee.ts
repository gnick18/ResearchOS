// Payment-method pricing: the compliant "discount for a lower-fee method" model.
//
// Stripe charges us very differently by method: a card is ~2.9% (more for an
// international card plus currency conversion), a bank debit (ACH, SEPA) is about
// 0.8%. We do NOT surcharge the card (that is restricted or banned in several
// places and capped). Instead the CARD price is the list price, and a payer who
// uses a bank debit gets a genuine DISCOUNT that reflects the lower cost. Dual
// pricing like this is federally protected in all 50 states even where
// surcharging is banned, as long as the discount is by METHOD CATEGORY (bank vs
// card), not by card brand or debit-vs-credit.
//
// The discount is honest because it is enforced: a bank price is only ever
// charged when the payer actually completes payment by a bank debit (the
// Checkout / invoice restricts the method to that class).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import {
  BANK_FEE_PCT,
  INTL_PROCESSING_PCT,
  STRIPE_PCT,
} from "@/lib/pricing/assumptions";

/** The two method classes pricing depends on. Card is the list price; bank is
 *  the discounted price. We never price by card brand or debit-vs-credit. */
export type PayClass = "card" | "bank";

/** The Stripe processing fraction for a card, higher for an international card
 *  (cross-border + currency conversion). */
export function cardFeePct(international: boolean): number {
  return STRIPE_PCT + (international ? INTL_PROCESSING_PCT : 0);
}

/** The Stripe processing fraction for a given method class. */
export function feePctFor(payClass: PayClass, international: boolean): number {
  return payClass === "bank" ? BANK_FEE_PCT : cardFeePct(international);
}

/**
 * The price (cents) for `payClass`, given the CARD list price. The list already
 * assumes a card (and, for org rates, the international card premium when
 * `international`). A bank payer pays less because the same net amount needs a
 * smaller gross-up at the lower bank fee, so this returns a genuine discount, not
 * a surcharge on the card.
 *
 * cardList = base / (1 - cardPct)  =>  base = cardList * (1 - cardPct)
 * bankPrice = base / (1 - bankPct) = cardList * (1 - cardPct) / (1 - bankPct)
 */
export function priceForMethod(
  cardListCents: number,
  payClass: PayClass,
  international: boolean,
): number {
  const list = Math.max(0, Math.round(cardListCents));
  if (payClass === "card") return list;
  const factor = (1 - cardFeePct(international)) / (1 - BANK_FEE_PCT);
  return Math.round(list * factor);
}

/** The bank-debit saving versus the card list price, in cents (never negative). */
export function bankSavingCents(
  cardListCents: number,
  international: boolean,
): number {
  return Math.max(
    0,
    Math.round(cardListCents) - priceForMethod(cardListCents, "bank", international),
  );
}

/** A Stripe payment method type usable for a recurring subscription here. These
 *  are all members of Stripe's payment-method-type unions, so the arrays below
 *  assign directly to a subscription's payment_settings and a Checkout session. */
export type StripeRecurringMethod =
  | "card"
  | "us_bank_account"
  | "sepa_debit"
  | "bacs_debit"
  | "acss_debit";

/** The Stripe payment_method_types to allow for a method class, so a bank
 *  (discounted) price can only be paid by a bank debit. Card stays card-only.
 *  The bank set covers US ACH plus the common international bank debits; Stripe
 *  shows only the ones eligible for the customer and billing currency. */
export function stripeMethodsFor(payClass: PayClass): StripeRecurringMethod[] {
  return payClass === "bank"
    ? ["us_bank_account", "sepa_debit", "bacs_debit", "acss_debit"]
    : ["card"];
}
