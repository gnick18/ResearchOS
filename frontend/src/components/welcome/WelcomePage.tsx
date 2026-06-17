"use client";

/**
 * The `/welcome` page: the marketing scroll-down (2026-06-11 approved-redesign
 * rebuild against docs/mockups/welcome-redesign-2026-06-11.html).
 *
 * It is LIGHT-themed (Grant's rule); only the companion-app spotlight band is
 * dark by design (the mockup's .spot navy gradient). The aesthetic is clean
 * white and pale-blue panels with a BOLD rainbow brand treatment: a thick
 * rainbow top bar, rainbow-gradient frames around the demo windows, and short
 * rainbow rule lines under the section kickers. The rainbow comes from the brand
 * tokens in globals.css (--brand-rainbow / .brand-rainbow-bg) so the page paints
 * the same ramps as the footer, the avatars, and the banner.
 *
 * Unified entrance: every section's inner content is wrapped in the shared
 * <Reveal> primitive (the same scroll-in the pricing page uses), and the hero
 * sits on the shared <MarketingBackdrop> aurora so welcome and pricing read as
 * one continuous stage.
 *
 * IA (mockup order), shared body after the standalone hero:
 *   1. Stack + cost table (the lead, what your lab pays for now)
 *   2. Honest four-way comparison (the natural deep-dive after cost)
 *   3. Chemistry Workbench showcase (placeholder clip)
 *   4. Data Hub showcase (placeholder clip)
 *   5. Sequence editor showcase (real sequence-editor-a.mp4, flagship copy)
 *   6. Purchases + Inventory showcase (placeholder clip)
 *   7. Companion app spotlight (dark band, four capability cards)
 *   8. AI assistant (the metered BeakerBot story, replaces the old AI section)
 *  10. How it works (three steps, local-first)
 *  11. Mission (open-source company + founder line)
 *  12. NIH + Zenodo (grant-ready deposit, moved out of the hero)
 *  13. Trust band (four cards)
 *  14. Final CTA + sponsors + footer
 *
 * Sign-in / open-folder live in the connect chooser ABOVE this page
 * (OAuthFirstLanding embeds WelcomePage one scroll down), so there are NO sign-in
 * cards on this sales page. Every "get started" CTA routes UP to that chooser:
 * embedded, it scrolls the snap container back to the top; standalone (/welcome)
 * it links to "/". When embedded, the nav AND the entire hero are hidden so the
 * scroll opens on substance (section 1), not a second landing.
 *
 * Voice rules: no em-dashes, no emojis (every glyph is an inline SVG kept within
 * the icon-guard baseline, or the <Icon> registry), no mid-sentence colons.
 * Warm, concept-first, contractions OK. BeakerBot is the only mascot.
 */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import BeakerBot from "@/components/BeakerBot";
import { Icon } from "@/components/icons";
import MarketingFooter from "@/components/MarketingFooter";
import SponsorStrip from "@/components/SponsorStrip";
import BeakerBotPeek from "@/components/welcome/BeakerBotPeek";
import Wordmark from "@/components/Wordmark";
import DemoLoop, { DemoLoopPlaceholder } from "@/components/welcome/DemoLoop";
import VideoLightbox from "@/components/welcome/VideoLightbox";
import BeakerSearchShowpiece from "@/components/welcome/BeakerSearchShowpiece";
import Reveal from "@/components/marketing/Reveal";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import Kicker from "@/components/marketing/Kicker";
import { DEPT_TIER_ENABLED } from "@/lib/dept/config";
import { INSTITUTION_TIER_ENABLED } from "@/lib/institution/config";
import { isRequireAccountEnabled } from "@/lib/account/require-account";
import RainbowFrame from "@/components/marketing/RainbowFrame";
import FeatureRow from "@/components/marketing/FeatureRow";
import { markLandingSeen } from "@/lib/landing/landing-gate";
import { ASSET_BASE_URL } from "@/lib/figure/asset-library";
import { isMobileDevice } from "@/lib/file-system/file-system-context";

/** The rainbow ramps, pulled from the brand tokens in globals.css so the
 *  welcome page never drifts from the footer / avatars / banner. RAINBOW is the
 *  pastel fill used for the ribbon and the demo-frame borders; RAINBOW_TEXT is
 *  the saturated ramp clipped into the gradient headline word (the pastel washes
 *  out as type on white). */
const RAINBOW = "var(--brand-rainbow)";
const RAINBOW_TEXT = "var(--brand-rainbow-vivid)";

/** The current welcome demo clips live in R2 under the `welcome/` prefix, served
 *  from the shared asset domain (`ASSET_BASE_URL`, default
 *  https://assets.research-os.com). The old per-feature Vercel Blob clips were
 *  retired 2026-06-15; this is the curated five-clip lineup. */
const WELCOME_VIDEO_BASE = `${ASSET_BASE_URL}/welcome`;

/** Flip to true once the welcome demo clips are RE-RECORDED against the current
 *  UI and re-uploaded to R2 (welcome/<name>.mp4 + .poster.jpg). While false,
 *  every R2Demo renders the "demo coming soon" placeholder instead. The prior
 *  batch (uploaded 2026-06-15) was recorded from a stale build — it showed the
 *  old nav and the removed "Connect Telegram" button — so we pulled them from
 *  the live page rather than show deprecated UI. Re-recording is a manual task;
 *  storyboards live in docs/marketing/welcome-video-scripts.md. */
const WELCOME_DEMOS_READY: boolean = false;

/** A framed R2 welcome demo clip (poster + mp4 by name under `welcome/`). Wraps
 *  the shared DemoLoop in the rainbow frame used across the feature rows. The
 *  inline embed is always tastefully capped + centered (never full-screen, in
 *  any layout); clicking it opens the clip larger in a VideoLightbox. Until the
 *  clips are re-recorded (WELCOME_DEMOS_READY), it shows a capped placeholder. */
function R2Demo({ name, label }: { name: string; label: string }) {
  const [open, setOpen] = useState(false);
  const src = `${WELCOME_VIDEO_BASE}/${name}.mp4`;
  const poster = `${WELCOME_VIDEO_BASE}/${name}.poster.jpg`;
  if (!WELCOME_DEMOS_READY) {
    return (
      <div className="mx-auto w-full max-w-[600px]">
        <DemoLoopPlaceholder claim={label} />
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`View larger: ${label}`}
        className="group relative mx-auto block w-full max-w-[600px] cursor-zoom-in rounded-[20px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action/60"
      >
        <RainbowFrame>
          <DemoLoop
            src={src}
            poster={poster}
            label={label}
            preload="metadata"
          />
        </RainbowFrame>
        <span className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-[#0a1424]/70 px-2.5 py-1 text-xs font-medium text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          Click to expand
        </span>
      </button>
      {open && (
        <VideoLightbox
          src={src}
          poster={poster}
          label={label}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}


/** Public mirror of the server BILLING_ENABLED switch, for client copy. While
 *  false, the pricing copy says cloud + AI are free during the beta; while true,
 *  it reads as live, billed pricing. NEXT_PUBLIC bakes at build, so flip it in
 *  Vercel ALONGSIDE the server BILLING_ENABLED / AI_BILLING_ENABLED and redeploy
 *  (see docs/proposals/2026-06-13-billing-go-live-checklist.md). Kept a separate
 *  flag because the server switch is not readable from this client component. */
const BILLING_LIVE = process.env.NEXT_PUBLIC_BILLING_LIVE === "1";


/** A check glyph for the trust-block lists, sky-blue. The single inline check
 *  glyph in the file, reused everywhere a bullet needs a tick. */
function CheckGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 flex-none text-sky-600"
      aria-hidden
    >
      <path d="M4 10.5l3.5 3.5L16 5.5" />
    </svg>
  );
}

// Kicker and RainbowFrame now live in @/components/marketing (shared across the
// marketing pages); imported at the top of this file.

/* ----------------------------------------------------------------------------
 * A feature showcase row, the workhorse layout for sections 2 through 7 of the
 * mockup. Text on one side, a framed demo (real clip or placeholder) on the
 * other. `flip` puts the visual first on desktop (the mockup's .feat.alt). The
 * whole row reveals as one unit.
 * -------------------------------------------------------------------------- */
// FeatureRow now lives in @/components/marketing/FeatureRow (shared); imported
// at the top of this file.

/* ----------------------------------------------------------------------------
 * Comparison table, carried from the prior page and restyled to the light
 * aesthetic. ResearchOS vs LabArchives vs SnapGene vs Quartzy, honest four-way.
 * -------------------------------------------------------------------------- */
type CellMark = "win" | "have" | "soon" | "none";
interface Cell {
  mark: CellMark;
  text: string;
}

function MarkIcon({ mark }: { mark: CellMark }) {
  if (mark === "soon") {
    return (
      <span className="mt-0.5 inline-block flex-none whitespace-nowrap rounded-full bg-sky-100 px-2 py-0.5 text-meta font-semibold text-sky-700">
        Coming soon
      </span>
    );
  }
  if (mark === "win" || mark === "have") {
    return (
      <svg
        className={`mt-0.5 h-4 w-4 flex-none ${
          mark === "win" ? "text-emerald-500" : "text-slate-400"
        }`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        viewBox="0 0 24 24"
        aria-hidden
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  return <span className="mt-0.5 h-4 w-4 flex-none" aria-hidden />;
}

function ComparisonRow({
  label,
  us,
  labarchives,
  snapgene,
  quartzy,
}: {
  label: string;
  us: Cell;
  labarchives: Cell;
  snapgene: Cell;
  quartzy: Cell;
}) {
  const other = (cell: Cell) => (
    <td className="px-4 py-3 text-body text-[#64748b]">
      <span className="flex items-start gap-2">
        <MarkIcon mark={cell.mark} />
        <span>{cell.text}</span>
      </span>
    </td>
  );
  return (
    <tr className="border-b border-[#e3eaf3] align-top last:border-0">
      <td className="px-4 py-3 text-body font-medium text-brand-ink">{label}</td>
      <td className="bg-sky-50 px-4 py-3 text-body text-brand-ink">
        <span className="flex items-start gap-2">
          <MarkIcon mark={us.mark} />
          <span>{us.text}</span>
        </span>
      </td>
      {other(labarchives)}
      {other(snapgene)}
      {other(quartzy)}
    </tr>
  );
}

/* ----------------------------------------------------------------------------
 * The competitor-cost table (mockup section 1). Light-themed rebuild of the
 * mockup's dark .cost table, the page's lead band: the stack a lab pays for now
 * vs free ResearchOS.
 * -------------------------------------------------------------------------- */
const COST_ROWS: { tool: string; does: string; price: string }[] = [
  { tool: "LabArchives", does: "Electronic lab notebook", price: "$330 / user / yr" },
  { tool: "SnapGene", does: "Cloning and sequences", price: "$1,625 flat" },
  { tool: "GraphPad Prism", does: "Stats and figures", price: "~$1,000s" },
  { tool: "ChemDraw", does: "Chemical structures", price: "per seat, pricey" },
  { tool: "SciFinder", does: "Chemical literature and patent search", price: "institutional license, pricey" },
  { tool: "Quartzy", does: "Inventory and ordering", price: "$1,908 flat" },
];

function CostTable() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);
  const [reduced, setReduced] = useState(false);

  // One-time cascade: the price rows drop in top to bottom as the table scrolls
  // into view, then stay (they do not re-hide on the way back up, so the running
  // tally reads as a building total rather than a flicker). Disabled under
  // prefers-reduced-motion and where IntersectionObserver is missing.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mq =
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    if (mq?.matches) {
      setReduced(true);
      setShown(true);
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const rowStyle = (i: number): CSSProperties =>
    reduced
      ? {}
      : {
          opacity: shown ? 1 : 0,
          transform: shown ? "none" : "translateY(14px)",
          transition:
            "opacity 0.55s cubic-bezier(0.2, 0.7, 0.2, 1), transform 0.55s cubic-bezier(0.2, 0.7, 0.2, 1)",
          transitionDelay: `${i * 40}ms`,
        };

  return (
    <div
      ref={ref}
      className="mt-8 overflow-hidden rounded-2xl border border-[#e3eaf3] bg-white shadow-[0_1px_2px_rgba(15,40,80,0.04)]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[#e3eaf3]">
              <th className="px-4 py-3 text-meta font-semibold uppercase tracking-[0.04em] text-[#64748b]">
                The tool your lab pays for
              </th>
              <th className="px-4 py-3 text-meta font-semibold uppercase tracking-[0.04em] text-[#64748b]">
                What it does
              </th>
              <th className="px-4 py-3 text-right text-meta font-semibold uppercase tracking-[0.04em] text-[#64748b]">
                Academic price
              </th>
            </tr>
          </thead>
          <tbody>
            {COST_ROWS.map((r, i) => (
              <tr
                key={r.tool}
                className="border-b border-[#e3eaf3]"
                style={rowStyle(i)}
              >
                <td className="px-4 py-3 text-body font-medium text-brand-ink">
                  {r.tool}
                </td>
                <td className="px-4 py-3 text-body text-[#475569]">{r.does}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-body font-bold text-brand-ink">
                  {r.price}
                </td>
              </tr>
            ))}
            <tr style={rowStyle(COST_ROWS.length)}>
              <td colSpan={2} className="px-4 pt-5 pb-4">
                <span className="text-2xl font-extrabold tracking-tight text-brand-ink md:text-[32px]">
                  Thousands per year{" "}
                  <span aria-hidden>&rarr;</span>{" "}
                  <span
                    style={{
                      background: RAINBOW_TEXT,
                      WebkitBackgroundClip: "text",
                      backgroundClip: "text",
                      color: "transparent",
                    }}
                  >
                    free
                  </span>
                </span>
              </td>
              <td className="px-4 pt-5 pb-4 text-right text-title font-extrabold text-emerald-600">
                ResearchOS
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Companion-app capability card (mockup section 6, the spotlight). A dark card
 * sitting on the navy spotlight band.
 * -------------------------------------------------------------------------- */
function CapabilityCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-[#24375c] bg-white/[0.04] p-4">
      <h3 className="text-title font-extrabold text-white">{title}</h3>
      <p className="mt-1.5 text-body leading-relaxed text-[#b9cde6]">{body}</p>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * How-it-works step card (mockup section 8).
 * -------------------------------------------------------------------------- */
function StepCard({
  num,
  title,
  body,
}: {
  num: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-[#dbe6f3] bg-white p-6 shadow-[0_1px_3px_rgba(15,40,80,0.06)]">
      <div className="font-mono text-meta font-semibold tracking-[0.04em] text-brand-action">
        {num}
      </div>
      <h3 className="mt-2 text-title font-bold tracking-tight text-brand-ink">
        {title}
      </h3>
      <p className="mt-1.5 text-body leading-relaxed text-[#475569]">{body}</p>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Trust-band card (mockup section 11). Optional href turns it into a link.
 * -------------------------------------------------------------------------- */
function TrustCard({
  title,
  body,
  href,
}: {
  title: string;
  body: string;
  href?: string;
}) {
  const inner = (
    <>
      <h3 className="text-title font-bold text-brand-ink">{title}</h3>
      <p className="mt-1.5 text-body leading-relaxed text-[#475569]">{body}</p>
    </>
  );
  const cls =
    "rounded-2xl border border-[#dbe6f3] bg-white p-5 shadow-[0_1px_3px_rgba(15,40,80,0.06)]";
  if (href) {
    return (
      <a href={href} className={`group block transition-colors hover:border-[#c5d6ea] ${cls}`}>
        {inner}
        <span className="mt-2 inline-flex items-center gap-1 text-body font-semibold text-brand-action group-hover:text-brand-ink">
          Read more <span aria-hidden>&rarr;</span>
        </span>
      </a>
    );
  }
  return <div className={cls}>{inner}</div>;
}

/* ----------------------------------------------------------------------------
 * Phone reflow of the cost table (the lead band). Below the `sm` breakpoint the
 * wide three-column table is hard to scan with a thumb, so each tool becomes a
 * stacked card (name + what it does + price) and the "thousands -> free" punch
 * line becomes a final highlighted card. Desktop (>= sm) keeps the real table.
 * SSR-safe: pure CSS visibility toggle, no viewport hook.
 * -------------------------------------------------------------------------- */
function CostCards() {
  return (
    <div className="mt-8 flex flex-col gap-3 sm:hidden">
      {COST_ROWS.map((r) => (
        <div
          key={r.tool}
          className="rounded-2xl border border-[#e3eaf3] bg-white p-4 shadow-[0_1px_2px_rgba(15,40,80,0.04)]"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-body font-bold text-brand-ink">{r.tool}</span>
            <span className="whitespace-nowrap text-meta font-bold text-brand-ink">
              {r.price}
            </span>
          </div>
          <p className="mt-1 text-meta leading-snug text-[#475569]">{r.does}</p>
        </div>
      ))}
      {/* The punch line, as a branded card. */}
      <div
        className="relative overflow-hidden rounded-2xl border border-transparent bg-gradient-to-br from-white to-[#eef5fc] p-4"
        style={{ boxShadow: "0 0 0 1.5px var(--brand-action)" }}
      >
        <div className="text-xl font-extrabold leading-tight tracking-tight text-brand-ink">
          Thousands per year <span aria-hidden>&rarr;</span>{" "}
          <span
            style={{
              background: RAINBOW_TEXT,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            free
          </span>
        </div>
        <div className="mt-1 text-body font-extrabold text-emerald-600">
          with ResearchOS
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Phone reflow of the four-way comparison table. Below `sm` each product
 * becomes a stacked card listing how it scores on each capability (price, where
 * the data lives, full-suite). ResearchOS leads, framed with the brand accent;
 * the others follow. Desktop (>= sm) keeps the wide table.
 * -------------------------------------------------------------------------- */
const COMPARE_CAPS: { label: string; us: Cell; labarchives: Cell; snapgene: Cell; quartzy: Cell }[] = [
  {
    label: "Price",
    us: { mark: "win", text: "Free and open source; the app never charges per seat" },
    labarchives: { mark: "none", text: "Paid, per-seat licensing; limited free tier" },
    snapgene: { mark: "none", text: "Paid license per seat; free viewer only" },
    quartzy: { mark: "have", text: "Free core ordering; paid inventory tiers" },
  },
  {
    label: "Where your data lives",
    us: { mark: "win", text: "A folder on your own machine" },
    labarchives: { mark: "none", text: "On LabArchives' cloud servers" },
    snapgene: { mark: "have", text: "Files on your machine" },
    quartzy: { mark: "none", text: "On Quartzy's cloud servers" },
  },
  {
    label: "A full lab suite",
    us: { mark: "win", text: "Notebook, planning, purchasing, sequences, all in one" },
    labarchives: { mark: "have", text: "Notebook plus widgets and add-ons" },
    snapgene: { mark: "none", text: "Sequences only, not a notebook" },
    quartzy: { mark: "none", text: "Ordering and inventory only" },
  },
];

type CompareProduct = "us" | "labarchives" | "snapgene" | "quartzy";
const COMPARE_PRODUCTS: { id: CompareProduct; name: string }[] = [
  { id: "us", name: "ResearchOS" },
  { id: "labarchives", name: "LabArchives" },
  { id: "snapgene", name: "SnapGene" },
  { id: "quartzy", name: "Quartzy" },
];

function ComparisonCards() {
  return (
    <div className="mx-auto mt-2 flex max-w-[520px] flex-col gap-3 sm:hidden">
      {COMPARE_PRODUCTS.map((p) => {
        const isUs = p.id === "us";
        return (
          <div
            key={p.id}
            className="overflow-hidden rounded-2xl border bg-white"
            style={
              isUs
                ? {
                    borderColor: "var(--brand-action)",
                    boxShadow: "0 0 0 1px var(--brand-action)",
                  }
                : { borderColor: "#e3eaf3" }
            }
          >
            <div
              className={`px-4 py-2.5 ${isUs ? "" : "bg-[#f5f9fd]"}`}
              style={
                isUs
                  ? {
                      background:
                        "linear-gradient(90deg, rgba(18,131,201,0.10), rgba(155,123,214,0.10))",
                    }
                  : undefined
              }
            >
              <span
                className={`text-body font-extrabold ${isUs ? "text-sky-700" : "text-brand-ink"}`}
              >
                {p.name}
              </span>
            </div>
            <div>
              {COMPARE_CAPS.map((cap) => {
                const cell = cap[p.id];
                return (
                  <div
                    key={cap.label}
                    className="flex items-start gap-2.5 border-t border-[#e3eaf3] px-4 py-2.5 first:border-t-0"
                  >
                    <MarkIcon mark={cell.mark} />
                    <div className="min-w-0">
                      <div className="text-meta font-semibold text-brand-ink">
                        {cap.label}
                      </div>
                      <div className="text-meta leading-snug text-[#64748b]">
                        {cell.text}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Compact pricing-tier snapshot for the cost lead. Shows the SHAPE of the plans
 * (storage allowances, who pays) without printing the provisional Plus/Pro
 * sticker prices, per docs/reference/billing-copy-facts.md (final prices are not
 * published; the /pricing calculator shows the labeled estimates). The free/paid
 * framing line is flag-aware: free during the beta while BILLING_LIVE is off,
 * live billed pricing once it flips.
 * -------------------------------------------------------------------------- */
function TierSummary() {
  const tiers: { name: string; detail: string }[] = [
    { name: "Free", detail: "Receive shared work and stay in the network, $0. A real working tier." },
    { name: "Solo", detail: "Send and co-edit. A small base fee plus the cloud you actually use." },
    { name: "Lab", detail: "One invoice for the whole lab. A flat lab fee plus the cloud the lab uses." },
    {
      name: "Departments & institutions",
      detail: "The governance tier. Admin, compliance, and one consolidated invoice across your labs.",
    },
  ];
  return (
    <div className="mt-8">
      <div className="grid gap-3 sm:grid-cols-2">
        {tiers.map((t) => (
          <div
            key={t.name}
            className="rounded-2xl border border-[#e3eaf3] bg-white p-4 shadow-[0_1px_2px_rgba(15,40,80,0.04)]"
          >
            <div className="text-body font-extrabold text-brand-ink">
              {t.name}
            </div>
            <p className="mt-0.5 text-meta leading-snug text-[#475569]">
              {t.detail}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-meta leading-snug text-[#64748b]">
        Plus a metered BeakerBot AI, with about 1.6 million free
        tokens to start.{" "}
        {BILLING_LIVE
          ? "Your cloud usage is billed at a small markup, and storage is a-la-carte near our cost."
          : "Cloud storage and AI are free during the beta while we test the billing."}
      </p>
    </div>
  );
}

/* ========================================================================== */

export default function WelcomePage({
  embedded = false,
  unsupported = false,
}: {
  /** True when WelcomePage is the scroll-down content under the OAuth-first
   *  landing. Hides its own nav AND the entire hero (mascot, badge, headline,
   *  CTAs, the free/no-sign-up line) so the scroll opens directly on section 1
   *  (the stack + cost band), not a second landing. */
  embedded?: boolean;
  /** True when shown as the front door on a device/browser that cannot run the
   *  tool (no File System Access API: any phone, Safari, Firefox, Brave). The
   *  full marketing page still renders so visitors can read everything and reach
   *  the other public pages; only the "start the app" entry is replaced by a
   *  desktop-required notice, since the folder picker would not work here. */
  unsupported?: boolean;
} = {}) {
  const router = useRouter();

  // Phone vs desktop, resolved after mount (navigator is client-only). null
  // until then so SSR + first client render match (no banner), avoiding a
  // hydration mismatch and any mobile flash of the desktop-required banner.
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  useEffect(() => {
    setIsMobile(isMobileDevice());
  }, []);

  // "Get started" routes UP to the connect chooser, which now lives ABOVE this
  // page. When this component is embedded in OAuthFirstLanding, the chooser is
  // the previous scroll-snap section, so scrolling the surrounding scroll
  // container to the top lands on it. When the page is standalone (/welcome),
  // there is no chooser above, so we navigate to "/" where folder setup lives.
  // markLandingSeen() keeps the first-visit redirect in providers.tsx from
  // bouncing the visitor back to /welcome mid-transition.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const goGetStarted = () => {
    // On an unsupported device/browser the tool cannot run, so "get started"
    // has nowhere to go. Scroll back up to the desktop-required banner that
    // explains how to actually start, rather than bouncing through "/".
    if (unsupported) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    markLandingSeen();
    // Walk up from the page root to find the nearest scrollable ancestor (the
    // OAuthFirstLanding snap container). If found, this page is embedded one
    // scroll below the chooser, so scroll that container to the top.
    let node: HTMLElement | null = rootRef.current?.parentElement ?? null;
    let scroller: HTMLElement | null = null;
    while (node) {
      const oy = window.getComputedStyle(node).overflowY;
      if ((oy === "auto" || oy === "scroll") && node.scrollHeight > node.clientHeight) {
        scroller = node;
        break;
      }
      node = node.parentElement;
    }
    if (scroller) {
      scroller.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    // Standalone: send them to the home route where the connect flow lives.
    router.push("/");
  };

  return (
    <div
      ref={rootRef}
      className="min-h-screen w-full overflow-x-hidden bg-[#fbfcfe] text-brand-ink"
    >
      {/* Thick rainbow ribbon pinned to the very top edge. */}
      <div aria-hidden className="h-2 w-full" style={{ background: RAINBOW }} />

      {/* Desktop-required notice. Shown only for an UNSUPPORTED DESKTOP browser
          (Safari / Firefox), where "switch to Chrome or Edge" is actionable. NOT
          shown on phones (isMobile): a phone cannot switch to desktop Chrome, so
          the banner is just noise there; the marketing content reads the same as
          the desktop site. isMobile is null until mount, so this never flashes on
          a phone. */}
      {unsupported && isMobile === false && (
        <div className="sticky top-0 z-20 border-b border-amber-200 bg-amber-50/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1180px] flex-col gap-1 px-6 py-3 text-left sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <p className="text-meta leading-snug text-amber-900 sm:text-body">
              <span className="font-semibold">
                ResearchOS runs in Chrome or Edge on a desktop computer.
              </span>{" "}
              You can read everything here and on the rest of the site; to start
              your own notebook, open ResearchOS on a desktop browser.
            </p>
            <a
              href="/wiki/getting-started/browser-requirements"
              className="shrink-0 text-meta font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-700"
            >
              Why desktop only?
            </a>
          </div>
        </div>
      )}

      {/* No max-width here: section backgrounds (the pale-blue bands, the hero
          gradient) must go full-bleed to the screen edges at any width. Each
          section keeps its OWN inner max-width content wrapper. */}
      <div className="relative">
        {/* ── Nav (hidden when embedded, the landing's sticky bar replaces it) ── */}
        {!embedded && (
          <nav className="relative z-10 mx-auto flex w-full max-w-[1440px] items-center justify-between px-6 py-5 sm:px-12">
            <Wordmark size="md" animated={false} className="gap-2.5" />
            <div className="flex items-center gap-3">
              {/* Get started: routes up to the connect chooser (embedded) or
                  home (standalone). The brand-gradient primary action. */}
              <button
                type="button"
                onClick={goGetStarted}
                data-testid="welcome-nav-get-started"
                className="btn-brand inline-flex items-center gap-1.5 px-4 py-1.5 text-meta"
              >
                Get started
              </button>
            </div>
          </nav>
        )}

        {/* ── Hero (standalone only) ──────────────────────────────────────
            The whole hero is hidden when embedded so the scroll-down reveals
            substance (section 1), not a second landing. Sits on the shared
            MarketingBackdrop aurora (vivid) so the brand sings here, the same
            stage the pricing hero uses. The NIH card is NOT here anymore; it is
            its own section #12 below. */}
        {/* The SAME hero on every device, just reflowed for the screen. On an
            unsupported device/browser (every phone, plus Safari/Firefox) the
            sticky desktop-required banner above already explains that the app
            itself runs on desktop, so the marketing content stays identical
            rather than diverging into a separate phone landing. Hidden when
            embedded (the chooser's own bar leads). */}
        {!embedded && (
          <header className="relative isolate overflow-hidden bg-gradient-to-b from-white to-[#eef4fb] px-6 pb-16 pt-4 text-center sm:px-12">
            <MarketingBackdrop tone="vivid" />
            <Reveal className="relative z-10 mx-auto flex max-w-3xl flex-col items-center">
              <div
                aria-hidden
                className="relative drop-shadow-[0_14px_30px_rgba(26,160,230,0.34)]"
              >
                {/* Static hero mascot: the living idle (subtle breathe / blink /
                    gaze) without the on-load wave or greeting bubble. */}
                <BeakerBot
                  pose="idle"
                  alive
                  className="h-28 w-28 text-brand-sky md:h-32 md:w-32"
                />
              </div>

              <span className="mt-4 inline-flex items-center gap-2 rounded-full border border-[#d3deec] bg-sky-50 px-3.5 py-1.5 text-meta font-semibold text-sky-700">
                <span
                  aria-hidden
                  className="h-[7px] w-[7px] rounded-full bg-sky-500 shadow-[0_0_0_4px_rgba(54,179,245,0.12)]"
                />
                Built by PhD researchers, for researchers.
              </span>

              <h1 className="mt-6 max-w-[17ch] text-4xl font-extrabold leading-[1.05] tracking-tight text-brand-ink md:text-6xl">
                Your whole lab, in a notebook you{" "}
                <span
                  style={{
                    background: RAINBOW_TEXT,
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    color: "transparent",
                  }}
                >
                  actually own
                </span>
              </h1>

              <p className="mt-5 max-w-[56ch] text-title leading-relaxed text-[#475569]">
                Plan experiments, run real protocols, design plasmids, and write
                it all up in one workspace. Free to use, and everything you write
                stays on your own machine.
              </p>

              {/* Primary CTAs. No sign-in cards here: those live in the chooser
                  above. "Start your notebook" routes up to it; "See it in
                  action" jumps to the cost band below. */}
              <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={goGetStarted}
                  data-testid="welcome-hero-get-started"
                  className="btn-brand px-6 py-3 text-body"
                >
                  Start your notebook
                </button>
                <a
                  href="#stack"
                  className="inline-flex items-center gap-2 rounded-xl border border-[#cfdcec] bg-white px-6 py-3 text-body font-semibold text-brand-action shadow-[0_2px_12px_rgba(15,40,80,0.06)] transition-transform hover:scale-[1.02]"
                >
                  See it in action
                  <span aria-hidden>↓</span>
                </a>
              </div>
              <p className="mt-3 text-meta text-[#8593a8]">
                Free, and no sign-up to start. You only sign in if you want to
                share with your lab.
              </p>
            </Reveal>
          </header>
        )}

        {/* ── 1. STACK + COST (the lead) ──────────────────────────────────
            Opens the shared body. When embedded, this is the first thing the
            scroll reveals, so keep enough top padding to clear the landing's
            sticky bar. */}
        <section
          id="stack"
          className={`scroll-mt-6 border-b border-[#dbe6f3] bg-gradient-to-b from-white to-[#f5f9fd] px-6 pb-20 sm:px-12 ${
            embedded ? "pt-16" : "pt-16"
          }`}
        >
          <div className="mx-auto max-w-[1080px]">
            <Reveal>
              <Kicker>// what your lab pays for now</Kicker>
              <h2 className="mt-2.5 max-w-[24ch] text-3xl font-extrabold leading-tight tracking-tight text-brand-ink md:text-[36px]">
                One free app replaces a shelf of expensive software
              </h2>
              <p className="mt-3 max-w-[62ch] text-title leading-relaxed text-[#475569]">
                Most labs pay for a separate tool for the notebook, the
                chemistry, the cloning, the stats, and the ordering. The licenses
                stack up and renew every year, per person. ResearchOS does all of
                it, free, in a folder on your own machine.
              </p>
            </Reveal>
            {/* Wide cost table on >= sm; stacked cards on phone. */}
            <div className="hidden sm:block">
              <CostTable />
            </div>
            <CostCards />
            {/* The lead motion proof: one app standing in for the whole stack. */}
            <Reveal className="mt-8">
              <R2Demo
                name="replaces-5-tools"
                label="One ResearchOS window standing in for a separate notebook, chemistry, cloning, stats, and ordering app"
              />
            </Reveal>
            <Reveal>
              <TierSummary />
            </Reveal>
            <Reveal>
              <p className="mt-5 max-w-[68ch] border-t border-dashed border-[#dbe6f3] pt-4 text-body leading-relaxed text-[#64748b]">
                The local notebook and every feature on your own machine are
                free, forever. The cloud services that send, co-edit, and sync
                are paid, on a small base fee plus what you actually use.{" "}
                <a
                  href="/pricing"
                  className="font-bold text-brand-action transition-colors hover:text-brand-ink"
                >
                  See the full pricing and the cost calculator{" "}
                  <span aria-hidden>&rarr;</span>
                </a>
              </p>
            </Reveal>
          </div>
        </section>

        {/* ── AI SHOWPIECE (the second beat, full-bleed beaker blue) ──────
            BeakerBot moved way up, right under the cost lead. A wall-to-wall
            brand-blue band with a self-running BeakerSearch demo. Full-bleed:
            it is a direct child of the no-max-width wrapper, like the dark
            companion band below, so it breaks edge to edge. */}
        <BeakerSearchShowpiece onGetStarted={goGetStarted} />

        {/* ── 2. HONEST COMPARISON (deep-dive after cost) ─────────────────
            The four-way table with BeakerBot cheering over the ResearchOS
            column. The natural companion to the cost lead. */}
        <section className="px-6 py-16 sm:px-12">
          <Reveal className="mx-auto mb-8 max-w-[1320px]">
            <Kicker>// a full lab suite vs the point tools</Kicker>
            <h2 className="mt-2.5 max-w-[26ch] text-3xl font-extrabold leading-tight tracking-tight text-brand-ink md:text-[36px]">
              Honest about where each one wins
            </h2>
            <p className="mt-3 max-w-[62ch] text-title leading-relaxed text-[#475569]">
              One workspace instead of three subscriptions. The honest short
              version is below, with the full breakdown a click away.
            </p>
          </Reveal>

          {/* BeakerBot peeks over the ResearchOS column and cheers, then settles
              into a living idle. */}
          <BeakerBotPeek
            anchor="top-left"
            edgeInset="33%"
            reactionPose="cheering"
            restPose="idle"
            size="h-24 w-24"
          >
            {/* Phone: the four-way table reflows into stacked per-product cards
                so BeakerBot peeks over the same content at any width. */}
            <ComparisonCards />
            <div className="mx-auto hidden max-w-[1320px] overflow-hidden rounded-2xl border border-[#e3eaf3] bg-white shadow-[0_1px_2px_rgba(15,40,80,0.04)] sm:block">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-[#e3eaf3]">
                      <th className="w-[20%] px-4 py-3 text-body font-semibold text-[#64748b]">
                        <span className="sr-only">Capability</span>
                      </th>
                      <th className="w-[24%] bg-sky-50 px-4 py-3 text-body font-bold text-sky-700">
                        ResearchOS
                      </th>
                      <th className="w-[19%] px-4 py-3 text-body font-semibold text-[#334155]">
                        LabArchives
                      </th>
                      <th className="w-[19%] px-4 py-3 text-body font-semibold text-[#334155]">
                        SnapGene
                      </th>
                      <th className="w-[18%] px-4 py-3 text-body font-semibold text-[#334155]">
                        Quartzy
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <ComparisonRow
                      label="Price"
                      us={{ mark: "win", text: "Free and open source; the app never charges per seat" }}
                      labarchives={{ mark: "none", text: "Paid, per-seat licensing; limited free tier" }}
                      snapgene={{ mark: "none", text: "Paid license per seat; free viewer only" }}
                      quartzy={{ mark: "have", text: "Free core ordering; paid inventory tiers" }}
                    />
                    <ComparisonRow
                      label="Where your data lives"
                      us={{ mark: "win", text: "A folder on your own machine" }}
                      labarchives={{ mark: "none", text: "On LabArchives' cloud servers" }}
                      snapgene={{ mark: "have", text: "Files on your machine" }}
                      quartzy={{ mark: "none", text: "On Quartzy's cloud servers" }}
                    />
                    <ComparisonRow
                      label="A full lab suite"
                      us={{ mark: "win", text: "Notebook, planning, purchasing, sequences, all in one" }}
                      labarchives={{ mark: "have", text: "Notebook plus widgets and add-ons" }}
                      snapgene={{ mark: "none", text: "Sequences only, not a notebook" }}
                      quartzy={{ mark: "none", text: "Ordering and inventory only" }}
                    />
                  </tbody>
                </table>
              </div>
            </div>
          </BeakerBotPeek>

          <p className="mx-auto mt-6 max-w-[64ch] text-center text-body leading-relaxed text-[#64748b]">
            The point tools go deeper in their one lane. ResearchOS wins by
            folding the notebook, the sequence tool, chemistry, and inventory
            into one free suite with your data on your own disk.{" "}
            <a
              href="/pricing"
              className="font-bold text-brand-action transition-colors hover:text-brand-ink"
            >
              See the full four-way <span aria-hidden>&rarr;</span>
            </a>
          </p>
        </section>

        {/* ── 3. CHEMISTRY WORKBENCH ──────────────────────────────────── */}
        <FeatureRow
          tint
          kicker="// no ChemDraw or SciFinder license"
          title="Draw and search chemistry, built in"
          body="Draw a structure like you would in ChemDraw, pull the compound straight from PubChem, then search the literature and patents by structure, a free stab at what most labs open SciFinder for. Drop any of it into your experiment note. The tools labs pay a fortune for, free."
          pills={["Structure editor", "PubChem import", "Literature and patent search"]}
        />

        {/* ── 4. DATA HUB ──────────────────────────────────────────────── */}
        <FeatureRow
          flip
          kicker="// no Prism license"
          title="Run the stats and make the figure"
          body="Paste your data, run the test, make a publication-ready plot. Every statistic is validated in public against scipy, R, and Prism, so you can trust the number you cite."
          pills={["Validated tests", "Publication figures", "No black box"]}
        />

        {/* ── 5. SEQUENCE EDITOR (real clip, flagship) ─────────────────── */}
        <FeatureRow
          tint
          kicker="// no SnapGene license"
          title="Design plasmids and run cloning, built in"
          body="A SnapGene-style sequence editor lives right inside your notebook. Open a plasmid and its circular map renders with annotated features and restriction sites. Run Gibson, Golden Gate, or restriction cloning and it designs the primers for you. Free, with no separate tool to license."
          visual={
            <BeakerBotPeek
              anchor="top-right"
              reactionPose="amazed"
              bubble="whoa!"
              size="h-24 w-24"
            >
              <R2Demo
                name="sequence-editor-a"
                label="A circular plasmid map rendering in the ResearchOS sequence editor, with annotated feature arcs, then a Gibson assembly designing its own junction primers"
              />
            </BeakerBotPeek>
          }
        >
          <ul className="mt-6 grid gap-3">
            <li className="flex items-start gap-2.5 text-body leading-snug text-[#0f1b2e]">
              <CheckGlyph />
              Annotated circular and linear maps, with feature and enzyme tracks.
            </li>
            <li className="flex items-start gap-2.5 text-body leading-snug text-[#0f1b2e]">
              <CheckGlyph />
              Gibson, Golden Gate, Gateway, and restriction cloning in silico.
            </li>
            <li className="flex items-start gap-2.5 text-body leading-snug text-[#0f1b2e]">
              <CheckGlyph />
              Auto-designed junction primers with a copyable oligo order.
            </li>
            <li className="flex items-start gap-2.5 text-body leading-snug text-[#0f1b2e]">
              <CheckGlyph />
              Pull any published sequence straight from NCBI by gene name, no
              accession hunting.
            </li>
          </ul>
        </FeatureRow>

        {/* ── 6. PURCHASES + INVENTORY ─────────────────────────────────── */}
        <FeatureRow
          flip
          kicker="// no Quartzy"
          title="Track orders and inventory"
          body="Log a purchase, attach the order PDF, and the PI can send it to the department in one click. Inventory and ordering for the whole lab, no extra subscription."
          pills={["Order tracking", "Attach PDFs", "Send to department"]}
        />

        {/* ── 6.5 CHECK-INS + MENTORING ────────────────────────────────── */}
        <FeatureRow
          tint
          kicker="// not corporate one-on-ones"
          title="Mentorship and check-ins, built for how labs run"
          body="Structured check-ins between a PI and each trainee, group lab meetings with a presenter rotation, and individual development plans modeled on the standards trainees already use (AAAS myIDP). Funders increasingly expect documented mentoring and IDPs, so it lives where the rest of the lab already works, not in a separate HR tool."
          pills={[
            "Career-stage IDPs",
            "Lab meeting rotation",
            "PI and trainee 1:1s",
            "Mentorship tree",
          ]}
          visual={
            <R2Demo
              name="pi-lab-overview"
              label="A PI's overview of the lab in ResearchOS: the mentorship tree, individual development plans, and the lab-meeting presenter rotation"
            />
          }
        />

        {/* ── 7. COMPANION APP SPOTLIGHT (dark band) ───────────────────── */}
        <section
          className="px-6 py-16 text-[#eaf2fb] sm:px-12"
          style={{
            background: "linear-gradient(160deg,#0e1830,#142a4a 58%,#10203c)",
          }}
        >
          <div className="mx-auto max-w-[1180px]">
            <Reveal>
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="brand-rainbow-bg h-[3px] w-6 flex-none rounded-full"
                />
                <span className="font-mono text-meta font-semibold uppercase tracking-[0.12em] text-[#7fc4ff]">
                  // your lab, in your pocket
                </span>
              </div>
              <h2 className="mt-2.5 max-w-[24ch] text-3xl font-extrabold leading-tight tracking-tight text-white md:text-[36px]">
                The companion app brings ResearchOS to the bench
              </h2>
              <p className="mt-3 max-w-[64ch] text-title leading-relaxed text-[#b9cde6]">
                Most of research happens standing at a bench, not at a desk. The
                companion app is the bench end of your notebook, so the messy
                steps flow straight into the experiment on your computer with
                nothing to retype later.
              </p>
            </Reveal>

            <div className="mt-9 grid items-center gap-9 md:grid-cols-[0.78fr_1.22fr]">
              {/* CSS phone frame holding a clean static poster screen: the
                  BeakerBot mascot over a faux experiment note, so it reads as a
                  finished product shot, not an empty play placeholder. Leads
                  the cascade, then the four capability cards follow it in. */}
              <Reveal className="justify-self-center" delay={0}>
                <div className="relative aspect-[9/19] w-[clamp(150px,46vw,196px)] max-w-full overflow-hidden rounded-[30px] border-8 border-[#060d1c] bg-[#0d1424] shadow-[0_20px_54px_rgba(0,0,0,0.55)]">
                  <span
                    aria-hidden
                    className="absolute left-1/2 top-2.5 z-[2] h-1.5 w-[52px] -translate-x-1/2 rounded-full bg-[#060d1c]"
                  />
                  {/* Static "app on a phone" poster, all CSS plus the BeakerBot
                      mascot, no video and no play button. */}
                  <div className="absolute inset-0 flex flex-col bg-gradient-to-b from-[#13243f] to-[#0c1730] px-3 pb-3 pt-6">
                    <div className="flex items-center gap-2">
                      <BeakerBot
                        pose="idle"
                        alive
                        ariaLabel="BeakerBot"
                        className="h-7 w-7 flex-none text-brand-sky"
                      />
                      <div className="min-w-0">
                        <div className="truncate text-[10px] font-extrabold text-white">
                          PCR-2026-118
                        </div>
                        <div className="truncate text-[8.5px] text-[#8fb7d9]">
                          At the bench, just now
                        </div>
                      </div>
                    </div>
                    <div className="mt-2.5 flex-1 rounded-[10px] border border-white/10 bg-white/[0.05] p-2.5">
                      <div className="h-1.5 w-3/4 rounded-full bg-white/20" />
                      <div className="mt-1.5 h-1.5 w-full rounded-full bg-white/10" />
                      <div className="mt-1.5 h-1.5 w-5/6 rounded-full bg-white/10" />
                      <div
                        aria-hidden
                        className="mt-3 aspect-[4/3] w-full rounded-[7px] bg-gradient-to-br from-[#1f4f7a] to-[#16304f]"
                      />
                      <div className="mt-2 h-1.5 w-2/3 rounded-full bg-white/10" />
                    </div>
                    <div className="mt-2.5 rounded-[9px] bg-brand-action py-1.5 text-center text-[9.5px] font-extrabold text-white">
                      Save to experiment
                    </div>
                  </div>
                </div>
              </Reveal>

              {/* 2x2 capability grid, copy verbatim from the mockup. Each card
                  cascades in after the phone at a 90ms step. */}
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Reveal delay={90}>
                  <CapabilityCard
                    title="Snap a photo into the experiment"
                    body="Photograph a gel, a plate, or the bench and it lands in the right experiment on your computer at full resolution. No cable, no retyping."
                  />
                </Reveal>
                <Reveal delay={180}>
                  <CapabilityCard
                    title="Scan handwritten notes to text"
                    body="Point your phone at a page of bench scrawl and it pulls the text out, so a paper note becomes a searchable entry in the experiment."
                  />
                </Reveal>
                <Reveal delay={270}>
                  <CapabilityCard
                    title="Scan a barcode, inventory updates itself"
                    body="Scan the barcode on a reagent box and inventory deducts automatically as you use it. No spreadsheet, no manual count, the stock stays right."
                  />
                </Reveal>
                <Reveal delay={360}>
                  <CapabilityCard
                    title="Run methods on your phone, not on paper"
                    body="Open a method in reading mode and follow it step by step at the bench instead of printing it. Add a variation note from your phone and it saves back to the run."
                  />
                </Reveal>
              </div>
            </div>

            {/* Methods library in motion: opening a saved method and running it
                step by step at the bench from the phone. */}
            <Reveal className="mt-9">
              <R2Demo
                name="methods-library"
                label="Opening a saved method from the ResearchOS library and running it step by step at the bench from the companion app"
              />
            </Reveal>
          </div>
        </section>

        {/* ── 10. HOW IT WORKS (local-first, three steps) ──────────────── */}
        <section className="px-6 py-16 sm:px-12">
          <div className="mx-auto max-w-[1080px]">
            <Reveal>
              <Kicker>// how it works</Kicker>
              <h2 className="mt-2.5 max-w-[30ch] text-3xl font-extrabold leading-tight tracking-tight text-brand-ink md:text-[34px]">
                Three steps, your data never leaves unless you say so
              </h2>
            </Reveal>
            <div className="mt-7 grid grid-cols-1 gap-4 md:grid-cols-3">
              <Reveal delay={0}>
                <StepCard
                  num="01"
                  title="Open a folder"
                  body="Pick a folder on your own computer. That folder is always the original."
                />
              </Reveal>
              <Reveal delay={90}>
                <StepCard
                  num="02"
                  title="Work locally"
                  body="Notebook, chemistry, stats, cloning, inventory. Fully offline if you want."
                />
              </Reveal>
              <Reveal delay={180}>
                <StepCard
                  num="03"
                  title="Sync if you choose"
                  body="Turn on the paid cloud to send, co-edit, or sync. Nothing uploads until you do."
                />
              </Reveal>
            </div>
            {/* Local-first in motion: the data living in a folder the user owns. */}
            <Reveal className="mt-8">
              <R2Demo
                name="own-your-data"
                label="ResearchOS working from a folder on the user's own computer, the original records living locally with optional cloud sync"
              />
            </Reveal>
          </div>
        </section>

        {/* ── 11. MISSION ──────────────────────────────────────────────── */}
        <section className="border-y border-[#d8e3f1] bg-[#f4f8fd] px-6 py-20 sm:px-12">
          <Reveal className="mx-auto max-w-[1080px]">
            <Kicker>// why we built this</Kicker>
            <h2 className="mt-2.5 max-w-[26ch] text-3xl font-extrabold leading-[1.1] tracking-tight text-brand-ink md:text-[36px]">
              Accessible and better, not expensive and locked
            </h2>
            <p className="mt-5 max-w-[64ch] text-title leading-relaxed text-[#334155]">
              The tools labs depend on are overpriced and hold your data hostage
              in someone else&apos;s cloud, so we build free, open, local-first
              alternatives that aim to be genuinely better, not just cheaper.
              ResearchOS is an{" "}
              <span className="font-semibold text-brand-ink">
                open-source company
              </span>{" "}
              (AGPLv3) out of a fellowship at UW-Madison, with a real business
              behind it.{" "}
              <a
                href="/about"
                className="font-bold text-brand-action transition-colors hover:text-brand-ink"
              >
                Read the story <span aria-hidden>&rarr;</span>
              </a>
            </p>
            <div className="mt-5 text-body text-[#64748b]">
              Dr. Grant Nickles, founder &middot;{" "}
              <span
                className="font-extrabold"
                style={{
                  background: "linear-gradient(100deg, #2E8B45, #FFB81C)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                Built in Madison
              </span>
              , Wisconsin
            </div>
          </Reveal>
        </section>

        {/* ── 11.5 OPEN ICON LIBRARY (open-science resource, not a feature pitch) ─ */}
        <section className="px-6 py-16 sm:px-12">
          <Reveal className="mx-auto max-w-[1080px]">
            <div className="overflow-hidden rounded-2xl border border-[#e3eaf3] bg-white p-6 shadow-[0_1px_2px_rgba(15,40,80,0.04)] sm:p-8">
              <Kicker>// free for everyone, not just our users</Kicker>
              <h2 className="mt-2.5 max-w-[24ch] text-2xl font-extrabold leading-tight tracking-tight text-brand-ink sm:text-3xl">
                An open icon library for science
              </h2>
              <p className="mt-4 max-w-[64ch] text-title leading-relaxed text-[#475569]">
                Over 14,000 openly-licensed scientific icons and silhouettes (CC0,
                CC-BY, and public domain). Every asset carries its source and
                license, and the credits are added for you. Browse them, drop them
                into your figures, or contribute your own.
              </p>
              <a
                href="/library"
                data-testid="welcome-icon-library"
                className="mt-5 inline-flex min-h-[44px] items-center gap-1.5 text-body font-bold text-brand-action transition-colors hover:text-brand-ink"
              >
                Browse the icon library <span aria-hidden>&rarr;</span>
              </a>
            </div>
          </Reveal>
        </section>

        {/* ── 12. NIH + ZENODO (moved out of the hero) ─────────────────── */}
        <FeatureRow
          kicker="// built for grant-funded labs"
          title="Grant-ready deposits, free"
          body="Records you own, real version history, clean exports, and a one-click Zenodo deposit carrying your ORCID and grant metadata. That covers an NIH Data Management and Sharing Plan, with no enterprise license to buy."
          pills={["Records you own", "Version history", "Zenodo deposit"]}
        >
          <a
            href="/wiki/compliance/nih-data-management"
            data-testid="welcome-hero-nih-compliance"
            className="mt-4 inline-flex items-center gap-1.5 text-body font-bold text-brand-action transition-colors hover:text-brand-ink"
          >
            Read the NIH compliance guide
            <span aria-hidden>&rarr;</span>
          </a>
        </FeatureRow>

        {/* ── 13. TRUST BAND ───────────────────────────────────────────── */}
        <section className="border-t border-[#d8e3f1] bg-[#f4f8fd] px-6 py-16 sm:px-12">
          <div className="mx-auto max-w-[1080px]">
            <Reveal>
              <Kicker>// why you can trust a free tool</Kicker>
              <h2 className="mt-2.5 max-w-[20ch] text-3xl font-extrabold leading-tight tracking-tight text-brand-ink md:text-[34px]">
                Free, but accountable
              </h2>
            </Reveal>
            <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Reveal delay={0}>
                <TrustCard
                  title="Your data is yours"
                  body="Plain files on your disk. Leaving is closing a folder."
                />
              </Reveal>
              <Reveal delay={90}>
                <TrustCard
                  title="Open source"
                  body="AGPLv3, and you can read exactly how it works."
                  href="/open-source"
                />
              </Reveal>
              <Reveal delay={180}>
                <TrustCard
                  title="Validated science"
                  body="Our math is proven in public against Biopython, primer3, R, and Prism."
                  href="/transparency"
                />
              </Reveal>
              <Reveal delay={270}>
                <TrustCard
                  title="Real business"
                  body="A Wisconsin LLC and merchant of record, not a hobby link."
                />
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── 13.5 FOR DEPARTMENTS & INSTITUTIONS (standalone admin portals) ─
            A quiet band for the org-admin audience. Each card links into its
            own standalone, sign-in-gated portal (PortalShell), no folder or
            install needed. Gated on the tier flags so it stays dark in prod
            exactly like the rest of the org tier. */}
        {(DEPT_TIER_ENABLED || INSTITUTION_TIER_ENABLED) && (
          <section className="border-t border-[#d8e3f1] bg-[#f7faff] px-6 py-16 sm:px-12">
            <Reveal className="mx-auto max-w-[920px] text-center">
              <div
                aria-hidden
                className="brand-rainbow-bg mx-auto mb-5 h-1 w-14 rounded-full"
              />
              <h2 className="text-3xl font-extrabold tracking-tight text-brand-ink">
                For departments &amp; institutions
              </h2>
              <p className="mx-auto mt-3 max-w-[58ch] text-title leading-relaxed text-[#475569]">
                Sponsor your labs on one invoice. The admin portals manage your
                plan, roster, and billing right in the browser, no folder to
                connect and nothing to install.
              </p>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {DEPT_TIER_ENABLED && (
                  <a
                    href="/department"
                    className="flex flex-col gap-1 rounded-2xl border border-[#cfdcec] bg-white p-5 text-left shadow-[0_2px_12px_rgba(15,40,80,0.06)] transition-transform hover:scale-[1.02]"
                  >
                    <span className="flex items-center gap-2 text-title font-extrabold text-brand-ink">
                      Department admin <span aria-hidden className="text-brand-action">&rarr;</span>
                    </span>
                    <span className="text-body text-[#475569]">
                      Sponsor your labs on one invoice. Plan, roster, and billing
                      in one portal.
                    </span>
                  </a>
                )}
                {INSTITUTION_TIER_ENABLED && (
                  <a
                    href="/institution"
                    className="flex flex-col gap-1 rounded-2xl border border-[#cfdcec] bg-white p-5 text-left shadow-[0_2px_12px_rgba(15,40,80,0.06)] transition-transform hover:scale-[1.02]"
                  >
                    <span className="flex items-center gap-2 text-title font-extrabold text-brand-ink">
                      Institution admin <span aria-hidden className="text-brand-action">&rarr;</span>
                    </span>
                    <span className="text-body text-[#475569]">
                      One tier up. Cover your departments and roll up usage and
                      cost.
                    </span>
                  </a>
                )}
              </div>
            </Reveal>
          </section>
        )}

        {/* ── 14. FINAL CTA ────────────────────────────────────────────── */}
        <section className="border-t border-[#d8e3f1] bg-white px-6 py-20 text-center sm:px-12">
          <Reveal className="mx-auto flex max-w-2xl flex-col items-center">
            {/* Rainbow rule at the CTA. */}
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
            <h2 className="mt-4 max-w-[18ch] text-3xl font-extrabold leading-[1.08] tracking-tight text-brand-ink md:text-4xl">
              Start your notebook in a minute
            </h2>
            <p className="mt-4 max-w-[50ch] text-title leading-relaxed text-[#475569]">
              {isRequireAccountEnabled()
                ? "Sign in once with a free account, then connect a folder and you are writing. Your data still lives on your own machine and the app works fully offline."
                : "No sign-up to begin. Connect a folder and you are writing. Sign in only when you want to share with your lab."}
            </p>
            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button
                type="button"
                onClick={goGetStarted}
                data-testid="welcome-cta-get-started"
                className="btn-brand px-6 py-3 text-body"
              >
                Start your notebook
              </button>
              <a
                href="/demo"
                data-testid="welcome-cta-demo"
                className="inline-flex items-center gap-2 rounded-xl border border-[#cfdcec] bg-white px-6 py-3 text-body font-semibold text-brand-action shadow-[0_2px_12px_rgba(15,40,80,0.06)] transition-transform hover:scale-[1.02]"
              >
                Explore the live demo
                <span aria-hidden>&rarr;</span>
              </a>
            </div>
            {/* Pricing handoff, the mockup's CTA footnote. */}
            <div className="mt-6 flex flex-col items-center gap-3">
              <p className="text-meta text-[#94a3b8]">
                The local app is free and open source. It grew out of a
                UW-Madison Distinguished Research Fellowship. Curious how the
                cloud services are priced?{" "}
                <a
                  href="/pricing"
                  className="font-semibold text-brand-action hover:text-brand-ink"
                >
                  See the pricing <span aria-hidden>&rarr;</span>
                </a>
              </p>
            </div>
          </Reveal>
        </section>

        {/* ── Site-wide sponsors (renders nothing until a real Lab or
            Institute sponsor exists) ──────────────────────────────────── */}
        <SponsorStrip variant="welcome" />

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <MarketingFooter />
      </div>

    </div>
  );
}
