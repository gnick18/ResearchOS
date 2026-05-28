"use client";

/**
 * First-time-visitor landing ("sell") page.
 *
 * Shown ONLY to a genuinely-new visitor before the connect-folder screen
 * (gated by shouldShowLanding in lib/landing/landing-gate.ts). Returning
 * visitors never reach it. The page sells the trust flip versus a cloud ELN:
 * your data, your machine, free, with a friendly guide (BeakerBot).
 *
 * Two render modes:
 *   - Inline-gate mode (AppContent passes `onGetStarted`): the primary CTA
 *     dismisses the landing in place and reveals the connect-folder screen.
 *   - Standalone `/welcome` route (no `onGetStarted`): the primary CTA marks
 *     the landing seen and navigates to /?connect=1 so a connected user lands
 *     back in the app and a truly-new visitor lands on the connect screen
 *     (never looping back here).
 *
 * BeakerBot is the only mascot. The hi-wave (MouseWave) fires once on mount
 * as a greeting. The scene honors prefers-reduced-motion internally. The
 * landing is pre-login, so there is no per-user animation setting to read yet;
 * we lean on the reduced-motion guard the scene already implements.
 *
 * Voice rules: no em-dashes, no emojis. Every icon is an inline SVG.
 */

import { useState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import BeakerBot from "../BeakerBot";
import BeakerBotMouseWaveScene from "../BeakerBotMouseWaveScene";
import BetaNotice from "../BetaNotice";
import VersionBadge from "../VersionBadge";
import { markLandingSeen } from "@/lib/landing/landing-gate";

const GITHUB_URL = "https://github.com/gnick18/ResearchOS";

interface LandingPageProps {
  /** Inline-gate mode: called when "Get Started" is clicked to dismiss the
   *  landing and reveal the connect-folder screen. When omitted (the
   *  standalone /welcome route), Get Started navigates to /?connect=1. */
  onGetStarted?: () => void;
}

/** A single trust pillar: inline-SVG icon, title, blurb. */
function Pillar({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-gray-600">{children}</p>
    </div>
  );
}

/** A feature-showcase card: a privacy-safe fixture screenshot over a title
 *  and one-line blurb. Screenshots come from the wiki capture pipeline
 *  (public/wiki/screenshots), so they only ever show fabricated demo data. */
function FeatureCard({
  src,
  alt,
  title,
  children,
}: {
  src: string;
  alt: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="relative aspect-[16/10] w-full overflow-hidden border-b border-gray-100 bg-slate-100">
        <Image
          src={src}
          alt={alt}
          fill
          unoptimized
          sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
          className="object-cover object-top"
        />
      </div>
      <div className="p-5">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
          {children}
        </p>
      </div>
    </div>
  );
}

export default function LandingPage({ onGetStarted }: LandingPageProps) {
  const router = useRouter();

  // Hi-wave greeting: fires once on mount from the bottom-right corner.
  const [waveActive, setWaveActive] = useState(true);

  const handleGetStarted = () => {
    if (onGetStarted) {
      onGetStarted();
      return;
    }
    markLandingSeen();
    router.push("/?connect=1");
  };

  const handleTryDemo = () => {
    markLandingSeen();
    router.push("/demo");
  };

  return (
    <div
      data-testid="landing-page"
      className="min-h-screen w-full overflow-y-auto bg-white text-gray-900"
    >
      {/* Hi-wave greeting. Anchored bottom-right, fires once on mount. */}
      <BeakerBotMouseWaveScene
        active={waveActive}
        onComplete={() => setWaveActive(false)}
      />

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <header className="relative isolate overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-8 px-6 py-20 text-center md:py-28">
          <div aria-hidden className="drop-shadow-[0_8px_24px_rgba(56,189,248,0.25)]">
            <BeakerBot pose="waving" className="h-32 w-32 text-sky-400 md:h-40 md:w-40" />
          </div>
          <div className="flex flex-col items-center gap-5">
            <span className="inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-xs font-medium tracking-wide text-sky-200">
              A free, local-first lab notebook
            </span>
            <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight text-white md:text-5xl">
              Your research notebook. On your machine. Yours to keep.
            </h1>
            <p className="max-w-2xl text-base leading-relaxed text-slate-300 md:text-lg">
              ResearchOS is a free electronic lab notebook that lives as a plain
              folder on your own computer. No account, no cloud lock-in, no
              subscription. Just your data, version-controlled and private, with
              a friendly guide to walk you through all of it.
            </p>
          </div>

          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={handleGetStarted}
              data-testid="landing-get-started"
              className="rounded-xl bg-sky-500 px-7 py-3 text-base font-semibold text-white shadow-lg transition-all hover:scale-[1.02] hover:bg-sky-400 hover:shadow-xl"
            >
              Get Started
            </button>
            <button
              type="button"
              onClick={handleTryDemo}
              data-testid="landing-try-demo"
              className="rounded-xl border border-white/20 bg-white/5 px-7 py-3 text-base font-semibold text-white transition-all hover:bg-white/10"
            >
              Try the demo
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-slate-400">
            <Link
              href="/wiki/getting-started"
              onClick={markLandingSeen}
              data-testid="landing-read-docs"
              className="font-medium text-sky-300 underline-offset-4 hover:text-sky-200 hover:underline"
            >
              Read the docs
            </Link>
            <span aria-hidden className="text-slate-600">
              •
            </span>
            <Link
              href="/wiki/security"
              onClick={markLandingSeen}
              data-testid="landing-how-private"
              className="font-medium text-sky-300 underline-offset-4 hover:text-sky-200 hover:underline"
            >
              How it stays private
            </Link>
          </div>

          <VersionBadge tone="onDark" className="mt-2" />
        </div>
      </header>

      {/* ── Trust pillars ────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900">
            A different deal than a cloud notebook
          </h2>
          <p className="mt-3 text-base leading-relaxed text-gray-600">
            Most electronic lab notebooks rent you space on their servers.
            ResearchOS flips that. You pick where your data lives, which is why
            we can keep it free and why your privacy isn&apos;t ours to leak.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Pillar
            title="Free, forever"
            icon={
              <svg
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 9.5h18M3 9.5l1.2 9a2 2 0 002 1.8h11.6a2 2 0 002-1.8l1.2-9M3 9.5l2.2-4.4A2 2 0 017 4h10a2 2 0 011.8 1.1L21 9.5M12 13.5v3.5"
                />
              </svg>
            }
          >
            Grant-funded by the UW-Madison RISE Initiative, not a startup
            chasing a subscription. There is no pricing page, and there never
            will be one.
          </Pillar>
          <Pillar
            title="Local-first"
            icon={
              <svg
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 5h16a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zM8 20h8M12 16v4"
                />
              </svg>
            }
          >
            Your notebook is a folder on your own machine. It works offline,
            opens instantly, and never touches a server you do not control.
          </Pillar>
          <Pillar
            title="No lock-in"
            icon={
              <svg
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7 10V7a5 5 0 019.6-2M6 10h12a1 1 0 011 1v8a1 1 0 01-1 1H6a1 1 0 01-1-1v-8a1 1 0 011-1zM12 14.5v2.5"
                />
              </svg>
            }
          >
            Everything is plain Markdown and ordinary files you already own,
            with real git-backed version history. Walk away any time and take
            all of it with you.
          </Pillar>
          <Pillar
            title="A friendly guide"
            icon={<BeakerBot pose="waving" className="h-7 w-7 text-sky-600" />}
          >
            BeakerBot walks you through setup and every feature, so you are
            never staring at a blank screen wondering what to do next.
          </Pillar>
        </div>
      </section>

      {/* ── Feature showcase ─────────────────────────────────────────── */}
      <section className="bg-slate-50 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <span className="text-sm font-semibold uppercase tracking-wide text-sky-600">
              Everything a working lab needs
            </span>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-gray-900">
              One place for the whole project
            </h2>
            <p className="mt-3 text-base leading-relaxed text-gray-600">
              Plan it, run it, write it up, and pay for it, without juggling
              five different tools.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              src="/wiki/screenshots/gantt-overview.png"
              alt="A Gantt timeline of experiments in ResearchOS"
              title="Plan on a timeline"
            >
              Lay experiments out on a Gantt chart and see at a glance what is
              running, blocked, or due.
            </FeatureCard>
            <FeatureCard
              src="/wiki/screenshots/methods-library.png"
              alt="The protocol and methods library in ResearchOS"
              title="Protocols that do the math"
            >
              Build a reusable library of methods. PCR and qPCR recipes even
              calculate your reaction volumes for you.
            </FeatureCard>
            <FeatureCard
              src="/wiki/screenshots/workbench-experiments.png"
              alt="The experiment workbench and lab notebook in ResearchOS"
              title="A real lab notebook"
            >
              Write up experiments in Markdown, drop in gels and images, and
              keep a tidy record of what you actually did.
            </FeatureCard>
            <FeatureCard
              src="/wiki/screenshots/purchases-unified-scroll.png"
              alt="The purchasing and spending dashboard in ResearchOS"
              title="Track every dollar"
            >
              Log purchases against grants and watch spending against your
              budget on a live dashboard.
            </FeatureCard>
            <FeatureCard
              src="/wiki/screenshots/search-results.png"
              alt="Search across the whole notebook in ResearchOS"
              title="Find anything, fast"
            >
              Search across projects, notes, methods, and results from one
              box.
            </FeatureCard>
            <FeatureCard
              src="/wiki/screenshots/calendar-month.png"
              alt="The calendar view in ResearchOS"
              title="One calendar for everything"
            >
              Link your iCloud, Google, or Outlook calendars and see meetings
              and deadlines right alongside your experiments and cultures.
            </FeatureCard>
          </div>
        </div>
      </section>

      {/* ── Built for the whole lab (sharing + PI mode) ──────────────── */}
      <section className="bg-white py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <span className="text-sm font-semibold uppercase tracking-wide text-sky-600">
              Built for the whole lab
            </span>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-gray-900">
              Run your lab together, not seat by seat
            </h2>
            <p className="mt-3 text-base leading-relaxed text-gray-600">
              Share a shared folder and your whole lab works from it. No
              per-seat pricing, no admin licenses to buy. Members keep their own
              accounts; the PI gets the bird&apos;s-eye view.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            <FeatureCard
              src="/wiki/screenshots/sharing-method-share-dialog.png"
              alt="Sharing a protocol with a labmate in ResearchOS"
              title="Share with your team"
            >
              Share a project, experiment, or protocol with anyone in your lab.
              They see your updates while you keep ownership.
            </FeatureCard>
            <FeatureCard
              src="/wiki/screenshots/lab-overview-pi-default.png"
              alt="The PI lab-overview dashboard in ResearchOS"
              title="A view built for the PI"
            >
              Lab Overview gives the PI a live picture of every member&apos;s
              projects, funding, and progress on one configurable dashboard.
            </FeatureCard>
            <FeatureCard
              src="/wiki/screenshots/lab-inbox-comments-thread.png"
              alt="A comment thread on an experiment in ResearchOS"
              title="Talk in context"
            >
              Comment threads with @mentions keep the conversation right next to
              the data it is about, instead of buried in email.
            </FeatureCard>
          </div>
        </div>
      </section>

      {/* ── NIH data-management compliance highlight ─────────────────── */}
      <section className="bg-gradient-to-br from-sky-600 to-sky-700 py-20 text-white">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <span className="text-sm font-semibold uppercase tracking-wide text-sky-100">
            Built for grant-funded labs
          </span>
          <h2 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">
            Supports your NIH Data Management and Sharing Plan
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-sky-50">
            No electronic notebook is &ldquo;NIH certified&rdquo; (there is no
            such thing), and the big cloud vendors charge enterprise prices for
            security badges a grantee lab does not need. ResearchOS gives you
            what the policy actually asks for: organized records you own, real
            version history, and clean exports. For free.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/wiki/compliance/nih-data-management"
              onClick={markLandingSeen}
              data-testid="landing-nih-compliance"
              className="rounded-xl bg-white px-6 py-3 text-base font-semibold text-sky-700 shadow-lg transition-all hover:scale-[1.02] hover:bg-sky-50"
            >
              How ResearchOS supports NIH compliance
            </Link>
            <Link
              href="/wiki/compliance/labarchives-comparison"
              onClick={markLandingSeen}
              className="rounded-xl border border-white/40 px-6 py-3 text-base font-semibold text-white transition-all hover:bg-white/10"
            >
              Compare to LabArchives
            </Link>
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <div className="mx-auto mb-14 max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-wide text-sky-600">
            Up and running in three steps
          </span>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-gray-900">
            BeakerBot does the heavy lifting
          </h2>
        </div>
        <ol className="grid gap-8 md:grid-cols-3">
          {[
            {
              n: "1",
              title: "Pick a folder",
              body: "Choose any folder on your computer, or make a fresh one. That folder becomes your notebook.",
            },
            {
              n: "2",
              title: "BeakerBot shows you around",
              body: "A guided walkthrough sets up your account and points out every feature as you go.",
            },
            {
              n: "3",
              title: "Start your first experiment",
              body: "Plan it, run it, write it up. Everything saves straight to your folder as you work.",
            },
          ].map((step) => (
            <li key={step.n} className="flex flex-col items-start">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-500 text-base font-bold text-white">
                {step.n}
              </div>
              <h3 className="mt-4 text-lg font-semibold text-gray-900">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────── */}
      <section className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 py-20">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-6 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
            Ready when you are
          </h2>
          <p className="max-w-xl text-base leading-relaxed text-slate-300">
            It is free, it is yours, and you can leave any time. Pick a folder
            and BeakerBot will take it from there.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={handleGetStarted}
              className="rounded-xl bg-sky-500 px-7 py-3 text-base font-semibold text-white shadow-lg transition-all hover:scale-[1.02] hover:bg-sky-400 hover:shadow-xl"
            >
              Get Started
            </button>
            <button
              type="button"
              onClick={handleTryDemo}
              className="rounded-xl border border-white/20 bg-white/5 px-7 py-3 text-base font-semibold text-white transition-all hover:bg-white/10"
            >
              Try the demo
            </button>
          </div>
          <BetaNotice className="mt-4 max-w-xl" />
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-200 bg-white py-10">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-6 text-center">
          <div className="rounded bg-white p-0.5">
            <Image
              src="/credentials/uw-rise-logo.png"
              alt="Wisconsin RISE Initiative (Wisconsin Research, Innovation and Scholarly Excellence)"
              width={260}
              height={69}
              unoptimized
              className="h-12 w-auto"
            />
          </div>
          <p className="text-sm text-gray-500">
            Funded by the UW-Madison RISE Initiative. Free and open source on{" "}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-sky-600 underline-offset-2 hover:text-sky-700 hover:underline"
            >
              GitHub
            </a>
            .
          </p>
          <p className="text-xs text-gray-400">
            Built by Dr. Grant R. Nickles, PhD.
          </p>
        </div>
      </footer>
    </div>
  );
}
