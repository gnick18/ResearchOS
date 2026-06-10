"use client";

/**
 * The `/welcome` page: video-driven sell page (2026-06-10 bold-rainbow rebuild).
 *
 * This is the reimagined welcome / sell page. It is LIGHT-themed (Grant's rule,
 * wrapped in LightOnly); the dark variant in the review mockup
 * (docs/mockups/welcome-redesign-2026-06-10.html) is for review only and never
 * ships. The aesthetic is clean white and pale-blue panels with a BOLD rainbow
 * brand treatment: a thicker rainbow top bar, rainbow-gradient frames around the
 * demo windows, and short rainbow rule lines under the section kickers and at
 * the CTA. The rainbow comes from the brand tokens in globals.css
 * (--brand-rainbow / .brand-rainbow-bg / .brand-rainbow-text) so the page paints
 * the exact same ramps as the footer, the avatars, and the banner.
 *
 * Structure (mockup direction):
 *   1. Hero: product headline + NIH Data Management and Sharing Plan compliance
 *      as the CENTERPIECE card (the urgent broad hook for funded labs). The big
 *      hero demo loop is gone; the real loops moved down into the feature
 *      sections.
 *   2. Flagship sequence editor, credibility pillars, the toolkit bento grid.
 *   3. NEW "Start solo, grow into a lab, or split back out" section telling the
 *      shipped 3-tier account story (local / free account / lab) plus
 *      migrate-to-solo (one folder per person, recoverable, never locked in).
 *   4. Own-your-data block, the tree-of-life explorer, a secondary-loops band,
 *      the honest comparison table (now with a Quartzy column), and a final CTA.
 *
 * Sign-in / open-folder live in the connect chooser ABOVE this page now
 * (EntrySnapSurface embeds WelcomePage one scroll down), so there are NO sign-in
 * cards on this sales page. Every "get started" CTA routes UP to that chooser:
 * embedded, it scrolls the snap container back to the top; standalone (/welcome)
 * it links to "/". The free / no-sign-up / sign-in-only-for-sharing message
 * stays as plain copy.
 *
 * Voice rules: no em-dashes, no emojis (every glyph is an inline SVG kept within
 * the icon-guard baseline), no mid-sentence colons. Warm, concept-first,
 * contractions OK. BeakerBot is the only mascot and renders via the real
 * <BeakerBot alive /> component (blue eyes, sky-blue stroke, rainbow liquid).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import BeakerBot from "@/components/BeakerBot";
import SponsorStrip from "@/components/SponsorStrip";
import BeakerBotPeek from "@/components/welcome/BeakerBotPeek";
import Wordmark from "@/components/Wordmark";
import DemoLoop, { DemoLoopPlaceholder } from "@/components/welcome/DemoLoop";
import { usePreloadOnIdle } from "@/lib/perf/use-preload-on-idle";
import RoadmapModal from "@/components/RoadmapModal";
import { markLandingSeen } from "@/lib/landing/landing-gate";

/** The rainbow ramps, pulled from the brand tokens in globals.css so the
 *  welcome page never drifts from the footer / avatars / banner. RAINBOW is the
 *  pastel fill used for the ribbon, the soft bloom, and the demo-frame borders;
 *  RAINBOW_TEXT is the saturated ramp clipped into the gradient headline word
 *  (the pastel washes out as type on white). */
const RAINBOW = "var(--brand-rainbow)";
const RAINBOW_TEXT = "var(--brand-rainbow-vivid)";

/* ----------------------------------------------------------------------------
 * The offline tree-of-life explorer, code-split. It is a heavy d3 client
 * component, so we load it on its own chunk with ssr off (it draws to a DOM ref
 * and has no server render). The showcase below only mounts it once its section
 * scrolls into view, so the page's initial load never pulls the chunk or fires
 * the backbone fetch.
 * -------------------------------------------------------------------------- */
const TaxonomyTreeView = dynamic(
  () => import("@/components/sequences/TaxonomyTreeView"),
  { ssr: false },
);

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

/** Section eyebrow kicker in the page's monospace accent style, with a short
 *  rainbow rule before the label (the bold-rainbow brand-up: every section
 *  kicker carries the brand ramp as a quiet ornament). */
function Kicker({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="brand-rainbow-bg h-[3px] w-6 flex-none rounded-full"
      />
      <span className="font-mono text-meta font-semibold uppercase tracking-[0.12em] text-brand-action">
        {children}
      </span>
    </div>
  );
}

/** A rainbow-gradient frame around a demo window. The mockup's bold-rainbow
 *  treatment wraps the browser/demo chrome in a thin brand-ramp border by
 *  painting the rainbow as the padded background behind a white inner card.
 *  Children render inside the inner card. */
function RainbowFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`brand-rainbow-bg rounded-[20px] p-[3px] shadow-[0_24px_60px_rgba(15,40,80,0.12)] ${className ?? ""}`}
    >
      <div className="overflow-hidden rounded-[17px] bg-white">{children}</div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * The "Explore the tree of life" showcase. A dedicated full-width section with
 * the real radial explorer running INLINE in its offline embed (no NCBI calls,
 * no login). The tree only mounts once the section scrolls into view, so the
 * page's initial load never pulls the d3 chunk or fires the backbone fetch.
 * Until then the card holds a calm placeholder. Once interacting, the wheel
 * zooms the tree inside its box; the page still scrolls around the card.
 * -------------------------------------------------------------------------- */
function TreeOfLifeShowcase() {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    // SSR / very old browsers without IntersectionObserver: mount eagerly so the
    // showcase is never blank. The fetch is async and non-blocking either way.
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      // Start loading a little before the card is fully on screen, so the tree
      // is ready by the time the user reaches it.
      { rootMargin: "200px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="border-y border-[#dce6f3] bg-[#f4f8fd] px-6 py-20 sm:px-12">
      <div className="mx-auto max-w-[1180px]">
        <Kicker>// browse all of life</Kicker>
        <h2 className="mt-2.5 max-w-[20ch] text-3xl font-extrabold leading-tight tracking-tight text-brand-ink md:text-[36px]">
          Explore the tree of life
        </h2>
        <p className="mt-3 max-w-[58ch] text-title leading-relaxed text-[#475569]">
          Spin through the diversity of life right here. Click a branch to dive
          in, click the center to step back, and scroll to zoom. It runs on a
          bundled backbone, so it works offline with no account.
        </p>

        {/* The interactive canvas, wrapped in the rainbow frame so it matches
            the bold-rainbow demo windows. A rounded bordered card, full section
            width, tall on desktop and a touch shorter on mobile. */}
        <RainbowFrame className="mt-8">
          <div
            ref={sectionRef}
            data-testid="welcome-tree-of-life"
            className="h-[26rem] w-full overflow-hidden bg-white sm:h-[30rem]"
          >
            {inView ? (
              <TaxonomyTreeView open embedded />
            ) : (
              <div
                data-testid="welcome-tree-of-life-placeholder"
                className="flex h-full w-full items-center justify-center bg-[#f5f9fd] text-meta text-[#64748b]"
              >
                Loading the tree of life...
              </div>
            )}
          </div>
        </RainbowFrame>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------------------
 * Comparison table, carried from LandingPage and restyled to the light
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

/* ========================================================================== */

export default function WelcomePage() {
  const router = useRouter();

  // Warm the heavy d3 tree-of-life chunk on idle; it is the hero interaction on
  // this page, so it should be ready before the visitor scrolls to it.
  usePreloadOnIdle(() => import("@/components/sequences/TaxonomyTreeView"));

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

  return (
    <div
      ref={rootRef}
      className="min-h-screen w-full overflow-x-hidden bg-[#fbfcfe] text-brand-ink"
    >
      {/* Thick rainbow ribbon pinned to the very top edge (bold-rainbow up from
          the old 5px ribbon to an 8px band). */}
      <div aria-hidden className="h-2 w-full" style={{ background: RAINBOW }} />

      {/* No max-width here: section backgrounds (the pale-blue bands, the hero
          gradient) must go full-bleed to the screen edges at any width. Each
          section keeps its OWN inner max-width content wrapper, and the nav gets
          the page cap below, so content stays centered without the bands ending
          mid-screen on wide monitors. */}
      <div className="relative">
        {/* ── Nav ─────────────────────────────────────────────────────── */}
        <nav className="relative z-10 mx-auto flex w-full max-w-[1440px] items-center justify-between px-6 py-5 sm:px-12">
          <Wordmark size="md" animated={false} className="gap-2.5" />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setRoadmapOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#d3deec] bg-white px-3 py-1 text-meta font-semibold text-brand-ink transition-colors hover:bg-[#eef4fb] hover:border-[#c5d6ea]"
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
            {/* Get started: routes up to the connect chooser (embedded) or home
                (standalone). The brand-gradient primary action. */}
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

        {/* ── Hero ────────────────────────────────────────────────────── */}
        {/* Its own subtle band (white to pale blue) with a bottom edge, so the
            hero reads as a distinct chunk and does not bleed into the content
            below. The big hero demo loop is gone; the NIH compliance card is the
            centerpiece under the headline. */}
        <header className="relative isolate bg-gradient-to-b from-white to-[#eef4fb] px-6 pb-12 pt-2 text-center sm:px-12">
          {/* Soft rainbow radial bloom behind BeakerBot. */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-[-120px] -z-10 h-[640px] w-[1000px] max-w-[120vw] -translate-x-1/2 rounded-full opacity-[0.42] blur-[80px]"
            style={{
              background:
                "radial-gradient(closest-side, #A6D2F4 0%, #B7EBB1 32%, #FFF1A8 56%, #FFD2B0 74%, rgba(255,255,255,0) 100%)",
            }}
          />

          <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center">
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

            <p className="mt-5 max-w-[56ch] text-title leading-relaxed text-[#475569] md:text-title">
              Plan experiments, run real protocols, design plasmids, and write it
              all up in one workspace. Free to use, and everything you write
              stays on your own machine.
            </p>

            {/* Primary CTAs. No sign-in cards here: those live in the chooser
                above. "Start your notebook" routes up to it; "See it in action"
                jumps to the toolkit section below. */}
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
                href="#toolkit"
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

            {/* Hero centerpiece: NIH Data Management and Sharing Plan
                compliance, the urgent broad hook for funded labs (Grant
                2026-06-10). A rainbow-framed card so it carries the bold-rainbow
                treatment as the page's first focal point. */}
            <div className="mt-9 w-full max-w-[780px]">
              <RainbowFrame>
                <div className="px-6 py-6 text-left sm:px-8">
                  <div className="font-mono text-meta font-semibold uppercase tracking-[0.08em] text-brand-action">
                    Built for grant-funded labs
                  </div>
                  <h2 className="mt-2 text-heading font-extrabold tracking-tight text-brand-ink md:text-2xl">
                    Supports your NIH Data Management and Sharing Plan
                  </h2>
                  <p className="mt-2 text-body leading-relaxed text-[#475569]">
                    Records you own, with real version history, clean structured
                    exports, and one-click Zenodo deposit carrying your ORCID and
                    grant metadata. That covers an NIH Data Management and Sharing
                    Plan, free, with no enterprise license to buy.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2.5">
                    {[
                      "Records you own",
                      "Version history",
                      "Zenodo deposit",
                      "No enterprise markup",
                    ].map((t) => (
                      <span
                        key={t}
                        className="flex items-center gap-1.5 text-body font-semibold text-brand-ink"
                      >
                        <CheckGlyph />
                        {t}
                      </span>
                    ))}
                  </div>
                  <a
                    href="/wiki/compliance/nih-data-management"
                    data-testid="welcome-hero-nih-compliance"
                    className="mt-4 inline-flex items-center gap-1.5 text-body font-bold text-brand-action transition-colors hover:text-brand-ink"
                  >
                    Read the NIH compliance guide
                    <span aria-hidden>→</span>
                  </a>
                </div>
              </RainbowFrame>
            </div>
          </div>
        </header>

        {/* ── Flagship showcase ─────────────────────────────────────────
            A tinted band that pairs the flagship cloning loop with real
            explanatory copy, so the first thing under the hero is substance.
            The demo window is rainbow-framed. */}
        <section className="border-y border-[#dbe6f3] bg-gradient-to-b from-[#eef4fb] to-[#f5f9fd] px-6 pb-20 pt-16 sm:px-12">
          <div className="mx-auto grid max-w-[1180px] items-center gap-12 md:grid-cols-[0.92fr_1.08fr]">
            <div>
              <Kicker>// the flagship</Kicker>
              <h2 className="mt-3 max-w-[18ch] text-3xl font-extrabold leading-[1.1] tracking-tight text-brand-ink md:text-[38px]">
                Design plasmids and run cloning, built in
              </h2>
              <p className="mt-4 max-w-[52ch] text-title leading-relaxed text-[#475569]">
                A SnapGene-style sequence editor lives right inside your
                notebook. Open a plasmid and its circular map renders with
                annotated features and restriction sites. Run Gibson, Golden
                Gate, or restriction cloning and it designs the primers for you.
                Free, with no separate tool to license.
              </p>
              <ul className="mt-6 grid gap-3">
                <li className="flex items-start gap-2.5 text-body leading-snug text-[#0f1b2e]">
                  <CheckGlyph />
                  Annotated circular and linear maps, with feature and enzyme
                  tracks.
                </li>
                <li className="flex items-start gap-2.5 text-body leading-snug text-[#0f1b2e]">
                  <CheckGlyph />
                  Gibson, Golden Gate, Gateway, and restriction cloning in
                  silico.
                </li>
                <li className="flex items-start gap-2.5 text-body leading-snug text-[#0f1b2e]">
                  <CheckGlyph />
                  Auto-designed junction primers with a copyable oligo order.
                </li>
              </ul>
            </div>
            {/* BeakerBot peeks over the top-right of the demo frame and watches
                the cloning animation, amazed, then settles into a living idle.
                The DemoLoop is already framed (browser chrome), and the chrome
                already carries a thin rainbow-adjacent treatment via the
                ChromeFrame; we wrap it once more in the RainbowFrame for the
                bold-rainbow border the mockup shows. */}
            <BeakerBotPeek
              anchor="top-right"
              reactionPose="amazed"
              bubble="whoa!"
              size="h-24 w-24"
            >
              <RainbowFrame>
                <DemoLoop
                  src="https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/sequence-editor-a.mp4"
                  poster="https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/sequence-editor-a.poster.jpg"
                  label="A circular plasmid map rendering in the ResearchOS sequence editor, with annotated feature arcs"
                  preload="metadata"
                />
              </RainbowFrame>
            </BeakerBotPeek>
          </div>
        </section>

        {/* ── Credibility pillars ─────────────────────────────────────────
            Four concrete, verifiable trust signals. The transparency and
            open-source pillars link out so the claims are checkable, not just
            asserted. */}
        <section className="px-6 py-14 sm:px-12">
          <div className="mx-auto max-w-[1080px]">
            {/* Rainbow rule: a short brand-rainbow ornament echoing the top
                ribbon, used as a quiet section break. */}
            <div
              aria-hidden
              className="brand-rainbow-bg mx-auto mb-5 h-1 w-14 rounded-full"
            />
            <p className="text-center text-title font-bold text-brand-ink">
              Built by PhD researchers, for researchers.
            </p>
            <div className="mx-auto mt-9 grid max-w-[820px] grid-cols-1 gap-x-8 gap-y-9 sm:grid-cols-3">
              {/* Open source (links to the credits page). */}
              <a
                href="/open-source"
                className="group flex flex-col items-center text-center"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
                    <path d="M8 6l-5 6 5 6M16 6l5 6-5 6" />
                  </svg>
                </span>
                <h3 className="mt-3 text-body font-bold text-brand-ink group-hover:text-sky-700">
                  Open source
                </h3>
                <p className="mt-1 text-body leading-snug text-[#475569]">
                  AGPLv3 and fully auditable. No lock-in, ever.
                </p>
              </a>

              {/* Fellowship-backed (static). */}
              <div className="flex flex-col items-center text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
                    <path d="M22 10L12 5 2 10l10 5 10-5z" />
                    <path d="M6 12v4c0 1.1 2.7 2.5 6 2.5s6-1.4 6-2.5v-4" />
                  </svg>
                </span>
                <h3 className="mt-3 text-body font-bold text-brand-ink">
                  Fellowship-backed
                </h3>
                <p className="mt-1 text-body leading-snug text-[#475569]">
                  Funded by a UW-Madison fellowship, so it stays free for every
                  lab.
                </p>
              </div>

              {/* Science you can check (links to /transparency). */}
              <a
                href="/transparency"
                className="group flex flex-col items-center text-center"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M8 12l3 3 5-6" />
                  </svg>
                </span>
                <h3 className="mt-3 text-body font-bold text-brand-ink group-hover:text-sky-700">
                  Science you can check
                </h3>
                <p className="mt-1 text-body leading-snug text-[#475569]">
                  Every result verified against Biopython and primer3.
                </p>
                <span className="mt-1 text-body font-semibold text-sky-600 group-hover:text-sky-700">
                  See the proof
                </span>
              </a>
            </div>
          </div>
        </section>

        {/* ── Bento feature grid ──────────────────────────────────────── */}
        {/* Tinted band so the white cards read as cards, not a white-on-white
            blur. Anchored for the hero "See it in action" jump. */}
        <section
          id="toolkit"
          className="scroll-mt-6 border-y border-[#dce6f3] bg-[#eef4fb] px-6 py-20 sm:px-12"
        >
          <div className="mx-auto mb-8 max-w-[1180px]">
            <Kicker>// the toolkit</Kicker>
            <h2 className="mt-2.5 max-w-[22ch] text-3xl font-extrabold leading-tight tracking-tight text-brand-ink md:text-[36px]">
              The tools that make you want to try it
            </h2>
          </div>

          {/* The sequence-editor clip leads the flagship, and own-your-data has
              its own trust block below, so neither repeats here. The grid
              carries the remaining showcases at half / third width so no single
              loop renders huge. */}
          <div className="mx-auto grid max-w-[1180px] grid-cols-1 gap-4 md:grid-cols-6">
            {/* 01: replaces 5 tools (real clip), half width. */}
            <BentoCell
              num="01"
              span="lead"
              title="Notebook, methods, Gantt, purchasing, and calendar in one place"
            >
              <p className="text-body leading-relaxed text-[#475569]">
                One workspace instead of five tabs. The whole lab, planned and
                recorded together, with nothing to wire up.
              </p>
              <DemoLoop
                src="https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/replaces-5-tools.mp4"
                poster="https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/replaces-5-tools.poster.jpg"
                label="A sweep across the Gantt timeline, purchases dashboard, and more in one workspace"
                className="mt-4"
              />
            </BentoCell>

            {/* 02: methods library (real clip), half width. */}
            <BentoCell num="02" span="lead" title="91 protocols from major biotech, preloaded">
              <p className="text-body leading-relaxed text-[#475569]">
                The library comes loaded with{" "}
                <span className="font-semibold text-brand-ink">91 ready-to-run
                protocols</span>{" "}
                built around real kits from NEB, Promega, Qiagen, Thermo Fisher,
                Bio-Rad, Takara, and more. Search the catalog, copy one into your
                library, and start. No retyping a vendor handbook.
              </p>
              <CodeLine>
                NEB &middot; Promega &middot; Qiagen &middot;{" "}
                <span className="text-brand-action">Thermo Fisher</span> &middot;
                Bio-Rad &middot; Takara &middot; KAPA
              </CodeLine>
              <DemoLoop
                src="https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/methods-library.mp4"
                poster="https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/methods-library.poster.jpg"
                label="Opening the protocol template library and a structured kit protocol"
                className="mt-4"
              />
            </BentoCell>

            {/* 03: Gibson cloning (placeholder, pairs with the editor). */}
            <BentoCell num="03" span="small" title="Gibson and Golden Gate cloning, in silico">
              <p className="text-body leading-relaxed text-[#475569]">
                Drop in a fragment, pick a restriction site, and the map updates
                live, with a review step before anything saves.
              </p>
              <DemoLoopPlaceholder
                tag="Gibson cloning"
                claim="A cloning action joining fragments, with the construct assembling live."
                className="mt-4 flex-1"
              />
            </BentoCell>

            {/* 04: PI lab overview (real clip, secondary). */}
            <BentoCell num="04" span="small" title="The PI sees the whole lab at a glance">
              <p className="text-body leading-relaxed text-[#475569]">
                A live dashboard of every member&apos;s projects, funding, and
                progress, tuned to what a PI wants to see.
              </p>
              <DemoLoop
                src="https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/pi-lab-overview.mp4"
                poster="https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/pi-lab-overview.poster.jpg"
                label="The PI lab-overview dashboard with member tiles, funding, and progress"
                className="mt-4 flex-1"
              />
            </BentoCell>
          </div>
        </section>

        {/* ── NEW: accounts, grow or split out ──────────────────────────
            The shipped 3-tier account story (local / free account / lab) plus
            migrate-to-solo. Real product, told plainly: start solo, grow into a
            lab, or split back out, one folder per person, recoverable, never
            locked in. */}
        <section className="px-6 py-20 sm:px-12">
          <div className="mx-auto max-w-[1180px]">
            <Kicker>// your lab, your call</Kicker>
            <h2 className="mt-2.5 max-w-[24ch] text-3xl font-extrabold leading-tight tracking-tight text-brand-ink md:text-[36px]">
              Start solo, grow into a lab, or split back out
            </h2>
            <p className="mt-3 max-w-[62ch] text-title leading-relaxed text-[#475569]">
              Work alone on your own machine with the whole app. Add a free
              account when you want to share across labs. Spin up a lab when your
              team needs real-time sync. Leaving a shared folder later? Take just
              your own data to your own folder in one move. One folder per person,
              always recoverable, never locked in.
            </p>
            <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
              <TierCard
                tag="// just me, local"
                price="Free"
                title="On your own machine"
                body="The full app, no account, most private. Your notebook is a plain folder on your disk."
              />
              <TierCard
                tag="// free account"
                price="Also free"
                title="Share across labs"
                body="Send notes, methods, and projects to anyone by email, with an encrypted inbox. Your data still lives on your disk."
              />
              <TierCard
                tag="// lab"
                price="For teams"
                title="Sync the whole team"
                body="When the collaboration layer lands, the whole lab gets real-time editing and shared sync. Members can always split back out to a solo folder."
                comingSoon
              />
            </div>
            <p className="mt-5 max-w-[62ch] text-body leading-relaxed text-[#64748b]">
              Switching tiers never traps your work. Moving from a shared lab
              folder back to a solo one copies just your records into a folder you
              own, and the originals stay put until you say otherwise.
            </p>
          </div>
        </section>

        {/* ── You own your data (lighter differentiator block) ────────── */}
        <section className="border-y border-[#d8e3f1] bg-[#f4f8fd] text-[#0f1b2e]">
          <div className="mx-auto grid max-w-[1180px] items-center gap-12 px-6 py-20 sm:px-12 md:grid-cols-[1.05fr_1fr]">
            <div>
              <Kicker>// a different deal than a cloud notebook</Kicker>
              <h2 className="mt-3 max-w-[16ch] text-3xl font-extrabold leading-[1.08] tracking-tight md:text-[38px]">
                No cloud. No lock-in. Just your files.
              </h2>
              <p className="mt-4 max-w-[52ch] text-title leading-relaxed text-[#475569]">
                Everything you write lives as ordinary files in a folder on your
                own computer. Open them in your file browser, back them up, move
                them anywhere. ResearchOS reads and writes that folder, and
                nothing is uploaded to a cloud you do not control.
              </p>
              <ul className="mt-6 grid gap-3">
                <li className="flex items-start gap-2.5 text-body leading-snug text-[#0f1b2e]">
                  <CheckGlyph />
                  Local-first and private by default, no account required to
                  start.
                </li>
                <li className="flex items-start gap-2.5 text-body leading-snug text-[#0f1b2e]">
                  <CheckGlyph />
                  Open source and auditable, so you can see exactly what it does.
                </li>
                <li className="flex items-start gap-2.5 text-body leading-snug text-[#0f1b2e]">
                  <CheckGlyph />
                  Free, funded by a university fellowship, with no per-seat fees.
                </li>
              </ul>
            </div>
            {/* The own-your-data clip in a terminal-style block, the bold-rainbow
                frame around it. */}
            <RainbowFrame>
              <div className="bg-white">
                <div className="flex items-center gap-2 border-b border-[#d8e3f1] bg-[#f3f7fc] px-3.5 py-3 font-mono text-meta text-[#64748b]">
                  <span className="flex gap-1.5" aria-hidden>
                    <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
                  </span>
                  ~/Lab/crispr-screen/
                </div>
                <div className="relative aspect-[16/10] w-full overflow-hidden bg-[#eaf2fb]">
                  <DemoLoop
                    src="https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/own-your-data.mp4"
                    poster="https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/own-your-data.poster.jpg"
                    label="The project as a plain folder of files sitting on disk in the file browser"
                    className="h-full"
                  />
                </div>
              </div>
            </RainbowFrame>
          </div>
        </section>

        {/* ── Tree of life explorer (real, offline, interactive) ──────── */}
        <TreeOfLifeShowcase />

        {/* ── Secondary loops band ──────────────────────────────────────
            Snap from the bench, NIH/Zenodo, and the live-collaboration teaser,
            three across. Snap-from-bench and NIH/Zenodo clips are not recorded
            yet, so they use the placeholder. The collab teaser carries
            BeakerBot's hello. */}
        <section className="px-6 py-20 sm:px-12">
          <div className="mx-auto max-w-[1180px]">
            <Kicker>// and a lot more</Kicker>
            <h2 className="mt-2.5 max-w-[28ch] text-3xl font-extrabold leading-tight tracking-tight text-brand-ink md:text-[36px]">
              Snap from the bench, deposit to Zenodo, collaborate live
            </h2>
            <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
              {/* Snap from the bench (placeholder until recorded). */}
              <BentoCell num="snap from the bench" span="third" title="From your phone to your inbox">
                <p className="text-body leading-relaxed text-[#475569]">
                  Send a photo from the bench over Telegram and it lands in your
                  notebook, ready to attach to the right experiment.
                </p>
                <DemoLoopPlaceholder
                  tag="Snap from the bench"
                  claim="A bench photo arriving in the inbox and being filed onto an experiment."
                  className="mt-4 flex-1"
                />
              </BentoCell>

              {/* NIH + Zenodo (placeholder until recorded). */}
              <BentoCell num="NIH + Zenodo" span="third" title="Grant-ready deposits">
                <p className="text-body leading-relaxed text-[#475569]">
                  Data-management compliance plus a one-click Zenodo deposit that
                  carries your ORCID and grant metadata.
                </p>
                <DemoLoopPlaceholder
                  tag="NIH and Zenodo"
                  claim="A Zenodo deposit assembling with ORCID and grant metadata attached."
                  className="mt-4 flex-1"
                />
              </BentoCell>

              {/* Live collaboration teaser, with BeakerBot's hello. */}
              <BeakerBotPeek
                anchor="top-right"
                reactionPose="waving"
                restPose="idle"
                bubble="hi!"
                size="h-20 w-20"
              >
                <BentoCell num="on the roadmap" span="third" title="Live collaboration, coming soon">
                  <p className="text-body leading-relaxed text-[#475569]">
                    Google-Docs-style real-time editing on the same notes,
                    methods, and projects. In active development, local-first, and
                    it stays free when it lands.
                  </p>
                  {/* A static, badged mock of two cursors on one note. No video. */}
                  <div className="relative mt-4 flex-1 overflow-hidden rounded-xl border border-[#e3eaf3] bg-gradient-to-br from-[#f5f9fe] to-[#eaf2fb] p-6">
                    <div className="flex h-full min-h-[7rem] flex-col gap-2.5">
                      <div className="h-2.5 w-2/3 rounded-full bg-[#dbe6f4]" />
                      <div className="h-2.5 w-1/2 rounded-full bg-[#dbe6f4]" />
                      <div className="relative h-2.5 w-3/4 rounded-full bg-[#dbe6f4]">
                        <span aria-hidden className="absolute -right-1 -top-1 h-4 w-[2px] bg-sky-500" />
                        <span
                          aria-hidden
                          className="absolute -right-1 -top-5 rounded bg-sky-500 px-1.5 py-0.5 font-mono text-meta font-semibold text-white"
                        >
                          Mira
                        </span>
                      </div>
                      <div className="relative h-2.5 w-2/5 rounded-full bg-[#dbe6f4]">
                        <span aria-hidden className="absolute -right-1 -top-1 h-4 w-[2px] bg-purple-500" />
                        <span
                          aria-hidden
                          className="absolute -right-1 -top-5 rounded bg-purple-500 px-1.5 py-0.5 font-mono text-meta font-semibold text-white"
                        >
                          Alex
                        </span>
                      </div>
                      <div className="h-2.5 w-1/3 rounded-full bg-[#dbe6f4]" />
                    </div>
                  </div>
                </BentoCell>
              </BeakerBotPeek>
            </div>
          </div>
        </section>

        {/* ── What we're building chip (above comparison table) ───────── */}
        <div className="px-6 pb-0 pt-4 text-center sm:px-12">
          <button
            type="button"
            onClick={() => setRoadmapOpen(true)}
            className="inline-flex items-center gap-2 rounded-full border border-[#d3deec] bg-white px-4 py-2 text-meta font-semibold text-brand-ink shadow-sm transition-colors hover:bg-[#eef4fb] hover:border-[#c5d6ea]"
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
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M2 6h8M6 2l4 4-4 4" />
            </svg>
          </button>
        </div>

        {/* ── Comparison (carried from LandingPage, restyled light) ────── */}
        <section className="px-6 py-16 sm:px-12">
          <div className="mx-auto mb-8 max-w-[1320px]">
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
          </div>

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
                    us={{ mark: "soon", text: "Real-time co-editing, in development" }}
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
            SnapGene genuinely goes deeper on cloning and Quartzy has the bigger
            vendor catalog. ResearchOS wins by folding the notebook, the sequence
            tool, and inventory into one free suite with your data on your own
            disk. Two-way Quartzy sync is on the roadmap, so you can keep the
            ordering tools your lab already uses.
          </p>
        </section>

        {/* ── Final CTA (lighter treatment) ───────────────────────────── */}
        <section className="border-t border-[#d8e3f1] bg-[#f4f8fd] px-6 py-20 text-center sm:px-12">
          <div className="mx-auto flex max-w-2xl flex-col items-center">
            {/* Rainbow rule at the CTA, mirroring the trust-pillars ornament. */}
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
                <span aria-hidden>→</span>
              </a>
            </div>
            <p className="mt-4 text-meta text-[#94a3b8]">
              Free and open, funded by a university fellowship and donations.
            </p>
          </div>
        </section>

        {/* ── Site-wide sponsors (renders nothing until a real Lab or
            Institute sponsor exists) ──────────────────────────────────── */}
        <SponsorStrip variant="welcome" />

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <footer className="border-t border-[#e3eaf3] bg-[#f3f7fc] px-6 py-10 text-center text-meta text-[#8593a8]">
          <div className="inline-flex items-center gap-2 font-bold text-[#475569]">
            <BeakerBot
              pose="idle"
              animated={false}
              ariaLabel="ResearchOS"
              className="h-5 w-5 text-brand-sky"
            />
            ResearchOS
          </div>
          <div className="mt-2">
            Free and open source &middot; AGPLv3 &middot; Built at UW-Madison
          </div>
        </footer>
      </div>

      {/* Roadmap modal */}
      <RoadmapModal open={roadmapOpen} onClose={() => setRoadmapOpen(false)} />
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Account-tier card for the "start solo, grow into a lab, or split back out"
 * section. A plain white card with a monospace tag, a price-ish label, a title,
 * and a one-line description. No CTA: the tiers are chosen in the connect
 * chooser above, not here.
 * -------------------------------------------------------------------------- */
function TierCard({
  tag,
  price,
  title,
  body,
  comingSoon = false,
}: {
  tag: string;
  price: string;
  title: string;
  body: string;
  comingSoon?: boolean;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-[#dbe6f3] bg-white p-6 shadow-[0_1px_3px_rgba(15,40,80,0.06)]">
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono text-meta font-semibold tracking-[0.04em] text-brand-action">
          {tag}
        </div>
        {comingSoon ? (
          <span className="rounded-full bg-[#eef2fb] px-2.5 py-0.5 text-meta font-semibold text-brand-action">
            Coming soon
          </span>
        ) : null}
      </div>
      <div className="mt-2 text-title font-extrabold tracking-tight text-brand-ink">
        {price}
      </div>
      <h3 className="mt-1 text-heading font-bold leading-tight tracking-tight text-brand-ink">
        {title}
      </h3>
      <p className="mt-2 text-body leading-relaxed text-[#475569]">{body}</p>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Bento helpers.
 * -------------------------------------------------------------------------- */
function BentoCell({
  num,
  span,
  title,
  children,
}: {
  num: string;
  span: "lead" | "wide" | "small" | "third";
  title: string;
  children: ReactNode;
}) {
  // Column spans on the 6-col md grid: lead = 3 cols (two side by side),
  // wide = full 6 cols, small = 2 cols (three across). third = full width on a
  // local 3-col grid (the secondary band uses its own grid-cols-3, so cells
  // there just fill their column). All single-column on mobile.
  const spanCls =
    span === "wide"
      ? "md:col-span-6"
      : span === "lead"
        ? "md:col-span-3"
        : span === "small"
          ? "md:col-span-2"
          : "";
  return (
    <div
      className={`flex flex-col overflow-hidden rounded-2xl border border-[#dbe6f3] bg-white p-6 shadow-[0_1px_3px_rgba(15,40,80,0.06),0_16px_36px_-14px_rgba(15,40,80,0.22)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#cdddee] hover:shadow-[0_2px_5px_rgba(15,40,80,0.08),0_26px_50px_-16px_rgba(15,40,80,0.28)] ${spanCls}`}
    >
      <div className="font-mono text-meta font-semibold tracking-[0.04em] text-brand-action">
        {num}
      </div>
      <h3
        className={`mt-2 font-bold leading-tight tracking-tight text-brand-ink ${
          span === "small" || span === "third" ? "text-title" : "text-heading md:text-heading"
        }`}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function CodeLine({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 font-mono text-meta leading-relaxed text-[#8593a8]">
      {children}
    </div>
  );
}
