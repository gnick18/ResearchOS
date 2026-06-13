/**
 * Pricing-page assumptions, the single source of every tunable number behind
 * the public /pricing calculators (competitor savings, department builder,
 * institution builder, and the cost-math optimization diagram).
 *
 * EVERY value here is a FLAGGED PLACEHOLDER for Grant to tune. The page derives
 * its numbers from these exports and from the formulas in the calculator
 * components, so changing a number here changes the page, and the math stays
 * honest. Nothing here is a published price, billing is off during the beta,
 * and the Plus / Pro dollar figures are deliberately never printed.
 *
 * These mirror the approved mockup `docs/mockups/2026-06-10-pricing-page.html`
 * exactly, so the rendered numbers come out identical.
 *
 * Voice: no em-dashes, no emojis, no mid-sentence colons.
 */

// ── Storage cost model ──────────────────────────────────────────────────────

/** Share of synced data that rests in cheap cold storage (Cloudflare R2). The
 *  local-first design keeps almost everything cold, only a thin active layer is
 *  ever hot. FLAGGED placeholder. */
export const BLENDED_COLD_SHARE = 0.9;

/** Cold storage price, Cloudflare R2, dollars per GB per month. FLAGGED. */
export const COLD_PER_GB_MO = 0.015;

/** Active sync layer (hot) price, dollars per GB per month. FLAGGED. */
export const HOT_PER_GB_MO = 0.35;

/** Blended all-in cost per GB per month from the cold / hot split. Works out
 *  near $0.05/GB/mo, far below either tier alone. */
export const BLENDED_PER_GB_MO =
  BLENDED_COLD_SHARE * COLD_PER_GB_MO +
  (1 - BLENDED_COLD_SHARE) * HOT_PER_GB_MO;

/** A small operating buffer added on top of raw storage cost. FLAGGED. */
export const BUFFER = 0.15;

// ── Payment processing (Stripe) ─────────────────────────────────────────────

/** Stripe percentage fee. FLAGGED. */
export const STRIPE_PCT = 0.029;

/** Stripe fixed fee per charge, in dollars. FLAGGED. */
export const STRIPE_FIXED = 0.3;

/** Extra Stripe processing cost when the payer is outside the US, as a fraction
 *  added on top of STRIPE_PCT. Stripe charges roughly +1.5% for an international
 *  card plus about +1% for currency conversion. We pass this real extra cost
 *  through to international payers so a US buyer is not subsidizing it, the same
 *  cost-recovery principle as the rest of the model. FLAGGED placeholder. */
export const INTL_PROCESSING_PCT = 0.025;

// ── Free pool + lab assumptions ─────────────────────────────────────────────

/** Free shared-document storage per lab pool, in GB. The individual Free tier
 *  is the same 5 GB. FLAGGED. */
export const FREE_GB_PER_LAB = 5;

/** Estimated per-active-member storage by what a lab mainly shares, in GB.
 *  The builders average the selected types (a mix). FLAGGED placeholders. */
export const PER_MEMBER_GB_BY_SHARE_TYPE = {
  /** Notes and text. */
  notes: 0.5,
  /** Images, gels, microscopy. */
  images: 3,
  /** Large datasets. */
  datasets: 15,
} as const;

/** Assumed average members per lab, used by the institution builder where the
 *  per-lab member count is not asked directly. FLAGGED. */
export const AVG_MEMBERS_PER_LAB = 6;

/** Per-active-lab sustaining contribution above bare cost, in dollars per month.
 *  Departments and institutions pay this, and the surplus keeps ResearchOS free
 *  for individual researchers and funds the open-source development. Still a
 *  tiny fraction of competitor per-seat pricing. FLAGGED placeholder. */
export const SUSTAIN_PER_LAB = 12;

/** A conservative heavy-share estimate of optional cloud cost per person per
 *  year, in dollars. The competitor-savings tool subtracts this so the "you
 *  save" figure reflects ResearchOS's real possible cost instead of claiming
 *  zero. FLAGGED placeholder. */
export const CLOUD_PER_PERSON_YR = 18;

// ── Competitor list prices (academic) ───────────────────────────────────────

/** A competitor the savings tool can tick. `mode` is how the annual cost scales,
 *  "user" multiplies by headcount, "lab" is a flat per-lab figure. Prices are
 *  academic list prices from the vendors, cited in the marketing deck. */
export interface Competitor {
  id: string;
  name: string;
  blurb: string;
  /** Annual cost in dollars. For "user" mode this is per user per year. */
  cost: number;
  mode: "user" | "lab";
  /** The right-aligned price label shown on the row. */
  priceLabel: string;
  /** Whether the price label should read as free (academic tier). */
  free?: boolean;
  /** Whether the row starts ticked. */
  defaultOn?: boolean;
}

export const COMPETITORS: Competitor[] = [
  {
    id: "labarchives",
    name: "LabArchives",
    blurb: "Electronic lab notebook",
    cost: 330,
    mode: "user",
    priceLabel: "$330 / user / yr",
    defaultOn: true,
  },
  {
    id: "snapgene",
    name: "SnapGene",
    blurb: "Sequence editing and cloning",
    cost: 1625,
    mode: "lab",
    priceLabel: "$1,625 / yr, 5 seats",
    defaultOn: true,
  },
  {
    id: "quartzy",
    name: "Quartzy",
    blurb: "Inventory and ordering",
    cost: 1908,
    mode: "lab",
    priceLabel: "from $159 / mo",
  },
  {
    id: "benchling",
    name: "Benchling",
    blurb: "R and D notebook",
    cost: 0,
    mode: "lab",
    priceLabel: "free, academic",
    free: true,
  },
];

// ── Share-type chip options for the builders ────────────────────────────────

export interface ShareTypeOption {
  /** Per-active-member GB for this share type. */
  perMemberGB: number;
  label: string;
}

export const SHARE_TYPE_OPTIONS: ShareTypeOption[] = [
  { perMemberGB: PER_MEMBER_GB_BY_SHARE_TYPE.notes, label: "Notes and text" },
  { perMemberGB: PER_MEMBER_GB_BY_SHARE_TYPE.images, label: "Images, gels, microscopy" },
  { perMemberGB: PER_MEMBER_GB_BY_SHARE_TYPE.datasets, label: "Large datasets" },
];

/** Average the per-member GB of the selected share-type chips (a mix of types).
 *  Mirrors the mockup's avgData helper. Falls back to the first option when the
 *  selection is somehow empty, so the builders never divide by zero. */
export function avgPerMemberGB(selectedIndices: number[]): number {
  const use =
    selectedIndices.length > 0 ? selectedIndices : [0];
  const sum = use.reduce(
    (acc, i) => acc + SHARE_TYPE_OPTIONS[i].perMemberGB,
    0,
  );
  return sum / use.length;
}
