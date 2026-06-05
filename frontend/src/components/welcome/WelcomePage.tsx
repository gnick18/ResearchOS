"use client";

/**
 * The `/welcome` page: video-driven sell page (2026-06-04 rebuild).
 *
 * This is the modern rebuild of the welcome / sell page, built on a temporary
 * route so the live `/welcome` (LandingPage.tsx) stays untouched while we
 * iterate. The design is locked in docs/proposals/welcome-page-redesign.md.
 * The aesthetic is LIGHT (Grant 2026-06-04, reversed from the dark-first
 * build). Clean white and pale-blue panels, dark slate text, soft and clinical,
 * the trustworthy look for a non-design-savvy scientist. The hero keeps the
 * thin rainbow ribbon, the soft rainbow bloom behind BeakerBot, and the
 * rainbow-gradient headline word as the only saturated accents. It matches the
 * chosen mock at tools/welcome-mock/index.html (?v=light).
 *
 * The page sells the tools through silent, looping, real-UI demo videos
 * (DemoLoop) plus a few stand-in placeholders for clips not yet recorded. It
 * leads with the handful of features that make a researcher want to try it and
 * trusts them to discover the rest once they are in.
 *
 * Sign-in: this app mounts NO SessionProvider, so we do NOT use useSession.
 * The two-path model is plain router.push, mirroring LandingPage:
 *   - Sign in with Google  -> /?connect=1&signIn=google
 *   - Sign in with GitHub  -> /?connect=1&signIn=github
 *   - Use locally          -> /?connect=1
 * The notebook needs no account; sign-in is only for sharing, inbox, and
 * collaboration, said wherever sign-in appears.
 *
 * Voice rules: no em-dashes, no emojis (every glyph is an inline SVG), no
 * mid-sentence colons. Warm, concept-first, contractions OK. BeakerBot is the
 * only mascot and renders via the real <BeakerBot alive /> component, branding
 * untouched (blue eyes, sky-blue stroke, rainbow liquid) on the light hero.
 */

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import BeakerBot from "@/components/BeakerBot";
import DemoLoop, { DemoLoopPlaceholder } from "@/components/welcome/DemoLoop";
import { GoogleIcon, GitHubIcon, LinkedInIcon } from "@/components/sharing/icons";
import { FREE_STORAGE_BYTES, TTL_DAYS } from "@/lib/sharing/relay/limits";
import RoadmapModal from "@/components/RoadmapModal";

/** The rainbow ribbon gradient (pastel), for the top ribbon and the soft bloom. */
const RAINBOW =
  "linear-gradient(90deg, #FFD2B0 0%, #FFF1A8 25%, #B7EBB1 50%, #A6D2F4 75%, #D6B5F0 100%)";

/** A deeper, saturated rainbow for the gradient HEADLINE word. The pastel
 *  RAINBOW above washes out as text on the light hero, so the headline uses
 *  these richer same-hue stops (orange, amber, green, sky, purple) that stay
 *  legible on white while keeping the rainbow feel. */
const RAINBOW_TEXT =
  "linear-gradient(95deg, #F97316 0%, #E8920B 22%, #16A34A 48%, #0284C7 72%, #9333EA 100%)";

/* ----------------------------------------------------------------------------
 * Sign-in row (two-path), reused at the hero and the final CTA. Both placements
 * are on a light surface now, so the local link reads dark-on-light everywhere.
 * The tone prop is kept for callers but no longer flips a dark variant.
 * -------------------------------------------------------------------------- */
function SignInRow({
  onGoogle,
  onGitHub,
  onLinkedIn,
  onLocal,
}: {
  onGoogle: () => void;
  onGitHub: () => void;
  onLinkedIn: () => void;
  onLocal: () => void;
  tone?: "dark" | "light";
}) {
  // Two informed paths, side by side. NO account gives the full local notebook.
  // A FREE account adds sharing, inbox, and collaboration. The storage + TTL
  // numbers are imported from the relay limits so the page can never drift from
  // what the server actually enforces.
  const inboxGb = Math.round(FREE_STORAGE_BYTES / 1024 ** 3);
  const oauthBtn =
    "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-2.5 text-meta font-semibold transition-transform hover:scale-[1.03]";
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 text-left md:grid-cols-2">
      {/* Path A: no account, the full local notebook. */}
      <div className="flex flex-col rounded-2xl border border-[#d3deec] bg-white p-6 shadow-[0_2px_12px_rgba(15,40,80,0.06)]">
        <div className="font-mono text-meta font-semibold uppercase tracking-[0.1em] text-[#1283c9]">
          // free
        </div>
        <h3 className="mt-1.5 text-heading font-extrabold tracking-tight text-[#0e1726]">
          Use it locally
        </h3>
        <ul className="mt-4 flex-1 space-y-2.5">
          <li className="flex items-start gap-2 text-body leading-snug text-[#475569]">
            <CheckGlyph /> Your full notebook and every tool.
          </li>
          <li className="flex items-start gap-2 text-body leading-snug text-[#475569]">
            <CheckGlyph /> Works offline, private, on your own machine.
          </li>
          <li className="flex items-start gap-2 text-body leading-snug text-[#475569]">
            <CheckGlyph /> Free, and yours to keep forever.
          </li>
        </ul>
        <button
          type="button"
          onClick={onLocal}
          data-testid="welcome-signin-local"
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#0e1726] px-5 py-3 text-body font-bold text-white shadow-[0_10px_26px_rgba(15,40,80,0.20)] transition-transform hover:scale-[1.01]"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4 shrink-0"
            aria-hidden
          >
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
          </svg>
          Open your notebook
        </button>
        <p className="mt-2 text-center text-meta text-[#8593a8]">No sign-up, ever.</p>
      </div>

      {/* Path B: free account, adds sharing + inbox + collaboration. */}
      <div className="flex flex-col rounded-2xl border border-[#cfe0f2] bg-[#f5faff] p-6 shadow-[0_2px_12px_rgba(15,40,80,0.06)]">
        <div className="font-mono text-meta font-semibold uppercase tracking-[0.1em] text-[#1283c9]">
          // also free
        </div>
        <h3 className="mt-1.5 text-heading font-extrabold tracking-tight text-[#0e1726]">
          Sign in to share
        </h3>
        <p className="mt-1 text-meta text-[#64748b]">Everything local, plus:</p>
        <ul className="mt-3 flex-1 space-y-2.5">
          <li className="flex items-start gap-2 text-body leading-snug text-[#475569]">
            <CheckGlyph /> Send notes, methods, and projects to anyone by email.
          </li>
          <li className="flex items-start gap-2 text-body leading-snug text-[#475569]">
            <CheckGlyph /> A {inboxGb} GB encrypted inbox for work others send you, held {TTL_DAYS} days.
          </li>
          <li className="flex items-start gap-2 text-body leading-snug text-[#475569]">
            <CheckGlyph /> Cross-lab sharing, no shared folder needed.
          </li>
          <li className="flex items-start gap-2 text-body leading-snug text-[#475569]">
            <CheckGlyph /> Live collaboration, coming soon.
          </li>
        </ul>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onGoogle}
            data-testid="welcome-preview-signin-google"
            className={`${oauthBtn} border-[#d7dde5] bg-white text-gray-800`}
          >
            <GoogleIcon className="h-4 w-4 shrink-0" />
            Google
          </button>
          <button
            type="button"
            onClick={onGitHub}
            data-testid="welcome-preview-signin-github"
            className={`${oauthBtn} border-[#181717] bg-[#181717] text-white`}
          >
            <GitHubIcon className="h-4 w-4 shrink-0" />
            GitHub
          </button>
          <button
            type="button"
            onClick={onLinkedIn}
            data-testid="welcome-preview-signin-linkedin"
            className={`${oauthBtn} border-[#0A66C2] bg-[#0A66C2] text-white hover:bg-[#004182]`}
          >
            <LinkedInIcon className="h-4 w-4 shrink-0" />
            LinkedIn
          </button>
        </div>
        <p className="mt-2 text-meta leading-snug text-[#8593a8]">
          Sign-in only verifies your email. Your notebook still lives on your
          machine.
        </p>
      </div>
    </div>
  );
}

/** A check glyph for the trust-block list, sky-blue. */
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

/** Section eyebrow kicker in the page's monospace accent style. Sky accent
 *  tuned for the light surface (matches the mock's --accent #1283c9). */
function Kicker({ children }: { children: ReactNode; dark?: boolean }) {
  return (
    <div className="font-mono text-meta font-semibold uppercase tracking-[0.12em] text-[#1283c9]">
      {children}
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Comparison table, carried from LandingPage and restyled to the light
 * aesthetic. ResearchOS vs LabArchives vs SnapGene, honest three-way.
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
}: {
  label: string;
  us: Cell;
  labarchives: Cell;
  snapgene: Cell;
}) {
  return (
    <tr className="border-b border-[#e3eaf3] align-top last:border-0">
      <td className="px-4 py-3 text-body font-medium text-[#0e1726]">{label}</td>
      <td className="bg-sky-50 px-4 py-3 text-body text-[#0e1726]">
        <span className="flex items-start gap-2">
          <MarkIcon mark={us.mark} />
          <span>{us.text}</span>
        </span>
      </td>
      <td className="px-4 py-3 text-body text-[#64748b]">
        <span className="flex items-start gap-2">
          <MarkIcon mark={labarchives.mark} />
          <span>{labarchives.text}</span>
        </span>
      </td>
      <td className="px-4 py-3 text-body text-[#64748b]">
        <span className="flex items-start gap-2">
          <MarkIcon mark={snapgene.mark} />
          <span>{snapgene.text}</span>
        </span>
      </td>
    </tr>
  );
}

/* ========================================================================== */

export default function WelcomePage() {
  const router = useRouter();

  // Hi-wave greeting: BeakerBot waves on land then settles into the living
  // idle. Start false so the first server/client render is idle (avoids any
  // hydration flicker), then flip to waving immediately on mount and settle
  // after ~3s. The alive idle keeps him blinking and glancing afterward.
  const [waveActive, setWaveActive] = useState(false);
  useEffect(() => {
    // Small leading delay so the wave starts after the page paints and the
    // visitor's eye is on it, not before.
    const start = setTimeout(() => setWaveActive(true), 120);
    const stop = setTimeout(() => setWaveActive(false), 3200);
    return () => {
      clearTimeout(start);
      clearTimeout(stop);
    };
  }, []);

  // Roadmap modal state.
  const [roadmapOpen, setRoadmapOpen] = useState(false);

  // Three-path sign-in, plain router.push (no SessionProvider in this app).
  const handleGoogle = () => router.push("/?connect=1&signIn=google");
  const handleGitHub = () => router.push("/?connect=1&signIn=github");
  const handleLinkedIn = () => router.push("/?connect=1&signIn=linkedin");
  const handleLocal = () => router.push("/?connect=1");

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[#fbfcfe] text-[#0e1726]">
      {/* Thin rainbow ribbon pinned to the very top edge. */}
      <div aria-hidden className="h-[5px] w-full" style={{ background: RAINBOW }} />

      <div className="relative mx-auto max-w-[1440px]">
        {/* ── Nav ─────────────────────────────────────────────────────── */}
        <nav className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-12">
          <div className="flex items-center gap-2.5">
            <BeakerBot
              pose="idle"
              animated={false}
              easterEgg="heart"
              ariaLabel="ResearchOS BeakerBot logo"
              className="h-8 w-8 shrink-0 text-sky-500"
            />
            <span className="text-heading font-extrabold tracking-tight text-[#0e1726]">
              ResearchOS
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setRoadmapOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#d3deec] bg-white px-3 py-1 text-meta font-semibold text-[#0e1726] transition-colors hover:bg-[#eef4fb] hover:border-[#c5d6ea]"
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
            <span className="rounded-full border border-[#d3deec] bg-sky-50 px-3 py-1 text-meta font-semibold text-sky-700">
              Free and open source
            </span>
          </div>
        </nav>

        {/* ── Hero ────────────────────────────────────────────────────── */}
        {/* Its own subtle band (white to pale blue) with a bottom edge, so the
            hero reads as a distinct chunk and does not bleed into the content
            below. */}
        <header className="relative isolate bg-gradient-to-b from-white to-[#eef4fb] px-6 pb-8 pt-2 text-center sm:px-12">
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
              className="drop-shadow-[0_14px_30px_rgba(26,160,230,0.34)]"
            >
              <BeakerBot
                pose={waveActive ? "waving" : "idle"}
                alive
                className="h-28 w-28 text-sky-500 md:h-32 md:w-32"
              />
            </div>

            <span className="mt-4 inline-flex items-center gap-2 rounded-full border border-[#d3deec] bg-sky-50 px-3.5 py-1.5 text-meta font-semibold text-sky-700">
              <span
                aria-hidden
                className="h-[7px] w-[7px] rounded-full bg-sky-500 shadow-[0_0_0_4px_rgba(54,179,245,0.12)]"
              />
              Built by PhD researchers, for researchers.
            </span>

            <h1 className="mt-6 max-w-[17ch] text-4xl font-extrabold leading-[1.05] tracking-tight text-[#0e1726] md:text-6xl">
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

            <div className="mt-8">
              <SignInRow
                onGoogle={handleGoogle}
                onGitHub={handleGitHub}
                onLinkedIn={handleLinkedIn}
                onLocal={handleLocal}
                tone="light"
              />
            </div>
          </div>
        </header>

        {/* ── Flagship showcase ─────────────────────────────────────────
            A tinted band that pairs the hero loop with real explanatory copy,
            so the first thing under the hero is substance, not a bare video.
            The band's tint + borders give the page visual rhythm against the
            white sections. */}
        <section className="border-b border-[#dbe6f3] bg-gradient-to-b from-[#eef4fb] to-[#f5f9fd] px-6 pb-20 pt-12 sm:px-12">
          <div className="mx-auto grid max-w-[1180px] items-center gap-12 md:grid-cols-[0.92fr_1.08fr]">
            <div>
              <Kicker>// the flagship</Kicker>
              <h2 className="mt-3 max-w-[18ch] text-3xl font-extrabold leading-[1.1] tracking-tight text-[#0e1726] md:text-[38px]">
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
            <DemoLoop
              src="https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/sequence-editor-a.mp4"
              poster="https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/sequence-editor-a.poster.jpg"
              label="A circular plasmid map rendering in the ResearchOS sequence editor, with annotated feature arcs"
              framed
              frameUrl="research-os.app/sequences"
            />
          </div>
        </section>

        {/* ── Credibility strip ───────────────────────────────────────── */}
        <section className="px-6 pb-4 pt-8 text-center sm:px-12">
          <p className="mx-auto max-w-[70ch] text-body leading-relaxed text-[#475569]">
            <span className="font-semibold text-[#0e1726]">
              Built by PhD researchers, for researchers.
            </span>{" "}
            Free and open source, backed by a UW-Madison university fellowship.
            Your work stays on your own machine, auditable and yours to keep.
          </p>
        </section>

        {/* ── Bento feature grid ──────────────────────────────────────── */}
        {/* Tinted band so the white cards read as cards, not a white-on-white
            blur. */}
        <section className="border-y border-[#dce6f3] bg-[#eef4fb] px-6 py-20 sm:px-12">
          <div className="mx-auto mb-8 max-w-[1180px]">
            <Kicker>// the toolkit</Kicker>
            <h2 className="mt-2.5 max-w-[22ch] text-3xl font-extrabold leading-tight tracking-tight text-[#0e1726] md:text-[36px]">
              The tools that make you want to try it
            </h2>
          </div>

          {/* The sequence-editor clip leads the HERO, and own-your-data has its
              own trust block below, so neither repeats here. The grid carries
              the remaining showcases at half / third width so no single loop
              renders huge. */}
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
                <span className="font-semibold text-[#0e1726]">91 ready-to-run
                protocols</span>{" "}
                built around real kits from NEB, Promega, Qiagen, Thermo Fisher,
                Bio-Rad, Takara, and more. Search the catalog, copy one into your
                library, and start. No retyping a vendor handbook.
              </p>
              <CodeLine>
                NEB &middot; Promega &middot; Qiagen &middot;{" "}
                <span className="text-[#1283c9]">Thermo Fisher</span> &middot;
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
                progress, configurable for the decision-maker.
              </p>
              <DemoLoop
                src="https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/pi-lab-overview.mp4"
                poster="https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/pi-lab-overview.poster.jpg"
                label="The PI lab-overview dashboard with member tiles, funding, and progress"
                className="mt-4 flex-1"
              />
            </BentoCell>

            {/* 05: snap from the bench (placeholder). */}
            <BentoCell num="05" span="small" title="Snap it from the bench">
              <p className="text-body leading-relaxed text-[#475569]">
                Send a photo or note from your phone over Telegram and it lands in
                your notebook inbox, ready to attach.
              </p>
              <DemoLoopPlaceholder
                tag="Telegram capture"
                claim="A phone photo over Telegram landing in the notebook inbox."
                className="mt-4 flex-1"
              />
            </BentoCell>
          </div>
        </section>

        {/* ── NIH data-management compliance band ───────────────────────
            Grant's pick: reuse the existing NIH banner from the live welcome
            here instead of a demo video. Sky-gradient band, ported copy with
            the mid-sentence colon recast to a period split. */}
        <section className="bg-gradient-to-br from-sky-600 to-sky-700 py-20 text-white">
          <div className="mx-auto max-w-4xl px-6 text-center">
            <span className="text-body font-semibold uppercase tracking-wide text-sky-100">
              Built for grant-funded labs
            </span>
            <h2 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">
              Supports your NIH Data Management and Sharing Plan
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-title leading-relaxed text-sky-50">
              You are a research lab, not an enterprise. No electronic notebook
              is &ldquo;NIH certified&rdquo; (there is no such thing), yet the
              big cloud vendors charge enterprise prices for compliance badges
              your grant never asked you to buy. ResearchOS is shaped around how
              an academic lab actually works and gives you what the policy
              really wants. Organized records you own, with real version history
              and clean exports, without the enterprise price tag.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href="/wiki/compliance/nih-data-management"
                data-testid="welcome-preview-nih-compliance"
                className="rounded-xl bg-white px-6 py-3 text-title font-semibold text-sky-700 shadow-lg transition-all hover:scale-[1.02] hover:bg-sky-50"
              >
                How ResearchOS supports NIH compliance
              </a>
              <a
                href="/wiki/compliance/labarchives-comparison"
                className="rounded-xl border border-white/40 px-6 py-3 text-title font-semibold text-white transition-all hover:bg-white/10"
              >
                Compare to LabArchives
              </a>
            </div>
          </div>
        </section>

        {/* ── You own your data (lighter differentiator block) ────────── */}
        <section className="border-y border-[#d8e3f1] bg-[#f4f8fd] text-[#0f1b2e]">
          <div className="mx-auto grid max-w-[1180px] items-center gap-12 px-6 py-20 sm:px-12 md:grid-cols-[1.05fr_1fr]">
            <div>
              <Kicker dark={false}>// a different deal than a cloud notebook</Kicker>
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
            {/* The own-your-data clip, framed light to match this block. */}
            <div className="overflow-hidden rounded-2xl border border-[#d8e3f1] bg-white shadow-[0_24px_60px_rgba(15,40,80,0.12)]">
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
          </div>
        </section>

        {/* ── Live collaboration coming-soon teaser ───────────────────── */}
        <section className="px-6 py-16 sm:px-12">
          <div className="mx-auto max-w-[1320px] overflow-hidden rounded-2xl border border-[#e3eaf3] bg-white shadow-[0_1px_2px_rgba(15,40,80,0.04)]">
            <div className="grid items-center gap-8 p-8 md:grid-cols-[1.1fr_1fr] md:p-12">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-meta font-semibold text-sky-700">
                  On the roadmap
                </span>
                <h2 className="mt-4 max-w-[20ch] text-2xl font-extrabold leading-tight tracking-tight text-[#0e1726] md:text-3xl">
                  Live collaboration, coming soon
                </h2>
                <p className="mt-3 max-w-[52ch] text-title leading-relaxed text-[#475569]">
                  Google-Docs-style real-time editing on the same notes, methods,
                  and projects, so your whole lab can work a record together. It
                  is in active development, not shipped yet, and it will stay free
                  and local-first when it lands.
                </p>
              </div>
              {/* A static, badged mock of two cursors on one note. No video. */}
              <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-[#e3eaf3] bg-gradient-to-br from-[#f5f9fe] to-[#eaf2fb] p-6">
                <div className="flex h-full flex-col gap-2.5">
                  <div className="h-2.5 w-2/3 rounded-full bg-[#dbe6f4]" />
                  <div className="h-2.5 w-1/2 rounded-full bg-[#dbe6f4]" />
                  <div className="relative h-2.5 w-3/4 rounded-full bg-[#dbe6f4]">
                    {/* Cursor A */}
                    <span
                      aria-hidden
                      className="absolute -right-1 -top-1 h-4 w-[2px] bg-sky-500"
                    />
                    <span
                      aria-hidden
                      className="absolute -right-1 -top-5 rounded bg-sky-500 px-1.5 py-0.5 font-mono text-meta font-semibold text-white"
                    >
                      Mira
                    </span>
                  </div>
                  <div className="relative h-2.5 w-2/5 rounded-full bg-[#dbe6f4]">
                    {/* Cursor B */}
                    <span
                      aria-hidden
                      className="absolute -right-1 -top-1 h-4 w-[2px] bg-purple-500"
                    />
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
            </div>
          </div>
        </section>

        {/* ── What we're building chip (above comparison table) ───────── */}
        <div className="px-6 pb-0 pt-4 text-center sm:px-12">
          <button
            type="button"
            onClick={() => setRoadmapOpen(true)}
            className="inline-flex items-center gap-2 rounded-full border border-[#d3deec] bg-white px-4 py-2 text-meta font-semibold text-[#0e1726] shadow-sm transition-colors hover:bg-[#eef4fb] hover:border-[#c5d6ea]"
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
            <h2 className="mt-2.5 max-w-[24ch] text-3xl font-extrabold leading-tight tracking-tight text-[#0e1726] md:text-[36px]">
              How we compare to LabArchives and SnapGene
            </h2>
            <p className="mt-3 max-w-[60ch] text-title leading-relaxed text-[#475569]">
              LabArchives is the notebook most labs are leaving and SnapGene is
              the sequence tool many of them also pay for. Here is the honest
              three-way on the things that matter most.
            </p>
          </div>

          <div className="mx-auto max-w-[1320px] overflow-hidden rounded-2xl border border-[#e3eaf3] bg-white shadow-[0_1px_2px_rgba(15,40,80,0.04)]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-[#e3eaf3]">
                    <th className="w-[24%] px-4 py-3 text-body font-semibold text-[#64748b]">
                      <span className="sr-only">Capability</span>
                    </th>
                    <th className="w-[28%] bg-sky-50 px-4 py-3 text-body font-bold text-sky-700">
                      ResearchOS
                    </th>
                    <th className="w-[24%] px-4 py-3 text-body font-semibold text-[#334155]">
                      LabArchives (Professional)
                    </th>
                    <th className="w-[24%] px-4 py-3 text-body font-semibold text-[#334155]">
                      SnapGene
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <ComparisonRow
                    label="Price"
                    us={{ mark: "win", text: "Free and open source; hosted free too" }}
                    labarchives={{
                      mark: "none",
                      text: "$330+ per user, per year; limited free tier",
                    }}
                    snapgene={{
                      mark: "none",
                      text: "Paid license per seat; free viewer only",
                    }}
                  />
                  <ComparisonRow
                    label="Per-seat fees"
                    us={{ mark: "win", text: "No per-seat fees, ever" }}
                    labarchives={{ mark: "none", text: "Charged per user, every year" }}
                    snapgene={{ mark: "none", text: "Per-seat license to edit" }}
                  />
                  <ComparisonRow
                    label="Where your data lives"
                    us={{ mark: "win", text: "A folder on your own machine" }}
                    labarchives={{ mark: "none", text: "On LabArchives' cloud servers" }}
                    snapgene={{ mark: "have", text: "Files on your machine" }}
                  />
                  <ComparisonRow
                    label="File formats"
                    us={{ mark: "win", text: "Open Markdown and your original files" }}
                    labarchives={{ mark: "none", text: "Proprietary cloud store" }}
                    snapgene={{ mark: "have", text: "Reads .dna, GenBank, and FASTA" }}
                  />
                  <ComparisonRow
                    label="A full lab suite"
                    us={{
                      mark: "win",
                      text: "Notebook, planning, purchasing, sequences, all in one",
                    }}
                    labarchives={{
                      mark: "have",
                      text: "Notebook plus widgets and add-ons",
                    }}
                    snapgene={{ mark: "none", text: "Sequences only, not a notebook" }}
                  />
                  <ComparisonRow
                    label="Sequence editing and annotation"
                    us={{
                      mark: "have",
                      text: "Import, edit, annotate, find restriction sites",
                    }}
                    labarchives={{ mark: "none", text: "No native sequence editor" }}
                    snapgene={{
                      mark: "win",
                      text: "The deepest editor and visualization here",
                    }}
                  />
                  <ComparisonRow
                    label="Live collaboration"
                    us={{ mark: "soon", text: "Real-time co-editing, in development" }}
                    labarchives={{ mark: "have", text: "Shared cloud notebook" }}
                    snapgene={{ mark: "none", text: "Single-user desktop tool" }}
                  />
                  <ComparisonRow
                    label="Per-entry version history"
                    us={{
                      mark: "win",
                      text: "Full history with one-click restore, built in",
                    }}
                    labarchives={{ mark: "have", text: "Full revision history on every entry" }}
                    snapgene={{ mark: "none", text: "Per-file saves, no notebook history" }}
                  />
                  <ComparisonRow
                    label="Move in from LabArchives"
                    us={{ mark: "win", text: "Imports your Offline Notebook ZIP directly" }}
                    labarchives={{ mark: "none", text: "Not applicable" }}
                    snapgene={{ mark: "none", text: "Not applicable" }}
                  />
                </tbody>
              </table>
            </div>
          </div>

          <p className="mx-auto mt-6 max-w-[60ch] text-center text-body leading-relaxed text-[#64748b]">
            SnapGene genuinely leads on deep cloning and sequence visualization.
            ResearchOS wins on price and ownership, and it folds sequence work
            into a full lab suite instead of a separate tool.
          </p>
        </section>

        {/* ── Final CTA (lighter treatment) ───────────────────────────── */}
        <section className="border-t border-[#d8e3f1] bg-[#f4f8fd] px-6 py-20 text-center sm:px-12">
          <div className="mx-auto flex max-w-2xl flex-col items-center">
            <BeakerBot
              pose="idle"
              alive
              ariaLabel="BeakerBot"
              className="h-16 w-16 text-sky-500"
            />
            <h2 className="mt-4 max-w-[18ch] text-3xl font-extrabold leading-[1.08] tracking-tight text-[#0e1726] md:text-4xl">
              Start your notebook in a minute
            </h2>
            <p className="mt-4 max-w-[50ch] text-title leading-relaxed text-[#475569]">
              No sign-up to begin. Connect a folder and you are writing. Sign in
              only when you want to share with your lab.
            </p>
            <div className="mt-7">
              <SignInRow
                onGoogle={handleGoogle}
                onGitHub={handleGitHub}
                onLinkedIn={handleLinkedIn}
                onLocal={handleLocal}
                tone="light"
              />
            </div>
            <p className="mt-4 text-meta text-[#94a3b8]">
              Free and open, funded by a university fellowship and donations.
            </p>
          </div>
        </section>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <footer className="border-t border-[#e3eaf3] bg-[#f3f7fc] px-6 py-10 text-center text-meta text-[#8593a8]">
          <div className="inline-flex items-center gap-2 font-bold text-[#475569]">
            <BeakerBot
              pose="idle"
              animated={false}
              ariaLabel="ResearchOS"
              className="h-5 w-5 text-sky-500"
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
 * Bento helpers.
 * -------------------------------------------------------------------------- */
function BentoCell({
  num,
  span,
  title,
  children,
}: {
  num: string;
  span: "lead" | "wide" | "small";
  title: string;
  children: ReactNode;
}) {
  // Column spans on the 6-col md grid: lead = 3 cols (two side by side),
  // wide = full 6 cols, small = 2 cols (three across). All single-column on
  // mobile.
  const spanCls =
    span === "wide"
      ? "md:col-span-6"
      : span === "lead"
        ? "md:col-span-3"
        : "md:col-span-2";
  return (
    <div
      className={`flex flex-col overflow-hidden rounded-2xl border border-[#dbe6f3] bg-white p-6 shadow-[0_1px_3px_rgba(15,40,80,0.06),0_16px_36px_-14px_rgba(15,40,80,0.22)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#cdddee] hover:shadow-[0_2px_5px_rgba(15,40,80,0.08),0_26px_50px_-16px_rgba(15,40,80,0.28)] ${spanCls}`}
    >
      <div className="font-mono text-meta font-semibold tracking-[0.04em] text-[#1283c9]">
        {num}
      </div>
      <h3
        className={`mt-2 font-bold leading-tight tracking-tight text-[#0e1726] ${
          span === "small" ? "text-title" : "text-heading md:text-heading"
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
