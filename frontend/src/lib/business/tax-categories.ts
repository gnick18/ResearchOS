// Tax categories for the business ledger, mapped to IRS Schedule C lines (a
// single-member LLC files business income/expense on Schedule C). Categorizing
// every expense this way is what makes the ledger "tax ready": the year-end
// summary groups by these, and the totals drop straight into self-file software
// (TurboTax / H&R self-employed) without an accountant.
//
// id is stored on the ledger row; label + scheduleC are display only, so the
// mapping can be refined without a data migration.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

export interface TaxCategory {
  id: string;
  label: string;
  /** The Schedule C line this rolls up to, for the year-end export. */
  scheduleC: string;
}

export const TAX_CATEGORIES: TaxCategory[] = [
  { id: "software", label: "Software & subscriptions", scheduleC: "Other expenses (line 27a)" },
  { id: "hosting", label: "Hosting & infrastructure", scheduleC: "Other expenses (line 27a)" },
  { id: "fees_licenses", label: "Taxes, fees & licenses", scheduleC: "Taxes and licenses (line 23)" },
  { id: "professional", label: "Legal & professional", scheduleC: "Legal and professional services (line 17)" },
  { id: "advertising", label: "Advertising & marketing", scheduleC: "Advertising (line 8)" },
  { id: "payment_fees", label: "Payment processing fees", scheduleC: "Commissions and fees (line 10)" },
  { id: "equipment", label: "Equipment & hardware", scheduleC: "Depreciation / Section 179 (line 13)" },
  { id: "office", label: "Office & supplies", scheduleC: "Supplies / Office expense (line 22 / 18)" },
  { id: "other", label: "Other business expense", scheduleC: "Other expenses (line 27a)" },
];

/** Empty/unknown is allowed (uncategorized), surfaced so it can be cleaned up. */
export const UNCATEGORIZED_ID = "";

export function taxCategoryLabel(id: string): string {
  if (!id) return "Uncategorized";
  return TAX_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

export function taxCategoryScheduleC(id: string): string {
  return TAX_CATEGORIES.find((c) => c.id === id)?.scheduleC ?? "";
}

export function isValidTaxCategory(id: string): boolean {
  return id === UNCATEGORIZED_ID || TAX_CATEGORIES.some((c) => c.id === id);
}
