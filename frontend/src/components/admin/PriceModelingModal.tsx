"use client";

// Operator-only Price modeling tool, the modal opened from /business.
//
// A living port of the two exact-spec mockups
//   docs/mockups/2026-06-14-storage-pricing-models.html  (per-subscriber)
//   docs/mockups/2026-06-14-sustainability-model.html     (sustainability)
// It is NOT a frozen mockup, every number recomputes live from the pure helpers
// in lib/pricing/modeling.ts, which read assumptions.ts + plans.ts + cost-math.ts.
// Change a pricing constant and this tool moves with it.
//
// Internal only. It exposes raw cost economics, so it lives behind the existing
// /business operator gate and is never shown on a public surface.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useRef, useState } from "react";

import LivingPopup from "@/components/ui/LivingPopup";
import {
  ACTIVITY_PER_M_WRITES,
  BLENDED_PER_GB_MO,
  BUFFER,
  FREE_GB_PER_LAB,
  STRIPE_FIXED,
  STRIPE_PCT,
  SUSTAIN_PER_LAB,
} from "@/lib/pricing/assumptions";
import {
  FREE_GB_INDIVIDUAL,
  MEMBERS_PER_LAB,
  PER_MEMBER_GB,
  avgFreeUserCost,
  bareCost,
  modelTiers,
  netMargin,
  priceStorageOnly,
  priceWithActivity,
  stripeOn,
  subscriberMargin,
  sustainability,
  tierPrice,
  type FreeUsageMix,
  type ModelTier,
  type PayingSide,
  type PricingModel,
} from "@/lib/pricing/modeling";

// Canvas chart palette. Canvas cannot read Tailwind tokens, so the chart colors
// are explicit. Chosen to read on the light operator surface.
const CH = {
  grid: "#d8dee6",
  axis: "#64748b",
  zero: "#e11d48",
  storage: "#2563eb",
  activity: "#7c3aed",
  throttle: "#d97706",
  net: "#16a34a",
  good: "#16a34a",
  bad: "#dc2626",
};

const fmt = (n: number) =>
  (n < 0 ? "-$" : "$") + Math.abs(n).toFixed(2);
const fmt0 = (n: number) =>
  (n < 0 ? "-$" : "$") +
  Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

// --- small shared chart helper -----------------------------------------------

/** Prepare a canvas for crisp drawing, returns the 2d ctx + CSS dimensions.
 *  Returns null when the canvas is not laid out yet (hidden tab, width 0). */
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

// ============================================================================
// Tab 1: per-subscriber economics
// ============================================================================

const TIERS = modelTiers();

interface ScaleEcon {
  rev: number;
  cost: number;
  labs: number;
}

/** Group economics for a chosen scale + size + model. Mirrors the mockup's
 *  scaleEcon, recomputed from the live helpers. */
function scaleEcon(
  kind: "indiv" | "lab" | "dept" | "inst",
  size: number,
  model: PricingModel,
): ScaleEcon {
  const pro = TIERS.find((t) => t.id === "pro");
  const labPlus = TIERS.find((t) => t.id === "lab_plus");
  const labPro = TIERS.find((t) => t.id === "lab_pro");

  if (kind === "indiv" && pro) {
    const price = tierPrice(pro, model);
    return { rev: price, cost: bareCost(8, 0.1) + stripeOn(price), labs: 0 };
  }
  if (kind === "lab" && labPlus && labPro) {
    const members = size;
    const gb = Math.min(labPro.capGB, members * PER_MEMBER_GB);
    const tier = gb > labPlus.capGB ? labPro : labPlus;
    const price = tierPrice(tier, model);
    const act = members * 0.1;
    return { rev: price, cost: bareCost(gb, act) + stripeOn(price), labs: 1 };
  }

  // dept / inst: pooled storage recovery + sustain per active lab.
  const labs = kind === "dept" ? size * 10 : size * 6 * 8;
  const members = labs * MEMBERS_PER_LAB;
  const gb = members * PER_MEMBER_GB;
  const recovery = priceStorageOnly(gb, labs * FREE_GB_PER_LAB);
  const sustain = labs * SUSTAIN_PER_LAB;
  const actPrice = model === "activity" ? members * 0.1 * ACTIVITY_PER_M_WRITES : 0;
  const rev = recovery + sustain + actPrice;
  return {
    rev,
    cost: bareCost(gb, members * 0.1) + stripeOn(rev),
    labs,
  };
}

const SCENARIOS = [
  { n: "Light note-taker", gb: 0.3, a: 0.01 },
  { n: "Typical researcher", gb: 3, a: 0.1 },
  { n: "Heavy (imaging)", gb: 9, a: 0.3 },
  { n: "Real-time collaborator", gb: 10, a: 2 },
  { n: "Power / automated", gb: 4, a: 8 },
];

function PerSubscriberTab({ active }: { active: boolean }) {
  const [model, setModel] = useState<PricingModel>("storage");
  const [tierId, setTierId] = useState<string>("free");
  const [gb, setGb] = useState(3);
  const [act, setAct] = useState(0.1);
  const [scale, setScale] = useState<"indiv" | "lab" | "dept" | "inst">("indiv");
  const [size, setSize] = useState(8);

  const marginRef = useRef<HTMLCanvasElement | null>(null);
  const heatRef = useRef<HTMLCanvasElement | null>(null);
  const scaleRef = useRef<HTMLCanvasElement | null>(null);

  const tier = TIERS.find((t) => t.id === tierId) ?? TIERS[0];
  const price = tierPrice(tier, model);
  const breakdown = subscriberMargin(price, gb, act);

  // --- draw: margin-vs-activity ---
  function drawMargin() {
    const c = prep(marginRef.current);
    if (!c) return;
    const { x, w, h } = c;
    const padL = 54,
      padR = 14,
      padT = 14,
      padB = 30;
    const W = w - padL - padR,
      H = h - padT - padB;
    const maxAct = 10;
    const yvals: number[] = [];
    for (let i = 0; i <= 100; i++) {
      const a = (maxAct * i) / 100;
      yvals.push(netMargin(priceStorageOnly(tier.capGB, tier.freeGB), gb, a));
      yvals.push(
        netMargin(priceWithActivity(tier.capGB, tier.freeGB, tier.throttleM), gb, a),
      );
    }
    let ymin = Math.min(...yvals, 0),
      ymax = Math.max(...yvals, 0.5);
    const yr = ymax - ymin || 1;
    ymin -= yr * 0.1;
    ymax += yr * 0.1;
    const X = (a: number) => padL + (W * a) / maxAct;
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
      x.fillText(fmt(v), 6, yy + 3);
    }
    for (let a = 0; a <= maxAct; a += 2) x.fillText(a + "M", X(a) - 6, h - 10);
    x.strokeStyle = CH.zero;
    x.lineWidth = 1.5;
    x.beginPath();
    x.moveTo(padL, Y(0));
    x.lineTo(w - padR, Y(0));
    x.stroke();
    x.strokeStyle = CH.throttle;
    x.setLineDash([5, 4]);
    x.beginPath();
    x.moveTo(X(Math.min(tier.throttleM, maxAct)), padT);
    x.lineTo(X(Math.min(tier.throttleM, maxAct)), h - padB);
    x.stroke();
    x.setLineDash([]);
    const curve = (p: number, color: string) => {
      x.strokeStyle = color;
      x.lineWidth = 2.4;
      x.beginPath();
      for (let i = 0; i <= 120; i++) {
        const a = (maxAct * i) / 120;
        const v = netMargin(p, gb, a);
        const px = X(a),
          py = Y(v);
        i ? x.lineTo(px, py) : x.moveTo(px, py);
      }
      x.stroke();
    };
    curve(priceStorageOnly(tier.capGB, tier.freeGB), CH.storage);
    curve(priceWithActivity(tier.capGB, tier.freeGB, tier.throttleM), CH.activity);
  }

  // --- draw: loss-zone heatmap (storage-only, no throttle) ---
  function drawHeat() {
    const c = prep(heatRef.current);
    if (!c) return;
    const { x, w, h } = c;
    const padL = 54,
      padR = 14,
      padT = 10,
      padB = 30;
    const W = w - padL - padR,
      H = h - padT - padB;
    const maxGB = 200,
      maxAct = 10,
      cols = 60,
      rows = 40;
    const cw = W / cols,
      ch = H / rows;
    for (let col = 0; col < cols; col++) {
      for (let r = 0; r < rows; r++) {
        const g = (maxGB * (col + 0.5)) / cols,
          a = (maxAct * (r + 0.5)) / rows;
        const p = priceStorageOnly(Math.max(g, 1.01), 1);
        const n = netMargin(p, g, a);
        const good = n >= 0;
        const mag = Math.min(1, Math.abs(n) / 8);
        x.fillStyle = good
          ? `rgba(22,163,74,${0.16 + 0.5 * mag})`
          : `rgba(220,38,38,${0.22 + 0.6 * mag})`;
        x.fillRect(padL + col * cw, padT + (rows - 1 - r) * ch, cw + 0.5, ch + 0.5);
      }
    }
    x.strokeStyle = CH.grid;
    x.strokeRect(padL, padT, W, H);
    x.fillStyle = CH.axis;
    x.font = "11px sans-serif";
    for (let g = 0; g <= maxGB; g += 50)
      x.fillText(g + "GB", padL + (W * g) / maxGB - 10, h - 10);
    for (let a = 0; a <= maxAct; a += 2)
      x.fillText(a + "M", 8, padT + H * (1 - a / maxAct) + 3);
    x.fillText("writes/mo up,  storage right", padL + 4, padT + 14);
  }

  // --- draw: company-scale ---
  function drawScale() {
    const c = prep(scaleRef.current);
    if (!c) return;
    const { x, w, h } = c;
    const padL = 54,
      padR = 14,
      padT = 14,
      padB = 28;
    const W = w - padL - padR,
      H = h - padT - padB;
    const maxN = scale === "indiv" ? 1 : 50;
    const pts: { i: number; so: number; sa: number }[] = [];
    for (let i = 1; i <= maxN; i++) {
      const so = scaleEcon(scale, i, "storage"),
        sa = scaleEcon(scale, i, "activity");
      pts.push({ i, so: so.rev - so.cost, sa: sa.rev - sa.cost });
    }
    let ymax = Math.max(0.5, ...pts.map((p) => Math.max(p.so, p.sa))),
      ymin = Math.min(0, ...pts.map((p) => Math.min(p.so, p.sa)));
    const X = (i: number) => padL + (W * (i - 1)) / Math.max(1, maxN - 1);
    const Y = (v: number) => padT + H * (1 - (v - ymin) / (ymax - ymin || 1));
    x.strokeStyle = CH.grid;
    x.fillStyle = CH.axis;
    x.font = "11px sans-serif";
    for (let g = 0; g <= 4; g++) {
      const v = ymin + ((ymax - ymin) * g) / 4;
      const yy = Y(v);
      x.beginPath();
      x.moveTo(padL, yy);
      x.lineTo(w - padR, yy);
      x.stroke();
      x.fillText(fmt(v), 6, yy + 3);
    }
    x.strokeStyle = CH.zero;
    x.beginPath();
    x.moveTo(padL, Y(0));
    x.lineTo(w - padR, Y(0));
    x.stroke();
    const line = (key: "so" | "sa", color: string) => {
      x.strokeStyle = color;
      x.lineWidth = 2.4;
      x.beginPath();
      pts.forEach((p, i) => {
        const px = X(p.i),
          py = Y(p[key]);
        i ? x.lineTo(px, py) : x.moveTo(px, py);
      });
      x.stroke();
    };
    line("so", CH.storage);
    line("sa", CH.activity);
    x.fillStyle = CH.axis;
    x.fillText("group size right", w - 120, h - 8);
  }

  // Redraw on every input change, on becoming active, and on resize.
  useEffect(() => {
    if (!active) return;
    const draw = () => {
      drawMargin();
      drawHeat();
      drawScale();
    };
    // rAF so the canvas has its layout width after a tab switch.
    const id = requestAnimationFrame(draw);
    window.addEventListener("resize", draw);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("resize", draw);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, model, tierId, gb, act, scale, size]);

  const so = scaleEcon(scale, size, "storage");
  const sa = scaleEcon(scale, size, "activity");
  const sizeLbl =
    scale === "indiv"
      ? "1 researcher"
      : scale === "lab"
        ? `${size} members`
        : scale === "dept"
          ? `${size} labs`
          : `${size} depts`;

  return (
    <div className="space-y-6 text-foreground">
      <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-meta leading-relaxed text-foreground">
        <b>Bottom line.</b> Storage-only pricing loses money only on
        low-storage high-activity users (heavy real-time collab or automation),
        and it is fully bounded by the activity throttle. Set each tier write
        ceiling so ceiling times {fmt(ACTIVITY_PER_M_WRITES)}/M stays under the
        price and you never lose money. For typical users activity is pennies, so
        storage-only just trims margin. The throttle is the load-bearing guard.
      </p>

      {/* cost basis */}
      <Panel title="The cost basis (what a subscriber actually costs us)">
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          <Kv k="Blended storage" v={`$${BLENDED_PER_GB_MO.toFixed(4)} / GB mo`} />
          <Kv k="Activity (writes)" v={`${fmt(ACTIVITY_PER_M_WRITES)} / M writes`} />
          <Kv k="Operating buffer" v={`${Math.round(BUFFER * 100)}%`} />
          <Kv k="Stripe" v={`${(STRIPE_PCT * 100).toFixed(1)}% + ${fmt(STRIPE_FIXED)}`} />
          <Kv k="Dept/inst sustain" v={`${fmt0(SUSTAIN_PER_LAB)} / active lab`} />
          <Kv
            k="Free pool"
            v={`${FREE_GB_INDIVIDUAL} GB indiv / ${FREE_GB_PER_LAB} GB lab`}
          />
        </div>
      </Panel>

      {/* single subscriber */}
      <Panel title="1. One subscriber: where does each model make or lose money?">
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <Seg
              options={[
                { id: "storage", label: "Storage-only price" },
                { id: "activity", label: "Storage + activity price" },
              ]}
              value={model}
              onChange={(v) => setModel(v as PricingModel)}
            />
            <Lbl>Tier: {tier.name}</Lbl>
            <Seg
              wrap
              options={TIERS.map((t) => ({
                id: t.id,
                label: `${t.name} ${Math.round(t.capGB)}GB`,
              }))}
              value={tierId}
              onChange={(v) => {
                setTierId(v);
                const nt = TIERS.find((t) => t.id === v);
                if (nt) setGb((g) => Math.min(nt.capGB, g));
              }}
            />
            <Lbl>Storage used: {gb.toFixed(0)} GB</Lbl>
            <input
              type="range"
              min={0}
              max={500}
              step={1}
              value={gb}
              onChange={(e) => setGb(+e.target.value)}
              className="w-full accent-sky-600"
            />
            <Lbl>Monthly writes (activity): {act.toFixed(2)}M writes</Lbl>
            <input
              type="range"
              min={0}
              max={10}
              step={0.05}
              value={act}
              onChange={(e) => setAct(+e.target.value)}
              className="w-full accent-sky-600"
            />
            <p className="mt-2 text-meta text-foreground-muted">
              The throttle ceiling for this tier is marked on the chart. A user
              cannot exceed it (sync degrades past it), so it caps our activity
              exposure.
            </p>
          </div>
          <div>
            <div className="text-display font-extrabold tracking-tight">
              <span className={breakdown.net < 0 ? "text-rose-600" : "text-emerald-600"}>
                {fmt(breakdown.net)}
              </span>{" "}
              <span className="text-meta font-normal text-foreground-muted">/mo net</span>
            </div>
            <div className="mt-1">
              {breakdown.net < 0 ? (
                <span className="inline-block rounded-full bg-rose-100 px-2.5 py-0.5 text-meta font-bold text-rose-700">
                  LOSS on this user
                </span>
              ) : (
                <span className="inline-block rounded-full bg-emerald-100 px-2.5 py-0.5 text-meta font-bold text-emerald-700">
                  profitable
                </span>
              )}
            </div>
            <div className="mt-3">
              <Kv k="Price charged" v={fmt(breakdown.price)} />
              <Kv k="minus storage cost" v={fmt(breakdown.storageCost)} />
              <Kv k="minus activity cost" v={fmt(breakdown.activityCost)} />
              <Kv k="minus Stripe" v={fmt(breakdown.stripe)} />
              <Kv
                k="Net to us"
                bold
                v={fmt(breakdown.net)}
                tone={breakdown.net < 0 ? "bad" : "good"}
              />
            </div>
          </div>
        </div>
        <canvas
          ref={marginRef}
          height={300}
          className="mt-4 block w-full rounded-lg border border-border bg-surface-sunken"
          style={{ height: 300 }}
        />
        <Legend
          items={[
            { c: CH.storage, t: "storage-only margin" },
            { c: CH.activity, t: "storage+activity margin" },
            { c: CH.throttle, t: "throttle ceiling" },
            { c: CH.zero, t: "break-even (0)" },
          ]}
        />
      </Panel>

      {/* loss zone heatmap */}
      <Panel title="2. The loss zone (storage-only model, no throttle)">
        <p className="text-meta text-foreground-muted">
          Each point is a subscriber with that storage (x) and monthly writes
          (y). Green is profit, red is loss, under storage-only pricing with no
          throttle. The red corner is the danger, little stored and lots written.
          The throttle erases the red by capping y at each tier ceiling.
        </p>
        <canvas
          ref={heatRef}
          height={320}
          className="mt-3 block w-full rounded-lg border border-border bg-surface-sunken"
          style={{ height: 320 }}
        />
      </Panel>

      {/* company scale */}
      <Panel title="3. Scale of the group: revenue vs cost vs margin">
        <Seg
          wrap
          options={[
            { id: "indiv", label: "Solo researcher" },
            { id: "lab", label: "Lab (members)" },
            { id: "dept", label: "Department (labs)" },
            { id: "inst", label: "Institution (depts)" },
          ]}
          value={scale}
          onChange={(v) => setScale(v as typeof scale)}
        />
        <Lbl>Size: {sizeLbl}</Lbl>
        <input
          type="range"
          min={1}
          max={50}
          step={1}
          value={size}
          disabled={scale === "indiv"}
          onChange={(e) => setSize(+e.target.value)}
          className="w-full accent-sky-600 disabled:opacity-40"
        />
        <div className="mt-3 grid gap-4 lg:grid-cols-3">
          <div>
            <div className="text-meta text-foreground-muted">Storage-only</div>
            <Kv k="Revenue" v={fmt(so.rev)} />
            <Kv k="Our cost" v={fmt(so.cost)} />
            <Kv k="Margin" bold v={fmt(so.rev - so.cost)} tone={so.rev - so.cost < 0 ? "bad" : "good"} />
          </div>
          <div>
            <div className="text-meta text-foreground-muted">Storage + activity</div>
            <Kv k="Revenue" v={fmt(sa.rev)} />
            <Kv k="Our cost" v={fmt(sa.cost)} />
            <Kv k="Margin" bold v={fmt(sa.rev - sa.cost)} tone={sa.rev - sa.cost < 0 ? "bad" : "good"} />
          </div>
          <div>
            <div className="text-meta text-foreground-muted">Of which sustain</div>
            <Kv k={`${fmt0(SUSTAIN_PER_LAB)} / active lab`} v={fmt(so.labs * SUSTAIN_PER_LAB)} />
            <p className="mt-1 text-meta text-foreground-muted">
              Dept/inst only. The solidarity surplus that funds the free and cheap
              individual tiers, the same in both models.
            </p>
          </div>
        </div>
        <canvas
          ref={scaleRef}
          height={280}
          className="mt-3 block w-full rounded-lg border border-border bg-surface-sunken"
          style={{ height: 280 }}
        />
        <Legend
          items={[
            { c: CH.storage, t: "storage-only margin" },
            { c: CH.activity, t: "storage+activity margin" },
          ]}
        />
      </Panel>

      {/* scenario table */}
      <Panel title="4. Usage scenarios, per subscriber per month">
        <div className="overflow-x-auto">
          <table className="w-full text-meta tabular-nums">
            <thead>
              <tr className="text-foreground-muted">
                <th className="px-2 py-1.5 text-left font-semibold">User</th>
                <th className="px-2 py-1.5 text-right font-semibold">Storage</th>
                <th className="px-2 py-1.5 text-right font-semibold">Writes/mo</th>
                <th className="px-2 py-1.5 text-right font-semibold">Our cost</th>
                <th className="px-2 py-1.5 text-right font-semibold">Storage-only</th>
                <th className="px-2 py-1.5 text-right font-semibold">Storage+activity</th>
              </tr>
            </thead>
            <tbody>
              {SCENARIOS.map((s) => {
                const cap = Math.max(s.gb, 1.01);
                const thr = Math.max(1, Math.ceil(s.a));
                const pSO = priceStorageOnly(cap, 1);
                const pSA = priceWithActivity(cap, 1, thr);
                const cost = bareCost(s.gb, s.a);
                const mSO = netMargin(pSO, s.gb, s.a);
                const mSA = netMargin(pSA, s.gb, s.a);
                const cls = (v: number) =>
                  v < 0 ? "text-rose-600 font-bold" : "text-emerald-600";
                return (
                  <tr key={s.n} className="border-t border-border">
                    <td className="px-2 py-1.5 text-left">{s.n}</td>
                    <td className="px-2 py-1.5 text-right">{s.gb} GB</td>
                    <td className="px-2 py-1.5 text-right">{s.a}M</td>
                    <td className="px-2 py-1.5 text-right">{fmt(cost)}</td>
                    <td className={`px-2 py-1.5 text-right ${cls(mSO)}`}>{fmt(mSO)}</td>
                    <td className={`px-2 py-1.5 text-right ${cls(mSA)}`}>{fmt(mSA)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-meta text-foreground-muted">
          Power / automated is the adversarial case, 4 GB stored and 8M writes.
          Storage-only loses on it unless the throttle caps the writes. Every
          other human row is fine under both models, real activity is cheap.
        </p>
      </Panel>
    </div>
  );
}

// ============================================================================
// Tab 2: sustainability at scale
// ============================================================================

function SustainabilityTab({ active }: { active: boolean }) {
  const [freeUsers, setFreeUsers] = useState(10000);
  const [lightPct, setLightPct] = useState(70);
  const [typicalPct, setTypicalPct] = useState(25);
  const [heavyPct, setHeavyPct] = useState(5);
  const [capM, setCapM] = useState(1);
  const [paidIndividuals, setPaidIndividuals] = useState(300);
  const [paidLabs, setPaidLabs] = useState(100);
  const [departments, setDepartments] = useState(30);
  const [labsPerDept, setLabsPerDept] = useState(10);
  const [institutions, setInstitutions] = useState(3);
  const [deptsPerInst, setDeptsPerInst] = useState(6);
  const [sustainPerLab, setSustainPerLab] = useState(SUSTAIN_PER_LAB);

  // Actuals vs. Simulation. "sim" is the illustrative what-if scenario (the
  // seeded defaults above). "actuals" seeds the customer counts from the live
  // operator metrics so you start from reality and perturb from there. Paid
  // tiers aren't tracked yet (billing is pre-launch), so they seed to 0.
  const [mode, setMode] = useState<"sim" | "actuals">("sim");
  const [actualFree, setActualFree] = useState<number | null>(null);

  useEffect(() => {
    if (!active || actualFree !== null) return;
    let cancelled = false;
    void fetch("/api/admin/metrics")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        const n = d?.directory?.totalIdentities;
        if (!cancelled && typeof n === "number") setActualFree(n);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active, actualFree]);

  function switchMode(next: "sim" | "actuals") {
    setMode(next);
    if (next === "actuals") {
      setFreeUsers(actualFree ?? 0);
      setPaidIndividuals(0);
      setPaidLabs(0);
      setDepartments(0);
      setInstitutions(0);
    } else {
      // Restore the illustrative scenario seeds.
      setFreeUsers(10000);
      setPaidIndividuals(300);
      setPaidLabs(100);
      setDepartments(30);
      setInstitutions(3);
    }
  }

  const freeRef = useRef<HTMLCanvasElement | null>(null);
  const capRef = useRef<HTMLCanvasElement | null>(null);

  const mix: FreeUsageMix = { lightPct, typicalPct, heavyPct, capM };
  const paying: PayingSide = {
    paidIndividuals,
    paidLabs,
    departments,
    labsPerDept,
    institutions,
    deptsPerInst,
    sustainPerLab,
  };
  const r = sustainability(freeUsers, mix, paying);

  function drawFree() {
    const c = prep(freeRef.current);
    if (!c) return;
    const { x, w, h } = c;
    const padL = 58,
      padR = 14,
      padT = 14,
      padB = 28;
    const W = w - padL - padR,
      H = h - padT - padB;
    const maxFree = 50000;
    const pts: { f: number; net: number }[] = [];
    for (let i = 0; i <= 100; i++) {
      const f = (maxFree * i) / 100;
      pts.push({ f, net: r.totalIn - r.fixed - f * r.avgFreeCost });
    }
    let ymax = Math.max(...pts.map((p) => p.net), 100),
      ymin = Math.min(...pts.map((p) => p.net), 0);
    const yr = ymax - ymin || 1;
    ymin -= yr * 0.08;
    ymax += yr * 0.08;
    const X = (f: number) => padL + (W * f) / maxFree;
    const Y = (v: number) => padT + H * (1 - (v - ymin) / (ymax - ymin));
    x.strokeStyle = CH.grid;
    x.fillStyle = CH.axis;
    x.font = "11px sans-serif";
    for (let g = 0; g <= 4; g++) {
      const v = ymin + ((ymax - ymin) * g) / 4;
      const yy = Y(v);
      x.beginPath();
      x.moveTo(padL, yy);
      x.lineTo(w - padR, yy);
      x.stroke();
      x.fillText(fmt0(v), 4, yy + 3);
    }
    for (let f = 0; f <= maxFree; f += 10000)
      x.fillText(f / 1000 + "k", X(f) - 8, h - 10);
    x.strokeStyle = CH.zero;
    x.beginPath();
    x.moveTo(padL, Y(0));
    x.lineTo(w - padR, Y(0));
    x.stroke();
    x.strokeStyle = CH.throttle;
    x.setLineDash([4, 4]);
    x.beginPath();
    x.moveTo(X(freeUsers), padT);
    x.lineTo(X(freeUsers), h - padB);
    x.stroke();
    x.setLineDash([]);
    x.strokeStyle = CH.net;
    x.lineWidth = 2.4;
    x.beginPath();
    pts.forEach((p, i) => {
      const px = X(p.f),
        py = Y(p.net);
      i ? x.lineTo(px, py) : x.moveTo(px, py);
    });
    x.stroke();
  }

  function drawCap() {
    const c = prep(capRef.current);
    if (!c) return;
    const { x, w, h } = c;
    const padL = 58,
      padR = 14,
      padT = 14,
      padB = 28;
    const W = w - padL - padR,
      H = h - padT - padB;
    const maxCap = 2;
    const pts: { cap: number; be: number }[] = [];
    for (let i = 0; i <= 100; i++) {
      const cap = 0.1 + ((maxCap - 0.1) * i) / 100;
      const avg = avgFreeUserCost({ lightPct, typicalPct, heavyPct, capM: cap });
      const be = avg > 0 ? (r.totalIn - r.fixed) / avg : 0;
      pts.push({ cap, be });
    }
    const ymax = Math.max(...pts.map((p) => p.be), 100);
    const X = (cVal: number) => padL + (W * (cVal - 0.1)) / (maxCap - 0.1);
    const Y = (v: number) => padT + H * (1 - v / ymax);
    x.strokeStyle = CH.grid;
    x.fillStyle = CH.axis;
    x.font = "11px sans-serif";
    for (let g = 0; g <= 4; g++) {
      const v = (ymax * g) / 4;
      const yy = Y(v);
      x.beginPath();
      x.moveTo(padL, yy);
      x.lineTo(w - padR, yy);
      x.stroke();
      x.fillText((v / 1000).toFixed(0) + "k", 4, yy + 3);
    }
    for (let cVal = 0.5; cVal <= maxCap; cVal += 0.5)
      x.fillText(cVal + "M", X(cVal) - 6, h - 10);
    x.strokeStyle = CH.throttle;
    x.setLineDash([4, 4]);
    x.beginPath();
    x.moveTo(X(capM), padT);
    x.lineTo(X(capM), h - padB);
    x.stroke();
    x.setLineDash([]);
    x.strokeStyle = CH.storage;
    x.lineWidth = 2.4;
    x.beginPath();
    pts.forEach((p, i) => {
      const px = X(p.cap),
        py = Y(p.be);
      i ? x.lineTo(px, py) : x.moveTo(px, py);
    });
    x.stroke();
  }

  useEffect(() => {
    if (!active) return;
    const draw = () => {
      drawFree();
      drawCap();
    };
    const id = requestAnimationFrame(draw);
    window.addEventListener("resize", draw);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("resize", draw);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    active,
    freeUsers,
    lightPct,
    typicalPct,
    heavyPct,
    capM,
    paidIndividuals,
    paidLabs,
    departments,
    labsPerDept,
    institutions,
    deptsPerInst,
    sustainPerLab,
  ]);

  const beTxt = Number.isFinite(r.breakEvenFreeUsers)
    ? Math.max(0, Math.round(r.breakEvenFreeUsers)).toLocaleString()
    : "unlimited";
  const headTxt = Number.isFinite(r.headroom)
    ? (r.headroom >= 0 ? "+" : "") + Math.round(r.headroom).toLocaleString()
    : "unlimited";
  const perLabTxt = Number.isFinite(r.freePerPayingLab)
    ? Math.round(r.freePerPayingLab).toLocaleString()
    : "n/a";

  return (
    <div className="space-y-6 text-foreground">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-surface-sunken p-0.5">
          {(["sim", "actuals"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`rounded-md px-3 py-1.5 text-meta font-medium transition-colors ${
                mode === m
                  ? "bg-surface-raised text-foreground shadow-sm"
                  : "text-foreground-muted hover:text-foreground"
              }`}
            >
              {m === "sim" ? "Simulation" : "Actuals"}
            </button>
          ))}
        </div>
        <p className="text-meta text-foreground-muted">
          {mode === "actuals" ? (
            actualFree === null ? (
              "Loading live counts…"
            ) : (
              <>
                Seeded from {actualFree.toLocaleString()} registered{" "}
                {actualFree === 1 ? "user" : "users"}. Paid tiers read 0 (billing
                is pre-launch). Tune from here.
              </>
            )
          ) : (
            "Illustrative what-if scenario. Switch to Actuals to start from your live counts."
          )}
        </p>
      </div>

      <div
        className={`rounded-xl border p-4 text-meta leading-relaxed ${
          r.net >= 0
            ? "border-emerald-200 bg-emerald-50"
            : "border-rose-200 bg-rose-50"
        }`}
      >
        {r.net >= 0 ? (
          <span>
            <b>Sustainable at this mix.</b> {freeUsers.toLocaleString()} free
            users cost about {fmt0(r.freeCost)}/mo (avg {fmt(r.avgFreeCost)}
            each), covered by {fmt0(r.totalIn)}/mo from paying orgs. You can carry
            up to <b>{beTxt}</b> free users before going underwater ({headTxt}
            headroom). The dials that move this most are the free write cap and
            the department count.
          </span>
        ) : (
          <span>
            <b className="text-rose-700">Underwater by {fmt0(-r.net)}/mo.</b>{" "}
            {freeUsers.toLocaleString()} free users cost {fmt0(r.freeCost)}/mo but
            paying orgs only bring {fmt0(r.totalIn)}/mo. You need either fewer free
            users (cap {beTxt}), a lower free write cap, more departments, or a
            higher sustain rate.
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Free base">
          <Slider label={`Free researchers: ${freeUsers.toLocaleString()}`} min={0} max={50000} step={500} value={freeUsers} onChange={setFreeUsers} />
          <p className="mt-1 text-meta text-foreground-muted">
            Usage mix of those free users. {fmt(ACTIVITY_PER_M_WRITES)} is the
            maxed ceiling, most are far below.
          </p>
          <Slider label={`Light: ${lightPct}%`} min={0} max={100} step={1} value={lightPct} onChange={setLightPct} />
          <Slider label={`Typical: ${typicalPct}%`} min={0} max={100} step={1} value={typicalPct} onChange={setTypicalPct} />
          <Slider label={`Heavy / near-cap: ${heavyPct}%`} min={0} max={100} step={1} value={heavyPct} onChange={setHeavyPct} />
          <Slider label={`Free write cap (the lever): ${capM.toFixed(2)}M writes`} min={0.1} max={2} step={0.05} value={capM} onChange={setCapM} />
          <div className="mt-2">
            <Kv k="Avg cost / free user" bold v={`${fmt(r.avgFreeCost)} / mo`} />
          </div>
        </Panel>

        <Panel title="Paying side (revenue)">
          <Slider label={`Paid individuals: ${paidIndividuals.toLocaleString()}`} min={0} max={5000} step={50} value={paidIndividuals} onChange={setPaidIndividuals} />
          <Slider label={`Paid standalone labs: ${paidLabs.toLocaleString()}`} min={0} max={2000} step={10} value={paidLabs} onChange={setPaidLabs} />
          <Slider label={`Departments: ${departments}`} min={0} max={500} step={1} value={departments} onChange={setDepartments} />
          <Slider label={`Avg labs / department: ${labsPerDept}`} min={2} max={40} step={1} value={labsPerDept} onChange={setLabsPerDept} />
          <Slider label={`Institutions: ${institutions}`} min={0} max={100} step={1} value={institutions} onChange={setInstitutions} />
          <Slider label={`Avg depts / institution: ${deptsPerInst}`} min={2} max={30} step={1} value={deptsPerInst} onChange={setDeptsPerInst} />
          <Slider label={`Sustain per active lab: ${fmt0(sustainPerLab)}`} min={0} max={40} step={1} value={sustainPerLab} onChange={setSustainPerLab} />
        </Panel>
      </div>

      <Panel title="Monthly money in vs out">
        <div className="grid gap-4 lg:grid-cols-3">
          <div>
            <div className="text-meta text-foreground-muted">Money IN</div>
            <Kv k="Total in" bold v={fmt0(r.totalIn)} tone="good" />
            <p className="mt-1 text-meta text-foreground-muted">
              Individual + lab margins plus dept/inst sustain and storage recovery.
            </p>
          </div>
          <div>
            <div className="text-meta text-foreground-muted">Money OUT</div>
            <Kv k="Free base cost" v={fmt0(r.freeCost)} />
            <Kv k="Fixed base (infra)" v={fmt0(r.fixed)} />
            <Kv k="Total out" bold v={fmt0(r.totalOut)} />
            <p className="mt-1 text-meta text-foreground-muted">
              Fixed base is meant to be fellowship/donation funded, not
              user-loaded, shown for completeness.
            </p>
          </div>
          <div>
            <div className="text-meta text-foreground-muted">Net / month</div>
            <div className="text-display font-extrabold tracking-tight">
              <span className={r.net < 0 ? "text-rose-600" : "text-emerald-600"}>
                {fmt0(r.net)}
              </span>{" "}
              <span className="text-meta font-normal text-foreground-muted">/mo</span>
            </div>
            <div className="mt-3">
              <Kv k="Break-even free users" v={beTxt} />
              <Kv k="Free supported / paying lab" v={perLabTxt} />
              <Kv k="Headroom (free users)" v={headTxt} tone={r.headroom < 0 ? "bad" : "good"} />
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Net as the free base grows">
          <canvas
            ref={freeRef}
            height={260}
            className="block w-full rounded-lg border border-border bg-surface-sunken"
            style={{ height: 260 }}
          />
          <Legend
            items={[
              { c: CH.net, t: "net P&L" },
              { c: CH.zero, t: "break-even" },
              { c: CH.throttle, t: "your current free count" },
            ]}
          />
        </Panel>
        <Panel title="The free-cap lever">
          <canvas
            ref={capRef}
            height={260}
            className="block w-full rounded-lg border border-border bg-surface-sunken"
            style={{ height: 260 }}
          />
          <Legend items={[{ c: CH.storage, t: "max supportable free users vs the free write cap" }]} />
        </Panel>
      </div>

      <p className="text-meta text-foreground-muted">
        Margins use the storage-only model (cheap individual/lab, near cost). The
        real revenue lever is dept/inst sustain per lab. Everything is placeholder
        math for what-ifs, not a forecast.
      </p>
    </div>
  );
}

// ============================================================================
// shared small UI bits
// ============================================================================

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
      <span className={bold ? "font-semibold text-foreground" : "text-foreground-muted"}>
        {k}
      </span>
      <span className={`tabular-nums ${bold ? "font-semibold" : ""} ${toneCls}`}>
        {v}
      </span>
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <Lbl>{label}</Lbl>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        className="w-full accent-sky-600"
      />
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
    <div className={`inline-flex overflow-hidden rounded-lg border border-border ${wrap ? "flex-wrap" : ""}`}>
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

// ============================================================================
// the modal
// ============================================================================

export default function PriceModelingModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"perSub" | "sustain">("perSub");

  return (
    <LivingPopup
      open={open}
      onClose={onClose}
      label="Price modeling"
      widthClassName="max-w-5xl"
      fillHeight
      padded
    >
      <div className="text-foreground">
        <h2 className="text-heading font-bold tracking-tight text-foreground">
          Price modeling
        </h2>
        <p className="mt-1 text-meta leading-relaxed text-foreground-muted">
          Operator-only what-if tool for the storage pricing flip. Every number
          recomputes live from the FLAGGED placeholders in
          lib/pricing/assumptions.ts and the tier caps in lib/billing/plans.ts.
          Beta is free, this models the flip. Internal cost figures, never shown
          to a user.
        </p>

        <div className="mt-4">
          <Seg
            options={[
              { id: "perSub", label: "Per-subscriber economics" },
              { id: "sustain", label: "Sustainability at scale" },
            ]}
            value={tab}
            onChange={(v) => setTab(v as typeof tab)}
          />
        </div>

        <div className="mt-5">
          {/* Both tabs stay mounted so chart state persists; the hidden one is
              display:none (clientWidth 0) and redraws when it becomes active. */}
          <div className={tab === "perSub" ? "" : "hidden"}>
            <PerSubscriberTab active={tab === "perSub"} />
          </div>
          <div className={tab === "sustain" ? "" : "hidden"}>
            <SustainabilityTab active={tab === "sustain"} />
          </div>
        </div>
      </div>
    </LivingPopup>
  );
}
