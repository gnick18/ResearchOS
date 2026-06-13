// Payment-method pricing: dual-pricing discount by method class. Pins that the
// card is the list price (never marked up = no surcharge), that a bank payer pays
// strictly less (a genuine discount), and that an international card costs more
// than a domestic one while bank stays low.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import {
  cardFeePct,
  feePctFor,
  priceForMethod,
  bankSavingCents,
  stripeMethodsFor,
} from "../processing-fee";
import { STRIPE_PCT, BANK_FEE_PCT, INTL_PROCESSING_PCT } from "@/lib/pricing/assumptions";

describe("fee fractions", () => {
  it("card is the base Stripe rate, plus the intl premium when international", () => {
    expect(cardFeePct(false)).toBe(STRIPE_PCT);
    expect(cardFeePct(true)).toBe(STRIPE_PCT + INTL_PROCESSING_PCT);
  });
  it("bank is the low bank-debit rate, country-independent", () => {
    expect(feePctFor("bank", false)).toBe(BANK_FEE_PCT);
    expect(feePctFor("bank", true)).toBe(BANK_FEE_PCT);
  });
});

describe("priceForMethod", () => {
  it("card returns the list price unchanged (no surcharge)", () => {
    expect(priceForMethod(10000, "card", false)).toBe(10000);
    expect(priceForMethod(10000, "card", true)).toBe(10000);
  });
  it("bank is a genuine discount below the card list price", () => {
    const bank = priceForMethod(10000, "bank", false);
    expect(bank).toBeLessThan(10000);
    // ~2.1% off domestically ((1-0.029)/(1-0.008)).
    expect(bank).toBeGreaterThan(9700);
    expect(bank).toBeLessThan(9900);
  });
  it("the bank discount is larger when the card list reflects an intl card", () => {
    const domBank = priceForMethod(10000, "bank", false);
    const intlBank = priceForMethod(10000, "bank", true);
    expect(intlBank).toBeLessThan(domBank);
    expect(bankSavingCents(10000, true)).toBeGreaterThan(bankSavingCents(10000, false));
  });
});

describe("stripeMethodsFor", () => {
  it("card price is payable only by card; bank price only by bank debits", () => {
    expect(stripeMethodsFor("card")).toEqual(["card"]);
    expect(stripeMethodsFor("bank")).toContain("us_bank_account");
    expect(stripeMethodsFor("bank")).toContain("sepa_debit");
    expect(stripeMethodsFor("bank")).not.toContain("card");
  });
});
