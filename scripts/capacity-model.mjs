#!/usr/bin/env node
// Capacity + cost model for the shared cloud pool, to size the sponsorship tiers
// on real numbers. Bottoms-up: per-user shared-file generation + collab write
// activity, scaled to lab and department sizes, costed at the real provider
// rates, checked against the proposed tier prices.
//
// These are MODELED estimates (pre-launch, no measured usage yet). Every input
// is a labeled constant below, tweak and re-run. The two biggest unknowns are
// the SHARE FRACTION (what portion of a user's files reach the shared pool) and
// the image intensity, so three scenarios bracket them.
//
//   node scripts/capacity-model.mjs
//
// No em-dashes, no emojis, no mid-sentence colons.

const MB = 1;
const GB = 1024 * MB;

// ---- provider rates (from frontend capacity-shared.ts + config.ts) ----------
const R2_USD_PER_GB_MO = 0.015; // shared FILES live here (the bulk of the pool)
const DO_USD_PER_GB_MO = 0.2; // collab TEXT snapshots (tiny bytes)
const WRITE_USD_PER_M = 1.15; // DO rows + requests per million writes (duration excluded)
const STRIPE_PCT = 0.029;
const STRIPE_FIXED = 0.3;

// ---- usage assumptions (per ACTIVE researcher) ------------------------------
const WORKING_DAYS_PER_MONTH = 20;
const MONTHS = 12;

const SCEN = {
  light: { imgsPerDay: 2, mbPerImg: 2, shareFrac: 0.5, writesPerDay: 200, textMbPerYr: 50 },
  typical: { imgsPerDay: 5, mbPerImg: 2.5, shareFrac: 0.6, writesPerDay: 800, textMbPerYr: 150 },
  heavy: { imgsPerDay: 12, mbPerImg: 4, shareFrac: 0.7, writesPerDay: 2500, textMbPerYr: 400 },
};

// ---- proposed tiers (v2 + institutional) ------------------------------------
const TIERS = [
  { name: "Free", usd: 0, gb: 1 },
  { name: "Supporter", usd: 5, gb: 5 },
  { name: "Lab", usd: 10, gb: 25 }, // grown per the file-storage decision
  { name: "Research", usd: 25, gb: 60 },
  { name: "Department(single)", usd: 50, gb: 120 },
  { name: "Institutional", usd: 100, gb: 250 },
];

const fmtGb = (mb) => (mb / GB >= 1 ? `${(mb / GB).toFixed(1)} GB` : `${Math.round(mb)} MB`);
const usd = (n) => `$${n.toFixed(2)}`;

function perUser(s) {
  const sharedImgMbPerYr =
    s.imgsPerDay * s.mbPerImg * s.shareFrac * WORKING_DAYS_PER_MONTH * MONTHS;
  const storageMbPerYr = sharedImgMbPerYr + s.textMbPerYr; // files (R2) + text (DO)
  const writesPerMonth = s.writesPerDay * WORKING_DAYS_PER_MONTH;
  return { storageMbPerYr, textMbPerYr: s.textMbPerYr, writesPerMonth };
}

function labCost(storageMb, writesPerMonth) {
  // storage is cumulative bytes held; split text(DO) vs files(R2). Text is small.
  const textGb = 0; // text is sub-GB even for a big lab; treat as negligible R2-side
  const filesGb = storageMb / GB;
  const storageMo = filesGb * R2_USD_PER_GB_MO + (storageMb * 0 + textGb) * DO_USD_PER_GB_MO;
  const computeMo = (writesPerMonth / 1_000_000) * WRITE_USD_PER_M;
  return { storageMo, computeMo, totalMo: storageMo + computeMo };
}

console.log("=== Per-user shared generation (per YEAR storage, per MONTH writes) ===");
for (const [name, s] of Object.entries(SCEN)) {
  const u = perUser(s);
  console.log(
    `${name.padEnd(8)} ${fmtGb(u.storageMbPerYr).padStart(8)}/yr storage  ${u.writesPerMonth.toLocaleString().padStart(9)} writes/mo`,
  );
}

console.log("\n=== Per-LAB annual storage generated (members x typical user) ===");
const labSizes = [4, 6, 8, 20];
for (const n of labSizes) {
  const cells = Object.entries(SCEN).map(([name, s]) => {
    const u = perUser(s);
    return `${name}=${fmtGb(u.storageMbPerYr * n).padStart(8)}`;
  });
  console.log(`${String(n).padStart(2)} ppl/yr:  ${cells.join("   ")}`);
}

console.log("\n=== Per-DEPARTMENT annual storage (labs x 6-person typical lab) ===");
for (const labs of [8, 15]) {
  const u = perUser(SCEN.typical);
  const perLab = u.storageMbPerYr * 6;
  console.log(`${labs} labs:  ${fmtGb(perLab * labs).padStart(9)}/yr  (typical 6-person labs)`);
}

console.log("\n=== Tier fit + margin (cost = R2 storage held + DO compute at the write ceiling) ===");
console.log("tier              price   pool     ~yrs for 6-ppl typical lab   storage$/mo   margin(storage only)");
for (const t of TIERS) {
  if (t.usd === 0) {
    const u = perUser(SCEN.typical);
    const yrs = t.gb * GB / (u.storageMbPerYr * 6);
    console.log(`Free              $0      ${String(t.gb).padStart(3)} GB   ${yrs.toFixed(2)} yr`);
    continue;
  }
  const net = t.usd - (t.usd * STRIPE_PCT + STRIPE_FIXED);
  const storageMo = t.gb * R2_USD_PER_GB_MO; // full pool on R2
  const margin = net / storageMo;
  const u = perUser(SCEN.typical);
  const yrs = (t.gb * GB) / (u.storageMbPerYr * 6);
  console.log(
    `${t.name.padEnd(18)}${usd(t.usd).padStart(5)}  ${String(t.gb).padStart(3)} GB   ${yrs.toFixed(1)} yr` +
      `                       ${usd(storageMo).padStart(7)}      ${margin.toFixed(0)}x`,
  );
}

console.log("\n=== 2x-cost pricing: what 'charge double our cost' actually produces ===");
const COST_PER_GB = R2_USD_PER_GB_MO; // files dominate the pool, R2 = $0.015
const MARKUP = 2; // Grant: 2x cost, not greedy vs competitors
const pricePerGb = COST_PER_GB * MARKUP; // $0.03 / GB-month at 2x
console.log(`2x cost = $${pricePerGb.toFixed(3)} per GB-month (R2 $${COST_PER_GB} x ${MARKUP}).`);
console.log("\n(a) If we FIX the GB at a small ladder, 2x cost is sub-dollar (Stripe's");
console.log("    $0.30/charge floor makes anything under ~$5 impractical):");
for (const gb of [5, 12, 30, 60]) {
  console.log(`   ${String(gb).padStart(3)} GB -> $${(gb * pricePerGb).toFixed(2)}/mo at 2x cost  (too cheap to bill)`);
}
console.log("\n(b) If we FIX a round price and give 2x-cost GB, the pools are huge");
console.log("    (R2 is that cheap), and a typical 6-person lab uses ~11 GB/YEAR:");
const u6 = perUser(SCEN.typical).storageMbPerYr * 6; // MB/yr for a 6-person typical lab
for (const price of [5, 10, 25, 50]) {
  const gb = price / pricePerGb;
  const labYears = (gb * GB) / u6;
  const typicalLabs = (gb * GB) / (u6 * 1); // labs covered for one year of typical use
  console.log(
    `   $${String(price).padStart(2)}/mo -> ${Math.round(gb)} GB  = ~${labYears.toFixed(0)} yrs for one typical lab,` +
      ` or ~${typicalLabs.toFixed(1)} typical labs' annual use`,
  );
}
console.log("\nINSIGHT: a normal lab costs us pennies, so 2x-its-cost is unbillable.");
console.log("The honest shape: generous FREE tier (covers normal labs, ~$0 to us),");
console.log("then 2x-cost metered ($0.03/GB-mo) for the heavy IMAGE/VIDEO labs that");
console.log("actually exceed it. Round price points buy enormous pools at 2x cost.");

console.log("\n=== Free-tier coverage (how long a generous free tier lasts a lab) ===");
for (const freeGb of [1, 10, 25, 50]) {
  const yrs6 = (freeGb * GB) / u6;
  const yrs8 = (freeGb * GB) / (perUser(SCEN.typical).storageMbPerYr * 8);
  const costToUs = freeGb * COST_PER_GB;
  console.log(
    `   ${String(freeGb).padStart(2)} GB free -> ~${yrs6.toFixed(1)} yr (6-ppl) / ~${yrs8.toFixed(1)} yr (8-ppl) typical, costs us $${costToUs.toFixed(2)}/lab/mo if full`,
  );
}

console.log("\n=== Business projection (sustainable + modest reinvestment surplus) ===");
// Adjustable assumptions. Adoption %s are GUESSES (pre-launch), tweak freely.
const BIZ = {
  freeGb: 5, // bounded free tier
  markup: 3, // storage price = markup x R2 cost ($0.045/GB at 3x), still ~1/20th of competitors
  // adoption mix of total labs:
  freeShare: 0.75, // light/normal labs that stay within free, pay nothing
  paidShare: 0.2, // heavier labs that pay metered for storage beyond free
  sponsorShare: 0.05, // labs/PIs who sponsor (recognition + support)
  // per-lab figures:
  freeLabGbStored: 4, // avg bytes a free lab actually stores (under the 5 GB cap)
  paidLabGbStored: 300, // avg a paying image/video lab stores (heavy)
  sponsorUsd: 15, // avg monthly sponsorship
};
const STORE_PRICE = R2_USD_PER_GB_MO * BIZ.markup; // $/GB-mo charged
function project(nLabs) {
  const free = Math.round(nLabs * BIZ.freeShare);
  const paid = Math.round(nLabs * BIZ.paidShare);
  const spon = Math.round(nLabs * BIZ.sponsorShare);
  // costs (R2 for stored bytes) + fixed base
  const freeCost = free * BIZ.freeLabGbStored * R2_USD_PER_GB_MO;
  const paidCost = paid * BIZ.paidLabGbStored * R2_USD_PER_GB_MO;
  const FIXED_BASE_USD = 25; // Vercel + Cloudflare Workers base, paid every month
  const cost = freeCost + paidCost + FIXED_BASE_USD;
  // revenue: paid labs pay for storage beyond the free tier, plus sponsorships
  const paidBillableGb = Math.max(0, BIZ.paidLabGbStored - BIZ.freeGb);
  const paidRev = paid * paidBillableGb * STORE_PRICE;
  const sponRev = spon * BIZ.sponsorUsd;
  const grossRev = paidRev + sponRev;
  const stripeFees = grossRev * 0.029 + (paid + spon) * 0.3;
  const netRev = grossRev - stripeFees;
  const surplus = netRev - cost;
  return { free, paid, spon, cost, netRev, surplus };
}
console.log(
  `Assumptions: ${BIZ.freeGb} GB free, storage at ${BIZ.markup}x cost ($${STORE_PRICE.toFixed(3)}/GB-mo),` +
    ` mix ${BIZ.freeShare * 100}/${BIZ.paidShare * 100}/${BIZ.sponsorShare * 100} free/paid/sponsor.`,
);
for (const n of [100, 500, 1000, 2000]) {
  const p = project(n);
  console.log(
    `${String(n).padStart(4)} labs (${p.free} free / ${p.paid} paid / ${p.spon} sponsor): ` +
      `cost $${p.cost.toFixed(0)}/mo, net revenue $${p.netRev.toFixed(0)}/mo, SURPLUS $${p.surplus.toFixed(0)}/mo (pre income tax)`,
  );
}
console.log("Never loses money: the cost breaker caps total cost at your set budget regardless.");

console.log("\n=== Activity reality check (typical lab writes vs the tier ceilings) ===");
for (const n of [6, 8, 20]) {
  const u = perUser(SCEN.typical);
  const labWrites = u.writesPerMonth * n;
  const computeMo = (labWrites / 1_000_000) * WRITE_USD_PER_M;
  console.log(
    `${String(n).padStart(2)}-person lab: ~${labWrites.toLocaleString()} writes/mo -> compute ${usd(computeMo)}/mo (tier ceilings are 1M-15M, so rarely hit)`,
  );
}
