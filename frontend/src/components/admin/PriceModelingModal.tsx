"use client";

// Operator-only Model A margin explorer, mounted from /business.
//
// Shows monthly REVENUE (from periodCharge), our COST (from service-model.ts),
// the Stripe fee, NET MARGIN and margin %, so the operator can see honest
// per-lab economics for any usage scenario. Every number derives from
// MODEL_A_PLANS, periodCharge, and service-model -- no hardcoded prices or
// markups. The old storage/sustainability/storage-flip tabs are retired.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useState, useEffect, useRef } from "react";

import LivingPopup from "@/components/ui/LivingPopup";
import {
  MODEL_A_PLANS,
  periodCharge,
  ACCRUAL_CHARGE_THRESHOLD_CENTS,
  type ModelAPlanId,
} from "@/lib/billing/model-a/pricing";
import {
  PLAN_PRICES,
  DEPT_PER_LAB_DISCOUNT_CENTS,
  DEPT_USAGE_DISCOUNT_PCT,
  usd,
} from "@/lib/billing/catalog";
import {
  relayCost,
  storageRetailPerGB,
  hostedAssetMonthlyCost,
  AI_INDIV_RETAIL_PER_M,
  AI_ORG_RETAIL_PER_M,
  AI_REAL_COST_PER_M,
  STORAGE_MARKUP,
  INFRA_FIXED_MONTHLY,
} from "@/lib/pricing/service-model";
import { STRIPE_PCT, STRIPE_FIXED } from "@/lib/pricing/assumptions";

// ── formatting helpers ────────────────────────────────────────────────────────

const fmt = (n: number) =>
  (n < 0 ? "-$" : "$") + Math.abs(n).toFixed(2);

const fmt0 = (n: number) =>
  (n < 0 ? "-$" : "$") +
  Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

const fmtPct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(1) + "%";

// ── usage presets ─────────────────────────────────────────────────────────────

interface UsagePreset {
  label: string;
  /** Relay write-ops per month. */
  writes: number;
  /** Stored GB (decimal). */
  storageGB: number;
  /** Hosted-asset GB. */
  hostedGB: number;
  /** AI tokens per month, millions. */
  aiTokensM: number;
}

const PRESETS: UsagePreset[] = [
  { label: "Light note-taker", writes: 10_000, storageGB: 0.2, hostedGB: 0, aiTokensM: 0.5 },
  { label: "Typical researcher", writes: 100_000, storageGB: 2, hostedGB: 0, aiTokensM: 2 },
  { label: "Heavy imaging", writes: 400_000, storageGB: 20, hostedGB: 1, aiTokensM: 4 },
];

// ── Stripe fee on a monthly revenue amount (accrual model) ───────────────────
// Under Model A we run the card once per ~$5 of accrual (not per month), but for
// the explorer we show what the Stripe fee would be if we charged that amount
// once. For small monthly totals the $0.30 fixed fee dominates; the note below
// explains the accrual threshold.

function stripeFee(revenueDollars: number): number {
  if (revenueDollars <= 0) return 0;
  return revenueDollars * STRIPE_PCT + STRIPE_FIXED;
}

// ── canvas chart palette (explicit: Canvas cannot read CSS vars) ──────────────

const CH = {
  grid: "#d8dee6",
  axis: "#64748b",
  zero: "#e11d48",
  revenue: "#2563eb",
  cost: "#dc2626",
  net: "#16a34a",
};

function prep(
  cv: HTMLCanvasElement | null,
): { x: CanvasRenderingContext2D; w: number; h: number } | null {
  if (!cv) return null;
  const w = cv.clientWidth;
  const h = cv.clientHeight || cv.height;
  if (w === 0 || h === 0) return null;
  const dpr = window.devicePixelRatio || 1;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const x = cv.getContext("2d");
  if (!x) return null;
  x.scale(dpr, dpr);
  x.clearRect(0, 0, w, h);
  return { x, w, h };
}

// ── main explorer tab ─────────────────────────────────────────────────────────

type PaidTier = "solo" | "lab" | "dept";

export function MarginExplorerTab() {
  const [tier, setTier] = useState<PaidTier>("solo");
  const [labCount, setLabCount] = useState(3);
  const [writes, setWrites] = useState(100_000);
  const [storageGB, setStorageGB] = useState(2);
  const [hostedGB, setHostedGB] = useState(0);
  const [aiTokensM, setAiTokensM] = useState(2);
  const [activePreset, setActivePreset] = useState<string>("Typical researcher");

  const chartRef = useRef<HTMLCanvasElement | null>(null);

  const plan = MODEL_A_PLANS[tier];
  const isLabOrDept = tier === "lab" || tier === "dept";
  const labs = isLabOrDept ? labCount : 1;
  const isOrg = tier === "dept";

  // Revenue from periodCharge (base + marked-up usage + storage@1.15x + hosted@1.15x).
  const storageBytes = storageGB * 1e9;
  const hostedBytes = hostedGB * 1e9;
  const charge = periodCharge(plan, { writes, storageBytes, hostedBytes, labCount: labs });
  const revenueCents = charge.totalCents;
  const revenueDollars = revenueCents / 100;

  // Our provider cost (relay + storage pass-through at bare cost, no markup).
  const writesM = writes / 1_000_000;
  const relayCostDollars = relayCost(writesM);
  // Storage cost at BLENDED rate (no markup, that is inside storageRetailPerGB).
  // We derive bare storage cost from the retail formula: retail = bare * STORAGE_MARKUP.
  const storageCostDollars = (storageGB * storageRetailPerGB()) / STORAGE_MARKUP;
  const hostedCostDollars = hostedAssetMonthlyCost(hostedGB) / STORAGE_MARKUP;

  // AI margin (revenue side: what we charge; cost side: our inference cost).
  const aiRetailPerM = isOrg ? AI_ORG_RETAIL_PER_M : AI_INDIV_RETAIL_PER_M;
  const aiRevenueDollars = aiTokensM * aiRetailPerM;
  const aiCostDollars = aiTokensM * AI_REAL_COST_PER_M;
  const aiNetDollars = aiRevenueDollars - aiCostDollars;

  const totalRevenueDollars = revenueDollars + aiRevenueDollars;
  const totalCostDollars = relayCostDollars + storageCostDollars + hostedCostDollars + aiCostDollars;

  // Stripe fee on the subscription/usage part (AI is bought in prepaid packs, modeled
  // separately; for simplicity we apply one Stripe fee on the total revenue).
  const stripeDollars = stripeFee(totalRevenueDollars);

  const netDollars = totalRevenueDollars - totalCostDollars - stripeDollars;
  const marginPct =
    totalRevenueDollars > 0
      ? ((netDollars / totalRevenueDollars) * 100)
      : 0;

  // Dept vs Lab discount display.
  const labPlan = MODEL_A_PLANS.lab;
  const deptPlan = MODEL_A_PLANS.dept;

  function applyPreset(p: UsagePreset) {
    setWrites(p.writes);
    setStorageGB(p.storageGB);
    setHostedGB(p.hostedGB);
    setAiTokensM(p.aiTokensM);
    setActivePreset(p.label);
  }

  // Chart: revenue vs cost vs net across write-op range.
  function drawChart() {
    const c = prep(chartRef.current);
    if (!c) return;
    const { x, w, h } = c;
    const padL = 62, padR = 14, padT = 14, padB = 28;
    const W = w - padL - padR, H = h - padT - padB;
    const maxW = 1_000_000;

    const pts: { wM: number; rev: number; cost: number; net: number }[] = [];
    for (let i = 0; i <= 100; i++) {
      const wOps = (maxW * i) / 100;
      const wM = wOps / 1_000_000;
      const ch = periodCharge(plan, {
        writes: wOps,
        storageBytes,
        hostedBytes,
        labCount: labs,
      });
      const rev = ch.totalCents / 100 + aiRevenueDollars;
      const cst =
        relayCost(wM) +
        storageCostDollars +
        hostedCostDollars +
        aiCostDollars;
      const stripe = stripeFee(rev);
      pts.push({ wM, rev, cost: cst, net: rev - cst - stripe });
    }

    const allY = pts.flatMap((p) => [p.rev, p.cost, p.net]);
    let ymin = Math.min(...allY, 0);
    let ymax = Math.max(...allY, 1);
    const yr = ymax - ymin || 1;
    ymin -= yr * 0.06;
    ymax += yr * 0.06;

    const X = (wM: number) => padL + (W * wM) / (maxW / 1_000_000);
    const Y = (v: number) => padT + H * (1 - (v - ymin) / (ymax - ymin));

    x.strokeStyle = CH.grid;
    x.fillStyle = CH.axis;
    x.font = "11px sans-serif";
    x.lineWidth = 1;

    for (let g = 0; g <= 4; g++) {
      const v = ymin + ((ymax - ymin) * g) / 4;
      const yy = Y(v);
      x.beginPath();
      x.moveTo(padL, yy);
      x.lineTo(w - padR, yy);
      x.stroke();
      x.fillText(fmt(v), 4, yy + 3);
    }
    for (let wk = 0; wk <= 10; wk += 2) {
      x.fillText(wk * 100 + "k", X(wk * 0.1) - 8, h - 10);
    }

    // Zero line.
    x.strokeStyle = CH.zero;
    x.lineWidth = 1.5;
    x.beginPath();
    x.moveTo(padL, Y(0));
    x.lineTo(w - padR, Y(0));
    x.stroke();

    // Current writes marker.
    const curX = X(writesM);
    x.strokeStyle = "#94a3b8";
    x.setLineDash([4, 3]);
    x.lineWidth = 1.5;
    x.beginPath();
    x.moveTo(curX, padT);
    x.lineTo(curX, h - padB);
    x.stroke();
    x.setLineDash([]);

    const drawLine = (key: "rev" | "cost" | "net", color: string) => {
      x.strokeStyle = color;
      x.lineWidth = 2.4;
      x.beginPath();
      pts.forEach((p, i) => {
        const px = X(p.wM), py = Y(p[key]);
        i ? x.lineTo(px, py) : x.moveTo(px, py);
      });
      x.stroke();
    };

    drawLine("cost", CH.cost);
    drawLine("rev", CH.revenue);
    drawLine("net", CH.net);
  }

  useEffect(() => {
    const draw = () => drawChart();
    const id = requestAnimationFrame(draw);
    window.addEventListener("resize", draw);
    return () => { cancelAnimationFrame(id); window.removeEventListener("resize", draw); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier, labCount, writes, storageGB, hostedGB, aiTokensM]);

  return (
    <div className="space-y-6 text-foreground">

      {/* tier + scale */}
      <Panel title="Tier + scale">
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <Lbl>Tier</Lbl>
            <Seg
              options={[
                { id: "solo", label: "Solo" },
                { id: "lab", label: "Lab" },
                { id: "dept", label: "Department" },
              ]}
              value={tier}
              onChange={(v) => setTier(v as PaidTier)}
            />
            <p className="mt-2 text-meta text-foreground-muted">
              Solo: ${(MODEL_A_PLANS.solo.baseFeeCents / 100).toFixed(0)}/mo flat
              (one subscriber). Lab: ${(MODEL_A_PLANS.lab.baseFeeCents / 100).toFixed(0)}/mo
              per lab. Dept: ${(MODEL_A_PLANS.dept.baseFeeCents / 100).toFixed(0)}/mo
              per lab (volume discount).
            </p>

            {isLabOrDept && (
              <>
                <Lbl>
                  Lab count: {labCount}{" "}
                  {tier === "dept" ? "labs in the department" : "lab(s)"}
                </Lbl>
                <input
                  type="range"
                  min={1}
                  max={30}
                  step={1}
                  value={labCount}
                  onChange={(e) => setLabCount(+e.target.value)}
                  className="w-full accent-sky-600"
                />
              </>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-meta text-foreground-muted">Base fee this month</div>
            <div className="text-display font-extrabold tracking-tight text-foreground">
              {usd(charge.baseCents)}
            </div>
            <div className="text-meta text-foreground-muted">
              {isLabOrDept
                ? `${usd(plan.baseFeeCents)} x ${labs} lab${labs !== 1 ? "s" : ""}`
                : "one subscriber"}
            </div>
            <div className="mt-3 text-meta text-foreground-muted">
              Usage markup on relay/compute
            </div>
            <div className="text-body font-semibold text-foreground">
              {plan.usageMarkup}x bare relay cost
            </div>
            {tier === "dept" && (
              <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-meta text-foreground">
                Dept saves{" "}
                <b>
                  {usd(DEPT_PER_LAB_DISCOUNT_CENTS)}/lab/mo
                </b>{" "}
                on base vs standalone Lab, and{" "}
                <b>{DEPT_USAGE_DISCOUNT_PCT}% less on usage markup</b> (
                {deptPlan.usageMarkup}x vs {labPlan.usageMarkup}x). Both tiers
                bill storage at the same 1.15x cost-recovery rate.
              </div>
            )}
          </div>
        </div>
      </Panel>

      {/* usage */}
      <Panel title="Usage this month">
        <div className="mb-3 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(p)}
              className={`rounded-lg border px-3 py-1.5 text-meta font-medium transition-colors ${
                activePreset === p.label
                  ? "border-sky-600 bg-sky-600 text-white"
                  : "border-border bg-surface-sunken text-foreground-muted hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <Lbl>
              Relay write-ops: {writes >= 1_000_000
                ? `${(writes / 1_000_000).toFixed(2)}M`
                : writes >= 1_000
                ? `${(writes / 1_000).toFixed(0)}k`
                : writes}
            </Lbl>
            <input
              type="range"
              min={0}
              max={1_000_000}
              step={5_000}
              value={writes}
              onChange={(e) => { setWrites(+e.target.value); setActivePreset(""); }}
              className="w-full accent-sky-600"
            />
            <Lbl>Stored data: {storageGB.toFixed(1)} GB</Lbl>
            <input
              type="range"
              min={0}
              max={100}
              step={0.5}
              value={storageGB}
              onChange={(e) => { setStorageGB(+e.target.value); setActivePreset(""); }}
              className="w-full accent-sky-600"
            />
            <Lbl>Hosted companion-site assets: {hostedGB.toFixed(1)} GB</Lbl>
            <input
              type="range"
              min={0}
              max={20}
              step={0.1}
              value={hostedGB}
              onChange={(e) => { setHostedGB(+e.target.value); setActivePreset(""); }}
              className="w-full accent-sky-600"
            />
            <Lbl>AI tokens: {aiTokensM.toFixed(1)}M tok/mo</Lbl>
            <input
              type="range"
              min={0}
              max={20}
              step={0.5}
              value={aiTokensM}
              onChange={(e) => { setAiTokensM(+e.target.value); setActivePreset(""); }}
              className="w-full accent-sky-600"
            />
            <p className="mt-2 text-meta text-foreground-muted">
              AI markup: {isOrg ? "2x (dept/institution org rate)" : "1.4x (individual/lab rate)"}
              . Retail {fmt(aiRetailPerM)}/1M tokens, our cost {fmt(AI_REAL_COST_PER_M)}/1M.
            </p>
          </div>

          <div className="space-y-1">
            <div className="text-meta font-semibold text-foreground-muted">Revenue breakdown</div>
            <Kv k="Base fee" v={usd(charge.baseCents)} />
            <Kv k={`Relay/compute (${plan.usageMarkup}x markup)`} v={usd(charge.usageCents)} />
            <Kv k="Storage (1.15x)" v={usd(charge.storageCents)} />
            <Kv k="Hosted assets (1.15x)" v={usd(charge.hostedCents)} />
            <Kv k={`AI (${isOrg ? "2x" : "1.4x"} markup)`} v={fmt(aiRevenueDollars)} />
            <Kv k="Total revenue" v={fmt(totalRevenueDollars)} bold />
          </div>
        </div>
      </Panel>

      {/* margin */}
      <Panel title="Cost, Stripe fee, and net margin">
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-1">
            <div className="text-meta font-semibold text-foreground-muted">Our cost</div>
            <Kv k="Relay/compute (bare)" v={fmt(relayCostDollars)} />
            <Kv k="Storage (bare, 1.0x)" v={fmt(storageCostDollars)} />
            <Kv k="Hosted assets (bare)" v={fmt(hostedCostDollars)} />
            <Kv k="AI inference (real cost)" v={fmt(aiCostDollars)} />
            <Kv k="Total provider cost" v={fmt(totalCostDollars)} bold />
            <div className="mt-3" />
            <div className="text-meta font-semibold text-foreground-muted">Stripe</div>
            <Kv
              k={`${(STRIPE_PCT * 100).toFixed(1)}% + $${STRIPE_FIXED.toFixed(2)} per charge`}
              v={fmt(stripeDollars)}
            />
            <p className="mt-1 text-meta text-foreground-muted">
              Under Model A we only run the card when accrued balance crosses ~
              {usd(ACCRUAL_CHARGE_THRESHOLD_CENTS)} (~$
              {(ACCRUAL_CHARGE_THRESHOLD_CENTS / 100).toFixed(0)}), or at close.
              The $0.30 fixed fee is amortized across all the usage since the last
              charge, so low-activity users cost much less in Stripe fees than this
              per-month estimate shows.
            </p>
          </div>

          <div>
            <div className="text-meta font-semibold text-foreground-muted">Net margin</div>
            <div className="mt-1 text-display font-extrabold tracking-tight">
              <span className={netDollars < 0 ? "text-rose-600" : "text-emerald-600"}>
                {fmt(netDollars)}
              </span>
              <span className="ml-2 text-meta font-normal text-foreground-muted">/mo</span>
            </div>
            <div className="mt-1">
              <span
                className={`inline-block rounded-full px-2.5 py-0.5 text-meta font-bold ${
                  marginPct >= 40
                    ? "bg-emerald-100 text-emerald-700"
                    : marginPct >= 0
                    ? "bg-amber-100 text-amber-700"
                    : "bg-rose-100 text-rose-700"
                }`}
              >
                {fmtPct(marginPct)} margin
              </span>
            </div>
            <div className="mt-4 space-y-1">
              <Kv k="Revenue" v={fmt(totalRevenueDollars)} />
              <Kv k="minus provider cost" v={fmt(totalCostDollars)} />
              <Kv k="minus Stripe" v={fmt(stripeDollars)} />
              <Kv
                k="Net to us"
                v={fmt(netDollars)}
                bold
                tone={netDollars < 0 ? "bad" : "good"}
              />
            </div>

            <div className="mt-4 space-y-1 border-t border-border pt-3">
              <div className="text-meta font-semibold text-foreground-muted">AI line detail</div>
              <Kv k="AI revenue" v={fmt(aiRevenueDollars)} />
              <Kv k="AI cost" v={fmt(aiCostDollars)} />
              <Kv k="AI net" v={fmt(aiNetDollars)} tone={aiNetDollars >= 0 ? "good" : "bad"} />
            </div>
          </div>
        </div>

        <canvas
          ref={chartRef}
          height={260}
          className="mt-5 block w-full rounded-lg border border-border bg-surface-sunken"
          style={{ height: 260 }}
        />
        <Legend
          items={[
            { c: CH.revenue, t: "revenue" },
            { c: CH.cost, t: "provider cost" },
            { c: CH.net, t: "net margin" },
            { c: CH.zero, t: "break-even (0)" },
            { c: "#94a3b8", t: "current write-ops" },
          ]}
        />
        <p className="mt-2 text-meta text-foreground-muted">
          X-axis is relay write-ops (0 to 1M/mo); all other sliders stay fixed.
          AI tokens are held at {aiTokensM.toFixed(1)}M throughout.
        </p>
      </Panel>

      {/* dept vs lab comparison */}
      <Panel title="Dept vs Lab: per-lab cost and markup comparison">
        <div className="grid gap-4 lg:grid-cols-3">
          <div>
            <div className="text-meta text-foreground-muted">Lab tier</div>
            <Kv k="Base / lab / mo" v={usd(labPlan.baseFeeCents)} />
            <Kv k="Usage markup" v={`${labPlan.usageMarkup}x`} />
            <Kv k="Storage markup" v="1.15x (same)" />
          </div>
          <div>
            <div className="text-meta text-foreground-muted">Dept tier (per lab)</div>
            <Kv k="Base / lab / mo" v={usd(deptPlan.baseFeeCents)} />
            <Kv k="Usage markup" v={`${deptPlan.usageMarkup}x`} />
            <Kv k="Storage markup" v="1.15x (same)" />
          </div>
          <div>
            <div className="text-meta text-foreground-muted">Dept savings vs Lab</div>
            <Kv
              k="Base discount / lab"
              v={usd(DEPT_PER_LAB_DISCOUNT_CENTS)}
              tone="good"
            />
            <Kv
              k="Usage markdown"
              v={`${DEPT_USAGE_DISCOUNT_PCT}% less`}
              tone="good"
            />
            <p className="mt-2 text-meta text-foreground-muted">
              Dept is the INSTITUTIONAL VOLUME tier. Landing a department brings
              many labs at once (our distribution win), so we reward that with
              lower per-lab cost on both axes. The governance layer (Commons,
              cross-lab compliance, one invoice) is included value, not a premium.
            </p>
          </div>
        </div>
      </Panel>

      {/* at-cost lines note */}
      <div className="rounded-xl border border-border bg-surface-sunken px-4 py-3 text-meta leading-relaxed text-foreground-muted">
        <b className="text-foreground">Storage and hosted assets are pass-through, never a profit center.</b>{" "}
        Both bill at{" "}
        {STORAGE_MARKUP.toFixed(2)}x bare cost (retail {fmt(storageRetailPerGB())}/GB,
        blended at {(STORAGE_MARKUP - 1) * 100}% markup to cover Stripe + buffer).
        The margin in this tool comes entirely from the base fee and the relay/compute
        markup. Infra floor: {fmt(INFRA_FIXED_MONTHLY)}/mo (platform + amortized
        annual fees), not deducted here because it is a company-wide cost, not
        per-lab.
      </div>
    </div>
  );
}

// ── shared small UI bits ──────────────────────────────────────────────────────

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface-raised p-5">
      <h3 className="mb-3 text-body font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Lbl({ children }: { children: React.ReactNode }) {
  return (
    <label className="mt-3 block text-meta text-foreground-muted">{children}</label>
  );
}

function Kv({
  k,
  v,
  bold,
  tone,
}: {
  k: string;
  v: string;
  bold?: boolean;
  tone?: "good" | "bad";
}) {
  const toneCls =
    tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-rose-600" : "";
  return (
    <div className="flex justify-between border-b border-dashed border-border py-1 text-meta">
      <span
        className={bold ? "font-semibold text-foreground" : "text-foreground-muted"}
      >
        {k}
      </span>
      <span className={`tabular-nums ${bold ? "font-semibold" : ""} ${toneCls}`}>
        {v}
      </span>
    </div>
  );
}

function Seg({
  options,
  value,
  onChange,
  wrap,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  wrap?: boolean;
}) {
  return (
    <div
      className={`inline-flex overflow-hidden rounded-lg border border-border ${wrap ? "flex-wrap" : ""}`}
    >
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={`px-3.5 py-2 text-meta ${
              on
                ? "bg-sky-600 font-bold text-white"
                : "bg-surface-sunken text-foreground-muted hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Legend({ items }: { items: { c: string; t: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-meta text-foreground-muted">
      {items.map((it) => (
        <span key={it.t} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: it.c }}
          />
          {it.t}
        </span>
      ))}
    </div>
  );
}

// ── modal shell ───────────────────────────────────────────────────────────────

export default function PriceModelingModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <LivingPopup
      open={open}
      onClose={onClose}
      label="Price modeling"
      widthClassName="max-w-4xl"
      fillHeight
      padded
    >
      <div className="text-foreground">
        <h2 className="text-heading font-bold tracking-tight text-foreground">
          Model A margin explorer
        </h2>
        <p className="mt-1 text-meta leading-relaxed text-foreground-muted">
          Operator-only. Pick a tier, set usage, see revenue vs cost vs net
          margin. Every number comes from MODEL_A_PLANS, periodCharge, and
          service-model -- no hardcoded prices or markups. Internal cost figures,
          never shown to a user.
        </p>

        <div className="mt-5">
          <MarginExplorerTab />
        </div>
      </div>
    </LivingPopup>
  );
}
