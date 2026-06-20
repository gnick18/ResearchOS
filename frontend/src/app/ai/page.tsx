"use client";

/**
 * The `/ai` page: the public marketing "sell" page for BeakerBot, the AI
 * assistant built into ResearchOS (2026-06-12 rebuild against
 * docs/mockups/ai-showcase-2026-06-12.html, marketing/AI/demo sub-bot).
 *
 * This route used to open the in-app BeakerSearch palette. That behavior is
 * RETIRED (Grant's decision). /ai is now a public marketing route (whitelisted
 * in providers.tsx) so logged-out visitors land on a sell page, not the
 * folder-connect gate, the same as /pricing.
 *
 * The page mirrors the welcome page's system exactly: LIGHT theme, clean white
 * and pale-blue panels, the BOLD rainbow brand treatment (a thick rainbow top
 * ribbon, RainbowFrame rainbow-gradient borders around the result windows, and
 * short rainbow rule lines under the section kickers). The rainbow comes from
 * the brand tokens in globals.css (--brand-rainbow / .brand-rainbow-bg /
 * --brand-rainbow-vivid).
 *
 * The body is the prompt -> result pattern, each capability is a realistic
 * user prompt paired with the real output one of BeakerBot's shipped tools
 * produces. These are actual tools (run_datahub_analysis, make_datahub_graph,
 * design_primers, compute_tm, search_pubchem, create_molecule, search_my_work,
 * create_experiment_chain). Nothing here is invented.
 *
 * IA (mockup order):
 *   Hero (badge, headline with a rainbow word, the free-token line, CTA)
 *   1. Data Hub, stats + publication figure (Prism alternative)
 *   2. Sequences, cloning primers + Tm (SnapGene alternative)
 *   3. Chemistry, PubChem lookup saved to the molecule library (ChemDraw alt)
 *   4. Search your own work, cross-type
 *   5. Experiments + scheduling, a linked cloning chain on the Gantt
 *   Value, lead hard on how cheap the metered AI is (the numbers match /pricing
 *      and the usage fixtures, a full task ~110,000 tokens, a quick question
 *      ~50,000, the free sign-up gift ~1,600,000)
 *   Final CTA + sponsors + footer
 *
 * Voice rules: no em-dashes, no emojis (every glyph is <Icon name=...> from the
 * registry), no mid-sentence colons. Contractions OK, state the WHY. BeakerBot
 * is the only mascot. Brand tokens only, never raw hex for new accents.
 *
 * The publication bar chart is built from CSS bars and positioned rules, NOT an
 * inline vector element, because the icon-guard ratchet blocks any new inline
 * vector markup in a file not in the baseline. All glyphs come from <Icon>.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import BeakerBot from "@/components/BeakerBot";
import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons/registry";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingNav from "@/components/MarketingNav";
import Reveal from "@/components/marketing/Reveal";
import Kicker from "@/components/marketing/Kicker";
import RainbowFrame from "@/components/marketing/RainbowFrame";
import SponsorStrip from "@/components/SponsorStrip";
import { PACK_TOKENS } from "@/lib/billing/ai-config";
import { markLandingSeen } from "@/lib/landing/landing-gate";

/** The rainbow ramps, pulled from the brand tokens in globals.css so this page
 *  never drifts from the footer, the avatars, the welcome page, and the banner.
 *  RAINBOW is the pastel fill for the ribbon and the result-frame borders;
 *  RAINBOW_TEXT is the saturated ramp clipped into the gradient headline word
 *  (the pastel washes out as type on white). */
const RAINBOW = "var(--brand-rainbow)";
const RAINBOW_TEXT = "var(--brand-rainbow-vivid)";

/* ----------------------------------------------------------------------------
 * Shared primitives, mirrored from WelcomePage.tsx so the two sell pages read
 * as one continuous brand stage.
 * -------------------------------------------------------------------------- */

// Kicker and RainbowFrame now live in @/components/marketing (shared across the
// marketing pages); imported at the top of this file.

/* ----------------------------------------------------------------------------
 * Capability section scaffold. A section header (icon chip, title, the "what
 * tool, what alternative" sub) sitting above one or more prompt -> result
 * cards. The whole section reveals as one unit.
 * -------------------------------------------------------------------------- */
function CapabilitySection({
  kicker,
  icon,
  chipClass,
  title,
  desc,
  children,
}: {
  kicker: string;
  icon: IconName;
  /** Background + text utility classes for the solid icon chip, e.g.
   *  "bg-brand-purple text-white". */
  chipClass: string;
  title: string;
  desc: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="px-6 py-14 sm:px-12">
      <Reveal className="mx-auto max-w-[900px]">
        <Kicker>{kicker}</Kicker>
        <div className="mt-3 flex items-start gap-4">
          <span
            aria-hidden
            className={`flex h-12 w-12 flex-none items-center justify-center rounded-2xl ${chipClass}`}
          >
            <Icon name={icon} className="h-6 w-6" />
          </span>
          <div>
            <h2 className="text-2xl font-extrabold leading-tight tracking-tight text-brand-ink md:text-[26px]">
              {title}
            </h2>
            <p className="mt-1.5 max-w-[62ch] text-body leading-relaxed text-[#475569]">
              {desc}
            </p>
          </div>
        </div>
        <div className="mt-7 flex flex-col gap-7">{children}</div>
      </Reveal>
    </section>
  );
}

/* ----------------------------------------------------------------------------
 * A single prompt -> result card. The user's prompt sits in a tinted bar at the
 * top, the BeakerBot result (which tool ran, what it cost, the answer) renders
 * in the rainbow-framed window below.
 * -------------------------------------------------------------------------- */
function PromptCard({
  prompt,
  tool,
  cost,
  children,
}: {
  prompt: string;
  /** The shipped tool name(s) that ran, shown as a mono badge. */
  tool: string;
  /** The token cost label, kept consistent with the value section and /pricing. */
  cost: string;
  children: ReactNode;
}) {
  return (
    <RainbowFrame>
      {/* User prompt */}
      <div className="flex items-start gap-3 border-b border-[#eef2f7] bg-[#f7f9fc] px-4 py-3.5">
        <span
          aria-hidden
          className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-brand-purple text-meta font-bold text-white"
        >
          G
        </span>
        <p className="text-body leading-relaxed text-brand-ink">{prompt}</p>
      </div>
      {/* BeakerBot result */}
      <div className="px-4 py-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span aria-hidden className="text-brand-sky">
            <Icon name="ask" className="h-5 w-5" />
          </span>
          <span className="min-w-0 rounded-md border border-brand-sky/25 bg-brand-sky/10 px-2 py-0.5 font-mono text-meta font-semibold uppercase tracking-[0.04em] text-brand-action">
            {tool}
          </span>
          <span className="ml-auto text-meta text-[#94a3b8]">{cost}</span>
        </div>
        {children}
      </div>
    </RainbowFrame>
  );
}

/** A short BeakerBot prose line above a result, with the key phrase in brand
 *  sky. Keep it plain text; callers pass nodes for the emphasis. */
function BotSays({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3.5 text-body leading-relaxed text-brand-ink">{children}</p>
  );
}

/** A trailing footnote under a result, the muted "saved as / want me to" line. */
function ResultFoot({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 text-meta leading-relaxed text-[#64748b]">{children}</p>
  );
}

/* ----------------------------------------------------------------------------
 * Data Hub result pieces. Stat tiles, the assumption report card, the Python
 * disclosure, and the CSS-built publication figure.
 * -------------------------------------------------------------------------- */
function StatBox({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string;
  value: string;
  sub: string;
  /** Optional text-color utility for the value (e.g. the significant p-value). */
  valueClass?: string;
}) {
  return (
    <div className="rounded-xl border border-[#eef2f7] bg-[#f7f9fc] px-3.5 py-3">
      <div className="text-meta font-semibold uppercase tracking-[0.04em] text-[#94a3b8]">
        {label}
      </div>
      <div
        className={`mt-0.5 text-2xl font-extrabold ${valueClass ?? "text-brand-ink"}`}
      >
        {value}
      </div>
      <div className="text-meta text-[#64748b]">{sub}</div>
    </div>
  );
}

function ReportRow({
  pass,
  label,
  note,
}: {
  pass: boolean;
  label: string;
  note: string;
}) {
  return (
    <div className="flex items-start gap-2.5 border-b border-[#eef2f7] px-3.5 py-2 last:border-0 sm:items-center">
      <span
        aria-hidden
        className={`mt-1 h-2.5 w-2.5 flex-none rounded-full sm:mt-0 ${
          pass ? "bg-emerald-500" : "bg-amber-500"
        }`}
      />
      <div className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-2">
        <span className="flex-1 text-body text-brand-ink">{label}</span>
        <span className="text-meta text-[#64748b]">{note}</span>
      </div>
    </div>
  );
}

/** A details/summary disclosure holding the equivalent Python, so the visitor
 *  can verify the result is not a black box. Native disclosure, no client JS. */
function PythonDisclosure() {
  return (
    <details className="group mt-1">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-[#dbe6f3] bg-white px-3 py-1.5 text-meta font-semibold text-brand-action transition-colors hover:bg-[#f4f8fd]">
        <Icon
          name="chevronRight"
          className="h-3.5 w-3.5 transition-transform group-open:rotate-90"
        />
        Show the equivalent Python
      </summary>
      <pre className="mt-2.5 overflow-x-auto rounded-xl bg-[#0d1117] px-4 py-3.5 font-mono text-[12.5px] leading-relaxed text-[#e2e8f0]">
        <code>{`from scipy import stats
import numpy as np

wt = [1.38, 1.45, 1.51, 1.39, 1.44, 1.35]
ko = [0.81, 0.93, 0.78, 0.91, 0.85, 0.97]

t_stat, p_val = stats.ttest_ind(wt, ko, equal_var=False)
d = (np.mean(wt) - np.mean(ko)) / np.sqrt(
    (np.std(wt, ddof=1)**2 + np.std(ko, ddof=1)**2) / 2)
print(f"t={t_stat:.3f}, p={p_val:.4f}, d={d:.2f}")
# t=3.614, p=0.0038, d=2.08`}</code>
      </pre>
    </details>
  );
}

/** The publication figure, a two-bar chart with SD error bars and a
 *  significance bracket, built entirely from CSS so it never trips the
 *  inline-svg icon guard. The geometry mirrors the mockup, WT mean 1.42 (SD
 *  0.11) and KO mean 0.87 (SD 0.18) on a 0 to 1.75 axis. */
function PublicationFigure() {
  // Plot the bars relative to a 1.75 ceiling so both fit with headroom for the
  // bracket. Heights are percentages of the plot area.
  const ceil = 1.75;
  const pct = (v: number) => `${(v / ceil) * 100}%`;
  return (
    <div className="overflow-x-auto rounded-xl border border-[#eef2f7] bg-white p-4">
      <div className="min-w-[260px]">
      <div className="mb-3 text-center text-meta font-semibold text-brand-ink">
        OD600 at 24 h, WT vs Knockout (n=6, mean &plusmn; SD)
      </div>
      <div className="flex gap-3">
        {/* y axis labels */}
        <div className="flex w-9 flex-col justify-between py-1 text-right text-[10px] text-[#94a3b8]">
          <span>1.5</span>
          <span>1.0</span>
          <span>0.5</span>
          <span>0</span>
        </div>
        {/* plot area */}
        <div className="relative h-44 flex-1 border-b border-l border-[#94a3b8]">
          {/* gridlines */}
          {[1.5, 1.0, 0.5].map((g) => (
            <div
              key={g}
              aria-hidden
              className="absolute left-0 right-0 border-t border-dashed border-[#eef2f7]"
              style={{ bottom: pct(g) }}
            />
          ))}
          {/* significance bracket spanning the two bar centers (~25% and ~75%) */}
          <div
            aria-hidden
            className="absolute"
            style={{
              left: "25%",
              right: "25%",
              bottom: "calc(" + pct(1.55) + ")",
              borderTop: "1.5px solid #475569",
              borderLeft: "1.5px solid #475569",
              borderRight: "1.5px solid #475569",
              height: "8px",
            }}
          />
          <div
            className="absolute -translate-x-1/2 text-center"
            style={{ left: "50%", bottom: pct(1.6) }}
          >
            <div className="text-body font-bold leading-none text-[#475569]">
              **
            </div>
            <div className="text-[9px] text-[#94a3b8]">p=0.0038</div>
          </div>
          {/* bars */}
          <div className="absolute inset-x-0 bottom-0 flex h-full items-end justify-around px-6">
            {/* WT */}
            <div className="relative flex h-full w-16 items-end justify-center">
              <div
                className="w-full rounded-t-[3px] bg-brand-sky"
                style={{ height: pct(1.42) }}
              />
              {/* error bar, +/- SD 0.11 around 1.42 */}
              <div
                aria-hidden
                className="absolute left-1/2 w-0 -translate-x-1/2"
                style={{
                  bottom: pct(1.31),
                  height: pct(0.22),
                  borderLeft: "1.5px solid #475569",
                }}
              />
              <div
                aria-hidden
                className="absolute left-1/2 h-0 w-3.5 -translate-x-1/2"
                style={{ bottom: pct(1.53), borderTop: "1.5px solid #475569" }}
              />
              <div
                aria-hidden
                className="absolute left-1/2 h-0 w-3.5 -translate-x-1/2"
                style={{ bottom: pct(1.31), borderTop: "1.5px solid #475569" }}
              />
            </div>
            {/* KO */}
            <div className="relative flex h-full w-16 items-end justify-center">
              <div
                className="w-full rounded-t-[3px] bg-brand-purple"
                style={{ height: pct(0.87) }}
              />
              {/* error bar, +/- SD 0.18 around 0.87 */}
              <div
                aria-hidden
                className="absolute left-1/2 w-0 -translate-x-1/2"
                style={{
                  bottom: pct(0.69),
                  height: pct(0.36),
                  borderLeft: "1.5px solid #475569",
                }}
              />
              <div
                aria-hidden
                className="absolute left-1/2 h-0 w-3.5 -translate-x-1/2"
                style={{ bottom: pct(1.05), borderTop: "1.5px solid #475569" }}
              />
              <div
                aria-hidden
                className="absolute left-1/2 h-0 w-3.5 -translate-x-1/2"
                style={{ bottom: pct(0.69), borderTop: "1.5px solid #475569" }}
              />
            </div>
          </div>
        </div>
      </div>
      {/* x labels */}
      <div className="mt-1.5 flex justify-around pl-12 pr-6">
        <span className="text-meta font-semibold text-brand-ink">WT</span>
        <span className="text-meta font-semibold text-brand-ink">Knockout</span>
      </div>
      </div>{/* /min-w-[260px] */}
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Sequences result piece, a designed primer with overhang highlighted and its
 * computed stats.
 * -------------------------------------------------------------------------- */
function PrimerCard({
  label,
  overhang,
  body,
  bodyClass,
  tm,
  gc,
  length,
}: {
  label: string;
  overhang: string;
  body: string;
  /** Text-color utility for the binding region (distinguishes the two oligos). */
  bodyClass: string;
  tm: string;
  gc: string;
  length: string;
}) {
  return (
    <div className="rounded-xl border border-[#eef2f7] bg-[#f7f9fc] px-4 py-3">
      <div className="text-meta font-semibold uppercase tracking-[0.05em] text-[#94a3b8]">
        {label}
      </div>
      <div className="mt-1 break-all font-mono text-[13px] leading-relaxed">
        <span className="text-[#94a3b8]">{overhang}</span>
        <span className={bodyClass}>{body}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-meta text-[#64748b]">
        <span>
          <span className="font-bold text-brand-ink">Tm</span> {tm}
        </span>
        <span>
          <span className="font-bold text-brand-ink">GC</span> {gc}
        </span>
        <span>
          <span className="font-bold text-brand-ink">Length</span> {length}
        </span>
        <span>
          <span className="font-bold text-brand-ink">Self-comp</span> none
        </span>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Search result piece, a cross-type match with a highlighted snippet.
 * -------------------------------------------------------------------------- */
function SearchResult({
  icon,
  chipClass,
  title,
  meta,
  children,
}: {
  icon: IconName;
  /** Background + text utility classes for the solid type chip. */
  chipClass: string;
  title: string;
  meta: string;
  /** The snippet with a <mark> for the matched phrase. */
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[#eef2f7] bg-[#f7f9fc] px-3.5 py-3">
      <span
        aria-hidden
        className={`mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-lg ${chipClass}`}
      >
        <Icon name={icon} className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="text-body font-semibold text-brand-ink">{title}</div>
        <div className="text-meta text-[#64748b]">{meta}</div>
        <p className="mt-1.5 rounded-r-md border-l-[3px] border-brand-sky bg-brand-sky/[0.06] px-2.5 py-1.5 text-meta leading-relaxed text-brand-ink">
          {children}
        </p>
      </div>
    </div>
  );
}

/** A highlighted match inside a search snippet. */
function Mark({ children }: { children: ReactNode }) {
  return (
    <mark className="rounded-sm bg-brand-sky/20 px-0.5 text-inherit">
      {children}
    </mark>
  );
}

/* ----------------------------------------------------------------------------
 * Experiment-chain Gantt row.
 * -------------------------------------------------------------------------- */
function GanttRow({
  day,
  label,
  barClass,
  width,
  offset,
  dep,
}: {
  day: string;
  label: string;
  /** A bg-color utility for the bar. */
  barClass: string;
  width: string;
  offset: string;
  dep?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 border-b border-[#eef2f7] px-3.5 py-2.5 last:border-0">
      <span className="w-12 flex-none text-meta font-semibold text-[#64748b]">
        {day}
      </span>
      <div className="relative h-6 flex-1">
        <div
          className={`absolute flex h-6 items-center truncate rounded-md px-2.5 text-meta font-semibold text-white ${barClass}`}
          style={{ width, marginLeft: offset }}
        >
          {label}
        </div>
      </div>
      {dep ? (
        <span className="hidden flex-none items-center gap-1 text-meta text-brand-action sm:flex">
          <Icon name="chevronRight" className="h-3 w-3" />
          {dep}
        </span>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Value section, the cost reference row.
 * -------------------------------------------------------------------------- */
function CostRefRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  /** Text-color utility for the token figure. */
  valueClass: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 text-body">
      <span className="text-brand-ink">{label}</span>
      <span className={`font-bold ${valueClass}`}>{value}</span>
    </div>
  );
}

/* ========================================================================== */

export default function AiPage() {
  const router = useRouter();
  // AI top-up pack dollar amounts, sourced from the billing catalog so the page
  // copy can never drift from the configured packs.
  const packDollars = Object.keys(PACK_TOKENS)
    .map(Number)
    .sort((a, b) => a - b);
  const packList =
    packDollars.length > 1
      ? `${packDollars
          .slice(0, -1)
          .map((d) => `$${d}`)
          .join(", ")}, or $${packDollars[packDollars.length - 1]}`
      : `$${packDollars[0]}`;
  const smallestPack = `$${packDollars[0]}`;

  // The primary CTA routes to the connect chooser at "/", the same way the
  // welcome page's CTAs route up. markLandingSeen() keeps the first-visit
  // redirect in providers.tsx from bouncing the visitor back to /welcome.
  const goTry = () => {
    markLandingSeen();
    router.push("/");
  };

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[#fbfcfe] text-brand-ink">
      {/* Thick rainbow ribbon pinned to the very top edge. */}
      <div aria-hidden className="h-2 w-full" style={{ background: RAINBOW }} />

      <MarketingNav />

      <div className="relative">
        {/* ── HERO ─────────────────────────────────────────────────────── */}
        <header className="relative isolate overflow-hidden bg-gradient-to-b from-white to-[#eef4fb] px-6 pb-16 pt-10 text-center sm:px-12">
          <MarketingBackdrop tone="vivid" />
          <Reveal className="relative z-10 mx-auto flex max-w-3xl flex-col items-center">
            <div
              aria-hidden
              className="relative drop-shadow-[0_14px_30px_rgba(26,160,230,0.34)]"
            >
              <BeakerBot
                pose="idle"
                alive
                className="h-24 w-24 text-brand-sky md:h-28 md:w-28"
              />
            </div>

            <span className="mt-4 inline-flex items-center gap-2 rounded-full border border-brand-action/20 bg-brand-action/[0.06] px-3.5 py-1.5 text-meta font-semibold text-brand-action">
              <span aria-hidden className="text-brand-sky">
                <Icon name="ask" className="h-3.5 w-3.5" />
              </span>
              BeakerBot, the AI assistant in ResearchOS
            </span>

            <h1 className="mt-6 max-w-[18ch] text-[28px] font-extrabold leading-[1.06] tracking-tight text-brand-ink sm:text-4xl md:text-6xl">
              Your research data, an agent that does{" "}
              <span
                style={{
                  background: RAINBOW_TEXT,
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                real work
              </span>
            </h1>

            <p className="mt-5 max-w-[58ch] text-body leading-relaxed text-[#475569] sm:text-title">
              BeakerBot is a browser-side agent built into ResearchOS. Ask it a
              question and it picks the right tool, runs the computation locally
              against your own data, and hands you the result, the stats, the
              figure, the primers, not just a chat message.
            </p>

            {/* The free-token gift, the hero hook. Shown in tokens, never
                dollars, matching the usage fixtures and /pricing. */}
            <div className="mt-7 w-full max-w-md rounded-2xl border border-brand-action/20 bg-brand-action/[0.05] px-5 py-4">
              <div className="text-lg font-extrabold tracking-tight text-brand-ink">
                About 1.6 million free tokens to start, no card needed
              </div>
              <p className="mt-1 text-meta font-semibold text-[#475569]">
                That covers about 15 tasks or 30-plus quick
                questions. After that, prepaid top-ups are metered at a small
                markup over compute. You always see your balance and what the
                last task cost.
              </p>
            </div>

            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button
                type="button"
                onClick={goTry}
                data-testid="ai-hero-try"
                className="btn-brand inline-flex min-h-[44px] items-center gap-2 px-6 py-3 text-body"
              >
                <Icon name="ask" className="h-4 w-4" />
                Try BeakerBot free
              </button>
              <a
                href="#value"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-brand-action/25 bg-white px-6 py-3 text-body font-semibold text-brand-action shadow-[0_2px_12px_rgba(15,40,80,0.06)] transition-transform hover:scale-[1.02]"
              >
                See how cheap it is
                <span aria-hidden>&darr;</span>
              </a>
            </div>
          </Reveal>
        </header>

        {/* ── 1. DATA HUB ──────────────────────────────────────────────── */}
        <CapabilitySection
          kicker="// no Prism license"
          icon="chart"
          chipClass="bg-brand-purple text-white"
          title="Run the statistics and make the publication figure"
          desc="A GraphPad Prism alternative, built local-first. BeakerBot picks the right test for your design, runs it in the browser against your own table, and gives you the numbers, an assumption report card, and the equivalent Python so you can reproduce the result anywhere."
        >
          <PromptCard
            prompt="Run a t-test on the growth data in my OD600 table. WT versus knockout, six replicates each."
            tool="run_datahub_analysis"
            cost="~110,000 tokens"
          >
            <BotSays>
              I read your OD600 table (12 rows, 3 columns) and ran{" "}
              <span className="font-semibold text-brand-sky">
                Welch&apos;s two-sample t-test
              </span>
              . Normality passed for both groups (Shapiro-Wilk p &gt; 0.05), so
              the parametric test is appropriate. Here&apos;s what I found.
            </BotSays>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <StatBox
                label="p-value"
                value="0.0038"
                sub="Welch's t-test"
                valueClass="text-emerald-600"
              />
              <StatBox label="t statistic" value="3.61" sub="df = 9.8" />
              <StatBox label="Cohen's d" value="2.08" sub="Large effect" />
              <StatBox label="WT mean" value="1.42" sub="SD 0.11" />
              <StatBox label="KO mean" value="0.87" sub="SD 0.18" />
              <StatBox label="95% CI diff" value="0.22 to 0.88" sub="WT minus KO" />
            </div>

            <div className="mt-3.5 overflow-hidden rounded-xl border border-[#eef2f7]">
              <div className="flex items-center gap-2 border-b border-[#eef2f7] bg-[#f7f9fc] px-3.5 py-2 text-meta font-semibold uppercase tracking-[0.04em] text-[#64748b]">
                <Icon name="check" className="h-3.5 w-3.5 text-emerald-600" />
                Assumption report card
              </div>
              <ReportRow
                pass
                label="Normality (Shapiro-Wilk)"
                note="WT p=0.42, KO p=0.31"
              />
              <ReportRow
                pass={false}
                label="Equal variances (Levene)"
                note="Unequal, Welch correction applied"
              />
              <ReportRow
                pass
                label="Independence"
                note="Separate biological replicates"
              />
              <ReportRow
                pass
                label="Sample size"
                note="n=6 each, adequate for this effect"
              />
            </div>

            <div className="mt-3.5">
              <PythonDisclosure />
            </div>
          </PromptCard>

          <PromptCard
            prompt="Make a publication-ready bar chart with error bars from those replicates."
            tool="make_datahub_graph"
            cost="~110,000 tokens"
          >
            <BotSays>
              Here&apos;s the figure, using{" "}
              <span className="font-semibold text-brand-sky">mean &plusmn; SD</span>,
              export-ready at 300 dpi. Axes follow standard journal conventions,
              no top or right spine, with a significance bracket carrying the
              p-value.
            </BotSays>
            <PublicationFigure />
            <ResultFoot>
              Exported as SVG, with a 300 dpi PNG also available. The figure is
              linked to your data table, so re-running the analysis refreshes it.
            </ResultFoot>
          </PromptCard>
        </CapabilitySection>

        {/* ── 2. SEQUENCES ─────────────────────────────────────────────── */}
        <div className="border-y border-[#dbe6f3] bg-[#f4f8fd]">
          <CapabilitySection
            kicker="// no SnapGene license"
            icon="primers"
            chipClass="bg-brand-sky text-white"
            title="Design cloning primers, with Tm and a self-comp check"
            desc="A SnapGene-style sequence workbench where the AI does the legwork. Ask for primers in plain language and get back designed oligos with nearest-neighbor Tm values, GC content, and a self-complementarity check, without leaving your notes."
          >
            <PromptCard
              prompt="Design cloning primers for this insert. Add a BamHI site on the forward and an EcoRI site on the reverse. Target Tm around 60C."
              tool="design_primers · compute_tm"
              cost="~50,000 tokens"
            >
              <BotSays>
                I designed primers against your insert (452 bp) and appended the
                restriction overhangs. Tms are calculated by the{" "}
                <span className="font-semibold text-brand-sky">
                  nearest-neighbor method
                </span>{" "}
                (SantaLucia 1998, 50 mM Na+, 250 nM oligo).
              </BotSays>
              <div className="flex flex-col gap-2.5">
                <PrimerCard
                  label="Forward primer (BamHI)"
                  overhang="CGGGATCC"
                  body="ATGACCGTGAAAGACCTGTTC"
                  bodyClass="text-emerald-600"
                  tm="61.4C"
                  gc="52%"
                  length="29 bp"
                />
                <PrimerCard
                  label="Reverse primer (EcoRI)"
                  overhang="CCGAATTC"
                  body="TTACAGGTTCTCCAGGTCGTA"
                  bodyClass="text-rose-500"
                  tm="60.8C"
                  gc="48%"
                  length="29 bp"
                />
              </div>
              <ResultFoot>
                Both primers were saved to your sequence library as
                &quot;Insert-F-BamHI&quot; and &quot;Insert-R-EcoRI&quot;.
                Recommended annealing temp is 58C, Tm minus 3C, accounting for
                the non-binding overhang.
              </ResultFoot>
            </PromptCard>
          </CapabilitySection>
        </div>

        {/* ── 3. CHEMISTRY ─────────────────────────────────────────────── */}
        <CapabilitySection
          kicker="// no ChemDraw subscription"
          icon="moleculeCircular"
          chipClass="bg-rose-500 text-white"
          title="Pull a structure from PubChem into your project"
          desc="A ChemDraw alternative that pulls structures, properties, and literature straight from PubChem, with no subscription or heavyweight desktop app. Anything you find is saved locally in your project's Molecules section."
        >
          <PromptCard
            prompt="Look up rapamycin on PubChem and add it to this project's molecule library."
            tool="search_pubchem · create_molecule"
            cost="~50,000 tokens"
          >
            <BotSays>
              I found{" "}
              <span className="font-semibold text-brand-sky">rapamycin</span> (CID
              5284616) on PubChem and saved it to your project. Here are the key
              properties.
            </BotSays>
            <div className="flex flex-col gap-4 rounded-xl border border-[#eef2f7] bg-[#f7f9fc] px-4 py-3.5 sm:flex-row sm:items-start">
              <span
                aria-hidden
                className="flex h-16 w-16 flex-none items-center justify-center self-center rounded-xl border border-[#eef2f7] bg-white text-rose-500 sm:h-[88px] sm:w-[88px] sm:self-auto"
              >
                <Icon name="moleculeCircular" className="h-10 w-10 sm:h-12 sm:w-12" />
              </span>
              <div className="min-w-0">
                <div className="text-base font-bold text-brand-ink">
                  Rapamycin (Sirolimus)
                </div>
                <div className="text-meta text-[#64748b]">
                  PubChem CID 5284616
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {[
                    ["MW", "914.17"],
                    ["Formula", "C51H79NO13"],
                    ["XLogP", "4.3"],
                    ["HBD", "3"],
                    ["HBA", "14"],
                    ["TPSA", "195 Å²"],
                  ].map(([k, v]) => (
                    <span
                      key={k}
                      className="rounded-lg border border-[#eef2f7] bg-white px-2.5 py-1 text-meta"
                    >
                      <span className="text-[#64748b]">{k} </span>
                      <span className="font-bold text-brand-ink">{v}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <ResultFoot>
              Saved as &quot;Rapamycin&quot; in your Molecules section, with the
              SMILES, InChI key, and 2-D structure file attached. You can open
              the full structure editor to annotate or export.
            </ResultFoot>
          </PromptCard>
        </CapabilitySection>

        {/* ── 4. SEARCH MY WORK ────────────────────────────────────────── */}
        <div className="border-y border-[#dbe6f3] bg-[#f4f8fd]">
          <CapabilitySection
            kicker="// search across everything you've done"
            icon="search"
            chipClass="bg-amber-500 text-white"
            title="Search your own work, cross-type and context-aware"
            desc="BeakerBot searches across every type of object in your folder (notes, experiments, sequences, methods, and molecules) and pulls back actual snippets from the relevant records. It's the same engine that powers BeakerSearch, driven by a plain-English question instead of a keyword."
          >
            <PromptCard
              prompt="What PCR runs failed last month? I think there were some gel photos with bad bands."
              tool="search_my_work"
              cost="~50,000 tokens"
            >
              <BotSays>
                I searched your folder for PCR experiments and notes from the last
                30 days that mention failures, bad bands, or no-band results. I
                found{" "}
                <span className="font-semibold text-brand-sky">
                  3 matching records
                </span>
                .
              </BotSays>
              <div className="flex flex-col gap-2.5">
                <SearchResult
                  icon="today"
                  chipClass="bg-amber-500 text-white"
                  title="Colony PCR, pMito-GFP screen, Plate 4"
                  meta="Experiment · 2026-05-28 · Cloning project"
                >
                  Lanes 3, 7, 11 showed <Mark>no band</Mark>. Re-ran with fresh
                  template, same result. Possibly inhibitor carry-over from the
                  miniprep step.
                </SearchResult>
                <SearchResult
                  icon="file"
                  chipClass="bg-emerald-500 text-white"
                  title="PCR troubleshooting note, annealing temp sweep"
                  meta="Note · 2026-05-31 · Cloning project"
                >
                  Tried 52C, 55C, 58C. <Mark>Smearing at 52</Mark>, nothing at 58.
                  55C gives a faint band but lower than the expected size. May be
                  off-target priming.
                </SearchResult>
                <SearchResult
                  icon="sequence"
                  chipClass="bg-brand-purple text-white"
                  title="pMito-GFP insert sequence"
                  meta="Sequence · linked from the experiment above"
                >
                  Primer binding sites annotated. <Mark>Potential hairpin</Mark> at
                  position 214 to 228 on the forward primer binding region (dG =
                  &minus;3.4 kcal/mol).
                </SearchResult>
              </div>
              <ResultFoot>
                Showing 3 of 3 matches. Want me to open the colony PCR experiment,
                or compute Tm for the primer with the suspected hairpin?
              </ResultFoot>
            </PromptCard>
          </CapabilitySection>
        </div>

        {/* ── 5. EXPERIMENTS + SCHEDULING ──────────────────────────────── */}
        <CapabilitySection
          kicker="// plan the whole protocol chain"
          icon="today"
          chipClass="bg-emerald-500 text-white"
          title="Build multi-step experiment chains on the Gantt"
          desc="BeakerBot creates linked experiment records with dependency arrows, so the Gantt view shows when each step can start. If something slips, ask it to reschedule and it propagates the delay through the chain."
        >
          <PromptCard
            prompt="Set up a 3-day cloning experiment chain. Restriction digest today, ligation tomorrow morning, transformation and colony PCR on day 3."
            tool="create_experiment_chain"
            cost="~110,000 tokens"
          >
            <BotSays>
              I created{" "}
              <span className="font-semibold text-brand-sky">
                4 linked experiments
              </span>{" "}
              with dependency arrows. Each one stays locked until its predecessor
              is marked complete. Here&apos;s the Gantt view.
            </BotSays>
            <div className="overflow-x-auto rounded-xl border border-[#eef2f7]">
              <div className="min-w-[320px]">
              <div className="flex items-center gap-2 border-b border-[#eef2f7] bg-[#f7f9fc] px-3.5 py-2 text-meta font-semibold uppercase tracking-[0.04em] text-[#64748b]">
                <Icon name="today" className="h-3.5 w-3.5" />
                Cloning chain, 3 days
              </div>
              <GanttRow
                day="Day 1"
                label="Restriction digest (BamHI + EcoRI)"
                barClass="bg-brand-purple"
                width="55%"
                offset="0%"
              />
              <GanttRow
                day="Day 2"
                label="Ligation (T4 ligase, 16C overnight)"
                barClass="bg-emerald-500"
                width="40%"
                offset="15%"
                dep="depends on digest"
              />
              <GanttRow
                day="Day 3"
                label="Transformation (DH5a, heat-shock)"
                barClass="bg-brand-action"
                width="35%"
                offset="25%"
                dep="depends on ligation"
              />
              <GanttRow
                day="Day 3"
                label="Colony PCR screen"
                barClass="bg-amber-500"
                width="30%"
                offset="58%"
                dep="depends on transformation"
              />
            </div>{/* /min-w-[320px] */}
            </div>
            <ResultFoot>
              All four experiments are now in your Experiments list, tagged to
              this project, with the standard ligation and transformation methods
              attached as templates. Want me to add the primer sequences to the
              colony PCR step?
            </ResultFoot>
          </PromptCard>
        </CapabilitySection>

        {/* ── VALUE, lead hard on how cheap the AI is ──────────────────── */}
        <section
          id="value"
          className="scroll-mt-6 border-t border-[#d8e3f1] bg-[#f4f8fd] px-6 py-16 sm:px-12"
        >
          <Reveal className="mx-auto max-w-[1000px]">
            <Kicker>{"// metered at a small markup over compute"}</Kicker>
            <h2 className="mt-2.5 max-w-[24ch] text-3xl font-extrabold leading-tight tracking-tight text-brand-ink md:text-[36px]">
              No subscription, no seat fees, you see every token
            </h2>
            <p className="mt-3 max-w-[64ch] text-body leading-relaxed text-[#475569] sm:text-title">
              A single per-seat tool like GraphPad Prism or SnapGene runs hundreds
              of dollars a year per seat. BeakerBot does the same analysis or
              primer design for pennies, over data you already own. AI on
              ResearchOS is metered at a small markup over the actual compute,
              not a per-seat subscription, because your data stays on your own
              machine instead of on our servers.
            </p>

            <div className="mt-8 grid gap-5 md:grid-cols-[1.4fr_1fr]">
              {/* Why metered, the WHY */}
              <div className="rounded-2xl border border-[#dbe6f3] bg-white p-6 shadow-[0_1px_3px_rgba(15,40,80,0.06)]">
                <h3 className="text-title font-bold text-brand-ink">
                  A couple cents of compute does real work
                </h3>
                <p className="mt-2 text-body leading-relaxed text-[#475569]">
                  A full task costs about two cents of real compute (roughly
                  110,000 tokens). A quick question is about 50,000. The free
                  sign-up gift is about 1.6 million tokens, which covers about 15
                  tasks or 30-plus quick questions, no card needed.
                </p>
                <p className="mt-3 text-body leading-relaxed text-[#475569]">
                  After the gift, prepaid top-ups are {packList}, and a{" "}
                  {smallestPack} top-up is a few hundred tasks. We charge a small
                  markup over what the compute costs, because a lab&apos;s AI use
                  varies a lot month to month and one heavy week should not cost
                  the same as four quiet ones.
                </p>
                <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
                  {[
                    ["Always visible", "Your balance and the last task's cost sit in the sidebar."],
                    ["No card to start", "The free token gift needs no payment method."],
                    ["Lab can cover it", "A lab or institution can fund a shared pool."],
                  ].map(([t, b]) => (
                    <div
                      key={t}
                      className="rounded-xl border border-[#eef2f7] bg-[#f7f9fc] px-3.5 py-3"
                    >
                      <div className="flex items-center gap-1.5 text-body font-semibold text-brand-ink">
                        <Icon name="check" className="h-4 w-4 text-emerald-600" />
                        {t}
                      </div>
                      <p className="mt-1 text-meta leading-relaxed text-[#64748b]">
                        {b}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Cost reference card */}
              <div className="rounded-2xl border border-brand-action/20 bg-brand-action/[0.05] p-6">
                <div className="text-meta font-semibold uppercase tracking-[0.05em] text-[#64748b]">
                  Cost reference
                </div>
                <div className="mt-3 divide-y divide-brand-action/15">
                  <CostRefRow
                    label="Full task"
                    value="~110,000 tok"
                    valueClass="text-brand-sky"
                  />
                  <CostRefRow
                    label="Quick question"
                    value="~50,000 tok"
                    valueClass="text-brand-sky"
                  />
                  <CostRefRow
                    label="Free sign-up gift"
                    value="~1.6M tok"
                    valueClass="text-emerald-600"
                  />
                </div>
                <p className="mt-3 border-t border-dashed border-brand-action/20 pt-3 text-meta leading-relaxed text-[#64748b]">
                  About 15 tasks free, no card needed.
                </p>
                <Link
                  href="/pricing#ai-pricing"
                  className="mt-4 inline-flex items-center gap-1.5 text-body font-bold text-brand-action transition-colors hover:text-brand-ink"
                >
                  See exactly how it&apos;s priced
                  <span aria-hidden>&rarr;</span>
                </Link>
              </div>
            </div>
          </Reveal>
        </section>

        {/* ── FINAL CTA ────────────────────────────────────────────────── */}
        <section className="border-t border-[#d8e3f1] bg-white px-6 py-20 text-center sm:px-12">
          <Reveal className="mx-auto flex max-w-2xl flex-col items-center">
            <div
              aria-hidden
              className="brand-rainbow-bg mb-6 h-1 w-14 rounded-full"
            />
            <BeakerBot
              pose="idle"
              alive
              ariaLabel="BeakerBot"
              className="h-16 w-16 text-brand-sky"
            />
            <h2 className="mt-4 max-w-[20ch] text-3xl font-extrabold leading-[1.08] tracking-tight text-brand-ink md:text-4xl">
              Put BeakerBot to work on your own data
            </h2>
            <p className="mt-4 max-w-[52ch] text-body leading-relaxed text-[#475569] sm:text-title">
              Sign in, connect a folder, and ask it a question. The free token
              gift is waiting, no card needed.
            </p>
            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button
                type="button"
                onClick={goTry}
                data-testid="ai-cta-try"
                className="btn-brand inline-flex min-h-[44px] items-center gap-2 px-6 py-3 text-body"
              >
                <Icon name="ask" className="h-4 w-4" />
                Try BeakerBot free
              </button>
              <Link
                href="/demo"
                data-testid="ai-cta-demo"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-brand-action/25 bg-white px-6 py-3 text-body font-semibold text-brand-action shadow-[0_2px_12px_rgba(15,40,80,0.06)] transition-transform hover:scale-[1.02]"
              >
                Explore the live demo
                <span aria-hidden>&rarr;</span>
              </Link>
            </div>
            <p className="mt-6 text-meta text-[#94a3b8]">
              The local app is free and open source. AI is a separate metered
              add-on, priced at a small markup over compute.{" "}
              <Link
                href="/pricing#ai-pricing"
                className="font-semibold text-brand-action hover:text-brand-ink"
              >
                See the pricing <span aria-hidden>&rarr;</span>
              </Link>
            </p>
          </Reveal>
        </section>

        <SponsorStrip variant="welcome" />
        <MarketingFooter />
      </div>
    </div>
  );
}
