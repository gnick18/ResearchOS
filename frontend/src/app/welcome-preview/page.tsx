"use client";

/**
 * `/welcome-preview`, the from-scratch, video-driven welcome page (TEMP route).
 *
 * This is the modern rebuild of the welcome / sell page, built on a temporary
 * route so the live `/welcome` (LandingPage.tsx) stays untouched while we
 * iterate. The design is locked in docs/proposals/welcome-page-redesign.md:
 * a dark-first hybrid (dark navy hero + bento feature grid with the BeakerBot
 * sky-blue accent, then a LIGHTER "you own your data" trust block and a lighter
 * final CTA so the page is not one dark slab). The aesthetic matches the chosen
 * mock at tools/welcome-mock/index.html (?v=dark).
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
 * untouched (blue eyes, sky-blue stroke, rainbow liquid) on the dark hero.
 */

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import BeakerBot from "@/components/BeakerBot";
import DemoLoop, { DemoLoopPlaceholder } from "@/components/welcome/DemoLoop";
import { GoogleIcon, GitHubIcon } from "@/components/sharing/icons";

/** The rainbow ribbon gradient, shared by the top ribbon and brand accents. */
const RAINBOW =
  "linear-gradient(90deg, #FFD2B0 0%, #FFF1A8 25%, #B7EBB1 50%, #A6D2F4 75%, #D6B5F0 100%)";

/* ----------------------------------------------------------------------------
 * Sign-in row (two-path), reused at the hero and the final CTA.
 * tone="dark" for the navy hero, tone="light" for the lighter CTA block.
 * -------------------------------------------------------------------------- */
function SignInRow({
  onGoogle,
  onGitHub,
  onLocal,
  tone,
}: {
  onGoogle: () => void;
  onGitHub: () => void;
  onLocal: () => void;
  tone: "dark" | "light";
}) {
  const isDark = tone === "dark";
  const googleCls =
    "inline-flex items-center justify-center gap-2.5 rounded-xl border border-[#d7dde5] bg-white px-5 py-3 text-body font-semibold text-gray-800 shadow-[0_6px_18px_rgba(0,0,0,0.10)] transition-transform hover:scale-[1.02]";
  const githubCls =
    "inline-flex items-center justify-center gap-2.5 rounded-xl border border-[#181717] bg-[#181717] px-5 py-3 text-body font-semibold text-white transition-transform hover:scale-[1.02]";
  const localCls = isDark
    ? "text-meta font-medium text-sky-300/90 underline underline-offset-2 transition-colors hover:text-sky-200"
    : "text-meta font-medium text-sky-700 underline underline-offset-2 transition-colors hover:text-sky-800";
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onGoogle}
          data-testid="welcome-preview-signin-google"
          className={googleCls}
        >
          <GoogleIcon className="h-5 w-5 shrink-0" />
          Sign in with Google
        </button>
        <button
          type="button"
          onClick={onGitHub}
          data-testid="welcome-preview-signin-github"
          className={githubCls}
        >
          <GitHubIcon className="h-5 w-5 shrink-0" />
          Sign in with GitHub
        </button>
      </div>
      <button
        type="button"
        onClick={onLocal}
        data-testid="welcome-preview-continue-local"
        className={localCls}
      >
        Use locally without an account
      </button>
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

/** Section eyebrow kicker in the page's monospace accent style. */
function Kicker({ children, dark = true }: { children: ReactNode; dark?: boolean }) {
  return (
    <div
      className={`font-mono text-[12px] font-semibold uppercase tracking-[0.12em] ${
        dark ? "text-sky-400" : "text-sky-600"
      }`}
    >
      {children}
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Comparison table, carried from LandingPage and restyled to the dark
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
      <span className="mt-0.5 inline-block flex-none whitespace-nowrap rounded-full bg-sky-500/15 px-2 py-0.5 text-meta font-semibold text-sky-300">
        Coming soon
      </span>
    );
  }
  if (mark === "win" || mark === "have") {
    return (
      <svg
        className={`mt-0.5 h-4 w-4 flex-none ${
          mark === "win" ? "text-emerald-400" : "text-slate-500"
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
    <tr className="border-b border-white/10 align-top last:border-0">
      <td className="px-4 py-3 text-body font-medium text-slate-100">{label}</td>
      <td className="bg-sky-500/10 px-4 py-3 text-body text-slate-100">
        <span className="flex items-start gap-2">
          <MarkIcon mark={us.mark} />
          <span>{us.text}</span>
        </span>
      </td>
      <td className="px-4 py-3 text-body text-slate-400">
        <span className="flex items-start gap-2">
          <MarkIcon mark={labarchives.mark} />
          <span>{labarchives.text}</span>
        </span>
      </td>
      <td className="px-4 py-3 text-body text-slate-400">
        <span className="flex items-start gap-2">
          <MarkIcon mark={snapgene.mark} />
          <span>{snapgene.text}</span>
        </span>
      </td>
    </tr>
  );
}

/* ========================================================================== */

export default function WelcomePreviewPage() {
  const router = useRouter();

  // Hi-wave greeting: BeakerBot waves on land then settles into the living
  // idle. Mirrors the LandingPage hero mechanic (a one-shot ~2.6s timer flips
  // the wave off). The alive idle keeps him blinking and glancing afterward.
  const [waveActive, setWaveActive] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setWaveActive(false), 2600);
    return () => clearTimeout(t);
  }, []);

  // Two-path sign-in, plain router.push (no SessionProvider in this app).
  const handleGoogle = () => router.push("/?connect=1&signIn=google");
  const handleGitHub = () => router.push("/?connect=1&signIn=github");
  const handleLocal = () => router.push("/?connect=1");

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[#0a0e16] text-slate-100">
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
            <span className="text-lg font-extrabold tracking-tight text-white">
              ResearchOS
            </span>
          </div>
          <span className="rounded-full border border-white/10 bg-sky-500/10 px-3 py-1 text-meta font-semibold text-sky-300">
            Free and open source
          </span>
        </nav>

        {/* ── Hero ────────────────────────────────────────────────────── */}
        <header className="relative isolate px-6 pb-16 pt-2 text-center sm:px-12">
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

            <span className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-sky-500/10 px-3.5 py-1.5 text-meta font-semibold text-sky-300">
              <span
                aria-hidden
                className="h-[7px] w-[7px] rounded-full bg-sky-400 shadow-[0_0_0_4px_rgba(54,179,245,0.12)]"
              />
              Free and open, built by a researcher for academic labs
            </span>

            <h1 className="mt-6 max-w-[17ch] text-4xl font-extrabold leading-[1.05] tracking-tight text-white md:text-6xl">
              Your whole lab, in a notebook you{" "}
              <span
                style={{
                  background: RAINBOW,
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                actually own
              </span>
            </h1>

            <p className="mt-5 max-w-[56ch] text-title leading-relaxed text-slate-300 md:text-lg">
              Plan experiments, run real protocols, design plasmids, and write it
              all up in one workspace. It is free and local-first, so your data
              stays a plain folder on your own machine.
            </p>

            <div className="mt-8">
              <SignInRow
                onGoogle={handleGoogle}
                onGitHub={handleGitHub}
                onLocal={handleLocal}
                tone="dark"
              />
            </div>
            <p className="mt-3 max-w-[52ch] text-meta text-slate-500">
              The notebook needs no account. Sign-in is only for sharing, inbox,
              and collaboration.
            </p>
          </div>

          {/* Hero demo loop in a browser-chrome frame. The single most
              important asset on the page: the sequence editor in motion. */}
          <div className="relative z-10 mx-auto mt-12 max-w-[1020px]">
            <DemoLoop
              src="/welcome-demos/sequence-editor.mp4"
              poster="/welcome-demos/sequence-editor.poster.jpg"
              label="A circular plasmid map rendering in the ResearchOS sequence editor, with annotated feature arcs"
              framed
              frameUrl="research-os.app/sequences"
            />
            <p className="mt-4 text-body text-slate-400">
              Design plasmids and run cloning, built in.
            </p>
          </div>
        </header>

        {/* ── Credibility strip ───────────────────────────────────────── */}
        <section className="px-6 pb-4 pt-8 text-center sm:px-12">
          <p className="mx-auto max-w-[70ch] text-body leading-relaxed text-slate-300">
            <span className="font-semibold text-white">
              Built by a researcher, for researchers.
            </span>{" "}
            Free and open source, backed by a UW-Madison university fellowship.
            Your work stays on your own machine, auditable and yours to keep.
          </p>
        </section>

        {/* ── Bento feature grid ──────────────────────────────────────── */}
        <section className="px-6 py-16 sm:px-12">
          <div className="mx-auto mb-8 max-w-[1320px]">
            <Kicker>// the few that matter</Kicker>
            <h2 className="mt-2.5 max-w-[22ch] text-3xl font-extrabold leading-tight tracking-tight text-white md:text-[36px]">
              The tools that make you want to try it
            </h2>
            <p className="mt-3 max-w-[60ch] text-title leading-relaxed text-slate-300">
              We do not list every feature. We lead with the handful that make a
              researcher go &ldquo;I have to try this,&rdquo; and trust you to
              discover the rest once you are in.
            </p>
          </div>

          <div className="mx-auto grid max-w-[1320px] grid-cols-1 gap-4 md:grid-cols-6">
            {/* Lead 1: sequence editor (real clip, also the hero, repeated as
                the lead bento cell with its claim). */}
            <BentoCell num="01" span="lead" title="Design plasmids and run cloning, built in">
              <p className="text-body leading-relaxed text-slate-300">
                SnapGene-style circular maps with annotated feature arcs and live
                cloning. Free, and right inside your notebook.
              </p>
              <CodeLine>
                <span className="text-sky-400">pUC19</span> 2686 bp &middot; EcoRI
                &middot; HindIII &middot; BamHI
              </CodeLine>
              <DemoLoop
                src="/welcome-demos/sequence-editor.mp4"
                poster="/welcome-demos/sequence-editor.poster.jpg"
                label="The sequence editor showing a circular plasmid map with colored feature arcs"
                className="mt-4 flex-1"
              />
            </BentoCell>

            {/* Lead 2: own your data (real clip). */}
            <BentoCell num="02" span="lead" title="Your whole project lives in one folder you own">
              <p className="text-body leading-relaxed text-slate-300">
                Every note, image, and protocol is a plain file on your disk.
                Local-first, private, no cloud lock-in.
              </p>
              <CodeLine>
                ~/Lab/<span className="text-sky-400">my-project</span>/notes/
                images/ methods/
              </CodeLine>
              <DemoLoop
                src="/welcome-demos/own-your-data.mp4"
                poster="/welcome-demos/own-your-data.poster.jpg"
                label="Connecting a local folder and seeing the project files sitting on disk"
                className="mt-4 flex-1"
              />
            </BentoCell>

            {/* Wide 3: replaces 5 tools (real clip). */}
            <BentoCell
              num="03"
              span="wide"
              title="Notebook, methods, Gantt, purchasing, and calendar in one place"
            >
              <p className="text-body leading-relaxed text-slate-300">
                One workspace instead of five tabs. The whole lab, planned and
                recorded together, with nothing to wire up.
              </p>
              <DemoLoop
                src="/welcome-demos/replaces-5-tools.mp4"
                poster="/welcome-demos/replaces-5-tools.poster.jpg"
                label="A sweep across the Gantt timeline, purchases dashboard, and more in one workspace"
                className="mt-4"
              />
            </BentoCell>

            {/* Wide 4: methods library (real clip). */}
            <BentoCell num="04" span="wide" title="Real lab protocols, preloaded and ready to run">
              <p className="text-body leading-relaxed text-slate-300">
                The method library ships structured PCR, qPCR, and LC-MS templates
                with bundled source PDFs. It already knows how to run your
                experiment, and the reaction math scales itself.
              </p>
              <CodeLine>
                PCR master mix &middot;{" "}
                <span className="text-sky-400">24 rxn</span> &middot; 2x Q5 12.5
                &micro;L &middot; primer 1.25 &micro;L
              </CodeLine>
              <DemoLoop
                src="/welcome-demos/methods-library.mp4"
                poster="/welcome-demos/methods-library.poster.jpg"
                label="Opening the protocol template library and a structured kit protocol"
                className="mt-4"
              />
            </BentoCell>

            {/* Small 5: Gibson cloning (placeholder, pairs with the editor). */}
            <BentoCell num="05" span="small" title="Gibson and Golden Gate cloning, in silico">
              <p className="text-body leading-relaxed text-slate-300">
                Drop in a fragment, pick a restriction site, and the map updates
                live, with a review step before anything saves.
              </p>
              <DemoLoopPlaceholder
                tag="Gibson cloning"
                claim="A cloning action joining fragments, with the construct assembling live."
                className="mt-4 flex-1"
              />
            </BentoCell>

            {/* Small 6: PI lab overview (real clip, secondary). */}
            <BentoCell num="06" span="small" title="The PI sees the whole lab at a glance">
              <p className="text-body leading-relaxed text-slate-300">
                A live dashboard of every member&apos;s projects, funding, and
                progress, configurable for the decision-maker.
              </p>
              <DemoLoop
                src="/welcome-demos/pi-lab-overview.mp4"
                poster="/welcome-demos/pi-lab-overview.poster.jpg"
                label="The PI lab-overview dashboard with member tiles, funding, and progress"
                className="mt-4 flex-1"
              />
            </BentoCell>

            {/* Small 7: snap from the bench (placeholder). */}
            <BentoCell num="07" span="small" title="Snap it from the bench">
              <p className="text-body leading-relaxed text-slate-300">
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
                You own your data. Plain and simple.
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
              <div className="flex items-center gap-2 border-b border-[#d8e3f1] bg-[#f3f7fc] px-3.5 py-3 font-mono text-[12px] text-[#64748b]">
                <span className="flex gap-1.5" aria-hidden>
                  <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
                </span>
                ~/Lab/crispr-screen/
              </div>
              <div className="relative aspect-[16/10] w-full overflow-hidden bg-[#eaf2fb]">
                <DemoLoop
                  src="/welcome-demos/own-your-data.mp4"
                  poster="/welcome-demos/own-your-data.poster.jpg"
                  label="The project as a plain folder of files sitting on disk in the file browser"
                  className="h-full"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ── Live collaboration coming-soon teaser ───────────────────── */}
        <section className="px-6 py-16 sm:px-12">
          <div className="mx-auto max-w-[1320px] overflow-hidden rounded-2xl border border-white/10 bg-[#121a2b]">
            <div className="grid items-center gap-8 p-8 md:grid-cols-[1.1fr_1fr] md:p-12">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-meta font-semibold text-sky-300">
                  On the roadmap
                </span>
                <h2 className="mt-4 max-w-[20ch] text-2xl font-extrabold leading-tight tracking-tight text-white md:text-3xl">
                  Live collaboration, coming soon
                </h2>
                <p className="mt-3 max-w-[52ch] text-title leading-relaxed text-slate-300">
                  Google-Docs-style real-time editing on the same notes, methods,
                  and projects, so your whole lab can work a record together. It
                  is in active development, not shipped yet, and it will stay free
                  and local-first when it lands.
                </p>
              </div>
              {/* A static, badged mock of two cursors on one note. No video. */}
              <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-[#101a2d] to-[#0c1424] p-6">
                <div className="flex h-full flex-col gap-2.5">
                  <div className="h-2.5 w-2/3 rounded-full bg-white/10" />
                  <div className="h-2.5 w-1/2 rounded-full bg-white/10" />
                  <div className="relative h-2.5 w-3/4 rounded-full bg-white/10">
                    {/* Cursor A */}
                    <span
                      aria-hidden
                      className="absolute -right-1 -top-1 h-4 w-[2px] bg-sky-400"
                    />
                    <span
                      aria-hidden
                      className="absolute -right-1 -top-5 rounded bg-sky-400 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-[#0a0e16]"
                    >
                      Mira
                    </span>
                  </div>
                  <div className="relative h-2.5 w-2/5 rounded-full bg-white/10">
                    {/* Cursor B */}
                    <span
                      aria-hidden
                      className="absolute -right-1 -top-1 h-4 w-[2px] bg-purple-400"
                    />
                    <span
                      aria-hidden
                      className="absolute -right-1 -top-5 rounded bg-purple-400 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-[#0a0e16]"
                    >
                      Alex
                    </span>
                  </div>
                  <div className="h-2.5 w-1/3 rounded-full bg-white/10" />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Comparison (carried from LandingPage, restyled dark) ─────── */}
        <section className="px-6 py-16 sm:px-12">
          <div className="mx-auto mb-8 max-w-[1320px]">
            <Kicker>// a full lab suite vs the point tools</Kicker>
            <h2 className="mt-2.5 max-w-[24ch] text-3xl font-extrabold leading-tight tracking-tight text-white md:text-[36px]">
              How we compare to LabArchives and SnapGene
            </h2>
            <p className="mt-3 max-w-[60ch] text-title leading-relaxed text-slate-300">
              LabArchives is the notebook most labs are leaving and SnapGene is
              the sequence tool many of them also pay for. Here is the honest
              three-way on the things that matter most.
            </p>
          </div>

          <div className="mx-auto max-w-[1320px] overflow-hidden rounded-2xl border border-white/10 bg-[#121a2b] shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="w-[24%] px-4 py-3 text-body font-semibold text-slate-400">
                      <span className="sr-only">Capability</span>
                    </th>
                    <th className="w-[28%] bg-sky-500/10 px-4 py-3 text-body font-bold text-sky-300">
                      ResearchOS
                    </th>
                    <th className="w-[24%] px-4 py-3 text-body font-semibold text-slate-200">
                      LabArchives (Professional)
                    </th>
                    <th className="w-[24%] px-4 py-3 text-body font-semibold text-slate-200">
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

          <p className="mx-auto mt-6 max-w-[60ch] text-center text-body leading-relaxed text-slate-400">
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
        <footer className="bg-[#0a0e16] px-6 py-10 text-center text-meta text-slate-500">
          <div className="inline-flex items-center gap-2 font-bold text-slate-300">
            <BeakerBot
              pose="idle"
              animated={false}
              ariaLabel="ResearchOS"
              className="h-5 w-5 text-slate-400"
            />
            ResearchOS
          </div>
          <div className="mt-2">
            Free and open source &middot; AGPLv3 &middot; Built at UW-Madison
          </div>
        </footer>
      </div>
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
      className={`flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#121a2b] p-6 ${spanCls}`}
    >
      <div className="font-mono text-[12px] font-semibold tracking-[0.04em] text-sky-400">
        {num}
      </div>
      <h3
        className={`mt-2 font-bold leading-tight tracking-tight text-white ${
          span === "small" ? "text-lg" : "text-xl md:text-[22px]"
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
    <div className="mt-3 font-mono text-[12px] leading-relaxed text-slate-500">
      {children}
    </div>
  );
}
