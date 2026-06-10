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

console.log("\n=== Activity reality check (typical lab writes vs the tier ceilings) ===");
for (const n of [6, 8, 20]) {
  const u = perUser(SCEN.typical);
  const labWrites = u.writesPerMonth * n;
  const computeMo = (labWrites / 1_000_000) * WRITE_USD_PER_M;
  console.log(
    `${String(n).padStart(2)}-person lab: ~${labWrites.toLocaleString()} writes/mo -> compute ${usd(computeMo)}/mo (tier ceilings are 1M-15M, so rarely hit)`,
  );
}
