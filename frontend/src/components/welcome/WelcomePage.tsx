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
 * (EntrySnapSurface embeds WelcomePage one scroll down), so there are NO sign-in
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
import Reveal from "@/components/marketing/Reveal";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import Kicker from "@/components/marketing/Kicker";
import RainbowFrame from "@/components/marketing/RainbowFrame";
import FeatureRow from "@/components/marketing/FeatureRow";
import RoadmapModal from "@/components/RoadmapModal";
import { markLandingSeen } from "@/lib/landing/landing-gate";

/** The rainbow ramps, pulled from the brand tokens in globals.css so the
 *  welcome page never drifts from the footer / avatars / banner. RAINBOW is the
 *  pastel fill used for the ribbon and the demo-frame borders; RAINBOW_TEXT is
 *  the saturated ramp clipped into the gradient headline word (the pastel washes
 *  out as type on white). */
const RAINBOW = "var(--brand-rainbow)";
const RAINBOW_TEXT = "var(--brand-rainbow-vivid)";

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
 * The mentorship-tree + IDP illustration for the check-ins feature row. A lab
 * tree (PI -> postdoc/grad -> undergrads) plus an IDP snapshot, framing the
 * feature as the academic mentorship structure, not generic 1:1s. Built from
 * plain divs with scoped styled-jsx connectors (no inline SVG, which the icon
 * guard blocks): a lone mentee gets a straight drop, two or more get a centered
 * bus. Light-only, matching the rest of the page.
 * -------------------------------------------------------------------------- */
function CheckinsVisual() {
  return (
    <div className="ros-mtree bg-white p-[18px]">
      <span className="tag">Check-ins and mentoring</span>
      <div className="tree">
        <div className="node pi">Dr. Nickles, PI</div>
        <div className="trunk" />
        <div className="children cols-3">
          <div className="child">
            <div className="subtree">
              <div className="node">Postdoc, Ana</div>
              <div className="trunk" />
              <div className="children cols-2">
                <div className="child">
                  <div className="node sm">Undergrad</div>
                </div>
                <div className="child">
                  <div className="node sm">Undergrad</div>
                </div>
              </div>
            </div>
          </div>
          <div className="child">
            <div className="subtree">
              <div className="node">Grad, Mateo</div>
              <div className="trunk" />
              <div className="children cols-1">
                <div className="child">
                  <div className="node sm">Undergrad</div>
                </div>
              </div>
            </div>
          </div>
          <div className="child">
            <div className="node">Grad, Wei</div>
          </div>
        </div>
      </div>
      <div className="idp">
        <div className="idp-h">Mateo, IDP, year 3</div>
        <div className="meter">
          <span className="brand-rainbow-bg" />
        </div>
        <div className="idp-sub">
          Career goals private, skills shared with the PI. Next check-in Friday,
          agenda carried forward.
        </div>
      </div>
      <style jsx>{`
        .tag {
          font-family: ui-monospace, Menlo, monospace;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #64748b;
        }
        .tree {
          margin-top: 12px;
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
        }
        .node {
          border: 1px solid #dbe6f3;
          background: #fbfcfe;
          border-radius: 10px;
          padding: 7px 12px;
          font-size: 12.5px;
          font-weight: 700;
          color: #0f2350;
        }
        .node.pi {
          background: linear-gradient(90deg, #3b8bff22, #a06bff22);
          border-color: #3b8bff55;
        }
        .node.sm {
          font-size: 11px;
          padding: 5px 9px;
          font-weight: 600;
          color: #64748b;
        }
        .trunk {
          width: 2px;
          height: 16px;
          background: #dbe6f3;
        }
        /* equal columns so each child is centered under its parent trunk;
           align-items:start so a childless node (Wei) stays at its own tier. */
        .children {
          display: grid;
          gap: 12px;
          width: 100%;
          align-items: start;
        }
        .cols-1 {
          grid-template-columns: 1fr;
        }
        .cols-2 {
          grid-template-columns: repeat(2, 1fr);
        }
        .cols-3 {
          grid-template-columns: repeat(3, 1fr);
        }
        .child {
          position: relative;
          padding-top: 16px;
          display: flex;
          justify-content: center;
        }
        /* translateX(-50%) centers the 2px drop exactly on 50% so it is colinear
           with the flex-centered trunk (one straight line, not stitched). */
        .child::before {
          content: "";
          position: absolute;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 2px;
          height: 16px;
          background: #dbe6f3;
        }
        .child::after {
          content: "";
          position: absolute;
          top: 0;
          height: 2px;
          background: #dbe6f3;
        }
        .child:first-child::after {
          left: 50%;
          right: -6px;
        }
        .child:last-child::after {
          left: -6px;
          right: 50%;
        }
        .child:not(:first-child):not(:last-child)::after {
          left: -6px;
          right: -6px;
        }
        /* a lone child has no siblings, so no bus, just the drop. Specificity
           must beat .child:last-child::after, hence .children.cols-1. */
        .children.cols-1 .child::after {
          display: none;
        }
        .subtree {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
        }
        .idp {
          margin-top: 14px;
          border: 1px solid #dbe6f3;
          border-radius: 10px;
          padding: 11px 13px;
          background: #fbfcfe;
        }
        .idp-h {
          font-size: 12.5px;
          font-weight: 800;
          color: #0f2350;
        }
        .meter {
          height: 7px;
          border-radius: 99px;
          background: #dbe6f3;
          margin-top: 7px;
          overflow: hidden;
        }
        .meter span {
          display: block;
          height: 100%;
          width: 62%;
        }
        .idp-sub {
          font-size: 11px;
          color: #64748b;
          margin-top: 6px;
          line-height: 1.5;
        }
      `}</style>
    </div>
  );
}

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

  // Roadmap modal state.
  const [roadmapOpen, setRoadmapOpen] = useState(false);

  // "Get started" routes UP to the connect chooser, which now lives ABOVE this
  // page. When this component is embedded in EntrySnapSurface, the chooser is
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
    // EntrySnapSurface snap container). If found, this page is embedded one
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

  /** The "What we're building" roadmap chip, used in the nav and standalone. */
  const RoadmapChip = ({ className }: { className?: string }) => (
    <button
      type="button"
      onClick={() => setRoadmapOpen(true)}
      className={`inline-flex items-center gap-1.5 rounded-full border border-[#d3deec] bg-white px-3 py-1 text-meta font-semibold text-brand-ink transition-colors hover:bg-[#eef4fb] hover:border-[#c5d6ea] ${className ?? ""}`}
    >
      {/* 4-point asterisk / spark icon */}
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden
      >
        <line x1="8" y1="2" x2="8" y2="14" />
        <line x1="2" y1="8" x2="14" y2="8" />
        <line x1="3.5" y1="3.5" x2="12.5" y2="12.5" />
        <line x1="12.5" y1="3.5" x2="3.5" y2="12.5" />
      </svg>
      What we&apos;re building
    </button>
  );

  return (
    <div
      ref={rootRef}
      className="min-h-screen w-full overflow-x-hidden bg-[#fbfcfe] text-brand-ink"
    >
      {/* Thick rainbow ribbon pinned to the very top edge. */}
      <div aria-hidden className="h-2 w-full" style={{ background: RAINBOW }} />

      {/* Desktop-required notice (unsupported device / browser). The page below
          is fully readable; this explains why the entry buttons do not start the
          app here, and points to the requirements guide. */}
      {unsupported && (
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
              <RoadmapChip />
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
            <CostTable />
            <Reveal>
              <p className="mt-5 max-w-[68ch] border-t border-dashed border-[#dbe6f3] pt-4 text-body leading-relaxed text-[#64748b]">
                Free to use, with every feature included. The only thing that
                ever costs money is optional cloud storage, and we charge what it
                costs us.{" "}
                <a
                  href="/pricing"
                  className="font-bold text-brand-action transition-colors hover:text-brand-ink"
                >
                  See exactly how it is priced <span aria-hidden>&rarr;</span>
                </a>
              </p>
            </Reveal>
          </div>
        </section>

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
              LabArchives is a common cloud notebook, SnapGene is the sequence
              tool a lot of labs also pay for, and Quartzy is where many order
              reagents. ResearchOS folds the notebook, the sequence tool, and the
              inventory tool into one place. Here is the honest four-way.
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
            <div className="mx-auto max-w-[1320px] overflow-hidden rounded-2xl border border-[#e3eaf3] bg-white shadow-[0_1px_2px_rgba(15,40,80,0.04)]">
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
                    <ComparisonRow
                      label="Sequence editing and cloning"
                      us={{ mark: "have", text: "Import, edit, annotate, find sites, in-silico cloning" }}
                      labarchives={{ mark: "none", text: "No native sequence editor" }}
                      snapgene={{ mark: "win", text: "The deepest editor and visualization here" }}
                      quartzy={{ mark: "none", text: "No sequence tools" }}
                    />
                    <ComparisonRow
                      label="Inventory and ordering"
                      us={{ mark: "have", text: "Track supplies and purchases inside the notebook" }}
                      labarchives={{ mark: "none", text: "No native ordering" }}
                      snapgene={{ mark: "none", text: "No inventory or ordering" }}
                      quartzy={{ mark: "win", text: "The biggest vendor catalog and ordering workflow" }}
                    />
                    <ComparisonRow
                      label="Live collaboration"
                      us={{ mark: "win", text: "Real-time co-editing on shared notes" }}
                      labarchives={{ mark: "have", text: "Shared cloud notebook" }}
                      snapgene={{ mark: "none", text: "Single-user desktop tool" }}
                      quartzy={{ mark: "have", text: "Shared lab ordering workspace" }}
                    />
                    <ComparisonRow
                      label="Per-entry version history"
                      us={{ mark: "win", text: "Full history with one-click restore, built in" }}
                      labarchives={{ mark: "have", text: "Full revision history on every entry" }}
                      snapgene={{ mark: "none", text: "Per-file saves, no notebook history" }}
                      quartzy={{ mark: "none", text: "Order logs, not record history" }}
                    />
                  </tbody>
                </table>
              </div>
            </div>
          </BeakerBotPeek>

          <p className="mx-auto mt-6 max-w-[64ch] text-center text-body leading-relaxed text-[#64748b]">
            SnapGene genuinely goes deeper on cloning, Quartzy has the bigger
            vendor catalog, and SciFinder and Reaxys go deeper on curated
            reaction databases. The chemistry workbench covers what most labs
            actually open SciFinder for, searching the literature and patents by
            structure, including substructure search across 28 million patents,
            free. ResearchOS wins by folding the notebook, the sequence tool,
            chemistry, and inventory into one free suite with your data on your
            own disk. Two-way Quartzy sync is on the roadmap, so you can keep the
            ordering tools your lab already uses.
          </p>
        </section>

        {/* ── 3. CHEMISTRY WORKBENCH ──────────────────────────────────── */}
        <FeatureRow
          tint
          kicker="// no ChemDraw or SciFinder license"
          title="Draw and search chemistry, built in"
          body="Draw a structure like you would in ChemDraw, pull the compound straight from PubChem, then search the literature and patents by structure, a free stab at what most labs open SciFinder for. Drop any of it into your experiment note. The tools labs pay a fortune for, free."
          pills={["Structure editor", "PubChem import", "Literature and patent search"]}
          visual={
            <RainbowFrame>
              <DemoLoop
                src="https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/chemistry-gliotoxin.mp4"
                poster="https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/chemistry-gliotoxin.poster.jpg"
                label="Importing gliotoxin from PubChem and searching the literature and patents by structure in the ResearchOS chemistry workbench"
                preload="metadata"
              />
            </RainbowFrame>
          }
        />

        {/* ── 4. DATA HUB ──────────────────────────────────────────────── */}
        <FeatureRow
          flip
          kicker="// no Prism license"
          title="Run the stats and make the figure"
          body="Paste your data, run the test, make a publication-ready plot. Every statistic is validated in public against scipy, R, and Prism, so you can trust the number you cite."
          pills={["Validated tests", "Publication figures", "No black box"]}
          visual={
            <RainbowFrame>
              <DemoLoop
                src="https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/data-hub.mp4"
                poster="https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/data-hub.poster.jpg"
                label="Running a validated t-test, reading the plain-language verdict, and styling a publication-ready bar plot in the ResearchOS Data Hub"
                preload="metadata"
              />
            </RainbowFrame>
          }
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
              <div className="grid gap-4">
                <RainbowFrame>
                  <DemoLoop
                    src="https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/sequence-editor-a.mp4"
                    poster="https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/sequence-editor-a.poster.jpg"
                    label="A circular plasmid map rendering in the ResearchOS sequence editor, with annotated feature arcs, then a Gibson assembly designing its own junction primers"
                    preload="metadata"
                  />
                </RainbowFrame>
                <RainbowFrame>
                  <DemoLoop
                    src="https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/sequence-ncbi.mp4"
                    poster="https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/sequence-ncbi.poster.jpg"
                    label="The guided NCBI import wizard finding a gene in a reference genome by name and importing a windowed sequence into the ResearchOS library"
                    preload="metadata"
                  />
                </RainbowFrame>
              </div>
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
          visual={
            <RainbowFrame>
              <DemoLoop
                src="https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/purchases.mp4"
                poster="https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/purchases.poster.jpg"
                label="Filtering lab orders by stage and category, expanding line items, and the spending dashboard in ResearchOS purchases"
                preload="metadata"
              />
            </RainbowFrame>
          }
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
            <RainbowFrame>
              <CheckinsVisual />
            </RainbowFrame>
          }
        />

        {/* ── 7. COMPANION APP SPOTLIGHT (dark band) ───────────────────── */}
        <section
          className="px-6 py-20 text-[#eaf2fb] sm:px-12"
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
                Most of research happens standing at a bench, not sitting at a
                desk. The companion app on your phone is the bench end of your
                notebook, so the messy steps flow straight into the experiment
                on your computer. Nothing to retype later.
              </p>
            </Reveal>

            <div className="mt-9 grid items-center gap-9 md:grid-cols-[0.78fr_1.22fr]">
              {/* CSS phone frame holding a play-glyph placeholder. Leads the
                  cascade, then the four capability cards follow it in. */}
              <Reveal className="justify-self-center" delay={0}>
                <div className="relative aspect-[9/19] w-[196px] overflow-hidden rounded-[30px] border-8 border-[#060d1c] bg-[#0d1424] shadow-[0_20px_54px_rgba(0,0,0,0.55)]">
                  <span
                    aria-hidden
                    className="absolute left-1/2 top-2.5 z-[2] h-1.5 w-[52px] -translate-x-1/2 rounded-full bg-[#060d1c]"
                  />
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center text-meta font-semibold text-[#8fb7d9]">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.12]">
                      <svg
                        width="22"
                        height="22"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="text-[#cfe6fb]"
                        aria-hidden
                      >
                        <path d="M9 7l9 5-9 5V7Z" />
                      </svg>
                    </span>
                    Companion app demo
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
          </div>
        </section>

        {/* ── 8. AI ASSISTANT (the metered BeakerBot story) ────────────── */}
        <FeatureRow
          flip
          kicker="// your data, your AI"
          title="Meet BeakerBot, your AI over your own research"
          body="Point BeakerBot at the data you own and ask a plain-English question across your notes and results. It runs the analysis, makes the plot, and writes it up, always with your approval. Your data, your assistant, not a vendor mining your work."
          pills={["Natural language", "Over your own data", "You stay in control"]}
          visual={
            <BeakerBotPeek
              anchor="top-right"
              reactionPose="cheering"
              restPose="idle"
              bubble="on it!"
              size="h-20 w-20"
            >
              <RainbowFrame>
                <DemoLoopPlaceholder
                  claim="Type a plain-English question like show my PCR runs that failed last month, and the answer pulls straight from your own notes."
                  tag="AI assistant"
                />
              </RainbowFrame>
            </BeakerBotPeek>
          }
        >
          {/* The free-token gift, made the headline hook of this section. */}
          <div className="mt-5 rounded-2xl border border-[#cfe0f3] bg-[#eef5fd] px-5 py-4">
            <div className="text-xl font-extrabold tracking-tight text-brand-ink">
              Start with about 750,000 free tokens
            </div>
            <p className="mt-1 text-body font-semibold text-[#475569]">
              a one-time sign-up gift, about 20 to 25 full analyses or over 100
              quick questions, no card needed
            </p>
          </div>
          <p className="mt-4 max-w-[54ch] text-body leading-relaxed text-[#475569]">
            BeakerBot is the one optional metered feature, priced near cost
            because your data stays on your own machine instead of on our
            servers. After the free tokens you buy a prepaid top-up, and since a
            full analysis is about a penny of compute, it stays cheap. A lab or
            institution can cover a shared pool so members never see a bill, and
            during the beta it is free.{" "}
            <a
              href="/pricing"
              className="font-bold text-brand-action transition-colors hover:text-brand-ink"
            >
              See how the tokens are priced <span aria-hidden>&rarr;</span>
            </a>{" "}
            <a
              href="/ai"
              className="font-bold text-brand-action transition-colors hover:text-brand-ink"
            >
              See everything BeakerBot can do <span aria-hidden>&rarr;</span>
            </a>
          </p>
        </FeatureRow>

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
                  body="Turn on optional cloud to sync, share, or co-edit. Nothing uploads until you do."
                />
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── 11. MISSION ──────────────────────────────────────────────── */}
        <section className="border-y border-[#d8e3f1] bg-[#f4f8fd] px-6 py-20 sm:px-12">
          <Reveal className="mx-auto max-w-[1080px]">
            <Kicker>// why we built this</Kicker>
            <h2 className="mt-2.5 max-w-[26ch] text-3xl font-extrabold leading-[1.1] tracking-tight text-brand-ink md:text-[36px]">
              Research software should be accessible and better, not expensive and
              locked
            </h2>
            <p className="mt-5 max-w-[64ch] text-title leading-relaxed text-[#334155]">
              ResearchOS is an{" "}
              <span className="font-semibold text-brand-ink">
                open-source company
              </span>{" "}
              (AGPLv3) that grew out of a research fellowship at UW-Madison. The
              tools labs depend on are overpriced, and they hold your data
              hostage in someone else&apos;s cloud. We build free, open,
              local-first alternatives, and the goal is not just cheaper, it is{" "}
              <span className="font-semibold text-brand-ink">better</span>. You
              own your data, the science is validated in public, and a real,
              accountable business stands behind it. Good research tooling should
              be a public good, inspectable, ownable, and free.
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

        {/* ── 12. NIH + ZENODO (moved out of the hero) ─────────────────── */}
        <FeatureRow
          kicker="// built for grant-funded labs"
          title="Grant-ready deposits, free"
          body="Records you own, real version history, clean exports, and a one-click Zenodo deposit carrying your ORCID and grant metadata. That covers an NIH Data Management and Sharing Plan, with no enterprise license to buy."
          pills={["Records you own", "Version history", "Zenodo deposit"]}
          visual={
            <RainbowFrame>
              <DemoLoop
                src="https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/nih-zenodo.mp4"
                poster="https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/nih-zenodo.poster.jpg"
                label="Building a grant-ready Zenodo deposit with ORCID and grant metadata"
              />
            </RainbowFrame>
          }
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
              No sign-up to begin. Connect a folder and you are writing. Sign in
              only when you want to share with your lab.
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
            {/* Roadmap chip + pricing handoff, the mockup's CTA footnote. */}
            <div className="mt-6 flex flex-col items-center gap-3">
              <RoadmapChip />
              <p className="text-meta text-[#94a3b8]">
                Free and open, funded by a UW Distinguished Research Fellowship
                and donations. Curious how the optional cloud is priced?{" "}
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

      {/* Roadmap modal */}
      <RoadmapModal open={roadmapOpen} onClose={() => setRoadmapOpen(false)} />
    </div>
  );
}
